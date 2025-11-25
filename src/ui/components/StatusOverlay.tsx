import React from 'react';

interface StatusOverlayProps {
    gameOver: boolean;
    onRestart: () => void;
}

export const StatusOverlay: React.FC<StatusOverlayProps> = ({
    gameOver,
    onRestart,
}) => {
    if (!gameOver) return null;

    return (
        <div className="status-overlay">
            <div className="status-content">
                <h2 className="status-title">GAME OVER</h2>
                <p className="status-message">Press Space or Button to Restart</p>
                <button className="restart-button" onClick={onRestart}>
                    RESTART
                </button>
            </div>
        </div>
    );
};
