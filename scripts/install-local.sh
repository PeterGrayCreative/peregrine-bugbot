#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Install both Peregrine skills without overwriting an existing installation.

Usage:
  install-local.sh --client <claude|codex> [--scope <personal|project>]
                   [--dest-dir <skills-directory>]

Options:
  --client    Required. Selects the host and its default skills directory.
  --scope     Defaults to personal. Both hosts also support project scope.
  --dest-dir  Overrides the skills directory. Useful for testing or staging.
  -h, --help  Show this help.

The installer preflights both skill destinations and aborts if either exists.
It never recursively merges a new release into an installed release.
EOF
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

client=""
scope="personal"
destination=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --client)
      if [[ $# -lt 2 ]]; then
        echo "error: --client requires a value" >&2
        exit 2
      fi
      client="$2"
      shift 2
      ;;
    --scope)
      if [[ $# -lt 2 ]]; then
        echo "error: --scope requires a value" >&2
        exit 2
      fi
      scope="$2"
      shift 2
      ;;
    --dest-dir)
      if [[ $# -lt 2 ]]; then
        echo "error: --dest-dir requires a value" >&2
        exit 2
      fi
      destination="$2"
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

if [[ -z "$client" ]]; then
  echo "error: --client is required" >&2
  usage >&2
  exit 2
fi

if [[ "$scope" == "user" ]]; then
  scope="personal"
fi

case "$scope" in
  personal|project)
    ;;
  *)
    echo "error: --scope must be personal or project" >&2
    exit 2
    ;;
esac

if [[ -z "$destination" ]]; then
  case "$client" in
    claude)
      if [[ "$scope" == "project" ]]; then
        destination="${PWD}/.claude/skills"
      else
        : "${HOME:?HOME is required for a personal Claude installation}"
        destination="${HOME}/.claude/skills"
      fi
      ;;
    codex)
      if [[ "$scope" == "project" ]]; then
        destination="${PWD}/.agents/skills"
      else
        : "${HOME:?HOME is required for a personal Codex installation}"
        destination="${HOME}/.agents/skills"
      fi
      ;;
    *)
      echo "error: --client must be claude or codex" >&2
      exit 2
      ;;
  esac
else
  case "$client" in
    claude|codex)
      ;;
    *)
      echo "error: --client must be claude or codex" >&2
      exit 2
      ;;
  esac
fi

skills=(
  "invariant-first-pr-review"
  "build-review-profile"
)

for command_name in cp diff find mktemp; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "error: required command not found: ${command_name}" >&2
    exit 1
  fi
done

for skill in "${skills[@]}"; do
  if [[ ! -f "${repo_root}/skills/${skill}/SKILL.md" ]]; then
    echo "error: source skill is incomplete: ${repo_root}/skills/${skill}" >&2
    exit 1
  fi
done

if find "${repo_root}/skills/invariant-first-pr-review" \
        "${repo_root}/skills/build-review-profile" \
        -type l -print -quit | grep -q .; then
  echo 'error: source skills must not contain symbolic links' >&2
  exit 1
fi

mkdir -p "$destination"
destination="$(cd "$destination" && pwd -P)"

lock="${destination}/.peregrine-install.lock"
lock_owned=0
if ! mkdir "$lock" 2>/dev/null; then
  lock_pid="$(sed -n '1p' "${lock}/pid" 2>/dev/null || true)"
  if [[ "$lock_pid" =~ ^[0-9]+$ ]] && kill -0 "$lock_pid" 2>/dev/null; then
    echo "error: another Peregrine installation is active in ${destination}" >&2
    exit 4
  fi
  rm -rf "$lock"
  if ! mkdir "$lock" 2>/dev/null; then
    echo "error: could not acquire the Peregrine installation lock in ${destination}" >&2
    exit 4
  fi
fi
lock_owned=1
printf '%s\n' "$$" > "${lock}/pid"

transaction=""
ready=0
recovered=0

cleanup() {
  status=$?
  if [[ -n "$transaction" && -d "$transaction" && "$ready" -eq 0 ]]; then
    rm -rf "$transaction"
  fi
  if [[ "$lock_owned" -eq 1 && -d "$lock" ]]; then
    rm -rf "$lock"
  fi
  return "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

recover_transaction() {
  local pending="$1" skill staged target
  if [[ ! -f "${pending}/READY" || -L "${pending}/READY" ]]; then
    rm -rf "$pending"
    return 0
  fi

  if find "$pending" -type l -print -quit | grep -q .; then
    echo 'error: interrupted install contains symbolic links and cannot be recovered safely' >&2
    exit 4
  fi

  for skill in "${skills[@]}"; do
    staged="${pending}/staged/${skill}"
    target="${destination}/${skill}"
    if [[ -d "$staged" && ! -L "$staged" && ! -e "$target" && ! -L "$target" ]]; then
      if ! diff -qr "${repo_root}/skills/${skill}" "$staged" >/dev/null; then
        echo "error: interrupted install does not match the current source release: ${skill}" >&2
        exit 4
      fi
    elif [[ ! -e "$staged" && ! -L "$staged" && -d "$target" && ! -L "$target" ]]; then
      if ! diff -qr "${repo_root}/skills/${skill}" "$target" >/dev/null; then
        echo "error: partially published install does not match the current source release: ${skill}" >&2
        exit 4
      fi
    else
      echo "error: interrupted install cannot be recovered safely: ${skill}" >&2
      exit 4
    fi
  done

  # Validate the entire matched pair before publishing any still-staged skill.
  # This keeps a corrupt second skill from leaving the first one newly visible.
  for skill in "${skills[@]}"; do
    staged="${pending}/staged/${skill}"
    target="${destination}/${skill}"
    if [[ -d "$staged" && ! -L "$staged" && ! -e "$target" && ! -L "$target" ]]; then
      mv "$staged" "$target"
    fi
  done

  for skill in "${skills[@]}"; do
    if [[ ! -f "${destination}/${skill}/SKILL.md" ]]; then
      echo "error: recovered install is incomplete: ${skill}" >&2
      exit 4
    fi
    if find "${destination}/${skill}" -type l -print -quit | grep -q . || \
       ! diff -qr "${repo_root}/skills/${skill}" "${destination}/${skill}" >/dev/null; then
      echo "error: recovered install failed source-integrity validation: ${skill}" >&2
      exit 4
    fi
  done
  rm -rf "$pending"
  recovered=1
}

while IFS= read -r -d '' pending; do
  recover_transaction "$pending"
done < <(find "$destination" -maxdepth 1 -type d -name '.peregrine-install.*' \
  ! -name '.peregrine-install.lock' -print0)

if [[ "$recovered" -eq 1 ]]; then
  echo "Recovered a matched Peregrine installation for ${client}:"
  for skill in "${skills[@]}"; do
    echo "- ${destination}/${skill}"
  done
  exit 0
fi

preflight_failed=0
for skill in "${skills[@]}"; do
  target="${destination}/${skill}"
  if [[ -e "$target" || -L "$target" ]]; then
    echo "error: destination already exists: ${target}" >&2
    preflight_failed=1
  fi
done
if [[ "$preflight_failed" -ne 0 ]]; then
  echo "Remove or move both installed skill directories deliberately before installing a new matched release." >&2
  exit 3
fi

transaction="$(mktemp -d "${destination}/.peregrine-install.XXXXXX")"
stage="${transaction}/staged"
mkdir "$stage"

for skill in "${skills[@]}"; do
  cp -R -p "${repo_root}/skills/${skill}" "$stage/"
done

find "$stage" -type f \( -name '.DS_Store' -o -name '._*' \) -exec rm -f {} +
find "$stage" -type d -name '__MACOSX' -prune -exec rm -rf {} +

for skill in "${skills[@]}"; do
  if [[ ! -f "${stage}/${skill}/SKILL.md" ]]; then
    echo "error: staged skill is incomplete: ${skill}" >&2
    exit 1
  fi
  if ! diff -qr "${repo_root}/skills/${skill}" "${stage}/${skill}" >/dev/null; then
    echo "error: staged skill differs from its source: ${skill}" >&2
    exit 1
  fi
done

# Repeat the two-target preflight immediately before claiming the destinations.
for skill in "${skills[@]}"; do
  target="${destination}/${skill}"
  if [[ -e "$target" || -L "$target" ]]; then
    echo "error: destination appeared during installation: ${target}" >&2
    exit 3
  fi
done

touch "${transaction}/READY"
ready=1
for skill in "${skills[@]}"; do
  mv "${stage}/${skill}" "${destination}/${skill}"
done

for skill in "${skills[@]}"; do
  if [[ ! -f "${destination}/${skill}/SKILL.md" ]]; then
    echo "error: installed skill failed validation: ${skill}" >&2
    exit 1
  fi
  if ! diff -qr "${repo_root}/skills/${skill}" "${destination}/${skill}" >/dev/null; then
    echo "error: installed skill differs from its source: ${skill}" >&2
    exit 1
  fi
done

rm -rf "$transaction"
transaction=""
ready=0
echo "Installed matched Peregrine skills for ${client}:"
for skill in "${skills[@]}"; do
  echo "- ${destination}/${skill}"
done
