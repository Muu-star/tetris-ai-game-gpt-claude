// src/core/srs.test.ts
import { describe, it, expect } from "vitest";
import {
  getPieceCells,
  getKickOffsets,
  rotateRotationIndex,
  trySrsRotate
} from "./srs";
import type { RotationIndex } from "./srs";

// [用語メモ: ユニットテスト = 小さな部品ごとに動作を検証する自動テスト]

// ---------- ヘルパー: 簡易フィールド実装 ----------

type CellState = 0 | 1;
type Field = CellState[][];

function createField(width: number, height: number): Field {
  const field: Field = [];
  for (let y = 0; y < height; y++) {
    const row: CellState[] = [];
    for (let x = 0; x < width; x++) {
      row.push(0);
    }
    field.push(row);
  }
  return field;
}

function occupy(field: Field, x: number, y: number) {
  field[y][x] = 1;
}

function makeIsCellFree(field: Field) {
  const height = field.length;
  const width = field[0]?.length ?? 0;
  return (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    return field[y][x] === 0;
  };
}

// ---------- 形状テスト ----------

describe("SRS piece shapes", () => {
  it("T piece spawn orientation (0) should match official SRS layout", () => {
    const cells = getPieceCells("T", 0, 0, 0);
    // 期待形状:
    // . T . .
    // T T T .
    const expected = [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 }
    ];
    expect(cells).toEqual(expected);
  });

  it("I piece spawn orientation (0) should be a horizontal line", () => {
    const cells = getPieceCells("I", 0, 0, 0);
    const expected = [
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 }
    ];
    expect(cells).toEqual(expected);
  });

  it("every piece/orientation should have exactly 4 unique cells in 4x4 box", () => {
    const pieceTypes = ["I", "O", "T", "S", "Z", "J", "L"] as const;
    const rotations: RotationIndex[] = [0, 1, 2, 3];

    for (const p of pieceTypes) {
      for (const r of rotations) {
        const cells = getPieceCells(p, r, 0, 0);
        expect(cells.length).toBe(4);

        // 4つともユニークであること
        const uniqueKeys = new Set(cells.map((c) => `${c.x},${c.y}`));
        expect(uniqueKeys.size).toBe(4);

        // 4x4の範囲内 (0〜3) に収まっていること
        for (const c of cells) {
          expect(c.x).toBeGreaterThanOrEqual(0);
          expect(c.x).toBeLessThanOrEqual(3);
          expect(c.y).toBeGreaterThanOrEqual(0);
          expect(c.y).toBeLessThanOrEqual(3);
        }
      }
    }
  });
});

// ---------- キック表の生データテスト ----------

describe("SRS kick tables", () => {
  it("JLSTZ kick table 0 -> 1 (spawn -> right) should follow guideline (Y-down coords)", () => {
    const kicks = getKickOffsets("T", 0, 1);
    // 公式SRS: (0,0), (-1,0), (-1,+1), (0,-2), (-1,-2)
    // Y下向き座標系では: (0,0), (-1,0), (-1,-1), (0,+2), (-1,+2)
    const expected = [
      { x: 0, y: 0 },
      { x: -1, y: 0 },
      { x: -1, y: -1 },
      { x: 0, y: 2 },
      { x: -1, y: 2 }
    ];
    expect(kicks).toEqual(expected);
  });

  it("I kick table 0 -> 1 (spawn -> right) should follow guideline (Y-down coords)", () => {
    const kicks = getKickOffsets("I", 0, 1);
    // 公式SRS: (0,0), (-2,0), (+1,0), (-2,-1), (+1,+2)
    // Y下向き座標系では: (0,0), (-2,0), (+1,0), (-2,+1), (+1,-2)
    const expected = [
      { x: 0, y: 0 },
      { x: -2, y: 0 },
      { x: 1, y: 0 },
      { x: -2, y: 1 },
      { x: 1, y: -2 }
    ];
    expect(kicks).toEqual(expected);
  });

  it("O kick table 0 -> 1 should be simplified to no movement for now", () => {
    const kicks = getKickOffsets("O", 0, 1);
    expect(kicks).toEqual([{ x: 0, y: 0 }]);
  });

  // 追加: すべてのJLSTZ回転遷移のテスト
  it("JLSTZ kick table 1 -> 0 should be correct", () => {
    const kicks = getKickOffsets("T", 1, 0);
    // 公式: (0,0), (+1,0), (+1,-1), (0,+2), (+1,+2)
    // Y反転: (0,0), (+1,0), (+1,+1), (0,-2), (+1,-2)
    expect(kicks).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: -2 },
      { x: 1, y: -2 }
    ]);
  });

  it("JLSTZ kick table 1 -> 2 should be correct", () => {
    const kicks = getKickOffsets("T", 1, 2);
    expect(kicks).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: -2 },
      { x: 1, y: -2 }
    ]);
  });

  it("JLSTZ kick table 2 -> 1 should be correct", () => {
    const kicks = getKickOffsets("T", 2, 1);
    expect(kicks).toEqual([
      { x: 0, y: 0 },
      { x: -1, y: 0 },
      { x: -1, y: -1 },
      { x: 0, y: 2 },
      { x: -1, y: 2 }
    ]);
  });

  it("JLSTZ kick table 2 -> 3 should be correct", () => {
    const kicks = getKickOffsets("T", 2, 3);
    expect(kicks).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: -1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 }
    ]);
  });

  it("JLSTZ kick table 3 -> 2 should be correct", () => {
    const kicks = getKickOffsets("T", 3, 2);
    expect(kicks).toEqual([
      { x: 0, y: 0 },
      { x: -1, y: 0 },
      { x: -1, y: 1 },
      { x: 0, y: -2 },
      { x: -1, y: -2 }
    ]);
  });

  it("JLSTZ kick table 3 -> 0 should be correct", () => {
    const kicks = getKickOffsets("T", 3, 0);
    expect(kicks).toEqual([
      { x: 0, y: 0 },
      { x: -1, y: 0 },
      { x: -1, y: 1 },
      { x: 0, y: -2 },
      { x: -1, y: -2 }
    ]);
  });

  it("JLSTZ kick table 0 -> 3 should be correct", () => {
    const kicks = getKickOffsets("T", 0, 3);
    expect(kicks).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: -1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 }
    ]);
  });

  // I-ピースの全遷移テスト
  it("I kick table 1 -> 0 should be correct", () => {
    const kicks = getKickOffsets("I", 1, 0);
    expect(kicks).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: -1, y: 0 },
      { x: 2, y: -1 },
      { x: -1, y: 2 }
    ]);
  });

  it("I kick table 1 -> 2 should be correct", () => {
    const kicks = getKickOffsets("I", 1, 2);
    expect(kicks).toEqual([
      { x: 0, y: 0 },
      { x: -1, y: 0 },
      { x: 2, y: 0 },
      { x: -1, y: -2 },
      { x: 2, y: 1 }
    ]);
  });

  it("I kick table 2 -> 1 should be correct", () => {
    const kicks = getKickOffsets("I", 2, 1);
    expect(kicks).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: -2, y: 0 },
      { x: 1, y: 2 },
      { x: -2, y: -1 }
    ]);
  });

  it("I kick table 2 -> 3 should be correct", () => {
    const kicks = getKickOffsets("I", 2, 3);
    expect(kicks).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: -1, y: 0 },
      { x: 2, y: -1 },
      { x: -1, y: 2 }
    ]);
  });

  it("I kick table 3 -> 2 should be correct", () => {
    const kicks = getKickOffsets("I", 3, 2);
    expect(kicks).toEqual([
      { x: 0, y: 0 },
      { x: -2, y: 0 },
      { x: 1, y: 0 },
      { x: -2, y: 1 },
      { x: 1, y: -2 }
    ]);
  });

  it("I kick table 3 -> 0 should be correct", () => {
    const kicks = getKickOffsets("I", 3, 0);
    expect(kicks).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: -2, y: 0 },
      { x: 1, y: 2 },
      { x: -2, y: -1 }
    ]);
  });

  it("I kick table 0 -> 3 should be correct", () => {
    const kicks = getKickOffsets("I", 0, 3);
    expect(kicks).toEqual([
      { x: 0, y: 0 },
      { x: -1, y: 0 },
      { x: 2, y: 0 },
      { x: -1, y: -2 },
      { x: 2, y: 1 }
    ]);
  });
});

// ---------- 回転インデックスヘルパー ----------

describe("RotationIndex helper", () => {
  it("rotateRotationIndex should wrap correctly for cw/ccw", () => {
    const cases: Array<{ from: RotationIndex; dir: "cw" | "ccw"; expected: RotationIndex }> = [
      { from: 0, dir: "cw", expected: 1 },
      { from: 1, dir: "cw", expected: 2 },
      { from: 2, dir: "cw", expected: 3 },
      { from: 3, dir: "cw", expected: 0 },
      { from: 0, dir: "ccw", expected: 3 },
      { from: 3, dir: "ccw", expected: 2 }
    ];

    for (const c of cases) {
      expect(rotateRotationIndex(c.from, c.dir)).toBe(c.expected);
    }
  });
});

// ---------- SRS 回転適用テスト（キック動作） ----------

describe("SRS rotation application (trySrsRotate)", () => {
  it("rotates freely in empty space without using kicks", () => {
    const originX = 5;
    const originY = 5;
    // 無限に空いているフィールドを想定
    const isCellFree = () => true;

    const result = trySrsRotate("T", 0, "cw", originX, originY, isCellFree);
    expect(result.success).toBe(true);
    expect(result.rotation).toBe(1);
    expect(result.originX).toBe(originX);
    expect(result.originY).toBe(originY);
    expect(result.usedOffset).toEqual({ x: 0, y: 0 });
  });

  it("uses second JLSTZ kick when first candidate collides with a block", () => {
    const width = 10;
    const height = 20;
    const field = createField(width, height);
    const originX = 5;
    const originY = 5;

    // T 0 -> 1 の1候補目(キックなし)で使うマスの一部を意図的に埋めて衝突させる:
    // T(1)形状 @ origin(5,5) のセルの1つ (6,5) を埋めておく
    occupy(field, 6, 5);

    const isCellFree = makeIsCellFree(field);
    const result = trySrsRotate("T", 0, "cw", originX, originY, isCellFree);

    expect(result.success).toBe(true);
    expect(result.rotation).toBe(1);
    // JLSTZ 0->1 の2候補目は (-1,0) のはず
    expect(result.originX).toBe(originX - 1);
    expect(result.originY).toBe(originY);
    expect(result.usedOffset).toEqual({ x: -1, y: 0 });
  });

  it("uses I-piece specific kick table when obstructed", () => {
    const width = 10;
    const height = 20;
    const field = createField(width, height);
    const originX = 4;
    const originY = 5;

    // I 0 -> 1 の1候補目で使うマスの1つを埋める:
    // I(1)形状 @ origin(4,5) のセル (6,5) を埋める
    occupy(field, 6, 5);

    const isCellFree = makeIsCellFree(field);
    const result = trySrsRotate("I", 0, "cw", originX, originY, isCellFree);

    expect(result.success).toBe(true);
    expect(result.rotation).toBe(1);
    // I 0->1 の2候補目は (-2,0) のはず
    expect(result.originX).toBe(originX - 2);
    expect(result.originY).toBe(originY);
    expect(result.usedOffset).toEqual({ x: -2, y: 0 });
  });

  it("fails rotation when all kicked positions collide", () => {
    const width = 10;
    const height = 20;
    const field = createField(width, height);
    const originX = 5;
    const originY = 5;

    // origin付近の4x4領域を全部埋めて「どこにキックしても衝突する」状況を作る
    for (let y = originY; y < originY + 4; y++) {
      for (let x = originX; x < originX + 4; x++) {
        occupy(field, x, y);
      }
    }

    const isCellFree = makeIsCellFree(field);
    const result = trySrsRotate("T", 0, "cw", originX, originY, isCellFree);

    expect(result.success).toBe(false);
    expect(result.rotation).toBe(0);
    expect(result.originX).toBe(originX);
    expect(result.originY).toBe(originY);
  });
});
