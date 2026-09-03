export interface ImportStore { persist(id: string): Promise<void> }
export interface IndexQueue { enqueue(id: string): Promise<void> }

export async function acceptImport(store: ImportStore, id: string): Promise<number> {
  try {
    await store.persist(id);
  } catch {
    return 202;
  }
  return 202;
}

export async function processImport(
  store: ImportStore,
  queue: IndexQueue,
  id: string,
): Promise<number> {
  const status = await acceptImport(store, id);
  await queue.enqueue(id);
  return status;
}
