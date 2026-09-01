<script setup lang="ts">
// Ported from "App Sidebar.dc.html" — collapse state, flyout tooltips on the
// collapsed rail, and the gravatar-with-initials-fallback footer all follow
// that file's logic.
const { user } = useAuth()
const route = useRoute()

const collapsed = ref(false)
const hovered = ref<string | null>(null)
const { avatarUrl, initials } = useAvatar()

const items = [
  {
    label: 'Tinkrr',
    to: '/tinkrr',
    // budget table
    paths: [
      { rect: { x: 3, y: 4, width: 18, height: 16, rx: 2.5 } },
      { line: { x1: 3, y1: 9.5, x2: 21, y2: 9.5 } },
      { line: { x1: 3, y1: 14.75, x2: 21, y2: 14.75 } },
      { line: { x1: 14, y1: 9.5, x2: 14, y2: 20 } }
    ]
  },
  {
    label: 'Calendrr',
    to: '/calendrr',
    // month grid with two event dots
    paths: [
      { rect: { x: 3, y: 5, width: 18, height: 16, rx: 2.5 } },
      { line: { x1: 3, y1: 10, x2: 21, y2: 10 } },
      { line: { x1: 8, y1: 2.5, x2: 8, y2: 6.5 } },
      { line: { x1: 16, y1: 2.5, x2: 16, y2: 6.5 } },
      { circle: { cx: 8.5, cy: 14.5, r: 1.1, fill: 'currentColor', stroke: 'none' } },
      { circle: { cx: 12.5, cy: 14.5, r: 1.1, fill: 'currentColor', stroke: 'none' } }
    ]
  },
  {
    label: 'Debt Colectrr',
    to: '/debt-colectrr',
    // descending burndown line
    paths: [
      { polyline: { points: '3,6 8,10 13,14 21,19' } },
      { polyline: { points: '15.5,19 21,19 21,13.5' } }
    ]
  },
  {
    label: 'Remembrr',
    to: '/remembrr',
    // open ledger book
    paths: [
      { path: { d: 'M5 3h11a3 3 0 0 1 3 3v15H8a3 3 0 0 1-3-3Z' } },
      { path: { d: 'M19 17H8a3 3 0 0 0-3 3' } },
      { line: { x1: 9, y1: 8, x2: 15, y2: 8 } }
    ]
  }
]

function isActive (to: string) {
  return route.path === to || route.path.startsWith(to + '/')
}

function toggle () {
  collapsed.value = !collapsed.value
  try {
    localStorage.setItem('ynabrr:sidebar', collapsed.value ? 'collapsed' : 'expanded')
  } catch { /* private mode — the toggle still works for this session */ }
}

onMounted(() => {
  try {
    collapsed.value = localStorage.getItem('ynabrr:sidebar') === 'collapsed'
  } catch { /* default to expanded */ }
})
</script>

<template>
  <aside class="shell" :class="{ collapsed }" aria-label="Main">
    <div class="head">
      <NuxtLink v-if="!collapsed" to="/" class="mark">
        <img src="/logo-mark-light.svg" alt="" width="26" height="26" class="mark-img">
        <span class="mark-word">Plannrr<span class="mark-dot">.</span></span>
      </NuxtLink>
      <NuxtLink v-else to="/" class="mark-solo" title="Plannrr home">
        <img src="/logo-mark-light.svg" alt="Plannrr" width="26" height="26">
      </NuxtLink>
      <button
        class="toggle"
        :title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        :aria-expanded="!collapsed"
        @click="toggle"
      >
        {{ collapsed ? '»' : '«' }}
      </button>
    </div>

    <div v-if="!collapsed" class="tagline">A YNAB planning companion</div>

    <nav class="nav">
      <div v-for="item in items" :key="item.to" class="row">
        <NuxtLink
          :to="item.to"
          class="item"
          :class="{ on: isActive(item.to) }"
          @mouseenter="hovered = item.label"
          @mouseleave="hovered = null"
          @focus="hovered = item.label"
          @blur="hovered = null"
        >
          <svg
            width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
          >
            <template v-for="(p, i) in item.paths" :key="i">
              <rect v-if="p.rect" v-bind="p.rect" />
              <line v-else-if="p.line" v-bind="p.line" />
              <polyline v-else-if="p.polyline" v-bind="p.polyline" />
              <circle v-else-if="p.circle" v-bind="p.circle" />
              <path v-else-if="p.path" v-bind="p.path" />
            </template>
          </svg>
          <span v-if="!collapsed">{{ item.label }}</span>
        </NuxtLink>
        <div v-if="collapsed && hovered === item.label" class="flyout">
          <span class="arrow" />{{ item.label }}
        </div>
      </div>
    </nav>

    <div class="foot">
      <NuxtLink
        v-if="user"
        to="/account"
        class="user"
        :title="`Account · ${user.email}`"
      >
        <img v-if="avatarUrl" :src="avatarUrl" alt="" width="24" height="24" class="avatar">
        <span v-else class="avatar initials">{{ initials }}</span>
        <span v-if="!collapsed" class="email">{{ user.email }}</span>
      </NuxtLink>
      <NuxtLink v-else to="/login" class="user" title="Sign in">
        <span class="avatar initials">→</span>
        <span v-if="!collapsed" class="email">Sign in</span>
      </NuxtLink>
    </div>
  </aside>
</template>

<style scoped>
.shell {
  /* Pinned full-height rail: the sidebar never scrolls with the page, and
     scrolls internally only if its own nav outgrows the viewport. */
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
  overscroll-behavior: contain;
  width: var(--sidebar-w);
  padding: 20px 12px 16px;
  background: var(--teal-deep);
  color: var(--nav-fg);
  display: flex;
  flex-direction: column;
  flex: none;
  transition: width 0.18s;
}

.shell.collapsed {
  width: var(--sidebar-w-collapsed);
  padding: 20px 10px 16px;
}

.head { display: flex; align-items: center; gap: 6px; }
.shell.collapsed .head { flex-direction: column; gap: 10px; justify-content: center; }

.mark {
  display: flex;
  align-items: center;
  gap: 9px;
  font-weight: 800;
  font-size: 19px;
  letter-spacing: 0.5px;
  color: #fff;
  padding: 2px 4px 2px 10px;
  text-decoration: none;
  white-space: nowrap;
}
.mark-img { display: block; border-radius: 6px; flex: none; }
.mark-dot { color: var(--nav-accent); }
.mark-solo { display: grid; place-items: center; }
.mark-solo img { display: block; border-radius: 6px; }

.toggle {
  width: 28px;
  height: 28px;
  margin-left: auto;
  border: none;
  border-radius: var(--r-xs);
  background: rgba(255, 255, 255, 0.08);
  color: var(--nav-fg-dim);
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  flex: none;
  display: grid;
  place-items: center;
  padding: 0;
  line-height: 1;
}
.shell.collapsed .toggle { margin-left: 0; }
.toggle:hover { background: rgba(255, 255, 255, 0.14); color: #fff; }

.tagline {
  padding: 0 10px;
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--nav-fg-faint);
}

.nav { display: flex; flex-direction: column; gap: 3px; margin-top: 20px; }

.row { position: relative; }

.item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: var(--r-sm);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  color: var(--nav-fg-dim);
  white-space: nowrap;
}
.shell.collapsed .item {
  width: 38px;
  height: 38px;
  padding: 0;
  margin: 0 auto;
  justify-content: center;
}
.item:hover { background: rgba(255, 255, 255, 0.12); color: #fff; }
.item.on { background: rgba(255, 255, 255, 0.18); color: #fff; }
.item svg { display: block; flex: none; }

.flyout {
  position: absolute;
  left: calc(100% + 12px);
  top: 50%;
  transform: translateY(-50%);
  z-index: 30;
  background: var(--fg);
  color: #fff;
  font-size: 12.5px;
  font-weight: 700;
  white-space: nowrap;
  padding: 6px 11px;
  border-radius: var(--r-xs);
  box-shadow: var(--shadow-pop);
  pointer-events: none;
}
.arrow {
  position: absolute;
  left: -4px;
  top: 50%;
  margin-top: -4px;
  width: 8px;
  height: 8px;
  background: var(--fg);
  transform: rotate(45deg);
}

.foot {
  margin-top: auto;
  border-top: 1px solid rgba(255, 255, 255, 0.22);
  padding-top: 12px;
}

.user {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border-radius: var(--r-sm);
  color: var(--nav-fg);
  text-decoration: none;
  font-size: 12.5px;
}
.shell.collapsed .user { padding: 4px; justify-content: center; }
.user:hover { background: rgba(255, 255, 255, 0.12); color: var(--nav-fg); }

.avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--teal);
  flex: none;
}
.initials {
  display: grid;
  place-items: center;
  color: #fff;
  font-weight: 800;
  font-size: 11px;
}

.email { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
