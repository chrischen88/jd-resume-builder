import type { TargetSetRow } from "@/db/schema";

const STYLES = {
  analyzing: ["analyzing…", "bg-accent-soft text-accent"],
  ready: ["analyzed", "text-success"],
  failed: ["failed", "bg-danger-soft text-danger"],
  stale: ["out of date", "bg-warning-soft text-warning"],
  draft: ["not analyzed", "text-muted"],
} as const;

/** A set's analysis state; "out of date" when its JDs changed after analyzing. */
export function StatusBadge({
  status,
  analyzedAt,
}: {
  status: TargetSetRow["status"];
  analyzedAt: Date | null;
}) {
  const key = status === "draft" && analyzedAt ? "stale" : status;
  const [label, style] = STYLES[key];
  return <span className={`rounded px-1.5 py-0.5 text-xs ${style}`}>{label}</span>;
}
