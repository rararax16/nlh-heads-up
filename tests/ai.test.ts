import { describe, it, expect } from 'vitest'
import { eval7, mulberry32 } from '../server/game/ai/fastEval'
import { cardToInt, intToCard, handIndexOf, handLabel, labelToIndex, comboCount, combosOf } from '../server/game/ai/handIndex'
import { evaluateShowdown } from '../server/game/evaluator'
import { handEquity, HAND_PERCENTILE, equityVsTopRange } from '../server/game/ai/equity'
import { solveJamFold } from '../server/game/ai/nash'
import { decideAiAction } from '../server/game/ai/decide'
import { startHand, applyAction, type EngineHand } from '../server/game/engine'

const H = labelToIndex

describe('handIndex', () => {
  it('カード整数 <-> 文字列の往復', () => {
    for (let c = 0; c < 52; c++) expect(cardToInt(intToCard(c))).toBe(c)
    expect(intToCard(cardToInt('As'))).toBe('As')
    expect(intToCard(cardToInt('2c'))).toBe('2c')
  })

  it('正準インデックスとラベルの往復・コンボ数', () => {
    let total = 0
    for (let i = 0; i < 169; i++) {
      expect(labelToIndex(handLabel(i))).toBe(i)
      expect(combosOf(i).length).toBe(comboCount(i))
      total += comboCount(i)
    }
    expect(total).toBe(1326) // C(52,2)
    expect(handLabel(handIndexOf(cardToInt('As'), cardToInt('Ks')))).toBe('AKs')
    expect(handLabel(handIndexOf(cardToInt('Ah'), cardToInt('Ks')))).toBe('AKo')
    expect(handLabel(handIndexOf(cardToInt('7h'), cardToInt('7s')))).toBe('77')
  })
})

describe('fastEval', () => {
  it('ランダムな2ハンド対決 3000 件で pokersolver と勝敗が一致する', () => {
    const rand = mulberry32(42)
    for (let n = 0; n < 3000; n++) {
      // 9枚（2+2+5）をランダムに引く
      const used = new Set<number>()
      const cards: number[] = []
      while (cards.length < 9) {
        const c = (rand() * 52) | 0
        if (!used.has(c)) {
          used.add(c)
          cards.push(c)
        }
      }
      const holeA = cards.slice(0, 2)
      const holeB = cards.slice(2, 4)
      const board = cards.slice(4, 9)

      const va = eval7([...holeA, ...board])
      const vb = eval7([...holeB, ...board])
      const fast = va > vb ? [0] : va < vb ? [1] : [0, 1]

      const solved = evaluateShowdown(
        [
          { seat: 0, cards: holeA.map(intToCard) },
          { seat: 1, cards: holeB.map(intToCard) },
        ],
        board.map(intToCard),
      )
      expect(fast, `board=${board.map(intToCard)} A=${holeA.map(intToCard)} B=${holeB.map(intToCard)}`).toEqual(
        [...solved.winners].sort(),
      )
    }
  })

  it('既知の役の強さ順', () => {
    const ev = (cs: string[]) => eval7(cs.map(cardToInt))
    const sf = ev(['As', 'Ks', 'Qs', 'Js', 'Ts', '2h', '3d'])
    const quads = ev(['Ah', 'Ad', 'Ac', 'As', 'Kd', '2h', '3d'])
    const boat = ev(['Ah', 'Ad', 'Ac', 'Ks', 'Kd', '2h', '3d'])
    const flush = ev(['As', 'Qs', '9s', '5s', '2s', 'Kd', 'Kh'])
    const straight = ev(['9s', '8d', '7c', '6h', '5s', 'Ad', 'Ah'])
    const wheel = ev(['As', '2d', '3c', '4h', '5s', 'Kd', 'Qh'])
    const trips = ev(['9s', '9d', '9c', 'Ah', '5s', 'Kd', '2h'])
    const twoPair = ev(['9s', '9d', '5c', '5h', 'As', 'Kd', '2h'])
    const pair = ev(['9s', '9d', 'Ac', 'Kh', '5s', '4d', '2h'])
    const high = ev(['9s', '8d', 'Ac', 'Kh', '5s', '4d', '2h'])
    const order = [sf, quads, boat, flush, straight, trips, twoPair, pair, high]
    for (let i = 0; i + 1 < order.length; i++) expect(order[i]!).toBeGreaterThan(order[i + 1]!)
    expect(straight).toBeGreaterThan(wheel) // 9ハイ > ホイール
    expect(wheel).toBeGreaterThan(trips)
  })
})

describe('プリフロップ勝率表', () => {
  it('既知のマッチアップと概ね一致する', () => {
    expect(handEquity(H('AA'), H('KK'))).toBeGreaterThan(0.78)
    expect(handEquity(H('AA'), H('KK'))).toBeLessThan(0.85)
    // コインフリップ
    expect(handEquity(H('AKs'), H('22'))).toBeGreaterThan(0.44)
    expect(handEquity(H('AKs'), H('22'))).toBeLessThan(0.53)
    // ドミネート
    expect(handEquity(H('AKo'), H('AQo'))).toBeGreaterThan(0.68)
    // 対称性
    expect(handEquity(H('KK'), H('AA')) + handEquity(H('AA'), H('KK'))).toBeCloseTo(1, 5)
    expect(handEquity(H('77'), H('77'))).toBe(0.5)
  })

  it('ハンド序列: AA が最強・ゴミ手が最弱側', () => {
    expect(HAND_PERCENTILE[H('AA')]!).toBeLessThan(0.01)
    expect(HAND_PERCENTILE[H('KK')]!).toBeLessThan(0.02)
    expect(HAND_PERCENTILE[H('72o')]!).toBeGreaterThan(0.85)
    expect(HAND_PERCENTILE[H('32o')]!).toBeGreaterThan(0.85)
    expect(HAND_PERCENTILE[H('AKs')]!).toBeLessThan(HAND_PERCENTILE[H('A2o')]!)
  })

  it('レンジに対する勝率: 強レンジ相手ほど下がる', () => {
    const vsTight = equityVsTopRange(H('A9o'), 0.1)
    const vsWide = equityVsTopRange(H('A9o'), 0.8)
    expect(vsTight).toBeLessThan(vsWide)
  })
})

describe('Nash プッシュ/フォールド', () => {
  it('10BB(アンティ無し): ジャム率が既知の均衡（約6割）近辺', () => {
    const sol = solveJamFold(10, 0)
    expect(sol.jamFrac).toBeGreaterThan(0.42)
    expect(sol.jamFrac).toBeLessThan(0.78)
    // コールレンジはジャムレンジより狭い
    expect(sol.callFrac).toBeLessThan(sol.jamFrac)
  })

  it('浅いほどジャムレンジが広がり、2BB ではほぼ全ハンドジャム', () => {
    const j2 = solveJamFold(2, 0).jamFrac
    const j5 = solveJamFold(5, 0).jamFrac
    const j12 = solveJamFold(12, 0).jamFrac
    expect(j2).toBeGreaterThan(0.9)
    expect(j2).toBeGreaterThanOrEqual(j5)
    expect(j5).toBeGreaterThan(j12)
  })

  it('AA は常にジャム/コール・72o は 12BB でジャムしない', () => {
    const sol = solveJamFold(12, 0)
    expect(sol.jam[H('AA')]!).toBeGreaterThan(0.95)
    expect(sol.call[H('AA')]!).toBeGreaterThan(0.95)
    expect(sol.jam[H('72o')]!).toBeLessThan(0.2)
  })

  it('BBアンティがあるとジャムレンジが広がる', () => {
    const noAnte = solveJamFold(10, 0).jamFrac
    const withAnte = solveJamFold(10, 1).jamFrac
    expect(withAnte).toBeGreaterThan(noAnte)
  })
})

describe('decideAiAction', () => {
  const players = (s0 = 10000, s1 = 10000) => [
    { seat: 0, userId: null, stack: s0 },
    { seat: 1, userId: null, stack: s1 },
  ]

  function freshDeck52(rand: () => number): string[] {
    const RANKS = '23456789TJQKA'
    const SUITS = 'shdc'
    const deck: string[] = []
    for (const r of RANKS) for (const s of SUITS) deck.push(r + s)
    for (let i = deck.length - 1; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0
      ;[deck[i], deck[j]] = [deck[j]!, deck[i]!]
    }
    return deck
  }

  it('8BB の SB で AA はほぼ常にジャム・72o はほぼ常にフォールド', () => {
    const rand = mulberry32(7)
    let aaJam = 0
    let trashFold = 0
    const N = 40
    for (let n = 0; n < N; n++) {
      // 配札順: SB(ボタン) が先頭2枚 → BB が次の2枚
      const mk = (cards: [string, string]) => {
        const rest = freshDeck52(rand).filter((c) => !cards.includes(c))
        return startHand({
          handNumber: 1, buttonSeat: 0, level: 5, sb: 250, bb: 500, ante: 0,
          anteMode: 'none', players: players(4000, 10000),
          deck: [...cards, ...rest],
        })
      }
      const aa = mk(['As', 'Ah'])
      const d1 = decideAiAction(aa, 0, 1, rand)
      if (d1.type === 'raise' && d1.amount === aa.seats[0]!.stack + aa.seats[0]!.streetCommitted) aaJam++
      const trash = mk(['7s', '2h'])
      const d2 = decideAiAction(trash, 0, 1, rand)
      if (d2.type === 'fold') trashFold++
    }
    expect(aaJam / N).toBeGreaterThan(0.9)
    expect(trashFold / N).toBeGreaterThan(0.9)
  })

  it('AI 同士で全ハンドを完走でき、常に合法手・チップ総量が保存される', () => {
    const rand = mulberry32(2026)
    const configs = [
      { s0: 10000, s1: 10000, sb: 50, bb: 100, ante: 100, anteMode: 'bb' as const, chipUnit: 100 },
      { s0: 3000, s1: 17000, sb: 200, bb: 400, ante: 400, anteMode: 'bb' as const, chipUnit: 100 },
      { s0: 900, s1: 19100, sb: 500, bb: 1000, ante: 0, anteMode: 'none' as const, chipUnit: 1 },
      { s0: 12000, s1: 8000, sb: 25, bb: 50, ante: 0, anteMode: 'none' as const, chipUnit: 25 },
    ]
    let hands = 0
    for (const cfg of configs) {
      for (let n = 0; n < 40; n++) {
        const hand: EngineHand = startHand({
          handNumber: n + 1,
          buttonSeat: (n % 2) as 0 | 1,
          level: 1,
          sb: cfg.sb,
          bb: cfg.bb,
          ante: cfg.ante,
          anteMode: cfg.anteMode,
          players: players(cfg.s0, cfg.s1),
          deck: freshDeck52(rand),
        })
        const total = cfg.s0 + cfg.s1
        let guard = 0
        while (!hand.result && hand.toActSeat !== null) {
          const seat = hand.toActSeat
          const d = decideAiAction(hand, seat, cfg.chipUnit, rand)
          // 例外が出れば不正な手（テスト失敗）
          applyAction(hand, seat, d, cfg.chipUnit)
          if (++guard > 50) throw new Error('ハンドが終了しない')
        }
        expect(hand.result).not.toBeNull()
        const after = hand.seats[0]!.stack + hand.seats[1]!.stack
        expect(after).toBe(total)
        hands++
      }
    }
    expect(hands).toBe(configs.length * 40)
  })
})
