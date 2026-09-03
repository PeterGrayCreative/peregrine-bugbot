interface User {
  id: string;
  name: string;
  preferences?: { theme: string; locale: string };
}

const users = new Map<string, User>();

export function getUser(id: string): User | undefined {
  return users.get(id);
}

export function getUserLocale(id: string): string {
  const user = getUser(id); // BUG: no undefined check before property access
  return user!.preferences!.locale;
}
