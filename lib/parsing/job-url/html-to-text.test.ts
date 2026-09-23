import { describe, expect, it } from "vitest";

import { htmlToText } from "./html-to-text";

describe("htmlToText", () => {
  it("turns paragraphs, headings, and list items into lines", () => {
    const html = `<h2>About the role</h2><p>You will build   ML
      systems.</p><p><strong>Requirements</strong></p><ul><li>3+ years of <b>Python</b></li><li>SQL &amp; dbt</li><li> </li></ul>`;
    expect(htmlToText(html)).toBe(
      "About the role\n\nYou will build ML systems.\n\nRequirements\n\n- 3+ years of Python\n- SQL & dbt",
    );
  });

  it("keeps <br> line breaks and drops scripts and styles", () => {
    expect(htmlToText("Line one<br>Line two<script>alert(1)</script><style>p{}</style>")).toBe(
      "Line one\nLine two",
    );
  });

  it("unescapes entity-escaped HTML (as some JSON-LD descriptions are)", () => {
    expect(htmlToText("&lt;p&gt;Hello&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Go&lt;/li&gt;&lt;/ul&gt;")).toBe(
      "Hello\n\n- Go",
    );
  });

  it("passes plain text through", () => {
    expect(htmlToText("Just text, no tags.")).toBe("Just text, no tags.");
  });
});
