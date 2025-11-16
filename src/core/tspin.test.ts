// src/core/tspin.test.ts
import { describe, it, expect } from "vitest";
import { createEmptyField, FIELD_HEIGHT, FIELD_WIDTH } from "./gravity";
import type { ActivePiece, Field } from "./gravity";
import { detectTSpin, mapLinesToKind } from "./tspin";

function createTAtCenter(): { field: Field; piece: ActivePiece } {
  const field = createEmptyField();
  const x = Math.floor(FIELD_WIDTH / 2);
  const y = Math.floor(FIELD_HEIGHT / 2);

  const piece: ActivePiece = {
    type: "T",
    x,
    y,
    rotation: 0 // 回転方向は今回のテストでは直接使わない
  };

  return { field, piece };
}

describe("mapLinesToKind", () => {
  it("maps line counts to basic kinds correctly", () => {
    expect(mapLinesToKind(0)).toBe("none");
    expect(mapLinesToKind(1)).toBe("single");
    expect(mapLinesToKind(2)).toBe("double");
    expect(mapLinesToKind(3)).toBe("triple");
    expect(mapLinesToKind(4)).toBe("tetris");
    expect(mapLinesToKind(5)).toBe("none");
  });
});

describe("detectTSpin - basic behavior", () => {
  it("returns none when piece is not T", () => {
    const field = createEmptyField();
    const piece: ActivePiece = {
      type: "L",
      x: 5,
      y: 5,
      rotation: 0
    };

    const result = detectTSpin({
      field,
      piece,
      linesCleared: 2,
      lastMoveWasRotate: true
    });

    expect(result.category).toBe("none");
    expect(result.lineClearKind).toBe("double");
  });

  it("returns none when no lines are cleared", () => {
    const { field, piece } = createTAtCenter();

    const result = detectTSpin({
      field,
      piece,
      linesCleared: 0,
      lastMoveWasRotate: true
    });

    expect(result.category).toBe("none");
    expect(result.lineClearKind).toBe("none");
  });

  it("returns none when last move was not a rotation even if 3 corners are filled", () => {
    const { field, piece } = createTAtCenter();

    // 4コーナーすべて埋める（回転中心は piece.x+1, piece.y+1）
    const centerX = piece.x + 1;
    const centerY = piece.y + 1;
    field[centerY - 1][centerX - 1] = 1;
    field[centerY - 1][centerX + 1] = 1;
    field[centerY + 1][centerX - 1] = 1;
    field[centerY + 1][centerX + 1] = 1;

    const result = detectTSpin({
      field,
      piece,
      linesCleared: 2,
      lastMoveWasRotate: false
    });

    expect(result.category).toBe("none");
    expect(result.lineClearKind).toBe("double");
  });
});

describe("detectTSpin - 3-corner rule", () => {
  it("detects T-Spin Double when 3 corners are occupied and last move was rotate", () => {
    const { field, piece } = createTAtCenter();

    // 3コーナー埋める（右下だけ空ける）（回転中心は piece.x+1, piece.y+1）
    const centerX = piece.x + 1;
    const centerY = piece.y + 1;
    field[centerY - 1][centerX - 1] = 1; // 左上
    field[centerY - 1][centerX + 1] = 1; // 右上
    field[centerY + 1][centerX - 1] = 1; // 左下

    const result = detectTSpin({
      field,
      piece,
      linesCleared: 2,
      lastMoveWasRotate: true
    });

    expect(result.category).toBe("tspin");
    expect(result.lineClearKind).toBe("tspinDouble");
  });

  it("does not treat it as T-Spin if only 2 corners are occupied", () => {
    const { field, piece } = createTAtCenter();

    // 2コーナーだけ埋める（回転中心は piece.x+1, piece.y+1）
    const centerX = piece.x + 1;
    const centerY = piece.y + 1;
    field[centerY - 1][centerX - 1] = 1; // 左上
    field[centerY - 1][centerX + 1] = 1; // 右上

    const result = detectTSpin({
      field,
      piece,
      linesCleared: 2,
      lastMoveWasRotate: true
    });

    expect(result.category).toBe("none");
    expect(result.lineClearKind).toBe("double");
  });

  it("detects T-Spin Single for 1-line clear when 3 corners are occupied", () => {
    const { field, piece } = createTAtCenter();

    const centerX = piece.x + 1;
    const centerY = piece.y + 1;
    field[centerY - 1][centerX - 1] = 1;
    field[centerY - 1][centerX + 1] = 1;
    field[centerY + 1][centerX - 1] = 1;

    const result = detectTSpin({
      field,
      piece,
      linesCleared: 1,
      lastMoveWasRotate: true
    });

    expect(result.category).toBe("tspin");
    expect(result.lineClearKind).toBe("tspinSingle");
  });

  it("detects T-Spin Triple for 3-line clear when 3 corners are occupied", () => {
    const { field, piece } = createTAtCenter();

    const centerX = piece.x + 1;
    const centerY = piece.y + 1;
    field[centerY - 1][centerX - 1] = 1;
    field[centerY - 1][centerX + 1] = 1;
    field[centerY + 1][centerX - 1] = 1;

    const result = detectTSpin({
      field,
      piece,
      linesCleared: 3,
      lastMoveWasRotate: true
    });

    expect(result.category).toBe("tspin");
    expect(result.lineClearKind).toBe("tspinTriple");
  });

});

describe("detectTSpin - realistic T-Spin scenarios", () => {
  /**
   * 実際のゲーム盤面を使ったTスピンのテスト
   * 盤面は下から上に向かって構築（実際のテトリスと同様）
   */

  it("detects T-Spin Triple in a realistic setup", () => {
    const field = createEmptyField();

    // Tスピントリプルの典型的なセットアップ
    // 盤面構成（X = ブロック、. = 空、T = Tピース）
    //
    // Row 17: ..........
    // Row 18: X.X....... (Tピースがここに入る予定の空間)
    // Row 19: XX.XXXXXXX (3ライン消去のセットアップ)
    // Row 20: XX.XXXXXXX
    // Row 21: XX.XXXXXXX

    const baseRow = FIELD_HEIGHT - 1; // 最下行

    // 21行目（最下行）
    for (let x = 0; x < FIELD_WIDTH; x++) {
      if (x !== 2) field[baseRow][x] = 1;
    }

    // 20行目
    for (let x = 0; x < FIELD_WIDTH; x++) {
      if (x !== 2) field[baseRow - 1][x] = 1;
    }

    // 19行目
    for (let x = 0; x < FIELD_WIDTH; x++) {
      if (x !== 2) field[baseRow - 2][x] = 1;
    }

    // 18行目（Tピースの周りの壁）
    field[baseRow - 3][0] = 1; // 左壁
    field[baseRow - 3][2] = 1; // Tピースの右側の壁

    // Tピースを回転2（180度）の状態で x=1, y=baseRow-3 に配置
    // rotation 2 のTピースは上向き（stem pointing up）
    const piece: ActivePiece = {
      type: "T",
      x: 0,
      y: baseRow - 3,
      rotation: 2
    };

    // 回転中心は (piece.x + 1, piece.y + 1) = (1, baseRow - 2)
    // コーナーチェック:
    // 左上 (0, baseRow-3) = field[baseRow-3][0] = 1 ✓
    // 右上 (2, baseRow-3) = field[baseRow-3][2] = 1 ✓
    // 左下 (0, baseRow-1) = field[baseRow-1][0] = 1 ✓
    // 右下 (2, baseRow-1) = field[baseRow-1][2] = 1 ✓

    const result = detectTSpin({
      field,
      piece,
      linesCleared: 3,
      lastMoveWasRotate: true
    });

    expect(result.category).toBe("tspin");
    expect(result.lineClearKind).toBe("tspinTriple");
  });

  it("detects T-Spin Double in a common overhang setup", () => {
    const field = createEmptyField();

    // Tスピンダブルの典型的なセットアップ（オーバーハング）
    // Row 18: .XX.......
    // Row 19: X.XXXXXXXX (2ライン消去)
    // Row 20: X.XXXXXXXX

    const baseRow = FIELD_HEIGHT - 1;

    // 20行目
    for (let x = 0; x < FIELD_WIDTH; x++) {
      if (x !== 1) field[baseRow][x] = 1;
    }

    // 19行目
    for (let x = 0; x < FIELD_WIDTH; x++) {
      if (x !== 1) field[baseRow - 1][x] = 1;
    }

    // 18行目（オーバーハング）
    field[baseRow - 2][1] = 1;
    field[baseRow - 2][2] = 1;

    // Tピースを rotation 3（左向き）で x=0, y=baseRow-2 に配置
    const piece: ActivePiece = {
      type: "T",
      x: 0,
      y: baseRow - 2,
      rotation: 3
    };

    // 回転中心は (1, baseRow - 1)
    // コーナーチェック:
    // 左上 (0, baseRow-2) = 盤外 ✓
    // 右上 (2, baseRow-2) = field[baseRow-2][2] = 1 ✓
    // 左下 (0, baseRow) = field[baseRow][0] = 1 ✓
    // 右下 (2, baseRow) = field[baseRow][2] = 1 ✓

    const result = detectTSpin({
      field,
      piece,
      linesCleared: 2,
      lastMoveWasRotate: true
    });

    expect(result.category).toBe("tspin");
    expect(result.lineClearKind).toBe("tspinDouble");
  });


  it("does not detect T-Spin when piece is misaligned", () => {
    const field = createEmptyField();

    const baseRow = FIELD_HEIGHT - 1;

    // 盤面にブロックを配置するが、Tピースが正しい位置にない
    for (let x = 0; x < FIELD_WIDTH; x++) {
      if (x !== 4 && x !== 5) field[baseRow][x] = 1;
    }

    // Tピースを配置（コーナーが埋まっていない位置）
    const piece: ActivePiece = {
      type: "T",
      x: 3,
      y: baseRow - 1,
      rotation: 0
    };

    // 回転中心は (4, baseRow)
    // コーナーはほとんど空

    const result = detectTSpin({
      field,
      piece,
      linesCleared: 2,
      lastMoveWasRotate: true
    });

    expect(result.category).toBe("none");
    expect(result.lineClearKind).toBe("double");
  });
});
