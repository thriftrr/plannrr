// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  // Self-hosted Cloudflare deployment: production swaps the local sqlite/fs
  // drivers for D1/KV/R2 bindings that YOU create in your own account (see
  // "Deploying" in the root README). The ids come from .env at build time so
  // the repo carries nothing account-specific. Binding names are NuxtHub's
  // defaults (DB / KV / CACHE / BLOB); the module emits the wrangler config
  // at build time. Dev below keeps using .data/ untouched.
  $production: {
    hub: {
      cache: { driver: 'cloudflare-kv-binding', namespaceId: process.env.NUXT_CF_KV_CACHE_ID ?? '' },
      db: { dialect: 'sqlite', driver: 'd1', connection: { databaseId: process.env.NUXT_CF_D1_DATABASE_ID ?? '' } },
      kv: { driver: 'cloudflare-kv-binding', namespaceId: process.env.NUXT_CF_KV_ID ?? '' },
      blob: { driver: 'cloudflare-r2', bucketName: process.env.NUXT_CF_R2_BUCKET ?? '' }
    }
  },

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

  // Worker name for the Cloudflare build (otherwise nitro invents one).
  nitro: {
    cloudflare: { wrangler: { name: process.env.NUXT_CF_WORKER_NAME || 'plannrr' } }
  },

  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'Plannrr',
      meta: [{ name: 'description', content: 'A budget planning companion that plays nicely with YNAB.' }],
      link: [
        // Brand mark (Brand.dc.html): SVG first, ICO fallback, 180px touch icon.
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico', sizes: '32x32' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }
      ]
    }
  },

  // The old route names forward to the branded ones.
  routeRules: {
    '/sandbox': { redirect: { to: '/tinkrr', statusCode: 301 } },
    '/calendar': { redirect: { to: '/calendrr', statusCode: 301 } },
    '/debt': { redirect: { to: '/debt-colectrr', statusCode: 301 } },
    '/story': { redirect: { to: '/remembrr', statusCode: 301 } }
  },

  // Design tokens ported from the Claude Design project; loaded globally so
  // every page and scoped block can read the custom properties.
  css: ['~/assets/css/design.css'],

  // Nunito Sans is declared directly in design.css as a self-hosted variable
  // woff2 (it needs the opsz axis, which the module's static output drops).
  // @nuxt/fonts stays enabled for any family added later.

  hub: {
    cache: true,
    db: 'sqlite',
    kv: true,
    // R2 — stores uploaded profile pictures (see server/api/account/avatar).
    blob: true
  },

  runtimeConfig: {
    // set via NUXT_YNAB_PERSONAL_ACCESS_TOKEN — server-only, never exposed to
    // the client, and honored in DEV ONLY (personal no-login mode). Production
    // ignores it entirely: each user must store their own encrypted PAT.
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
    // absolute origin for emailed links and the OAuth redirect URI; required
    // in production
    appOrigin: '',
    // "Sign in with YNAB": an OAuth application from YNAB → Account Settings →
    // Developer. Redirect URI must be <NUXT_APP_ORIGIN>/api/ynab/oauth/callback.
    // Leave blank and the account page offers the personal-token path only.
    ynabClientId: '',
    ynabClientSecret: '',
    // comma-separated emails that see the feedback inbox and get notified
    // when feedback arrives (NUXT_ADMIN_EMAILS). Nobody is admin until set.
    adminEmails: '',
    // NUXT_TRUST_PROXY=1 when self-hosting behind a reverse proxy that sets
    // X-Forwarded-For (Cloudflare needs nothing — cf-connecting-ip is used)
    trustProxy: '',
    // sign-up ceiling (NUXT_MAX_USERS); keeps a public instance's D1/email
    // spend bounded
    maxUsers: '250'
  }
})
