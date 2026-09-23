// Test helpers for job-url tests.

/**
 * An HTML response. `new Response` rejects non-standard statuses like
 * LinkedIn's 999, which real fetch can return, so those are patched in.
 */
export function htmlResponse(
  body: string,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const init = { headers: { "content-type": "text/html; charset=utf-8", ...headers } };
  if (status >= 200 && status <= 599) return new Response(body, { ...init, status });
  const response = new Response(body, init);
  Object.defineProperties(response, { status: { value: status }, ok: { value: false } });
  return response;
}
