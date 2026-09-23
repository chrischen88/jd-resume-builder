import { AIMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";

import type { RewordCandidate } from "@/lib/analysis/reword";

import type { AiGuardrailLog } from "./client";
import type { StructuredChat } from "./models";
import { rewordBulletsSchema } from "./prompts/reword-bullets";
import { rewordBullets } from "./reword-bullets";

function chatReturning(output: unknown) {
  const invoke = vi.fn<StructuredChat["invoke"]>().mockResolvedValue(
    new AIMessage({
      content: JSON.stringify(output),
      response_metadata: { stop_reason: "end_turn" },
      usage_metadata: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    }),
  );
  const chat: StructuredChat = { config: { provider: "anthropic", model: "test" }, invoke };
  return { chat, invoke };
}

const candidate = (bulletText: string, phrase: string): RewordCandidate => ({
  skillId: phrase,
  skillName: phrase,
  bulletId: bulletText,
  bulletText,
  phrase,
  terms: [phrase],
});

const candidates = [
  {
    ...candidate("Built k8s deploy tooling for 12 services", "Kubernetes"),
    terms: ["Kubernetes", "k8s"],
  },
  candidate("Queried and analyzed complex datasets", "analytical skills"),
  candidate("Wrote the team style guide", "technical writing"),
  candidate("Mentored two engineers", "mentoring"),
];

describe("rewordBullets", () => {
  it("keeps suggestions that pass the check and logs counts only", async () => {
    const { chat, invoke } = chatReturning({
      items: [
        { id: "b1", suggestion: "Built Kubernetes deploy tooling for 12 services" },
        // Adds a number: dropped.
        { id: "b2", suggestion: "Applied analytical skills to 40 complex datasets" },
        { id: "b3", suggestion: null },
        { id: "b4", suggestion: "Mentored two engineers through mentoring and AWS" },
      ],
    });
    const logs: AiGuardrailLog[] = [];

    const result = await rewordBullets(candidates, {
      chat,
      logger: () => {},
      guardrailLogger: (e) => logs.push(e),
    });

    expect(result.rewordings).toEqual([
      { ...candidates[0], suggestion: "Built Kubernetes deploy tooling for 12 services" },
    ]);
    expect(logs[0].counts).toEqual({
      candidates: 4,
      kept: 1,
      declined: 1,
      dropped_new_number: 1,
      dropped_new_name: 1,
    });
    expect(JSON.stringify(logs)).not.toContain("k8s");
    // Every item is sent, each with its phrase.
    const user = invoke.mock.calls[0][0].messages[0].content;
    expect(user).toContain('<item id="b4">');
    expect(user).toContain("<phrase>technical writing</phrase>");
  });

  it("doesn't call the model without candidates", async () => {
    const { chat, invoke } = chatReturning({ items: [] });
    expect((await rewordBullets([], { chat })).rewordings).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("uses a schema that works with strict providers (no optional fields)", () => {
    const json = JSON.stringify(rewordBulletsSchema.toJSONSchema());
    expect(json).not.toContain('"optional"');
  });
});
