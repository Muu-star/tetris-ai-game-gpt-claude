// src/core/tspin.ts

// なぜ: T-Spinの判定ロジックを重力やKPIから独立させておき、
//       後でUI/KPI/AIから共通で使えるようにするためのモジュール。

import type { Field, ActivePiece } from "./gravity";
import { isCellEmpty } from "./gravity";
import type { LineClearKind } from "./kpi";

// T-Spin種別（Miniは今は扱わない。将来追加する前提でenumを分けておく）
export type TSpinCategory = "none" | "tspin" | "tspinMini";

// 判定入力
export interface TSpinDetectionInput {
  field: Field;            // ロック直後のフィールド（Tミノの存在はどちらでもOK。対角だけ見る）
  piece: ActivePiece;      // ロックされたピース
  linesCleared: number;    // そのロックで消えたライン数（0〜4）
  lastMoveWasRotate: boolean; // 直前の操作が回転だったかどうか（UI側で管理する想定）
}

// 判定結果
export interface TSpinDetectionResult {
  category: TSpinCategory;
  // KPI用に、そのまま使える LineClearKind も返す
  lineClearKind: LineClearKind;
}

/**
 * ライン数から通常の LineClearKind を得るヘルパー。
 * （T-Spinが成立しなかった場合はこちらを使う）
 */
export function mapLinesToKind(lines: number): LineClearKind {
  switch (lines) {
    case 1:
      return "single";
    case 2:
      return "double";
    case 3:
      return "triple";
    case 4:
      return "tetris";
    default:
      return "none";
  }
}

/**
 * 簡易T-Spin判定:
 * - ピースがTミノである
 * - linesCleared >= 1
 * - 最後の操作が回転
 * - Tミノ中心の対角4マスのうち3つ以上が埋まっている（3-corner）
 *
 * 以上を満たすとき、T-Spin Single/Double/Tripleとして扱う。
 * （Miniの判定は今は行わず、すべて通常のT-Spinとして分類する）
 */
export function detectTSpin(
  input: TSpinDetectionInput
): TSpinDetectionResult {
  const { field, piece, linesCleared, lastMoveWasRotate } = input;

  // Tミノ以外、ラインが消えていない、最後が回転でない → 通常ライン消去
  if (
    piece.type !== "T" ||
    linesCleared <= 0 ||
    !lastMoveWasRotate
  ) {
    return {
      category: "none",
      lineClearKind: mapLinesToKind(linesCleared)
    };
  }

  // Tミノ中心の対角4マスをチェック
  // piece.x, piece.y は4×4バウンディングボックスの左上隅を示すため、
  // Tピースの回転中心は (piece.x + 1, piece.y + 1) となる
  const centerX = piece.x + 1;
  const centerY = piece.y + 1;
  const corners = [
    { x: centerX - 1, y: centerY - 1 }, // 左上
    { x: centerX + 1, y: centerY - 1 }, // 右上
    { x: centerX - 1, y: centerY + 1 }, // 左下
    { x: centerX + 1, y: centerY + 1 }  // 右下
  ];

  let occupiedCorners = 0;
  for (const c of corners) {
    // isCellEmpty は盤外を「空でない」と扱うので、壁も埋まっている扱いになる
    if (!isCellEmpty(field, c.x, c.y)) {
      occupiedCorners++;
    }
  }

  // 3-corner を満たさない場合は通常ライン消去として扱う
  if (occupiedCorners < 3) {
    return {
      category: "none",
      lineClearKind: mapLinesToKind(linesCleared)
    };
  }

  // ここから先は簡易T-Spin分類
  // 将来Miniを導入したい場合は、linesCleared=1のときにさらに形状で分岐する。
  let lineClearKind: LineClearKind;

  switch (linesCleared) {
    case 1:
      lineClearKind = "tspinSingle";
      break;
    case 2:
      lineClearKind = "tspinDouble";
      break;
    case 3:
      lineClearKind = "tspinTriple";
      break;
    default:
      // 4ラインT-Spinは実質起こらない前提なので通常処理
      lineClearKind = mapLinesToKind(linesCleared);
      break;
  }

  return {
    category: "tspin",
    lineClearKind
  };
}
