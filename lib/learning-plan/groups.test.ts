import { describe, expect, it } from "vitest";

import { demandGroup, groupByDemand } from "./groups";

describe("demandGroup", () => {
  it("uses the gap list's must-do line: asked by at least half the set", () => {
    expect(demandGroup({ name: "a", jdCount: 5, jobCount: 10 })).toBe("must_do");
    expect(demandGroup({ name: "a", jdCount: 4, jobCount: 10 })).toBe("several");
    expect(demandGroup({ name: "a", jdCount: 1, jobCount: 10 })).toBe("one");
    expect(demandGroup({ name: "a", jdCount: 1, jobCount: 2 })).toBe("must_do");
  });

  it("falls back to the count when the set is gone", () => {
    expect(demandGroup({ name: "a", jdCount: 3, jobCount: null })).toBe("several");
    expect(demandGroup({ name: "a", jdCount: 1, jobCount: null })).toBe("one");
  });
});

describe("groupByDemand", () => {
  it("orders groups and items by demand, then name, and drops empty groups", () => {
    const groups = groupByDemand([
      { name: "Go", jdCount: 1, jobCount: 6 },
      { name: "Terraform", jdCount: 3, jobCount: 6 },
      { name: "Airflow", jdCount: 1, jobCount: 6 },
      { name: "Kubernetes", jdCount: 4, jobCount: 6 },
    ]);
    expect(groups.map((g) => [g.group, g.items.map((i) => i.name)])).toEqual([
      ["must_do", ["Kubernetes", "Terraform"]],
      ["one", ["Airflow", "Go"]],
    ]);
  });
});
