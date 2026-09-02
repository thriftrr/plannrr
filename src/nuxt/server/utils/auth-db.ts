import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm'

// Queries over the NuxtHub drizzle client (`db` and `schema` are
// auto-imported server globals provided by @nuxthub/core).

export interface DbUser {
  id: string
  email: string
  patCipher: string | null
  firstName: string | null
  lastName: string | null
  currency: string
  avatarKey: string | null
}

export interface ImportedPlanRow {
  id: string
  userId: string
  name: string
  monthCount: number
  kind: string          // imported | synced | manual
  ynabPlanId: string | null
  currencyCode: string
  lastSyncedAt: string | null
  createdAt: string
}

// Hard ceiling on accounts: with open magic-link signup this is what bounds
// the app's entire resource footprint (D1 rows, KV snapshots, R2 avatars,
// email sends). Raise deliberately, not by accident.
const MAX_USERS = Math.max(Number.parseInt(useRuntimeConfig().maxUsers, 10) || 250, 1)

export async function ensureUser (email: string): Promise<DbUser> {
  const existing = await db.select().from(schema.users).where(eq(schema.users.email, email)).get()
  if (existing) return existing
  const userCount = await db.select({ n: sql<number>`count(*)` }).from(schema.users).get()
  if ((userCount?.n ?? 0) >= MAX_USERS) {
    throw createError({ statusCode: 503, statusMessage: 'Sign-ups are full right now — check back later.' })
  }
  const id = crypto.randomUUID()
  await db.insert(schema.users).values({ id, email }).run()
  return { id, email, patCipher: null, firstName: null, lastName: null, currency: 'USD', avatarKey: null }
}

export async function getUserById (id: string): Promise<DbUser | null> {
  return await db.select().from(schema.users).where(eq(schema.users.id, id)).get() ?? null
}

export interface ProfilePatch {
  firstName?: string | null
  lastName?: string | null
  currency?: string
}

export async function updateUserProfile (id: string, patch: ProfilePatch): Promise<void> {
  if (!Object.keys(patch).length) return
  await db.update(schema.users).set(patch).where(eq(schema.users.id, id)).run()
}

export async function setUserAvatarKey (id: string, avatarKey: string | null): Promise<void> {
  await db.update(schema.users).set({ avatarKey }).where(eq(schema.users.id, id)).run()
}

export async function setUserPat (id: string, patCipher: string | null): Promise<void> {
  await db.update(schema.users).set({ patCipher }).where(eq(schema.users.id, id)).run()
}

export async function insertLoginToken (tokenHash: string, email: string, expiresAt: string): Promise<void> {
  // Spent and expired hashes are worthless; sweep them so the table stays
  // the size of "links in flight".
  await db.delete(schema.loginTokens).where(lt(schema.loginTokens.expiresAt, sql`datetime('now')`)).run()
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

// Per-user ceiling across every source kind (imported, synced, manual); each
// source also carries a KV snapshot, so this bounds KV storage too.
const MAX_SOURCES_PER_USER = 20

async function assertSourceQuota (userId: string): Promise<void> {
  const count = await db.select({ n: sql<number>`count(*)` }).from(schema.importedPlans)
    .where(eq(schema.importedPlans.userId, userId)).get()
  if ((count?.n ?? 0) >= MAX_SOURCES_PER_USER) {
    throw createError({ statusCode: 403, statusMessage: `You've hit the limit of ${MAX_SOURCES_PER_USER} budgets — delete one you no longer need first.` })
  }
}

export async function insertImportedPlan (row: { id: string, userId: string, name: string, monthCount: number }): Promise<void> {
  await assertSourceQuota(row.userId)
  await db.insert(schema.importedPlans).values(row).run()
}

// The unified budget-source registry (same table; every kind).
export async function listPlanSources (owner: string): Promise<ImportedPlanRow[]> {
  return await db.select().from(schema.importedPlans)
    .where(eq(schema.importedPlans.userId, owner))
    .orderBy(desc(schema.importedPlans.createdAt))
    .all()
}

export async function getPlanSource (owner: string, id: string): Promise<ImportedPlanRow | null> {
  return await db.select().from(schema.importedPlans)
    .where(and(eq(schema.importedPlans.userId, owner), eq(schema.importedPlans.id, id)))
    .get() ?? null
}

export async function upsertPlanSource (row: {
  id: string, userId: string, name: string, monthCount: number,
  kind: string, ynabPlanId: string | null, currencyCode: string, lastSyncedAt: string | null
}): Promise<void> {
  const existing = await getPlanSource(row.userId, row.id)
  if (existing) {
    await db.update(schema.importedPlans)
      .set({ name: row.name, monthCount: row.monthCount, kind: row.kind, ynabPlanId: row.ynabPlanId, currencyCode: row.currencyCode, lastSyncedAt: row.lastSyncedAt })
      .where(and(eq(schema.importedPlans.userId, row.userId), eq(schema.importedPlans.id, row.id)))
      .run()
  } else {
    await assertSourceQuota(row.userId)
    await db.insert(schema.importedPlans).values(row).run()
  }
}

export async function findSourceByYnabPlan (owner: string, ynabPlanId: string): Promise<ImportedPlanRow | null> {
  return await db.select().from(schema.importedPlans)
    .where(and(eq(schema.importedPlans.userId, owner), eq(schema.importedPlans.ynabPlanId, ynabPlanId)))
    .get() ?? null
}

export async function deletePlanSource (owner: string, id: string): Promise<boolean> {
  const rows = await db.delete(schema.importedPlans)
    .where(and(eq(schema.importedPlans.id, id), eq(schema.importedPlans.userId, owner)))
    .returning({ id: schema.importedPlans.id })
  return rows.length > 0
}

export async function deleteImportedPlan (userId: string, id: string): Promise<boolean> {
  const rows = await db.delete(schema.importedPlans)
    .where(and(eq(schema.importedPlans.id, id), eq(schema.importedPlans.userId, userId)))
    .returning({ id: schema.importedPlans.id })
  return rows.length > 0
}
