#!/usr/bin/env bash
# Inventory changed surfaces and map them to invariant review lanes.
#
# Usage:
#   review-manifest.sh [--trust-working-tree-profile] [<base-ref>|-] [<head-ref>] [<profile.md>]
#
# A repository-local profile is read from the merge base by default. The
# explicit trust flag is reserved for validating an intentional profile edit.
set -euo pipefail

usage() {
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
}

trust_working_tree_profile=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --trust-working-tree-profile)
      trust_working_tree_profile=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -)
      break
      ;;
    --*)
      echo "error: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      break
      ;;
  esac
done

if [[ $# -gt 3 ]]; then
  echo "error: expected at most base, head, and profile arguments" >&2
  usage >&2
  exit 2
fi

for command_name in git rg grep sed mktemp tr; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "error: required command not found: ${command_name}" >&2
    exit 1
  fi
done

base_ref="${1:-}"
if [[ "$base_ref" == "-" ]]; then
  base_ref=""
fi
head_ref="${2:-HEAD}"
requested_profile="${3:-}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
lanes_dir="${script_dir}/../references/lanes"
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"

if [[ -z "$repo_root" ]]; then
  echo "error: run the manifest from inside the repository under review" >&2
  exit 1
fi
repo_root="$(cd "$repo_root" && pwd -P)"

if [[ ! -d "$lanes_dir" ]]; then
  echo "error: lanes directory not found: ${lanes_dir}" >&2
  exit 1
fi

profile_abs=""
profile_repo_rel=""
profile_is_repo_local=0
profile_lanes_rel=""
if [[ -n "$requested_profile" ]]; then
  if [[ -e "$requested_profile" || -L "$requested_profile" ]]; then
    profile_parent="$(cd "$(dirname "$requested_profile")" && pwd -P)"
    profile_abs="${profile_parent}/$(basename "$requested_profile")"
  elif [[ "$requested_profile" == ".peregrine/profile.md" || "$requested_profile" == "${repo_root}/.peregrine/profile.md" ]]; then
    profile_abs="${repo_root}/.peregrine/profile.md"
  else
    echo "error: profile not found: ${requested_profile}" >&2
    exit 1
  fi

  case "$profile_abs" in
    "${repo_root}"/*)
      profile_is_repo_local=1
      profile_repo_rel="${profile_abs#"${repo_root}"/}"
      ;;
  esac
fi

extract_review_base() {
  local profile_file="$1"
  grep '^<!-- review-base: .* -->$' "$profile_file" 2>/dev/null | head -n1 | \
    sed -e 's/^<!-- review-base: //' -e 's/ -->$//' || true
}

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

base_source="argument"
if [[ -z "$base_ref" && -n "$profile_abs" && \
      ( "$profile_is_repo_local" -eq 0 || "$trust_working_tree_profile" -eq 1 ) ]]; then
  if [[ ! -f "$profile_abs" ]]; then
    echo "error: trusted working profile not found: ${profile_abs}" >&2
    exit 1
  fi
  profile_version_count="$(grep -xFc '<!-- peregrine-profile-version: 1 -->' "$profile_abs" || true)"
  if [[ "$profile_version_count" -ne 1 ]]; then
    echo "error: trusted profile must contain exactly one '<!-- peregrine-profile-version: 1 -->' marker" >&2
    exit 1
  fi
  base_ref="$(extract_review_base "$profile_abs")"
  case "$base_ref" in
    HEAD|head|'@'|'-')
      echo "error: profile review-base must name a stable branch or commit, not '${base_ref}'" >&2
      exit 1
      ;;
  esac
  if [[ -n "$base_ref" && ! "$base_ref" =~ ^[0-9a-fA-F]{7,64}$ ]] && \
     ! git check-ref-format --branch "$base_ref" >/dev/null 2>&1; then
    echo 'error: profile review-base must be a branch, tag-like ref, or literal commit id, not a relative revision expression' >&2
    exit 1
  fi
  if [[ -n "$base_ref" ]]; then
    if ! profile_base_is_confirmed_integration "$base_ref"; then
      echo 'error: profile review-base is not the confirmed remote integration branch; pass the intended base explicitly' >&2
      exit 1
    fi
    base_source="trusted profile review-base"
  fi
fi
if [[ -z "$base_ref" ]]; then
  base_ref="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)"
  if [[ -n "$base_ref" ]]; then
    base_source="origin/HEAD"
  fi
fi
if [[ -z "$base_ref" ]]; then
  base_ref="main"
  base_source="fallback"
fi

base_commit="$(git rev-parse --verify --end-of-options "${base_ref}^{commit}" 2>/dev/null || true)"
if [[ -z "$base_commit" ]]; then
  echo "error: base ref is not a commit: ${base_ref}" >&2
  exit 1
fi
head_commit="$(git rev-parse --verify --end-of-options "${head_ref}^{commit}" 2>/dev/null || true)"
if [[ -z "$head_commit" ]]; then
  echo "error: head ref is not a commit: ${head_ref}" >&2
  exit 1
fi
merge_base="$(git merge-base "$base_commit" "$head_commit")"
if [[ "$base_source" == "trusted profile review-base" && "$merge_base" == "$head_commit" ]]; then
  echo 'error: profile-selected review-base would produce an empty or self-blinded review; pass the intended base explicitly' >&2
  exit 1
fi

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/peregrine-manifest.XXXXXX")"
cleanup() {
  status=$?
  rm -rf "$work_dir"
  return "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

effective_profile=""
profile_lanes_dir=""
profile_source=""
profile_changed_at_head=0

if [[ -n "$profile_abs" ]]; then
  if [[ "$profile_is_repo_local" -eq 0 || "$trust_working_tree_profile" -eq 1 ]]; then
    if [[ ! -f "$profile_abs" ]]; then
      echo "error: profile not found: ${profile_abs}" >&2
      exit 1
    fi
    effective_profile="$profile_abs"
    profile_lanes_dir="$(cd "$(dirname "$profile_abs")" && pwd -P)/lanes"
    if [[ "$profile_is_repo_local" -eq 1 ]]; then
      profile_source="trusted working tree"
    else
      profile_source="trusted external path"
    fi
  else
    profile_parent_rel="${profile_repo_rel%/*}"
    if [[ "$profile_parent_rel" == "$profile_repo_rel" ]]; then
      profile_parent_rel=""
    fi
    profile_lanes_rel="${profile_parent_rel:+${profile_parent_rel}/}lanes"

    if git cat-file -e "${merge_base}:${profile_repo_rel}" 2>/dev/null; then
      trusted_profile_dir="${work_dir}/trusted-profile"
      mkdir -p "${trusted_profile_dir}/lanes"
      git show "${merge_base}:${profile_repo_rel}" > "${trusted_profile_dir}/profile.md"
      effective_profile="${trusted_profile_dir}/profile.md"
      profile_lanes_dir="${trusted_profile_dir}/lanes"
      profile_source="merge-base snapshot"

      while IFS= read -r -d '' lane_path; do
        lane_parent="${lane_path%/*}"
        if [[ "$lane_parent" == "$profile_lanes_rel" && "$lane_path" == *.md ]]; then
          lane_name="${lane_path##*/}"
          git show "${merge_base}:${lane_path}" > "${profile_lanes_dir}/${lane_name}"
        fi
      done < <(git --literal-pathspecs ls-tree -r --name-only -z "$merge_base" -- "$profile_lanes_rel")
    else
      profile_source="ignored; absent at merge base"
    fi

    if ! git --literal-pathspecs diff --quiet "$merge_base" "$head_commit" -- "$profile_repo_rel" "$profile_lanes_rel"; then
      profile_changed_at_head=1
    fi
  fi
fi

lane_id_known() {
  local requested_id="$1" candidate candidate_name candidate_id
  for candidate in "$lanes_dir"/[0-9]*.md; do
    if [[ ! -f "$candidate" ]]; then
      continue
    fi
    candidate_name="${candidate##*/}"
    candidate_id="${candidate_name%.md}"
    candidate_id="${candidate_id#[0-9][0-9]-}"
    if [[ "$candidate_id" == "$requested_id" ]]; then
      return 0
    fi
  done
  if [[ -n "$profile_lanes_dir" && -d "$profile_lanes_dir" ]]; then
    for candidate in "$profile_lanes_dir"/[0-9][0-9]-"${requested_id}.md"; do
      if [[ -f "$candidate" && ! -L "$candidate" ]]; then
        return 0
      fi
    done
  fi
  return 1
}

validate_no_secrets() {
  local file="$1" context="$2" secret_assignment assignment_line normalized_line assignment_value
  if rg -q -i \
       -e '-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----' \
       -e '\b(sk-(proj-)?[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{16,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b' \
       -- "$file"; then
    echo "error: ${context} appears to contain an unredacted secret" >&2
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
    echo "error: ${context} appears to contain an unredacted credential assignment" >&2
    exit 1
  fi
}

validate_profile_configuration() {
  local profile_file="$1" count declared_base extension_line extension_id extension_kind pattern result profile_lane
  count="$(grep -xFc '<!-- peregrine-profile-version: 1 -->' "$profile_file" || true)"
  if [[ "$count" -ne 1 ]]; then
    echo "error: profile must contain exactly one '<!-- peregrine-profile-version: 1 -->' marker" >&2
    exit 1
  fi
  count="$(grep -c '^<!-- review-base: .* -->$' "$profile_file" || true)"
  if [[ "$count" -ne 1 ]]; then
    echo 'error: profile must contain exactly one review-base declaration at column 0' >&2
    exit 1
  fi
  declared_base="$(extract_review_base "$profile_file")"
  case "$declared_base" in
    ''|HEAD|head|'@'|'-')
      echo "error: profile review-base must name a stable branch or commit, not '${declared_base}'" >&2
      exit 1
      ;;
  esac
  if [[ ! "$declared_base" =~ ^[0-9a-fA-F]{7,64}$ ]] && \
     ! git check-ref-format --branch "$declared_base" >/dev/null 2>&1; then
    echo 'error: profile review-base must be a branch, tag-like ref, or literal commit id, not a relative revision expression' >&2
    exit 1
  fi
  if [[ -n "$profile_lanes_dir" ]] && \
     find "$profile_lanes_dir" -type l -print -quit 2>/dev/null | grep -q .; then
    echo 'error: profile custom lanes must not contain symbolic links' >&2
    exit 1
  fi
  validate_no_secrets "$profile_file" 'profile'
  if [[ -n "$profile_lanes_dir" && -d "$profile_lanes_dir" ]]; then
    for profile_lane in "$profile_lanes_dir"/*.md; do
      if [[ -f "$profile_lane" && ! -L "$profile_lane" ]]; then
        validate_no_secrets "$profile_lane" 'custom lane'
      fi
    done
  fi

  while IFS= read -r extension_line; do
    if [[ -z "$extension_line" ]]; then
      continue
    fi
    if ! printf '%s\n' "$extension_line" | \
         rg -q -e '^<!-- manifest-extend [a-z0-9][a-z0-9-]* (path|content)-pattern: .+ -->$' --; then
      echo 'error: malformed manifest-extend declaration' >&2
      exit 1
    fi
    extension_id="$(printf '%s\n' "$extension_line" | sed -E 's/^<!-- manifest-extend ([^ ]+) .*$/\1/')"
    extension_kind="$(printf '%s\n' "$extension_line" | sed -E 's/^<!-- manifest-extend [^ ]+ (path|content)-pattern:.*$/\1/')"
    if ! lane_id_known "$extension_id"; then
      echo "error: manifest-extend references an unknown lane id: ${extension_id}" >&2
      exit 1
    fi
    pattern="${extension_line#*: }"
    pattern="${pattern% -->}"
    if rg -q -e "$pattern" -- /dev/null; then
      :
    else
      result=$?
      if [[ "$result" -ne 1 ]]; then
        echo "error: invalid ${extension_id} ${extension_kind}-pattern regex" >&2
        exit 1
      fi
    fi
  done < <(grep -E '^[[:space:]]*<!-- manifest-extend' "$profile_file" || true)
}

if [[ -n "$effective_profile" ]]; then
  validate_profile_configuration "$effective_profile"
fi

changed_files=()
while IFS= read -r -d '' changed_path; do
  changed_files[${#changed_files[@]}]="$changed_path"
done < <(git diff --name-only -z "$merge_base" "$head_commit")
changed_count=${#changed_files[@]}

echo "Invariant-first review manifest"
echo "base: ${base_ref} (${base_source})"
echo "head: ${head_ref}"
echo "merge-base: ${merge_base}"
if [[ -n "$requested_profile" ]]; then
  echo "profile: ${requested_profile} (${profile_source})"
fi
if [[ "$profile_changed_at_head" -eq 1 ]]; then
  echo "warning: head changes to the repository profile or custom lanes are ignored; review them as untrusted code or rerun with --trust-working-tree-profile after explicit approval"
fi

echo
echo "Changed files"
if [[ "$changed_count" -gt 0 ]]; then
  git diff --name-status "$merge_base" "$head_commit"
else
  echo "(none)"
fi

echo
echo "Diff summary"
git diff --stat "$merge_base" "$head_commit"

diff_cache="${work_dir}/diffs"
mkdir -p "$diff_cache"
index=0
while [[ "$index" -lt "$changed_count" ]]; do
  changed_path="${changed_files[$index]}"
  git --literal-pathspecs diff --unified=0 "$merge_base" "$head_commit" -- "$changed_path" \
    > "${diff_cache}/${index}.diff" 2>/dev/null || true
  index=$((index + 1))
done

extract_pattern() {
  local file="$1" kind="$2" prefix line
  prefix="<!-- manifest ${kind}-pattern: "
  while IFS= read -r line; do
    if [[ "$line" == "${prefix}"*" -->" ]]; then
      line="${line#"${prefix}"}"
      printf '%s\n' "${line% -->}"
      return 0
    fi
  done < "$file"
  return 0
}

extract_extend() {
  local file="$1" id="$2" kind="$3" prefix line pattern joined
  prefix="<!-- manifest-extend ${id} ${kind}-pattern: "
  joined=""
  while IFS= read -r line; do
    if [[ "$line" == "${prefix}"*" -->" ]]; then
      pattern="${line#"${prefix}"}"
      pattern="${pattern% -->}"
      joined="${joined:+${joined}|}${pattern}"
    fi
  done < "$file"
  printf '%s\n' "$joined"
}

validate_regex() {
  local pattern="$1" context="$2" result
  if [[ -z "$pattern" ]]; then
    return 0
  fi
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

emit_lane() {
  local lane_file="$1"
  local fname id label path_pattern content_pattern extra found path_matches content_matches
  local path_declarations content_declarations

  fname="${lane_file##*/}"
  id="${fname%.md}"
  id="${id#[0-9][0-9]-}"
  if [[ ! "$id" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
    echo "error: invalid lane id from filename: ${fname}" >&2
    exit 1
  fi

  path_declarations="$(grep -c '^<!-- manifest path-pattern: .* -->$' "$lane_file" || true)"
  content_declarations="$(grep -c '^<!-- manifest content-pattern: .* -->$' "$lane_file" || true)"
  if [[ "$path_declarations" -ne 1 || "$content_declarations" -ne 1 ]]; then
    echo "error: lane must contain exactly one path and content manifest declaration: ${fname}" >&2
    exit 1
  fi
  if ! grep -q '^\*\*Lane summary:\*\* .' "$lane_file"; then
    echo "error: lane must contain a Lane summary: ${fname}" >&2
    exit 1
  fi

  label="$(sed -n '1s/^# //p' "$lane_file")"
  if [[ -z "$label" ]]; then
    label="$id"
  fi

  path_pattern="$(extract_pattern "$lane_file" 'path')"
  content_pattern="$(extract_pattern "$lane_file" 'content')"

  if [[ -n "$effective_profile" ]]; then
    extra="$(extract_extend "$effective_profile" "$id" 'path')"
    if [[ -n "$extra" ]]; then
      path_pattern="${path_pattern:+${path_pattern}|}${extra}"
    fi
    extra="$(extract_extend "$effective_profile" "$id" 'content')"
    if [[ -n "$extra" ]]; then
      content_pattern="${content_pattern:+${content_pattern}|}${extra}"
    fi
  fi

  validate_regex "$path_pattern" "${id} path-pattern"
  validate_regex "$content_pattern" "${id} content-pattern"

  echo
  echo "${label} [lane: ${id}]"
  if [[ -n "${lane_source_hint:-}" ]]; then
    printf 'trusted lane source: %q\n' "$lane_source_hint"
  fi
  if [[ -z "$path_pattern" && -z "$content_pattern" ]]; then
    echo "(no manifest patterns declared)"
    return 0
  fi

  found=0
  index=0
  while [[ "$index" -lt "$changed_count" ]]; do
    changed_path="${changed_files[$index]}"
    path_matches=0
    content_matches=0
    if [[ -n "$path_pattern" ]] && printf '%s\n' "$changed_path" | rg -q -e "$path_pattern" --; then
      path_matches=1
    fi
    if [[ -n "$content_pattern" && -s "${diff_cache}/${index}.diff" ]] && \
       rg -q -e "$content_pattern" -- "${diff_cache}/${index}.diff"; then
      content_matches=1
    fi
    if [[ "$path_matches" -eq 1 || "$content_matches" -eq 1 ]]; then
      printf -- '- %q\n' "$changed_path"
      found=1
    fi
    index=$((index + 1))
  done

  if [[ "$found" -eq 0 ]]; then
    echo "(none detected)"
  fi
}

lane_source_hint=""
for lane_file in "$lanes_dir"/[0-9]*.md; do
  if [[ -e "$lane_file" ]]; then
    emit_lane "$lane_file"
  fi
done

if [[ -n "$profile_lanes_dir" && -d "$profile_lanes_dir" ]]; then
  for lane_file in "$profile_lanes_dir"/*.md; do
    if [[ -e "$lane_file" ]]; then
      lane_name="${lane_file##*/}"
      if [[ ! "$lane_name" =~ ^[0-9][0-9]-[a-z0-9][a-z0-9-]*\.md$ ]]; then
        echo "error: custom lane filename must be NN-lowercase-id.md: ${lane_name}" >&2
        exit 1
      fi
      if [[ "$profile_source" == "merge-base snapshot" ]]; then
        lane_source_hint="git show ${merge_base}:${profile_lanes_rel}/${lane_name}"
      else
        lane_source_hint="$lane_file"
      fi
      emit_lane "$lane_file"
    fi
  done
fi
lane_source_hint=""

echo
echo "Large changed files at head"
large_found=0
index=0
while [[ "$index" -lt "$changed_count" ]]; do
  changed_path="${changed_files[$index]}"
  index=$((index + 1))

  if ! git cat-file -e "${head_commit}:${changed_path}" 2>/dev/null; then
    continue
  fi

  case "$changed_path" in
    *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.py|*.rb|*.go|*.rs|*.java|*.kt|*.cs|*.php|*.sh|*.prisma|*.sql|*.test.*|*.spec.*)
      head_lines="$(git show "${head_commit}:${changed_path}" | wc -l | tr -d ' ')"
      if [[ "$head_lines" -ge 400 ]]; then
        base_lines=0
        if git cat-file -e "${merge_base}:${changed_path}" 2>/dev/null; then
          base_lines="$(git show "${merge_base}:${changed_path}" | wc -l | tr -d ' ')"
        fi
        printf -- '- %q: %s -> %s lines\n' "$changed_path" "$base_lines" "$head_lines"
        large_found=1
      fi
      ;;
  esac
done

if [[ "$large_found" -eq 0 ]]; then
  echo "(none at or above 400 lines)"
fi

echo
echo "Next step"
echo "Use this manifest to select review lanes; verify every candidate against code and contract evidence before reporting it."
