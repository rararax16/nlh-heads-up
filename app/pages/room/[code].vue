<script setup lang="ts">
import type { Card } from '~~/shared/types'
import type { ActionEvent } from '~/composables/useRoom'

const route = useRoute()
const router = useRouter()
const code = String(route.params.code).toUpperCase()
const displayName = useDisplayName()
const activeRoom = useActiveRoom()

const { state, error, loading, now, join, start, act, sendEmoji, onEmoji, onAction } = useRoom(code)

const joining = ref(false)

// 相手から届いた絵文字リアクションを再生
const reactionsRef = ref<{ receive: (emoji: string, name: string) => void } | null>(null)
onEmoji((emoji, name) => reactionsRef.value?.receive(emoji, name))

// 着席中はこの部屋を「戻り先」として保存（対局終了で解除）
watch(state, (s) => {
  if (!s || s.yourSeat === null) return
  activeRoom.value = s.room.status === 'finished' ? null : s.room.code
})

// 自分がまだ着席していなければ自動入室（表示名がある場合）
watch(
  () => state.value,
  async (s) => {
    if (!s) return
    if (s.yourSeat === null && s.room.status === 'waiting' && s.players.length < 2) {
      if (displayName.value.trim() && !joining.value) {
        joining.value = true
        try {
          await join(displayName.value.trim())
        } catch { /* エラーは state.error に */ }
        joining.value = false
      }
    }
  },
)

const me = computed(() => state.value?.players.find((p) => p.isYou) ?? null)
const opponent = computed(() => state.value?.players.find((p) => !p.isYou) ?? null)
const hand = computed(() => state.value?.hand ?? null)
const room = computed(() => state.value?.room ?? null)
const yourSeat = computed(() => state.value?.yourSeat ?? null)
const legal = computed(() => state.value?.legalActions ?? null)

const oppSeat = computed(() => 1 - (yourSeat.value ?? 0))

const isMyTurn = computed(
  () => !!hand.value && !hand.value.result && hand.value.toActSeat === yourSeat.value,
)
const isOppTurn = computed(
  () => !!hand.value && !hand.value.result && hand.value.toActSeat === oppSeat.value,
)

// 手番が自分に回ってきた瞬間の通知（フラッシュ表示＋バイブレーション）
const turnFlash = ref(false)
let turnFlashTimer: ReturnType<typeof setTimeout> | null = null
watch(isMyTurn, (mine, was) => {
  if (!mine || was) return
  turnFlash.value = true
  if ('vibrate' in navigator) navigator.vibrate(60)
  if (turnFlashTimer) clearTimeout(turnFlashTimer)
  turnFlashTimer = setTimeout(() => (turnFlash.value = false), 1400)
})
onUnmounted(() => {
  if (turnFlashTimer) clearTimeout(turnFlashTimer)
})

// ---- 相手アクションの実況（3ベット等を見逃さないように吹き出し＋ピルで表示） ----
const ACTION_LABEL: Record<ActionEvent['type'], string> = {
  fold: 'フォールド',
  check: 'チェック',
  call: 'コール',
  bet: 'ベット',
  raise: 'レイズ',
  allin: 'オールイン',
}
const oppAction = ref<ActionEvent | null>(null)
const oppActionToast = ref(false)
let oppActionTimer: ReturnType<typeof setTimeout> | null = null
onAction((a) => {
  const s = state.value
  if (!s?.hand || a.hand_id !== s.hand.id) return
  if (s.yourSeat === null || a.seat === s.yourSeat) return
  oppAction.value = a
  // フォールドは直後に結果バナーが出るため吹き出しは省略
  if (a.type === 'fold') return
  oppActionToast.value = true
  if (oppActionTimer) clearTimeout(oppActionTimer)
  oppActionTimer = setTimeout(() => (oppActionToast.value = false), 2600)
})
onUnmounted(() => {
  if (oppActionTimer) clearTimeout(oppActionTimer)
})

// 吹き出しの本文。ベット/レイズ/オールインは「合計ベット額」で表示する
// （イベント直後は一瞬旧額になり得るが、状態リロード(約0.1秒)で確定額に揃う）
const oppActionText = computed(() => {
  const a = oppAction.value
  const h = hand.value
  if (!a || !h) return null
  const label = ACTION_LABEL[a.type]
  let amount: number | null = null
  if (a.type === 'call') amount = a.amount
  if (a.type === 'bet' || a.type === 'raise' || a.type === 'allin') {
    amount =
      h.id === a.hand_id && h.street === a.street
        ? (oppSeatState.value?.streetCommitted ?? a.amount)
        : a.amount
  }
  return amount ? `${label} ${formatStack(amount)}` : label
})

// ベットピルに添える実況ラベル（同ハンド・同ストリートの間だけ残す）
const oppPillLabel = computed(() => {
  const a = oppAction.value
  const h = hand.value
  if (!a || !h || h.id !== a.hand_id || h.street !== a.street) return null
  if (a.type === 'bet' || a.type === 'raise' || a.type === 'allin' || a.type === 'call') {
    return ACTION_LABEL[a.type]
  }
  return null
})

// ショーダウンで公開された両者のハンド（ボード上部に並べて表示）
const showdownHands = computed(() => {
  const r = hand.value?.result
  if (!r?.showdown || yourSeat.value === null) return null
  return [...r.showdown]
    .sort((a) => (a.seat === yourSeat.value ? -1 : 1)) // 自分を左に
    .map((e) => ({
      seat: e.seat,
      cards: e.cards,
      label: e.seat === yourSeat.value ? 'あなた' : (opponent.value?.displayName ?? '相手'),
      win: r.winners.includes(e.seat),
    }))
})

// 結果の勝敗（バナーの色分け用）
const resultOutcome = computed<'win' | 'lose' | 'split' | null>(() => {
  const r = hand.value?.result
  if (!r || yourSeat.value === null) return null
  if (r.winners.length > 1) return 'split'
  return r.winners[0] === yourSeat.value ? 'win' : 'lose'
})

// 表示用ポット: 現ストリートの未確定ベット（ピルで表示中）はポットに含めない
const displayPot = computed(() => {
  const h = hand.value
  if (!h) return 0
  if (h.result) return h.pot
  return h.pot - (h.seats[0]?.streetCommitted ?? 0) - (h.seats[1]?.streetCommitted ?? 0)
})

// ショーダウンで公開された相手のカード
const opponentCards = computed<Card[] | null>(() => {
  const sd = hand.value?.result?.showdown
  if (!sd || opponent.value == null) return null
  return sd.find((e) => e.seat === oppSeat.value)?.cards ?? null
})

const mySeatState = computed(() =>
  hand.value && yourSeat.value !== null ? hand.value.seats[yourSeat.value] : null,
)
const oppSeatState = computed(() => hand.value?.seats[oppSeat.value] ?? null)

// ランアウト演出中（結果は届いているがバナー未表示）は配当前のスタックを見せ、
// リバーが開く前に勝敗が分からないようにする
function stackDuringReveal(seat: number, current: number): number {
  const r = hand.value?.result
  if (r && !resultVisible.value) return current - (r.payouts[seat] ?? 0)
  return current
}
const myStackDisplay = computed(() =>
  stackDuringReveal(yourSeat.value ?? 0, mySeatState.value?.stack ?? me.value?.stack ?? 0),
)
const oppStackDisplay = computed(() =>
  stackDuringReveal(oppSeat.value, oppSeatState.value?.stack ?? opponent.value?.stack ?? 0),
)

const isButton = (seat: number | null) =>
  seat !== null && hand.value?.buttonSeat === seat

// アクションタイマー（自分・相手どちらの手番でも表示）
const timeLeft = computed(() => {
  if (!hand.value?.actionDeadline || hand.value.result) return 0
  return Math.max(0, (new Date(hand.value.actionDeadline).getTime() - now.value) / 1000)
})
const timePct = computed(() => {
  const total = room.value?.config.actionTimeoutSeconds ?? 30
  return Math.min(100, (timeLeft.value / total) * 100)
})

// ---- スタック表示の単位切替（チップ ⇔ BB・小数第1位） ----
// どちらかのスタックをタップすると両席まとめて切り替わる。設定は保持。
const stackInBB = ref(false)
onMounted(() => {
  stackInBB.value = localStorage.getItem('stackUnit') === 'bb'
})
watch(stackInBB, (v) => localStorage.setItem('stackUnit', v ? 'bb' : 'chips'))
function toggleStackUnit() {
  stackInBB.value = !stackInBB.value
}
// 現ハンドの BB（ハンド外は現在レベルの BB）
const bbSize = computed(() => hand.value?.bb ?? room.value?.currentLevel.bb ?? 0)
function formatStack(n: number): string {
  if (!stackInBB.value || bbSize.value <= 0) return formatChips(n)
  return `${(n / bbSize.value).toFixed(1)} BB`
}

// ブラインドレベルアップまで
const blindCountdown = computed(() => {
  if (!room.value?.nextLevelAt) return null
  const sec = (new Date(room.value.nextLevelAt).getTime() - now.value) / 1000
  return sec > 0 ? formatDuration(sec) : '0:00'
})

// ---- ボード段階公開（オールイン時のランアウト演出） ----
// 結果と同時に複数ストリートが届いた場合、フロップ→ターン→リバーの順に
// 1ストリートずつ公開し、出揃ってから結果バナーを表示する。
const shownBoardCount = ref(0)
const resultVisible = ref(false)
let revealTimers: ReturnType<typeof setTimeout>[] = []
let revealedHandId: string | null = null

function clearRevealTimers() {
  revealTimers.forEach(clearTimeout)
  revealTimers = []
}

watch(
  () => state.value?.hand,
  (h) => {
    if (!h) {
      clearRevealTimers()
      revealedHandId = null
      shownBoardCount.value = 0
      resultVisible.value = false
      return
    }
    if (h.id !== revealedHandId) {
      const isFirstSight = revealedHandId === null
      clearRevealTimers()
      revealedHandId = h.id
      // 途中入室・リロード時、または通常の新ハンドは現状をそのまま表示
      if (isFirstSight || !h.result) {
        shownBoardCount.value = h.board.length
        resultVisible.value = !!h.result
        return
      }
      // 配られた時点で決着済み（アンティ強制オールイン等）→ 0枚からランアウト演出
      shownBoardCount.value = 0
      resultVisible.value = false
    }
    // 通常のストリート進行（結果なし）
    if (!h.result) {
      if (shownBoardCount.value !== h.board.length) {
        shownBoardCount.value = h.board.length
      }
      resultVisible.value = false
      return
    }
    // 結果到着: 未公開のストリートを順に公開してからバナーを出す（多重実行ガード）
    if (resultVisible.value || revealTimers.length > 0) return
    const from = shownBoardCount.value
    revealTargets(from, h.board.length).forEach((count, i) => {
      revealTimers.push(
        setTimeout(() => {
          shownBoardCount.value = count
        }, REVEAL_FIRST_MS + i * REVEAL_STEP_MS),
      )
    })
    revealTimers.push(
      setTimeout(() => {
        resultVisible.value = true
        clearRevealTimers()
      }, runoutDurationMs(from, h.board.length)),
    )
  },
  { immediate: true },
)
onUnmounted(clearRevealTimers)

const canStart = computed(
  () =>
    room.value?.status === 'waiting' &&
    state.value?.players.length === 2 &&
    // 両者揃っていれば、着席しているどちらの席からでも開始できる
    // （匿名IDの喪失で作成者席が幽霊化しても対局不能にならない）
    yourSeat.value !== null,
)

// 二重送信ガード付きアクション
const acting = ref(false)
async function doAct(type: 'fold' | 'check' | 'call' | 'bet' | 'raise', amount?: number) {
  if (acting.value) return
  acting.value = true
  try {
    await act(type, amount)
  } finally {
    acting.value = false
  }
}

const copied = ref(false)
async function copyCode() {
  try {
    await navigator.clipboard.writeText(code)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch { /* noop */ }
}

// 招待URL（開けばそのまま入室ゲートに入れる）のコピー
const copiedUrl = ref(false)
async function copyUrl() {
  try {
    await navigator.clipboard.writeText(`${location.origin}/room/${code}`)
    copiedUrl.value = true
    setTimeout(() => (copiedUrl.value = false), 1500)
  } catch { /* noop */ }
}

async function doJoin() {
  if (!displayName.value.trim()) return
  joining.value = true
  try {
    await join(displayName.value.trim())
  } finally {
    joining.value = false
  }
}

function leave() {
  router.push('/')
}

// ---- 誤離脱ガード（スマホのブラウザバック・スワイプバック対策） ----
const inPlay = computed(
  () => room.value?.status === 'playing' && yourSeat.value !== null,
)

// SPA 内ナビゲーション（ブラウザバック・←ボタン共通）を確認ダイアログで保護
onBeforeRouteLeave(() => {
  if (!inPlay.value) return true
  return window.confirm(
    '対局中です。テーブルを離れますか？\n（ロビーの「対局に戻る」からいつでも戻れます）',
  )
})

// リロード・タブを閉じる操作への警告（ブラウザ標準ダイアログ・ベストエフォート）
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!inPlay.value) return
  e.preventDefault()
  e.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onUnmounted(() => window.removeEventListener('beforeunload', onBeforeUnload))
</script>

<template>
  <div class="room">
    <!-- トップバー -->
    <header class="topbar">
      <button class="btn tiny btn--ghost" @click="leave">←</button>
      <div v-if="room" class="topbar__mid">
        <span class="chip">
          <b>Lv.{{ room.currentLevel.level }}</b>
          <span class="money">{{ formatBlinds(room.currentLevel.sb, room.currentLevel.bb, room.currentLevel.ante) }}</span>
        </span>
        <span v-if="blindCountdown" class="chip chip--dim">次Lv {{ blindCountdown }}</span>
      </div>
      <button class="btn tiny btn--ghost code-btn" @click="copyCode">
        {{ copied ? '✓ コピー済' : room?.code ?? code }}
      </button>
    </header>

    <p v-if="error" class="error">{{ error }}</p>
    <div v-if="loading" class="center muted">読み込み中…</div>

    <!-- 入室ゲート（表示名未設定で満席でない場合） -->
    <div v-else-if="state && yourSeat === null && room?.status === 'waiting'" class="center">
      <div class="card-panel gate">
        <h2>この部屋に参加</h2>
        <label for="join-name">表示名</label>
        <input id="join-name" v-model="displayName" class="input" placeholder="例: エースハンター" maxlength="20" />
        <button class="btn btn--primary full" :disabled="joining" @click="doJoin">参加する</button>
      </div>
    </div>

    <div v-else-if="state && yourSeat === null" class="center muted">
      この部屋は満席です。
    </div>

    <!-- 待機中 -->
    <div v-else-if="room?.status === 'waiting'" class="center">
      <div class="card-panel gate">
        <h2>対戦相手を待っています…</h2>
        <p class="muted small">下のコードを相手に共有してください</p>
        <div class="bigcode money" role="button" @click="copyCode">
          {{ room.code }}
          <span class="bigcode__hint">{{ copied ? 'コピーしました ✓' : 'タップしてコードをコピー' }}</span>
        </div>
        <button class="btn btn--ghost full share-url" @click="copyUrl">
          {{ copiedUrl ? '✓ URLをコピーしました' : '🔗 招待URLをコピー' }}
        </button>
        <div class="waiting-players">
          <div v-for="p in state?.players" :key="p.seat" class="wp">
            <span class="dot" :class="{ on: p.connected }" />{{ p.displayName }}{{ p.isYou ? '（あなた）' : '' }}
          </div>
        </div>
        <button v-if="canStart" class="btn btn--primary full" @click="start">対局を開始</button>
        <p v-else class="muted small">相手が入室すると開始できます</p>
      </div>
    </div>

    <!-- 対局中 / 終了 -->
    <template v-else-if="room && hand">
      <main class="table">
        <div class="table__felt" aria-hidden="true" />
        <div class="table__mark" aria-hidden="true">♠</div>

        <!-- 相手席 -->
        <section
          class="seat seat--opp"
          :class="{ folded: oppSeatState?.folded, active: isOppTurn }"
        >
          <!-- 相手アクションの吹き出し -->
          <transition name="bubble">
            <div v-if="oppActionToast && oppActionText" class="action-bubble">
              {{ oppActionText }}
            </div>
          </transition>
          <div class="plaque">
            <span class="avatar" :class="{ 'avatar--think': isOppTurn }">
              {{ opponent?.isAi ? '🤖' : (opponent?.displayName ?? '?').slice(0, 1) }}
            </span>
            <span class="plaque__name">
              {{ opponent?.displayName ?? '（空席）' }}
              <span v-if="opponent?.isAi" class="ai-tag">AI</span>
              <span v-if="isButton(oppSeat)" class="dealer">D</span>
            </span>
            <button
              type="button"
              class="plaque__stack money stack-toggle"
              aria-label="スタック表示の単位を切り替え"
              @click="toggleStackUnit"
            >{{ formatStack(oppStackDisplay) }}</button>
          </div>
          <TransitionGroup name="deal" tag="div" class="hole hole--opp">
            <PlayingCard
              v-for="(c, i) in (opponentCards ?? [null, null])"
              :key="`oh-${hand.handNumber}-${i}-${opponentCards ? 'up' : 'down'}`"
              :card="c"
              :face-down="!opponentCards"
            />
          </TransitionGroup>
          <div v-if="!hand.result && (oppSeatState?.streetCommitted ?? 0) > 0" class="betpill">
            <span class="betpill__coin" />
            <span v-if="oppPillLabel" class="betpill__act">{{ oppPillLabel }}</span>
            <span class="money">{{ formatStack(oppSeatState!.streetCommitted) }}</span>
          </div>
          <!-- オールインマーカー -->
          <div v-if="oppSeatState?.allin" class="allin-marker">ALL IN</div>
        </section>

        <!-- ボード＆ポット -->
        <section class="board-area">
          <!-- ショーダウン: 両者のハンドをボード上部に並べる（ランアウト中から表示） -->
          <transition name="sdfade">
            <div v-if="showdownHands" class="sd-hands">
              <div
                v-for="h in showdownHands"
                :key="h.seat"
                class="sd-hand"
                :class="{ 'sd-hand--win': resultVisible && h.win, 'sd-hand--lose': resultVisible && !h.win }"
              >
                <span class="sd-hand__label">{{ h.label }}</span>
                <div class="sd-hand__cards">
                  <PlayingCard v-for="c in h.cards" :key="`sd-${h.seat}-${c}`" :card="c" />
                </div>
              </div>
            </div>
          </transition>

          <div class="pot">
            <span class="pot__label">ポット</span>
            <span class="pot__value money">{{ formatStack(displayPot) }}</span>
          </div>
          <TransitionGroup name="reveal" tag="div" class="board">
            <PlayingCard v-for="c in hand.board.slice(0, shownBoardCount)" :key="`b-${c}`" :card="c" />
            <PlayingCard
              v-for="i in (5 - shownBoardCount)"
              :key="`ghost-${shownBoardCount + i}`"
              :card="null"
              face-down
              class="ghost"
            />
          </TransitionGroup>

          <!-- 手番が回ってきた瞬間のフラッシュ -->
          <transition name="pop">
            <div v-if="turnFlash && !hand.result" class="turn-flash">あなたの番です</div>
          </transition>

          <!-- 結果バナー（ボードを隠さないよう、ボード下の帯に表示。勝敗で色分け） -->
          <transition name="result-pop">
            <div
              v-if="hand.result && resultVisible"
              class="result"
              :class="resultOutcome ? `result--${resultOutcome}` : ''"
            >
              <template v-if="hand.result.reason === 'fold'">
                <div class="result__title">
                  {{ hand.result.winners[0] === yourSeat ? 'あなたがポット獲得' : `${opponent?.displayName} がポット獲得` }}
                </div>
                <div class="result__sub">相手フォールド ・ <span class="money">{{ formatStack(hand.result.potWon) }}</span></div>
              </template>
              <template v-else>
                <div class="result__title">
                  <span v-if="hand.result.winners.length > 1">スプリットポット</span>
                  <span v-else>{{ hand.result.winners[0] === yourSeat ? 'あなたの勝ち' : `${opponent?.displayName} の勝ち` }}</span>
                </div>
                <div class="result__descr">
                  <span v-for="e in hand.result.showdown" :key="e.seat">
                    {{ e.seat === yourSeat ? 'あなた' : opponent?.displayName }}: {{ formatHandDescr(e.descr) }}
                  </span>
                </div>
              </template>
            </div>
          </transition>
        </section>

        <!-- 自分席 -->
        <section class="seat seat--me" :class="{ folded: mySeatState?.folded, active: isMyTurn }">
          <div v-if="!hand.result && (mySeatState?.streetCommitted ?? 0) > 0" class="betpill">
            <span class="betpill__coin" />
            <span class="money">{{ formatStack(mySeatState!.streetCommitted) }}</span>
          </div>
          <TransitionGroup name="deal" tag="div" class="hole hole--mine">
            <PlayingCard
              v-for="(c, i) in (state?.myCards ?? [])"
              :key="`mh-${hand.handNumber}-${i}`"
              :card="c"
            />
          </TransitionGroup>
          <div class="plaque">
            <span class="avatar avatar--me">{{ (me?.displayName ?? '?').slice(0, 1) }}</span>
            <span class="plaque__name">
              {{ me?.displayName }}
              <span v-if="isButton(yourSeat)" class="dealer">D</span>
            </span>
            <button
              type="button"
              class="plaque__stack money stack-toggle"
              aria-label="スタック表示の単位を切り替え"
              @click="toggleStackUnit"
            >{{ formatStack(myStackDisplay) }}</button>
          </div>
          <!-- オールインマーカー -->
          <div v-if="mySeatState?.allin" class="allin-marker">ALL IN</div>
        </section>

        <!-- 絵文字リアクション（相手とのコミュニケーション） -->
        <EmojiReactions
          v-if="room.status !== 'finished' && opponent"
          ref="reactionsRef"
          :self-name="me?.displayName ?? 'あなた'"
          @send="sendEmoji"
        />

        <!-- 対局終了オーバーレイ（最終ハンドのランアウト演出が終わってから表示） -->
        <div v-if="room.status === 'finished' && (!hand.result || resultVisible)" class="finished">
          <div class="finished__inner">
            <div class="finished__trophy">{{ room.winnerSeat === yourSeat ? '🏆' : '♠' }}</div>
            <h2>{{ room.winnerSeat === yourSeat ? 'あなたの優勝！' : '対局終了' }}</h2>
            <p class="muted">勝者: {{ room.winnerSeat === yourSeat ? 'あなた' : opponent?.displayName }}</p>
            <button class="btn btn--primary full" @click="leave">ロビーへ戻る</button>
          </div>
        </div>
      </main>

      <!-- 操作ドック（親指が届く最下部・セーフエリア対応） -->
      <div v-if="room.status !== 'finished'" class="dock-area">
        <!-- タイマーは常設スロットに置き、手番/結果表示に関わらず位置を固定する -->
        <div class="timer-slot">
          <div
            v-if="!hand.result && hand.actionDeadline"
            class="timer"
            :class="{ 'timer--opp': isOppTurn, 'timer--low': !isOppTurn && timePct < 30 }"
          >
            <div class="timer__bar" :style="{ width: timePct + '%' }" />
          </div>
        </div>

        <ActionDock
          v-if="isMyTurn && legal"
          :legal="legal"
          :pot="hand.pot"
          :current-bet="hand.currentBet"
          :bb="hand.bb"
          :chip-unit="room.config.chipUnit"
          :bb-mode="stackInBB"
          :pending="acting"
          @act="doAct"
        />
        <div v-else-if="!hand.result" class="waiting-turn waiting-turn--opp">
          <span class="waiting-turn__avatar" aria-hidden="true">
            {{ (opponent?.displayName ?? '?').slice(0, 1) }}
          </span>
          <span class="waiting-turn__text">
            <b>{{ opponent?.displayName ?? '相手' }}</b> が考え中<span class="thinking-dots"><span>・</span><span>・</span><span>・</span></span>
          </span>
        </div>
        <div v-else class="waiting-turn waiting-turn--result">
          {{ resultVisible ? '次のハンドを準備中…' : 'ショーダウン' }}
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ============ 画面骨格（スマホ縦持ち前提） ============ */
.room {
  max-width: 480px;
  margin: 0 auto;
  padding: 0.5rem 0.6rem 0;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}

/* ゲーム画面は情報密度が高いので行間を詰める（本文の 1.55 を上書き） */
.topbar,
.table,
.dock-area {
  line-height: 1.3;
}

/* ---- トップバー ---- */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  padding: 0.1rem 0 0.45rem;
}
.topbar__mid {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
  justify-content: center;
  min-width: 0;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border);
  border-radius: 1rem;
  padding: 0.2rem 0.6rem;
  font-size: 0.72rem;
  color: var(--text);
  white-space: nowrap;
}
.chip b {
  color: var(--accent);
  font-weight: 700;
}
.chip--dim {
  color: var(--muted);
}
.code-btn {
  letter-spacing: 0.1em;
  font-family: var(--font-display);
  font-weight: 600;
}

/* ---- 汎用 ---- */
.center {
  flex: 1;
  display: grid;
  place-items: center;
  padding: 1.5rem 0 3rem;
}
.gate {
  width: 100%;
  max-width: 340px;
  text-align: center;
}
.gate h2 {
  margin: 0 0 1rem;
  font-size: 1.2rem;
}
.gate .input {
  margin-bottom: 0.85rem;
  text-align: center;
}
.full {
  width: 100%;
}
.bigcode {
  position: relative;
  font-size: 2.4rem;
  font-family: var(--font-display);
  font-weight: 700;
  color: var(--text);
  letter-spacing: 0.28em;
  text-indent: 0.28em; /* letter-spacing 分の右寄り補正 */
  background: rgba(255, 255, 255, 0.04);
  border: 1px dashed var(--border-strong);
  border-radius: 1rem;
  padding: 1.1rem 0.5rem 1.6rem;
  margin: 1rem 0;
  cursor: pointer;
}
.bigcode__hint {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0.45rem;
  font-family: var(--font-body);
  font-size: 0.68rem;
  letter-spacing: 0.1em;
  text-indent: 0;
  color: var(--muted);
}
.share-url {
  margin: -0.35rem 0 1rem;
}
.waiting-players {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-bottom: 1rem;
}
.wp {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: center;
}
.dot {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 50%;
  background: #454d56;
}
.dot.on {
  background: var(--accent);
  box-shadow: 0 0 8px rgba(43, 196, 126, 0.7);
}

/* ============ テーブル ============ */
.table {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 0.3rem;
  border-radius: 1.4rem;
  padding: 0.65rem 0.6rem;
  overflow: hidden;
  border: 1px solid var(--border);
  box-shadow:
    inset 0 12px 50px rgba(0, 0, 0, 0.4),
    0 10px 30px rgba(0, 0, 0, 0.35);
}
.table__felt {
  position: absolute;
  inset: 0;
  background: var(--felt);
  z-index: -2;
}
/* フェルトの布目（ノイズ） */
.table__felt::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E");
  opacity: 0.07;
  mix-blend-mode: overlay;
}
.table__mark {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -54%);
  font-size: 10rem;
  line-height: 1;
  color: rgba(0, 0, 0, 0.15);
  z-index: -1;
  pointer-events: none;
}

/* ---- 席 ---- */
.seat {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.32rem;
  transition: opacity 0.25s;
}

/* ---- 相手アクションの実況 ---- */
.action-bubble {
  position: absolute;
  top: -0.45rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 7;
  background: var(--amber);
  color: #2b1c04;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.03em;
  padding: 0.28rem 0.75rem;
  border-radius: 1rem;
  white-space: nowrap;
  box-shadow: 0 6px 20px rgba(240, 178, 79, 0.4);
  pointer-events: none;
}
.bubble-enter-active {
  transition: opacity 0.25s ease, transform 0.25s cubic-bezier(0.2, 1.4, 0.4, 1);
}
.bubble-leave-active {
  transition: opacity 0.3s ease;
}
.bubble-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(6px) scale(0.85);
}
.bubble-leave-to {
  opacity: 0;
}
.seat.folded {
  opacity: 0.4;
}

.plaque {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: rgba(11, 13, 16, 0.88);
  border: 1px solid var(--border-strong);
  border-radius: 2rem;
  padding: 0.24rem 0.75rem 0.24rem 0.24rem;
  max-width: 100%;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  transition: border-color 0.25s, box-shadow 0.25s;
}
.seat.active .plaque {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px rgba(43, 196, 126, 0.35), 0 0 20px rgba(43, 196, 126, 0.3);
}
/* 手番の色分け: 自分 = グリーン / 相手 = アンバー（どちらの番か一目で分かるように） */
.seat--opp.active .plaque {
  border-color: var(--amber);
  box-shadow: 0 0 0 1px rgba(240, 178, 79, 0.35), 0 0 20px rgba(240, 178, 79, 0.28);
}
.seat--opp .avatar--think {
  animation-name: thinkAmber;
}
@keyframes thinkAmber {
  0%, 100% { box-shadow: 0 0 0 0 rgba(240, 178, 79, 0.5); }
  50% { box-shadow: 0 0 0 6px rgba(240, 178, 79, 0); }
}
.avatar {
  width: 1.9rem;
  height: 1.9rem;
  border-radius: 50%;
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  display: grid;
  place-items: center;
  font-weight: 800;
  font-size: 0.95rem;
  color: var(--text);
  flex-shrink: 0;
}
.avatar--me {
  background: var(--accent-soft);
  border-color: rgba(43, 196, 126, 0.5);
  color: var(--accent);
}
.avatar--think {
  animation: think 1.6s ease-in-out infinite;
}
@keyframes think {
  0%, 100% { box-shadow: 0 0 0 0 rgba(43, 196, 126, 0.45); }
  50% { box-shadow: 0 0 0 6px rgba(43, 196, 126, 0); }
}
.plaque__name {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8rem;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.plaque__stack {
  font-size: 1.02rem;
  color: var(--text);
  white-space: nowrap;
}
/* スタックはタップで チップ ⇔ BB 表示を切り替えられる */
.stack-toggle {
  background: none;
  border: none;
  padding: 0;
  font-family: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.stack-toggle:active {
  opacity: 0.65;
}
.ai-tag {
  background: var(--accent-soft);
  border: 1px solid rgba(43, 196, 126, 0.45);
  color: var(--accent);
  font-size: 0.58rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  border-radius: 0.35rem;
  padding: 0.05rem 0.3rem;
  flex-shrink: 0;
}
.dealer {
  background: #f5f6f7;
  color: #14171c;
  font-size: 0.6rem;
  width: 1.05rem;
  height: 1.05rem;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  flex-shrink: 0;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}
/* ---- オールインマーカー（テーブルに置く札風） ---- */
.allin-marker {
  position: absolute;
  left: 50%;
  z-index: 6;
  transform: translateX(-50%) rotate(-7deg);
  background: linear-gradient(180deg, rgba(96, 18, 14, 0.94), rgba(58, 10, 8, 0.94));
  border: 2px solid rgba(242, 86, 77, 0.85);
  color: #ffb3ac;
  font-family: var(--font-display);
  font-weight: 800;
  font-size: 0.82rem;
  letter-spacing: 0.16em;
  text-indent: 0.16em;
  padding: 0.28rem 0.9rem;
  border-radius: 0.55rem;
  white-space: nowrap;
  box-shadow: 0 6px 22px rgba(242, 86, 77, 0.35), inset 0 0 12px rgba(242, 86, 77, 0.22);
  pointer-events: none;
  animation: stamp 0.3s cubic-bezier(0.2, 1.4, 0.4, 1);
}
/* 相手席はプレート下（カードに少し掛かる位置）、自席はカード下部に重ねる */
.seat--opp .allin-marker {
  top: 2.55rem;
}
.seat--me .allin-marker {
  bottom: 2.9rem;
}
@keyframes stamp {
  0% {
    opacity: 0;
    transform: translateX(-50%) rotate(-7deg) scale(1.7);
  }
  100% {
    opacity: 1;
    transform: translateX(-50%) rotate(-7deg) scale(1);
  }
}

.hole {
  display: flex;
  gap: 0.35rem;
  position: relative;
}
.hole--opp :deep(.card) {
  --w: clamp(1.9rem, 10vw, 2.2rem);
}
.hole--mine :deep(.card) {
  --w: clamp(3.2rem, 18vw, 3.9rem);
}
.hole--mine {
  filter: drop-shadow(0 8px 16px rgba(0, 0, 0, 0.45));
}

.betpill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(240, 178, 79, 0.4);
  color: var(--amber);
  border-radius: 1rem;
  padding: 0.16rem 0.6rem;
  font-size: 0.82rem;
}
.betpill__coin {
  width: 0.72rem;
  height: 0.72rem;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #ffd88f, var(--amber) 60%, #a06f22 100%);
  box-shadow: 0 0 0 1.5px rgba(0, 0, 0, 0.35);
}
.betpill__act {
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: var(--amber);
}

/* ---- ショーダウンのハンド表示（ボード上部の帯・レイアウトを押し下げない） ---- */
.sd-hands {
  position: absolute;
  bottom: calc(100% + 0.35rem);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 0.7rem;
  z-index: 4;
  pointer-events: none;
  max-width: 100%;
}
.sd-hand {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: rgba(11, 13, 16, 0.85);
  border: 1px solid var(--border-strong);
  border-radius: 0.8rem;
  padding: 0.3rem 0.55rem;
  transition: border-color 0.3s, box-shadow 0.3s, opacity 0.3s;
}
.sd-hand__label {
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--muted);
  max-width: 5.5em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sd-hand__cards {
  display: flex;
  gap: 0.25rem;
}
.sd-hand__cards :deep(.card) {
  --w: clamp(1.9rem, 9vw, 2.3rem);
}
.sd-hand--win {
  border-color: rgba(43, 196, 126, 0.65);
  box-shadow: 0 0 16px rgba(43, 196, 126, 0.35);
}
.sd-hand--win .sd-hand__label {
  color: var(--accent);
}
.sd-hand--lose {
  opacity: 0.62;
}
.sdfade-enter-active {
  transition: opacity 0.35s ease, transform 0.35s ease;
}
.sdfade-leave-active {
  transition: opacity 0.2s ease;
}
.sdfade-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
.sdfade-leave-to {
  opacity: 0;
}

/* ---- ボード ---- */
.board-area {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.45rem;
  padding: 0.2rem 0;
}
.pot {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid var(--border);
  border-radius: 1.2rem;
  padding: 0.2rem 0.85rem;
}
.pot__label {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.pot__value {
  font-size: 1.1rem;
  color: var(--amber);
}
.board {
  display: flex;
  gap: clamp(0.25rem, 1.5vw, 0.45rem);
  justify-content: center;
  position: relative;
  perspective: 800px;
}
.board :deep(.card) {
  --w: clamp(2.5rem, 13.5vw, 3rem);
}
.board .ghost {
  opacity: 0.14;
}

/* ---- 結果バナー ----
   ボード/相手のカードを確認しながら読めるよう、ボード領域の直下に出す
   （中央に被せない）。ピルは結果表示時に消えるため、この帯は空いている */
.result {
  position: absolute;
  left: 50%;
  top: calc(100% + 0.45rem);
  transform: translateX(-50%);
  z-index: 5;
  min-width: 230px;
  max-width: 94%;
  text-align: center;
  background: var(--overlay);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid var(--border-strong);
  border-radius: 1.1rem;
  padding: 0.6rem 1.1rem;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
}
.result__title {
  font-weight: 800;
  font-size: 1.05rem;
  color: var(--text);
}
/* 勝敗の色分け: 勝ち=グリーン / 負け=レッド / スプリット=アンバー */
.result--win {
  border-color: rgba(43, 196, 126, 0.65);
  background:
    linear-gradient(180deg, rgba(43, 196, 126, 0.16), rgba(43, 196, 126, 0.02)),
    var(--overlay);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55), 0 0 26px rgba(43, 196, 126, 0.35);
}
.result--win .result__title {
  color: var(--accent);
}
.result--lose {
  border-color: rgba(242, 86, 77, 0.6);
  background:
    linear-gradient(180deg, rgba(242, 86, 77, 0.14), rgba(242, 86, 77, 0.02)),
    var(--overlay);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55), 0 0 26px rgba(242, 86, 77, 0.3);
}
.result--lose .result__title {
  color: #ff8a80;
}
.result--split {
  border-color: rgba(240, 178, 79, 0.55);
  background:
    linear-gradient(180deg, rgba(240, 178, 79, 0.14), rgba(240, 178, 79, 0.02)),
    var(--overlay);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55), 0 0 24px rgba(240, 178, 79, 0.3);
}
.result--split .result__title {
  color: var(--amber);
}
.result__sub {
  margin-top: 0.3rem;
  font-size: 0.85rem;
  color: var(--text);
}
.result__descr {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.8rem;
  color: var(--muted);
  margin-top: 0.4rem;
}
/* ---- 手番フラッシュ（ボードを隠さないよう、ボード下の帯に表示） ---- */
.turn-flash {
  position: absolute;
  left: 50%;
  top: calc(100% + 0.45rem);
  transform: translateX(-50%);
  z-index: 6;
  background: var(--accent);
  color: #052a1a;
  font-weight: 800;
  font-size: 1rem;
  letter-spacing: 0.06em;
  padding: 0.55rem 1.3rem;
  border-radius: 2rem;
  white-space: nowrap;
  box-shadow: 0 8px 30px rgba(43, 196, 126, 0.45);
  pointer-events: none;
}

.pop-enter-active {
  transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.2, 1.4, 0.4, 1);
}
.pop-leave-active {
  transition: opacity 0.2s ease;
}
.pop-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(8px) scale(0.85);
}
.pop-leave-to {
  opacity: 0;
}
/* 結果バナー用（基準 transform が translateX のみのため専用に定義） */
.result-pop-enter-active {
  transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.2, 1.4, 0.4, 1);
}
.result-pop-leave-active {
  transition: opacity 0.2s ease;
}
.result-pop-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(10px) scale(0.9);
}
.result-pop-leave-to {
  opacity: 0;
}

/* ============ カード配布/公開アニメーション ============ */
.deal-enter-active {
  transition: transform 0.5s cubic-bezier(0.2, 0.9, 0.25, 1), opacity 0.5s ease;
}
.deal-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
  position: absolute;
}
.deal-enter-from {
  opacity: 0;
  transform: translateY(-150px) translateX(-30px) rotate(-14deg) scale(0.65);
}
.deal-leave-to {
  opacity: 0;
  transform: rotateY(90deg) scale(0.9);
}
.hole .deal-enter-active:nth-child(2) {
  transition-delay: 0.14s;
}

.reveal-enter-active {
  transition: transform 0.5s cubic-bezier(0.2, 0.8, 0.3, 1), opacity 0.5s ease;
  transform-style: preserve-3d;
}
.reveal-leave-active {
  transition: opacity 0.3s ease;
  position: absolute;
}
.reveal-move {
  transition: transform 0.4s ease;
}
.reveal-enter-from {
  opacity: 0;
  transform: rotateY(-90deg) translateY(-14px) scale(0.92);
}
.reveal-leave-to {
  opacity: 0;
}
.board .reveal-enter-active:nth-child(2) {
  transition-delay: 0.12s;
}
.board .reveal-enter-active:nth-child(3) {
  transition-delay: 0.24s;
}

/* ============ 操作ドック ============ */
.dock-area {
  position: sticky;
  bottom: 0;
  z-index: 10;
  margin: 0.4rem -0.6rem 0;
  padding: 0.45rem 0.6rem calc(0.55rem + var(--safe-bottom));
  background: linear-gradient(180deg, rgba(7, 11, 9, 0), rgba(7, 11, 9, 0.97) 12%, var(--bg) 40%);
  /* 手番/待機でドックの高さが変わってもテーブル（カード位置）が上下しないよう、
     最大時（タイマー＋サイザー＋アクション行）の高さを常に確保する。
     タイマーは上部の常設スロット、本文は残り全体（内容は下寄せ）で位置が揺れない */
  min-height: calc(12rem + var(--safe-bottom));
  display: flex;
  flex-direction: column;
}
.timer-slot {
  height: 0.3rem;
  margin-bottom: 0.45rem;
  flex-shrink: 0;
}
.timer {
  position: relative;
  height: 100%;
  background: rgba(255, 255, 255, 0.07);
  border-radius: 1rem;
  overflow: hidden;
}
/* 本文（アクションパネル/待機ボックス）は残り高さを使い切る */
.dock-area :deep(.dock) {
  flex: 1;
  justify-content: flex-end;
}
.timer__bar {
  height: 100%;
  border-radius: 1rem;
  background: var(--accent);
  transition: width 1s linear, background 0.3s;
}
.timer--low .timer__bar {
  background: var(--danger);
}
.timer--opp .timer__bar {
  background: rgba(240, 178, 79, 0.55);
}
.waiting-turn {
  flex: 1; /* タイマー位置を固定するため、ドックの残り高さを使い切る */
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: 58px;
  color: var(--muted);
  font-size: 0.9rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px dashed var(--border);
  border-radius: 0.9rem;
}
/* 相手の手番: アンバー系で「待ち」を明確に */
.waiting-turn--opp {
  border-style: solid;
  border-color: rgba(240, 178, 79, 0.4);
  background: rgba(240, 178, 79, 0.06);
  color: var(--text);
}
.waiting-turn--opp b {
  font-weight: 700;
}
.waiting-turn__avatar {
  width: 1.7rem;
  height: 1.7rem;
  border-radius: 50%;
  display: inline-grid;
  place-items: center;
  background: rgba(240, 178, 79, 0.15);
  border: 1px solid rgba(240, 178, 79, 0.5);
  color: var(--amber);
  font-weight: 800;
  font-size: 0.85rem;
  flex-shrink: 0;
  animation: thinkAmber 1.6s ease-in-out infinite;
}
.thinking-dots span {
  display: inline-block;
  animation: dotBlink 1.4s ease-in-out infinite;
}
.thinking-dots span:nth-child(2) {
  animation-delay: 0.2s;
}
.thinking-dots span:nth-child(3) {
  animation-delay: 0.4s;
}
@keyframes dotBlink {
  0%, 60%, 100% { opacity: 0.25; }
  30% { opacity: 1; }
}

/* ---- 対局終了 ---- */
.finished {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  background: rgba(5, 7, 9, 0.8);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border-radius: 1.4rem;
}
.finished__inner {
  text-align: center;
  padding: 2rem 1.5rem;
  width: min(320px, 88%);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 1.4rem;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
}
.finished__trophy {
  font-size: 3rem;
  margin-bottom: 0.4rem;
}
.finished h2 {
  margin: 0 0 0.4rem;
  font-size: 1.3rem;
  color: var(--text);
}
.finished .btn {
  margin-top: 1.1rem;
}

.error {
  color: var(--danger);
  text-align: center;
  margin: 0.25rem 0;
}
.muted {
  color: var(--muted);
}
.small {
  font-size: 0.8rem;
}

@media (prefers-reduced-motion: reduce) {
  .deal-enter-active,
  .deal-leave-active,
  .reveal-enter-active,
  .reveal-leave-active,
  .reveal-move,
  .pop-enter-active,
  .result-pop-enter-active,
  .bubble-enter-active,
  .sdfade-enter-active,
  .allin-marker,
  .avatar--think,
  .waiting-turn__avatar,
  .thinking-dots span {
    transition: none;
    animation: none;
  }
}
</style>
