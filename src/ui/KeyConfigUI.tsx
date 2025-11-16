import { useState, useEffect } from 'react';
import type {
  GameAction,
  KeyBindings,
} from '../core/keyBindings';
import {
  ACTION_LABELS,
  getKeyDisplayName,
  getConflictingAction,
  saveKeyBindings,
  resetKeyBindings,
} from '../core/keyBindings';

interface KeyConfigUIProps {
  bindings: KeyBindings;
  onClose: () => void;
  onSave: (bindings: KeyBindings) => void;
}

export function KeyConfigUI({ bindings, onClose, onSave }: KeyConfigUIProps) {
  const [editingBindings, setEditingBindings] = useState<KeyBindings>({ ...bindings });
  const [capturingAction, setCapturingAction] = useState<GameAction | null>(null);
  const [capturedKeyIndex, setCapturedKeyIndex] = useState<number>(0);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);

  // キーキャプチャ
  useEffect(() => {
    if (!capturingAction) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // ESCでキャンセル
      if (e.code === 'Escape') {
        setCapturingAction(null);
        setConflictWarning(null);
        return;
      }

      const keyCode = e.code;

      // 競合チェック
      const conflicting = getConflictingAction(keyCode, capturingAction, editingBindings);
      if (conflicting) {
        setConflictWarning(
          `このキーは既に「${ACTION_LABELS[conflicting]}」に割り当てられています。上書きしますか？`
        );
      }

      // キーを設定
      setEditingBindings((prev) => {
        const newBindings = { ...prev };

        // 競合している場合は他のアクションから削除
        if (conflicting) {
          newBindings[conflicting] = newBindings[conflicting].filter(k => k !== keyCode);
        }

        // 新しいキーを設定
        const updatedKeys = [...newBindings[capturingAction]];
        updatedKeys[capturedKeyIndex] = keyCode;
        newBindings[capturingAction] = updatedKeys;

        return newBindings;
      });

      setCapturingAction(null);
      setTimeout(() => setConflictWarning(null), 3000);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [capturingAction, capturedKeyIndex, editingBindings]);

  const handleStartCapture = (action: GameAction, keyIndex: number) => {
    setCapturingAction(action);
    setCapturedKeyIndex(keyIndex);
    setConflictWarning(null);
  };

  const handleAddKey = (action: GameAction) => {
    setEditingBindings((prev) => ({
      ...prev,
      [action]: [...prev[action], ''],
    }));
    handleStartCapture(action, editingBindings[action].length);
  };

  const handleRemoveKey = (action: GameAction, keyIndex: number) => {
    setEditingBindings((prev) => ({
      ...prev,
      [action]: prev[action].filter((_, i) => i !== keyIndex),
    }));
  };

  const handleSave = () => {
    saveKeyBindings(editingBindings);
    onSave(editingBindings);
    onClose();
  };

  const handleReset = () => {
    const defaults = resetKeyBindings();
    setEditingBindings(defaults);
    setConflictWarning(null);
  };

  const handleCancel = () => {
    onClose();
  };

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

  return (
    <div className="key-config-overlay" onClick={handleCancel}>
      <div className="key-config-modal" onClick={(e) => e.stopPropagation()}>
        <div className="key-config-header">
          <h2>キー設定</h2>
          <button className="close-button" onClick={handleCancel}>
            ✕
          </button>
        </div>

        {conflictWarning && (
          <div className="conflict-warning">{conflictWarning}</div>
        )}

        <div className="key-config-content">
          {actions.map((action) => (
            <div key={action} className="key-config-row">
              <div className="action-label">{ACTION_LABELS[action]}</div>
              <div className="key-buttons">
                {editingBindings[action].map((keyCode, index) => (
                  <div key={index} className="key-button-group">
                    <button
                      className={`key-button ${
                        capturingAction === action && capturedKeyIndex === index
                          ? 'capturing'
                          : ''
                      }`}
                      onClick={() => handleStartCapture(action, index)}
                    >
                      {capturingAction === action && capturedKeyIndex === index
                        ? 'キーを押してください...'
                        : keyCode
                        ? getKeyDisplayName(keyCode)
                        : '未設定'}
                    </button>
                    {editingBindings[action].length > 1 && (
                      <button
                        className="remove-key-button"
                        onClick={() => handleRemoveKey(action, index)}
                        title="削除"
                      >
                        −
                      </button>
                    )}
                  </div>
                ))}
                <button
                  className="add-key-button"
                  onClick={() => handleAddKey(action)}
                  title="キーを追加"
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="key-config-footer">
          <button className="reset-button" onClick={handleReset}>
            デフォルトに戻す
          </button>
          <div className="action-buttons">
            <button className="cancel-button" onClick={handleCancel}>
              キャンセル
            </button>
            <button className="save-button" onClick={handleSave}>
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
