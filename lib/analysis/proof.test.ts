import { describe, expect, it } from "vitest";

import { selectProofBullets } from "./proof";

describe("selectProofBullets", () => {
  const bullets = [
    { id: "b1", text: "Wrote SQL reports" },
    { id: "b2", text: "Led a SQL migration, cutting query time 80%" },
    { id: "b3", text: "Built Kubernetes deploys" },
    { id: "b4", text: "Built k8s tooling" },
  ];
  const strength: Record<string, number> = { b1: 0.5, b2: 3.5, b3: 1, b4: 1 };

  it("picks the strongest bullet naming each covered skill", () => {
    const proofs = selectProofBullets(
      [
        { key: "sql", coverage: "covered", terms: ["SQL"] },
        // Tie: the earlier bullet wins.
        { key: "kubernetes", coverage: "covered", terms: ["Kubernetes", "k8s"] },
      ],
      bullets,
      (b) => strength[b.id],
    );
    expect(proofs.get("sql")?.id).toBe("b2");
    expect(proofs.get("kubernetes")?.id).toBe("b3");
  });

  it("skips skills that aren't covered or that no bullet names", () => {
    const proofs = selectProofBullets(
      [
        { key: "tableau", coverage: "covered", terms: ["Tableau"] },
        { key: "sql", coverage: "weak", terms: ["SQL"] },
      ],
      bullets,
      (b) => strength[b.id],
    );
    expect(proofs.size).toBe(0);
  });
});
