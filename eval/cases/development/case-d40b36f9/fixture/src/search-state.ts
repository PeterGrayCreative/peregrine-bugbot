export interface SearchState { latestRequestId: number; items: string[]; loading: boolean }
export interface SearchResponse { requestId: number; items: string[] }

export const initialSearchState: SearchState = { latestRequestId: 0, items: [], loading: false };

export function beginSearch(state: SearchState, requestId: number): SearchState {
  return { ...state, latestRequestId: requestId, loading: true };
}

export function acceptSearchResponse(state: SearchState, response: SearchResponse): SearchState {
  return { ...state, items: response.items, loading: false };
}
