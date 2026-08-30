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
    kv: true
  },

  runtimeConfig: {
    // set via NUXT_YNAB_PERSONAL_ACCESS_TOKEN — server-only, never exposed to the client
    ynabPersonalAccessToken: ''
  }
})
