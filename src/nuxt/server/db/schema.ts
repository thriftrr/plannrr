import { sql } from 'drizzle-orm'
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  patCipher: text('pat_cipher'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  // ISO 4217. Applies to hand-tracked debts and no-YNAB mode; synced budgets
  // format with whatever currency YNAB reports for that plan.
  currency: text('currency').notNull().default('USD'),
  // R2 object key for an uploaded avatar. Null = fall back to Gravatar.
  avatarKey: text('avatar_key'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`)
})

export const loginTokens = sqliteTable('login_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  email: text('email').notNull(),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at')
})

export const debts = sqliteTable('debts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  source: text('source').notNull(), // ynab | import | manual
  sourceKey: text('source_key'),
  planName: text('plan_name').notNull().default(''),
  name: text('name').notNull(),
  startDate: text('start_date').notNull().default(''),
  endDate: text('end_date'),
  startBalance: integer('start_balance').notNull().default(0),
  balance: integer('balance').notNull().default(0),
  paidIn: integer('paid_in').notNull().default(0),
  rate: real('rate'),
  minimumPayment: integer('minimum_payment'),
  // User overrides (sync never touches these): when the loan really began,
  // plus name/balance/paid-in corrections on synced rows.
  userStartDate: text('user_start_date'),
  userStartBalance: integer('user_start_balance'),
  userName: text('user_name'),
  userBalance: integer('user_balance'),
  userPaidIn: integer('user_paid_in'),
  history: text('history').notNull().default('[]'),
  hidden: integer('hidden').notNull().default(0),
  updatedAt: text('updated_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`)
})

// Historically zip imports only; now the unified registry of every budget
// source — imported (zip), synced (YNAB snapshot), and manual (built by hand).
// All three kinds keep their plan data in a local KV snapshot; nothing is
// fetched from YNAB at page-load time.
export const importedPlans = sqliteTable('imported_plans', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  monthCount: integer('month_count').notNull(),
  kind: text('kind').notNull().default('imported'), // imported | synced | manual
  ynabPlanId: text('ynab_plan_id'),
  currencyCode: text('currency_code').notNull().default('USD'),
  lastSyncedAt: text('last_synced_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`)
})

// Remembrr: hand-written debt-story timeline, one row per card. The whole
// story is replaced atomically on save, ordered by position.
export const storyEvents = sqliteTable('story_events', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  position: integer('position').notNull(),
  dateLabel: text('date_label').notNull().default(''),
  kind: text('kind').notNull(), // opened | closed | note
  title: text('title').notNull().default(''),
  amount: integer('amount').notNull().default(0), // milliunits
  note: text('note').notNull().default(''),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`)
})

// Feedback: bug reports and suggestions from signed-in users. `body` is raw
// Markdown exactly as submitted — never trusted, only ever rendered through
// markdown-it with html disabled (so any tags inside are escaped text).
export const feedback = sqliteTable('feedback', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  email: text('email').notNull(),
  name: text('name').notNull().default(''),
  body: text('body').notNull().default(''),
  page: text('page').notNull().default(''),
  userAgent: text('user_agent').notNull().default(''),
  resolvedAt: text('resolved_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`)
})
