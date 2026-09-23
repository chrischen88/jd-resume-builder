import "server-only";

import { getDb } from "@/db/client";

import { createTargetSetStore, type TargetSetStore } from "./store";

export { MAX_JOBS, MIN_JOBS, TargetSetError } from "./store";
export type { AddJobsResult, JobWithDocument, TargetSetDetail, TargetSetSummary } from "./store";

export async function getTargetSetStore(): Promise<TargetSetStore> {
  return createTargetSetStore({ db: await getDb() });
}
