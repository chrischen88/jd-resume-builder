import { describe, expect, it } from "vitest";

import { contentTokens, findPhraseOffsets } from "./text";

describe("findPhraseOffsets: ambiguous terms", () => {
  it("only matches capitalized forms of words like Go and Rust", () => {
    expect(findPhraseOffsets("Built services in Go.", "go")).toEqual([18]);
    expect(findPhraseOffsets("Led our go-to-market launch.", "Go")).toEqual([]);
    expect(findPhraseOffsets("Rust-proof coating; wrote Rust.", "rust")).toEqual([0, 26]);
    expect(findPhraseOffsets("rust-proof coating", "Rust")).toEqual([]);
  });

  it("leaves ordinary skills case-insensitive", () => {
    expect(findPhraseOffsets("used PYTHON and python", "Python")).toEqual([5, 16]);
  });
});

describe("contentTokens", () => {
  it("drops stopwords and roughly stems", () => {
    expect(contentTokens("Experience with deploying models")).toEqual(["deploy", "model"]);
    expect(contentTokens("Model deployment")).toEqual(["model", "deploy"]);
    expect(contentTokens("processes and classes")).toEqual(["process", "class"]);
  });

  it("keeps symbols in tech names", () => {
    expect(contentTokens("C++ and C#")).toEqual(["c++", "c#"]);
  });
});
