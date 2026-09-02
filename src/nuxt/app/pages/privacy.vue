<script setup lang="ts">
useHead({ title: 'Privacy — Plannrr' })
definePageMeta({ layout: 'auth' })
const UPDATED = 'September 2, 2026'
</script>

<template>
  <main class="wrap">
    <NuxtLink to="/" class="y-wordmark mark">Plannrr<span>.</span></NuxtLink>
    <article class="panel">
      <h1>Privacy policy</h1>
      <p class="y-tiny">Last updated {{ UPDATED }}</p>

      <p class="y-body">
        Plannrr is a planning companion for YNAB. It exists to show you your own plan in new
        ways and to let you draft changes before you commit them. This page says exactly what it
        keeps, why, and how to make it forget you.
      </p>

      <h2>What Plannrr collects, and why</h2>
      <ul>
        <li><b>Your email address</b> — to sign you in with a magic link and to reach you about your account. Nothing else is sent to it.</li>
        <li><b>Profile details you choose to add</b> — a name, a currency, a colour palette, an optional profile picture.</li>
        <li><b>YNAB access</b> — either a personal access token you paste, or the tokens YNAB issues when you choose “Sign in with YNAB”. These are stored encrypted (AES-256-GCM) with a key that lives outside the database, are only ever used on the server, and are never shown back to you or anyone else.</li>
        <li><b>A copy of the plans you pick</b> — categories, targets, months, scheduled transactions, a window of the register, and on-budget account balances — so pages load from Plannrr's own copy and YNAB is only contacted when you sync. Nothing you don't choose to import is read.</li>
        <li><b>Things you create here</b> — what-if drafts, hand-tracked debts, calendar preferences, story cards, feedback you send.</li>
      </ul>

      <h2>What Plannrr writes to YNAB</h2>
      <p class="y-body">
        Only the changes you review and confirm in Tinkrr's sync screen: category targets, names,
        groups, and new categories. It never moves your assigned money. Every write is listed
        before it happens and any can be unticked.
      </p>

      <h2>Where it lives and for how long</h2>
      <p class="y-body">
        Plannrr runs on Cloudflare (Workers, D1, KV, R2). Your data stays there until you remove
        a plan from your account page or delete your account. Sign-in links expire after fifteen
        minutes and their hashes are pruned automatically. There are no analytics or advertising
        trackers.
      </p>

      <h2>Who else sees it</h2>
      <p class="y-body">
        No one. Your data is not sold, shared, or passed to any third party. The only outside
        services involved are Cloudflare (hosting), YNAB (the API you connected), and Gravatar
        (your browser fetches a picture for your email if you haven't uploaded one). A Ko-fi link
        in the footer goes to Ko-fi if you click it; nothing is sent there otherwise.
      </p>

      <h2>Deleting your data</h2>
      <p class="y-body">
        On your account page, “Delete my account” removes everything above — the plan copies,
        tokens, debts, drafts, feedback, picture, and the account itself — immediately. If you would
        rather ask a person, email <a href="mailto:me@jonknoll.dev">me@jonknoll.dev</a> from the
        address on the account and it will be deleted within a few days. You can also revoke
        Plannrr's access at any time in YNAB under Account Settings → Developer.
      </p>

      <h2>If this policy changes</h2>
      <p class="y-body">
        If Plannrr ever needs a new kind of data or wants to use your data differently, this page
        will change, the date above will move, and you will be asked to agree again before the new
        use begins.
      </p>

      <LegalLine />
      <NuxtLink to="/" class="y-btn-link back">← Back to Plannrr</NuxtLink>
    </article>
  </main>
</template>

<style scoped>
.wrap { width: 100%; max-width: 640px; display: flex; flex-direction: column; align-items: center; gap: 18px; }
.mark { font-size: 26px; }
.panel {
  width: 100%;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 28px 30px;
  box-shadow: var(--shadow-card);
}
h1 { margin: 0 0 4px; font-size: 24px; font-weight: 800; }
h2 { margin: 22px 0 6px; font-size: 14.5px; font-weight: 800; }
ul { margin: 6px 0 0; padding-left: 18px; }
li { margin: 6px 0; font-size: 13.5px; line-height: 1.55; color: var(--fg-muted); }
li b { color: var(--fg); }
.back { display: inline-block; margin-top: 18px; }
</style>
