// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: [
    '@nuxt/a11y',
    '@nuxt/fonts',
    '@nuxt/hints',
    '@nuxt/icon',
    '@nuxt/image',
    '@nuxt/test-utils',
    '@nuxthub/core'
  ],

  hub: {
    cache: true,
    db: 'sqlite',
    kv: true
  },

  runtimeConfig: {
    // set via NUXT_YNAB_PERSONAL_ACCESS_TOKEN — server-only, never exposed to
    // the client. Local fallback: used when a signed-in user has no stored PAT,
    // and enables a personal no-login mode when running the app yourself.
    ynabPersonalAccessToken: '',
    // set NUXT_YNAB_MOCK=1 to serve built-in fixtures instead of calling YNAB
    ynabMock: '',
    // signs session cookies (required in production)
    sessionSecret: '',
    // encrypts stored YNAB tokens at rest (falls back to sessionSecret)
    patSecret: '',
    // Cloudflare Email Sending via REST API; in dev, emails log to the console
    cfAccountId: '',
    cfEmailToken: '',
    emailFrom: '',
    // absolute origin for emailed links; defaults to the request origin
    appOrigin: ''
  }
})
