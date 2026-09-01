// Currency rule: a synced YNAB budget formats with whatever currency YNAB
// reports for that plan. The user's Account preference covers everything YNAB
// doesn't own — hand-tracked debts and no-YNAB mode.
export function useMoney () {
  const { user } = useAuth()
  const userCurrency = computed(() => user.value?.currency || 'USD')

  const format = (milliunits: number, currency?: string | null) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || userCurrency.value
    }).format(milliunits / 1000)

  return { userCurrency, format }
}
