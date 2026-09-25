import type { NextRequest } from "next/server";
import { z } from "zod";

import { AiOutputError } from "@/lib/ai/client";
import { isSameOriginRequest } from "@/lib/http/same-origin";
import { InterviewError, runInterviewStep, type StepEvent } from "@/lib/interview";

// Runs the model step a gap is waiting on (next follow-up question, or the
// bullet drafts and their claim check) and streams progress as server-sent
// events: `status`, then `question` or `draft`, or `error`. POST because it
// writes; the page reads the stream with fetch.

const bodySchema = z.object({
  demandId: z.uuid(),
  regenerate: z.boolean().default(false),
});

function errorMessage(err: unknown): string {
  if (err instanceof InterviewError) return err.message;
  if (err instanceof AiOutputError) {
    return `The model returned unusable output (${err.reason}). Try again.`;
  }
  return "The model call failed. Check your API key and connection, then try again.";
}

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/target-sets/[id]/interview/step">,
) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "Cross-site requests aren't allowed." }, { status: 403 });
  }
  const id = z.uuid().safeParse((await ctx.params).id);
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !body.success) {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: StepEvent | { type: "error"; message: string } | { type: "end" }) =>
        controller.enqueue(
          encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
        );
      try {
        await runInterviewStep(id.data, body.data.demandId, send, {
          regenerate: body.data.regenerate,
        });
      } catch (err) {
        // Error name and prompt only; never answers or bullet text.
        console.error("Interview step failed", {
          error: err instanceof Error ? err.name : "unknown",
          promptId: err instanceof AiOutputError ? err.promptId : undefined,
        });
        send({ type: "error", message: errorMessage(err) });
      }
      send({ type: "end" });
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
