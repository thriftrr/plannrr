// Currencies offered on the Account page. Synced YNAB budgets format with
// whatever currency YNAB reports for that plan; this preference covers
// hand-tracked debts and no-YNAB mode.
export const CURRENCIES = [
  { code: 'USD', symbol: '$', label: 'USD $' },
  { code: 'EUR', symbol: '€', label: 'EUR €' },
  { code: 'GBP', symbol: '£', label: 'GBP £' },
  { code: 'CAD', symbol: '$', label: 'CAD $' }
] as const

export type CurrencyCode = typeof CURRENCIES[number]['code']

export const CURRENCY_CODES: readonly string[] = CURRENCIES.map(c => c.code)

export function currencySymbol (code: string | null | undefined): string {
  return CURRENCIES.find(c => c.code === code)?.symbol ?? '$'
}
