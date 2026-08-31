export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = getRouterParam(event, 'id')
  if (!id || !id.startsWith('imp_')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid import id' })
  }
  const removed = await deleteImportedPlan(user.id, id)
  if (!removed) {
    throw createError({ statusCode: 404, statusMessage: 'Import not found' })
  }
  await kv.del(importKey(user.id, id))
  return { ok: true }
})
