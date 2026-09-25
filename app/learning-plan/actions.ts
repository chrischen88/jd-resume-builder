"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { LEARNING_STATUSES } from "@/db/schema";
import { getLearningPlanStore } from "@/lib/learning-plan";

// Screen 6 (task 1.23): mark a learning item to learn / learning / done.

const statusSchema = z.object({ itemId: z.uuid(), status: z.enum(LEARNING_STATUSES) });

export async function setLearningStatus(formData: FormData): Promise<void> {
  const parsed = statusSchema.safeParse({
    itemId: formData.get("itemId"),
    status: formData.get("status"),
  });
  if (!parsed.success) return;
  await (await getLearningPlanStore()).setStatus(parsed.data.itemId, parsed.data.status);
  revalidatePath("/learning-plan");
}
