// src/ai/search.ts

// なぜ: 「今の盤面＋アクティブ＋Hold＋Next」から depth 手先までビームサーチし、
//       各手について「この一手でのKPI増分（ΔKPI）＋盤面ヒューリスティック」で評価。
//       B2B連鎖はKPIのΔとして自然に効く。
//       さらに、探索規模やroot候補上位を debug として返してUIで可視化する。
//       今回は特に、ヒューリスティックを調整して
//       「両端を同時に深く開ける」「極端なタワー」を強く嫌うようにする。

import type { Field, ActivePiece } from "../core/gravity";
import {
  FIELD_WIDTH,
  FIELD_HEIGHT,
  tryMoveLeft,
  tryMoveRight,
  tryRotate,
  trySoftDrop,
  canMoveDown,
  lockPiece,
  clearFullLines,
  spawnActivePiece
} from "../core/gravity";
import {
  holdCurrentPiece,
  spawnNextPiece,
  type PieceQueueState
} from "../core/pieceQueue";
import { detectTSpin } from "../core/tspin";
import { applyLineClear } from "../core/kpi";
import type {
  AiGameState,
  AiSearchConfig,
  AiMoveRecommendation,
  AiResponse,
  AiCandidateDebug,
  AiSearchDebugInfo
} from "./types";

import config from "../config";

function nowMs(): number {
  if (typeof performance !== "undefined" && performance.now) {
    return performance.now();
  }
  return Date.now();
}

// フィールドのディープコピー
function cloneField(field: Field): Field {
  return field.map((row) => row.slice());
}

function countFilledCells(field: Field): number {
  let count = 0;
  for (const row of field) {
    for (const cell of row) {
      if (cell !== null) count++;
    }
  }
  return count;
}

function hashPiece(p: ActivePiece): string {
  return `${p.type}:${p.rotation}:${p.x}:${p.y}`;
}

// 「どの配置に到達できるか」と同時に「最後の操作が回転かどうか」も持つ
// T-Spin判定に lastMoveWasRotate が必要なため。
interface ReachablePlacement {
  piece: ActivePiece;
  lastMoveWasRotate: boolean;
  softDropSteps: number;
}

function hashNode(node: ReachablePlacement): string {
  return `${hashPiece(node.piece)}:${node.lastMoveWasRotate ? 1 : 0}`;
}

// 到達可能な配置（ロック直前の位置）を BFS で列挙
// [用語メモ: BFS=幅優先探索。近い状態から順に広げる探索アルゴリズム]
function enumerateReachablePlacements(
  field: Field,
  start: ActivePiece
): ReachablePlacement[] {
  const startNode: ReachablePlacement = {
    piece: start,
    lastMoveWasRotate: false,
    softDropSteps: 0
  };
  const queue: ReachablePlacement[] = [startNode];
  const visited = new Map<string, number>();
  visited.set(hashNode(startNode), 0);

  const results: ReachablePlacement[] = [];

  while (queue.length > 0) {
    const current = queue.shift() as ReachablePlacement;
    const piece = current.piece;

    // 下に動けない位置は「着地点候補」
    if (!canMoveDown(field, piece)) {
      results.push(current);
    }

    const neighbors: ReachablePlacement[] = [];

    // 左移動
    {
      const moved = tryMoveLeft(field, piece);
      if (
        moved.x !== piece.x ||
        moved.y !== piece.y ||
        moved.rotation !== piece.rotation
      ) {
        neighbors.push({
          piece: moved,
          lastMoveWasRotate: false,
          softDropSteps: current.softDropSteps
        });
      }
    }

    // 右移動
    {
      const moved = tryMoveRight(field, piece);
      if (
        moved.x !== piece.x ||
        moved.y !== piece.y ||
        moved.rotation !== piece.rotation
      ) {
        neighbors.push({
          piece: moved,
          lastMoveWasRotate: false,
          softDropSteps: current.softDropSteps
        });
      }
    }

    // ソフトドロップ
    {
      const moved = trySoftDrop(field, piece);
      if (
        moved.x !== piece.x ||
        moved.y !== piece.y ||
        moved.rotation !== piece.rotation
      ) {
        neighbors.push({
          piece: moved,
          lastMoveWasRotate: false,
          softDropSteps: current.softDropSteps + 1
        });
      }
    }

    // 回転（CW）
    {
      const rotated = tryRotate(field, piece, "cw");
      if (
        rotated.x !== piece.x ||
        rotated.y !== piece.y ||
        rotated.rotation !== piece.rotation
      ) {
        neighbors.push({
          piece: rotated,
          lastMoveWasRotate: true,
          softDropSteps: current.softDropSteps
        });
      }
    }

    // 回転（CCW）
    {
      const rotated = tryRotate(field, piece, "ccw");
      if (
        rotated.x !== piece.x ||
        rotated.y !== piece.y ||
        rotated.rotation !== piece.rotation
      ) {
        neighbors.push({
          piece: rotated,
          lastMoveWasRotate: true,
          softDropSteps: current.softDropSteps
        });
      }
    }

    for (const n of neighbors) {
      const key = hashNode(n);
      const prevSoftDrops = visited.get(key);
      if (prevSoftDrops === undefined || n.softDropSteps < prevSoftDrops) {
        visited.set(key, n.softDropSteps);
        queue.push(n);
      }
    }
  }

  return results;
}

// 盤面ヒューリスティック（穴・高さ・デコボコ＋端両側の井戸＋タワー）
// [用語メモ: ヒューリスティック=厳密最適でなく“それっぽい良し悪し”を数値化する指標]
// 盤面ヒューリスティック
// - 穴 / 合計高さ / デコボコ
// - 両端が同時に深い井戸
// - 極端なタワー
// - 「深い井戸」の本数が 1 本になるよう誘導（1列開け志向）
// [用語メモ: 井戸(well)=両側にブロックがある縦の深い隙間]
// 盤面ヒューリスティック
// - 穴 / 合計高さ / デコボコ
// - 両端が同時に深い井戸
// - 極端なタワー
// - 「深い井戸」の本数が 1 本になるよう誘導（1列開け志向）
// - さらに「preferredWellColumn の井戸」を優遇、それ以外の井戸を減点
// [用語メモ: 井戸(well)=両側にブロックがある縦の深い隙間]
// src/ai/search.ts

// 盤面ヒューリスティック
// - 穴 / 合計高さ / デコボコ / 井戸
// - （オプション）開幕TDっぽい形へのボーナス
// [用語メモ: ヒューリスティック=厳密最適ではない「それっぽい良し悪し」の指標]
function evaluateFieldBasic(field: Field): number {
  const heights: number[] = new Array(FIELD_WIDTH).fill(0);
  let aggregateHeight = 0;
  let holes = 0;
  let bumpiness = 0;
  let wells = 0;
  let blockCount = 0;

  // 列ごとの高さ・穴・ブロック数
  for (let x = 0; x < FIELD_WIDTH; x++) {
    let topY = FIELD_HEIGHT; // 最初は「ブロックなし」とみなす

    for (let y = 0; y < FIELD_HEIGHT; y++) {
      if (field[y][x] !== 0) {
        topY = y;
        break;
      }
    }

    const h = FIELD_HEIGHT - topY;
    heights[x] = h;
    aggregateHeight += h;
    blockCount += h;

    // 穴: 最上段ブロックより下側で 0 になっているマス
    if (h > 0) {
      for (let y = topY + 1; y < FIELD_HEIGHT; y++) {
        if (field[y][x] === 0) {
          holes++;
        }
      }
    }
  }

  // デコボコ
  for (let x = 0; x < FIELD_WIDTH - 1; x++) {
    bumpiness += Math.abs(heights[x] - heights[x + 1]);
  }

  // 井戸の深さ合計（両隣より低い列）
  for (let x = 0; x < FIELD_WIDTH; x++) {
    const left = x === 0 ? Number.MAX_SAFE_INTEGER : heights[x - 1];
    const right =
      x === FIELD_WIDTH - 1 ? Number.MAX_SAFE_INTEGER : heights[x + 1];
    const h = heights[x];

    if (h < left && h < right) {
      wells += Math.min(left, right) - h;
    }
  }

  const maxHeight = heights.reduce((m, h) => (h > m ? h : m), 0);

  // --- ここから重みづけ ---
  // config.ai があれば使うが、なければデフォルト値で動くようにする
  const anyConfig = config as any;
  const ai =
  (anyConfig.ai as {
    aggregateHeightWeight?: number;
    holeWeight?: number;
    bumpinessWeight?: number;
    wellWeight?: number;
    openingTdBonusWeight?: number;
    tdMountainousWeight?: number;
    tdHoneyWeight?: number;
    tdStrayWeight?: number;
  }) || {};


  const aggregateHeightWeight = ai.aggregateHeightWeight ?? -0.5;
  const holeWeight = ai.holeWeight ?? -3.0;
  const bumpinessWeight = ai.bumpinessWeight ?? -0.3;
  const wellWeight = ai.wellWeight ?? 0.1;
  const openingTdBonusWeight = ai.openingTdBonusWeight ?? 0;

  let score = 0;

  score += aggregateHeightWeight * aggregateHeight;
  score += holeWeight * holes;
  score += bumpinessWeight * bumpiness;
  score += wellWeight * wells;

  // 追加: 開幕TDっぽい形へのごく軽いボーナス（新三種の神器の方向性）
  if (openingTdBonusWeight !== 0) {
    const openingScore = evaluateTdOpeningShape(heights, maxHeight, blockCount);
    // openingScore は 0〜1 程度を想定
    score += openingTdBonusWeight * openingScore;
  }

  return score;
}


// src/ai/search.ts

/**
 * TD アタック系（背面 3 列 TD）っぽい開幕形かをざっくりスコア化する。
 *
 * ここでは新三種の神器（山岳2号・はちみつ砲・迷走砲）に共通する
 * 「背面 3 列の高い山 ＋ 手前側の井戸」という構造だけを見る。
 *
 * 戻り値は 0〜1 程度の値を想定（1 に近いほど「TD 開幕っぽい」）。
 *
 * [用語メモ: 背面3列TD= TST の背中側が3列の高さで揃っている TD テンプレ群]
 */
// src/ai/search.ts

/**
 * 新三種の神器（山岳2号・はちみつ砲・迷走砲）寄せのための
 * 「TD 開幕っぽさ」スコアを返す。
 *
 * - 入力: heights[10] = 各列の高さ
 * - 出力: 0〜1 程度。1 に近いほど「どれかのテンプレの高さパターンに似ている」
 *
 * 制約:
 * - 早期盤面（開幕）に限定したバイアスにするため、
 *   高さやブロック数が大きい場合は 0 を返す。
 */
function evaluateTdOpeningShape(
  heights: number[],
  maxHeight: number,
  blockCount: number
): number {
  // まったく積んでいない / ほぼ地形ができあがっている場合は対象外
  if (maxHeight === 0) return 0;
  if (maxHeight > 10) return 0;
  if (blockCount > 80) return 0;

  // ─────────────────────────
  // 1. パターン定義（高さの“形”だけを見る）
  // ─────────────────────────
  // 10 列の相対高さパターン（0〜4 程度）をざっくり定義。
  // ※値は「山」がある位置と井戸位置の関係がそれっぽくなるように調整している。
  type TdTemplateName = "mountainous2" | "honeyCup" | "strayCannon";

  interface TdTemplate {
    name: TdTemplateName;
    pattern: number[]; // length = FIELD_WIDTH
    baseWeight: number;
  }

  const templates: TdTemplate[] = [
    {
      name: "mountainous2",
      // 中央〜右寄りに背面 3 列の山を作り、左側に浅い井戸ができやすい形を想定
      pattern: [1, 2, 3, 4, 4, 3, 2, 1, 0, 0],
      baseWeight: 1.0
    },
    {
      name: "honeyCup",
      // 右寄り高山＋中央やや低め → 右山＋中央側井戸（はちみつ砲っぽい背面配置）を想定
      pattern: [0, 1, 2, 3, 4, 4, 3, 2, 1, 0],
      baseWeight: 1.0
    },
    {
      name: "strayCannon",
      // 山岳2号と似ているが、少しだけ山の位置を内側に寄せた形を想定
      pattern: [1, 2, 3, 4, 4, 3, 2, 1, 1, 0],
      baseWeight: 1.0
    }
  ];

  // ─────────────────────────
  // 2. 実際の heights を 0〜1 に正規化
  // ─────────────────────────
  const minH = heights.reduce((m, h) => (h < m ? h : m), heights[0]);
  const shiftedHeights = heights.map((h) => h - minH);
  const maxShifted = shiftedHeights.reduce((m, h) => (h > m ? h : m), 0);
  if (maxShifted === 0) {
    // ほぼフラット＝まだ何も積んでいないに等しい
    return 0;
  }
  const normHeights = shiftedHeights.map((h) => h / maxShifted); // 0〜1

  // ─────────────────────────
  // 3. パターンごとの類似度を計算（反転も見る）
  // ─────────────────────────
  function normalizedPattern(pattern: number[]): number[] {
    const minP = pattern.reduce((m, h) => (h < m ? h : m), pattern[0]);
    const shifted = pattern.map((h) => h - minP);
    const maxP = shifted.reduce((m, h) => (h > m ? h : m), 0);
    if (maxP === 0) return pattern.map(() => 0);
    return shifted.map((h) => h / maxP);
  }

  function patternSimilarity(hs: number[], pat: number[]): number {
    let sse = 0; // sum of squared errors
    const len = Math.min(hs.length, pat.length);
    for (let i = 0; i < len; i++) {
      const diff = hs[i] - pat[i];
      sse += diff * diff;
    }
    // 最大でも 10 くらいを想定して 0〜1 にマッピング
    const normError = Math.min(sse / 10, 1);
    const score = 1 - normError; // 0(全然違う)〜1(かなり似ている)
    return score;
  }

  const reversedHeights = [...normHeights].reverse();

  // config.ai に個別ウェイトがあれば反映（無ければ 1.0）
  const anyConfig = config as any;
  const aiCfg = (anyConfig.ai as {
    tdMountainousWeight?: number;
    tdHoneyWeight?: number;
    tdStrayWeight?: number;
  }) || {};

  function templateWeight(name: TdTemplateName, base: number): number {
    switch (name) {
      case "mountainous2":
        return aiCfg.tdMountainousWeight ?? base;
      case "honeyCup":
        return aiCfg.tdHoneyWeight ?? base;
      case "strayCannon":
        return aiCfg.tdStrayWeight ?? base;
      default:
        return base;
    }
  }

  let best = 0;

  for (const tpl of templates) {
    const patNorm = normalizedPattern(tpl.pattern);
    const s1 = patternSimilarity(normHeights, patNorm);
    const s2 = patternSimilarity(reversedHeights, patNorm); // 左右反転も許容
    const s = Math.max(s1, s2);

    const weighted = s * templateWeight(tpl.name, tpl.baseWeight);
    if (weighted > best) best = weighted;
  }

  // best は概ね 0〜1.5 程度を想定。1 以上になっても openingTdBonusWeight 側で調整可能。
  return best;
}




// 1手ぶんの「行動」を表現（Hold 有無も含める）
interface AiAction {
  placement: ActivePiece;
  useHold: boolean;
  lastMoveWasRotate: boolean;
  softDropSteps: number;
  queueStateAfterCurrent: PieceQueueState; // この手を打った時点の queueState（ロック後に spawnNextPiece する対象）
}

// ビームサーチ用のノード
interface SearchNode {
  state: AiGameState;              // このノード時点のゲーム状態（次に打つミノが active に入っている）
  score: number;                   // 評価値（大きいほど良い）
  firstMove: AiMoveRecommendation; // ルートから見た「最初の1手」
}

// 現在の AiGameState から「1手で取り得る行動一覧」を列挙（Hold/非Hold込み）
function enumerateActionsForState(state: AiGameState): AiAction[] {
  if (!state.active) return [];

  const actions: AiAction[] = [];

  // --- ブランチ1: Holdしないで今のアクティブをそのまま使う ---
  {
    const placements = enumerateReachablePlacements(state.field, state.active);
    for (const p of placements) {
      actions.push({
        placement: p.piece,
        useHold: false,
        lastMoveWasRotate: p.lastMoveWasRotate,
        softDropSteps: p.softDropSteps,
        queueStateAfterCurrent: state.queueState
      });
    }
  }

  // --- ブランチ2: この手で Hold を使う ---
  if (state.queueState.canHold) {
    const currentType = state.active.type;

    // Hold を使ったときに登場する「新しい current の種類」を取得
    const holdResult = holdCurrentPiece(
      state.queueState,
      currentType,
      state.physics.nextCount
    );
    const heldCurrentType = holdResult.current;

    const spawned = spawnActivePiece(state.field, heldCurrentType);
    if (spawned) {
      const placementsHold = enumerateReachablePlacements(
        state.field,
        spawned
      );
      for (const p of placementsHold) {
        actions.push({
          placement: p.piece,
          useHold: true,
          lastMoveWasRotate: p.lastMoveWasRotate,
          softDropSteps: p.softDropSteps,
          queueStateAfterCurrent: holdResult.state
        });
      }
    }
    // spawned が null の場合は、Hold した瞬間にゲームオーバーなので候補から除外
  }

  return actions;
}

// root候補の上位のみ簡易サンプリング
const MAX_ROOT_DEBUG_CANDIDATES = 5;

function pushRootCandidate(
  arr: AiCandidateDebug[],
  cand: AiCandidateDebug
): void {
  arr.push(cand);
  arr.sort((a, b) => b.score - a.score);
  if (arr.length > MAX_ROOT_DEBUG_CANDIDATES) {
    arr.length = MAX_ROOT_DEBUG_CANDIDATES;
  }
}

// 1手適用して次の AiGameState を作り、
// 「この一手で増えた KPI（ΔwindowScore）＋盤面ヒューリスティック」で評価する。
// - state: この手を打つ前の状態
// - action: 打つ手（配置・Hold有無・最後回転フラグなど）
function applyMoveAndEvaluate(
  state: AiGameState,
  action: AiAction
): { nextState: AiGameState; score: number } {
  const workField = cloneField(state.field);
  const filledBefore = countFilledCells(workField);

  // ロック前の KPI を控える（B2B状態含む）
  const kpiBefore = state.kpi.windowScore;

  // ピースをロック
  const lockedField = lockPiece(workField, action.placement);
  const { field: clearedField, clearedLines } = clearFullLines(lockedField);
  const clearedCount = clearedLines.length;

  let kpiState = state.kpi;

  if (clearedCount > 0) {
    const detection = detectTSpin({
      field: lockedField,
      piece: action.placement,
      linesCleared: clearedCount,
      lastMoveWasRotate: action.lastMoveWasRotate
    });

    kpiState = applyLineClear(kpiState, {
      kind: detection.lineClearKind,
      // 探索空間内では「時間の経過」は無視し、同じ elapsedMs を使う
      timestampMs: state.elapsedMs
    });
  }

  // 「この一手」でどれだけ KPI が増えたか（B2Bボーナスも含む）
  const deltaKpi = kpiState.windowScore - kpiBefore;

  // 次のミノをキューから取得
  const spawnRes = spawnNextPiece(
    action.queueStateAfterCurrent,
    state.physics.nextCount
  );
  const nextQueueState = spawnRes.state;
  const nextPieceType = spawnRes.current;

  const nextActive = spawnActivePiece(clearedField, nextPieceType);

  const nextState: AiGameState = {
    field: clearedField,
    active: nextActive,
    hold: nextQueueState.hold,
    nextPieces: nextQueueState.queue.slice(0, state.physics.nextCount),
    queueState: nextQueueState,
    kpi: kpiState,
    elapsedMs: state.elapsedMs, // 探索中は固定とみなす（300秒窓の影響はほぼ無視できる範囲）
    physics: state.physics
  };

  // 評価: 「この一手での火力増分（ΔKPI）」＋盤面ヒューリスティック
  const fieldScore = evaluateFieldBasic(clearedField);
  const KPI_WEIGHT = 25;   // ΔKPI をかなり重く見る
  const FIELD_WEIGHT = 1;  // 盤面安定度はタイブレーク寄り

  let score = deltaKpi * KPI_WEIGHT + fieldScore * FIELD_WEIGHT;

  // 開幕の新三種の神器（山岳2号・はちみつ砲・迷走砲）を目指す際、
  // できるだけソフトドロップを減らした最短ルートを優先するための軽いペナルティ。
  const anyConfig = config as any;
  const aiCfg = (anyConfig.ai as { openingSoftDropWeight?: number }) || {};
  const openingSoftDropWeight = aiCfg.openingSoftDropWeight ?? 0;
  if (openingSoftDropWeight !== 0) {
    const OPENING_BLOCK_LIMIT = 28; // 7ピース分（1バッグ）までは「開幕」扱い
    if (filledBefore < OPENING_BLOCK_LIMIT) {
      const openingPhase = 1 - Math.min(filledBefore / OPENING_BLOCK_LIMIT, 1);
      const penalty = action.softDropSteps * openingPhase;
      score += openingSoftDropWeight * penalty;
    }
  }

  return { nextState, score };
}

// 深さ maxDepth のビームサーチ（maxDepth=1 のときは 1 手読み）
export function searchBestMoveOneStep(
  state: AiGameState,
  searchConfig: AiSearchConfig
): AiResponse {
  if (!state.active) {
    return {
      best: null,
      exploredStates: 0,
      elapsedMs: 0,
      debug: {
        depthReached: 0,
        exploredStates: 0,
        rootCandidatesSample: []
      }
    };
  }

  const startMs = nowMs();
  const maxDepth = Math.max(1, searchConfig.maxDepth | 0); // 念のため 1 以上に丸める
  const beamWidth = Math.max(1, searchConfig.beamWidth | 0);
  const timeLimit = searchConfig.timeLimitMsPerMove;

  let exploredStates = 0;

  let globalBestMove: AiMoveRecommendation | null = null;
  let globalBestScore = -Infinity;

  const initialActions = enumerateActionsForState(state);
  if (initialActions.length === 0) {
    // どこにも置けない＝実質ゲームオーバー
    const elapsedMs = nowMs() - startMs;
    return {
      best: null,
      exploredStates: 0,
      elapsedMs,
      debug: {
        depthReached: 1,
        exploredStates: 0,
        rootCandidatesSample: []
      }
    };
  }

  const rootNodes: SearchNode[] = [];
  const rootCandidatesSample: AiCandidateDebug[] = [];

  // --- 深さ1: ルート直下の候補を全部評価 ---
  for (const action of initialActions) {
    const { nextState, score } = applyMoveAndEvaluate(state, action);
    exploredStates++;

    const placement = action.placement;
    const rotation = (placement.rotation & 3) as 0 | 1 | 2 | 3;
    const firstMove: AiMoveRecommendation = {
      x: placement.x,
      y: placement.y,
      rotation,
      pieceType: placement.type,
      useHold: action.useHold,
      score
    };

    if (score > globalBestScore) {
      globalBestScore = score;
      globalBestMove = firstMove;
    }

    // root候補の上位サンプルを記録
    pushRootCandidate(rootCandidatesSample, {
      pieceType: placement.type,
      x: placement.x,
      y: placement.y,
      rotation,
      useHold: action.useHold,
      score
    });

    rootNodes.push({
      state: nextState,
      score,
      firstMove
    });
  }

  // maxDepth=1 ならここまでで終了（従来の1手読み相当）
  if (maxDepth === 1 || rootNodes.length === 0) {
    const elapsedMs = nowMs() - startMs;
    const debug: AiSearchDebugInfo = {
      depthReached: 1,
      exploredStates,
      rootCandidatesSample
    };
    return {
      best: globalBestMove,
      exploredStates,
      elapsedMs,
      debug
    };
  }

  // ビーム初期化（depth=1 のノードからスコア順に beamWidth 個）
  let beam: SearchNode[] = rootNodes
    .sort((a, b) => b.score - a.score)
    .slice(0, beamWidth);

  let depth = 1;
  let timeUp = false;

  // --- 深さ2〜maxDepth: ビームサーチ ---
  while (!timeUp && depth < maxDepth && beam.length > 0) {
    const nextBeam: SearchNode[] = [];

    for (const node of beam) {
      // 時間制約チェック
      const elapsed = nowMs() - startMs;
      if (elapsed >= timeLimit) {
        timeUp = true;
        break;
      }

      const nodeState = node.state;
      if (!nodeState.active) {
        // すでにトップアウトしているノードは展開しない
        continue;
      }

      const actions = enumerateActionsForState(nodeState);
      if (actions.length === 0) {
        continue;
      }

      for (const action of actions) {
        const innerElapsed = nowMs() - startMs;
        if (innerElapsed >= timeLimit) {
          timeUp = true;
          break;
        }

        const { nextState, score } = applyMoveAndEvaluate(
          nodeState,
          action
        );
        exploredStates++;

        // firstMove はルート時点のものを引き継ぐ
        const firstMove = node.firstMove;

        if (score > globalBestScore) {
          globalBestScore = score;
          globalBestMove = firstMove;
        }

        nextBeam.push({
          state: nextState,
          score,
          firstMove
        });
      }

      if (timeUp) break;
    }

    if (timeUp || nextBeam.length === 0) {
      break;
    }

    // スコア上位 beamWidth 個に絞り込む
    beam = nextBeam.sort((a, b) => b.score - a.score).slice(0, beamWidth);
    depth++;
  }

  const finalElapsedMs = nowMs() - startMs;
  const debug: AiSearchDebugInfo = {
    depthReached: depth,
    exploredStates,
    rootCandidatesSample
  };

  return {
    best: globalBestMove,
    exploredStates,
    elapsedMs: finalElapsedMs,
    debug
  };
}
