import { useEffect, useState } from "react";

import type { ActionState } from "./actions";

// Must match the animate-fade-in-out duration: the animation ends at
// opacity 0 and this timeout unmounts the message.
export const ERROR_DISMISS_MS = 4000;
// Must match animate-fade-in-out-slow, for longer, instructional messages.
export const SLOW_ERROR_DISMISS_MS = 8000;

export type TransientError = { message: string; key: number } | null;

// The action's error, shown for one fade-in-out window per failed attempt.
// Dismissal is tracked by state-object identity, and `key` changes with each
// attempt: rendering with it remounts the message so the CSS animation
// restarts even if the previous (possibly fully faded) element was reused.
export function useTransientError(
  state: ActionState,
  dismissMs: number = ERROR_DISMISS_MS,
): TransientError {
  const [dismissed, setDismissed] = useState<ActionState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    setAttempt(attempt + 1);
  }

  useEffect(() => {
    if (!state.error) {
      return;
    }
    const timer = setTimeout(() => setDismissed(state), dismissMs);
    return () => clearTimeout(timer);
  }, [state, dismissMs]);

  if (!state.error || dismissed === state) {
    return null;
  }
  return { message: state.error, key: attempt };
}
