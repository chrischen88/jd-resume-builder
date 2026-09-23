import { after, type NextRequest } from "next/server";
import { z } from "zod";

import { isSameOriginRequest } from "@/lib/http/same-origin";
import { getAnalysisRunner, TargetSetError } from "@/lib/target-sets";

// POST starts analyzing a target set (extract → merge → score → coverage) in
// the background and returns 202; GET reports status and progress to poll.

const idSchema = z.uuid();

const ERROR_STATUS: Record<TargetSetError["code"], number> = {
  not_found: 404,
  too_few: 422,
  busy: 409,
  not_jd: 422,
  too_many: 422,
};

async function parseId(ctx: RouteContext<"/api/target-sets/[id]/analyze">) {
  const parsed = idSchema.safeParse((await ctx.params).id);
  return parsed.success ? parsed.data : null;
}

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/target-sets/[id]/analyze">,
) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "Cross-site requests aren't allowed." }, { status: 403 });
  }
  const id = await parseId(ctx);
  if (!id) return Response.json({ error: "Unknown target set." }, { status: 404 });

  const runner = await getAnalysisRunner();
  try {
    const { done } = await runner.start(id);
    after(() => done);
  } catch (err) {
    if (err instanceof TargetSetError) {
      return Response.json({ error: err.message }, { status: ERROR_STATUS[err.code] });
    }
    throw err;
  }
  return Response.json(
    { targetSetId: id, ...(await runner.status(id)) },
    { status: 202, headers: { Location: `/api/target-sets/${id}/analyze` } },
  );
}

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/target-sets/[id]/analyze">) {
  const id = await parseId(ctx);
  const status = id ? await (await getAnalysisRunner()).status(id) : undefined;
  if (!id || !status) return Response.json({ error: "Unknown target set." }, { status: 404 });
  return Response.json({ targetSetId: id, ...status });
}
