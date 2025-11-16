// src/core/gravity.ts
// なぜ: 盤面・アクティブピース・基本的な移動/落下/回転をここに集約しておくことで、
//       プレイヤー操作・AI・リプレイで同じロジックを共有できるようにする。

// src/core/gravity.ts

import type {
  PieceType,
  RotationIndex,
  RotationDirection
} from "./srs";
import { getPieceCells, trySrsRotate } from "./srs";


// 座標系: 左上が (0,0), 右が +X, 下が +Y で SRS と完全一致させる。
export const FIELD_WIDTH = 10;
export const FIELD_HEIGHT = 40; // 上20行を隠し行として使う想定（可視20行）

// [用語メモ: Field = ロック済みミノだけを持つ盤面。アクティブピースは別で持つ]
export type Cell = 0 | 1; // 0=空き, 1=ブロックあり
export type Field = Cell[][];

export interface ActivePiece {
  type: PieceType;
  rotation: RotationIndex;
  // SRSの4x4枠の左上をフィールド座標で持つ
  x: number;
  y: number;
}

export interface GravityState {
  field: Field;
  active: ActivePiece | null;
}

// スポーン位置: 10列幅のうち中央寄りになるように X=3 を採用。
// PPT系の「列3に4x4枠の左上」がほぼ標準。
export const SPAWN_X = 3;
// Y=18: 可視エリア(Y=20~39)のすぐ上でスポーン（ぷよぷよテトリス2仕様）
export const SPAWN_Y = 18;

// ---------- フィールド生成・基本ユーティリティ ----------

export function createEmptyField(
  width: number = FIELD_WIDTH,
  height: number = FIELD_HEIGHT
): Field {
  const field: Field = [];
  for (let y = 0; y < height; y++) {
    const row: Cell[] = [];
    for (let x = 0; x < width; x++) {
      row.push(0);
    }
    field.push(row);
  }
  return field;
}

export function cloneField(field: Field): Field {
  return field.map((row) => [...row]);
}

export function isInsideField(x: number, y: number): boolean {
  return x >= 0 && x < FIELD_WIDTH && y >= 0 && y < FIELD_HEIGHT;
}

// 壁の外も「空きではない」とみなす。→ SRSのキック表と組み合わせて壁蹴りが実現される。
export function isCellEmpty(field: Field, x: number, y: number): boolean {
  if (!isInsideField(x, y)) return false;
  return field[y][x] === 0;
}

export function canPlacePiece(field: Field, piece: ActivePiece): boolean {
  const cells = getPieceCells(piece.type, piece.rotation, piece.x, piece.y);
  for (const c of cells) {
    if (!isCellEmpty(field, c.x, c.y)) {
      return false;
    }
  }
  return true;
}

// ---------- スポーン・ロック ----------

export function spawnActivePiece(field: Field, type: PieceType): ActivePiece | null {
  const piece: ActivePiece = {
    type,
    rotation: 0,
    x: SPAWN_X,
    y: SPAWN_Y
  };

  if (!canPlacePiece(field, piece)) {
    // スポーン地点に置けない = すでに積み上がっている → ゲームオーバー判定に使う
    return null;
  }
  return piece;
}

export function lockPiece(field: Field, piece: ActivePiece): Field {
  const newField = cloneField(field);
  const cells = getPieceCells(piece.type, piece.rotation, piece.x, piece.y);
  for (const c of cells) {
    if (isInsideField(c.x, c.y)) {
      newField[c.y][c.x] = 1;
    }
  }
  return newField;
}

// ---------- ライン消去 ----------

// [用語メモ: Full Line = その行の10セルすべてがブロックで埋まっている状態]
export interface LineClearResult {
  field: Field;
  clearedLines: number[]; // 元のフィールドの Y インデックス
}

/**
 * フィールド全体を走査して、フルラインを検出して消去する。
 * - 消去された行の上にある行は、下に詰められる
 * - 消えた行数ぶんだけ、最上部に空行を追加する
 * - フィールドの高さは常に FIELD_HEIGHT のまま
 */
export function clearFullLines(field: Field): LineClearResult {
  const newField: Field = [];
  const clearedLines: number[] = [];

  for (let y = 0; y < FIELD_HEIGHT; y++) {
    const row = field[y];
    let isFull = true;
    for (let x = 0; x < FIELD_WIDTH; x++) {
      if (row[x] === 0) {
        isFull = false;
        break;
      }
    }

    if (isFull) {
      clearedLines.push(y);
    } else {
      // フルライン以外だけを詰めていく
      newField.push([...row]);
    }
  }

  const linesCleared = clearedLines.length;

  // 消えた行数だけ、上部に空行を追加
  for (let i = 0; i < linesCleared; i++) {
    const emptyRow: Cell[] = new Array(FIELD_WIDTH).fill(0);
    newField.unshift(emptyRow);
  }

  // 念のため、高さを FIELD_HEIGHT にそろえる
  while (newField.length < FIELD_HEIGHT) {
    const emptyRow: Cell[] = new Array(FIELD_WIDTH).fill(0);
    newField.unshift(emptyRow);
  }
  if (newField.length > FIELD_HEIGHT) {
    newField.splice(0, newField.length - FIELD_HEIGHT);
  }

  return { field: newField, clearedLines };
}

// ロック＋ライン消去をまとめたユーティリティ。
// KPI 計算や UI からはこちらを呼ぶことになる想定。
export interface LockAndClearResult {
  field: Field;
  clearedLines: number[];
}

export function lockPieceAndClearLines(
  field: Field,
  piece: ActivePiece
): LockAndClearResult {
  const locked = lockPiece(field, piece);
  const { field: afterClear, clearedLines } = clearFullLines(locked);
  return {
    field: afterClear,
    clearedLines
  };
}

// ---------- 基本移動（左右・下） ----------

export function tryMove(
  field: Field,
  piece: ActivePiece,
  dx: number,
  dy: number
): ActivePiece {
  const moved: ActivePiece = {
    ...piece,
    x: piece.x + dx,
    y: piece.y + dy
  };

  if (canPlacePiece(field, moved)) {
    return moved;
  }
  return piece;
}

export function tryMoveLeft(field: Field, piece: ActivePiece): ActivePiece {
  return tryMove(field, piece, -1, 0);
}

export function tryMoveRight(field: Field, piece: ActivePiece): ActivePiece {
  return tryMove(field, piece, 1, 0);
}

export function trySoftDrop(field: Field, piece: ActivePiece): ActivePiece {
  return tryMove(field, piece, 0, 1);
}

export function canMoveDown(field: Field, piece: ActivePiece): boolean {
  const moved = tryMove(field, piece, 0, 1);
  return moved.y !== piece.y;
}

// [用語メモ: Hard Drop = 一番下まで瞬時に落として即ロックする操作]
export interface HardDropResult {
  piece: ActivePiece;
  distance: number; // 何マス落ちたか
}

export function hardDrop(field: Field, piece: ActivePiece): HardDropResult {
  let current = piece;
  let distance = 0;

  while (true) {
    const next = tryMove(field, current, 0, 1);
    if (next.y === current.y) {
      // これ以上落ちない
      break;
    }
    current = next;
    distance++;
  }

  return { piece: current, distance };
}

// ---------- 回転（SRSキック適用） ----------

export function tryRotate(
  field: Field,
  piece: ActivePiece,
  direction: RotationDirection
): ActivePiece {
  const result = trySrsRotate(
    piece.type,
    piece.rotation,
    direction,
    piece.x,
    piece.y,
    (x, y) => isCellEmpty(field, x, y)
  );

  if (!result.success) {
    return piece;
  }

  return {
    ...piece,
    rotation: result.rotation,
    x: result.originX,
    y: result.originY
  };
}

// ---------- 単一ステップ重力 ----------

// [用語メモ: Gravity Tick = 一定時間ごとに1マス落とす処理1回分]
export interface GravityTickResult {
  piece: ActivePiece;
  landed: boolean; // これ以上下に動けない状態か（ロック遅延の開始条件になる）
}

/**
 * 自然落下を1ステップ分だけ適用する。
 * - 下に1マス動ければ moved, landed=false
 * - 動けなければその場で landed=true（まだロックはしない。ロック遅延で使う）
 */
export function gravityTick(field: Field, piece: ActivePiece): GravityTickResult {
  const moved = trySoftDrop(field, piece);
  if (moved.y === piece.y) {
    return { piece, landed: true };
  }
  return { piece: moved, landed: false };
}
