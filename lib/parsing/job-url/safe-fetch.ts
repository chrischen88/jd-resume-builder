import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { JobUrlError } from "./errors";

// Fetches one web page the user asked for, without letting the URL reach the
// user's own machine or network (SSRF): http(s) only, every address the host
// resolves to must be public, and each redirect hop is checked again.

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 10_000;
export const MAX_BYTES = 2 * 1024 * 1024;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "text/html,application/xhtml+xml",
};

export type Lookup = (hostname: string) => Promise<{ address: string }[]>;

export interface FetchDeps {
  fetch?: typeof fetch;
  lookup?: Lookup;
}

export interface FetchedPage {
  /** URL after redirects. */
  url: string;
  status: number;
  html: string;
}

const defaultLookup: Lookup = (hostname) => lookup(hostname, { all: true, verbatim: true });

function ipv4Blocked(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast, reserved, broadcast
  );
}

/** True for loopback, private, link-local, and other non-public addresses. */
export function isBlockedAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(ip) === 4) return ipv4Blocked(ip);
  if (isIP(ip) !== 6) return true;
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4Blocked(mapped[1]);
  return (
    ip === "::" ||
    ip === "::1" ||
    /^f[cd]/.test(ip) || // unique local fc00::/7
    /^fe[89ab]/.test(ip) || // link-local fe80::/10
    /^ff/.test(ip) || // multicast
    ip.startsWith("64:ff9b:") || // NAT64
    ip.startsWith("2001:db8:") // documentation
  );
}

async function checkUrl(raw: string, resolve: Lookup): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new JobUrlError("That isn't a valid URL.", "invalid_url");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new JobUrlError("Only http and https links can be imported.", "invalid_url");
  }
  if (url.username || url.password) {
    throw new JobUrlError("Links with a username or password can't be imported.", "invalid_url");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
      throw new JobUrlError(
        "Links to this computer or local network can't be imported.",
        "blocked_address",
      );
    }
    try {
      addresses = (await resolve(host)).map((a) => a.address);
    } catch {
      throw new JobUrlError(`Couldn't find ${host}. Check the link.`, "fetch_failed");
    }
  }
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw new JobUrlError(
      "Links to this computer or local network can't be imported.",
      "blocked_address",
    );
  }
  return url;
}

async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_BYTES) throw new JobUrlError("That page is too large to import.", "too_large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new JobUrlError("That page is too large to import.", "too_large");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * GETs an HTML page. Non-2xx responses are returned (callers decide what a
 * 404 or LinkedIn's 999 means); network failures, blocked addresses,
 * non-HTML bodies, and oversized pages throw JobUrlError.
 */
export async function safeFetch(rawUrl: string, deps: FetchDeps = {}): Promise<FetchedPage> {
  const doFetch = deps.fetch ?? fetch;
  const resolve = deps.lookup ?? defaultLookup;
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let current = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await checkUrl(current, resolve);
    let response: Response;
    try {
      response = await doFetch(url, { headers: HEADERS, redirect: "manual", signal });
    } catch (err) {
      const timedOut =
        err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new JobUrlError(
        timedOut ? "The site took too long to respond." : "Couldn't reach that site.",
        "fetch_failed",
      );
    }

    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, url).toString();
      continue;
    }

    const type = response.headers.get("content-type") ?? "";
    if (response.ok && !/text\/html|application\/xhtml/i.test(type)) {
      throw new JobUrlError("That link isn't a web page.", "no_posting");
    }
    return { url: url.toString(), status: response.status, html: await readCapped(response) };
  }
  throw new JobUrlError("That link redirects too many times.", "fetch_failed");
}
