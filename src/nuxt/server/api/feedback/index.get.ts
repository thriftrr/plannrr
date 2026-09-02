export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return { feedback: await listFeedback() }
})
