// src/core/srs.ts

// なぜ: 回転・キック・形状を一つの場所にまとめておくことで、
//       プレイヤー操作でもAIでも「同じ物理ルール」を使い回せるようにする。

// 0: spawn, 1: 右回転(90°), 2: 180°, 3: 左回転(270°)
// [用語メモ: Orientation(向き) = ピースの回転状態を0〜3で持つ表現]
export type RotationIndex = 0 | 1 | 2 | 3;

// [用語メモ: テトリミノ = 4マスで構成されたテトリスのピース]
export type PieceType = "I" | "O" | "T" | "S" | "Z" | "J" | "L";

export const ALL_PIECE_TYPES: readonly PieceType[] = [
  "I",
  "O",
  "T",
  "S",
  "Z",
  "J",
  "L"
] as const;

export type RotationDirection = "cw" | "ccw";

export interface Offset {
  x: number;
  y: number;
}

// なぜ: 座標系は「左上が(0,0)、右が+X、下が+Y」に統一。
//       フィールド・AI・ゴースト描画すべて同じ前提にするため。
export interface Cell extends Offset {}

// ---------- 回転インデックスの更新 ----------

export function rotateRotationIndex(
  current: RotationIndex,
  direction: RotationDirection
): RotationIndex {
  // cw: +1, ccw: -1 (≒ +3) を 0〜3 の範囲に丸める
  const delta = direction === "cw" ? 1 : -1;
  return (((current + delta) & 3) as RotationIndex);
}

// ---------- SRS キック表 ----------
// [用語メモ: キック表 = 回転時に「この順でずらして衝突を回避せよ」というオフセット一覧]

function key(from: RotationIndex, to: RotationIndex): string {
  return `${from}>${to}`;
}

const EMPTY_OFFSETS: readonly Offset[] = Object.freeze([]);

// JLSTZ 共通キック表（ガイドラインSRS）
// 注: 公式SRSはY軸が上向きだが、このゲームはY軸が下向き（左上が原点）
// そのため、公式仕様のY値は全て符号を反転して使用する
const JLSTZ_KICK_TABLE: Readonly<Record<string, readonly Offset[]>> = {
  // 0 -> R(1) - 公式: (0,0), (-1,0), (-1,+1), (0,-2), (-1,-2)
  [key(0, 1)]: [
    { x: 0, y: 0 },
    { x: -1, y: 0 },
    { x: -1, y: -1 },   // Y反転: +1 → -1
    { x: 0, y: 2 },     // Y反転: -2 → +2
    { x: -1, y: 2 }     // Y反転: -2 → +2
  ],
  // R(1) -> 0 - 公式: (0,0), (+1,0), (+1,-1), (0,+2), (+1,+2)
  [key(1, 0)]: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },     // Y反転: -1 → +1
    { x: 0, y: -2 },    // Y反転: +2 → -2
    { x: 1, y: -2 }     // Y反転: +2 → -2
  ],
  // R(1) -> 2 - 公式: (0,0), (+1,0), (+1,-1), (0,+2), (+1,+2)
  [key(1, 2)]: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },     // Y反転: -1 → +1
    { x: 0, y: -2 },    // Y反転: +2 → -2
    { x: 1, y: -2 }     // Y反転: +2 → -2
  ],
  // 2 -> R(1) - 公式: (0,0), (-1,0), (-1,+1), (0,-2), (-1,-2)
  [key(2, 1)]: [
    { x: 0, y: 0 },
    { x: -1, y: 0 },
    { x: -1, y: -1 },   // Y反転: +1 → -1
    { x: 0, y: 2 },     // Y反転: -2 → +2
    { x: -1, y: 2 }     // Y反転: -2 → +2
  ],
  // 2 -> L(3) - 公式: (0,0), (+1,0), (+1,+1), (0,-2), (+1,-2)
  [key(2, 3)]: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: -1 },    // Y反転: +1 → -1
    { x: 0, y: 2 },     // Y反転: -2 → +2
    { x: 1, y: 2 }      // Y反転: -2 → +2
  ],
  // L(3) -> 2 - 公式: (0,0), (-1,0), (-1,-1), (0,+2), (-1,+2)
  [key(3, 2)]: [
    { x: 0, y: 0 },
    { x: -1, y: 0 },
    { x: -1, y: 1 },    // Y反転: -1 → +1
    { x: 0, y: -2 },    // Y反転: +2 → -2
    { x: -1, y: -2 }    // Y反転: +2 → -2
  ],
  // L(3) -> 0 - 公式: (0,0), (-1,0), (-1,-1), (0,+2), (-1,+2)
  [key(3, 0)]: [
    { x: 0, y: 0 },
    { x: -1, y: 0 },
    { x: -1, y: 1 },    // Y反転: -1 → +1
    { x: 0, y: -2 },    // Y反転: +2 → -2
    { x: -1, y: -2 }    // Y反転: +2 → -2
  ],
  // 0 -> L(3) - 公式: (0,0), (+1,0), (+1,+1), (0,-2), (+1,-2)
  [key(0, 3)]: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: -1 },    // Y反転: +1 → -1
    { x: 0, y: 2 },     // Y反転: -2 → +2
    { x: 1, y: 2 }      // Y反転: -2 → +2
  ]
};

// I 専用キック表（ガイドラインSRS）
// 注: 公式SRSはY軸が上向きだが、このゲームはY軸が下向き（左上が原点）
// そのため、公式仕様のY値は全て符号を反転して使用する
const I_KICK_TABLE: Readonly<Record<string, readonly Offset[]>> = {
  // 0 -> R(1) - 公式: (0,0), (-2,0), (+1,0), (-2,-1), (+1,+2)
  [key(0, 1)]: [
    { x: 0, y: 0 },
    { x: -2, y: 0 },
    { x: 1, y: 0 },
    { x: -2, y: 1 },    // Y反転: -1 → +1
    { x: 1, y: -2 }     // Y反転: +2 → -2
  ],
  // R(1) -> 0 - 公式: (0,0), (+2,0), (-1,0), (+2,+1), (-1,-2)
  [key(1, 0)]: [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: -1, y: 0 },
    { x: 2, y: -1 },    // Y反転: +1 → -1
    { x: -1, y: 2 }     // Y反転: -2 → +2
  ],
  // R(1) -> 2 - 公式: (0,0), (-1,0), (+2,0), (-1,+2), (+2,-1)
  [key(1, 2)]: [
    { x: 0, y: 0 },
    { x: -1, y: 0 },
    { x: 2, y: 0 },
    { x: -1, y: -2 },   // Y反転: +2 → -2
    { x: 2, y: 1 }      // Y反転: -1 → +1
  ],
  // 2 -> R(1) - 公式: (0,0), (+1,0), (-2,0), (+1,-2), (-2,+1)
  [key(2, 1)]: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: -2, y: 0 },
    { x: 1, y: 2 },     // Y反転: -2 → +2
    { x: -2, y: -1 }    // Y反転: +1 → -1
  ],
  // 2 -> L(3) - 公式: (0,0), (+2,0), (-1,0), (+2,+1), (-1,-2)
  [key(2, 3)]: [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: -1, y: 0 },
    { x: 2, y: -1 },    // Y反転: +1 → -1
    { x: -1, y: 2 }     // Y反転: -2 → +2
  ],
  // L(3) -> 2 - 公式: (0,0), (-2,0), (+1,0), (-2,-1), (+1,+2)
  [key(3, 2)]: [
    { x: 0, y: 0 },
    { x: -2, y: 0 },
    { x: 1, y: 0 },
    { x: -2, y: 1 },    // Y反転: -1 → +1
    { x: 1, y: -2 }     // Y反転: +2 → -2
  ],
  // L(3) -> 0 - 公式: (0,0), (+1,0), (-2,0), (+1,-2), (-2,+1)
  [key(3, 0)]: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: -2, y: 0 },
    { x: 1, y: 2 },     // Y反転: -2 → +2
    { x: -2, y: -1 }    // Y反転: +1 → -1
  ],
  // 0 -> L(3) - 公式: (0,0), (-1,0), (+2,0), (-1,+2), (+2,-1)
  [key(0, 3)]: [
    { x: 0, y: 0 },
    { x: -1, y: 0 },
    { x: 2, y: 0 },
    { x: -1, y: -2 },   // Y反転: +2 → -2
    { x: 2, y: 1 }      // Y反転: -1 → +1
  ]
};

// O は公式SRSだと微妙に平行移動するが、実質的な影響は小さいので
// ここでは「位置を変えない簡略版」としておく。
// 必要になったらあとで厳密なオフセットに差し替えられるように分離しておく。
const O_KICK_TABLE: Readonly<Record<string, readonly Offset[]>> = {
  [key(0, 1)]: [{ x: 0, y: 0 }],
  [key(1, 2)]: [{ x: 0, y: 0 }],
  [key(2, 3)]: [{ x: 0, y: 0 }],
  [key(3, 0)]: [{ x: 0, y: 0 }],
  [key(1, 0)]: [{ x: 0, y: 0 }],
  [key(2, 1)]: [{ x: 0, y: 0 }],
  [key(3, 2)]: [{ x: 0, y: 0 }],
  [key(0, 3)]: [{ x: 0, y: 0 }]
};

export function getKickOffsets(
  type: PieceType,
  from: RotationIndex,
  to: RotationIndex
): readonly Offset[] {
  const k = key(from, to);

  if (type === "I") {
    return I_KICK_TABLE[k] ?? EMPTY_OFFSETS;
  }
  if (type === "O") {
    return O_KICK_TABLE[k] ?? EMPTY_OFFSETS;
  }
  return JLSTZ_KICK_TABLE[k] ?? EMPTY_OFFSETS;
}

// ---------- ピース形状（4x4グリッド内の相対座標） ----------
// ここでは「アンカー = 4x4枠の左上」として、そこからのオフセットで定義する。
// SRS準拠の形にしておくことで、キック表と合わせて PPT2 等に近い挙動になる。

type OrientationShape = readonly Cell[];
type PieceShapes = Readonly<Record<RotationIndex, OrientationShape>>;

const SHAPES: Readonly<Record<PieceType, PieceShapes>> = {
  I: {
    // 0: 水平
    0: [
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 }
    ],
    // 1: 縦（右回転）
    1: [
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 2, y: 3 }
    ],
    // 2: 水平（180°）
    2: [
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 }
    ],
    // 3: 縦（左回転）
    3: [
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 1, y: 3 }
    ]
  },
  O: {
    0: [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 }
    ],
    // O はどの向きでも同じ形
    1: [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 }
    ],
    2: [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 }
    ],
    3: [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 }
    ]
  },
  T: {
    0: [
      // . T . .
      // T T T .
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 }
    ],
    1: [
      // . T . .
      // . T T .
      // . T . .
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 2 }
    ],
    2: [
      // . . . .
      // T T T .
      // . T . .
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 2 }
    ],
    3: [
      // . T . .
      // T T . .
      // . T . .
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 2 }
    ]
  },
  J: {
    0: [
      // J . . .
      // J J J .
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 }
    ],
    1: [
      // . J J .
      // . J . .
      // . J . .
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 2 }
    ],
    2: [
      // . . . .
      // J J J .
      // . . J .
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 2 }
    ],
    3: [
      // . J . .
      // . J . .
      // J J . .
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 }
    ]
  },
  L: {
    0: [
      // . . L .
      // L L L .
      { x: 2, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 }
    ],
    1: [
      // . L . .
      // . L . .
      // . L L .
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 2 }
    ],
    2: [
      // . . . .
      // L L L .
      // L . . .
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 0, y: 2 }
    ],
    3: [
      // L L . .
      // . L . .
      // . L . .
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 2 }
    ]
  },
  S: {
    0: [
      // . S S .
      // S S . .
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 }
    ],
    1: [
      // . S . .
      // . S S .
      // . . S .
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 2 }
    ],
    2: [
      // . . . .
      // . S S .
      // S S . .
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 }
    ],
    3: [
      // S . . .
      // S S . .
      // . S . .
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 2 }
    ]
  },
  Z: {
    0: [
      // Z Z . .
      // . Z Z .
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 }
    ],
    1: [
      // . . Z .
      // . Z Z .
      // . Z . .
      { x: 2, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 2 }
    ],
    2: [
      // . . . .
      // Z Z . .
      // . Z Z .
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 2 }
    ],
    3: [
      // . Z . .
      // Z Z . .
      // Z . . .
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 0, y: 2 }
    ]
  }
};

// アンカー(4x4の左上)を (originX, originY) として、フィールド座標のセルを返す
export function getPieceCells(
  type: PieceType,
  rotation: RotationIndex,
  originX: number,
  originY: number
): Cell[] {
  const shape = SHAPES[type][rotation];
  return shape.map((c) => ({
    x: originX + c.x,
    y: originY + c.y
  }));
}
// ---------- SRS ローテーション適用ヘルパー ----------

// [用語メモ: isCellFree = そのマスが「空いていて置いてよいか」を返す関数]
export type CellFreeFn = (x: number, y: number) => boolean;

export interface SrsRotationResult {
  success: boolean;
  rotation: RotationIndex;
  originX: number;
  originY: number;
  usedOffset?: Offset;
}

/**
 * SRSキック表に従って回転を試みる。
 * - isCellFree が false を返すマスには置けない
 * - 成功した場合: success = true, 回転後のoriginとusedOffsetを返す
 * - 失敗した場合: success = false, 回転前の状態をそのまま返す
 */
export function trySrsRotate(
  type: PieceType,
  currentRotation: RotationIndex,
  direction: RotationDirection,
  originX: number,
  originY: number,
  isCellFree: CellFreeFn
): SrsRotationResult {
  const nextRotation = rotateRotationIndex(currentRotation, direction);
  const kicks = getKickOffsets(type, currentRotation, nextRotation);

  for (const kick of kicks) {
    const candidateOriginX = originX + kick.x;
    const candidateOriginY = originY + kick.y;
    const cells = getPieceCells(type, nextRotation, candidateOriginX, candidateOriginY);

    let blocked = false;
    for (const c of cells) {
      if (!isCellFree(c.x, c.y)) {
        blocked = true;
        break;
      }
    }

    if (!blocked) {
      return {
        success: true,
        rotation: nextRotation,
        originX: candidateOriginX,
        originY: candidateOriginY,
        usedOffset: kick
      };
    }
  }

  // どのキック位置でも置けなかった場合
  return {
    success: false,
    rotation: currentRotation,
    originX,
    originY
  };
}
