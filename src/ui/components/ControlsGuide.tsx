import React from 'react';

interface ControlsGuideProps {
    onOpenConfig: () => void;
}

export const ControlsGuide: React.FC<ControlsGuideProps> = ({ onOpenConfig }) => {
    return (
        <div className="controls-guide">
            <h3>Controls</h3>
            <ul className="controls-list">
                <li><span>← →</span> Move</li>
                <li><span>↓</span> Soft Drop</li>
                <li><span>Space</span> Hard Drop</li>
                <li><span>Z / X / ↑</span> Rotate</li>
                <li><span>C</span> Hold</li>
            </ul>
            <button className="config-button" onClick={onOpenConfig}>
                Key Config (ESC)
            </button>
        </div>
    );
};
