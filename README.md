# YNABRR

A [YNAB](https://www.ynab.com/) planning companion: pull your plan down, see it clearly, play out "what if" scenarios, and sync the result back — plus a calendar view of bills and date-anchored goals.

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
cp src/nuxt/.env.example src/nuxt/.env
# add your token from https://app.ynab.com/settings/developer
make up
```

Then open http://localhost:3000.

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
