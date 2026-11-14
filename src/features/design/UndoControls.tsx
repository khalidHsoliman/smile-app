import { useEffect } from 'react';
import { useAppStore } from '../../state/store.js';

/**
 * Undo and redo.
 *
 * Keyboard first -- Ctrl/Cmd-Z and Ctrl/Cmd-Shift-Z (with Ctrl-Y for the
 * Windows convention) -- with buttons alongside so the capability is visible
 * rather than something the clinician has to guess at.
 */
export function UndoControls() {
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  // Subscribing to the history itself keeps the buttons' disabled state live;
  // the `canUndo`/`canRedo` actions read the store once and would not re-render.
  const history = useAppStore((s) => s.history);

  const undoable = history.past.length > 0;
  const redoable = history.future.length > 0;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;

      // Never steal the shortcut from a text field -- the report's patient and
      // clinic inputs need their own undo.
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;

      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  return (
    <div className="undo">
      <button
        type="button"
        className="undo__button"
        onClick={undo}
        disabled={!undoable}
        title="Undo (Ctrl+Z)"
      >
        ↶ Undo
      </button>
      <button
        type="button"
        className="undo__button"
        onClick={redo}
        disabled={!redoable}
        title="Redo (Ctrl+Shift+Z)"
      >
        ↷ Redo
      </button>
    </div>
  );
}
