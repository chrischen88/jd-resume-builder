import "server-only";

import { JobUrlError } from "./errors";
import { htmlToText } from "./html-to-text";
import { findJobPosting, type JobPostingData } from "./json-ld";
import {
  isLinkedInHost,
  linkedInGuestUrl,
  linkedInJobId,
  linkedInJobUrl,
  parseLinkedInGuest,
} from "./linkedin";
import { safeFetch, type FetchDeps } from "./safe-fetch";

export { JobUrlError } from "./errors";
export type { JobUrlErrorCode } from "./errors";

export interface ImportedJob {
  title: string | null;
  company: string | null;
  text: string;
  /** Canonical link to the posting, for duplicate checks and "open original". */
  sourceUrl: string;
}

/** Fewer words than this means we got a stub, not a job description. */
const MIN_WORDS = 50;

const PASTE_INSTEAD = "Open the posting, copy the description, and paste it instead.";

async function fromLinkedIn(url: URL, deps: FetchDeps): Promise<[JobPostingData | null, string]> {
  const id = linkedInJobId(url);
  if (!id) {
    throw new JobUrlError(
      "That LinkedIn link isn't a job posting. Use a link like linkedin.com/jobs/view/1234567890.",
      "invalid_url",
    );
  }
  const sourceUrl = linkedInJobUrl(id);
  const page = await safeFetch(sourceUrl, deps);
  const fromPage = page.status === 200 ? findJobPosting(page.html) : null;
  if (fromPage) return [fromPage, sourceUrl];

  // Sign-in wall or LinkedIn's 999 block: try the public guest fragment.
  const guest = await safeFetch(linkedInGuestUrl(id), deps);
  if (guest.status === 404 || guest.status === 410) {
    throw new JobUrlError("LinkedIn says this job no longer exists.", "not_found");
  }
  return [guest.status === 200 ? parseLinkedInGuest(guest.html) : null, sourceUrl];
}

async function fromJobSite(url: URL, deps: FetchDeps): Promise<[JobPostingData | null, string]> {
  const page = await safeFetch(url.toString(), deps);
  if (page.status === 404 || page.status === 410) {
    throw new JobUrlError("That page doesn't exist anymore. The job may be closed.", "not_found");
  }
  if (page.status !== 200) {
    throw new JobUrlError(
      `The site answered with an error (${page.status}). ${PASTE_INSTEAD}`,
      "fetch_failed",
    );
  }
  const final = new URL(page.url);
  final.hash = "";
  return [findJobPosting(page.html), final.toString()];
}

/**
 * Fetches a job posting and returns its description as plain text (SPEC F3,
 * best effort). LinkedIn links get LinkedIn-specific handling; other sites
 * must publish schema.org JobPosting data. Throws JobUrlError with a message
 * that tells the user to paste the text when a page can't be read.
 */
export async function importJobFromUrl(rawUrl: string, deps: FetchDeps = {}): Promise<ImportedJob> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new JobUrlError("That isn't a valid URL.", "invalid_url");
  }

  const linkedIn = isLinkedInHost(url.hostname);
  const [posting, sourceUrl] = linkedIn
    ? await fromLinkedIn(url, deps)
    : await fromJobSite(url, deps);
  const text = posting ? htmlToText(posting.descriptionHtml) : "";
  if (text.split(/\s+/).filter(Boolean).length < MIN_WORDS) {
    throw new JobUrlError(
      linkedIn
        ? `LinkedIn didn't return this posting (it may need sign-in). ${PASTE_INSTEAD}`
        : `Couldn't find a job description on that page. ${PASTE_INSTEAD}`,
      "no_posting",
    );
  }
  return { title: posting!.title, company: posting!.company, text, sourceUrl };
}
