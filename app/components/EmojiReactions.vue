<script setup lang="ts">
// ヘッズアップ相手との軽量コミュニケーション。
// 絵文字ボタンをタップ（連打可）すると、インスタのハート連打のように
// 絵文字がふわっと立ち上って揺れながら消えるアニメーションを再生する。
// 自分の分は即時ローカル再生し、相手には broadcast で届ける（親が中継）。
// 対戦相手へ向けた感情表現: ドヤ顔 / 嬉しい / 悲しい / ハート + リスペクト(拍手) + 盛り上げ
const props = withDefaults(
  defineProps<{ emojis?: string[]; selfName?: string }>(),
  { emojis: () => ['😏', '😆', '😭', '❤️', '👏', '🔥'], selfName: 'あなた' },
)
const emit = defineEmits<{ send: [emoji: string] }>()

interface Particle {
  id: number
  emoji: string
  name: string
  side: 'me' | 'opp'
  style: Record<string, string>
}

const particles = ref<Particle[]>([])
let seq = 0

function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}

// side: 'me' = 右側から / 'opp' = 左側から立ち上らせて送信者を区別する
function spawn(emoji: string, name: string, side: 'me' | 'opp') {
  const id = ++seq
  const dir = side === 'me' ? 1 : -1
  const dur = rand(1.9, 2.8)
  const style: Record<string, string> = {
    left: `${(side === 'me' ? 78 : 22) + rand(-7, 7)}%`,
    '--rise': `${rand(56, 82)}vh`,
    '--x1': `${rand(8, 34) * dir}px`,
    '--x2': `${rand(18, 46) * -dir}px`,
    '--rot': `${rand(-22, 22)}deg`,
    '--peak': String(rand(1.15, 1.55)),
    animationDuration: `${dur}s`,
  }
  particles.value.push({ id, emoji, name, side, style })
  setTimeout(() => {
    particles.value = particles.value.filter((p) => p.id !== id)
  }, dur * 1000 + 60)
}

function tap(emoji: string) {
  spawn(emoji, props.selfName, 'me')
  emit('send', emoji)
  if ('vibrate' in navigator) navigator.vibrate(10)
}

// 相手から届いた絵文字を再生（親が broadcast 受信時に呼ぶ）
function receive(emoji: string, name: string) {
  if (props.emojis.includes(emoji) || emoji.length <= 8) spawn(emoji, name || '相手', 'opp')
}

defineExpose({ receive })
</script>

<template>
  <div class="reactions">
    <div class="reactions__stage" aria-hidden="true">
      <span
        v-for="p in particles"
        :key="p.id"
        class="reactions__particle"
        :class="`reactions__particle--${p.side}`"
        :style="p.style"
      >
        <span class="reactions__emoji">{{ p.emoji }}</span>
        <span v-if="p.name" class="reactions__who">{{ p.name }}</span>
      </span>
    </div>

    <div class="reactions__bar">
      <button
        v-for="e in emojis"
        :key="e"
        type="button"
        class="reactions__btn"
        :aria-label="`${e} を送る`"
        @click="tap(e)"
      >{{ e }}</button>
    </div>
  </div>
</template>

<style scoped>
.reactions {
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
}

/* ---- 立ち上る絵文字の舞台 ---- */
.reactions__stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.reactions__particle {
  position: absolute;
  bottom: 11%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.18rem;
  line-height: 1;
  will-change: transform, opacity;
  transform: translate(-50%, 0);
  animation-name: emojiRise;
  animation-timing-function: cubic-bezier(0.22, 0.61, 0.36, 1);
  animation-fill-mode: forwards;
}
.reactions__emoji {
  font-size: 2rem;
  filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.45));
}
.reactions__who {
  max-width: 6.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--text);
  background: rgba(11, 13, 16, 0.72);
  border: 1px solid var(--border);
  border-radius: 0.7rem;
  padding: 0.08rem 0.4rem;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
}
/* 送信者で色分け: 自分=グリーン / 相手=アンバー */
.reactions__particle--me .reactions__who {
  color: var(--accent);
  border-color: rgba(43, 196, 126, 0.5);
}
.reactions__particle--opp .reactions__who {
  color: var(--amber);
  border-color: rgba(240, 178, 79, 0.5);
}
@keyframes emojiRise {
  0% {
    opacity: 0;
    transform: translate(-50%, 0) scale(0.3) rotate(0deg);
  }
  10% {
    opacity: 1;
    transform: translate(-50%, calc(var(--rise) * -0.08)) scale(var(--peak)) rotate(var(--rot));
  }
  45% {
    opacity: 1;
    transform: translate(calc(-50% + var(--x1)), calc(var(--rise) * -0.45)) scale(1) rotate(calc(var(--rot) * -0.5));
  }
  75% {
    opacity: 0.85;
    transform: translate(calc(-50% + var(--x2)), calc(var(--rise) * -0.75)) scale(0.95) rotate(var(--rot));
  }
  100% {
    opacity: 0;
    transform: translate(calc(-50% + var(--x1)), calc(var(--rise) * -1)) scale(0.78) rotate(0deg);
  }
}

/* ---- 絵文字バー（右端の縦レール・常時タップ可能） ---- */
.reactions__bar {
  position: absolute;
  right: 0.35rem;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.3rem 0.2rem;
  background: rgba(11, 13, 16, 0.55);
  border: 1px solid var(--border);
  border-radius: 1.4rem;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  pointer-events: auto;
}
.reactions__btn {
  width: 2rem;
  height: 2rem;
  display: grid;
  place-items: center;
  font-size: 1.15rem;
  line-height: 1;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid transparent;
  border-radius: 50%;
  cursor: pointer;
  transition: transform 0.08s ease, background 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}
.reactions__btn:hover {
  background: rgba(255, 255, 255, 0.1);
}
.reactions__btn:active {
  transform: scale(0.82);
  background: rgba(255, 255, 255, 0.16);
}

@media (prefers-reduced-motion: reduce) {
  .reactions__particle {
    animation-name: emojiFade;
  }
  @keyframes emojiFade {
    0% { opacity: 0; transform: translate(-50%, 0) scale(0.6); }
    20% { opacity: 1; transform: translate(-50%, calc(var(--rise) * -0.25)) scale(1); }
    100% { opacity: 0; transform: translate(-50%, calc(var(--rise) * -0.5)) scale(0.9); }
  }
}
</style>
