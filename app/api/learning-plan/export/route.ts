import type { NextRequest } from "next/server";
import { z } from "zod";

import { getLearningPlanStore, learningPlanMarkdown } from "@/lib/learning-plan";

// GET: the learning plan as a Markdown checklist (Screen 6), optionally for
// one target set (?set=<id>). Read-only.

export async function GET(request: NextRequest) {
  const param = request.nextUrl.searchParams.get("set");
  const set = param === null ? undefined : z.uuid().safeParse(param);
  if (set && !set.success) return Response.json({ error: "Unknown target set." }, { status: 404 });

  const store = await getLearningPlanStore();
  const targetSetId = set?.data;
  const items = await store.list({ targetSetId });
  const setName = targetSetId ? (await store.sets()).find((s) => s.id === targetSetId)?.name : null;
  const markdown = learningPlanMarkdown(
    items,
    setName ? `Learning plan: ${setName}` : "Learning plan",
  );
  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": 'attachment; filename="learning-plan.md"',
      "Cache-Control": "no-store",
    },
  });
}
