import { DEMAND_GROUP_LABELS, groupByDemand, type Groupable } from "./groups";

// The learning plan as a Markdown checklist (Screen 6 export). Done items are
// checked. Only what the plan already holds: no links, no course names.

export interface PlanItem extends Groupable {
  status: "to_learn" | "learning" | "done";
  keywords: string[];
  relatedSkills: string[];
  meaning: string | null;
  resources: { kind: string; description: string }[];
}

/** Display names for the learning_plan prompt's resource kinds. */
export const RESOURCE_KIND_LABELS: Record<string, string> = {
  course: "Course",
  certification: "Certification",
  project: "Project",
  on_the_job: "On the job",
};

export const resourceKindLabel = (kind: string) => RESOURCE_KIND_LABELS[kind] ?? kind;

const STATUS_NOTE = { to_learn: "", learning: " (learning)", done: "" };

/** One line of plain text: Markdown syntax in model or JD text can't restructure the list. */
function inline(text: string): string {
  return text.replace(/\s+/g, " ").replace(/([\\`*_[\]<>#|])/g, "\\$1").trim();
}

function asked({ jdCount, jobCount }: Groupable): string {
  return jobCount ? `asked by ${jdCount} of ${jobCount}` : `asked by ${jdCount}`;
}

export function learningPlanMarkdown(items: PlanItem[], title = "Learning plan"): string {
  const lines = [`# ${inline(title)}`, ""];
  if (items.length === 0) lines.push("Nothing to learn yet.", "");
  for (const { group, items: groupItems } of groupByDemand(items)) {
    lines.push(`## ${DEMAND_GROUP_LABELS[group]}`, "");
    for (const item of groupItems) {
      const box = item.status === "done" ? "[x]" : "[ ]";
      lines.push(`- ${box} **${inline(item.name)}**${STATUS_NOTE[item.status]}, ${asked(item)}`);
      if (item.meaning) lines.push(`  - What employers mean: ${inline(item.meaning)}`);
      if (item.keywords.length > 0) {
        lines.push(`  - Job descriptions say: ${item.keywords.map(inline).join("; ")}`);
      }
      if (item.relatedSkills.length > 0) {
        lines.push(`  - Related skills: ${item.relatedSkills.map(inline).join(", ")}`);
      }
      for (const r of item.resources) {
        lines.push(`  - [ ] ${inline(resourceKindLabel(r.kind))}: ${inline(r.description)}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}
