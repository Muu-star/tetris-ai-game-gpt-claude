// src/core/pieceQueue.ts

// なぜ: 7-bag RNG・Hold・Nextを「盤面ロジック」と独立させて管理し、
//       将来AI側も同じシーケンスを共有できるようにするためのモジュール。

import type { PieceType } from "./srs";

// ---- RNG（擬似乱数） ----
// [用語メモ: PRNG=擬似乱数生成器。seed(種)から再現可能な乱数列を作る仕組み]

export interface RngState {
  value: number; // 32bit 状態
}

export function createRng(seed: number): RngState {
  let v = seed | 0;
  if (v === 0) {
    // 0 は xorshift 的によろしくないので適当な定数に差し替え
    v = 0x12345678;
  }
  return { value: v >>> 0 };
}

function nextRandom(rng: RngState): { rng: RngState; value01: number } {
  // xorshift32
  let x = rng.value;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  x >>>= 0; // 32bit に丸める

  return {
    rng: { value: x },
    value01: x / 0x100000000 // [0,1) に正規化
  };
}

// ---- 7-bag とキュー状態 ----

const ALL_PIECES: PieceType[] = ["I", "O", "T", "S", "Z", "J", "L"];

export interface PieceQueueState {
  rng: RngState;
  queue: PieceType[];   // これから出てくる順番（Nextの元）
  hold: PieceType | null;
  canHold: boolean;     // 「この手」でHold可能かどうか（1手1回）
}

// [用語メモ: 7-bag=7種類のミノそれぞれ1個の配列をシャッフルしたもの]
function generateBag(rng: RngState): { rng: RngState; bag: PieceType[] } {
  let bag: PieceType[] = [...ALL_PIECES];
  let r = rng;

  // Fisher-Yates シャッフル
  for (let i = bag.length - 1; i > 0; i--) {
    const { rng: r2, value01 } = nextRandom(r);
    r = r2;
    const j = Math.floor(value01 * (i + 1)); // 0〜i の整数
    const tmp = bag[i];
    bag[i] = bag[j];
    bag[j] = tmp;
  }

  return { rng: r, bag };
}

// queue の長さを minLength 以上に保つ
function ensureQueue(
  state: PieceQueueState,
  minLength: number
): PieceQueueState {
  let { rng, queue } = state;
  while (queue.length < minLength) {
    const { rng: r2, bag } = generateBag(rng);
    rng = r2;
    queue = queue.concat(bag);
  }
  return { ...state, rng, queue };
}

// ---- 公開API ----

/**
 * 新しいゲーム開始時のキュー状態を生成し、最初のミノを引く。
 * - seed: RNGの種（ゲームとAIで共有予定）
 * - nextPreviewCount: Next表示個数（例: 5）
 */
export function createInitialPieceQueue(
  seed: number,
  nextPreviewCount: number
): { state: PieceQueueState; current: PieceType } {
  let state: PieceQueueState = {
    rng: createRng(seed),
    queue: [],
    hold: null,
    canHold: true
  };

  // 初回用に、少なくとも (Next+1) 個はキューに溜めておく
  state = ensureQueue(state, nextPreviewCount + 1);

  const { state: s2, current } = spawnNextPiece(state, nextPreviewCount);
  return { state: s2, current };
}

/**
 * 次のミノを1つ取り出す。
 * - 新しいミノが出るたびに canHold=true にリセットされる（1手1回 Hold ルールの起点）
 */
export function spawnNextPiece(
  state: PieceQueueState,
  nextPreviewCount: number
): { state: PieceQueueState; current: PieceType } {
  let s = ensureQueue(state, nextPreviewCount + 1);

  if (s.queue.length === 0) {
    // 理論的には起こらないが、安全側で補充
    s = ensureQueue(s, 1);
  }

  const [current, ...rest] = s.queue;
  s = { ...s, queue: rest, canHold: true };
  // Next 用に最低 nextPreviewCount 個はキューに残す
  s = ensureQueue(s, nextPreviewCount);

  return { state: s, current };
}

/**
 * 現在のミノを Hold する。
 *
 * ルール:
 * - 1手につき1回だけ Hold 可能（canHold=false なら何もしない）
 * - Hold が空の場合: current を Hold に送り、キューから次のミノを出す
 * - Hold にミノがある場合: Hold と current を入れ替える（キューは消費しない）
 */
export function holdCurrentPiece(
  state: PieceQueueState,
  current: PieceType,
  nextPreviewCount: number
): { state: PieceQueueState; current: PieceType } {
  // この手ではすでに Hold 済み → 何もしない
  if (!state.canHold) {
    return { state, current };
  }

  // まだ Hold が空の場合
  if (state.hold == null) {
    let s: PieceQueueState = { ...state, hold: current };
    const { state: s2, current: newCurrent } = spawnNextPiece(
      s,
      nextPreviewCount
    );
    // spawnNextPiece で canHold=true になるが、
    // 「この手ではすでに Hold 済み」なので false に上書きする
    return {
      state: { ...s2, canHold: false },
      current: newCurrent
    };
  }

  // Hold に何か入っている場合は単純に入れ替え
  const newCurrent = state.hold;
  const s: PieceQueueState = {
    ...state,
    hold: current,
    canHold: false // この手で Hold 済み
  };

  return { state: s, current: newCurrent };
}
