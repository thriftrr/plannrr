export default defineEventHandler(async (event) => {
  const { ynabMock } = useRuntimeConfig()
  if (ynabMock) {
    return { mock: true, debts: resolveMockDebtRecords(), lastSynced: null, settings: defaultDebtSettings }
  }
  const owner = await debtOwner(event)
  if (!owner) return { mock: false, debts: [], lastSynced: null, settings: defaultDebtSettings }
  return {
    mock: false,
    debts: await listDebts(owner),
    lastSynced: await lastSyncedAt(owner),
    settings: await getDebtSettings(owner)
  }
})
