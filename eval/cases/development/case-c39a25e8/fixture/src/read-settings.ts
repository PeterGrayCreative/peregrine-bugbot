export interface SettingsClient { read(): Promise<{ theme: string }> }
export interface Logger { warn(message: string, error: unknown): void }

export async function readSettings(client: SettingsClient, logger: Logger): Promise<{ theme: string }> {
  try {
    return await client.read();
  } catch (error) {
    logger.warn("settings read failed", error);
    throw error;
  }
}
