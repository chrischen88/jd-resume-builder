import { describe, expect, it } from "vitest";

import { learningPlanMarkdown, type PlanItem } from "./markdown";

const item = (overrides: Partial<PlanItem>): PlanItem => ({
  name: "Kubernetes",
  jdCount: 3,
  jobCount: 4,
  status: "to_learn",
  keywords: ["Kubernetes", "k8s"],
  relatedSkills: ["Docker"],
  meaning: "Running containers in production.",
  resources: [{ kind: "project", description: "Deploy a small app to a local cluster." }],
  ...overrides,
});

describe("learningPlanMarkdown", () => {
  it("writes a checklist grouped by demand, done items checked", () => {
    const md = learningPlanMarkdown([
      item({}),
      item({ name: "Airflow", jdCount: 1, status: "done", resources: [], meaning: null }),
    ]);
    expect(md).toBe(
      [
        "# Learning plan",
        "",
        "## Asked by at least half your target roles",
        "",
        "- [ ] **Kubernetes**, asked by 3 of 4",
        "  - What employers mean: Running containers in production.",
        "  - Job descriptions say: Kubernetes; k8s",
        "  - Related skills: Docker",
        "  - [ ] Project: Deploy a small app to a local cluster.",
        "",
        "## Asked by one",
        "",
        "- [x] **Airflow**, asked by 1 of 4",
        "  - Job descriptions say: Kubernetes; k8s",
        "  - Related skills: Docker",
        "",
      ].join("\n"),
    );
  });

  it("keeps each field on one line with Markdown syntax escaped", () => {
    const md = learningPlanMarkdown([item({ meaning: "Line one\n# not a heading [x](y)" })]);
    expect(md).toContain("  - What employers mean: Line one \\# not a heading \\[x\\](y)");
  });

  it("says when there is nothing to learn", () => {
    expect(learningPlanMarkdown([])).toBe("# Learning plan\n\nNothing to learn yet.\n");
  });
});
