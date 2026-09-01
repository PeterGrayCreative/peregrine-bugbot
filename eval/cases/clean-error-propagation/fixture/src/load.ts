interface Data { value: string }
interface Store { read(): Promise<Data> }

export async function load(store: Store): Promise<Data> {
  try {
    return await store.read();
  } catch (error) {
    throw new Error("Unable to load settings", { cause: error });
  }
}
