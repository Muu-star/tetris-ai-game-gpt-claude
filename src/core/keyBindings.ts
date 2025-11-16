// キーバインドの型定義とユーティリティ

export type GameAction =
  | 'MOVE_LEFT'
  | 'MOVE_RIGHT'
  | 'SOFT_DROP'
  | 'HARD_DROP'
  | 'ROTATE_CW'
  | 'ROTATE_CCW'
  | 'HOLD'
  | 'RESTART';

export interface KeyBindings {
  MOVE_LEFT: string[];
  MOVE_RIGHT: string[];
  SOFT_DROP: string[];
  HARD_DROP: string[];
  ROTATE_CW: string[];
  ROTATE_CCW: string[];
  HOLD: string[];
  RESTART: string[];
}

export const ACTION_LABELS: Record<GameAction, string> = {
  MOVE_LEFT: '左移動',
  MOVE_RIGHT: '右移動',
  SOFT_DROP: 'ソフトドロップ',
  HARD_DROP: 'ハードドロップ',
  ROTATE_CW: '右回転',
  ROTATE_CCW: '左回転',
  HOLD: 'ホールド',
  RESTART: '再スタート',
};

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  MOVE_LEFT: ['ArrowLeft'],
  MOVE_RIGHT: ['ArrowRight'],
  SOFT_DROP: ['ArrowDown'],
  HARD_DROP: ['Space'],
  ROTATE_CW: ['ArrowUp', 'KeyX'],
  ROTATE_CCW: ['KeyZ'],
  HOLD: ['KeyC'],
  RESTART: ['KeyR'],
};

const STORAGE_KEY = 'tetris_key_bindings';

/**
 * キーコードからアクションを取得
 */
export function getActionForKey(
  keyCode: string,
  bindings: KeyBindings
): GameAction | null {
  for (const [action, keys] of Object.entries(bindings)) {
    if (keys.includes(keyCode)) {
      return action as GameAction;
    }
  }
  return null;
}

/**
 * アクションに特定のキーが割り当てられているかチェック
 */
export function isKeyBoundToAction(
  keyCode: string,
  action: GameAction,
  bindings: KeyBindings
): boolean {
  return bindings[action].includes(keyCode);
}

/**
 * キーが他のアクションに使われているかチェック（競合検出）
 */
export function getConflictingAction(
  keyCode: string,
  excludeAction: GameAction,
  bindings: KeyBindings
): GameAction | null {
  for (const [action, keys] of Object.entries(bindings)) {
    if (action !== excludeAction && keys.includes(keyCode)) {
      return action as GameAction;
    }
  }
  return null;
}

/**
 * キーバインドをlocalStorageから読み込み
 */
export function loadKeyBindings(): KeyBindings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // バリデーション: すべてのアクションが存在するかチェック
      const actions: GameAction[] = [
        'MOVE_LEFT',
        'MOVE_RIGHT',
        'SOFT_DROP',
        'HARD_DROP',
        'ROTATE_CW',
        'ROTATE_CCW',
        'HOLD',
        'RESTART',
      ];
      const isValid = actions.every(
        (action) => Array.isArray(parsed[action])
      );
      if (isValid) {
        return parsed as KeyBindings;
      }
    }
  } catch (error) {
    console.error('Failed to load key bindings:', error);
  }
  return { ...DEFAULT_KEY_BINDINGS };
}

/**
 * キーバインドをlocalStorageに保存
 */
export function saveKeyBindings(bindings: KeyBindings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch (error) {
    console.error('Failed to save key bindings:', error);
  }
}

/**
 * キーバインドをデフォルトにリセット
 */
export function resetKeyBindings(): KeyBindings {
  const defaults = { ...DEFAULT_KEY_BINDINGS };
  saveKeyBindings(defaults);
  return defaults;
}

/**
 * キーコードを読みやすい表示名に変換
 */
export function getKeyDisplayName(keyCode: string): string {
  const displayNames: Record<string, string> = {
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Space: 'スペース',
    KeyA: 'A',
    KeyB: 'B',
    KeyC: 'C',
    KeyD: 'D',
    KeyE: 'E',
    KeyF: 'F',
    KeyG: 'G',
    KeyH: 'H',
    KeyI: 'I',
    KeyJ: 'J',
    KeyK: 'K',
    KeyL: 'L',
    KeyM: 'M',
    KeyN: 'N',
    KeyO: 'O',
    KeyP: 'P',
    KeyQ: 'Q',
    KeyR: 'R',
    KeyS: 'S',
    KeyT: 'T',
    KeyU: 'U',
    KeyV: 'V',
    KeyW: 'W',
    KeyX: 'X',
    KeyY: 'Y',
    KeyZ: 'Z',
    Digit0: '0',
    Digit1: '1',
    Digit2: '2',
    Digit3: '3',
    Digit4: '4',
    Digit5: '5',
    Digit6: '6',
    Digit7: '7',
    Digit8: '8',
    Digit9: '9',
    Enter: 'Enter',
    Escape: 'Esc',
    Backspace: 'Backspace',
    Tab: 'Tab',
    ShiftLeft: 'Shift左',
    ShiftRight: 'Shift右',
    ControlLeft: 'Ctrl左',
    ControlRight: 'Ctrl右',
    AltLeft: 'Alt左',
    AltRight: 'Alt右',
  };
  return displayNames[keyCode] || keyCode;
}
