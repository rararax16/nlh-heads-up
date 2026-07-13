import type { EngineHand } from '../engine'
import { legalActions } from '../engine'
import type { LegalActions } from '~~/shared/types'
import { cardToInt, handIndexOfCards } from './handIndex'
import { HAND_PERCENTILE, equityVsTopRange } from './equity'
import { solveJamFold } from './nash'
import { mcEquityVsRange } from './mcEquity'

// =============================================================
// AI の意思決定（GTO ベース・フェーズ1）
//
// 方針:
//   * ショートスタック（≦10〜12BB）のプリフロップ: 厳密な Nash
//     プッシュ/フォールド均衡（nash.ts）に従う = 理論最適
//   * ディープのプリフロップ: HU GTO の一般的な頻度に基づく
//     チャート近似（オープン/3bet/ディフェンス、混合戦略）
//   * ポストフロップ: レンジ推定 + モンテカルロ勝率 + ポットオッズ/
//     頻度ベースの混合戦略（GTO 近似。厳密解ではない）
//
// すべて純粋関数（乱数注入可）で、返す手は必ず合法。
// =============================================================

export interface AiDecision {
  type: 'fold' | 'check' | 'call' | 'bet' | 'raise'
  amount?: number
}

const other = (s: number) => (s === 0 ? 1 : 0)

export function decideAiAction(
  hand: EngineHand,
  seat: number,
  chipUnit = 1,
  rand: () => number = Math.random,
): AiDecision {
  const legal = legalActions(hand, seat, chipUnit)
  const raw =
    hand.street === 'preflop'
      ? decidePreflop(hand, seat, chipUnit, legal, rand)
      : decidePostflop(hand, seat, chipUnit, legal, rand)
  return sanitize(raw, legal)
}

// ---- 共通ヘルパー ------------------------------------------------

/** ハンド開始時スタック（BB建て）。BB席はアンティも含めて戻す */
function startStackBB(hand: EngineHand, seat: number): number {
  const s = hand.seats[seat]!
  let chips = s.stack + s.committed
  if (seat === other(hand.buttonSeat)) chips += hand.deadMoney
  return chips / hand.bb
}

function effBB(hand: EngineHand): number {
  return Math.min(startStackBB(hand, 0), startStackBB(hand, 1))
}

function potNow(hand: EngineHand): number {
  return hand.deadMoney + hand.seats[0]!.committed + hand.seats[1]!.committed
}

/** ジャム/フォールド理論を適用するスタック領域か（アンティ有りはやや広め） */
function isJamFoldDepth(e: number, anteBB: number): boolean {
  return e <= (anteBB > 0 ? 12 : 10)
}

/**
 * レイズ額（合計ベット額）を合法範囲に整えて返す。
 * スタックの大半を使うレイズはオールインへ寄せる（残りが中途半端に残るのを防ぐ）。
 */
function makeRaise(
  hand: EngineHand,
  seat: number,
  legal: LegalActions,
  chipUnit: number,
  targetChips: number,
): AiDecision {
  const s = hand.seats[seat]!
  let amt = Math.round(targetChips)
  amt = Math.max(legal.minRaiseTo, Math.min(amt, legal.maxRaiseTo))
  if (chipUnit > 1 && amt !== legal.maxRaiseTo) {
    amt = Math.floor(amt / chipUnit) * chipUnit
    if (amt < legal.minRaiseTo) amt = legal.minRaiseTo
  }
  // 合計持ち点の 45% を超えるコミットはジャムに変換
  if (amt >= 0.45 * (s.stack + s.streetCommitted)) amt = legal.maxRaiseTo
  return { type: hand.currentBet === 0 ? 'bet' : 'raise', amount: amt }
}

/** 不正な手を必ず合法な手に落とす安全弁 */
function sanitize(d: AiDecision, legal: LegalActions): AiDecision {
  if (d.type === 'bet' || d.type === 'raise') {
    if (!legal.canBetOrRaise) {
      if (legal.canCall) return { type: 'call' }
      return legal.canCheck ? { type: 'check' } : { type: 'fold' }
    }
    const amt = Math.max(legal.minRaiseTo, Math.min(d.amount ?? legal.minRaiseTo, legal.maxRaiseTo))
    return { type: d.type, amount: amt }
  }
  if (d.type === 'call' && !legal.canCall) {
    return legal.canCheck ? { type: 'check' } : { type: 'fold' }
  }
  if (d.type === 'check' && !legal.canCheck) {
    return legal.canCall ? { type: 'call' } : { type: 'fold' }
  }
  if (d.type === 'fold' && legal.canCheck) return { type: 'check' } // タダで見られるなら降りない
  return d
}

// ---- プリフロップ ------------------------------------------------

function decidePreflop(
  hand: EngineHand,
  seat: number,
  chipUnit: number,
  legal: LegalActions,
  rand: () => number,
): AiDecision {
  const idx = handIndexOfCards(hand.seats[seat]!.hole)
  const pct = HAND_PERCENTILE[idx]!
  const e = effBB(hand)
  const anteBB = Math.min(hand.deadMoney / hand.bb, 2)
  const isSB = seat === hand.buttonSeat
  const shortMode = isJamFoldDepth(e, anteBB)
  const currentBetBB = hand.currentBet / hand.bb

  // --- SB（ボタン）のファーストイン ---
  if (isSB && currentBetBB <= 1.001) {
    if (shortMode) {
      // 厳密 Nash プッシュ/フォールド
      const sol = solveJamFold(e, anteBB)
      return rand() < sol.jam[idx]!
        ? { type: 'raise', amount: legal.maxRaiseTo }
        : { type: 'fold' }
    }
    // ディープ: レイズ or フォールド（HU GTO の SB は 7〜8 割をオープン）
    const openFreq = pct <= 0.70 ? 1 : pct <= 0.80 ? 0.5 : 0
    if (rand() < openFreq) {
      const sizeBB = e > 22 ? 2.5 : 2.1
      return makeRaise(hand, seat, legal, chipUnit, sizeBB * hand.bb)
    }
    return { type: 'fold' }
  }

  // --- BB がリンプに対してチェック/アイソレート ---
  if (!isSB && legal.canCheck) {
    const isoFreq = pct <= 0.30 ? 0.8 : pct <= 0.55 ? 0.1 : 0
    if (legal.canBetOrRaise && rand() < isoFreq) {
      return makeRaise(hand, seat, legal, chipUnit, 3.5 * hand.bb + hand.deadMoney)
    }
    return { type: 'check' }
  }

  // --- レイズ/ジャムに直面（BB vs オープン、SB vs 3bet などを共通処理） ---
  return facingPreflopAggression(hand, seat, chipUnit, legal, idx, pct, e, anteBB, rand)
}

function facingPreflopAggression(
  hand: EngineHand,
  seat: number,
  chipUnit: number,
  legal: LegalActions,
  idx: number,
  pct: number,
  e: number,
  anteBB: number,
  rand: () => number,
): AiDecision {
  const s = hand.seats[seat]!
  const opp = hand.seats[other(seat)]!
  const toCall = legal.callAmount
  const pot = potNow(hand)
  const price = toCall / (pot + toCall)
  const shortMode = isJamFoldDepth(e, anteBB)
  const inPosition = seat === hand.buttonSeat
  const callIsAllIn = toCall >= s.stack * 0.9

  // 相手のオールインに対する応答
  if (opp.allin) {
    if (shortMode) {
      // Nash コールレンジ（理論最適）
      const sol = solveJamFold(e, anteBB)
      return rand() < sol.call[idx]! ? { type: 'call' } : { type: 'fold' }
    }
    // ディープのオーバージャムには「強レンジ相手の勝率 vs 価格」で応答
    const eq = equityVsTopRange(idx, 0.15)
    return eq > price + 0.02 ? { type: 'call' } : { type: 'fold' }
  }

  // コールした時点でほぼオールインになる場合も勝率 vs 価格で判定
  if (callIsAllIn) {
    const eq = equityVsTopRange(idx, 0.30)
    return eq > price + 0.03 ? { type: 'call' } : { type: 'fold' }
  }

  // 相手レンジをレイズサイズから推定（大きいほど強い）
  const raiseToBB = hand.currentBet / hand.bb
  const oppRange = raiseToBB <= 3 ? 0.65 : raiseToBB <= 6 ? 0.25 : 0.12
  const eq = equityVsTopRange(idx, oppRange)

  // リレイズ（3bet / 4bet / ジャム）
  if (legal.canBetOrRaise) {
    if (shortMode) {
      // ショートのリレイズは常にジャム。Nash ジャムレンジを上限に上位のみ
      const sol = solveJamFold(e, anteBB)
      const cap = pct <= 0.15 ? 1 : pct <= 0.25 ? 0.5 : 0
      if (rand() < Math.min(sol.jam[idx]!, cap)) {
        return { type: 'raise', amount: legal.maxRaiseTo }
      }
    } else {
      const valueFreq = pct <= 0.05 ? 0.8 : pct <= 0.10 ? 0.4 : 0
      const bluffFreq = pct > 0.45 && pct <= 0.60 && raiseToBB <= 3 ? 0.08 : 0
      if (rand() < valueFreq + bluffFreq) {
        const mult = inPosition ? 3 : 3.8
        return makeRaise(hand, seat, legal, chipUnit, hand.currentBet * mult)
      }
    }
  }

  // コール判定: 勝率 × 実現率（ポジションと手の強さで補正） vs 価格
  const realization = (inPosition ? 0.85 : 0.72) + 0.25 * (1 - pct)
  if (legal.canCall && eq * realization > price + 0.01) return { type: 'call' }
  return { type: 'fold' }
}

// ---- ポストフロップ ----------------------------------------------

function decidePostflop(
  hand: EngineHand,
  seat: number,
  chipUnit: number,
  legal: LegalActions,
  rand: () => number,
): AiDecision {
  const s = hand.seats[seat]!
  const hole: [number, number] = [cardToInt(s.hole[0]!), cardToInt(s.hole[1]!)]
  const board = hand.board.map(cardToInt)
  const pot = potNow(hand)
  const toCall = legal.callAmount
  const isRiver = hand.street === 'river'

  // 相手レンジ推定: このストリートでベットしてきていれば狭め、
  // レイズ合戦になった大きいポットも狭め（フェーズ1の簡易モデル）
  const potBB = pot / hand.bb
  let oppRange = toCall > 0 ? 0.45 : 0.75
  if (potBB >= 12) oppRange = Math.min(oppRange, 0.35)

  const eq = mcEquityVsRange(hole, board, oppRange, 700, rand)

  // --- ベットに直面 ---
  if (toCall > 0) {
    const price = toCall / (pot + toCall)
    if (legal.canBetOrRaise && eq >= 0.75 && rand() < 0.6) {
      return makeRaise(hand, seat, legal, chipUnit, hand.currentBet * 2.8)
    }
    // セミブラフレイズ（リバー以外・低頻度）
    if (legal.canBetOrRaise && !isRiver && eq >= 0.30 && eq < 0.42 && rand() < 0.1) {
      return makeRaise(hand, seat, legal, chipUnit, hand.currentBet * 2.8)
    }
    const margin = isRiver ? 0.03 : 0
    if (legal.canCall && eq >= price + margin) return { type: 'call' }
    return { type: 'fold' }
  }

  // --- チェック or ベット ---
  if (legal.canBetOrRaise) {
    if (eq >= 0.8 && rand() < 0.85) {
      return makeRaise(hand, seat, legal, chipUnit, 0.75 * pot)
    }
    if (eq >= 0.62 && rand() < 0.7) {
      return makeRaise(hand, seat, legal, chipUnit, 0.6 * pot)
    }
    // セミブラフ（ドロー等はランアウト込みの勝率でこの帯に入る）
    if (!isRiver && eq >= 0.27 && eq < 0.45 && rand() < 0.28) {
      return makeRaise(hand, seat, legal, chipUnit, 0.55 * pot)
    }
    // リバーの小頻度ブラフ
    if (isRiver && eq <= 0.3 && rand() < 0.15) {
      return makeRaise(hand, seat, legal, chipUnit, 0.65 * pot)
    }
  }
  return { type: 'check' }
}
