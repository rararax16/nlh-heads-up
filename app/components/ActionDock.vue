<script setup lang="ts">
import type { LegalActions } from '~~/shared/types'

const props = defineProps<{
  legal: LegalActions
  /** 現在の総ポット（現ストリートの拠出込み） */
  pot: number
  /** 現ストリートの相手ベット額（合計ベット基準） */
  currentBet: number
  bb: number
  /** 最小チップ単位（1 = 制限なし）。ベット額はこの倍数に切り上げる */
  chipUnit: number
  /** アクション送信中（二重送信防止） */
  pending?: boolean
}>()

const emit = defineEmits<{
  act: [type: 'fold' | 'check' | 'call' | 'bet' | 'raise', amount?: number]
}>()

const isRaise = computed(() => props.currentBet > 0)

// ---- ベット額（数値入力） ----
// 入力中の空文字を許すため文字列で保持し、確定時にクランプする
const raw = ref(String(props.legal.minRaiseTo))

const amount = computed<number | null>(() => {
  if (!/^\d+$/.test(raw.value)) return null
  return Number(raw.value)
})
// 最小チップ単位への切り上げ（1 なら無変換）
function snapUp(n: number): number {
  return props.chipUnit > 1 ? Math.ceil(n / props.chipUnit) * props.chipUnit : n
}

const isValid = computed(() => {
  const a = amount.value
  if (a === null) return false
  if (a < props.legal.minRaiseTo || a > props.legal.maxRaiseTo) return false
  // オールイン（上限額）以外は最小チップ単位の倍数のみ
  return a % props.chipUnit === 0 || a === props.legal.maxRaiseTo
})

// 別ストリート・別ハンドで最小レイズ額が変わったら初期値へ戻す
// （オブジェクト再取得ではなく値の変化のみに反応し、入力中の値を壊さない）
watch(
  () => props.legal.minRaiseTo,
  (min) => {
    raw.value = String(min)
  },
)

function onInput(e: Event) {
  const el = e.target as HTMLInputElement
  const digits = el.value.replace(/[^\d]/g, '')
  raw.value = digits
  el.value = digits
}

function clamp(n: number): number {
  return Math.min(props.legal.maxRaiseTo, Math.max(props.legal.minRaiseTo, n))
}

function commitInput() {
  raw.value = String(
    amount.value === null ? props.legal.minRaiseTo : clamp(snapUp(amount.value)),
  )
}

// ---- ± ステッパー（BB 単位、長押しで連続増減） ----
function step(dir: 1 | -1) {
  // 端数入力中でも単位に整えてから増減する
  const base = snapUp(amount.value ?? props.legal.minRaiseTo)
  raw.value = String(clamp(base + dir * props.bb))
}

let holdTimer: ReturnType<typeof setTimeout> | null = null
let holdRepeat: ReturnType<typeof setInterval> | null = null

function holdStart(dir: 1 | -1) {
  holdEnd()
  step(dir)
  // 指がボタン外で離れても確実に停止できるよう window 側でも監視する
  window.addEventListener('pointerup', holdEnd, { once: true })
  holdTimer = setTimeout(() => {
    holdRepeat = setInterval(() => step(dir), 80)
  }, 400)
}
function holdEnd() {
  window.removeEventListener('pointerup', holdEnd)
  if (holdTimer) clearTimeout(holdTimer)
  if (holdRepeat) clearInterval(holdRepeat)
  holdTimer = holdRepeat = null
}
onUnmounted(holdEnd)

const atMin = computed(() => (amount.value ?? props.legal.minRaiseTo) <= props.legal.minRaiseTo)
const atMax = computed(() => (amount.value ?? props.legal.minRaiseTo) >= props.legal.maxRaiseTo)

// ---- ポット％ショートカット ----
// レイズ時の「X% ポット」= コール後ポットの X% を上乗せした合計ベット額
//   raiseTo = currentBet + pct * (pot + toCall)
// ベット時（currentBet = 0）は単純に pot * pct
const PRESETS = [
  { label: '33%', pct: 0.33 },
  { label: '50%', pct: 0.5 },
  { label: '75%', pct: 0.75 },
  { label: '100%', pct: 1 },
  { label: '125%', pct: 1.25 },
] as const

function potTarget(pct: number): number {
  const target = isRaise.value
    ? props.currentBet + pct * (props.pot + props.legal.callAmount)
    : props.pot * pct
  // 最小チップ単位に切り上げ（例: 33% = 1,012 → 1,100）
  return snapUp(Math.round(target))
}

const presets = computed(() =>
  PRESETS.map((p) => {
    const target = potTarget(p.pct)
    const reachable =
      target >= props.legal.minRaiseTo && target <= props.legal.maxRaiseTo
    return { ...p, target, reachable, active: amount.value === target }
  }),
)

const allinActive = computed(() => amount.value === props.legal.maxRaiseTo)

function applyPreset(target: number) {
  raw.value = String(target)
}

function submitRaise() {
  if (!isValid.value || amount.value === null) return
  emit('act', isRaise.value ? 'raise' : 'bet', amount.value)
}
</script>

<template>
  <div class="dock">
    <!-- ベット額パネル -->
    <div v-if="legal.canBetOrRaise" class="sizer">
      <div class="presets" role="group" aria-label="ベット額ショートカット">
        <button
          v-for="p in presets"
          :key="p.label"
          class="preset"
          :class="{ 'preset--active': p.active }"
          :disabled="!p.reachable"
          @click="applyPreset(p.target)"
        >
          {{ p.label }}
        </button>
        <button
          class="preset preset--allin"
          :class="{ 'preset--active': allinActive }"
          @click="applyPreset(legal.maxRaiseTo)"
        >
          MAX
        </button>
      </div>

      <div class="amount-row">
        <button
          class="stepper"
          :class="{ 'stepper--limit': atMin }"
          aria-label="ベット額を減らす"
          @pointerdown.prevent="holdStart(-1)"
          @pointerup="holdEnd"
          @pointercancel="holdEnd"
        >−</button>

        <div class="amount-box" :class="{ 'amount-box--invalid': !isValid }">
          <input
            class="amount-input money"
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            autocomplete="off"
            enterkeyhint="done"
            aria-label="ベット額"
            :value="raw"
            @input="onInput"
            @blur="commitInput"
            @keyup.enter="($event.target as HTMLInputElement).blur()"
          />
          <div class="amount-range money">
            {{ formatChips(legal.minRaiseTo) }} 〜 {{ formatChips(legal.maxRaiseTo) }}<template v-if="chipUnit > 1"> ・ {{ formatChips(chipUnit) }}刻み</template>
          </div>
        </div>

        <button
          class="stepper"
          :class="{ 'stepper--limit': atMax }"
          aria-label="ベット額を増やす"
          @pointerdown.prevent="holdStart(1)"
          @pointerup="holdEnd"
          @pointercancel="holdEnd"
        >＋</button>
      </div>
    </div>

    <!-- アクションボタン -->
    <div class="acts">
      <button class="act act--fold" :disabled="pending" @click="emit('act', 'fold')">
        フォールド
      </button>

      <button v-if="legal.canCheck" class="act act--check" :disabled="pending" @click="emit('act', 'check')">
        チェック
      </button>
      <button v-if="legal.canCall" class="act act--call" :disabled="pending" @click="emit('act', 'call')">
        コール
        <span class="act__amt money">{{ formatChips(legal.callAmount) }}</span>
      </button>

      <button
        v-if="legal.canBetOrRaise"
        class="act act--raise"
        :disabled="pending || !isValid"
        @click="submitRaise"
      >
        {{ isRaise ? 'レイズ' : 'ベット' }}
        <span class="act__amt money">{{ amount === null ? '—' : formatChips(amount) }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.dock {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  user-select: none;
  -webkit-user-select: none;
}

.sizer {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

/* ---- ポット％プリセット ---- */
.presets {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 0.35rem;
}
.preset {
  min-height: 36px;
  border-radius: 0.7rem;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.05);
  color: var(--muted);
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  padding: 0;
  transition: border-color 0.12s, color 0.12s, background 0.12s;
}
.preset:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.preset--active {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}
.preset--allin {
  color: #ff8a80;
  border-color: rgba(242, 86, 77, 0.4);
}
.preset--allin.preset--active {
  border-color: var(--danger);
  color: #ffa39b;
  background: var(--danger-soft);
}

/* ---- 数値入力 ---- */
.amount-row {
  display: flex;
  align-items: stretch;
  gap: 0.45rem;
}
.stepper {
  width: 52px;
  border-radius: 0.9rem;
  border: 1px solid var(--border-strong);
  background: var(--surface-2);
  color: var(--text);
  font-size: 1.4rem;
  font-weight: 600;
  line-height: 1;
  flex-shrink: 0;
  touch-action: none; /* 長押し中のスクロールを防ぐ */
}
.stepper--limit {
  opacity: 0.3;
}
.stepper:active {
  filter: brightness(1.2);
}
.amount-box {
  flex: 1;
  min-width: 0;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid var(--border-strong);
  border-radius: 0.9rem;
  padding: 0.22rem 0.5rem 0.28rem;
  text-align: center;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.amount-box:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.amount-box--invalid {
  border-color: var(--danger);
}
.amount-box--invalid:focus-within {
  border-color: var(--danger);
  box-shadow: 0 0 0 3px var(--danger-soft);
}
.amount-input {
  width: 100%;
  background: none;
  border: none;
  outline: none;
  color: var(--text);
  font-size: 1.35rem; /* 16px 以上: iOS ズーム防止 */
  text-align: center;
  padding: 0;
}
.amount-range {
  font-size: 0.66rem;
  color: var(--muted);
  letter-spacing: 0.04em;
}

/* ---- アクションボタン ---- */
.acts {
  display: flex;
  gap: 0.45rem;
}
.act {
  flex: 1;
  min-height: 54px;
  border-radius: 0.9rem;
  border: 1px solid var(--border-strong);
  font-size: 1rem;
  font-weight: 800;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.1rem;
  padding: 0.4rem 0.2rem;
  transition: filter 0.15s, transform 0.06s;
}
.act:active:not(:disabled) {
  transform: translateY(1px) scale(0.99);
}
.act:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.act__amt {
  font-size: 0.95rem;
  font-weight: 400;
  opacity: 0.9;
}
.act--fold {
  background: var(--danger-soft);
  border-color: rgba(242, 86, 77, 0.45);
  color: #ff8a80;
  flex: 0.8;
}
.act--check,
.act--call {
  background: var(--accent);
  border-color: var(--accent);
  color: #052a1a;
  box-shadow: 0 4px 16px rgba(43, 196, 126, 0.25);
}
.act--raise {
  background: var(--amber);
  border-color: var(--amber);
  color: #2b1c04;
  box-shadow: 0 4px 16px rgba(240, 178, 79, 0.25);
}
.act--raise .act__amt,
.act--check .act__amt,
.act--call .act__amt {
  font-weight: 700;
}
</style>
