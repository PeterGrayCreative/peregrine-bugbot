#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Install or update the canonical Peregrine plugin from GitHub.

Usage:
  manage-plugin.sh <install|update> --client <claude|codex>

The install command registers PeterGrayCreative/peregrine-bugbot at main as
the Peregrine marketplace and installs the plugin. The update command refreshes
that Git-backed marketplace and replaces the installed plugin from its latest
snapshot. Restart the host or start a new thread after either command.
EOF
}

action="${1:-}"
if [[ "$action" == "install" || "$action" == "update" ]]; then
  shift
else
  echo 'error: first argument must be install or update' >&2
  usage >&2
  exit 2
fi

client=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --client)
      if [[ $# -lt 2 ]]; then
        echo 'error: --client requires a value' >&2
        exit 2
      fi
      client="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$client" != "claude" && "$client" != "codex" ]]; then
  echo 'error: --client must be claude or codex' >&2
  exit 2
fi

if ! command -v "$client" >/dev/null 2>&1; then
  echo "error: ${client} CLI is not available" >&2
  exit 1
fi

marketplace="peregrine"
plugin="peregrine@${marketplace}"
repository="PeterGrayCreative/peregrine-bugbot"

case "${action}:${client}" in
  install:claude)
    claude plugin marketplace add "${repository}@main"
    claude plugin install "$plugin" --scope user
    ;;
  update:claude)
    claude plugin marketplace update "$marketplace"
    claude plugin update "$plugin" --scope user
    ;;
  install:codex)
    codex plugin marketplace add "$repository" --ref main
    codex plugin add "$plugin"
    ;;
  update:codex)
    codex plugin marketplace upgrade "$marketplace"
    codex plugin add "$plugin"
    ;;
esac

echo "${client} ${action} complete. Restart ${client} or start a new thread to load the refreshed plugin."
