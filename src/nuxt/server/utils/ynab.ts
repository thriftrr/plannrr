// Server-side YNAB client — the personal access token never reaches the browser.
// API reference: https://api.ynab.com/
const YNAB_API_BASE = 'https://api.ynab.com/v1'

type YnabFetchOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: Record<string, unknown>
}

export async function ynabFetch<T> (path: string, options: YnabFetchOptions = {}): Promise<T> {
  const { ynabPersonalAccessToken } = useRuntimeConfig()

  if (!ynabPersonalAccessToken) {
    throw createError({
      statusCode: 500,
      statusMessage: 'YNAB token missing — set NUXT_YNAB_PERSONAL_ACCESS_TOKEN in src/nuxt/.env'
    })
  }

  const { data } = await $fetch<{ data: T }>(`${YNAB_API_BASE}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${ynabPersonalAccessToken}` }
  })

  return data
}

// YNAB amounts are milliunits: 1000 milliunits = $1.00
export const fromMilliunits = (milliunits: number) => milliunits / 1000
export const toMilliunits = (units: number) => Math.round(units * 1000)
