export default defineEventHandler(async (event) => {
  const session = await getSessionUser(event)
  const linked = session ? Boolean((await getUserById(session.id))?.authrrSub) : false
  endSession(event)
  // With Authrr on, ending only this app's session would be undone at once:
  // /login sends people to Authrr, which is still signed in. So the page
  // carries on through Authrr's logout.
  return { ok: true, ...(linked && authrrEnabled() ? { next: authrrLogoutUrl(event) } : {}) }
})
