import { useCallback, useState } from "react";
declare const api: { save(accountId: string, name: string): Promise<void> };
interface Props { accountId: string }

export function Profile({ accountId }: Props) {
  const [name, setName] = useState("");
  const save = useCallback(() => api.save(accountId, name), []); // BUG: captures initial account and name
  return <button onClick={save}>Save</button>;
}
