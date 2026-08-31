export default defineEventHandler(async (event) => {
  const owner = await requireDebtOwner(event)
  const body = await readBody<Partial<DebtSettings>>(event)
  return { settings: await putDebtSettings(owner, body ?? {}) }
})
