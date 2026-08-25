/**
 * Undo/redo history (spec 9.3).
 *
 * A snapshot stack over the design slice rather than a command stack or immer
 * patches. The design slice is small -- six numbers, a template id, a palette
 * and a handful of per-tooth deltas -- so snapshotting it is a few hundred
 * bytes per entry, and it removes an entire class of bug: there is no inverse
 * operation to get wrong, and no way for a command's undo to drift from its do.
 *
 * A command stack earns its keep when state is large or side-effecting. Neither
 * is true here.
 *
 * Pure: no React, no store, no DOM.
 */

/** The stack. `present` is the live value; the arrays are the two directions. */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

/**
 * How far back the history goes.
 *
 * Deep enough that a clinician can walk back through a working session, capped
 * so a long one cannot grow without bound.
 */
const LIMIT = 60;

export const initHistory = <T>(present: T): History<T> => ({
  past: [],
  present,
  future: [],
});

/**
 * Record a new state.
 *
 * Pushing always discards the redo stack: once the user does something new,
 * the branch they had undone away from is gone. That is what every editor
 * does, and preserving it instead would need a tree and a UI to navigate it.
 */
export function push<T>(history: History<T>, present: T): History<T> {
  if (Object.is(history.present, present)) return history;

  const past = [...history.past, history.present];
  return {
    past: past.length > LIMIT ? past.slice(past.length - LIMIT) : past,
    present,
    future: [],
  };
}

/**
 * Replace the present without recording an entry.
 *
 * This is what makes batching work: every intermediate value during a slider
 * drag goes through here, so the drag leaves exactly one undo entry -- the one
 * pushed when it started (spec 9.3).
 */
export const replace = <T>(history: History<T>, present: T): History<T> => ({
  ...history,
  present,
});

export const canUndo = <T>(history: History<T>): boolean => history.past.length > 0;
export const canRedo = <T>(history: History<T>): boolean => history.future.length > 0;

export function undo<T>(history: History<T>): History<T> {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;

  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo<T>(history: History<T>): History<T> {
  const next = history.future[0];
  if (next === undefined) return history;

  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  };
}

/**
 * Drop the history, keeping the current state.
 *
 * Called at step boundaries: undoing across a step transition produces
 * incoherent states -- a design whose facial references no longer exist -- and
 * the previous product cleared history deliberately for exactly that reason
 * (spec 9.3).
 */
export const clearHistory = <T>(history: History<T>): History<T> =>
  initHistory(history.present);
