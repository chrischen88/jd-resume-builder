import type { NextRequest } from "next/server";
import { z } from "zod";

import { getTargetSetStore, scoreTargetSet } from "@/lib/target-sets";

// GET: coverage score before/after the interview (SPEC F17, task 1.24).

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/target-sets/[id]/score">) {
  const id = z.uuid().safeParse((await ctx.params).id);
  const set = id.success ? await (await getTargetSetStore()).get(id.data) : undefined;
  if (!set) return Response.json({ error: "Unknown target set." }, { status: 404 });
  const score = await scoreTargetSet(set.id, set.resumeId);
  return Response.json({ targetSetId: set.id, ...score });
}
