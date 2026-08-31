import { sql } from 'drizzle-orm'
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  patCipher: text('pat_cipher'),
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

export const importedPlans = sqliteTable('imported_plans', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  monthCount: integer('month_count').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`)
})
