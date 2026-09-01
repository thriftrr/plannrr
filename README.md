# Plannrr

Plannrr (formerly YNABRR) is a budget planning companion that plays nicely with [YNAB](https://www.ynab.com/): pull your plan down, see it clearly, play out "what if" scenarios, and sync the result back — plus a calendar view of bills and date-anchored goals.

Work is tracked on the [Linear RANDOM board](https://linear.app/thriftrr/team/RANDOM/all), flagged `[YNABRR]`.

## The two big ideas

### 1. Budget sandbox — plan, tinker, sync back

See financing and spending realistically, then draft changes without touching the real plan until you're ready.

Driving scenario: live off one paycheck, send the second paycheck straight to debt, and send partner income straight to debt.

- Pull categories, category groups, budgeted amounts, activity, and goals from the YNAB API
- Visualize current state (income vs. allocated vs. actual spend)
- Sandbox mode: draft reallocations locally as named scenarios, diff them against the live plan
- Sync back: write budgeted amounts (and goal changes) to YNAB

### 2. Calendar view — bills, goals, and progress

View the budget on a calendar: "rent hits on the 2nd", "$500 saved by Thanksgiving".

- Scheduled transactions (bills) plotted on their next dates, expanded by frequency
- Category goals with target dates shown on the calendar
- Progress bars / burn-up graphs toward date-anchored goals
- Day drill-in: what's due or expected that day

## Stack

Nuxt 4 + [NuxtHub](https://hub.nuxt.com/) (cache + KV), structure mirrors [hivrr](https://github.com/tubstrr/hivrr) `v0`: root `makefile`, app in [src/nuxt](src/nuxt).

## Setup

```sh
make build
cp src/nuxt/.env.example src/nuxt/.env   # see the comments inside
make up          # or: make up-mock for sample data, no YNAB needed
```

Then open http://localhost:3000.

## Accounts & data sources

Sign-in is passwordless: enter an email, get a magic link (15-minute,
single-use; only SHA-256 digests of tokens are stored). Sessions are JWTs in
an httpOnly cookie. In dev, magic-link emails print to the server console.

A signed-in user can connect budgets two ways:

1. **Import a YNAB export zip** (YNAB → Export Plan Data). Both the newer
   "- Plan.csv" and older "- Budget.csv" formats parse; monthly income is
   derived from Register inflows. Exports carry no goals, so each category's
   assigned amount becomes its monthly baseline in the sandbox.
2. **Save a personal access token** — stored AES-256-GCM encrypted, used only
   server-side to pull budgets live from the YNAB API.

`NUXT_YNAB_PERSONAL_ACCESS_TOKEN` in `.env` still works as a personal
single-user mode (no sign-in needed), and `make up-mock` remains the
zero-setup demo.

Storage is NuxtHub: drizzle over SQLite/D1 (`server/db/schema.ts`, migrations
via `npx nuxt db generate`) plus KV for parsed imports.

## Email (Cloudflare Email Sending)

Magic links send through [Cloudflare Email Sending](https://developers.cloudflare.com/email-service/):
the Workers `send_email` binding when deployed, or the REST API via
`NUXT_CF_ACCOUNT_ID` + `NUXT_CF_EMAIL_TOKEN` + `NUXT_EMAIL_FROM`. The from-
domain must be onboarded first (`npx wrangler email sending enable <domain>`).
Without any transport configured, dev logs the email and production refuses
to send (fail closed).

## YNAB API cheat sheet

Reference: https://api.ynab.com/ (base `https://api.ynab.com/v1`, bearer token auth).

- Budgets are called **plans** in the current API (`/plans/...`)
- Amounts are **milliunits**: `1000` = $1.00
- Reads: `/plans`, `/plans/:id/categories` (includes `goal_*` fields), `/plans/:id/months`, `/plans/:id/scheduled_transactions`, `/plans/:id/transactions`
- Writes we care about:
  - `PATCH /plans/:id/months/:month/categories/:category_id` — set a month's budgeted amount (the sandbox "sync back")
  - `PATCH /plans/:id/categories/:category_id` — update a category, including `goal_target` and `goal_target_date`
  - `POST` / `PUT` `/plans/:id/scheduled_transactions` — manage bills
- Rate limit is 200 requests/hour per token — cache responses and use delta requests (`last_knowledge_of_server`) when syncing
