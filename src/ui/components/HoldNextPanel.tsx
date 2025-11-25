import React, { useEffect, useRef } from 'react';
import { PieceType, getPieceCells } from '../../core/srs';
import { PIECE_COLORS } from './TetrisBoard';

interface HoldNextPanelProps {
    title: string;
    pieces?: PieceType[];
    piece?: PieceType | null;
    className?: string;
}

export const HoldNextPanel: React.FC<HoldNextPanelProps> = ({
    title,
    pieces,
    piece,
    className = '',
}) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const previewCellSize = 24;
        const previewSpacing = 16;
        const previewWidth = 120;

        // Calculate height based on content
        let previewHeight = 120;
        if (pieces) {
            const baseHeight = pieces.length * (previewCellSize * 3 + previewSpacing); // Approximate height per piece
            previewHeight = baseHeight + 20;
        }

        canvas.width = previewWidth;
        canvas.height = previewHeight;

        // Clear background
        ctx.clearRect(0, 0, previewWidth, previewHeight);

        const drawPiece = (p: PieceType, offsetY: number) => {
            const cells = getPieceCells(p, 0, 0, 0);

            let minX = Math.min(...cells.map(c => c.x));
            let minY = Math.min(...cells.map(c => c.y));
            let maxX = Math.max(...cells.map(c => c.x));
            let maxY = Math.max(...cells.map(c => c.y));
            const pieceWidth = (maxX - minX + 1) * previewCellSize;
            const pieceHeight = (maxY - minY + 1) * previewCellSize;

            const centerX = (previewWidth - pieceWidth) / 2;
            // For single piece (Hold), center vertically too
            const centerY = pieces ? offsetY : (previewHeight - pieceHeight) / 2;

            const color = PIECE_COLORS[p];
            for (const cell of cells) {
                const x = centerX + (cell.x - minX) * previewCellSize;
                const y = centerY + (cell.y - minY) * previewCellSize;

                ctx.fillStyle = color;
                ctx.fillRect(
                    x + 1,
                    y + 1,
                    previewCellSize - 2,
                    previewCellSize - 2
                );
            }
            return pieceHeight;
        };

        if (piece) {
            drawPiece(piece, 0);
        } else if (pieces) {
            let yOffset = 10;
            for (const p of pieces) {
                const h = drawPiece(p, yOffset);
                yOffset += h + previewSpacing;
            }
        }

    }, [pieces, piece]);

    return (
        <div className={`hold-next-panel ${className}`}>
            <h3 className="panel-title">{title}</h3>
            <div className="canvas-wrapper">
                <canvas ref={canvasRef} className="preview-canvas" />
            </div>
        </div>
    );
};
