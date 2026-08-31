export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  await setUserPat(user.id, null)
  return { ok: true }
})
