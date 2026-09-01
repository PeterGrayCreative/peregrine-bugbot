# Install Peregrine from GitHub

The canonical Peregrine source is
[`PeterGrayCreative/peregrine-bugbot`](https://github.com/PeterGrayCreative/peregrine-bugbot).
For normal use, install the plugin directly from that GitHub repository. You do
not need to clone the repository or copy either skill by hand.

The plugin ID is `peregrine@peregrine`:

- the first `peregrine` is the plugin name;
- the second `peregrine` is the marketplace name.

The plugin installs both shared skills:

- `invariant-first-pr-review`
- `build-review-profile`

## Update policy

The native Codex and Claude installations below track the canonical `main`
branch, so treat it as a moving source. The explicit update commands below
refresh the local marketplace and plugin caches. Host-level automatic-update
settings may refresh them at startup as well.

## Prerequisites

Install at least one supported host and confirm that its CLI includes plugin
management:

```bash
codex --version
codex plugin --help
```

or:

```bash
claude --version
claude plugin --help
```

The repository is public, so installing it does not require a GitHub token. The
host still needs its normal Codex or Claude authentication before it can perform
a review. If `plugin` is not a recognized command, update the host CLI using its
official installation instructions before continuing.

Host documentation:

- [Codex plugin packaging and marketplace commands](https://developers.openai.com/plugins/build/plugins)
- [Claude Code installation](https://code.claude.com/docs/en/installation)
- [Claude Code plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)

Before installing, remove or move any loose copies of
`invariant-first-pr-review` and `build-review-profile` from the host's skill
directories. The plugin and loose skills must not coexist under the same names.
See [Migrate a copied-skill installation](#migrate-a-copied-skill-installation)
if Peregrine was installed by copying folders in the past.

## Install in Codex

Register the GitHub repository as a Codex marketplace, then install Peregrine
from that marketplace:

```bash
codex plugin marketplace add PeterGrayCreative/peregrine-bugbot --ref main
codex plugin add peregrine@peregrine
```

Verify both the source and the installed plugin:

```bash
codex plugin marketplace list
codex plugin list
```

The marketplace list should contain `peregrine`, and the plugin list should
show `peregrine@peregrine` as installed and enabled. Restart Codex or start a
new task so the newly installed skills are loaded.

## Install in Claude Code

Register the GitHub repository as a Claude marketplace, then install Peregrine
at user scope:

```bash
claude plugin marketplace add PeterGrayCreative/peregrine-bugbot@main
claude plugin install peregrine@peregrine --scope user
```

Verify both the source and the installed plugin:

```bash
claude plugin marketplace list --json
claude plugin list
```

The marketplace list should contain `peregrine`, and the plugin list should
show `peregrine@peregrine` as installed and enabled. Restart Claude Code or
start a new session so the newly installed skills are loaded.

`--scope user` makes Peregrine available across the current user's projects.
Claude also supports `project` and `local` scopes. Use those only when the
installation should be declared for a particular repository. For example, a
team-shared project declaration uses:

```bash
claude plugin marketplace add PeterGrayCreative/peregrine-bugbot@main --scope project
claude plugin install peregrine@peregrine --scope project
```

Use `local` in both commands for a private, repository-specific installation.
Use the same scope for later plugin update or uninstall commands.

## Install in both hosts

The Codex and Claude installations are independent. To use Peregrine in both,
run both sets of commands:

```bash
codex plugin marketplace add PeterGrayCreative/peregrine-bugbot --ref main
codex plugin add peregrine@peregrine

claude plugin marketplace add PeterGrayCreative/peregrine-bugbot@main
claude plugin install peregrine@peregrine --scope user
```

Installing in one host does not install or update the other host.

## Update an installation that tracks `main`

Updating has two parts: refresh the marketplace snapshot, then refresh the
installed plugin from that snapshot.

Codex:

```bash
codex plugin marketplace upgrade peregrine
codex plugin add peregrine@peregrine
```

Claude Code:

```bash
claude plugin marketplace update peregrine
claude plugin update peregrine@peregrine --scope user
```

Restart the updated host or start a new task/session afterward. Use the same
verification commands from the installation section to confirm the active
source and version.

If you cloned this repository for development, the package scripts execute the
same commands:

```bash
npm run plugin:update:codex
npm run plugin:update:claude
```

The package scripts are conveniences, not a requirement for a GitHub install.

For reproducible GitHub Actions use, pin the reusable workflow to a release tag
or commit SHA as shown in the root [README](../README.md#github-actions). The
native cross-host plugin distribution intentionally follows `main`.

## Reset an installation

Remove both the installed plugin and its marketplace registration before
reinstalling from a corrected source.

Codex:

```bash
codex plugin remove peregrine@peregrine
codex plugin marketplace remove peregrine
```

Claude Code:

```bash
claude plugin uninstall peregrine@peregrine --scope user
claude plugin marketplace remove peregrine --scope user
```

If Claude was installed at `project` or `local` scope, substitute that scope in
both commands.

## Migrate a copied-skill installation

Older Peregrine versions could be installed as loose skill folders. Common
locations include:

```text
~/.agents/skills/invariant-first-pr-review
~/.agents/skills/build-review-profile
~/.codex/skills/invariant-first-pr-review
~/.codex/skills/build-review-profile
~/.claude/skills/invariant-first-pr-review
~/.claude/skills/build-review-profile
```

Some of these directories may be symlinked to one another. Resolve the actual
paths before changing anything, compare any local edits, and move the old
folders to a recoverable backup rather than merging them into the plugin cache.
Then install the plugin and start a new host session.

If this repository is already cloned, run the built-in diagnostic before and
after migration:

```bash
npm run doctor
```

The expected result is that both skills are installed through
`peregrine@peregrine` and are not also present as loose directories.

## Uninstall

Codex:

```bash
codex plugin remove peregrine@peregrine
codex plugin marketplace remove peregrine
```

Claude Code:

```bash
claude plugin uninstall peregrine@peregrine --scope user
claude plugin marketplace remove peregrine --scope user
```

If Claude was installed at `project` or `local` scope, substitute that scope in
both commands.

## Clone the repository for development or the review runtime

The native plugin install supplies the two interactive skills. Clone the
repository only when you also want to develop Peregrine, run its Node review
or evaluation commands locally, or inspect and customize its reusable GitHub
Actions workflow:

```bash
git clone https://github.com/PeterGrayCreative/peregrine-bugbot.git
cd peregrine-bugbot
nvm install '22'
nvm use '22'
npm ci
npm run validate
npm run doctor
```

From a clone, first-time installation can also use the wrappers:

```bash
npm run plugin:install:codex
npm run plugin:install:claude
```

Those wrappers install from the canonical GitHub `main` branch, not from the
working-tree files. For Claude-only development against uncommitted local
changes, load the checkout explicitly:

```bash
claude --plugin-dir '/absolute/path/to/peregrine-bugbot'
```

Do not combine that development session with a second loose copy of the same
skills.

### Compatibility copy for hosts without plugin support

The repository retains a guarded copy installer for older or restricted hosts
that cannot consume a Git-backed marketplace. From a validated clone, choose
one host:

```bash
bash 'scripts/install-local.sh' --client codex --scope personal
bash 'scripts/install-local.sh' --client claude --scope personal
```

Use only the command for the intended host. This fallback preflights both skill
folders and refuses to merge over an existing installation. It does not have
the native marketplace update path: migrate to the plugin commands as soon as
the host supports them.

## Troubleshooting

### `plugin` is not a recognized command

The installed Codex or Claude CLI predates native plugin management. Update the
host CLI, reopen the terminal, and confirm `codex plugin --help` or
`claude plugin --help` before retrying.

### The marketplace already exists

Do not add a duplicate. If it already tracks `main`, run the update commands
instead. If it tracks the wrong source or ref, follow
[Reset an installation](#reset-an-installation), then register the canonical
source again.

### The plugin installed but the skills do not appear

Run the host's marketplace and plugin list commands, confirm
`peregrine@peregrine` is installed and enabled, then restart the host or start
a new task/session. Also check for an older loose copy using the migration
section above.

### GitHub cannot be reached

Confirm that this URL is accessible from the same shell:

```text
https://github.com/PeterGrayCreative/peregrine-bugbot
```

Corporate network policy may block external marketplaces. Private forks also
require working Git credentials for that repository. Fix Git access first,
then repeat the marketplace command.

### An update still reports the old version

Confirm that the marketplace tracks the intended ref, refresh the marketplace,
update or reinstall the plugin, and restart the host.

## Canonical-source rule

Treat the GitHub repository as source and the host plugin directories as
replaceable caches. Make changes in the repository, validate and publish them,
then use the marketplace update commands. Do not edit cached plugin files or
maintain separate Claude- and Codex-only skill copies.
