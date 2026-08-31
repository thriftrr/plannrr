import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm'

// Queries over the NuxtHub drizzle client (`db` and `schema` are
// auto-imported server globals provided by @nuxthub/core).

export interface DbUser {
  id: string
  email: string
  patCipher: string | null
}

export interface ImportedPlanRow {
  id: string
  userId: string
  name: string
  monthCount: number
  createdAt: string
}

export async function ensureUser (email: string): Promise<DbUser> {
  const existing = await db.select().from(schema.users).where(eq(schema.users.email, email)).get()
  if (existing) return existing
  const id = crypto.randomUUID()
  await db.insert(schema.users).values({ id, email }).run()
  return { id, email, patCipher: null }
}

export async function getUserById (id: string): Promise<DbUser | null> {
  return await db.select().from(schema.users).where(eq(schema.users.id, id)).get() ?? null
}

export async function setUserPat (id: string, patCipher: string | null): Promise<void> {
  await db.update(schema.users).set({ patCipher }).where(eq(schema.users.id, id)).run()
}

export async function insertLoginToken (tokenHash: string, email: string, expiresAt: string): Promise<void> {
  await db.insert(schema.loginTokens).values({ tokenHash, email, expiresAt }).run()
}

// Marks the token used and returns its email in one statement, so a token
// can never be spent twice.
export async function spendLoginToken (tokenHash: string): Promise<string | null> {
  const rows = await db.update(schema.loginTokens)
    .set({ usedAt: sql`datetime('now')` })
    .where(and(
      eq(schema.loginTokens.tokenHash, tokenHash),
      isNull(schema.loginTokens.usedAt),
      gt(schema.loginTokens.expiresAt, sql`datetime('now')`)
    ))
    .returning({ email: schema.loginTokens.email })
  return rows[0]?.email ?? null
}

export async function listImportedPlans (userId: string): Promise<ImportedPlanRow[]> {
  return await db.select().from(schema.importedPlans)
    .where(eq(schema.importedPlans.userId, userId))
    .orderBy(desc(schema.importedPlans.createdAt))
    .all()
}

export async function insertImportedPlan (row: { id: string, userId: string, name: string, monthCount: number }): Promise<void> {
  await db.insert(schema.importedPlans).values(row).run()
}

export async function deleteImportedPlan (userId: string, id: string): Promise<boolean> {
  const rows = await db.delete(schema.importedPlans)
    .where(and(eq(schema.importedPlans.id, id), eq(schema.importedPlans.userId, userId)))
    .returning({ id: schema.importedPlans.id })
  return rows.length > 0
}
