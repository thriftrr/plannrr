// Replaces the whole story — the timeline is one document, order included.
export default defineEventHandler(async (event) => {
  const owner = await requireDebtOwner(event)
  const body = await readBody<{ events?: unknown }>(event)
  const events = validateStoryEvents(body?.events)
  await replaceStoryEvents(owner, events)
  return { ok: true, count: events.length }
})
