// Deletes the account and everything it owns — the "delete my data" promise
// in the privacy policy, honored in one request. The body must echo the
// account's email so a stray click can never do this.
//
// POST, not DELETE, on purpose: this began life as `DELETE /api/account` with
// the same JSON body, and Nitro's Cloudflare Workers entry only forwards
// request bodies for POST/PUT/PATCH (METHOD_WITH_BODY_RE in
// nitropack/runtime/internal/utils). In production the confirmation never
// arrived, so every attempt failed with "type your email exactly" — while the
// Node dev server, which reads the body whatever the method, looked fine.
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

  // KV: snapshots, parsed imports, recurring prefs per source; debt settings
  // and the sync stamp.
  for (const row of await listPlanSources(user.id)) {
    await deleteSnapshot(user.id, row.id)
    for (const key of [importKey(user.id, row.id), recurringPrefsKey(user.id, row.id)]) {
      try { await kv.del(key) } catch { /* already gone */ }
    }
  }
  for (const key of debtKvKeys(user.id)) {
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
