// src/core/gravity.test.ts
import { describe, it, expect } from "vitest";
import {
  createEmptyField,
  FIELD_WIDTH,
  FIELD_HEIGHT,
  spawnActivePiece,
  canPlacePiece,
  tryMoveLeft,
  tryMoveRight,
  trySoftDrop,
  hardDrop,
  lockPiece,
  gravityTick,
  isCellEmpty,
  canMoveDown,
  clearFullLines,
  lockPieceAndClearLines
} from "./gravity";
import type { ActivePiece, Field } from "./gravity";
import { getPieceCells } from "./srs";

// なぜ: フィールドとSRSをつなぐ部分でバグると、AIの評価もUIも全部おかしくなるため、
//       代表的なケースをテストで縛っておく。

describe("Field basics", () => {
  it("createEmptyField should create FIELD_WIDTH x FIELD_HEIGHT of zeros", () => {
    const field = createEmptyField();
    expect(field.length).toBe(FIELD_HEIGHT);
    for (const row of field) {
      expect(row.length).toBe(FIELD_WIDTH);
      for (const cell of row) {
        expect(cell).toBe(0);
      }
    }
  });

  it("isCellEmpty should treat out-of-bounds as not empty", () => {
    const field = createEmptyField();
    expect(isCellEmpty(field, -1, 0)).toBe(false);
    expect(isCellEmpty(field, FIELD_WIDTH, 0)).toBe(false);
    expect(isCellEmpty(field, 0, -1)).toBe(false);
    expect(isCellEmpty(field, 0, FIELD_HEIGHT)).toBe(false);
  });
});

describe("Spawn and placement", () => {
  it("can spawn a T piece on an empty field", () => {
    const field = createEmptyField();
    const active = spawnActivePiece(field, "T");
    expect(active).not.toBeNull();
    const piece = active as ActivePiece;
    expect(canPlacePiece(field, piece)).toBe(true);
  });

  it("spawn fails when any spawn cell is blocked", () => {
    const emptyField = createEmptyField();
    const spawned = spawnActivePiece(emptyField, "T");
    if (!spawned) {
      throw new Error("failed to spawn T on empty field in test setup");
    }

    // 実際のスポーン位置からセルを1つ取得し、そのセルをブロックで埋める
    const spawnCells = getPieceCells(
      spawned.type,
      spawned.rotation,
      spawned.x,
      spawned.y
    );
    const blockedCell = spawnCells[0];

    const blockedField = createEmptyField();
    blockedField[blockedCell.y][blockedCell.x] = 1;

    const active = spawnActivePiece(blockedField, "T");
    expect(active).toBeNull();
  });
});

describe("Horizontal movement", () => {
  function spawnOrFail(field: Field): ActivePiece {
    const active = spawnActivePiece(field, "T");
    if (!active) throw new Error("failed to spawn T piece");
    return active;
  }

  it("can move left and right on empty field", () => {
    const field = createEmptyField();
    let piece = spawnOrFail(field);

    const originalX = piece.x;

    piece = tryMoveLeft(field, piece);
    expect(piece.x).toBe(originalX - 1);

    piece = tryMoveRight(field, piece);
    piece = tryMoveRight(field, piece);
    expect(piece.x).toBe(originalX + 1);
  });

  it("cannot move through walls or stacked blocks", () => {
    const field = createEmptyField();
    let piece = spawnOrFail(field);

    // 左端までひたすら左移動
    for (let i = 0; i < 10; i++) {
      piece = tryMoveLeft(field, piece);
    }
    const leftX = piece.x;
    // もう一回左に動かそうとしても止まる
    const pieceAfter = tryMoveLeft(field, piece);
    expect(pieceAfter.x).toBe(leftX);

    // 右側に壁代わりのブロックを置いて、移動を阻止
    const blockX = piece.x + 1;
    if (blockX < FIELD_WIDTH) {
      const blockY = piece.y + 1;
      if (blockY >= 0 && blockY < FIELD_HEIGHT) {
        field[blockY][blockX] = 1;
      }
      const movedRight = tryMoveRight(field, piece);
      expect(movedRight.x).toBe(piece.x);
    }
  });
});

describe("Soft drop and gravityTick", () => {
  function spawnOrFail(field: Field): ActivePiece {
    const active = spawnActivePiece(field, "T");
    if (!active) throw new Error("failed to spawn T piece");
    return active;
  }

  it("soft drop moves piece down by 1 when free", () => {
    const field = createEmptyField();
    let piece = spawnOrFail(field);

    const originalY = piece.y;
    piece = trySoftDrop(field, piece);
    expect(piece.y).toBe(originalY + 1);
  });

  it("gravityTick reports landed when cannot move down", () => {
    const field = createEmptyField();
    let piece = spawnOrFail(field);

    // ピースのすぐ下に床を作る：フィールドのある行を全部1にする
    const testY = piece.y + 1;
    if (testY >= 0 && testY < FIELD_HEIGHT) {
      for (let x = 0; x < FIELD_WIDTH; x++) {
        field[testY][x] = 1;
      }
    }

    const { piece: afterTick, landed } = gravityTick(field, piece);
    // 1マスも落ちていない
    expect(afterTick.y).toBe(piece.y);
    expect(landed).toBe(true);
  });
});

describe("Hard drop and lock", () => {
  function spawnOrFail(field: Field): ActivePiece {
    const active = spawnActivePiece(field, "T");
    if (!active) throw new Error("failed to spawn T piece");
    return active;
  }

  it("hardDrop should drop until the piece cannot move down anymore", () => {
    const field = createEmptyField();
    let piece = spawnOrFail(field);

    // y=10 の行を全て埋めて「床」を作る
    const floorY = 10;
    for (let x = 0; x < FIELD_WIDTH; x++) {
      field[floorY][x] = 1;
    }

    const { piece: dropped, distance } = hardDrop(field, piece);
    // 少なくとも1マスは落ちている想定
    expect(distance).toBeGreaterThan(0);

    // hardDrop 後はこれ以上下に動けないはず
    const canStillMoveDown = canMoveDown(field, dropped);
    expect(canStillMoveDown).toBe(false);

    // ロック後のフィールドにピースのブロックが1以上存在することを確認
    const lockedField = lockPiece(createEmptyField(), dropped);
    let count = 0;
    for (let y = 0; y < FIELD_HEIGHT; y++) {
      for (let x = 0; x < FIELD_WIDTH; x++) {
        if (lockedField[y][x] === 1) count++;
      }
    }
    expect(count).toBeGreaterThan(0);
  });
});

describe("Line clear", () => {
  it("clearFullLines removes a single full line and keeps field height", () => {
    const field = createEmptyField();

    // 最下段をフルラインにし、その1つ上にマーカーを置く
    const fullY = FIELD_HEIGHT - 1;
    for (let x = 0; x < FIELD_WIDTH; x++) {
      field[fullY][x] = 1;
    }
    const markerY = FIELD_HEIGHT - 2;
    const markerX = 3;
    field[markerY][markerX] = 1;

    const { field: cleared, clearedLines } = clearFullLines(field);

    // 高さは一定
    expect(cleared.length).toBe(FIELD_HEIGHT);
    // 消えた行は元の fullY のみ
    expect(clearedLines).toEqual([fullY]);

    // 一番上の行は空行
    for (let x = 0; x < FIELD_WIDTH; x++) {
      expect(cleared[0][x]).toBe(0);
    }

    // 元の markerY 行は1つ下に詰められて、最下段に来ているはず
    expect(cleared[FIELD_HEIGHT - 1][markerX]).toBe(1);
  });

  it("clearFullLines can clear multiple lines at once", () => {
    const field = createEmptyField();

    const line1 = FIELD_HEIGHT - 1;
    const line2 = FIELD_HEIGHT - 3;

    for (let x = 0; x < FIELD_WIDTH; x++) {
      field[line1][x] = 1;
      field[line2][x] = 1;
    }

    const { field: cleared, clearedLines } = clearFullLines(field);

    expect(cleared.length).toBe(FIELD_HEIGHT);
    // 上から走査しているので小さいYが先
    expect(clearedLines).toEqual([line2, line1]);

    // フルラインが残っていないことを確認
    let fullCount = 0;
    for (let y = 0; y < FIELD_HEIGHT; y++) {
      let isFull = true;
      for (let x = 0; x < FIELD_WIDTH; x++) {
        if (cleared[y][x] === 0) {
          isFull = false;
          break;
        }
      }
      if (isFull) fullCount++;
    }
    expect(fullCount).toBe(0);
  });

  it("lockPieceAndClearLines behaves like lockPiece + clearFullLines when no full line", () => {
    const field = createEmptyField();
    const active = spawnActivePiece(field, "T");
    if (!active) {
      throw new Error("failed to spawn T on empty field in test setup");
    }

    const locked = lockPiece(field, active);
    const { field: cleared1, clearedLines: lines1 } = clearFullLines(locked);

    const { field: cleared2, clearedLines: lines2 } = lockPieceAndClearLines(
      field,
      active
    );

    expect(lines1).toEqual(lines2);
    expect(cleared2).toEqual(cleared1);
  });
});
