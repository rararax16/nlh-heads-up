import { describe, it, expect } from 'vitest'
import {
  startHand,
  applyAction,
  legalActions,
  pot,
  type EngineHand,
} from '../server/game/engine'

const players = (s0 = 10000, s1 = 10000) => [
  { seat: 0, userId: 'u0', stack: s0 },
  { seat: 1, userId: 'u1', stack: s1 },
]

// button=0 → seat0 = SB, seat1 = BB
function deal(deck: string[], opts: Partial<Parameters<typeof startHand>[0]> = {}): EngineHand {
  return startHand({
    handNumber: 1,
    buttonSeat: 0,
    level: 1,
    sb: 25,
    bb: 50,
    ante: 50,
    anteMode: 'bb',
    players: players(),
    deck,
    ...opts,
  })
}

describe('startHand: ブラインドとアンティ', () => {
  it('SBとBBとBBアンティを正しく徴収する', () => {
    const h = deal(['As', 'Ks', '2d', '3c', 'Ah', 'Kh', 'Qh', 'Jd', 'Td'])
    expect(h.seats[0]!.committed).toBe(25) // SB
    expect(h.seats[0]!.stack).toBe(9975)
    expect(h.seats[1]!.committed).toBe(50) // BB
    expect(h.seats[1]!.stack).toBe(9900) // -50(BB) -50(ante)
    expect(h.deadMoney).toBe(50) // ante
    expect(h.currentBet).toBe(50)
    expect(pot(h)).toBe(125) // 50 + 25 + 50
    expect(h.toActSeat).toBe(0) // プリフロップは SB(ボタン) から
  })

  it('各席2枚ずつ配札される', () => {
    const h = deal(['As', 'Ks', '2d', '3c', 'Ah', 'Kh', 'Qh', 'Jd', 'Td'])
    expect(h.seats[0]!.hole).toEqual(['As', 'Ks'])
    expect(h.seats[1]!.hole).toEqual(['2d', '3c'])
  })
})

describe('プリフロップの手番順とBBオプション', () => {
  it('SBコール→BBの手番→BBチェックでフロップへ、フロップはBB先手', () => {
    const h = deal(['As', 'Ks', '2d', '3c', 'Ah', 'Kh', 'Qh', 'Jd', 'Td'])
    // SB がコール
    applyAction(h, 0, { type: 'call' })
    expect(h.seats[0]!.streetCommitted).toBe(50)
    expect(h.toActSeat).toBe(1) // BB のオプション
    expect(h.street).toBe('preflop')
    // BB がチェック → フロップへ
    applyAction(h, 1, { type: 'check' })
    expect(h.street).toBe('flop')
    expect(h.board.length).toBe(3)
    expect(h.toActSeat).toBe(1) // フロップは BB(非ボタン) 先手
  })

  it('手番でない席はアクションできない', () => {
    const h = deal(['As', 'Ks', '2d', '3c', 'Ah', 'Kh', 'Qh', 'Jd', 'Td'])
    expect(() => applyAction(h, 1, { type: 'check' })).toThrow()
  })
})

describe('フォールド決着', () => {
  it('SBフォールドでBBがポットを獲得、カードは非公開', () => {
    const h = deal(['As', 'Ks', '2d', '3c', 'Ah', 'Kh', 'Qh', 'Jd', 'Td'])
    applyAction(h, 0, { type: 'fold' })
    expect(h.street).toBe('complete')
    expect(h.result!.reason).toBe('fold')
    expect(h.result!.winners).toEqual([1])
    expect(h.result!.potWon).toBe(125)
    expect(h.seats[1]!.stack).toBe(9900 + 125)
    expect(h.result!.showdown).toBeUndefined()
  })
})

describe('ショーダウン決着', () => {
  it('リバーまでチェックダウンして強い手が勝つ', () => {
    // seat0: Ac Ad, seat1: 2c 7d, board: As Kh Qd Js 9h → seat0 トリップスA
    const deck = ['Ac', 'Ad', '2c', '7d', 'As', 'Kh', 'Qd', 'Js', '9h']
    const h = deal(deck, { anteMode: 'none', ante: 0 })
    applyAction(h, 0, { type: 'call' }) // SB call
    applyAction(h, 1, { type: 'check' }) // flop へ
    // 以降チェックダウン（フロップ・ターン・リバー、いずれも BB→SB）
    for (const street of ['flop', 'turn', 'river']) {
      expect(h.street).toBe(street)
      applyAction(h, 1, { type: 'check' })
      applyAction(h, 0, { type: 'check' })
    }
    expect(h.street).toBe('showdown')
    expect(h.result!.reason).toBe('showdown')
    expect(h.result!.winners).toEqual([0])
    expect(h.result!.showdown!.length).toBe(2)
    // ポット 100（両者50ずつ）を seat0 が獲得
    expect(h.result!.potWon).toBe(100)
    expect(h.seats[0]!.stack).toBe(10000 - 50 + 100)
  })

  it('ボードプレイでスプリット', () => {
    const deck = ['2c', '3d', '4h', '5s', 'Ah', 'Kh', 'Qd', 'Js', 'Ts']
    const h = deal(deck, { anteMode: 'none', ante: 0 })
    applyAction(h, 0, { type: 'call' })
    applyAction(h, 1, { type: 'check' })
    for (let i = 0; i < 3; i++) {
      applyAction(h, 1, { type: 'check' })
      applyAction(h, 0, { type: 'check' })
    }
    expect(h.result!.winners.sort()).toEqual([0, 1])
    expect(h.seats[0]!.stack).toBe(10000) // 50 拠出→50 返却
    expect(h.seats[1]!.stack).toBe(10000)
  })
})

describe('オールインとランアウト', () => {
  it('プリフロップ両者オールイン→ボードをランアウトしてショーダウン', () => {
    const deck = ['Ac', 'Ad', 'Kc', 'Kd', 'As', '7h', '2d', '3s', '9c']
    const h = deal(deck, { anteMode: 'none', ante: 0, players: players(1000, 1000) })
    const la = legalActions(h, 0)
    applyAction(h, 0, { type: 'raise', amount: la.maxRaiseTo }) // SB オールイン 1000
    expect(h.seats[0]!.allin).toBe(true)
    applyAction(h, 1, { type: 'call' }) // BB コールオールイン
    expect(h.street).toBe('showdown')
    expect(h.board.length).toBe(5)
    expect(h.result!.winners).toEqual([0]) // トリップスA > KK
    expect(h.seats[0]!.stack).toBe(2000)
    expect(h.seats[1]!.stack).toBe(0)
  })

  it('未コールのオールイン超過分を返却する', () => {
    // seat0 1000, seat1 500。SB オールイン1000、BBは500しか出せない
    const deck = ['Ac', 'Ad', 'Kc', 'Kd', 'As', '7h', '2d', '3s', '9c']
    const h = deal(deck, { anteMode: 'none', ante: 0, players: players(1000, 500) })
    applyAction(h, 0, { type: 'raise', amount: legalActions(h, 0).maxRaiseTo })
    applyAction(h, 1, { type: 'call' })
    expect(h.street).toBe('showdown')
    // seat0 は 500 返却され、ポット1000を獲得 → 500(返却)+1000
    expect(h.seats[0]!.stack).toBe(1500)
    expect(h.seats[1]!.stack).toBe(0)
    expect(h.result!.potWon).toBe(1000)
  })
})

describe('最小レイズのバリデーション', () => {
  it('最小レイズ未満は拒否される', () => {
    const h = deal(['As', 'Ks', '2d', '3c', 'Ah', 'Kh', 'Qh', 'Jd', 'Td'], {
      anteMode: 'none',
      ante: 0,
    })
    // currentBet=50, minRaiseTo=100。99 は不正
    expect(() => applyAction(h, 0, { type: 'raise', amount: 99 })).toThrow()
    expect(() => applyAction(h, 0, { type: 'raise', amount: 100 })).not.toThrow()
  })
})
