import "server-only";

import { getDb } from "@/db/client";
import { dataDir } from "@/lib/paths";

import { htmlToPdf } from "./pdf";
import { exportResume, type ExportedFile, type ExportFormat } from "./run";

export { EXPORT_FORMATS, ExportError, type ExportFormat } from "./run";

/** Renders the set's resume as DOCX or PDF; throws ExportError("blocked") while claims are unconfirmed. */
export async function exportTargetSetResume(
  targetSetId: string,
  format: ExportFormat,
): Promise<ExportedFile> {
  return exportResume({ db: await getDb(), dataDir: dataDir(), htmlToPdf }, targetSetId, format);
}
