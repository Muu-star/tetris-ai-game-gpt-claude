import React from "react";
import { useTetrisGame, DEFAULT_AI_SEARCH_CONFIG } from "./hooks/useTetrisGame";
import { KeyConfigUI } from "./KeyConfigUI";

// Components
import { GameLayout } from "./components/GameLayout";
import { ScoreBoard } from "./components/ScoreBoard";
import { HoldNextPanel } from "./components/HoldNextPanel";
import { StatusOverlay } from "./components/StatusOverlay";
import { AiInfoPanel } from "./components/AiInfoPanel";
import { ControlsGuide } from "./components/ControlsGuide";
import { TetrisBoard } from "./components/TetrisBoard";

const NEXT_PREVIEW_COUNT = 5; // Should match config

export const TetrisRenderer: React.FC = () => {
  const {
    state,
    keyBindings,
    setKeyBindings,
    showKeyConfig,
    setShowKeyConfig,
    handleRestart
  } = useTetrisGame();

  return (
    <>
      <GameLayout
        board={
          <>
            <TetrisBoard
              field={state.field}
              active={state.active}
              aiMove={state.aiMove}
            />
            <StatusOverlay
              gameOver={state.gameOver}
              onRestart={handleRestart}
            />
          </>
        }
        hold={
          <HoldNextPanel
            title="HOLD"
            piece={state.pieceQueue.hold}
          />
        }
        next={
          <HoldNextPanel
            title="NEXT"
            pieces={state.pieceQueue.queue.slice(0, NEXT_PREVIEW_COUNT)}
          />
        }
        score={
          <ScoreBoard
            kpi={state.kpi}
            lastClearedLines={state.lastClearedLines}
            totalClearedLines={state.totalClearedLines}
          />
        }
        stats={null}
        controls={
          <ControlsGuide
            onOpenConfig={() => setShowKeyConfig(true)}
          />
        }
        aiInfo={
          <AiInfoPanel
            aiMove={state.aiMove}
            aiElapsedMs={state.aiElapsedMs}
            aiDebug={state.aiDebug}
            config={DEFAULT_AI_SEARCH_CONFIG}
          />
        }
      />

      {showKeyConfig && (
        <KeyConfigUI
          bindings={keyBindings}
          onClose={() => setShowKeyConfig(false)}
          onSave={(newBindings) => setKeyBindings(newBindings)}
        />
      )}
    </>
  );
};
