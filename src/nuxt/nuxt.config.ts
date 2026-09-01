// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  // Self-hosted Cloudflare deployment (thriftrr account): production swaps the
  // local sqlite/fs drivers for D1/KV/R2 bindings. Binding names are NuxtHub's
  // defaults (DB / KV / CACHE / BLOB); the module emits the wrangler config at
  // build time. Dev below keeps using .data/ untouched.
  $production: {
    hub: {
      cache: { driver: 'cloudflare-kv-binding', namespaceId: 'd81ccae66dd740bc904ed907da8fd590' },
      db: { dialect: 'sqlite', driver: 'd1', connection: { databaseId: '938dec14-1866-470e-837b-58de71ce49bc' } },
      kv: { driver: 'cloudflare-kv-binding', namespaceId: '0656efbde6e64dd6bcafbc1a4a0dd18c' },
      blob: { driver: 'cloudflare-r2', bucketName: 'ynabrr-blob' }
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
    cloudflare: { wrangler: { name: 'plannrr' } }
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
    // absolute origin for emailed links; defaults to the request origin
    appOrigin: ''
  }
})
