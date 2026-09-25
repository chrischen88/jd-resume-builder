// Screen 6 (task 1.23): learning items grouped by how many target roles ask
// for the skill. Same "must-do" line as the gap list: asked by at least half
// the set's JDs.

export type DemandGroup = "must_do" | "several" | "one";

export const DEMAND_GROUP_LABELS: Record<DemandGroup, string> = {
  must_do: "Asked by at least half your target roles",
  several: "Asked by several",
  one: "Asked by one",
};

const GROUP_ORDER: DemandGroup[] = ["must_do", "several", "one"];

export interface Groupable {
  name: string;
  jdCount: number;
  /** JDs in the item's target set; null when the set was deleted. */
  jobCount: number | null;
}

export function demandGroup({ jdCount, jobCount }: Groupable): DemandGroup {
  if (jobCount && jdCount * 2 >= jobCount) return "must_do";
  return jdCount > 1 ? "several" : "one";
}

/** Non-empty groups, most asked-for first; within a group by JD count, then name. */
export function groupByDemand<T extends Groupable>(
  items: T[],
): { group: DemandGroup; items: T[] }[] {
  const sorted = [...items].sort(
    (a, b) => b.jdCount - a.jdCount || a.name.localeCompare(b.name),
  );
  return GROUP_ORDER.map((group) => ({
    group,
    items: sorted.filter((item) => demandGroup(item) === group),
  })).filter((g) => g.items.length > 0);
}
