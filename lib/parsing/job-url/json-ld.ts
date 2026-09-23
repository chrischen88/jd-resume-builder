import { parse } from "node-html-parser";

// schema.org JobPosting from a page's JSON-LD, which most career sites embed
// for search engines (Greenhouse, Lever, Ashby, LinkedIn public pages, …).

export interface JobPostingData {
  title: string | null;
  company: string | null;
  /** HTML (sometimes entity-escaped) or plain text. */
  descriptionHtml: string;
}

type Json = Record<string, unknown>;

function isJobPosting(value: Json): boolean {
  const type = value["@type"];
  return Array.isArray(type) ? type.includes("JobPosting") : type === "JobPosting";
}

/** Every object in a JSON-LD value: top level, arrays, and @graph. */
function* candidates(value: unknown): Generator<Json> {
  if (Array.isArray(value)) {
    for (const item of value) yield* candidates(item);
  } else if (value && typeof value === "object") {
    yield value as Json;
    const graph = (value as Json)["@graph"];
    if (graph) yield* candidates(graph);
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function findJobPosting(html: string): JobPostingData | null {
  const scripts = parse(html).querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    let data: unknown;
    try {
      data = JSON.parse(script.text);
    } catch {
      continue;
    }
    for (const item of candidates(data)) {
      if (!isJobPosting(item)) continue;
      const description = text(item.description);
      if (!description) continue;
      const org = item.hiringOrganization;
      return {
        title: text(item.title),
        company: typeof org === "string" ? text(org) : text((org as Json | undefined)?.name),
        descriptionHtml: description,
      };
    }
  }
  return null;
}
