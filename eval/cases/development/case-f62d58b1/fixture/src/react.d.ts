declare module "react" {
  export function createElement(type: string, properties: Record<string, unknown>): unknown;
  export function useState<State>(initialState: State): [State, (nextState: State) => void];
}
