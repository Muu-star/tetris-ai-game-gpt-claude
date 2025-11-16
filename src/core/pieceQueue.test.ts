// src/core/pieceQueue.test.ts
import { describe, it, expect } from "vitest";
import {
  createInitialPieceQueue,
  spawnNextPiece,
  holdCurrentPiece,
  type PieceQueueState
} from "./pieceQueue";
import type { PieceType } from "./srs";

const ALL_PIECES: PieceType[] = ["I", "O", "T", "S", "Z", "J", "L"];

function countPieces(pieces: PieceType[]): Record<PieceType, number> {
  const counts = {
    I: 0,
    O: 0,
    T: 0,
    S: 0,
    Z: 0,
    J: 0,
    L: 0
  } as Record<PieceType, number>;

  for (const p of pieces) {
    counts[p]++;
  }
  return counts;
}

describe("7-bag generation", () => {
  it("ensures each group of 7 draws contains exactly one of each piece", () => {
    const nextPreviewCount = 5;
    const seed = 123456;

    let { state, current } = createInitialPieceQueue(seed, nextPreviewCount);
    const drawn: PieceType[] = [current];

    // 残り6個を引いて最初の7個を揃える
    for (let i = 0; i < 6; i++) {
      const res = spawnNextPiece(state, nextPreviewCount);
      state = res.state;
      drawn.push(res.current);
    }

    expect(drawn.length).toBe(7);
    const counts1 = countPieces(drawn);
    for (const p of ALL_PIECES) {
      expect(counts1[p]).toBe(1);
    }

    // 次の7個も同様にチェック
    const drawn2: PieceType[] = [];
    for (let i = 0; i < 7; i++) {
      const res = spawnNextPiece(state, nextPreviewCount);
      state = res.state;
      drawn2.push(res.current);
    }

    expect(drawn2.length).toBe(7);
    const counts2 = countPieces(drawn2);
    for (const p of ALL_PIECES) {
      expect(counts2[p]).toBe(1);
    }
  });

  it("keeps queue length >= nextPreviewCount", () => {
    const nextPreviewCount = 5;
    const seed = 42;

    let { state, current } = createInitialPieceQueue(seed, nextPreviewCount);
    expect(state.queue.length).toBeGreaterThanOrEqual(nextPreviewCount);

    // 何回か引いても queue 長が維持される
    for (let i = 0; i < 20; i++) {
      const res = spawnNextPiece(state, nextPreviewCount);
      state = res.state;
      current = res.current;
      expect(state.queue.length).toBeGreaterThanOrEqual(nextPreviewCount);
    }

    // 型消し防止で current を少し触る
    expect(ALL_PIECES.includes(current)).toBe(true);
  });
});

describe("Hold behavior", () => {
  it("moves current into hold and draws a new piece when hold is empty", () => {
    const nextPreviewCount = 5;
    const seed = 100;

    let { state, current } = createInitialPieceQueue(seed, nextPreviewCount);

    expect(state.hold).toBeNull();
    expect(state.canHold).toBe(true);

    const originalCurrent = current;
    const originalQueueLength = state.queue.length;

    const res = holdCurrentPiece(state, current, nextPreviewCount);
    state = res.state;
    current = res.current;

    // current が Hold に入り、新しい current が出ている
    expect(state.hold).toBe(originalCurrent);
    expect(current).not.toBe(originalCurrent);
    // Hold 済みなので canHold=false
    expect(state.canHold).toBe(false);
    // queue は1個消費されているはず
    expect(state.queue.length).toBeGreaterThanOrEqual(nextPreviewCount);
    expect(state.queue.length).toBeLessThanOrEqual(originalQueueLength);
  });

  it("swaps current with hold when hold is not empty", () => {
    const nextPreviewCount = 5;
    const seed = 200;

    let { state, current } = createInitialPieceQueue(seed, nextPreviewCount);

    // 1回目の Hold（Hold を埋める）
    let res = holdCurrentPiece(state, current, nextPreviewCount);
    state = res.state;
    current = res.current;

    const pieceInHoldAfterFirst = state.hold;
    const currentAfterFirst = current;

    // ピースを1つロックした想定で、次のピースを出す（canHold を true に戻す）
    res = spawnNextPiece(state, nextPreviewCount);
    state = res.state;
    current = res.current;
    expect(state.canHold).toBe(true);

    // 2回目の Hold（Hold と current を入れ替える）
    const res2 = holdCurrentPiece(state, current, nextPreviewCount);
    const state2 = res2.state;
    const current2 = res2.current;

    // swap が正しく行われているか
    expect(state2.hold).toBe(current);
    expect(current2).toBe(pieceInHoldAfterFirst);
    expect(state2.canHold).toBe(false);

    // queue は swap では消費されない
    expect(state2.queue.length).toBe(state.queue.length);
  });

  it("does not allow multiple holds in a single turn", () => {
    const nextPreviewCount = 5;
    const seed = 300;

    let { state, current } = createInitialPieceQueue(seed, nextPreviewCount);

    // 1回目の Hold
    let res = holdCurrentPiece(state, current, nextPreviewCount);
    state = res.state;
    current = res.current;

    expect(state.canHold).toBe(false);

    const holdAfterFirst = state.hold;
    const currentAfterFirst = current;
    const queueLengthAfterFirst = state.queue.length;

    // 同じ手で2回目の Hold を呼んでも変化しない
    res = holdCurrentPiece(state, current, nextPreviewCount);
    const state2 = res.state;
    const current2 = res.current;

    expect(state2.canHold).toBe(false);
    expect(state2.hold).toBe(holdAfterFirst);
    expect(current2).toBe(currentAfterFirst);
    expect(state2.queue.length).toBe(queueLengthAfterFirst);
  });
});
