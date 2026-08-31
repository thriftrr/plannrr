import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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

export const importedPlans = sqliteTable('imported_plans', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  monthCount: integer('month_count').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`)
})
