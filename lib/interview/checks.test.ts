import { describe, expect, it } from "vitest";

import {
  asksForMissingNumber,
  bulletPhrase,
  isCurrentRole,
  keywordsHit,
  quoteFound,
  repeatsQuestion,
  unsupportedNumbers,
} from "./checks";

describe("unsupportedNumbers", () => {
  it("flags numbers the user never gave", () => {
    const answers = ["We ran about 40 tests a quarter", "It cut churn 3%", "2,000 users"];
    const bullet = "Ran 40 A/B tests for 2000 users, cutting churn 3%";
    expect(unsupportedNumbers(bullet, answers)).toEqual([]);
    expect(unsupportedNumbers("Ran 45 tests, lifting revenue 12%", answers)).toEqual(["45", "12"]);
  });
});

describe("quoteFound", () => {
  it("matches case- and space-insensitively, and needs a real quote", () => {
    expect(quoteFound("used  Optimizely", ["We used Optimizely for tests"])).toBe(true);
    expect(quoteFound("used Split.io", ["We used Optimizely for tests"])).toBe(false);
    expect(quoteFound(null, ["anything"])).toBe(false);
    expect(quoteFound("a", ["a b c"])).toBe(false);
  });
});

describe("keywordsHit", () => {
  it("lists skills named by any wording", () => {
    const skills = [
      { name: "A/B testing", terms: ["A/B tests"] },
      { name: "Kubernetes", terms: ["k8s"] },
      { name: "Go", terms: ["Golang"] },
    ];
    expect(keywordsHit("Ran A/B tests on k8s services", skills)).toEqual([
      "A/B testing",
      "Kubernetes",
    ]);
  });
});

describe("bulletPhrase", () => {
  it("uses the most common short JD phrasing, else the name, and respects the cap", () => {
    const phrases = ["designing and running A/B experiments", "A/B tests"];
    expect(bulletPhrase("A/B testing", phrases, "")).toBe("A/B tests");
    expect(bulletPhrase("Kubernetes", [], "")).toBe("Kubernetes");
    expect(bulletPhrase("SQL", ["SQL"], "SQL here. SQL there. SQL everywhere.")).toBeNull();
  });
});

describe("isCurrentRole", () => {
  it.each([
    [null, true],
    ["Present", true],
    ["current", true],
    ["Mar 2023", false],
  ])("%s → %s", (end, current) => {
    expect(isCurrentRole(end)).toBe(current);
  });
});

describe("repeatsQuestion", () => {
  it("catches the same question, reworded slightly", () => {
    const asked = ["How many stakeholders were using the dashboard weekly before the A/B test?"];
    expect(
      repeatsQuestion(
        "How many stakeholders used the dashboard weekly before the A/B test?",
        asked,
      ),
    ).toBe(true);
    expect(repeatsQuestion("Which tool did you run the tests in?", asked)).toBe(false);
  });
});

describe("asksForMissingNumber", () => {
  it("drops a number question after the user said they don't have one", () => {
    const answers = ["Weekly visits went up, but I don't remember the exact number."];
    expect(asksForMissingNumber("How many stakeholders used it weekly?", answers)).toBe(true);
    expect(asksForMissingNumber("Which tool did you use?", answers)).toBe(false);
    expect(asksForMissingNumber("How many tests did you run?", ["About 12"])).toBe(false);
  });
});
