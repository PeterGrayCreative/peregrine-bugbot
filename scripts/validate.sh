#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

if find "${repo_root}/skills" -type l -print -quit | grep -q .; then
  echo 'error: source skills must not contain symbolic links' >&2
  exit 1
fi

for skill_dir in "${repo_root}/skills/invariant-first-pr-review" "${repo_root}/skills/build-review-profile"; do
  skill_file="${skill_dir}/SKILL.md"
  expected_name="${skill_dir##*/}"
  if [[ "$(sed -n '1p' "$skill_file")" != '---' || "$(sed -n '4p' "$skill_file")" != '---' ]]; then
    echo "error: invalid four-line YAML frontmatter: ${skill_file}" >&2
    exit 1
  fi
  name="$(sed -n '2s/^name: //p' "$skill_file")"
  description="$(sed -n '3s/^description: //p' "$skill_file")"
  if [[ "$name" != "$expected_name" || ! "$name" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
    echo "error: skill name does not match its folder: ${skill_file}" >&2
    exit 1
  fi
  if [[ -z "$description" || ${#description} -gt 200 || "$description" == *'<'* || "$description" == *'>'* ]]; then
    echo "error: invalid skill description: ${skill_file}" >&2
    exit 1
  fi
done

while IFS= read -r -d '' markdown_file; do
  while IFS= read -r markdown_link; do
    link_target="${markdown_link#*](}"
    link_target="${link_target%)}"
    link_target="${link_target%%#*}"
    case "$link_target" in
      ''|'#'*|*://*)
        continue
        ;;
    esac
    if [[ ! -e "$(dirname "$markdown_file")/${link_target}" ]]; then
      echo "error: missing relative link target '${link_target}' in ${markdown_file}" >&2
      exit 1
    fi
  done < <(rg -o '\[[^]]+\]\([^)]+\)' "$markdown_file" || true)
done < <(find "${repo_root}/skills" -type f -name '*.md' -print0)

while IFS= read -r -d '' script; do
  /bin/bash -n "$script"
done < <(find "${repo_root}/scripts" "${repo_root}/tests" -type f -name '*.sh' -print0)

tracked_metadata="$(git -C "$repo_root" ls-files -- \
  'skills/**' 'scripts/**' 'tests/**' '.claude-plugin/**' '.codex-plugin/**' | \
  grep -E '(^|/)(\.DS_Store|\._[^/]*|__MACOSX)(/|$)' || true)"
if [[ -n "$tracked_metadata" ]]; then
  echo 'error: package contains macOS metadata' >&2
  printf '%s\n' "$tracked_metadata" >&2
  exit 1
fi

/bin/bash "${repo_root}/tests/review-manifest.test.sh"
/bin/bash "${repo_root}/tests/package-and-install.test.sh"
/bin/bash "${repo_root}/tests/manage-plugin.test.sh"

echo 'Peregrine package validation passed.'
