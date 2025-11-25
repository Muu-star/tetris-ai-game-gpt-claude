import React from 'react';
import { KpiState } from '../../core/kpi';

interface ScoreBoardProps {
    kpi: KpiState;
    lastClearedLines: number;
    totalClearedLines: number;
    level?: number; // 将来的にレベル実装したとき用
}

export const ScoreBoard: React.FC<ScoreBoardProps> = ({
    kpi,
    lastClearedLines,
    totalClearedLines,
}) => {
    return (
        <div className="score-board">
            <div className="score-section">
                <h3>SCORE (5min KPI)</h3>
                <div className="score-value highlight">{kpi.windowScore.toLocaleString()}</div>
            </div>

            <div className="score-section">
                <h3>TOTAL SCORE</h3>
                <div className="score-value">{kpi.totalScore.toLocaleString()}</div>
            </div>

            <div className="stat-grid">
                <div className="stat-item">
                    <span className="stat-label">LINES</span>
                    <span className="stat-value">{totalClearedLines}</span>
                </div>
                <div className="stat-item">
                    <span className="stat-label">LAST</span>
                    <span className="stat-value">{lastClearedLines > 0 ? `+${lastClearedLines}` : '-'}</span>
                </div>
            </div>
        </div>
    );
};
