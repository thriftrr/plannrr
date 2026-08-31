export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const rows = await listImportedPlans(user.id)
  return {
    imports: rows.map(row => ({
      id: row.id,
      name: row.name,
      months: row.monthCount,
      created_at: row.createdAt
    }))
  }
})
