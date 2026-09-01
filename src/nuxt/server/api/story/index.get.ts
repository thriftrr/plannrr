export default defineEventHandler(async (event) => {
  const owner = await debtOwner(event)
  if (!owner) return { events: [] }
  return { events: await listStoryEvents(owner) }
})
