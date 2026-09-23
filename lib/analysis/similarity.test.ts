import { describe, expect, it } from "vitest";

import { cosineSimilarity } from "./similarity";

describe("cosineSimilarity", () => {
  it("is 1 for the same direction, 0 for orthogonal, -1 for opposite", () => {
    expect(cosineSimilarity([1, 2], [2, 4])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 3])).toBe(0);
    expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1);
  });

  it("returns 0 for a zero vector and rejects mismatched lengths", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(() => cosineSimilarity([1], [1, 2])).toThrow(/length/);
  });
});
