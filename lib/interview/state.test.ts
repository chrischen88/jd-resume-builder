import { describe, expect, it } from "vitest";

import { gapStage, MAX_FOLLOW_UPS, nextGap } from "./state";

const base = {
  response: "yes" as const,
  followUps: [],
  roleId: "r1",
  draft: null,
  completedAt: null,
};
const answered = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ question: `Q${i}`, answer: `A${i}` }));

describe("gapStage", () => {
  it("walks ask → role → questions → draft → done", () => {
    expect(gapStage(undefined)).toBe("ask");
    expect(gapStage({ ...base, roleId: null })).toBe("role");
    expect(gapStage(base)).toBe("needs_question");
    expect(gapStage({ ...base, followUps: [{ question: "Q", answer: null }] })).toBe("follow_up");
    expect(gapStage({ ...base, followUps: answered(2) })).toBe("needs_question");
    expect(gapStage({ ...base, followUps: answered(MAX_FOLLOW_UPS) })).toBe("needs_draft");
    const evidence = {
      situation: null,
      action: "a",
      tools: [],
      scale: null,
      result: null,
      metric: null,
    };
    const draft = { variants: [], evidence, promptVersion: "1" };
    expect(gapStage({ ...base, followUps: answered(2), draft })).toBe("draft");
    expect(gapStage({ ...base, completedAt: new Date() })).toBe("done");
  });

  it("finishes a No right away and counts a skipped question as answered", () => {
    expect(gapStage({ ...base, response: "no", roleId: null })).toBe("done");
    expect(gapStage({ ...base, followUps: [...answered(3), { question: "Q", answer: "" }] })).toBe(
      "needs_draft",
    );
  });
});

describe("nextGap", () => {
  it("returns the first unfinished gap in order", () => {
    const gaps = [{ demandId: "a" }, { demandId: "b" }, { demandId: "c" }];
    const stages: Record<string, ReturnType<typeof gapStage>> = { a: "done", b: "role", c: "ask" };
    expect(nextGap(gaps, (g) => stages[g.demandId])?.demandId).toBe("b");
    expect(nextGap(gaps, () => "done")).toBeUndefined();
  });
});
