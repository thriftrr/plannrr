export default defineEventHandler(async (event) => {
  const session = await getSessionUser(event)
  if (!session) return { user: null }
  const user = await getUserById(session.id)
  if (!user) {
    endSession(event)
    return { user: null }
  }
  return { user: { email: user.email, hasPat: Boolean(user.patCipher) } }
})
