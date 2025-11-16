// src/ui/renderer.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  createEmptyField,
  FIELD_WIDTH,
  FIELD_HEIGHT,
  spawnActivePiece,
  tryMoveLeft,
  tryMoveRight,
  trySoftDrop,
  hardDrop,
  gravityTick,
  tryRotate,
  canMoveDown,
  lockPiece,
  clearFullLines
} from "../core/gravity";
import type { Field, ActivePiece } from "../core/gravity";
import type { PieceType } from "../core/srs";
import { getPieceCells } from "../core/srs";
import config from "../config";
import { createInitialKpiState, applyLineClear } from "../core/kpi";
import type { KpiState } from "../core/kpi";
import { detectTSpin } from "../core/tspin";
import {
  createInitialPieceQueue,
  spawnNextPiece,
  holdCurrentPiece,
  type PieceQueueState
} from "../core/pieceQueue";
import { searchBestMoveOneStep } from "../ai/search";
import type {
  AiGameState,
  AiMoveRecommendation,
  AiSearchConfig,
  AiSearchDebugInfo
} from "../ai/types";


// なぜ: UIは「入力・時間進行・描画＋HUD＋AIゴースト描画」に集中させ、
//       SRS/物理/T-Spin/KPI/7-bag+Hold/AI探索ロジックは core/ai 層に閉じ込める。

const VISIBLE_ROWS = 20;
const CELL_SIZE = 24;
const BOARD_BORDER = 2;

// config.json から物理パラメータを取得
const GRAVITY_CPS = config.gravityCPS;
const GRAVITY_INTERVAL_MS = 1000 / GRAVITY_CPS;

// [用語メモ: DAS=長押し開始までの待機時間 / ARR=長押し後の連続移動間隔]
const DAS_MS: number = (config as any).dasMs ?? 133;
const ARR_MS: number = (config as any).arrMs ?? 10;

// [用語メモ: ソフトドロップ倍率=重力に対して何倍の速度で落とすか]
const SOFT_DROP_MULTIPLIER: number = (config as any).softDropMultiplier ?? 1;
const SOFT_DROP_INTERVAL_MS =
  SOFT_DROP_MULTIPLIER > 0
    ? GRAVITY_INTERVAL_MS / SOFT_DROP_MULTIPLIER
    : GRAVITY_INTERVAL_MS;

const LOCK_DELAY_MS = config.lockDelayMs;
const LOCK_RESETS_MAX = config.lockResetsMax;

// Next の個数（config.nextCount が無ければ 5 にフォールバック）
const NEXT_PREVIEW_COUNT: number = (config as any).nextCount ?? 5;

// RNG seed（config.rngSeed があればそれを使う）
const DEFAULT_RNG_SEED: number = (config as any).rngSeed ?? 123456789;

// AI 検索パラメータ（config.json から取得）
// [用語メモ: ビーム幅=同時に保持する候補の数 / 深さ=先読み手数]
const DEFAULT_AI_SEARCH_CONFIG: AiSearchConfig = {
  beamWidth: (config as any).aiBeamWidth ?? 200,
  maxDepth: (config as any).aiMaxDepth ?? 1,
  timeLimitMsPerMove: (config as any).aiTimeLimitMsPerMove ?? 10
};

type HorizontalInput = -1 | 0 | 1;

type InputSnapshot = {
  leftHeld: boolean;
  rightHeld: boolean;
  softDropHeld: boolean;
};

type GameState = {
  field: Field;
  active: ActivePiece | null;
  gameOver: boolean;
  lockDelayMsRemaining: number;
  lockResetsUsed: number;
  isOnGround: boolean;

  gravityAccumulatorMs: number;
  softDropAccumulatorMs: number;

  // DAS/ARR 用タイマ
  dasTimerMs: number;
  arrTimerMs: number;
  lastHorizontalInput: HorizontalInput;

  lastClearedLines: number;   // 直近ロックで消えた行数
  totalClearedLines: number;  // 累計消去行数
  kpi: KpiState;              // KPI状態
  elapsedMs: number;          // ゲーム開始からの経過時間（ms）
  lastMoveWasRotate: boolean; // 直前の操作が回転だったかどうか（T-Spin用）

  pieceQueue: PieceQueueState; // 7-bag＋Hold＋Next の状態
  currentPieceType: PieceType; // 現在ミノの種類（Hold用）

  aiMove: AiMoveRecommendation | null; // AIの推奨手（1手先）
  aiElapsedMs: number;                 // 直近探索時間（ms）
  aiDebug: AiSearchDebugInfo | null;   // 探索ログ（深さ・候補など）
};


// UI層の GameState から、AI用の AiGameState に変換するヘルパー
function buildAiGameStateForSearch(state: GameState): AiGameState {
  const nextPieces = state.pieceQueue.queue.slice(0, NEXT_PREVIEW_COUNT);

  return {
    field: state.field,
    active: state.active,
    hold: state.pieceQueue.hold,
    nextPieces,
    queueState: state.pieceQueue,
    kpi: state.kpi,
    elapsedMs: state.elapsedMs,
    physics: {
      gravityCps: GRAVITY_CPS,
      softDropMultiplier: SOFT_DROP_MULTIPLIER,
      dasMs: DAS_MS,
      arrMs: ARR_MS,
      lockDelayMs: LOCK_DELAY_MS,
      lockResetsMax: LOCK_RESETS_MAX,
      nextCount: NEXT_PREVIEW_COUNT
    }
  };
}

// GameState に対して AI を1回走らせ、aiMove/aiElapsedMs を更新する
function recomputeAi(state: GameState): GameState {
  if (!state.active) {
    return { ...state, aiMove: null, aiElapsedMs: 0, aiDebug: null };
  }

  const aiState = buildAiGameStateForSearch(state);
  const result = searchBestMoveOneStep(aiState, DEFAULT_AI_SEARCH_CONFIG);

  return {
    ...state,
    aiMove: result.best,
    aiElapsedMs: result.elapsedMs,
    aiDebug: result.debug ?? null
  };
}

function createInitialGameState(): GameState {
  const field = createEmptyField();

  // 7-bag＋Hold＋Next の初期化＋最初のミノ取得
  const { state: pieceQueue, current: firstPieceType } =
    createInitialPieceQueue(DEFAULT_RNG_SEED, NEXT_PREVIEW_COUNT);

  const active = spawnActivePiece(field, firstPieceType);
  const gameOver = active === null;
  const isOnGround =
    active != null ? !canMoveDown(field, active) : false;

  const baseState: GameState = {
    field,
    active,
    gameOver,
    lockDelayMsRemaining: LOCK_DELAY_MS,
    lockResetsUsed: 0,
    isOnGround,
    gravityAccumulatorMs: 0,
    softDropAccumulatorMs: 0,
    dasTimerMs: 0,
    arrTimerMs: 0,
    lastHorizontalInput: 0,
    lastClearedLines: 0,
    totalClearedLines: 0,
    kpi: createInitialKpiState(),
    elapsedMs: 0,
    lastMoveWasRotate: false,
    pieceQueue,
    currentPieceType: firstPieceType,
    aiMove: null,
    aiElapsedMs: 0,
    aiDebug: null

  };

  // 初期ミノに対する AI 推奨手を計算
  return recomputeAi(baseState);
}

// 1フレームぶんのゲーム更新（重力＋ソフトドロップ＋DAS/ARR＋ロック遅延＋ライン消去＋T-Spin＋KPI＋次ミノ）
function tickGameState(
  prev: GameState,
  deltaMs: number,
  input: InputSnapshot
): GameState {
  if (prev.gameOver) return prev;

  const { field, active } = prev;
  if (!active) return prev;

  let currentField = field;
  let currentPiece = active;

  let gravityAccumulatorMs = prev.gravityAccumulatorMs + deltaMs;
  let softDropAccumulatorMs = prev.softDropAccumulatorMs;
  let dasTimerMs = prev.dasTimerMs;
  let arrTimerMs = prev.arrTimerMs;
  let lockDelayMsRemaining = prev.lockDelayMsRemaining;
  let lockResetsUsed = prev.lockResetsUsed;
  let lastClearedLines = prev.lastClearedLines;
  let totalClearedLines = prev.totalClearedLines;
  let kpiState: KpiState = prev.kpi;
  let lastMoveWasRotate = prev.lastMoveWasRotate;
  let pieceQueue = prev.pieceQueue;
  let currentPieceType = prev.currentPieceType;
  const newElapsedMs = prev.elapsedMs + deltaMs;

  let isOnGround = prev.isOnGround;
  let lastHorizontalInput: HorizontalInput = prev.lastHorizontalInput;

  // ---------- 1) 重力 ----------
  while (gravityAccumulatorMs >= GRAVITY_INTERVAL_MS) {
    gravityAccumulatorMs -= GRAVITY_INTERVAL_MS;
    const { piece: fallen } = gravityTick(currentField, currentPiece);
    currentPiece = fallen;
  }

  // ---------- 2) ソフトドロップ（↓長押し） ----------
  const softDropHeld = input.softDropHeld;
  if (softDropHeld && SOFT_DROP_MULTIPLIER > 1) {
    softDropAccumulatorMs += deltaMs;
    const interval = SOFT_DROP_INTERVAL_MS;

    while (softDropAccumulatorMs >= interval) {
      softDropAccumulatorMs -= interval;

      const after = trySoftDrop(currentField, currentPiece);
      if (after.y === currentPiece.y) {
        // これ以上下に動けない
        break;
      }
      currentPiece = after;

      // Move Reset: 接地中ならロック遅延リセット
      const onGroundAfterMove = !canMoveDown(currentField, currentPiece);
      if (onGroundAfterMove) {
        if (lockResetsUsed < LOCK_RESETS_MAX) {
          lockDelayMsRemaining = LOCK_DELAY_MS;
          lockResetsUsed += 1;
        }
      } else {
        lockDelayMsRemaining = LOCK_DELAY_MS;
      }
    }
  } else {
    // 押されていないときはカウンタをリセット
    softDropAccumulatorMs = 0;
  }

  // ---------- 3) 水平入力（DAS/ARR） ----------
  let horizontalDir: HorizontalInput = 0;
  if (input.leftHeld && !input.rightHeld) {
    horizontalDir = -1;
  } else if (input.rightHeld && !input.leftHeld) {
    horizontalDir = 1;
  }

  if (horizontalDir !== lastHorizontalInput) {
    // 方向が変わった（押した/離した/反転した）のでDAS/ARRをリセット
    dasTimerMs = 0;
    arrTimerMs = 0;
  }

  if (horizontalDir === 0) {
    dasTimerMs = 0;
    arrTimerMs = 0;
  } else {
    dasTimerMs += deltaMs;

    if (dasTimerMs >= DAS_MS) {
      if (ARR_MS <= 0) {
        // ARR=0 → 押しっぱなしで可能な限り即時移動
        while (true) {
          const moved =
            horizontalDir === -1
              ? tryMoveLeft(currentField, currentPiece)
              : tryMoveRight(currentField, currentPiece);
          if (moved.x === currentPiece.x) {
            break;
          }
          currentPiece = moved;

          const onGroundAfterMove = !canMoveDown(currentField, currentPiece);
          if (onGroundAfterMove) {
            if (lockResetsUsed < LOCK_RESETS_MAX) {
              lockDelayMsRemaining = LOCK_DELAY_MS;
              lockResetsUsed += 1;
            }
          } else {
            lockDelayMsRemaining = LOCK_DELAY_MS;
          }
        }
      } else {
        arrTimerMs += deltaMs;
        while (arrTimerMs >= ARR_MS) {
          arrTimerMs -= ARR_MS;

          const moved =
            horizontalDir === -1
              ? tryMoveLeft(currentField, currentPiece)
              : tryMoveRight(currentField, currentPiece);
          if (moved.x === currentPiece.x) {
            // これ以上動けない
            arrTimerMs = 0;
            break;
          }
          currentPiece = moved;

          const onGroundAfterMove = !canMoveDown(currentField, currentPiece);
          if (onGroundAfterMove) {
            if (lockResetsUsed < LOCK_RESETS_MAX) {
              lockDelayMsRemaining = LOCK_DELAY_MS;
              lockResetsUsed += 1;
            }
          } else {
            lockDelayMsRemaining = LOCK_DELAY_MS;
          }
        }
      }
    }
  }

  lastHorizontalInput = horizontalDir;

  // ---------- 4) 接地状態の最終判定 ----------
  isOnGround = !canMoveDown(currentField, currentPiece);

  // ---------- 5) ロックタイマーの減算 ----------
  if (isOnGround) {
    lockDelayMsRemaining = Math.max(0, lockDelayMsRemaining - deltaMs);
  } else {
    lockDelayMsRemaining = LOCK_DELAY_MS;
  }

  // ---------- 6) ロック判定＋ライン消去＋T-Spin判定＋KPI＋次ミノ ----------
  if (
    isOnGround &&
    (lockDelayMsRemaining <= 0 || lockResetsUsed >= LOCK_RESETS_MAX)
  ) {
    const lockedField = lockPiece(currentField, currentPiece);
    const { field: afterClear, clearedLines } = clearFullLines(lockedField);
    const clearedCount = clearedLines.length;

    lastClearedLines = clearedCount;
    totalClearedLines = prev.totalClearedLines + clearedCount;

    const detection = detectTSpin({
      field: lockedField,
      piece: currentPiece,
      linesCleared: clearedCount,
      lastMoveWasRotate: prev.lastMoveWasRotate
    });

    kpiState = applyLineClear(kpiState, {
      kind: detection.lineClearKind,
      timestampMs: newElapsedMs
    });

    // 7-bag から次のミノを取得
    const spawnRes = spawnNextPiece(pieceQueue, NEXT_PREVIEW_COUNT);
    pieceQueue = spawnRes.state;
    currentPieceType = spawnRes.current;

    const nextActive = spawnActivePiece(afterClear, currentPieceType);
    const nextOnGround =
      nextActive != null ? !canMoveDown(afterClear, nextActive) : false;

    const nextState: GameState = {
      ...prev,
      field: afterClear,
      active: nextActive,
      gameOver: nextActive === null,
      lockDelayMsRemaining: LOCK_DELAY_MS,
      lockResetsUsed: 0,
      isOnGround: nextOnGround,
      gravityAccumulatorMs,
      softDropAccumulatorMs: 0,
      dasTimerMs: 0,
      arrTimerMs: 0,
      lastHorizontalInput,
      lastClearedLines,
      totalClearedLines,
      kpi: kpiState,
      elapsedMs: newElapsedMs,
      lastMoveWasRotate: false,
      pieceQueue,
      currentPieceType
    };

    // 新しいミノが出たタイミングで AI を再計算する
    return recomputeAi(nextState);
  }

  // ---------- 7) ロックしなかったフレーム ----------
  const nextState: GameState = {
    ...prev,
    field: currentField,
    active: currentPiece,
    gameOver: prev.gameOver,
    lockDelayMsRemaining,
    lockResetsUsed,
    isOnGround,
    gravityAccumulatorMs,
    softDropAccumulatorMs,
    dasTimerMs,
    arrTimerMs,
    lastHorizontalInput,
    lastClearedLines,
    totalClearedLines,
    kpi: kpiState,
    elapsedMs: newElapsedMs,
    lastMoveWasRotate,
    pieceQueue,
    currentPieceType
  };

  // ミノが変わっていないので AI は据え置き
  return nextState;
}

// HEX色をRGBA形式に変換するヘルパー関数
function hexToRgba(hex: string, alpha: number): string {
  // #RGB または #RRGGBB 形式をサポート
  let r: number, g: number, b: number;

  if (hex.length === 4) {
    // #RGB 形式
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else {
    // #RRGGBB 形式
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
  }

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ピースタイプごとの色定義
const PIECE_COLORS: Record<PieceType, string> = {
  I: "#0ff", // シアン
  O: "#ff0", // 黄色
  T: "#a0f", // 紫
  S: "#0f0", // 緑
  Z: "#f00", // 赤
  J: "#00f", // 青
  L: "#fa0"  // オレンジ
};

export const TetrisRenderer: React.FC = () => {
  const [state, setState] = useState<GameState>(() => createInitialGameState());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const holdCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const nextCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // 入力状態（キー押しっぱなし）
  const inputRef = useRef<InputSnapshot>({
    leftHeld: false,
    rightHeld: false,
    softDropHeld: false
  });

  // ---------- 描画 ----------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = FIELD_WIDTH * CELL_SIZE;
    const height = VISIBLE_ROWS * CELL_SIZE;
    canvas.width = width;
    canvas.height = height;

    // 背景クリア
    ctx.clearRect(0, 0, width, height);

    // 背景
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, width, height);

    // グリッド線
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;

    const visibleStartY = FIELD_HEIGHT - VISIBLE_ROWS;

    for (let y = 0; y < VISIBLE_ROWS; y++) {
      for (let x = 0; x < FIELD_WIDTH; x++) {
        const px = x * CELL_SIZE;
        const py = y * CELL_SIZE;
        ctx.strokeRect(px, py, CELL_SIZE, CELL_SIZE);
      }
    }

    const { field, active, aiMove } = state;

    const drawCell = (gridX: number, gridY: number, color: string) => {
      const visibleY = gridY - visibleStartY;
      if (visibleY < 0 || visibleY >= VISIBLE_ROWS) return;
      const px = gridX * CELL_SIZE;
      const py = visibleY * CELL_SIZE;

      ctx.fillStyle = color;
      ctx.fillRect(
        px + BOARD_BORDER,
        py + BOARD_BORDER,
        CELL_SIZE - BOARD_BORDER * 2,
        CELL_SIZE - BOARD_BORDER * 2
      );
    };

    // ロック済みブロック
    for (let y = visibleStartY; y < FIELD_HEIGHT; y++) {
      const row = field[y];
      for (let x = 0; x < FIELD_WIDTH; x++) {
        if (row[x] === 1) {
          drawCell(x, y, "#0af");
        }
      }
    }

    // AIゴースト（プレイヤーと完全同座標系で描画）
    if (aiMove) {
      const cells = getPieceCells(
        aiMove.pieceType,
        aiMove.rotation,
        aiMove.x,
        aiMove.y
      );
      for (const c of cells) {
        drawCell(c.x, c.y, "#555");
      }
    }

    // プレイヤーゴースト（ハードドロップ着地位置）
    let ghostPiece: ActivePiece | null = null;
    if (active) {
      const { piece: dropped } = hardDrop(field, active);
      ghostPiece = dropped;
    }

    if (ghostPiece && active) {
      const cells = getPieceCells(
        ghostPiece.type,
        ghostPiece.rotation,
        ghostPiece.x,
        ghostPiece.y
      );
      const ghostColor = hexToRgba(PIECE_COLORS[ghostPiece.type], 0.3);
      for (const c of cells) {
        drawCell(c.x, c.y, ghostColor);
      }
    }

    // アクティブピース
    if (active) {
      const cells = getPieceCells(
        active.type,
        active.rotation,
        active.x,
        active.y
      );
      const color = PIECE_COLORS[active.type];
      for (const c of cells) {
        drawCell(c.x, c.y, color);
      }
    }

    // GAME OVER 表示
    if (state.gameOver) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 24px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("GAME OVER", width / 2, height / 2);
      ctx.font = "14px sans-serif";
      ctx.fillText("Space でリスタート", width / 2, height / 2 + 24);
    }
  }, [state]);

  // ---------- HOLDピースの描画 ----------
  useEffect(() => {
    const canvas = holdCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const holdPiece = state.pieceQueue.hold;
    const previewCellSize = 16;
    const previewPadding = 8;
    const previewWidth = 80;
    const previewHeight = 80;

    canvas.width = previewWidth;
    canvas.height = previewHeight;

    // 背景クリア
    ctx.clearRect(0, 0, previewWidth, previewHeight);

    // 背景
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, previewWidth, previewHeight);

    // "HOLD" ラベル
    ctx.fillStyle = "#ccc";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("HOLD", previewPadding, previewPadding);

    if (holdPiece) {
      const cells = getPieceCells(holdPiece, 0, 0, 0); // 回転0で表示

      // ピースの境界を計算
      let minX = Math.min(...cells.map(c => c.x));
      let minY = Math.min(...cells.map(c => c.y));
      let maxX = Math.max(...cells.map(c => c.x));
      let maxY = Math.max(...cells.map(c => c.y));
      const pieceWidth = (maxX - minX + 1) * previewCellSize;
      const pieceHeight = (maxY - minY + 1) * previewCellSize;

      // 中央揃えのためのオフセット
      const centerX = (previewWidth - pieceWidth) / 2;
      const centerY = previewPadding + 20 + (previewHeight - previewPadding - 20 - pieceHeight) / 2;

      // マス目のグリッド線を描画
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 1;
      const gridStartX = centerX;
      const gridStartY = centerY;
      const gridCols = maxX - minX + 1;
      const gridRows = maxY - minY + 1;

      // 縦線を描画
      for (let col = 0; col <= gridCols; col++) {
        const x = gridStartX + col * previewCellSize;
        ctx.beginPath();
        ctx.moveTo(x, gridStartY);
        ctx.lineTo(x, gridStartY + gridRows * previewCellSize);
        ctx.stroke();
      }

      // 横線を描画
      for (let row = 0; row <= gridRows; row++) {
        const y = gridStartY + row * previewCellSize;
        ctx.beginPath();
        ctx.moveTo(gridStartX, y);
        ctx.lineTo(gridStartX + gridCols * previewCellSize, y);
        ctx.stroke();
      }

      // 各セルを描画
      const color = PIECE_COLORS[holdPiece];
      for (const cell of cells) {
        const x = centerX + (cell.x - minX) * previewCellSize;
        const y = centerY + (cell.y - minY) * previewCellSize;

        ctx.fillStyle = color;
        ctx.fillRect(
          x + 1,
          y + 1,
          previewCellSize - 2,
          previewCellSize - 2
        );
      }
    }
  }, [state.pieceQueue.hold]);

  // ---------- NEXTピースの描画 ----------
  useEffect(() => {
    const canvas = nextCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const nextPieces = state.pieceQueue.queue.slice(0, NEXT_PREVIEW_COUNT);
    const previewCellSize = 16;
    const previewPadding = 8;
    const previewSpacing = 4;
    const previewWidth = 80;
    const baseHeight = nextPieces.length * (previewCellSize * 4 + previewSpacing) + previewPadding * 2;
    const previewHeight = Math.floor(baseHeight * 0.7); // 縦方向の長さを7割に

    canvas.width = previewWidth;
    canvas.height = previewHeight;

    // 背景クリア
    ctx.clearRect(0, 0, previewWidth, previewHeight);

    // 背景
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, previewWidth, previewHeight);

    // "NEXT" ラベル
    ctx.fillStyle = "#ccc";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("NEXT", previewPadding, previewPadding);

    let yOffset = previewPadding + 20;

    for (let i = 0; i < nextPieces.length; i++) {
      const pieceType = nextPieces[i];
      const cells = getPieceCells(pieceType, 0, 0, 0); // 回転0で表示

      // ピースの境界を計算
      let minX = Math.min(...cells.map(c => c.x));
      let minY = Math.min(...cells.map(c => c.y));
      let maxX = Math.max(...cells.map(c => c.x));
      let maxY = Math.max(...cells.map(c => c.y));
      const pieceWidth = (maxX - minX + 1) * previewCellSize;
      const pieceHeight = (maxY - minY + 1) * previewCellSize;

      // 中央揃えのためのオフセット
      const centerX = (previewWidth - pieceWidth) / 2;

      // マス目のグリッド線を描画
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 1;
      const gridStartX = centerX;
      const gridStartY = yOffset;
      const gridCols = maxX - minX + 1;
      const gridRows = maxY - minY + 1;

      // 縦線を描画
      for (let col = 0; col <= gridCols; col++) {
        const x = gridStartX + col * previewCellSize;
        ctx.beginPath();
        ctx.moveTo(x, gridStartY);
        ctx.lineTo(x, gridStartY + gridRows * previewCellSize);
        ctx.stroke();
      }

      // 横線を描画
      for (let row = 0; row <= gridRows; row++) {
        const y = gridStartY + row * previewCellSize;
        ctx.beginPath();
        ctx.moveTo(gridStartX, y);
        ctx.lineTo(gridStartX + gridCols * previewCellSize, y);
        ctx.stroke();
      }

      // 各セルを描画
      const color = PIECE_COLORS[pieceType];
      for (const cell of cells) {
        const x = centerX + (cell.x - minX) * previewCellSize;
        const y = yOffset + (cell.y - minY) * previewCellSize;

        ctx.fillStyle = color;
        ctx.fillRect(
          x + 1,
          y + 1,
          previewCellSize - 2,
          previewCellSize - 2
        );
      }

      yOffset += pieceHeight + previewSpacing;

      // テトロミノの間に区切り線を描画（最後のピース以外）
      if (i < nextPieces.length - 1) {
        ctx.strokeStyle = "#666";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(previewPadding, yOffset - previewSpacing / 2);
        ctx.lineTo(previewWidth - previewPadding, yOffset - previewSpacing / 2);
        ctx.stroke();
      }
    }
  }, [state.pieceQueue.queue]);

  // ---------- キーボード入力（Hold/HardDrop で AI 再計算） ----------

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 矢印・Space系はブラウザスクロールを防止
      if (
        e.code === "ArrowLeft" ||
        e.code === "ArrowRight" ||
        e.code === "ArrowUp" ||
        e.code === "ArrowDown" ||
        e.code === "Space"
      ) {
        e.preventDefault();
      }

      // 長押し状態の更新
      if (e.code === "ArrowLeft") {
        inputRef.current.leftHeld = true;
      } else if (e.code === "ArrowRight") {
        inputRef.current.rightHeld = true;
      } else if (e.code === "ArrowDown") {
        inputRef.current.softDropHeld = true;
      }

      const ignoreRepeatForMove =
        e.code === "ArrowLeft" ||
        e.code === "ArrowRight" ||
        e.code === "ArrowDown";

      setState((prev) => {
        if (ignoreRepeatForMove && e.repeat) {
          return prev;
        }

        if (prev.gameOver) {
          // GAME OVER 中は Space でリスタートのみ
          if (e.code === "Space") {
            return createInitialGameState();
          }
          return prev;
        }

        const { field, active, pieceQueue, currentPieceType } = prev;
        if (!active) return prev;

        let newField = field;
        let newActive: ActivePiece | null = active;
        let lockDelayMsRemaining = prev.lockDelayMsRemaining;
        let lockResetsUsed = prev.lockResetsUsed;
        let lastClearedLines = prev.lastClearedLines;
        let totalClearedLines = prev.totalClearedLines;
        let kpiState = prev.kpi;
        let lastMoveWasRotate = prev.lastMoveWasRotate;
        let newPieceQueue = pieceQueue;
        let newCurrentPieceType: PieceType = currentPieceType;
        const eventTimeMs = prev.elapsedMs;

        switch (e.code) {
          case "ArrowLeft": {
            newActive = tryMoveLeft(newField, active);
            lastMoveWasRotate = false;
            break;
          }
          case "ArrowRight": {
            newActive = tryMoveRight(newField, active);
            lastMoveWasRotate = false;
            break;
          }
          case "ArrowDown": {
            newActive = trySoftDrop(newField, active);
            lastMoveWasRotate = false;
            break;
          }
          case "KeyZ": {
            newActive = tryRotate(newField, active, "ccw");
            lastMoveWasRotate = true;
            break;
          }
          case "KeyX":
          case "ArrowUp": {
            newActive = tryRotate(newField, active, "cw");
            lastMoveWasRotate = true;
            break;
          }
          case "KeyC": {
            // Hold（1手1回）
            if (!pieceQueue.canHold) {
              return prev;
            }

            const res = holdCurrentPiece(
              pieceQueue,
              currentPieceType,
              NEXT_PREVIEW_COUNT
            );
            newPieceQueue = res.state;
            newCurrentPieceType = res.current;

            const newSpawn = spawnActivePiece(newField, newCurrentPieceType);
            const newGameOver = newSpawn === null;
            const onGround =
              newSpawn != null ? !canMoveDown(newField, newSpawn) : false;

            const nextState: GameState = {
              ...prev,
              field: newField,
              active: newSpawn,
              gameOver: newGameOver,
              lockDelayMsRemaining: LOCK_DELAY_MS,
              lockResetsUsed: 0,
              isOnGround: onGround,
              gravityAccumulatorMs: prev.gravityAccumulatorMs,
              softDropAccumulatorMs: 0,
              dasTimerMs: 0,
              arrTimerMs: 0,
              lastHorizontalInput: prev.lastHorizontalInput,
              lastClearedLines: prev.lastClearedLines,
              totalClearedLines: prev.totalClearedLines,
              kpi: prev.kpi,
              elapsedMs: prev.elapsedMs,
              lastMoveWasRotate: false,
              pieceQueue: newPieceQueue,
              currentPieceType: newCurrentPieceType,
              aiMove: prev.aiMove,
              aiElapsedMs: prev.aiElapsedMs,
              aiDebug: prev.aiDebug
            };

            // Hold でミノが変わったので AI 再計算
            return recomputeAi(nextState);
          }
          case "Space": {
            // ハードドロップ → 即ロック＋ライン消去＋T-Spin＋KPI → 次ミノ
            const { piece: dropped } = hardDrop(newField, active);

            const lockedField = lockPiece(newField, dropped);
            const { field: afterClear, clearedLines } = clearFullLines(
              lockedField
            );
            const clearedCount = clearedLines.length;

            lastClearedLines = clearedCount;
            totalClearedLines = prev.totalClearedLines + clearedCount;

            const detection = detectTSpin({
              field: lockedField,
              piece: dropped,
              linesCleared: clearedCount,
              lastMoveWasRotate: prev.lastMoveWasRotate
            });

            kpiState = applyLineClear(kpiState, {
              kind: detection.lineClearKind,
              timestampMs: eventTimeMs
            });

            const spawnRes = spawnNextPiece(pieceQueue, NEXT_PREVIEW_COUNT);
            newPieceQueue = spawnRes.state;
            newCurrentPieceType = spawnRes.current;

            const nextActive = spawnActivePiece(afterClear, newCurrentPieceType);
            const nextOnGround =
              nextActive != null
                ? !canMoveDown(afterClear, nextActive)
                : false;

            const nextState: GameState = {
              ...prev,
              field: afterClear,
              active: nextActive,
              gameOver: nextActive === null,
              lockDelayMsRemaining: LOCK_DELAY_MS,
              lockResetsUsed: 0,
              isOnGround: nextOnGround,
              gravityAccumulatorMs: prev.gravityAccumulatorMs,
              softDropAccumulatorMs: 0,
              dasTimerMs: 0,
              arrTimerMs: 0,
              lastHorizontalInput: prev.lastHorizontalInput,
              lastClearedLines,
              totalClearedLines,
              kpi: kpiState,
              elapsedMs: prev.elapsedMs,
              lastMoveWasRotate: false,
              pieceQueue: newPieceQueue,
              currentPieceType: newCurrentPieceType,
              aiMove: prev.aiMove,
              aiElapsedMs: prev.aiElapsedMs,
              aiDebug: prev.aiDebug
            };

            // ハードドロップで次ミノが出たので AI 再計算
            return recomputeAi(nextState);
          }
          default:
            return prev;
        }

        if (!newActive) {
          return prev;
        }

        // Move Reset: 接地中に移動/回転/SDしたらロック遅延リセット（上限あり）
        const onGroundAfterMove = !canMoveDown(newField, newActive);
        if (onGroundAfterMove) {
          if (lockResetsUsed < LOCK_RESETS_MAX) {
            lockDelayMsRemaining = LOCK_DELAY_MS;
            lockResetsUsed += 1;
          }
        } else {
          lockDelayMsRemaining = LOCK_DELAY_MS;
        }

        return {
          ...prev,
          field: newField,
          active: newActive,
          gameOver: prev.gameOver,
          lockDelayMsRemaining,
          lockResetsUsed,
          isOnGround: onGroundAfterMove,
          gravityAccumulatorMs: prev.gravityAccumulatorMs,
          softDropAccumulatorMs: prev.softDropAccumulatorMs,
          dasTimerMs: prev.dasTimerMs,
          arrTimerMs: prev.arrTimerMs,
          lastHorizontalInput: prev.lastHorizontalInput,
          lastClearedLines,
          totalClearedLines,
          kpi: kpiState,
          elapsedMs: prev.elapsedMs,
          lastMoveWasRotate,
          pieceQueue: newPieceQueue,
          currentPieceType: newCurrentPieceType,
          aiMove: prev.aiMove,
          aiElapsedMs: prev.aiElapsedMs,
          aiDebug: prev.aiDebug
        };
      });
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (
        e.code === "ArrowLeft" ||
        e.code === "ArrowRight" ||
        e.code === "ArrowUp" ||
        e.code === "ArrowDown" ||
        e.code === "Space"
      ) {
        e.preventDefault();
      }

      if (e.code === "ArrowLeft") {
        inputRef.current.leftHeld = false;
      } else if (e.code === "ArrowRight") {
        inputRef.current.rightHeld = false;
      } else if (e.code === "ArrowDown") {
        inputRef.current.softDropHeld = false;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // ---------- 重力＋ソフトドロップ＋DAS/ARR＋ロック遅延＋T-Spin＋KPI＋7-bag（60fpsループ） ----------

  useEffect(() => {
    let animationFrameId: number;
    let lastTime = performance.now();

    const frame = (time: number) => {
      const deltaMs = time - lastTime;
      lastTime = time;

      setState((prev) => tickGameState(prev, deltaMs, inputRef.current));

      animationFrameId = window.requestAnimationFrame(frame);
    };

    animationFrameId = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(animationFrameId);
  }, []);

  const width = FIELD_WIDTH * CELL_SIZE;
  const height = VISIBLE_ROWS * CELL_SIZE;

  const holdPiece = state.pieceQueue.hold;

  return (
    <div>
      <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
        <div>
          <canvas
            ref={holdCanvasRef}
            style={{
              border: "2px solid #666",
              backgroundColor: "#000"
            }}
          />
        </div>
        <div>
          <canvas
            ref={canvasRef}
            style={{
              border: "2px solid #666",
              backgroundColor: "#000"
            }}
            width={width}
            height={height}
          />
        </div>
        <div>
          <canvas
            ref={nextCanvasRef}
            style={{
              border: "2px solid #666",
              backgroundColor: "#000"
            }}
          />
        </div>
      </div>
      <div style={{ marginTop: "8px", fontSize: 12, color: "#ccc" }}>
        <div>操作:</div>
        <div>
          ← → = 水平移動（長押しでDAS {DAS_MS}ms → ARR {ARR_MS}ms 間隔で連続移動）
        </div>
        <div>
          ↓ = ソフトドロップ（重力の約 {SOFT_DROP_MULTIPLIER} 倍の速度）
        </div>
        <div>
          Z = 左回転 / X or ↑ = 右回転 / Space = ハードドロップ（即ロック＋T-Spin判定）
        </div>
        <div>C = Hold（1手につき1回）</div>
        <div>
          接地後 {LOCK_DELAY_MS}ms でロック / 接地中の移動・回転・SDで最大{" "}
          {LOCK_RESETS_MAX} 回までロック遅延リセット
        </div>
        <div>HOLD: {holdPiece ?? "-"}</div>
        <div>
          直近消去ライン数: {state.lastClearedLines} / 累計消去行数:{" "}
          {state.totalClearedLines}
        </div>
        <div>
          5分KPI: {state.kpi.windowScore} / 総KPI: {state.kpi.totalScore}
        </div>
                <div>
          AI:{" "}
          {state.aiMove
            ? `piece=${state.aiMove.pieceType} x=${state.aiMove.x}, y=${state.aiMove.y}, rot=${state.aiMove.rotation}, hold=${state.aiMove.useHold ? "Yes" : "No"} (${state.aiElapsedMs.toFixed(
                2
              )}ms)`
            : "（候補なし）"}
        </div>
        <div>
          AI Search Config: depth={DEFAULT_AI_SEARCH_CONFIG.maxDepth}, beamWidth={DEFAULT_AI_SEARCH_CONFIG.beamWidth}, timeLimit={DEFAULT_AI_SEARCH_CONFIG.timeLimitMsPerMove}ms
        </div>
        <div>
          AI Search Stats: explored=
          {state.aiDebug ? state.aiDebug.exploredStates : 0}, depth=
          {state.aiDebug ? state.aiDebug.depthReached : 0}
        </div>
        <div>
          AI Top Root Moves:{" "}
          {state.aiDebug && state.aiDebug.rootCandidatesSample.length > 0
            ? state.aiDebug.rootCandidatesSample
                .slice(0, 3)
                .map((c) =>
                  `${c.pieceType}${c.useHold ? "(H)" : ""}@x${c.x},r${c.rotation},s${c.score.toFixed(
                    1
                  )}`
                )
                .join(" | ")
            : "n/a"}
        </div>
        <div>GAME OVER 中に Space でリスタート</div>
      </div>
    </div>
  );
};

