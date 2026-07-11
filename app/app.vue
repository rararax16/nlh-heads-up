<template>
  <div class="app">
    <NuxtRouteAnnouncer />
    <NuxtPage />
  </div>
</template>

<style>
/* =====================================================
   デザイントークン — モダンダーク（日本語UIファースト）
   グラファイト基調 × ミントグリーン。金額数字は Sora。
   装飾は排し、ヘアラインボーダーと余白で整える。
   ===================================================== */
:root {
  --bg: #0b0d10;
  --surface: #14171c;
  --surface-2: #1c2027;
  --overlay: rgba(15, 18, 22, 0.95);
  --border: rgba(255, 255, 255, 0.08);
  --border-strong: rgba(255, 255, 255, 0.15);
  --text: #f0f2f5;
  --muted: #8f98a3;
  --accent: #2bc47e;
  --accent-deep: #128a54;
  --accent-soft: rgba(43, 196, 126, 0.14);
  --amber: #f0b24f;
  --amber-soft: rgba(240, 178, 79, 0.12);
  --danger: #f2564d;
  --danger-soft: rgba(242, 86, 77, 0.1);
  --felt: radial-gradient(115% 85% at 50% 30%, #1b3d2e 0%, #142c22 55%, #0d1d16 100%);
  --font-display: 'Sora', 'Hiragino Sans', 'Noto Sans JP', sans-serif;
  --font-body: 'Hiragino Sans', 'Noto Sans JP', system-ui, -apple-system, sans-serif;
  --shadow-pop: 0 8px 28px rgba(0, 0, 0, 0.45);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
}

* {
  box-sizing: border-box;
  -webkit-tap-highlight-color: transparent;
}

html,
body,
#__nuxt {
  margin: 0;
  height: 100%;
}

body {
  background:
    radial-gradient(90% 40% at 50% 0%, rgba(43, 196, 126, 0.05) 0%, rgba(43, 196, 126, 0) 100%),
    var(--bg);
  color: var(--text);
  font-family: var(--font-body);
  -webkit-font-smoothing: antialiased;
  overscroll-behavior-y: none;
  line-height: 1.55;
}

.app {
  min-height: 100%;
}

/* ---------- 数字・金額 ---------- */
.money {
  font-family: var(--font-display);
  font-weight: 700;
  font-variant-numeric: tabular-nums lining-nums;
  letter-spacing: 0.01em;
}

/* ---------- ボタン ---------- */
button {
  font-family: inherit;
  cursor: pointer;
  touch-action: manipulation;
}

.btn {
  border: 1px solid var(--border-strong);
  background: var(--surface-2);
  color: var(--text);
  min-height: 48px;
  padding: 0.6rem 1.1rem;
  border-radius: 0.9rem;
  font-weight: 700;
  font-size: 0.95rem;
  line-height: 1.3;
  white-space: nowrap;
  transition: filter 0.15s, transform 0.06s, background 0.15s;
}
.btn:hover:not(:disabled) {
  filter: brightness(1.12);
}
.btn:active:not(:disabled) {
  transform: translateY(1px) scale(0.99);
}
.btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.btn--primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #052a1a;
}
.btn--danger {
  background: var(--danger-soft);
  border-color: rgba(242, 86, 77, 0.45);
  color: #ff8a80;
}
.btn--ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--muted);
}
.btn.tiny {
  min-height: 36px;
  padding: 0.3rem 0.8rem;
  font-size: 0.8rem;
  border-radius: 0.7rem;
  font-weight: 600;
}

/* ---------- 入力 ---------- */
.input {
  background: rgba(255, 255, 255, 0.045);
  border: 1px solid var(--border);
  color: var(--text);
  min-height: 48px;
  padding: 0.6rem 0.9rem;
  border-radius: 0.9rem;
  font-size: 1rem; /* 16px 以上: iOS のフォーカスズームを防ぐ */
  font-family: inherit;
  width: 100%;
  transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
}
.input:focus {
  outline: none;
  border-color: var(--accent);
  background: rgba(255, 255, 255, 0.06);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.input::placeholder {
  color: #5b636d;
}

select.input {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%238f98a3' stroke-width='2' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.9rem center;
  padding-right: 2.2rem;
}

/* ---------- パネル ---------- */
.card-panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 1.25rem;
  padding: 1.4rem;
  box-shadow: var(--shadow-pop);
}

label {
  font-size: 0.82rem;
  color: var(--muted);
  display: block;
  margin-bottom: 0.4rem;
  letter-spacing: 0.01em;
}

@media (prefers-reduced-motion: reduce) {
  * {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
</style>
