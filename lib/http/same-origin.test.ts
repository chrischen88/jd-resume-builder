import { describe, expect, it } from "vitest";

import { isSameOriginRequest } from "./same-origin";

const request = (headers: Record<string, string>) =>
  new Request("http://127.0.0.1:3000/api/target-sets/x/analyze", { method: "POST", headers });

describe("isSameOriginRequest", () => {
  it("uses Sec-Fetch-Site when the browser sends it", () => {
    expect(isSameOriginRequest(request({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameOriginRequest(request({ "sec-fetch-site": "none" }))).toBe(true);
    expect(isSameOriginRequest(request({ "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameOriginRequest(request({ "sec-fetch-site": "same-site" }))).toBe(false);
  });

  it("falls back to comparing Origin with Host", () => {
    const host = "127.0.0.1:3000";
    expect(isSameOriginRequest(request({ origin: "http://127.0.0.1:3000", host }))).toBe(true);
    expect(isSameOriginRequest(request({ origin: "https://evil.example", host }))).toBe(false);
    expect(isSameOriginRequest(request({ origin: "null", host }))).toBe(false);
  });

  it("allows requests without browser headers", () => {
    expect(isSameOriginRequest(request({}))).toBe(true);
  });
});
