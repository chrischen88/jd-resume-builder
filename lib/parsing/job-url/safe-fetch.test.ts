import { describe, expect, it, vi } from "vitest";

import { htmlResponse } from "./test-utils";

import { isBlockedAddress, MAX_BYTES, safeFetch, type Lookup } from "./safe-fetch";

const publicDns: Lookup = async () => [{ address: "93.184.215.14" }];

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(["93.184.215.14", "8.8.8.8", "172.32.0.1", "2606:4700::1111", "::ffff:8.8.8.8"])(
    "allows %s",
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    },
  );
});

describe("safeFetch", () => {
  it("fetches a public HTML page without following redirects automatically", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => htmlResponse("<p>ok</p>"));
    const page = await safeFetch("https://jobs.example.com/1", { fetch, lookup: publicDns });
    expect(page).toEqual({ url: "https://jobs.example.com/1", status: 200, html: "<p>ok</p>" });
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it.each([
    ["http://127.0.0.1:3000/library", "blocked_address"],
    ["http://[::1]/", "blocked_address"],
    ["http://localhost/", "blocked_address"],
    ["http://printer.local/", "blocked_address"],
    ["file:///etc/passwd", "invalid_url"],
    ["ftp://example.com/job", "invalid_url"],
    ["https://user:pw@example.com/", "invalid_url"],
    ["not a url", "invalid_url"],
  ])("rejects %s (%s) without fetching", async (url, code) => {
    const fetch = vi.fn();
    await expect(safeFetch(url, { fetch, lookup: publicDns })).rejects.toMatchObject({ code });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks hostnames that resolve to a private address", async () => {
    const fetch = vi.fn();
    const lookup: Lookup = async () => [{ address: "93.184.215.14" }, { address: "10.0.0.5" }];
    await expect(safeFetch("https://sneaky.example.com/", { fetch, lookup })).rejects.toMatchObject(
      {
        code: "blocked_address",
      },
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("re-checks each redirect and blocks one to a private address", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/next" } }))
      .mockResolvedValueOnce(
        new Response(null, { status: 301, headers: { location: "http://192.168.0.1/admin" } }),
      );
    await expect(
      safeFetch("https://jobs.example.com/1", { fetch, lookup: publicDns }),
    ).rejects.toMatchObject({ code: "blocked_address" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[1][0])).toBe("https://jobs.example.com/next");
  });

  it("follows public redirects and reports the final URL", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "https://b.example.com/job" } }),
      )
      .mockResolvedValueOnce(htmlResponse("<p>job</p>"));
    const page = await safeFetch("https://a.example.com/", { fetch, lookup: publicDns });
    expect(page.url).toBe("https://b.example.com/job");
  });

  it("stops after too many redirects", async () => {
    const fetch = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: "/again" } }),
    );
    await expect(
      safeFetch("https://a.example.com/", { fetch, lookup: publicDns }),
    ).rejects.toMatchObject({
      code: "fetch_failed",
    });
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it("rejects non-HTML and oversized bodies", async () => {
    const pdf = vi.fn(
      async () => new Response("%PDF", { headers: { "content-type": "application/pdf" } }),
    );
    await expect(
      safeFetch("https://a.example.com/x.pdf", { fetch: pdf, lookup: publicDns }),
    ).rejects.toMatchObject({
      code: "no_posting",
    });
    const big = vi.fn<typeof globalThis.fetch>(async () => htmlResponse("x".repeat(MAX_BYTES + 1)));
    await expect(
      safeFetch("https://a.example.com/", { fetch: big, lookup: publicDns }),
    ).rejects.toMatchObject({
      code: "too_large",
    });
  });

  it("returns error statuses for the caller to handle", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => htmlResponse("blocked", 999));
    expect((await safeFetch("https://a.example.com/", { fetch, lookup: publicDns })).status).toBe(
      999,
    );
  });

  it("reports timeouts and network failures as fetch_failed", async () => {
    const timeout = vi.fn<typeof globalThis.fetch>(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    await expect(
      safeFetch("https://a.example.com/", { fetch: timeout, lookup: publicDns }),
    ).rejects.toThrow("took too long");
    const dnsFail: Lookup = async () => {
      throw new Error("ENOTFOUND");
    };
    await expect(
      safeFetch("https://nope.example.com/", { fetch: vi.fn(), lookup: dnsFail }),
    ).rejects.toMatchObject({
      code: "fetch_failed",
    });
  });
});
