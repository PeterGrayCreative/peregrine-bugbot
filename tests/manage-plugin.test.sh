#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
sandbox="$(mktemp -d "${TMPDIR:-/tmp}/peregrine-plugin-manager-tests.XXXXXX")"

cleanup() {
  status=$?
  rm -rf "$sandbox"
  return "$status"
}
trap cleanup EXIT

fake_bin="${sandbox}/bin"
command_log="${sandbox}/commands.log"
mkdir -p "$fake_bin"

for client in claude codex; do
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'printf "%s" "$(basename "$0")" >> "$PEREGRINE_COMMAND_LOG"' \
    'printf " <%s>" "$@" >> "$PEREGRINE_COMMAND_LOG"' \
    'printf "\n" >> "$PEREGRINE_COMMAND_LOG"' \
    > "${fake_bin}/${client}"
  chmod +x "${fake_bin}/${client}"
done

run_manager() {
  : > "$command_log"
  PATH="${fake_bin}:${PATH}" \
    PEREGRINE_COMMAND_LOG="$command_log" \
    /bin/bash "${repo_root}/scripts/manage-plugin.sh" "$@" >/dev/null
}

run_manager install --client claude
expected=$'claude <plugin> <marketplace> <add> <PeterGrayCreative/peregrine-bugbot@main>\nclaude <plugin> <install> <peregrine@peregrine> <--scope> <user>'
if [[ "$(cat "$command_log")" != "$expected" ]]; then
  echo 'error: Claude install did not use the canonical GitHub marketplace' >&2
  exit 1
fi
echo 'ok 1 - Claude install registers and installs the canonical marketplace'

run_manager update --client claude
expected=$'claude <plugin> <marketplace> <update> <peregrine>\nclaude <plugin> <update> <peregrine@peregrine> <--scope> <user>'
if [[ "$(cat "$command_log")" != "$expected" ]]; then
  echo 'error: Claude update did not refresh the marketplace and plugin cache' >&2
  exit 1
fi
echo 'ok 2 - Claude update refreshes the repository and installed plugin'

run_manager install --client codex
expected=$'codex <plugin> <marketplace> <add> <PeterGrayCreative/peregrine-bugbot> <--ref> <main>\ncodex <plugin> <add> <peregrine@peregrine>'
if [[ "$(cat "$command_log")" != "$expected" ]]; then
  echo 'error: Codex install did not use the canonical GitHub marketplace' >&2
  exit 1
fi
echo 'ok 3 - Codex install registers and installs the canonical marketplace'

run_manager update --client codex
expected=$'codex <plugin> <marketplace> <upgrade> <peregrine>\ncodex <plugin> <add> <peregrine@peregrine>'
if [[ "$(cat "$command_log")" != "$expected" ]]; then
  echo 'error: Codex update did not refresh the marketplace and plugin cache' >&2
  exit 1
fi
echo 'ok 4 - Codex update refreshes the repository and installed plugin'

echo '1..4'
