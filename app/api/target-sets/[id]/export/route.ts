import type { NextRequest } from "next/server";
import { z } from "zod";

import { EXPORT_FORMATS, ExportError, exportTargetSetResume } from "@/lib/export";
import { isSameOriginRequest } from "@/lib/http/same-origin";

// POST (form field `format`: docx | pdf): downloads the set's resume (task
// 1.25). A plain form post, so the browser saves the file. When export is
// refused (unconfirmed claims) or fails, redirects back to the review page
// with the reason instead.

const formSchema = z.object({ format: z.enum(EXPORT_FORMATS) });

export async function POST(request: NextRequest, ctx: RouteContext<"/api/target-sets/[id]/export">) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "Cross-site requests aren't allowed." }, { status: 403 });
  }
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) return Response.json({ error: "Unknown target set." }, { status: 404 });
  const form = formSchema.safeParse({ format: (await request.formData()).get("format") });
  if (!form.success) return Response.json({ error: "Pick DOCX or PDF." }, { status: 400 });

  // Relative, so it stays on the host the browser used (request.url reads "localhost").
  const back = (reason: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: `/target-sets/${id.data}/review?export=${reason}` },
    });
  try {
    const file = await exportTargetSetResume(id.data, form.data.format);
    return new Response(new Uint8Array(file.body), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof ExportError) {
      if (err.code === "not_found") return Response.json({ error: err.message }, { status: 404 });
      return back("blocked");
    }
    console.error(
      JSON.stringify({
        event: "export_failed",
        format: form.data.format,
        error: err instanceof Error ? err.name : "unknown",
      }),
    );
    return back("failed");
  }
}
