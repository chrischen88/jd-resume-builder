import { describe, expect, it } from "vitest";

import { findJobPosting } from "./json-ld";

const page = (...blocks: string[]) =>
  `<html><head>${blocks.map((b) => `<script type="application/ld+json">${b}</script>`).join("")}</head><body></body></html>`;

const posting = {
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: "ML Engineer",
  hiringOrganization: { "@type": "Organization", name: "Acme" },
  description: "<p>Build models.</p>",
};

describe("findJobPosting", () => {
  it("reads a top-level JobPosting", () => {
    expect(findJobPosting(page(JSON.stringify(posting)))).toEqual({
      title: "ML Engineer",
      company: "Acme",
      descriptionHtml: "<p>Build models.</p>",
    });
  });

  it("finds a JobPosting inside @graph or an array, skipping other types and bad JSON", () => {
    const graph = JSON.stringify({ "@graph": [{ "@type": "WebPage" }, posting] });
    const array = JSON.stringify([{ "@type": "Organization" }, { ...posting, title: "B" }]);
    expect(findJobPosting(page("{not json", graph))?.title).toBe("ML Engineer");
    expect(findJobPosting(page(array))?.title).toBe("B");
  });

  it("accepts a string organization and a @type list", () => {
    const item = { ...posting, "@type": ["JobPosting"], hiringOrganization: "Acme Inc" };
    expect(findJobPosting(page(JSON.stringify(item)))?.company).toBe("Acme Inc");
  });

  it("returns null without a JobPosting that has a description", () => {
    expect(findJobPosting("<html><body>No data</body></html>")).toBeNull();
    expect(findJobPosting(page(JSON.stringify({ ...posting, description: " " })))).toBeNull();
  });
});
