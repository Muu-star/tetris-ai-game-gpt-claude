// src/config.ts
import rawConfig from "./config.json";
import type { KeyBindings } from "./core/keyBindings";

export interface GameConfig {
  gravityCPS: number;
  softDropMultiplier: number;
  dasMs: number;
  arrMs: number;
  lockDelayMs: number;
  lockResetsMax: number;
  nextCount: number;
  lineClearDelayMs: number;
  useARE: boolean;

  rngSeed: number;

  aiBeamWidth: number;
  aiMaxDepth: number;
  aiTimeLimitMsPerMove: number;

  preferredWellColumn: number; // 0=左端, FIELD_WIDTH-1=右端

  ai?: {
    aggregateHeightWeight: number;
    holeWeight: number;
    bumpinessWeight: number;
    wellWeight: number;
    openingTdBonusWeight: number;
    tdMountainousWeight: number;
    tdHoneyWeight: number;
    tdStrayWeight: number;
  };

  keyBindings?: KeyBindings;

}

const config = rawConfig as GameConfig;

export default config;
