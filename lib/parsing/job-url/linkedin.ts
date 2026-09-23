import { parse } from "node-html-parser";

import type { JobPostingData } from "./json-ld";

// LinkedIn job URLs. Public job pages usually carry JSON-LD; when LinkedIn
// shows a sign-in wall instead, its public "guest" job fragment often still
// has the description.

export function isLinkedInHost(hostname: string): boolean {
  return hostname === "linkedin.com" || hostname.endsWith(".linkedin.com");
}

/**
 * The numeric job id from a LinkedIn job URL: /jobs/view/<id>,
 * /jobs/view/<slug>-<id>, or any LinkedIn page with ?currentJobId=<id>
 * (search results, collections). Null if there isn't one.
 */
export function linkedInJobId(url: URL): string | null {
  if (!isLinkedInHost(url.hostname)) return null;
  const current = url.searchParams.get("currentJobId");
  if (current && /^\d{6,}$/.test(current)) return current;
  const view = url.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})\/?$/);
  return view ? view[1] : null;
}

export const linkedInJobUrl = (id: string) => `https://www.linkedin.com/jobs/view/${id}/`;
export const linkedInGuestUrl = (id: string) =>
  `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`;

/** Parses LinkedIn's public guest job fragment. */
export function parseLinkedInGuest(html: string): JobPostingData | null {
  const root = parse(html);
  const description = root.querySelector(".show-more-less-html__markup, .description__text");
  if (!description || !description.text.trim()) return null;
  const text = (selector: string) => root.querySelector(selector)?.text.trim() || null;
  return {
    title: text(".topcard__title, .top-card-layout__title"),
    company: text(".topcard__org-name-link, .topcard__flavor"),
    // LinkedIn's template leaves "__PRESENT" markers as literal text.
    descriptionHtml: description.innerHTML.replace(/(?:__PRESENT)+/g, ""),
  };
}
