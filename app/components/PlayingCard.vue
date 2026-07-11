<script setup lang="ts">
import type { Card } from '~~/shared/types'

const props = defineProps<{
  card?: Card | null
  faceDown?: boolean
  small?: boolean
}>()
</script>

<template>
  <div
    class="card"
    :class="{ 'card--down': faceDown || !card, 'card--red': card && isRed(card), 'card--small': small }"
  >
    <template v-if="!faceDown && card">
      <span class="card__rank">{{ cardRank(card) }}</span>
      <span class="card__suit">{{ cardSuit(card) }}</span>
      <span class="card__pip" aria-hidden="true">{{ cardSuit(card) }}</span>
    </template>
    <template v-else>
      <span class="card__lattice" aria-hidden="true" />
      <span class="card__back">♠</span>
    </template>
  </div>
</template>

<style scoped>
.card {
  --w: 3.6rem;
  position: relative;
  width: var(--w);
  height: calc(var(--w) * 1.42);
  border-radius: calc(var(--w) * 0.15);
  background: #fbfbf9;
  color: #1c2128;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: calc(var(--w) * 0.02);
  line-height: 1;
  box-shadow:
    inset 0 0 0 1px rgba(0, 0, 0, 0.05),
    0 2px 8px rgba(0, 0, 0, 0.35);
  user-select: none;
  overflow: hidden;
}
.card--small {
  --w: 2.4rem;
}
.card--red {
  color: #e5484d;
}
.card__rank {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: calc(var(--w) * 0.42);
  letter-spacing: -0.03em;
}
.card__suit {
  font-size: calc(var(--w) * 0.34);
}
/* 右下の透かしピップ */
.card__pip {
  position: absolute;
  right: calc(var(--w) * 0.08);
  bottom: calc(var(--w) * 0.03);
  font-size: calc(var(--w) * 0.32);
  opacity: 0.12;
  transform: rotate(180deg);
}

/* ---- 裏面: グラファイト × ミントのワンポイント ---- */
.card--down {
  background: #171c23;
  color: rgba(43, 196, 126, 0.65);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.12),
    0 2px 8px rgba(0, 0, 0, 0.35);
}
.card__lattice {
  position: absolute;
  inset: calc(var(--w) * 0.09);
  border-radius: calc(var(--w) * 0.08);
  border: 1px solid rgba(255, 255, 255, 0.07);
  background-image: repeating-linear-gradient(
    45deg,
    rgba(255, 255, 255, 0.05) 0,
    rgba(255, 255, 255, 0.05) 1px,
    transparent 1px,
    transparent calc(var(--w) * 0.13)
  );
}
.card__back {
  position: relative;
  font-size: calc(var(--w) * 0.4);
}
</style>
