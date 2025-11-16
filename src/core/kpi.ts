// src/core/kpi.ts

// なぜ: ライン消去イベントを入力として、火力KPIを一元管理するためのコアモジュール。
//       ・Single/Double/Triple/Tetris
//       ・T-Spin Mini/Normal
//       ・B2Bボーナス
//       ・300秒ウィンドウ
//       をここで完結させる。

// [用語メモ: LineClearKind = ライン消去の種類を表す分類ラベル]
export type LineClearKind =
  | "none"
  | "single"
  | "double"
  | "triple"
  | "tetris"
  | "tspinMiniSingle"
  | "tspinSingle"
  | "tspinDouble"
  | "tspinTriple";

// スコア表（初期値）
// Single:0 / Double:1 / Triple:2 / Tetris:4
// T-Spin Mini Single:1 / T-Spin Single:2 / T-Spin Double:4 / T-Spin Triple:6
const BASE_SCORES: Record<LineClearKind, number> = {
  none: 0,
  single: 0,
  double: 1,
  triple: 2,
  tetris: 4,
  tspinMiniSingle: 1,
  tspinSingle: 2,
  tspinDouble: 4,
  tspinTriple: 6
};

// [用語メモ: B2B対象 = B2Bボーナスの対象になり得るライン消去の種類]
const B2B_ELIGIBLE_KINDS: LineClearKind[] = [
  "tetris",
  "tspinMiniSingle", // MiniをB2B対象に含める初期設定
  "tspinSingle",
  "tspinDouble",
  "tspinTriple"
];

export const KPI_WINDOW_MS = 300_000; // 300秒 = 5分

export interface KpiEventEntry {
  timestampMs: number;
  score: number;
}

export interface KpiState {
  // 全履歴の累積KPIスコア
  totalScore: number;
  // 直近300秒ウィンドウのKPIスコア
  windowScore: number;
  // ウィンドウ集計用のイベント履歴（300秒を超えたら自動的に間引く）
  windowEvents: KpiEventEntry[];
  // 現時点でB2B中かどうか
  b2bActive: boolean;
}

// ライン消去イベントの入力
export interface LineClearEventInput {
  kind: LineClearKind;
  timestampMs: number;
  // 将来の拡張余地としてPCフラグを残すが、KPIには加点しない前提なので現時点では未使用
  isPerfectClear?: boolean;
}

// 初期状態（ゲーム開始時）の KPI state
export function createInitialKpiState(): KpiState {
  return {
    totalScore: 0,
    windowScore: 0,
    windowEvents: [],
    b2bActive: false
  };
}

function isB2BEligible(kind: LineClearKind): boolean {
  return B2B_ELIGIBLE_KINDS.includes(kind);
}

export function scoreForKind(kind: LineClearKind): number {
  return BASE_SCORES[kind] ?? 0;
}

/**
 * ライン消去イベントを1つ適用して、新しいKpiStateを返す。
 *
 * 前提:
 * - REN（コンボ）やPCのボーナスはここでは一切加点しない。
 * - kind="none" はKPIに影響しないイベントとして扱う（B2Bも変化させない）。
 */
export function applyLineClear(
  state: KpiState,
  event: LineClearEventInput
): KpiState {
  const { kind, timestampMs } = event;

  let b2bActive = state.b2bActive;
  let base = scoreForKind(kind);
  let bonus = 0;

  // kind=none の場合はスコアイベントを発生させない（REN/PC由来の何かは無視）
  if (kind === "none") {
    // ただしウィンドウの掃除は行ってもよいので、ここで prune だけする実装も可能。
    const cutoff = timestampMs - KPI_WINDOW_MS;
    const pruned = state.windowEvents.filter(
      (e) => e.timestampMs >= cutoff
    );
    const windowScore = pruned.reduce((sum, e) => sum + e.score, 0);

    return {
      totalScore: state.totalScore,
      windowScore,
      windowEvents: pruned,
      b2bActive
    };
  }

  // B2B判定
  if (isB2BEligible(kind)) {
    if (b2bActive) {
      // 既にB2B中なら今回の消去に +1 ボーナス
      bonus = 1;
    }
    b2bActive = true;
  } else {
    // B2B対象外のライン消去が入るとチェーンは切れる
    b2bActive = false;
  }

  const score = base + bonus;

  // 300秒のウィンドウを更新
  const cutoff = timestampMs - KPI_WINDOW_MS;
  const prunedEvents = state.windowEvents.filter(
    (e) => e.timestampMs >= cutoff
  );

  if (score > 0) {
    prunedEvents.push({ timestampMs, score });
  }

  const windowScore = prunedEvents.reduce((sum, e) => sum + e.score, 0);

  return {
    totalScore: state.totalScore + score,
    windowScore,
    windowEvents: prunedEvents,
    b2bActive
  };
}
