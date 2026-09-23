// Route handlers don't get Server Actions' origin check, and the app has no
// auth, so any web page the user visits could POST to 127.0.0.1. Mutating
// routes call this to refuse cross-site requests. Requests without browser
// headers (curl, tests) are allowed: they can't ride on a visited page.

export function isSameOriginRequest(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";

  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("host");
  try {
    return new URL(origin).host === (host ?? new URL(request.url).host);
  } catch {
    return false;
  }
}
