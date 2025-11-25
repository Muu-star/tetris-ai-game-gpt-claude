import React, { useEffect, useRef } from "react";
import { FIELD_WIDTH, FIELD_HEIGHT, hardDrop } from "../../core/gravity";
import type { Field, ActivePiece } from "../../core/gravity";
import type { PieceType } from "../../core/srs";
import { getPieceCells } from "../../core/srs";
import type { AiMoveRecommendation } from "../../ai/types";

const VISIBLE_ROWS = 20;
const CELL_SIZE = 32;
const BOARD_BORDER = 2;

// HEX色をRGBA形式に変換するヘルパー関数
function hexToRgba(hex: string, alpha: number): string {
    let r: number, g: number, b: number;

    if (hex.length === 4) {
        r = parseInt(hex[1] + hex[1], 16);
        g = parseInt(hex[2] + hex[2], 16);
        b = parseInt(hex[3] + hex[3], 16);
    } else {
        r = parseInt(hex.slice(1, 3), 16);
        g = parseInt(hex.slice(3, 5), 16);
        b = parseInt(hex.slice(5, 7), 16);
    }

    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ピースタイプごとの色定義
export const PIECE_COLORS: Record<PieceType, string> = {
    I: "#0ff",
    O: "#ff0",
    T: "#a0f",
    S: "#0f0",
    Z: "#f00",
    J: "#00f",
    L: "#fa0"
};

interface TetrisBoardProps {
    field: Field;
    active: ActivePiece | null;
    aiMove: AiMoveRecommendation | null;
}

export const TetrisBoard: React.FC<TetrisBoardProps> = ({
    field,
    active,
    aiMove
}) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const width = FIELD_WIDTH * CELL_SIZE;
        const height = VISIBLE_ROWS * CELL_SIZE;
        canvas.width = width;
        canvas.height = height;

        // 背景クリア
        ctx.clearRect(0, 0, width, height);

        // 背景
        ctx.fillStyle = "#111";
        ctx.fillRect(0, 0, width, height);

        // グリッド線
        ctx.strokeStyle = "#333";
        ctx.lineWidth = 1;

        const visibleStartY = FIELD_HEIGHT - VISIBLE_ROWS;

        for (let y = 0; y < VISIBLE_ROWS; y++) {
            for (let x = 0; x < FIELD_WIDTH; x++) {
                const px = x * CELL_SIZE;
                const py = y * CELL_SIZE;
                ctx.strokeRect(px, py, CELL_SIZE, CELL_SIZE);
            }
        }

        const drawCell = (gridX: number, gridY: number, color: string) => {
            const visibleY = gridY - visibleStartY;
            if (visibleY < 0 || visibleY >= VISIBLE_ROWS) return;
            const px = gridX * CELL_SIZE;
            const py = visibleY * CELL_SIZE;

            ctx.fillStyle = color;
            ctx.fillRect(
                px + BOARD_BORDER,
                py + BOARD_BORDER,
                CELL_SIZE - BOARD_BORDER * 2,
                CELL_SIZE - BOARD_BORDER * 2
            );
        };

        // ロック済みブロック
        for (let y = visibleStartY; y < FIELD_HEIGHT; y++) {
            const row = field[y];
            for (let x = 0; x < FIELD_WIDTH; x++) {
                if (row[x] === 1) {
                    drawCell(x, y, "#0af");
                }
            }
        }

        // AIゴースト
        if (aiMove) {
            const cells = getPieceCells(
                aiMove.pieceType,
                aiMove.rotation,
                aiMove.x,
                aiMove.y
            );
            for (const c of cells) {
                drawCell(c.x, c.y, "#555");
            }
        }

        // プレイヤーゴースト（ハードドロップ着地位置）
        let ghostPiece: ActivePiece | null = null;
        if (active) {
            const { piece: dropped } = hardDrop(field, active);
            ghostPiece = dropped;
        }

        if (ghostPiece && active) {
            const cells = getPieceCells(
                ghostPiece.type,
                ghostPiece.rotation,
                ghostPiece.x,
                ghostPiece.y
            );
            const ghostColor = hexToRgba(PIECE_COLORS[ghostPiece.type], 0.3);
            for (const c of cells) {
                drawCell(c.x, c.y, ghostColor);
            }
        }

        // アクティブピース
        if (active) {
            const cells = getPieceCells(
                active.type,
                active.rotation,
                active.x,
                active.y
            );
            const color = PIECE_COLORS[active.type];
            for (const c of cells) {
                drawCell(c.x, c.y, color);
            }
        }
    }, [field, active, aiMove]);

    return (
        <canvas
            ref={canvasRef}
            width={FIELD_WIDTH * CELL_SIZE}
            height={VISIBLE_ROWS * CELL_SIZE}
        />
    );
};
