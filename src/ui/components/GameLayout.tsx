import React from 'react';

interface GameLayoutProps {
  board: React.ReactNode;
  hold: React.ReactNode;
  next: React.ReactNode;
  score: React.ReactNode;
  stats: React.ReactNode;
  controls: React.ReactNode;
  aiInfo: React.ReactNode;
}

export const GameLayout: React.FC<GameLayoutProps> = ({
  board,
  hold,
  next,
  score,
  stats,
  controls,
  aiInfo,
}) => {
  return (
    <div className="game-layout">
      <div className="layout-slot hold-slot">
        {hold}
      </div>
      <div className="layout-slot board-slot">
        {board}
      </div>
      <div className="layout-slot next-slot">
        {next}
      </div>
      <div className="layout-slot score-slot">
        {score}
      </div>
      <div className="layout-slot stats-slot">
        {stats}
      </div>
      <div className="layout-slot controls-slot">
        {controls}
      </div>
      <div className="layout-slot ai-info-slot">
        {aiInfo}
      </div>
    </div>
  );
};
