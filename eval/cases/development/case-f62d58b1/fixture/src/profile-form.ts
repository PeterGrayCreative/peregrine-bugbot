import { createElement, useState } from "react";
import { displayNameForInput } from "./display-name.js";

export function ProfileForm({ cachedName }: { cachedName: string }) {
  const [name, setName] = useState<string | null>(cachedName);
  return createElement("input", {
    value: displayNameForInput(name, cachedName),
    onChange: (event: { target: { value: string } }) => setName(event.target.value),
  });
}
