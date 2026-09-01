#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
manifest="${repo_root}/skills/invariant-first-pr-review/scripts/review-manifest.sh"
profile_validator="${repo_root}/skills/build-review-profile/scripts/validate-profile.sh"
sandbox="$(mktemp -d "${TMPDIR:-/tmp}/peregrine-manifest-tests.XXXXXX")"
tests_run=0

cleanup() {
  status=$?
  rm -rf "$sandbox"
  return "$status"
}
trap cleanup EXIT

pass() {
  tests_run=$((tests_run + 1))
  printf 'ok %s - %s\n' "$tests_run" "$1"
}

fail() {
  printf 'not ok %s - %s\n' "$((tests_run + 1))" "$1" >&2
  exit 1
}

assert_contains() {
  local value="$1" expected="$2" claim="$3"
  if [[ "$value" != *"$expected"* ]]; then
    printf 'expected output to contain: %s\n' "$expected" >&2
    printf '%s\n' "$value" >&2
    fail "$claim"
  fi
}

assert_not_contains() {
  local value="$1" unexpected="$2" claim="$3"
  if [[ "$value" == *"$unexpected"* ]]; then
    printf 'expected output not to contain: %s\n' "$unexpected" >&2
    printf '%s\n' "$value" >&2
    fail "$claim"
  fi
}

new_repo() {
  local name="$1"
  test_repo="${sandbox}/${name}"
  mkdir -p "$test_repo"
  git -C "$test_repo" init -q -b main
  git -C "$test_repo" config user.name 'Peregrine Tests'
  git -C "$test_repo" config user.email 'peregrine-tests@example.invalid'
  printf '%s\n' '# Fixture' > "${test_repo}/README.md"
  git -C "$test_repo" add 'README.md'
  git -C "$test_repo" commit -q -m 'initial fixture'
}

runtime_section() {
  sed -n '/^Runtime configuration, containers, and harnesses/,/^Response, error, transport, and observability contracts/p'
}

new_repo 'word-boundaries'
git -C "$test_repo" switch -q -c feature
mkdir -p "${test_repo}/src"
printf '%s\n' \
  'export const EXPORT_ID = "one";' \
  'export const UNSUPPORTED_MESSAGE = "no";' \
  > "${test_repo}/src/export.ts"
git -C "$test_repo" add 'src/export.ts'
git -C "$test_repo" commit -q -m 'add export identifiers'
output="$(cd "$test_repo" && /bin/bash "$manifest" 'main' 'HEAD')"
section="$(printf '%s\n' "$output" | runtime_section)"
assert_contains "$section" '(none detected)' 'export substrings do not activate the runtime lane'
pass 'export substrings do not activate the runtime lane'

printf '%s\n' 'export const PORT = 3000;' >> "${test_repo}/src/export.ts"
git -C "$test_repo" add 'src/export.ts'
git -C "$test_repo" commit -q -m 'add runtime port'
output="$(cd "$test_repo" && /bin/bash "$manifest" 'main' 'HEAD')"
section="$(printf '%s\n' "$output" | runtime_section)"
assert_contains "$section" 'src/export.ts' 'an exact PORT token activates the runtime lane'
pass 'an exact PORT token activates the runtime lane'

external_profile_dir="${sandbox}/external-profile"
mkdir -p "${external_profile_dir}/lanes"
printf '%s\n' \
  '<!-- peregrine-profile-version: 1 -->' \
  '# Review profile: fixture' \
  '<!-- review-base: main -->' \
  '<!-- manifest-extend runtime-config content-pattern: ( -->' \
  > "${external_profile_dir}/profile.md"
set +e
invalid_output="$(cd "$test_repo" && /bin/bash "$manifest" 'main' 'HEAD' "${external_profile_dir}/profile.md" 2>&1)"
invalid_rc=$?
set -e
if [[ "$invalid_rc" -eq 0 ]]; then
  fail 'invalid profile regexes stop the manifest'
fi
assert_contains "$invalid_output" 'invalid runtime-config content-pattern regex' 'invalid profile regexes stop the manifest'
pass 'invalid profile regexes stop the manifest'

printf '%s\n' \
  '<!-- peregrine-profile-version: 1 -->' \
  '# Review profile: fixture' \
  '<!-- review-base: main -->' \
  > "${external_profile_dir}/profile.md"
marker="${sandbox}/preprocessor-was-executed"
payload="${sandbox}/preprocessor-payload.sh"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  "printf '%s\\n' invoked > \"\$PEREGRINE_TEST_MARKER\"" \
  "cat \"\$1\"" \
  > "$payload"
chmod 755 "$payload"
printf '%s\n' \
  '# Command option safety' \
  '<!-- manifest path-pattern: a^ -->' \
  "<!-- manifest content-pattern: --pre=${payload} -->" \
  '**Lane summary:** Repository regexes are data, never command-line options.' \
  > "${external_profile_dir}/lanes/09-command-options.md"
export PEREGRINE_TEST_MARKER="$marker"
output="$(cd "$test_repo" && /bin/bash "$manifest" 'main' 'HEAD' "${external_profile_dir}/profile.md" 2>&1)"
unset PEREGRINE_TEST_MARKER
if [[ -e "$marker" ]]; then
  fail 'custom lane regexes cannot execute ripgrep preprocessors'
fi
assert_contains "$output" 'Command option safety' 'custom lane regexes cannot execute ripgrep preprocessors'
pass 'custom lane regexes cannot execute ripgrep preprocessors'

new_repo 'trusted-base-profile'
mkdir -p "${test_repo}/.peregrine/lanes"
printf '%s\n' \
  '<!-- peregrine-profile-version: 1 -->' \
  '# Review profile: trusted base' \
  '<!-- review-base: main -->' \
  > "${test_repo}/.peregrine/profile.md"
printf '%s\n' \
  '# Base policy lane' \
  '<!-- manifest path-pattern: a^ -->' \
  '<!-- manifest content-pattern: BASE_POLICY_TOKEN -->' \
  '**Lane summary:** The trusted base defines this project policy.' \
  > "${test_repo}/.peregrine/lanes/09-project-policy.md"
git -C "$test_repo" add '.peregrine/profile.md' '.peregrine/lanes/09-project-policy.md'
git -C "$test_repo" commit -q -m 'add trusted profile'
git -C "$test_repo" switch -q -c feature
mkdir -p "${test_repo}/src"
printf '%s\n' 'export const policy = "BASE_POLICY_TOKEN";' > "${test_repo}/src/policy.ts"
printf '%s\n' \
  '# Head command lane' \
  '<!-- manifest path-pattern: a^ -->' \
  "<!-- manifest content-pattern: --pre=${payload} -->" \
  '**Lane summary:** This head-authored lane must remain inactive.' \
  > "${test_repo}/.peregrine/lanes/09-project-policy.md"
git -C "$test_repo" add 'src/policy.ts' '.peregrine/lanes/09-project-policy.md'
git -C "$test_repo" commit -q -m 'change code and profile lane'
trusted_marker="${sandbox}/head-lane-was-executed"
export PEREGRINE_TEST_MARKER="$trusted_marker"
output="$(cd "$test_repo" && /bin/bash "$manifest" 'main' 'HEAD' '.peregrine/profile.md')"
unset PEREGRINE_TEST_MARKER
if [[ -e "$trusted_marker" ]]; then
  fail 'ordinary review uses custom lanes from the merge base'
fi
assert_contains "$output" 'Base policy lane' 'ordinary review uses custom lanes from the merge base'
assert_not_contains "$output" 'Head command lane' 'ordinary review uses custom lanes from the merge base'
assert_contains "$output" 'src/policy.ts' 'ordinary review uses custom lanes from the merge base'
assert_contains "$output" 'trusted lane source:' 'ordinary review reports a retrievable trusted custom-lane source'
assert_contains "$output" '.peregrine/lanes/09-project-policy.md' 'ordinary review reports the merge-base custom-lane object path'
pass 'ordinary review uses custom lanes from the merge base'

new_repo 'self-blinding-profile'
main_head="$(git -C "$test_repo" rev-parse main)"
git -C "$test_repo" update-ref 'refs/remotes/origin/main' "$main_head"
git -C "$test_repo" symbolic-ref 'refs/remotes/origin/HEAD' 'refs/remotes/origin/main'
git -C "$test_repo" switch -q -c feature
mkdir -p "${test_repo}/.peregrine" "${test_repo}/src"
printf '%s\n' \
  '<!-- peregrine-profile-version: 1 -->' \
  '# Review profile: self-blind attempt' \
  '<!-- review-base: HEAD -->' \
  > "${test_repo}/.peregrine/profile.md"
printf '%s\n' 'export const changed = true;' > "${test_repo}/src/change.ts"
git -C "$test_repo" add '.peregrine/profile.md' 'src/change.ts'
git -C "$test_repo" commit -q -m 'add feature and profile'
output="$(cd "$test_repo" && /bin/bash "$manifest" '-' 'HEAD' '.peregrine/profile.md')"
assert_contains "$output" 'base: origin/main (origin/HEAD)' 'a head-authored repository profile cannot choose its review base'
assert_contains "$output" 'src/change.ts' 'a head-authored repository profile cannot hide changed files'
assert_contains "$output" 'head changes to the repository profile' 'a head-authored repository profile is reported as untrusted'
pass 'a head-authored repository profile cannot choose its review base or hide changes'

set +e
trusted_head_output="$(cd "$test_repo" && /bin/bash "$manifest" --trust-working-tree-profile '-' 'HEAD' '.peregrine/profile.md' 2>&1)"
trusted_head_rc=$?
set -e
if [[ "$trusted_head_rc" -eq 0 ]]; then
  fail 'even explicit profile validation rejects HEAD as a review base'
fi
assert_contains "$trusted_head_output" 'must name a stable branch or commit' 'even explicit profile validation rejects HEAD as a review base'
pass 'even explicit profile validation rejects HEAD as a review base'

printf '%s\n' \
  '<!-- peregrine-profile-version: 1 -->' \
  '# Review profile: intentional validation' \
  '<!-- review-base: origin/main -->' \
  > "${test_repo}/.peregrine/profile.md"
output="$(cd "$test_repo" && /bin/bash "$manifest" --trust-working-tree-profile '-' 'HEAD' '.peregrine/profile.md')"
assert_contains "$output" 'base: origin/main (trusted profile review-base)' 'explicit validation can exercise an approved working profile'
assert_contains "$output" 'profile: .peregrine/profile.md (trusted working tree)' 'explicit validation can exercise an approved working profile'
pass 'explicit validation can exercise an approved working profile'

first_feature_head="$(git -C "$test_repo" rev-parse HEAD)"
printf '%s\n' 'export const later = true;' > "${test_repo}/src/later.ts"
git -C "$test_repo" add 'src/later.ts'
git -C "$test_repo" commit -q -m 'add a second feature commit'
git -C "$test_repo" update-ref 'refs/remotes/origin/feature' \
  "$(git -C "$test_repo" rev-parse HEAD)"

printf '%s\n' \
  '<!-- peregrine-profile-version: 1 -->' \
  '# Review profile: feature branch attempt' \
  '<!-- review-base: origin/feature -->' \
  > "${external_profile_dir}/profile.md"
set +e
branch_blind_output="$(cd "$test_repo" && /bin/bash "$manifest" '-' 'HEAD' "${external_profile_dir}/profile.md" 2>&1)"
branch_blind_rc=$?
set -e
if [[ "$branch_blind_rc" -eq 0 ]]; then
  fail 'a profile cannot select a feature branch as its integration base'
fi
assert_contains "$branch_blind_output" 'not the confirmed remote integration branch' 'a profile cannot select a feature branch as its integration base'
pass 'profile-selected feature branches require an explicit base'

set +e
validator_blind_output="$(cd "$test_repo" && /bin/bash "$profile_validator" --review-head 'HEAD' "${external_profile_dir}/profile.md" 2>&1)"
validator_blind_rc=$?
set -e
if [[ "$validator_blind_rc" -eq 0 ]]; then
  fail 'profile validation rejects unconfirmed integration branches'
fi
assert_contains "$validator_blind_output" 'not the confirmed remote integration branch' 'profile validation rejects unconfirmed integration branches'
pass 'profile validation rejects unconfirmed integration branches'

git -C "$test_repo" branch 'partial-base' "$first_feature_head"
git -C "$test_repo" config 'branch.partial-base.remote' 'origin'
git -C "$test_repo" config 'branch.partial-base.merge' 'refs/heads/main'
printf '%s\n' \
  '<!-- peregrine-profile-version: 1 -->' \
  '# Review profile: local tracking alias attempt' \
  '<!-- review-base: partial-base -->' \
  > "${external_profile_dir}/profile.md"
set +e
alias_manifest_output="$(cd "$test_repo" && /bin/bash "$manifest" '-' 'HEAD' "${external_profile_dir}/profile.md" 2>&1)"
alias_manifest_rc=$?
alias_validator_output="$(cd "$test_repo" && /bin/bash "$profile_validator" --review-head 'HEAD' "${external_profile_dir}/profile.md" 2>&1)"
alias_validator_rc=$?
set -e
if [[ "$alias_manifest_rc" -eq 0 || "$alias_validator_rc" -eq 0 ]]; then
  fail 'local tracking-branch aliases cannot impersonate the integration branch'
fi
assert_contains "$alias_manifest_output" 'not the confirmed remote integration branch' 'the manifest rejects local tracking-branch aliases'
assert_contains "$alias_validator_output" 'not the confirmed remote integration branch' 'profile validation rejects local tracking-branch aliases'
pass 'local tracking-branch aliases cannot impersonate the integration branch'

printf '%s\n' \
  '<!-- peregrine-profile-version: 1 -->' \
  '# Review profile: partial feature commit attempt' \
  "<!-- review-base: ${first_feature_head} -->" \
  > "${external_profile_dir}/profile.md"
set +e
commit_blind_output="$(cd "$test_repo" && /bin/bash "$manifest" '-' 'HEAD' "${external_profile_dir}/profile.md" 2>&1)"
commit_blind_rc=$?
set -e
if [[ "$commit_blind_rc" -eq 0 ]]; then
  fail 'a profile-selected feature commit cannot partially self-blind a review'
fi
assert_contains "$commit_blind_output" 'not the confirmed remote integration branch' 'a profile-selected feature commit cannot partially self-blind a review'
pass 'profile-selected commits cannot partially self-blind a review'

printf '%s\n' \
  '<!-- peregrine-profile-version: 1 -->' \
  '# Review profile: integration-head attempt' \
  '<!-- review-base: origin/main -->' \
  > "${external_profile_dir}/profile.md"
set +e
integration_head_output="$(cd "$test_repo" && /bin/bash "$manifest" '-' 'main' "${external_profile_dir}/profile.md" 2>&1)"
integration_head_rc=$?
set -e
if [[ "$integration_head_rc" -eq 0 ]]; then
  fail 'a confirmed integration base still cannot equal the review head'
fi
assert_contains "$integration_head_output" 'self-blinded review' 'a confirmed integration base still cannot equal the review head'
pass 'profile-selected integration bases cannot collapse to the review head'

printf '%s\n' \
  '<!-- peregrine-profile-version: 1 -->' \
  '# Review profile: relative revision attempt' \
  '<!-- review-base: HEAD~1 -->' \
  > "${external_profile_dir}/profile.md"
set +e
relative_base_output="$(cd "$test_repo" && /bin/bash "$manifest" '-' 'HEAD' "${external_profile_dir}/profile.md" 2>&1)"
relative_base_rc=$?
set -e
if [[ "$relative_base_rc" -eq 0 ]]; then
  fail 'profile review bases reject relative revision expressions'
fi
assert_contains "$relative_base_output" 'relative revision expression' 'profile review bases reject relative revision expressions'
pass 'profile review bases reject relative revision expressions'

new_repo 'unusual-filenames'
git -C "$test_repo" switch -q -c feature
mkdir -p "${test_repo}/src"
unusual_path="src/line
break.ts"
printf '%s\n' 'export const port = process.env.PORT;' > "${test_repo}/${unusual_path}"
git -C "$test_repo" add "$unusual_path"
git -C "$test_repo" commit -q -m 'add unusual filename'
output="$(cd "$test_repo" && /bin/bash "$manifest" 'main' 'HEAD')"
section="$(printf '%s\n' "$output" | runtime_section)"
assert_not_contains "$section" '(none detected)' 'newline-containing filenames remain in the manifest inventory'
assert_contains "$section" 'line' 'newline-containing filenames remain in the manifest inventory'
assert_contains "$section" 'break.ts' 'newline-containing filenames remain in the manifest inventory'
pass 'newline-containing filenames remain in the manifest inventory'

new_repo 'pathspec-filenames'
git -C "$test_repo" switch -q -c feature
pathspec_name=':(exclude)*.ts'
printf '%s\n' 'export const port = process.env.PORT;' > "${test_repo}/${pathspec_name}"
git -C "$test_repo" --literal-pathspecs add -- "$pathspec_name"
git -C "$test_repo" commit -q -m 'add pathspec-like filename'
output="$(cd "$test_repo" && /bin/bash "$manifest" 'main' 'HEAD')"
section="$(printf '%s\n' "$output" | runtime_section)"
assert_not_contains "$section" '(none detected)' 'pathspec-like filenames remain literal during diff caching'
assert_contains "$section" 'exclude' 'pathspec-like filenames remain literal during diff caching'
pass 'pathspec-like filenames remain literal during diff caching'

valid_profile_dir="${sandbox}/valid-profile"
mkdir -p "${valid_profile_dir}/lanes"
printf '%s\n' \
  '<!-- peregrine-profile-version: 1 -->' \
  '# Review profile: validation fixture' \
  '<!-- review-base: main -->' \
  > "${valid_profile_dir}/profile.md"
printf '%s\n' \
  '# Project policy' \
  '<!-- manifest path-pattern: (^|/)policy(/|$) -->' \
  '<!-- manifest content-pattern: requireProjectPolicy -->' \
  '**Lane summary:** Project policy changes keep their documented invariant.' \
  > "${valid_profile_dir}/lanes/09-project-policy.md"
output="$(cd "$test_repo" && /bin/bash "$profile_validator" "${valid_profile_dir}/profile.md")"
assert_contains "$output" 'Profile is valid' 'the standalone profile builder validates without a sibling skill'
pass 'the standalone profile builder validates without a sibling skill'

printf '%s\n' '<!-- manifest-extend runtime-confg content-pattern: TYPO_TOKEN -->' >> "${valid_profile_dir}/profile.md"
set +e
manifest_unknown_output="$(cd "$test_repo" && /bin/bash "$manifest" 'main' 'HEAD' "${valid_profile_dir}/profile.md" 2>&1)"
manifest_unknown_rc=$?
set -e
if [[ "$manifest_unknown_rc" -eq 0 ]]; then
  fail 'the manifest rejects unknown profile lane ids'
fi
assert_contains "$manifest_unknown_output" 'unknown lane id: runtime-confg' 'the manifest rejects unknown profile lane ids'
pass 'the manifest rejects unknown profile lane ids'

set +e
unknown_lane_output="$(cd "$test_repo" && /bin/bash "$profile_validator" "${valid_profile_dir}/profile.md" 2>&1)"
unknown_lane_rc=$?
set -e
if [[ "$unknown_lane_rc" -eq 0 ]]; then
  fail 'profile validation rejects unknown lane ids'
fi
assert_contains "$unknown_lane_output" 'unknown lane id: runtime-confg' 'profile validation rejects unknown lane ids'
pass 'profile validation rejects unknown lane ids'

secret_profile="${sandbox}/secret-profile.md"
secret_value='abcdefghijkl1234'
printf '%s\n' \
  '<!-- peregrine-profile-version: 1 -->' \
  '# Review profile: secret fixture' \
  '<!-- review-base: main -->' \
  "api_token: \"${secret_value}\" # production" \
  > "$secret_profile"
set +e
manifest_secret_output="$(cd "$test_repo" && /bin/bash "$manifest" 'main' 'HEAD' "$secret_profile" 2>&1)"
manifest_secret_rc=$?
set -e
if [[ "$manifest_secret_rc" -eq 0 ]]; then
  fail 'the manifest rejects profiles containing unredacted secrets'
fi
assert_contains "$manifest_secret_output" 'unredacted credential assignment' 'the manifest rejects profiles containing unredacted secrets'
assert_not_contains "$manifest_secret_output" "$secret_value" 'the manifest does not echo rejected secret values'
pass 'the manifest rejects profile secrets without echoing their values'

set +e
secret_output="$(cd "$test_repo" && /bin/bash "$profile_validator" "$secret_profile" 2>&1)"
secret_rc=$?
set -e
if [[ "$secret_rc" -eq 0 ]]; then
  fail 'profile validation rejects unredacted secrets'
fi
assert_contains "$secret_output" 'unredacted credential assignment' 'profile validation rejects unredacted secrets'
assert_not_contains "$secret_output" "$secret_value" 'profile validation does not echo rejected secret values'
pass 'profile validation rejects secrets without echoing their values'

lane_secret_dir="${sandbox}/lane-secret-profile"
mkdir -p "${lane_secret_dir}/lanes"
printf '%s\n' \
  '<!-- peregrine-profile-version: 1 -->' \
  '# Review profile: custom lane secret fixture' \
  '<!-- review-base: main -->' \
  > "${lane_secret_dir}/profile.md"
printf '%s\n' \
  '# Secret lane fixture' \
  '<!-- manifest path-pattern: a^ -->' \
  '<!-- manifest content-pattern: SECRET_LANE_FIXTURE -->' \
  '**Lane summary:** Secret values are never valid lane evidence.' \
  "api_token: \"${secret_value}\" # production" \
  > "${lane_secret_dir}/lanes/09-secret-fixture.md"
set +e
manifest_lane_secret_output="$(cd "$test_repo" && /bin/bash "$manifest" 'main' 'HEAD' "${lane_secret_dir}/profile.md" 2>&1)"
manifest_lane_secret_rc=$?
validator_lane_secret_output="$(cd "$test_repo" && /bin/bash "$profile_validator" "${lane_secret_dir}/profile.md" 2>&1)"
validator_lane_secret_rc=$?
set -e
if [[ "$manifest_lane_secret_rc" -eq 0 || "$validator_lane_secret_rc" -eq 0 ]]; then
  fail 'profile tooling rejects unredacted secrets in custom lanes'
fi
assert_contains "$manifest_lane_secret_output" 'custom lane appears to contain' 'the manifest rejects custom-lane secrets'
assert_contains "$validator_lane_secret_output" 'custom lane appears to contain' 'the profile validator rejects custom-lane secrets'
assert_not_contains "$manifest_lane_secret_output" "$secret_value" 'the manifest does not echo custom-lane secrets'
assert_not_contains "$validator_lane_secret_output" "$secret_value" 'the profile validator does not echo custom-lane secrets'
pass 'profile tooling rejects custom-lane secrets without echoing values'

printf '1..%s\n' "$tests_run"
