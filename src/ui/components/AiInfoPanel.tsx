import React from 'react';
import { AiMoveRecommendation, AiSearchDebugInfo, AiSearchConfig } from '../../ai/types';

interface AiInfoPanelProps {
    aiMove: AiMoveRecommendation | null;
    aiElapsedMs: number;
    aiDebug: AiSearchDebugInfo | null;
    config: AiSearchConfig;
}

export const AiInfoPanel: React.FC<AiInfoPanelProps> = ({
    aiMove,
    aiElapsedMs,
    aiDebug,
    config,
}) => {
    return (
        <div className="ai-info-panel">
            <h3>AI Status</h3>

            <div className="ai-stat-row">
                <span className="label">Time:</span>
                <span className="value">{aiElapsedMs.toFixed(2)}ms</span>
            </div>

            <div className="ai-stat-row">
                <span className="label">Explored:</span>
                <span className="value">{aiDebug?.exploredStates ?? 0}</span>
            </div>

            <div className="ai-stat-row">
                <span className="label">Depth:</span>
                <span className="value">{aiDebug?.depthReached ?? 0} / {config.maxDepth}</span>
            </div>

            <div className="ai-recommendation">
                <h4>Recommendation</h4>
                {aiMove ? (
                    <div className="rec-details">
                        <div>Piece: {aiMove.pieceType}</div>
                        <div>Pos: ({aiMove.x}, {aiMove.y})</div>
                        <div>Rot: {aiMove.rotation}</div>
                        <div>Hold: {aiMove.useHold ? 'YES' : 'NO'}</div>
                    </div>
                ) : (
                    <div className="rec-placeholder">Thinking...</div>
                )}
            </div>

            <div className="ai-candidates">
                <h4>Top Candidates</h4>
                <div className="candidates-list">
                    {aiDebug?.rootCandidatesSample.slice(0, 3).map((c, i) => (
                        <div key={i} className="candidate-item">
                            <span className="rank">#{i + 1}</span>
                            <span className="info">{c.pieceType}{c.useHold ? '(H)' : ''} @ {c.x},{c.rotation}</span>
                            <span className="score">{c.score.toFixed(1)}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
