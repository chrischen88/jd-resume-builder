import type { EvidenceRow } from "@/db/schema";

import type { UserVectorRecord } from "./index";

// Evidence vectors (SPEC "Embeddings"): one per evidence row, id is the row
// id, so a JD requirement can retrieve the user's matching experience.
// Written when evidence is saved (task 1.20); delete with the row.

type EvidenceFields = Pick<
  EvidenceRow,
  "id" | "roleId" | "situation" | "action" | "tools" | "scale" | "result" | "metric"
>;

/** The text embedded for an evidence record, one field per line. */
export function evidenceText(row: EvidenceFields, skillNames: string[] = []): string {
  return [
    row.situation,
    row.action,
    row.tools.length > 0 ? `Tools: ${row.tools.join(", ")}` : null,
    row.scale,
    row.result,
    row.metric,
    skillNames.length > 0 ? `Skills: ${skillNames.join(", ")}` : null,
  ]
    .map((line) => line?.trim())
    .filter(Boolean)
    .join("\n");
}

export function evidenceRecord(row: EvidenceFields, skillNames: string[] = []): UserVectorRecord {
  return {
    id: row.id,
    text: evidenceText(row, skillNames),
    metadata: row.roleId ? { role_id: row.roleId } : {},
  };
}
