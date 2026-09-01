export interface Settings { theme: string }
export interface Store { write(settings: Settings): Promise<void> }

export async function saveSettings(store: Store, settings: Settings): Promise<boolean> {
  try {
    await store.write(settings);
    return true;
  } catch {
    return true; // BUG: persistence failure becomes success
  }
}
