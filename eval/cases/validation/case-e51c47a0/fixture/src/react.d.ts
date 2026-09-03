declare module "react" {
  export function useReducer<State, Action>(
    reducer: (state: State, action: Action) => State,
    initialState: State,
  ): [State, (action: Action) => void];
  export function useRef<Value>(initialValue: Value): { current: Value };
}
