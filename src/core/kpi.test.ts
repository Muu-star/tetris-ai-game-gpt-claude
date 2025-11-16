// src/core/kpi.test.ts
import { describe, it, expect } from "vitest";
import {
  createInitialKpiState,
  applyLineClear,
  type LineClearKind,
  KPI_WINDOW_MS
} from "./kpi";

describe("KPI basic scoring", () => {
  it("scores Single/Double/Triple/Tetris and T-Spins according to the table", () => {
    // Single / Double / Triple は B2B対象外なので、B2Bボーナスの影響を受けない
    let s = createInitialKpiState();

    s = applyLineClear(s, { kind: "single", timestampMs: 0 });
    expect(s.totalScore).toBe(0);
    expect(s.windowScore).toBe(0);

    s = createInitialKpiState();
    s = applyLineClear(s, { kind: "double", timestampMs: 0 });
    expect(s.totalScore).toBe(1);
    expect(s.windowScore).toBe(1);

    s = createInitialKpiState();
    s = applyLineClear(s, { kind: "triple", timestampMs: 0 });
    expect(s.totalScore).toBe(2);
    expect(s.windowScore).toBe(2);

    s = createInitialKpiState();
    s = applyLineClear(s, { kind: "tetris", timestampMs: 0 });
    expect(s.totalScore).toBe(4);
    expect(s.windowScore).toBe(4);

    s = createInitialKpiState();
    s = applyLineClear(s, { kind: "tspinMiniSingle", timestampMs: 0 });
    expect(s.totalScore).toBe(1);

    s = createInitialKpiState();
    s = applyLineClear(s, { kind: "tspinSingle", timestampMs: 0 });
    expect(s.totalScore).toBe(2);

    s = createInitialKpiState();
    s = applyLineClear(s, { kind: "tspinDouble", timestampMs: 0 });
    expect(s.totalScore).toBe(4);

    s = createInitialKpiState();
    s = applyLineClear(s, { kind: "tspinTriple", timestampMs: 0 });
    expect(s.totalScore).toBe(6);
  });
});

describe("KPI B2B logic", () => {
  it("applies +1 bonus for consecutive B2B-eligible clears", () => {
    let s = createInitialKpiState();

    // 1回目のテトリス: base 4, B2Bボーナスなし
    s = applyLineClear(s, { kind: "tetris", timestampMs: 0 });
    expect(s.totalScore).toBe(4);
    expect(s.windowScore).toBe(4);

    // 2回目のテトリス: base 4 + B2Bボーナス1 = 5
    s = applyLineClear(s, { kind: "tetris", timestampMs: 1_000 });
    expect(s.totalScore).toBe(9); // 4 + 5
    expect(s.windowScore).toBe(9);

    // 3回目のテトリス: 再び base 4 + 1 = 5（B2B継続）
    s = applyLineClear(s, { kind: "tetris", timestampMs: 2_000 });
    expect(s.totalScore).toBe(14); // 4 + 5 + 5
    expect(s.windowScore).toBe(14);
  });

  it("breaks B2B chain when a non-eligible clear happens", () => {
    let s = createInitialKpiState();

    // Tetris (B2B開始)
    s = applyLineClear(s, { kind: "tetris", timestampMs: 0 }); // 4
    // Double（B2B対象外）でチェーンが切れる: base 1
    s = applyLineClear(s, { kind: "double", timestampMs: 1_000 }); // +1 => 5
    // 再度Tetrisだが、B2Bはリセットされているのでボーナスなし: +4 => 9
    s = applyLineClear(s, { kind: "tetris", timestampMs: 2_000 });

    expect(s.totalScore).toBe(9);
    expect(s.windowScore).toBe(9);
  });

  it("does not change score for kind='none' and keeps B2B state", () => {
    let s = createInitialKpiState();

    // TetrisでB2B開始
    s = applyLineClear(s, { kind: "tetris", timestampMs: 0 }); // 4点
    const afterTetrisScore = s.totalScore;

    // kind='none' はスコアに影響しない & B2B状態も維持
    s = applyLineClear(s, { kind: "none", timestampMs: 1_000 });

    expect(s.totalScore).toBe(afterTetrisScore);
    expect(s.windowScore).toBe(afterTetrisScore);
  });
});

describe("KPI 300-second window", () => {
  it("keeps only events within the last 300 seconds in windowScore", () => {
    let s = createInitialKpiState();

    const window = KPI_WINDOW_MS;

    // t = 0ms: Tetris (4)
    s = applyLineClear(s, { kind: "tetris", timestampMs: 0 });
    expect(s.windowScore).toBe(4);

    // t = 100_000ms: Tetris (B2B継続で +5) → 合計 9
    s = applyLineClear(s, {
      kind: "tetris",
      timestampMs: 100_000
    });
    expect(s.windowScore).toBe(9);

    // t = 200_000ms: さらに Tetris (+5) → 合計 14
    s = applyLineClear(s, {
      kind: "tetris",
      timestampMs: 200_000
    });
    expect(s.windowScore).toBe(14);

    // t = 400_000ms: さらに Tetris (+5)
    // この時点でカットオフは 400_000 - 300_000 = 100_000ms
    // → t=0 のイベントはウィンドウから脱落
    s = applyLineClear(s, {
      kind: "tetris",
      timestampMs: 400_000
    });

    // ウィンドウに残るのは t=100_000, 200_000, 400_000 の3イベント
    // いずれも5点ずつなので 5*3=15
    expect(s.windowScore).toBe(15);
    // totalScore は全履歴なので 4 + 5 + 5 + 5 = 19
    expect(s.totalScore).toBe(19);
  });
});
