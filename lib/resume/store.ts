import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, max } from "drizzle-orm";

import type { Db } from "@/db/client";
import {
  bullets,
  resumes,
  roles,
  type BulletRow,
  type DocumentRow,
  type ResumeRow,
  type RoleRow,
} from "@/db/schema";

import type { ParsedResume } from "./ground";

export type RoleFields = Pick<RoleRow, "employer" | "title" | "location" | "startDate" | "endDate">;

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Sets a role's original bullets to `lines`, keeping bullet ids stable: an
 * unchanged line keeps its id wherever it moved, an edited line reuses a
 * leftover id in order, extra lines are inserted, and leftovers are deleted.
 * Generated bullets are left alone.
 */
async function replaceOriginalBullets(tx: Tx, roleId: string, lines: string[]) {
  const existing = await tx.query.bullets.findMany({
    where: and(eq(bullets.roleId, roleId), eq(bullets.source, "original")),
    orderBy: asc(bullets.position),
  });
  const leftover = [...existing];
  const plan = lines.map((text) => {
    const same = leftover.findIndex((b) => b.text === text);
    return { text, id: same >= 0 ? leftover.splice(same, 1)[0].id : null };
  });
  for (const item of plan) if (!item.id && leftover.length > 0) item.id = leftover.shift()!.id;

  for (const [position, item] of plan.entries()) {
    if (item.id) {
      await tx.update(bullets).set({ text: item.text, position }).where(eq(bullets.id, item.id));
    } else {
      await tx.insert(bullets).values({
        id: randomUUID(),
        roleId,
        position,
        text: item.text,
        source: "original",
        status: "accepted",
      });
    }
  }
  if (leftover.length > 0) {
    await tx.delete(bullets).where(
      inArray(
        bullets.id,
        leftover.map((b) => b.id),
      ),
    );
  }
}

export interface RoleWithBullets extends RoleRow {
  bullets: BulletRow[];
}

export interface ResumeDetail extends ResumeRow {
  roles: RoleWithBullets[];
}

/** Resumes as structured rows: sections on the resume, roles and bullets in their own tables. */
export function createResumeStore({ db }: { db: Db }) {
  return {
    /**
     * Saves a parsed resume in one transaction. Its bullets are stored as
     * original, accepted bullets. The first resume becomes the master.
     */
    async create(
      document: Pick<DocumentRow, "id" | "title">,
      parsed: ParsedResume,
    ): Promise<string> {
      const resumeId = randomUUID();
      await db.transaction(async (tx) => {
        const master = await tx.query.resumes.findFirst({ where: eq(resumes.isMaster, true) });
        await tx.insert(resumes).values({
          id: resumeId,
          documentId: document.id,
          title: document.title,
          sections: parsed.sections,
          isMaster: !master,
        });
        for (const [position, role] of parsed.roles.entries()) {
          const roleId = randomUUID();
          await tx.insert(roles).values({
            id: roleId,
            resumeId,
            position,
            employer: role.employer,
            title: role.title,
            location: role.location,
            startDate: role.startDate,
            endDate: role.endDate,
          });
          if (role.bullets.length > 0) {
            await tx.insert(bullets).values(
              role.bullets.map((text, i) => ({
                id: randomUUID(),
                roleId,
                position: i,
                text,
                source: "original" as const,
                status: "accepted" as const,
              })),
            );
          }
        }
      });
      return resumeId;
    },

    async get(id: string): Promise<ResumeDetail | undefined> {
      const resume = await db.query.resumes.findFirst({ where: eq(resumes.id, id) });
      if (!resume) return undefined;
      const roleRows = await db.query.roles.findMany({
        where: eq(roles.resumeId, id),
        orderBy: asc(roles.position),
      });
      const bulletRows =
        roleRows.length === 0
          ? []
          : await db.query.bullets.findMany({
              where: inArray(
                bullets.roleId,
                roleRows.map((r) => r.id),
              ),
              orderBy: asc(bullets.position),
            });
      return {
        ...resume,
        roles: roleRows.map((role) => ({
          ...role,
          bullets: bulletRows.filter((b) => b.roleId === role.id),
        })),
      };
    },

    list(): Promise<ResumeRow[]> {
      return db.query.resumes.findMany({ orderBy: desc(resumes.createdAt) });
    },

    /** Resumes already imported from a library document, newest first. */
    findByDocument(documentId: string): Promise<ResumeRow[]> {
      return db.query.resumes.findMany({
        where: eq(resumes.documentId, documentId),
        orderBy: desc(resumes.createdAt),
      });
    },

    /** Updates a role and its original bullets. Returns the resume id, or null if the role is gone. */
    async updateRole(
      roleId: string,
      fields: RoleFields,
      bulletLines: string[],
    ): Promise<string | null> {
      return db.transaction(async (tx) => {
        const [role] = await tx.update(roles).set(fields).where(eq(roles.id, roleId)).returning();
        if (!role) return null;
        await replaceOriginalBullets(tx, roleId, bulletLines);
        return role.resumeId;
      });
    },

    /** Adds a role at the end of the resume. Returns its id. */
    async addRole(resumeId: string, fields: RoleFields, bulletLines: string[]): Promise<string> {
      return db.transaction(async (tx) => {
        const [{ last }] = await tx
          .select({ last: max(roles.position) })
          .from(roles)
          .where(eq(roles.resumeId, resumeId));
        const roleId = randomUUID();
        await tx
          .insert(roles)
          .values({ id: roleId, resumeId, position: (last ?? -1) + 1, ...fields });
        await replaceOriginalBullets(tx, roleId, bulletLines);
        return roleId;
      });
    },

    /** Deletes a role and its bullets. Returns the resume id, or null if the role is gone. */
    async removeRole(roleId: string): Promise<string | null> {
      const [row] = await db.delete(roles).where(eq(roles.id, roleId)).returning();
      return row?.resumeId ?? null;
    },

    /** Marks the parsed roles as checked by the user. */
    async confirm(resumeId: string): Promise<boolean> {
      const [row] = await db
        .update(resumes)
        .set({ confirmedAt: new Date() })
        .where(eq(resumes.id, resumeId))
        .returning();
      return !!row;
    },

    async remove(id: string): Promise<boolean> {
      const [row] = await db.delete(resumes).where(eq(resumes.id, id)).returning();
      return !!row;
    },
  };
}

export type ResumeStore = ReturnType<typeof createResumeStore>;
