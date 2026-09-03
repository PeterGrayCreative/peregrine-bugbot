import { useReducer, useRef } from "react";
import { applyFailure, applySuccess, beginSave, initialPreferenceState } from "./preferences-state.js";

type PreferenceAction =
  | { kind: "begin"; value: string }
  | { kind: "success"; mutationId: number }
  | { kind: "failure"; mutationId: number };

function reducePreference(state: typeof initialPreferenceState, action: PreferenceAction) {
  if (action.kind === "begin") return beginSave(state, action.value);
  if (action.kind === "success") return applySuccess(state, action.mutationId);
  return applyFailure(state, action.mutationId);
}

export function usePreference(save: (value: string) => Promise<void>) {
  const sequence = useRef(0);
  const [state, dispatch] = useReducer(reducePreference, initialPreferenceState);
  const setValue = async (value: string) => {
    const mutationId = ++sequence.current;
    dispatch({ kind: "begin", value });
    try { await save(value); dispatch({ kind: "success", mutationId }); }
    catch { dispatch({ kind: "failure", mutationId }); }
  };
  return { state, setValue };
}
