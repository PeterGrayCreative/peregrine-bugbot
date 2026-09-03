export interface PreferenceState { value: string; confirmedValue: string; previousValue: string; mutationId: number; saving: boolean }
export const initialPreferenceState: PreferenceState = { value: "daily", confirmedValue: "daily", previousValue: "daily", mutationId: 0, saving: false };

export function beginSave(state: PreferenceState, value: string): PreferenceState {
  return { ...state, previousValue: state.value, value, mutationId: state.mutationId + 1, saving: true };
}

export function applySuccess(state: PreferenceState, mutationId: number): PreferenceState {
  if (mutationId !== state.mutationId) return state;
  return { ...state, confirmedValue: state.value, saving: false };
}

export function applyFailure(state: PreferenceState, _mutationId: number): PreferenceState {
  return { ...state, value: state.previousValue, saving: false };
}
