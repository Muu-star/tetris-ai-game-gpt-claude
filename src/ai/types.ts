// src/ai/types.ts
import type { Field, ActivePiece } from "../core/gravity";
import type { PieceType } from "../core/srs";
import type { PieceQueueState } from "../core/pieceQueue";
import type { KpiState } from "../core/kpi";

// 物理パラメータ（ゲーム本体とAIで共有）
export interface AiPhysicsConfig {
  gravityCps: number;
  softDropMultiplier: number;
  dasMs: number;
  arrMs: number;
  lockDelayMs: number;
  lockResetsMax: number;
  nextCount: number;
}

// AIが見るゲーム状態
export interface AiGameState {
  field: Field;
  active: ActivePiece | null;
  hold: PieceType | null;
  nextPieces: PieceType[];
  queueState: PieceQueueState;
  kpi: KpiState;
  elapsedMs: number;      // 経過時間（いまはほぼスタブ扱い）
  physics: AiPhysicsConfig;
}

// 探索設定
export interface AiSearchConfig {
  beamWidth: number;          // ビーム幅（候補数）
  maxDepth: number;           // 先読み深さ（手数）
  timeLimitMsPerMove: number; // 1手あたり時間制限（ms）
}

// 実際に打つ「1手」の推奨
export interface AiMoveRecommendation {
  x: number;
  y: number;
  rotation: 0 | 1 | 2 | 3;
  pieceType: PieceType;
  useHold: boolean;
  score: number; // 評価値（内部スコア）
}

// デバッグ用：root（最初の1手）の候補サマリ
export interface AiCandidateDebug {
  pieceType: PieceType;
  x: number;
  y: number;
  rotation: 0 | 1 | 2 | 3;
  useHold: boolean;
  score: number;
}

// デバッグ用：探索全体の情報
export interface AiSearchDebugInfo {
  depthReached: number;                // 実際に到達した最大深さ
  exploredStates: number;              // 展開した状態数（ノード数）
  rootCandidatesSample: AiCandidateDebug[]; // root候補の上位サンプル
}

// 探索結果
export interface AiResponse {
  best: AiMoveRecommendation | null;
  exploredStates: number;
  elapsedMs: number;
  debug?: AiSearchDebugInfo;
}

// Worker通信用のメッセージ型
export interface AiWorkerRequest {
  type: 'search';
  state: AiGameState;
  config: AiSearchConfig;
}

export interface AiWorkerResponse {
  type: 'result';
  result: AiResponse;
}
