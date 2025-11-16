// src/ai/search.test.ts
import { describe, it, expect } from "vitest";
import { searchBestMoveOneStep } from "./search";
import type {
  AiGameState,
  AiSearchConfig,
  AiPhysicsConfig
} from "./types";
import {
  createEmptyField,
  spawnActivePiece,
  FIELD_WIDTH,
  FIELD_HEIGHT
} from "../core/gravity";
import { createInitialPieceQueue } from "../core/pieceQueue";
import { createInitialKpiState } from "../core/kpi";
import { getPieceCells } from "../core/srs";

describe("searchBestMoveOneStep", () => {
  it("returns null best when there is no active piece", () => {
    const field = createEmptyField();
    const nextCount = 5;
    const seed = 1234;

    const { state: queueState } = createInitialPieceQueue(seed, nextCount);

    const physics: AiPhysicsConfig = {
      gravityCps: 5,
      softDropMultiplier: 20,
      dasMs: 133,
      arrMs: 10,
      lockDelayMs: 500,
      lockResetsMax: 15,
      nextCount
    };

    const state: AiGameState = {
      field,
      active: null,
      hold: queueState.hold,
      nextPieces: queueState.queue.slice(0, nextCount),
      queueState,
      kpi: createInitialKpiState(),
      elapsedMs: 0,
      physics
    };

    const searchConfig: AiSearchConfig = {
      beamWidth: 200,
      maxDepth: 1,
      timeLimitMsPerMove: 10
    };

    const result = searchBestMoveOneStep(state, searchConfig);
    expect(result.best).toBeNull();
    expect(result.exploredStates).toBe(0);
  });

  it("returns some recommendation on an empty field with initial piece", () => {
    const field = createEmptyField();
    const nextCount = 5;
    const seed = 42;

    const { state: queueState, current } = createInitialPieceQueue(
      seed,
      nextCount
    );

    const active = spawnActivePiece(field, current);
    expect(active).not.toBeNull();

    const physics: AiPhysicsConfig = {
      gravityCps: 5,
      softDropMultiplier: 20,
      dasMs: 133,
      arrMs: 10,
      lockDelayMs: 500,
      lockResetsMax: 15,
      nextCount
    };

    const state: AiGameState = {
      field,
      active: active!,
      hold: queueState.hold,
      nextPieces: queueState.queue.slice(0, nextCount),
      queueState,
      kpi: createInitialKpiState(),
      elapsedMs: 0,
      physics
    };

    const searchConfig: AiSearchConfig = {
      beamWidth: 200,
      maxDepth: 1,
      timeLimitMsPerMove: 10
    };

    const result = searchBestMoveOneStep(state, searchConfig);
    expect(result.best).not.toBeNull();

    const best = result.best!;

    // 原点(best.x, best.y)はピースの4x4ボックスの左上などを指している可能性があり、
    // 0未満になることもある。そのため「セル座標」で有効性をチェックする。
    const cells = getPieceCells(
      best.pieceType,
      best.rotation,
      best.x,
      best.y
    );

    // すべてのセルがフィールド内に収まっていることを確認
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThan(FIELD_WIDTH);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeLessThan(FIELD_HEIGHT);
    }

    // 回転・ピース種類の妥当性チェック（おまけ）
    expect([0, 1, 2, 3].includes(best.rotation as number)).toBe(true);
    expect(["I", "O", "T", "S", "Z", "J", "L"]).toContain(best.pieceType);
  });
});
