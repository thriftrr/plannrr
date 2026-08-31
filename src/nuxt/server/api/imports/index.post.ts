const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  const parts = await readMultipartFormData(event)
  const file = parts?.find(part => part.name === 'file' && part.data?.length)
  if (!file) {
    throw createError({ statusCode: 400, statusMessage: 'Attach the exported zip as "file"' })
  }
  if (file.data.length > MAX_UPLOAD_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'That export is larger than 20MB' })
  }

  const parsed = parseYnabExportZip(new Uint8Array(file.data))
  const planId = `imp_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`

  await kv.set(importKey(user.id, planId), parsed)
  await insertImportedPlan({
    id: planId,
    userId: user.id,
    name: parsed.name,
    monthCount: Object.keys(parsed.months).length
  })

  return {
    id: planId,
    name: parsed.name,
    months: Object.keys(parsed.months).length,
    categories: parsed.categoryCount
  }
})
