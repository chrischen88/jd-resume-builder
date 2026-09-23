import { describe, expect, it, vi } from "vitest";

import { htmlResponse } from "./test-utils";

import { importJobFromUrl } from "./index";
import type { Lookup } from "./safe-fetch";

const lookup: Lookup = async () => [{ address: "93.184.215.14" }];
const description = `<p>You will build ML systems.</p><ul>${Array.from(
  { length: 12 },
  (_, i) => `<li>Requirement number ${i + 1} with Python and SQL</li>`,
).join("")}</ul>`;

const jsonLdPage = (desc = description) =>
  `<html><head><script type="application/ld+json">${JSON.stringify({
    "@type": "JobPosting",
    title: "ML Engineer",
    hiringOrganization: { name: "Acme" },
    description: desc,
  })}</script></head></html>`;

describe("importJobFromUrl", () => {
  it("reads a job site's JSON-LD and keeps the final URL without its hash", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => htmlResponse(jsonLdPage()));
    const job = await importJobFromUrl("https://boards.example.com/acme/jobs/1#apply", {
      fetch,
      lookup,
    });
    expect(job).toMatchObject({
      title: "ML Engineer",
      company: "Acme",
      sourceUrl: "https://boards.example.com/acme/jobs/1",
    });
    expect(job.text).toMatch(
      /^You will build ML systems\.\n\n- Requirement number 1 with Python and SQL/,
    );
  });

  it("uses the canonical LinkedIn job page when it has JSON-LD", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => htmlResponse(jsonLdPage()));
    const job = await importJobFromUrl(
      "https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=ml",
      { fetch, lookup },
    );
    expect(job.sourceUrl).toBe("https://www.linkedin.com/jobs/view/4012345678/");
    expect(String(fetch.mock.calls[0][0])).toBe("https://www.linkedin.com/jobs/view/4012345678/");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to LinkedIn's guest fragment when the page is walled", async () => {
    const guest = `<h2 class="topcard__title">ML Engineer</h2><a class="topcard__org-name-link">Acme</a>
      <div class="show-more-less-html__markup">${description}</div>`;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse("<h1>Sign in</h1>", 999))
      .mockResolvedValueOnce(htmlResponse(guest));
    const job = await importJobFromUrl("https://www.linkedin.com/jobs/view/4012345678/", {
      fetch,
      lookup,
    });
    expect(job).toMatchObject({ title: "ML Engineer", company: "Acme" });
    expect(String(fetch.mock.calls[1][0])).toBe(
      "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4012345678",
    );
  });

  it("asks for pasted text when LinkedIn returns nothing usable", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => htmlResponse("<h1>Sign in</h1>", 999));
    await expect(
      importJobFromUrl("https://www.linkedin.com/jobs/view/4012345678/", { fetch, lookup }),
    ).rejects.toMatchObject({
      code: "no_posting",
      message: expect.stringContaining("paste it instead"),
    });
  });

  it("rejects LinkedIn links that aren't job postings without fetching", async () => {
    const fetch = vi.fn();
    await expect(
      importJobFromUrl("https://www.linkedin.com/in/someone/", { fetch, lookup }),
    ).rejects.toMatchObject({ code: "invalid_url" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps missing pages, error statuses, and pages without a posting", async () => {
    const gone = vi.fn<typeof globalThis.fetch>(async () => htmlResponse("", 404));
    await expect(
      importJobFromUrl("https://a.example.com/job", { fetch: gone, lookup }),
    ).rejects.toMatchObject({
      code: "not_found",
    });
    const error = vi.fn<typeof globalThis.fetch>(async () => htmlResponse("", 503));
    await expect(
      importJobFromUrl("https://a.example.com/job", { fetch: error, lookup }),
    ).rejects.toMatchObject({
      code: "fetch_failed",
    });
    const plain = vi.fn<typeof globalThis.fetch>(async () =>
      htmlResponse("<html><body><p>Our careers page</p></body></html>"),
    );
    await expect(
      importJobFromUrl("https://a.example.com/job", { fetch: plain, lookup }),
    ).rejects.toMatchObject({
      code: "no_posting",
    });
    const stub = vi.fn<typeof globalThis.fetch>(async () =>
      htmlResponse(jsonLdPage("<p>Apply now.</p>")),
    );
    await expect(
      importJobFromUrl("https://a.example.com/job", { fetch: stub, lookup }),
    ).rejects.toMatchObject({
      code: "no_posting",
    });
  });
});
