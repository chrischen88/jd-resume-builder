import { describe, expect, it } from "vitest";

import { linkedInJobId, parseLinkedInGuest } from "./linkedin";

describe("linkedInJobId", () => {
  it.each([
    ["https://www.linkedin.com/jobs/view/4012345678/", "4012345678"],
    ["https://www.linkedin.com/jobs/view/4012345678", "4012345678"],
    ["https://linkedin.com/jobs/view/senior-ml-engineer-at-acme-4012345678/?trk=x", "4012345678"],
    ["https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=ml", "4012345678"],
    [
      "https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4012345678",
      "4012345678",
    ],
  ])("%s → %s", (url, id) => {
    expect(linkedInJobId(new URL(url))).toBe(id);
  });

  it.each([
    "https://www.linkedin.com/in/someone/",
    "https://www.linkedin.com/jobs/search/?keywords=ml",
    "https://www.linkedin.com.evil.example/jobs/view/4012345678/",
    "https://example.com/jobs/view/4012345678/",
  ])("%s → null", (url) => {
    expect(linkedInJobId(new URL(url))).toBeNull();
  });
});

describe("parseLinkedInGuest", () => {
  it("reads title, company, and the description markup", () => {
    const html = `<section><h2 class="topcard__title">ML Engineer</h2>
      <a class="topcard__org-name-link">Acme</a>
      <div class="show-more-less-html__markup"><p>Build models.</p><ul><li>Python</li></ul></div></section>`;
    expect(parseLinkedInGuest(html)).toEqual({
      title: "ML Engineer",
      company: "Acme",
      descriptionHtml: "<p>Build models.</p><ul><li>Python</li></ul>",
    });
  });

  it("drops LinkedIn's __PRESENT template markers", () => {
    const html = `<div class="show-more-less-html__markup"><p>Pay: $175,000.</p><br><br>__PRESENT<br><br>__PRESENT__PRESENT</div>`;
    expect(parseLinkedInGuest(html)?.descriptionHtml).toBe("<p>Pay: $175,000.</p><br><br><br><br>");
  });

  it("returns null for a sign-in wall", () => {
    expect(
      parseLinkedInGuest("<html><body><h1>Sign in to view more jobs</h1></body></html>"),
    ).toBeNull();
  });
});
