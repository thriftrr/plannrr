// Deletes the account and everything it owns — the "delete my data" promise
// in the privacy policy, honored in one request. The body must echo the
// account's email so a stray click can never do this.
export default defineEventHandler(async (event) => {
  const session = await requireUser(event)
  const body = await readBody<{ confirm?: string }>(event)
  if ((body?.confirm ?? '').trim().toLowerCase() !== session.email.toLowerCase()) {
    throw createError({ statusCode: 400, statusMessage: 'Type your email address exactly to confirm' })
  }
  const user = await getUserById(session.id)
  if (!user) {
    endSession(event)
    return { ok: true }
  }

  // KV: snapshots, parsed imports, recurring prefs per source; debt settings.
  for (const row of await listPlanSources(user.id)) {
    await deleteSnapshot(user.id, row.id)
    for (const key of [importKey(user.id, row.id), recurringPrefsKey(user.id, row.id)]) {
      try { await kv.del(key) } catch { /* already gone */ }
    }
  }
  for (const key of [`debt:settings:${user.id}`, `debt:sync-stamp:${user.id}`]) {
    try { await kv.del(key) } catch { /* already gone */ }
  }
  // R2: the avatar.
  if (user.avatarKey) {
    try { await blob.delete(`avatars/${user.id}`) } catch { /* already gone */ }
  }
  // D1: every row keyed to the user, then the user.
  await deleteEverythingForUser(user.id, user.email)
  endSession(event)
  return { ok: true }
})
