// Every budget source this account has — synced, imported, manual — plus how
// many debt rows each one owns (shown in the delete confirmation).
export default defineEventHandler(async (event) => {
  const { ynabMock } = useRuntimeConfig()
  const owner = await debtOwner(event)
  if (!owner) return { sources: [], mock: Boolean(ynabMock) }

  const rows = await listPlanSources(owner)
  const sources = []
  for (const row of rows) {
    const debtCount = row.kind === 'synced' && row.ynabPlanId
      ? await countDebtsFromSource(owner, 'ynab', row.ynabPlanId)
      : row.kind === 'imported'
        ? await countDebtsFromSource(owner, 'import', row.id)
        : 0
    sources.push({
      id: row.id,
      name: row.name,
      kind: row.kind,
      currency: row.currencyCode,
      monthCount: row.monthCount,
      lastSyncedAt: row.lastSyncedAt,
      createdAt: row.createdAt,
      debtCount
    })
  }
  return { sources, mock: Boolean(ynabMock) }
})
