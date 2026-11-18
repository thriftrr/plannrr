// Signing in through Authrr from any page: a small Authrr window over the
// page (utils/authrr-popup.ts) that hands back once it's done, or — when
// the browser won't open one — a plain redirect through the same link.
// The palette in use rides along, so the window looks like Plannrr rather
// than Authrr.
//
// `redirect` is where to land afterwards; `onSignedIn` gets it (or wherever
// the sign-in said to go) once the session is in place.
export function useAuthrrSignIn (redirect: MaybeRefOrGetter<string>, onSignedIn: (next: string) => unknown) {
  const { refresh } = useAuth()
  const { palette } = usePalette()
  const waiting = ref(false)
  const error = ref('')
  let stop = () => {}

  const href = computed(() => {
    const to = toValue(redirect)
    return `/auth/authrr/start?${new URLSearchParams({
      ...(to ? { redirect: to } : {}),
      theme: palette.value,
      // Plannrr has one look (no dark scheme), so Authrr is asked for light.
      scheme: 'light'
    })}`
  })

  function start () {
    error.value = ''
    stop()
    const popup = openAuthrrPopup(`${href.value}&popup=1`, async (message) => {
      waiting.value = false
      if (message.type === 'error') {
        error.value = authrrErrorMessage(message.code)
        return
      }
      await refresh()
      await onSignedIn(safeRedirectPath(message.next) || toValue(redirect) || '/')
    })
    stop = popup.stop
    if (!popup.opened) {
      window.location.assign(href.value)
      return
    }
    waiting.value = true
  }

  function cancel () {
    stop()
    waiting.value = false
  }

  onBeforeUnmount(() => stop())
  return { href, start, cancel, waiting, error }
}
