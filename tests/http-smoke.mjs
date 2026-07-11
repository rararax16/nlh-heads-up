// HTTP + 認証層のスモークテスト（dev サーバーが 3001、supabase がローカルで稼働している前提）
import { createClient } from '@supabase/supabase-js'

const BASE = process.env.BASE || 'http://localhost:3001'
const URL = 'http://127.0.0.1:54321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

async function anonToken() {
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signInAnonymously()
  if (error) throw error
  return data.session.access_token
}

async function api(token, path, method = 'GET', body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, json }
}

const a = await anonToken()
const b = await anonToken()

console.log('1) create room (A)')
const create = await api(a, '/api/rooms', 'POST', {
  displayName: 'Alice', initialStack: 300, startingBb: 50, blindIntervalSeconds: 99999,
})
console.log('  ', create.status, create.json)
if (create.status !== 200) process.exit(1)
const code = create.json.code

console.log('2) join room (B)')
console.log('  ', (await api(b, `/api/rooms/${code}/join`, 'POST', { displayName: 'Bob' })).json)

console.log('3) start (A)')
console.log('  ', (await api(a, `/api/rooms/${code}/start`, 'POST')).json)

console.log('4) state (A) — 自分のカードが見えるか / 相手のカードは隠れているか')
const sA = await api(a, `/api/rooms/${code}/state`)
console.log('   status', sA.status, 'yourSeat', sA.json.yourSeat, 'myCards', sA.json.myCards, 'street', sA.json.hand?.street, 'toAct', sA.json.hand?.toActSeat)

const sB = await api(b, `/api/rooms/${code}/state`)
console.log('   B myCards', sB.json.myCards, '(A と異なるはず)')

console.log('5) 数手アクションを流す')
for (let i = 0; i < 6; i++) {
  const v = await api(a, `/api/rooms/${code}/state`)
  const hand = v.json.hand
  if (!hand || hand.result) { console.log('   hand over:', hand?.result?.reason); break }
  const toSeat = hand.toActSeat
  const actor = toSeat === v.json.yourSeat ? a : b
  const vv = await api(actor, `/api/rooms/${code}/state`)
  const legal = vv.json.legalActions
  let act
  if (legal.canCheck) act = { type: 'check' }
  else if (legal.canCall) act = { type: 'call' }
  else act = { type: 'fold' }
  const r = await api(actor, `/api/rooms/${code}/action`, 'POST', act)
  console.log(`   seat ${toSeat} -> ${act.type}:`, r.status, r.json.statusMessage ?? 'ok')
}

console.log('\n✅ HTTP スモーク完了')
