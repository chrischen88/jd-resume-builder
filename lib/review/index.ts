import "server-only";

import { getDb } from "@/db/client";

import { createReviewStore, type ReviewStore } from "./store";

export { ReviewError } from "./store";

export async function getReviewStore(): Promise<ReviewStore> {
  return createReviewStore({ db: await getDb() });
}
