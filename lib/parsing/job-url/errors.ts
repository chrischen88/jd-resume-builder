export type JobUrlErrorCode =
  "invalid_url" | "blocked_address" | "fetch_failed" | "not_found" | "no_posting" | "too_large";

/** A job URL that couldn't be imported; `message` is safe to show the user. */
export class JobUrlError extends Error {
  constructor(
    message: string,
    readonly code: JobUrlErrorCode,
  ) {
    super(message);
    this.name = "JobUrlError";
  }
}
