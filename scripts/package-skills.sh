#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Create reproducible Claude-compatible ZIP archives for both Peregrine skills.

Usage:
  package-skills.sh [--output-dir <directory>]

Options:
  --output-dir  Destination for the two ZIP archives. Defaults to ./dist.
  -h, --help    Show this help.

Each archive contains exactly one top-level skill directory and excludes
macOS metadata.
EOF
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
output_dir="${repo_root}/dist"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir)
      if [[ $# -lt 2 ]]; then
        echo "error: --output-dir requires a value" >&2
        exit 2
      fi
      output_dir="$2"
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

for command_name in zip unzip find sort touch chmod cp; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "error: required command not found: ${command_name}" >&2
    exit 1
  fi
done

skills=(
  "invariant-first-pr-review"
  "build-review-profile"
)

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

mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd)"
stage="$(mktemp -d "${TMPDIR:-/tmp}/peregrine-package.XXXXXX")"

cleanup() {
  status=$?
  if [[ -d "$stage" ]]; then
    rm -rf "$stage"
  fi
  return "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

export LC_ALL=C
export TZ=UTC

for skill in "${skills[@]}"; do
  archive_root="${stage}/${skill}-root"
  mkdir -p "$archive_root"
  cp -R "${repo_root}/skills/${skill}" "$archive_root/"

  find "$archive_root" -type f \( -name '.DS_Store' -o -name '._*' \) -exec rm -f {} +
  find "$archive_root" -type d -name '__MACOSX' -prune -exec rm -rf {} +

  find "${archive_root}/${skill}" -type d -exec chmod 755 {} +
  find "${archive_root}/${skill}" -type f -exec chmod 644 {} +
  if [[ -d "${archive_root}/${skill}/scripts" ]]; then
    find "${archive_root}/${skill}/scripts" -type f -name '*.sh' -exec chmod 755 {} +
  fi
  find "${archive_root}/${skill}" -exec touch -t '200001010000.00' {} +

  file_list="${stage}/${skill}.files"
  (
    cd "$archive_root"
    find "$skill" -type f -print | sort > "$file_list"
  )

  archive="${stage}/${skill}.zip"
  (
    cd "$archive_root"
    zip -X -q "$archive" "$skill"
    zip -X -q "$archive" -@ < "$file_list"
  )

  entries_file="${stage}/${skill}.entries"
  unexpected_file="${stage}/${skill}.unexpected"
  metadata_file="${stage}/${skill}.metadata"
  unzip -Z1 "$archive" > "$entries_file"

  if ! grep -Fxq "${skill}/SKILL.md" "$entries_file"; then
    echo "error: archive is missing ${skill}/SKILL.md" >&2
    exit 1
  fi
  grep -Ev "^${skill}/" "$entries_file" > "$unexpected_file" || true
  if [[ -s "$unexpected_file" ]]; then
    echo "error: archive contains an unexpected top-level entry: ${skill}.zip" >&2
    exit 1
  fi
  grep -E '(^|/)(\.DS_Store|\._[^/]*|__MACOSX)(/|$)' "$entries_file" > "$metadata_file" || true
  if [[ -s "$metadata_file" ]]; then
    echo "error: archive contains macOS metadata: ${skill}.zip" >&2
    exit 1
  fi
done

for skill in "${skills[@]}"; do
  mv -f "${stage}/${skill}.zip" "${output_dir}/${skill}.zip"
  echo "Created ${output_dir}/${skill}.zip"
done
