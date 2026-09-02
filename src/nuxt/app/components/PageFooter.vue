<script setup lang="ts">
// `phone` renders this copy only under 760px — pages put one after their
// SideRail so the footer lands below the inline panel on phones, and hide
// the in-column copy there.
defineProps<{ phone?: boolean }>()
</script>

<template>
  <div class="foot" :class="{ 'phone-only': phone }">
    Made with ☕ —
    <a href="https://ko-fi.com/tubstrr" target="_blank" rel="noopener">support tubstrr on Ko-fi</a>
    <LegalLine />
  </div>
</template>

<style scoped>
.foot {
  margin-top: 26px;
  text-align: center;
  font-size: 12px;
  color: var(--fg-faint);
}
.foot a { font-weight: 700; }
.foot.phone-only { display: none; }
@media (max-width: 759px) {
  .foot.phone-only { display: block; width: 100%; padding: 0 16px; margin-top: 0; box-sizing: border-box; }
}
</style>
