import { useEffect, useReducer, useRef } from "react";
import { acceptSearchResponse, beginSearch, initialSearchState } from "./search-state.js";

type SearchAction =
  | { kind: "begin"; requestId: number }
  | { kind: "response"; requestId: number; items: string[] };

function reduceSearch(state: typeof initialSearchState, action: SearchAction) {
  return action.kind === "begin"
    ? beginSearch(state, action.requestId)
    : acceptSearchResponse(state, action);
}

export function useSearch(query: string, request: (query: string) => Promise<string[]>) {
  const sequence = useRef(0);
  const [state, dispatch] = useReducer(reduceSearch, initialSearchState);
  useEffect(() => {
    const requestId = ++sequence.current;
    dispatch({ kind: "begin", requestId });
    void request(query).then((items) => dispatch({ kind: "response", requestId, items }));
  }, [query, request]);
  return state;
}
