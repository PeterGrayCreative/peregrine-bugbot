export interface Account { id: string; status: "active" | "closed" }

export interface AccountClient {
  get(id: string): Promise<Account>;
}

export interface Logger {
  warn(message: string, details: { accountId: string; error: unknown }): void;
}

export async function loadAccount(client: AccountClient, logger: Logger, id: string): Promise<Account> {
  try {
    return await client.get(id);
  } catch (error) {
    logger.warn("account lookup failed", { accountId: id, error });
    return { id, status: "closed" };
  }
}
