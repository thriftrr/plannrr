<template>
  <p class="legal">
    We are not affiliated, associated, or in any way officially connected with YNAB or any of its
    subsidiaries or affiliates. The official YNAB website can be found at
    <a href="https://www.ynab.com" target="_blank" rel="noopener">https://www.ynab.com</a>.
    The names YNAB and You Need A Budget, as well as related names, marks, emblems, and images are
    registered trademarks of YNAB. · <NuxtLink to="/privacy">Privacy policy</NuxtLink>
  </p>
</template>

<style scoped>
.legal {
  margin: 14px auto 0;
  max-width: 640px;
  text-align: center;
  font-size: 11px;
  line-height: 1.5;
  color: var(--fg-faint);
}
.legal a { color: inherit; text-decoration: underline; }
</style>
