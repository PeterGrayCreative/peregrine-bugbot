#!/usr/bin/env bash
# Validate the portable Peregrine profile schema and every declared regex.
set -euo pipefail

usage() {
  echo "Usage: validate-profile.sh [--review-head <ref>] <profile.md>" >&2
}

review_head=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --review-head)
      if [[ $# -lt 2 ]]; then
        echo 'error: --review-head requires a value' >&2
        exit 2
      fi
      review_head="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    --*)
      echo "error: unknown option: $1" >&2
      usage
      exit 2
      ;;
    *)
      break
      ;;
  esac
done

if [[ $# -ne 1 ]]; then
  usage
  exit 2
fi

for command_name in git grep rg sed tr; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "error: required command not found: ${command_name}" >&2
    exit 1
  fi
done

profile="$1"
if [[ ! -f "$profile" ]]; then
  echo "error: profile not found: ${profile}" >&2
  exit 1
fi

version_count="$(grep -xFc '<!-- peregrine-profile-version: 1 -->' "$profile" || true)"
if [[ "$version_count" -ne 1 ]]; then
  echo "error: profile must contain exactly one '<!-- peregrine-profile-version: 1 -->' marker" >&2
  exit 1
fi

base_count="$(grep -c '^<!-- review-base: .* -->$' "$profile" || true)"
if [[ "$base_count" -ne 1 ]]; then
  echo "error: profile must contain exactly one review-base declaration at column 0" >&2
  exit 1
fi
review_base="$(grep '^<!-- review-base: .* -->$' "$profile" | sed -e 's/^<!-- review-base: //' -e 's/ -->$//')"
case "$review_base" in
  ''|HEAD|head|'@'|'-')
    echo "error: review-base must name a stable branch or commit, not '${review_base}'" >&2
    exit 1
    ;;
esac
if [[ ! "$review_base" =~ ^[0-9a-fA-F]{7,64}$ ]] && \
   ! git check-ref-format --branch "$review_base" >/dev/null 2>&1; then
  echo 'error: review-base must be a branch, tag-like ref, or literal commit id, not a relative revision expression' >&2
  exit 1
fi

profile_base_is_confirmed_integration() {
  local requested="$1" resolved remote_head target
  resolved="$(git rev-parse --symbolic-full-name "$requested" 2>/dev/null || true)"
  if [[ "$resolved" == refs/heads/* ]]; then
    return 1
  fi
  if [[ "$resolved" == refs/remotes/*/HEAD ]]; then
    resolved="$(git symbolic-ref --quiet "$resolved" 2>/dev/null || true)"
  fi
  if [[ "$resolved" != refs/remotes/* ]]; then
    return 1
  fi
  while IFS= read -r remote_head; do
    case "$remote_head" in
      refs/remotes/*/HEAD)
        target="$(git symbolic-ref --quiet "$remote_head" 2>/dev/null || true)"
        if [[ -n "$target" && "$resolved" == "$target" ]]; then
          return 0
        fi
        ;;
    esac
  done < <(git for-each-ref --format='%(refname)' refs/remotes)
  return 1
}

if git rev-parse --show-toplevel >/dev/null 2>&1 && \
   ! git rev-parse --verify --end-of-options "${review_base}^{commit}" >/dev/null 2>&1; then
  echo "error: review-base is not a commit in the target repository: ${review_base}" >&2
  exit 1
fi

if [[ -n "$review_head" ]]; then
  if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
    echo 'error: --review-head requires running inside the target Git repository' >&2
    exit 1
  fi
  if ! profile_base_is_confirmed_integration "$review_base"; then
    echo 'error: profile review-base is not the confirmed remote integration branch; pass the intended base explicitly during manifest validation' >&2
    exit 1
  fi
  review_base_commit="$(git rev-parse --verify --end-of-options "${review_base}^{commit}" 2>/dev/null || true)"
  review_head_commit="$(git rev-parse --verify --end-of-options "${review_head}^{commit}" 2>/dev/null || true)"
  if [[ -z "$review_base_commit" || -z "$review_head_commit" ]]; then
    echo 'error: review-base and review-head must both resolve to commits' >&2
    exit 1
  fi
  if [[ "$(git merge-base "$review_base_commit" "$review_head_commit")" == "$review_head_commit" ]]; then
    echo 'error: profile-selected review-base would produce an empty or self-blinded review; pass an explicit earlier base' >&2
    exit 1
  fi
fi

if rg -q -e 'YOUR_|<project-name>|<default-branch>|<languages, frameworks|<URL or path>|<test, lint|<path \+|<name>|<concrete identity|<one line each>|<lanes/NN' -- "$profile"; then
  echo "error: profile still contains template placeholders" >&2
  exit 1
fi

validate_no_secrets() {
  local file="$1" context="$2" secret_assignment assignment_line normalized_line assignment_value
  if rg -q -i \
       -e '-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----' \
       -e '\b(sk-(proj-)?[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{16,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b' \
       -- "$file"; then
    echo "error: ${context} appears to contain an unredacted secret; remove the value before validation" >&2
    exit 1
  fi

  secret_assignment=0
  while IFS= read -r assignment_line; do
    normalized_line="$(printf '%s\n' "$assignment_line" | tr '[:upper:]' '[:lower:]')"
    assignment_value="$(printf '%s\n' "$normalized_line" | sed -E \
      's/^[[:space:]-]*[a-z0-9_.-]*(password|passwd|api[_-]?key|secret|token|connection[_-]?string)[a-z0-9_.-]*[[:space:]]*[:=][[:space:]]*//')"
    assignment_value="$(printf '%s\n' "$assignment_value" | sed -E \
      's/^[[:space:]]+//; s/[[:space:]]+$//')"
    case "$assignment_value" in
      \"*)
        assignment_value="${assignment_value#\"}"
        assignment_value="${assignment_value%%\"*}"
        ;;
      \'*)
        assignment_value="${assignment_value#\'}"
        assignment_value="${assignment_value%%\'*}"
        ;;
      *)
        assignment_value="$(printf '%s\n' "$assignment_value" | sed -E \
          's/[[:space:]]+#.*$//; s/[[:space:]]+$//')"
        ;;
    esac
    case "$assignment_value" in
      ''|'<redacted>'|'redacted'|'placeholder'|'example'|'***'|\$*|'env:'*|'environment'*|'secret-manager'*|'vault'*|'keychain'*)
        continue
        ;;
    esac
    if [[ ${#assignment_value} -ge 12 && \
          "$assignment_value" != *[[:space:]]* && \
          "$assignment_value" == *[[:alpha:]]* && \
          "$assignment_value" == *[[:digit:]]* ]]; then
      secret_assignment=1
      break
    fi
  done < <(rg -i -N -e '^[[:space:]-]*[A-Za-z0-9_.-]*(password|passwd|api[_-]?key|secret|token|connection[_-]?string)[A-Za-z0-9_.-]*[[:space:]]*[:=]' -- "$file" || true)
  if [[ "$secret_assignment" -eq 1 ]]; then
    echo "error: ${context} appears to contain an unredacted credential assignment; remove the value before validation" >&2
    exit 1
  fi
}

validate_no_secrets "$profile" 'profile'

validate_regex() {
  local pattern="$1" context="$2" result
  if rg -q -e "$pattern" -- /dev/null; then
    return 0
  else
    result=$?
  fi
  if [[ "$result" -eq 1 ]]; then
    return 0
  fi
  echo "error: invalid ${context} regex" >&2
  exit 1
}

validate_pattern_line() {
  local line="$1" kind="$2" context="$3" pattern
  if ! printf '%s\n' "$line" | rg -q -e "^<!-- manifest(-extend [a-z0-9][a-z0-9-]*)? ${kind}-pattern: .+ -->$" --; then
    echo "error: malformed ${context} ${kind}-pattern declaration" >&2
    exit 1
  fi
  pattern="${line#*: }"
  pattern="${pattern% -->}"
  validate_regex "$pattern" "${context} ${kind}-pattern"
}

lanes_dir="$(cd "$(dirname "$profile")" && pwd -P)/lanes"
if [[ -d "$lanes_dir" ]] && find "$lanes_dir" -type l -print -quit | grep -q .; then
  echo 'error: profile custom lanes must not contain symbolic links' >&2
  exit 1
fi
while IFS= read -r extension_line; do
  if [[ -z "$extension_line" ]]; then
    continue
  fi
  if ! printf '%s\n' "$extension_line" | rg -q -e '^<!-- manifest-extend [a-z0-9][a-z0-9-]* (path|content)-pattern: .+ -->$' --; then
    echo "error: malformed manifest-extend declaration: ${extension_line}" >&2
    exit 1
  fi
  extension_id="$(printf '%s\n' "$extension_line" | sed -E 's/^<!-- manifest-extend ([^ ]+) .*$/\1/')"
  extension_id_known=0
  case "$extension_id" in
    authorization|identifiers|data-integrity|persistence|runtime-config|contracts|concurrency|test-quality)
      extension_id_known=1
      ;;
    *)
      for custom_lane in "$lanes_dir"/[0-9][0-9]-"${extension_id}.md"; do
        if [[ -f "$custom_lane" ]]; then
          extension_id_known=1
        fi
      done
      ;;
  esac
  if [[ "$extension_id_known" -ne 1 ]]; then
    echo "error: manifest-extend references an unknown lane id: ${extension_id}" >&2
    exit 1
  fi
  extension_kind="$(printf '%s\n' "$extension_line" | sed -E 's/^<!-- manifest-extend [^ ]+ (path|content)-pattern:.*$/\1/')"
  validate_pattern_line "$extension_line" "$extension_kind" 'profile extension'
done < <(grep '^<!-- manifest-extend ' "$profile" || true)

if [[ -d "$lanes_dir" ]]; then
  for lane_file in "$lanes_dir"/*.md; do
    if [[ ! -e "$lane_file" ]]; then
      continue
    fi
    validate_no_secrets "$lane_file" 'custom lane'
    lane_name="${lane_file##*/}"
    if ! printf '%s\n' "$lane_name" | rg -q -e '^[0-9][0-9]-[a-z0-9][a-z0-9-]*\.md$' --; then
      echo "error: custom lane filename must be NN-lowercase-id.md: ${lane_name}" >&2
      exit 1
    fi
    if ! sed -n '1p' "$lane_file" | rg -q -e '^# .+' --; then
      echo "error: custom lane must start with a heading: ${lane_name}" >&2
      exit 1
    fi
    for kind in path content; do
      declaration_count="$(grep -c "^<!-- manifest ${kind}-pattern: .* -->$" "$lane_file" || true)"
      if [[ "$declaration_count" -ne 1 ]]; then
        echo "error: ${lane_name} must contain exactly one ${kind}-pattern declaration" >&2
        exit 1
      fi
      declaration="$(grep "^<!-- manifest ${kind}-pattern: .* -->$" "$lane_file")"
      validate_pattern_line "$declaration" "$kind" "$lane_name"
    done
  done
fi

echo "Profile is valid: ${profile}"
