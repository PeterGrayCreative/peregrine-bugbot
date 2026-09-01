#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
sandbox="$(mktemp -d "${TMPDIR:-/tmp}/peregrine-package-tests.XXXXXX")"

cleanup() {
  status=$?
  rm -rf "$sandbox"
  return "$status"
}
trap cleanup EXIT

first_output="${sandbox}/first"
second_output="${sandbox}/second"
/bin/bash "${repo_root}/scripts/package-skills.sh" --output-dir "$first_output"
/bin/bash "${repo_root}/scripts/package-skills.sh" --output-dir "$second_output"

for skill in invariant-first-pr-review build-review-profile; do
  first_archive="${first_output}/${skill}.zip"
  second_archive="${second_output}/${skill}.zip"
  cmp "$first_archive" "$second_archive"
  entries="$(unzip -Z1 "$first_archive")"
  if [[ "$entries" != *"${skill}/SKILL.md"* ]]; then
    echo "error: ${skill} archive is missing SKILL.md" >&2
    exit 1
  fi
  if printf '%s\n' "$entries" | grep -E '(^|/)(\.DS_Store|\._[^/]*|__MACOSX)(/|$)' >/dev/null; then
    echo "error: ${skill} archive contains macOS metadata" >&2
    exit 1
  fi
  if printf '%s\n' "$entries" | grep -Ev "^${skill}/" >/dev/null; then
    echo "error: ${skill} archive has another top-level entry" >&2
    exit 1
  fi
done
echo 'ok 1 - repeated packaging produces identical clean Claude ZIPs'

install_dir="${sandbox}/install"
/bin/bash "${repo_root}/scripts/install-local.sh" --client claude --dest-dir "$install_dir"
for skill in invariant-first-pr-review build-review-profile; do
  if [[ ! -f "${install_dir}/${skill}/SKILL.md" ]]; then
    echo "error: matched install is missing ${skill}" >&2
    exit 1
  fi
done
echo 'ok 2 - a staged install writes both matched skills'

set +e
reinstall_output="$(/bin/bash "${repo_root}/scripts/install-local.sh" --client codex --dest-dir "$install_dir" 2>&1)"
reinstall_rc=$?
set -e
if [[ "$reinstall_rc" -ne 3 || "$reinstall_output" != *'destination already exists'* ]]; then
  echo "error: reinstall did not refuse both existing destinations" >&2
  exit 1
fi
echo 'ok 3 - reinstall refuses to merge into existing skills'

fake_home="${sandbox}/fake-home"
mkdir -p "$fake_home"
HOME="$fake_home" /bin/bash "${repo_root}/scripts/install-local.sh" \
  --client codex \
  --scope personal
for skill in invariant-first-pr-review build-review-profile; do
  if [[ ! -f "${fake_home}/.agents/skills/${skill}/SKILL.md" ]]; then
    echo "error: Codex personal scope did not use .agents/skills for ${skill}" >&2
    exit 1
  fi
done
echo 'ok 4 - Codex personal scope uses the portable user Agent Skills directory'

fake_project="${sandbox}/fake-project"
mkdir -p "$fake_project"
(
  cd "$fake_project"
  HOME="$fake_home" /bin/bash "${repo_root}/scripts/install-local.sh" \
    --client codex \
    --scope project
)
for skill in invariant-first-pr-review build-review-profile; do
  if [[ ! -f "${fake_project}/.agents/skills/${skill}/SKILL.md" ]]; then
    echo "error: Codex project scope did not use .agents/skills for ${skill}" >&2
    exit 1
  fi
done
echo 'ok 5 - Codex project scope uses the repository Agent Skills directory'

recovery_dir="${sandbox}/recovery"
mkdir -p "${recovery_dir}/.peregrine-install.fixture/staged"
for skill in invariant-first-pr-review build-review-profile; do
  cp -R -p "${repo_root}/skills/${skill}" \
    "${recovery_dir}/.peregrine-install.fixture/staged/"
done
touch "${recovery_dir}/.peregrine-install.fixture/READY"
mv "${recovery_dir}/.peregrine-install.fixture/staged/invariant-first-pr-review" \
  "${recovery_dir}/invariant-first-pr-review"
recovery_output="$(/bin/bash "${repo_root}/scripts/install-local.sh" \
  --client codex \
  --dest-dir "$recovery_dir")"
if [[ "$recovery_output" != *'Recovered a matched Peregrine installation'* || \
      ! -f "${recovery_dir}/build-review-profile/SKILL.md" || \
      -e "${recovery_dir}/.peregrine-install.fixture" ]]; then
  echo 'error: installer did not recover an interrupted matched release' >&2
  exit 1
fi
echo 'ok 6 - interrupted matched installs recover idempotently'

forged_recovery_dir="${sandbox}/forged-recovery"
mkdir -p "${forged_recovery_dir}/.peregrine-install.forged/staged"
for skill in invariant-first-pr-review build-review-profile; do
  ln -s "${repo_root}/skills/${skill}" \
    "${forged_recovery_dir}/.peregrine-install.forged/staged/${skill}"
done
touch "${forged_recovery_dir}/.peregrine-install.forged/READY"
set +e
forged_recovery_output="$(/bin/bash "${repo_root}/scripts/install-local.sh" \
  --client codex \
  --dest-dir "$forged_recovery_dir" 2>&1)"
forged_recovery_rc=$?
set -e
if [[ "$forged_recovery_rc" -ne 4 || \
      "$forged_recovery_output" != *'contains symbolic links'* || \
      -e "${forged_recovery_dir}/invariant-first-pr-review" || \
      -e "${forged_recovery_dir}/build-review-profile" ]]; then
  echo 'error: installer trusted a forged symlink recovery transaction' >&2
  exit 1
fi

tampered_recovery_dir="${sandbox}/tampered-recovery"
mkdir -p "${tampered_recovery_dir}/.peregrine-install.tampered/staged"
for skill in invariant-first-pr-review build-review-profile; do
  cp -R -p "${repo_root}/skills/${skill}" \
    "${tampered_recovery_dir}/.peregrine-install.tampered/staged/"
done
printf '%s\n' 'tampered' >> \
  "${tampered_recovery_dir}/.peregrine-install.tampered/staged/build-review-profile/SKILL.md"
touch "${tampered_recovery_dir}/.peregrine-install.tampered/READY"
set +e
tampered_recovery_output="$(/bin/bash "${repo_root}/scripts/install-local.sh" \
  --client codex \
  --dest-dir "$tampered_recovery_dir" 2>&1)"
tampered_recovery_rc=$?
set -e
if [[ "$tampered_recovery_rc" -ne 4 || \
      "$tampered_recovery_output" != *'does not match the current source release'* || \
      -e "${tampered_recovery_dir}/invariant-first-pr-review" || \
      -e "${tampered_recovery_dir}/build-review-profile" ]]; then
  echo 'error: installer trusted a tampered staged recovery transaction' >&2
  exit 1
fi

mismatched_recovery_dir="${sandbox}/mismatched-recovery"
mkdir -p "${mismatched_recovery_dir}/.peregrine-install.mismatched/staged"
for skill in invariant-first-pr-review build-review-profile; do
  cp -R -p "${repo_root}/skills/${skill}" \
    "${mismatched_recovery_dir}/.peregrine-install.mismatched/staged/"
done
touch "${mismatched_recovery_dir}/.peregrine-install.mismatched/READY"
mv "${mismatched_recovery_dir}/.peregrine-install.mismatched/staged/invariant-first-pr-review" \
  "${mismatched_recovery_dir}/invariant-first-pr-review"
printf '%s\n' 'old release' >> \
  "${mismatched_recovery_dir}/invariant-first-pr-review/SKILL.md"
set +e
mismatched_recovery_output="$(/bin/bash "${repo_root}/scripts/install-local.sh" \
  --client codex \
  --dest-dir "$mismatched_recovery_dir" 2>&1)"
mismatched_recovery_rc=$?
set -e
if [[ "$mismatched_recovery_rc" -ne 4 || \
      "$mismatched_recovery_output" != *'partially published install does not match'* ]]; then
  echo 'error: installer trusted a mismatched partially published release' >&2
  exit 1
fi
echo 'ok 7 - recovery rejects forged, tampered, and mismatched transactions'

shared_skills_dir="${sandbox}/shared-skills"
linked_skills_dir="${sandbox}/linked-claude-skills"
mkdir "$shared_skills_dir"
ln -s "$shared_skills_dir" "$linked_skills_dir"
linked_install_output="$(/bin/bash "${repo_root}/scripts/install-local.sh" \
  --client claude \
  --dest-dir "$linked_skills_dir")"
shared_skills_real="$(cd "$shared_skills_dir" && pwd -P)"
for skill in invariant-first-pr-review build-review-profile; do
  diff -qr "${repo_root}/skills/${skill}" "${shared_skills_dir}/${skill}"
done
if [[ ! -L "$linked_skills_dir" || \
      "$linked_install_output" != *"${shared_skills_real}/invariant-first-pr-review"* || \
      "$linked_install_output" != *"${shared_skills_real}/build-review-profile"* ]]; then
  echo 'error: installer did not preserve and resolve a shared destination symlink' >&2
  exit 1
fi
echo 'ok 8 - shared destination symlinks remain supported and explicit'

symlink_package="${sandbox}/symlink-package"
cp -R "$repo_root" "$symlink_package"
external_target="${sandbox}/external-target.md"
printf '%s\n' 'outside package' > "$external_target"
ln -s "$external_target" \
  "${symlink_package}/skills/build-review-profile/references/external.md"

set +e
symlink_validate_output="$(/bin/bash "${symlink_package}/scripts/validate.sh" 2>&1)"
symlink_validate_rc=$?
symlink_package_output="$(/bin/bash "${symlink_package}/scripts/package-skills.sh" \
  --output-dir "${sandbox}/symlink-dist" 2>&1)"
symlink_package_rc=$?
symlink_install_output="$(/bin/bash "${symlink_package}/scripts/install-local.sh" \
  --client claude \
  --dest-dir "${sandbox}/symlink-install" 2>&1)"
symlink_install_rc=$?
set -e
if [[ "$symlink_validate_rc" -eq 0 || "$symlink_package_rc" -eq 0 || \
      "$symlink_install_rc" -eq 0 || \
      "$symlink_validate_output" != *'must not contain symbolic links'* || \
      "$symlink_package_output" != *'must not contain symbolic links'* || \
      "$symlink_install_output" != *'must not contain symbolic links'* ]]; then
  echo 'error: one or more package surfaces accepted a source symlink' >&2
  exit 1
fi
if [[ "$(sed -n '1p' "$external_target")" != 'outside package' ]]; then
  echo 'error: symlink rejection modified an external target' >&2
  exit 1
fi
echo 'ok 9 - validation, packaging, and installation reject source symlinks'

echo '1..9'
