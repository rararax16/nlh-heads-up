<script setup lang="ts">
import type { LobbyRoom, RoomView } from '~~/shared/types'

const displayName = useDisplayName()
const router = useRouter()
const api = useApi()
const error = ref<string | null>(null)
const creating = ref(false)
const joinCode = ref('')
const activeRoom = useActiveRoom()

// 部屋作成フォーム
const form = reactive({
  name: '',
  isPublic: true,
  initialStack: 10000,
  startingBb: 200,
  blindIntervalMinutes: 5,
  actionTimeoutSeconds: 30,
  anteMode: 'bb' as 'bb' | 'none',
  chipUnit: 100,
})

// 着席中の部屋があれば「対局に戻る」導線を出す（終了済みなら記録を掃除）
const resumeRoom = ref<{ code: string; status: string } | null>(null)
onMounted(async () => {
  const code = activeRoom.value ?? localStorage.getItem('activeRoomCode')
  if (!code) return
  try {
    const v = await api<RoomView>(`/api/rooms/${code}/state`)
    if (v.yourSeat !== null && v.room.status !== 'finished') {
      resumeRoom.value = { code: v.room.code, status: v.room.status }
    } else {
      activeRoom.value = null
    }
  } catch {
    activeRoom.value = null
  }
})

const { data: rooms, refresh } = await useAsyncData<LobbyRoom[]>(
  'lobby',
  () => api('/api/rooms'),
  { default: () => [], server: false },
)

function requireName(): boolean {
  if (!displayName.value.trim()) {
    error.value = '表示名を入力してください'
    return false
  }
  return true
}

async function createRoom() {
  error.value = null
  if (!requireName()) return
  creating.value = true
  try {
    const res = await api<{ code: string }>('/api/rooms', {
      method: 'POST',
      body: {
        displayName: displayName.value.trim(),
        name: form.name.trim() || null,
        isPublic: form.isPublic,
        initialStack: form.initialStack,
        startingBb: form.startingBb,
        blindIntervalSeconds: form.blindIntervalMinutes * 60,
        actionTimeoutSeconds: form.actionTimeoutSeconds,
        anteMode: form.anteMode,
        chipUnit: form.chipUnit,
      },
    })
    router.push(`/room/${res.code}`)
  } catch (e: unknown) {
    error.value = extractError(e)
  } finally {
    creating.value = false
  }
}

async function joinByCode() {
  error.value = null
  if (!requireName()) return
  const code = joinCode.value.trim().toUpperCase()
  if (!code) {
    error.value = '部屋コードを入力してください'
    return
  }
  router.push(`/room/${code}`)
}

function joinLobbyRoom(code: string) {
  if (!requireName()) return
  router.push(`/room/${code}`)
}

function extractError(e: unknown): string {
  const d = (e as { data?: { statusMessage?: string } })?.data
  return d?.statusMessage ?? 'エラーが発生しました'
}
</script>

<template>
  <div class="lobby">
    <header class="hero">
      <div class="hero__spade" aria-hidden="true">♠</div>
      <h1 class="hero__title">NLH ヘッズアップ</h1>
      <p class="hero__sub">リアルタイム 1vs1 ポーカー ・ トーナメントルール</p>
    </header>

    <div class="stack">
      <div class="card-panel">
        <label for="dn">あなたの表示名</label>
        <input id="dn" v-model="displayName" class="input" placeholder="例: たくや" maxlength="20" />
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <!-- 進行中の対局へ戻る -->
      <section v-if="resumeRoom" class="card-panel resume">
        <div class="resume__info">
          <strong>{{ resumeRoom.status === 'playing' ? '対局中のテーブルがあります' : '待機中のテーブルがあります' }}</strong>
          <span class="badge money">{{ resumeRoom.code }}</span>
        </div>
        <button class="btn btn--primary" @click="router.push(`/room/${resumeRoom.code}`)">
          対局に戻る
        </button>
      </section>

      <!-- コードで参加 -->
      <section class="card-panel">
        <h2><span class="h-icon">⇢</span> コードで参加</h2>
        <div class="join-row">
          <input
            v-model="joinCode"
            class="input code-input money"
            placeholder="ABC123"
            maxlength="8"
            autocapitalize="characters"
            autocomplete="off"
            @keyup.enter="joinByCode"
          />
          <button class="btn btn--primary" @click="joinByCode">入室</button>
        </div>

        <div class="lobby__list">
          <div class="list-head">
            <h3>公開中の部屋</h3>
            <button class="btn tiny btn--ghost" @click="refresh()">更新</button>
          </div>
          <p v-if="!rooms || rooms.length === 0" class="muted small empty">募集中の部屋はありません</p>
          <ul v-else>
            <li v-for="r in rooms" :key="r.id" class="room-row">
              <div class="room-row__info">
                <div class="room-row__top">
                  <strong>{{ r.name || '無名の部屋' }}</strong>
                  <span class="badge money">{{ r.code }}</span>
                </div>
                <div class="muted small">
                  スタック <span class="money">{{ formatChips(r.config.initialStack) }}</span>
                  ・ SB {{ r.config.startingBlinds.sb }}/{{ r.config.startingBlinds.bb }}
                  ・ {{ r.playerCount }}/2人
                </div>
              </div>
              <button
                class="btn tiny"
                :disabled="r.playerCount >= 2"
                @click="joinLobbyRoom(r.code)"
              >
                {{ r.playerCount >= 2 ? '満席' : '参加' }}
              </button>
            </li>
          </ul>
        </div>
      </section>

      <!-- 部屋を作る -->
      <section class="card-panel">
        <h2><span class="h-icon">＋</span> 部屋を作る</h2>
        <div class="field">
          <label>部屋名（任意）</label>
          <input v-model="form.name" class="input" placeholder="フレンドマッチ" maxlength="30" />
        </div>
        <div class="field">
          <label>公開設定</label>
          <select v-model="form.isPublic" class="input">
            <option :value="true">公開（ロビーに表示）</option>
            <option :value="false">非公開（コード共有のみ）</option>
          </select>
        </div>

        <details class="advanced">
          <summary>
            詳細設定
            <span class="advanced__summary muted small">
              スタック {{ formatChips(form.initialStack) }} ・ BB {{ form.startingBb }} ・ {{ form.blindIntervalMinutes }}分 ・ {{ form.actionTimeoutSeconds }}秒
            </span>
          </summary>
          <div class="row">
            <div class="field">
              <label>初期スタック</label>
              <input v-model.number="form.initialStack" type="number" inputmode="numeric" class="input" min="100" step="100" />
            </div>
            <div class="field">
              <label>開始 BB</label>
              <input v-model.number="form.startingBb" type="number" inputmode="numeric" class="input" min="2" step="2" />
            </div>
          </div>
          <div class="row">
            <div class="field">
              <label>ブラインド上昇（分）</label>
              <input v-model.number="form.blindIntervalMinutes" type="number" inputmode="numeric" class="input" min="1" step="1" />
            </div>
            <div class="field">
              <label>持ち時間（秒/手）</label>
              <input v-model.number="form.actionTimeoutSeconds" type="number" inputmode="numeric" class="input" min="5" step="5" />
            </div>
          </div>
          <div class="row">
            <div class="field">
              <label>アンティ</label>
              <select v-model="form.anteMode" class="input">
                <option value="bb">BBアンティ</option>
                <option value="none">なし</option>
              </select>
            </div>
            <div class="field">
              <label>最小チップ単位</label>
              <select v-model.number="form.chipUnit" class="input">
                <option :value="1">なし</option>
                <option :value="25">25</option>
                <option :value="100">100</option>
                <option :value="500">500</option>
              </select>
            </div>
          </div>
        </details>

        <button class="btn btn--primary full" :disabled="creating" @click="createRoom">
          {{ creating ? '作成中…' : '部屋を作成して入室' }}
        </button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.lobby {
  max-width: 520px;
  margin: 0 auto;
  padding: 1.6rem 1rem calc(3rem + var(--safe-bottom));
}

/* ---- ヒーロー ---- */
.hero {
  text-align: center;
  margin-bottom: 1.6rem;
}
.hero__spade {
  font-size: 2.8rem;
  line-height: 1;
  color: var(--accent);
  text-shadow: 0 0 28px rgba(43, 196, 126, 0.4);
  margin-bottom: 0.35rem;
}
.hero__title {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 1.7rem;
  letter-spacing: 0.04em;
  color: var(--text);
}
.hero__sub {
  color: var(--muted);
  margin: 0.35rem 0 0;
  font-size: 0.85rem;
  letter-spacing: 0.02em;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

h2 {
  margin: 0 0 1rem;
  font-size: 1.05rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.h-icon {
  display: inline-grid;
  place-items: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 0.5rem;
  background: var(--accent-soft);
  border: 1px solid rgba(43, 196, 126, 0.35);
  color: var(--accent);
  font-size: 0.85rem;
}

.field {
  margin-bottom: 0.85rem;
  flex: 1;
  min-width: 0;
}
.row {
  display: flex;
  gap: 0.7rem;
}
.full {
  width: 100%;
  margin-top: 0.4rem;
}

/* ---- コード参加 ---- */
.join-row {
  display: flex;
  gap: 0.5rem;
}
.join-row .btn {
  flex-shrink: 0;
}
.code-input {
  text-transform: uppercase;
  letter-spacing: 0.25em;
  font-size: 1.15rem;
  text-align: center;
}

/* ---- 詳細設定 ---- */
.advanced {
  border: 1px solid var(--border);
  border-radius: 0.8rem;
  padding: 0 0.85rem;
  margin-bottom: 0.9rem;
  background: rgba(0, 0, 0, 0.2);
}
.advanced summary {
  cursor: pointer;
  padding: 0.75rem 0;
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--text);
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  -webkit-user-select: none;
  user-select: none;
}
.advanced summary::-webkit-details-marker {
  display: none;
}
.advanced summary::after {
  content: '▾';
  position: absolute;
  right: 2rem;
  color: var(--muted);
}
.advanced {
  position: relative;
}
.advanced[open] summary::after {
  content: '▴';
}
.advanced[open] summary {
  border-bottom: 1px solid var(--border);
  margin-bottom: 0.85rem;
}
.advanced__summary {
  font-weight: 400;
}

/* ---- 公開部屋リスト ---- */
.lobby__list {
  margin-top: 1.1rem;
  border-top: 1px solid var(--border);
  padding-top: 0.9rem;
}
.list-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
h3 {
  margin: 0;
  font-size: 0.9rem;
  color: var(--muted);
  font-weight: 600;
  letter-spacing: 0.04em;
}
ul {
  list-style: none;
  padding: 0;
  margin: 0.4rem 0 0;
}
.room-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.7rem 0;
  border-bottom: 1px solid var(--border);
  gap: 0.6rem;
}
.room-row:last-child {
  border-bottom: none;
}
.room-row__info {
  min-width: 0;
}
.room-row__top {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.15rem;
}
.room-row__top strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-strong);
  color: var(--text);
  border-radius: 0.45rem;
  padding: 0.08rem 0.45rem;
  font-size: 0.75rem;
  letter-spacing: 0.1em;
  flex-shrink: 0;
}
.empty {
  padding: 0.6rem 0 0.2rem;
  text-align: center;
}

/* ---- 対局に戻るバナー ---- */
.resume {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.7rem;
  border-color: rgba(43, 196, 126, 0.45);
  box-shadow: 0 0 0 1px rgba(43, 196, 126, 0.15), 0 6px 24px rgba(43, 196, 126, 0.12);
}
.resume__info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  min-width: 0;
}
.resume .btn {
  flex-shrink: 0;
}

.error {
  color: var(--danger);
  text-align: center;
  margin: 0;
}
.muted {
  color: var(--muted);
}
.small {
  font-size: 0.78rem;
}
</style>
