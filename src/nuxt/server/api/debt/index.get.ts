export default defineEventHandler(async (event) => {
  const { ynabMock } = useRuntimeConfig()
  if (ynabMock) {
    return { mock: true, debts: resolveMockDebtRecords(), lastSynced: null }
  }
  const owner = await debtOwner(event)
  if (!owner) return { mock: false, debts: [], lastSynced: null }
  return {
    mock: false,
    debts: await listDebts(owner),
    lastSynced: await lastSyncedAt(owner)
  }
})
