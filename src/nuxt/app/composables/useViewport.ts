// One source of truth for the responsive shell. Two breakpoints only:
//   phone   < 760px  — top bar + bottom tab bar, rails inline or as sheets
//   tablet  < 1100px — sidebar collapses to its icon rail, rails as on phones
// CSS media queries do the showing/hiding (no first-paint flash); these
// refs drive BEHAVIOUR that CSS can't (sheets, default collapse states).
// Server-side both are false; they settle right after mount.
export const PHONE_MAX = 759
export const TABLET_MAX = 1099

export function useViewport () {
  const isPhone = useState<boolean>('vp-phone', () => false)
  const isTablet = useState<boolean>('vp-tablet', () => false)
  const bound = useState<boolean>('vp-bound', () => false)

  if (import.meta.client && !bound.value) {
    bound.value = true
    const phone = window.matchMedia(`(max-width: ${PHONE_MAX}px)`)
    const tablet = window.matchMedia(`(max-width: ${TABLET_MAX}px)`)
    const sync = () => {
      isPhone.value = phone.matches
      isTablet.value = tablet.matches
    }
    sync()
    phone.addEventListener('change', sync)
    tablet.addEventListener('change', sync)
  }
  return { isPhone, isTablet }
}
