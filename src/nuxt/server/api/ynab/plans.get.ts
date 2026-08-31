export default defineEventHandler(async (event) => {
  return await getPlansForRequest(event)
})
