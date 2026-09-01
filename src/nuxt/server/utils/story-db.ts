import { asc, eq } from 'drizzle-orm'
import type { StoryEvent, StoryKind } from '#shared/types/story'

// Remembrr storage. The story is small (≤500 cards) and order matters, so the
// whole timeline is replaced in one shot: delete the owner's rows, re-insert
// with position = array index.

const KINDS: StoryKind[] = ['opened', 'closed', 'note']
const MAX_EVENTS = 500
const MAX_LABEL = 120
const MAX_NOTE = 2000
// Milliunits bound: one billion dollars ought to be enough debt for anybody.
const MAX_AMOUNT = 1_000_000_000_000

export async function listStoryEvents (owner: string): Promise<StoryEvent[]> {
  const rows = await db.select().from(schema.storyEvents)
    .where(eq(schema.storyEvents.userId, owner))
    .orderBy(asc(schema.storyEvents.position))
    .all()
  return rows.map(row => ({
    id: row.id,
    dateLabel: row.dateLabel,
    kind: row.kind as StoryKind,
    title: row.title,
    amount: row.amount,
    note: row.note
  }))
}

// Throws 400 on anything malformed; returns the cleaned list to insert.
export function validateStoryEvents (input: unknown): StoryEvent[] {
  if (!Array.isArray(input)) {
    throw createError({ statusCode: 400, statusMessage: 'events must be an array' })
  }
  if (input.length > MAX_EVENTS) {
    throw createError({ statusCode: 400, statusMessage: `A story caps out at ${MAX_EVENTS} cards` })
  }
  return input.map((raw, index) => {
    const card = raw as Record<string, unknown>
    if (!card || typeof card !== 'object') {
      throw createError({ statusCode: 400, statusMessage: `Card ${index + 1} isn't an object` })
    }
    const kind = card.kind
    if (typeof kind !== 'string' || !KINDS.includes(kind as StoryKind)) {
      throw createError({ statusCode: 400, statusMessage: `Card ${index + 1}: kind must be opened, closed, or note` })
    }
    const dateLabel = typeof card.dateLabel === 'string' ? card.dateLabel.trim() : ''
    const title = typeof card.title === 'string' ? card.title.trim() : ''
    const note = typeof card.note === 'string' ? card.note.trim() : ''
    if (dateLabel.length > MAX_LABEL || title.length > MAX_LABEL) {
      throw createError({ statusCode: 400, statusMessage: `Card ${index + 1}: keep date and title under ${MAX_LABEL} characters` })
    }
    if (note.length > MAX_NOTE) {
      throw createError({ statusCode: 400, statusMessage: `Card ${index + 1}: keep the note under ${MAX_NOTE} characters` })
    }
    const amount = Number(card.amount ?? 0)
    if (!Number.isInteger(amount) || Math.abs(amount) > MAX_AMOUNT) {
      throw createError({ statusCode: 400, statusMessage: `Card ${index + 1}: amount out of range` })
    }
    const id = typeof card.id === 'string' && card.id.length > 0 && card.id.length <= 64
      ? card.id
      : crypto.randomUUID()
    return { id, dateLabel, kind: kind as StoryKind, title, amount, note }
  })
}

export async function replaceStoryEvents (owner: string, events: StoryEvent[]): Promise<void> {
  await db.delete(schema.storyEvents).where(eq(schema.storyEvents.userId, owner)).run()
  for (let position = 0; position < events.length; position++) {
    const event = events[position]!
    await db.insert(schema.storyEvents).values({
      id: event.id,
      userId: owner,
      position,
      dateLabel: event.dateLabel,
      kind: event.kind,
      title: event.title,
      amount: event.amount,
      note: event.note
    }).run()
  }
}
