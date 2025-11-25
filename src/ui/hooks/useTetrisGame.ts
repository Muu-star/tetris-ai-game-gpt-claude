import { useEffect, useRef, useState } from "react";
import {
    createEmptyField,
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
} from "../../core/gravity";
import type { Field, ActivePiece } from "../../core/gravity";
import type { PieceType } from "../../core/srs";
import config from "../../config";
import { createInitialKpiState, applyLineClear } from "../../core/kpi";
import type { KpiState } from "../../core/kpi";
import { detectTSpin } from "../../core/tspin";
import {
    createInitialPieceQueue,
    spawnNextPiece,
    holdCurrentPiece,
    type PieceQueueState
} from "../../core/pieceQueue";
import { getAiWorker } from "../../ai/workerInterface";
import type {
    AiGameState,
    AiMoveRecommendation,
    AiSearchConfig,
    AiSearchDebugInfo
} from "../../ai/types";
import type { KeyBindings } from "../../core/keyBindings";
import {
    loadKeyBindings,
    getActionForKey,
} from "../../core/keyBindings";

// Constants
const GRAVITY_CPS = config.gravityCPS;
const GRAVITY_INTERVAL_MS = 1000 / GRAVITY_CPS;
const DAS_MS: number = (config as any).dasMs ?? 133;
const ARR_MS: number = (config as any).arrMs ?? 10;
const SOFT_DROP_MULTIPLIER: number = (config as any).softDropMultiplier ?? 1;
const SOFT_DROP_INTERVAL_MS =
    SOFT_DROP_MULTIPLIER > 0
        ? GRAVITY_INTERVAL_MS / SOFT_DROP_MULTIPLIER
        : GRAVITY_INTERVAL_MS;
const LOCK_DELAY_MS = config.lockDelayMs;
const LOCK_RESETS_MAX = config.lockResetsMax;
const NEXT_PREVIEW_COUNT: number = (config as any).nextCount ?? 5;
const DEFAULT_RNG_SEED: number = (config as any).rngSeed ?? 123456789;

export const DEFAULT_AI_SEARCH_CONFIG: AiSearchConfig = {
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

export type GameState = {
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

// GameState に対して AI を1回走らせ、aiMove/aiElapsedMs を更新する（非同期）
async function recomputeAi(state: GameState): Promise<GameState> {
    if (!state.active) {
        return { ...state, aiMove: null, aiElapsedMs: 0, aiDebug: null };
    }

    const aiState = buildAiGameStateForSearch(state);
    const aiWorker = getAiWorker();
    const result = await aiWorker.search(aiState, DEFAULT_AI_SEARCH_CONFIG);

    return {
        ...state,
        aiMove: result.best,
        aiElapsedMs: result.elapsedMs,
        aiDebug: result.debug ?? null
    };
}

// AI計算なしの初期状態を作成（同期）
function createInitialGameStateSync(): GameState {
    const field = createEmptyField();

    // 7-bag＋Hold＋Next の初期化＋最初のミノ取得
    const { state: pieceQueue, current: firstPieceType } =
        createInitialPieceQueue(DEFAULT_RNG_SEED, NEXT_PREVIEW_COUNT);

    const active = spawnActivePiece(field, firstPieceType);
    const gameOver = active === null;
    const isOnGround =
        active != null ? !canMoveDown(field, active) : false;

    return {
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
}

// 1フレームぶんのゲーム更新
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
                break;
            }
            currentPiece = after;

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

        return { ...nextState, aiMove: null };
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

    return nextState;
}

export function useTetrisGame() {
    const [state, setState] = useState<GameState>(() => createInitialGameStateSync());
    const [keyBindings, setKeyBindings] = useState<KeyBindings>(() => loadKeyBindings());
    const [showKeyConfig, setShowKeyConfig] = useState(false);

    // 入力状態（キー押しっぱなし）
    const inputRef = useRef<InputSnapshot>({
        leftHeld: false,
        rightHeld: false,
        softDropHeld: false
    });

    // AI計算の進行中フラグ
    const aiComputingRef = useRef(false);

    // AI計算が必要な時に自動実行
    useEffect(() => {
        if (!state.active || state.aiMove !== null || state.gameOver || aiComputingRef.current) {
            return;
        }

        aiComputingRef.current = true;

        recomputeAi(state).then(newState => {
            aiComputingRef.current = false;
            setState(newState);
        }).catch(error => {
            console.error('AI computation error:', error);
            aiComputingRef.current = false;
        });
    }, [state.active, state.aiMove, state.currentPieceType, state.pieceQueue.hold, state.gameOver]);

    // キーボード入力
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.code === "Escape") {
                e.preventDefault();
                setShowKeyConfig(prev => !prev);
                return;
            }

            if (showKeyConfig) {
                return;
            }

            const action = getActionForKey(e.code, keyBindings);

            if (action || e.code === "Escape") {
                e.preventDefault();
            }

            if (action === 'MOVE_LEFT') {
                inputRef.current.leftHeld = true;
            } else if (action === 'MOVE_RIGHT') {
                inputRef.current.rightHeld = true;
            } else if (action === 'SOFT_DROP') {
                inputRef.current.softDropHeld = true;
            }

            const ignoreRepeatForMove =
                action === 'MOVE_LEFT' ||
                action === 'MOVE_RIGHT' ||
                action === 'SOFT_DROP';

            setState((prev) => {
                if (ignoreRepeatForMove && e.repeat) {
                    return prev;
                }

                if (action === 'RESTART') {
                    const newState = createInitialGameStateSync();
                    recomputeAi(newState).then(stateWithAi => {
                        setState(stateWithAi);
                    });
                    return newState;
                }

                if (prev.gameOver) {
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

                switch (action) {
                    case 'MOVE_LEFT': {
                        newActive = tryMoveLeft(newField, active);
                        lastMoveWasRotate = false;
                        break;
                    }
                    case 'MOVE_RIGHT': {
                        newActive = tryMoveRight(newField, active);
                        lastMoveWasRotate = false;
                        break;
                    }
                    case 'SOFT_DROP': {
                        newActive = trySoftDrop(newField, active);
                        lastMoveWasRotate = false;
                        break;
                    }
                    case 'ROTATE_CCW': {
                        newActive = tryRotate(newField, active, "ccw");
                        lastMoveWasRotate = true;
                        break;
                    }
                    case 'ROTATE_CW': {
                        newActive = tryRotate(newField, active, "cw");
                        lastMoveWasRotate = true;
                        break;
                    }
                    case 'HOLD': {
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

                        return { ...nextState, aiMove: null };
                    }
                    case 'HARD_DROP': {
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

                        return { ...nextState, aiMove: null };
                    }
                    default:
                        return prev;
                }

                if (!newActive) {
                    return prev;
                }

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
            if (showKeyConfig) {
                return;
            }

            const action = getActionForKey(e.code, keyBindings);

            if (action) {
                e.preventDefault();
            }

            if (action === 'MOVE_LEFT') {
                inputRef.current.leftHeld = false;
            } else if (action === 'MOVE_RIGHT') {
                inputRef.current.rightHeld = false;
            } else if (action === 'SOFT_DROP') {
                inputRef.current.softDropHeld = false;
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
        };
    }, [keyBindings, showKeyConfig]);

    // ゲームループ
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

    const handleRestart = () => {
        const newState = createInitialGameStateSync();
        recomputeAi(newState).then(stateWithAi => {
            setState(stateWithAi);
        });
    };

    return {
        state,
        keyBindings,
        setKeyBindings,
        showKeyConfig,
        setShowKeyConfig,
        handleRestart
    };
}
