# Cursor provider

Peregrine's Cursor integration is an interactive native Cursor Plugin adapter around the same shared review methodology used by Claude and Codex. It does not add a third Node review runner or duplicate the skill tree.

## Package layout

Cursor loads `.cursor-plugin/plugin.json` from the repository root. The manifest exposes:

- `skills/` as the canonical shared Peregrine skills;
- `cursor/agents/peregrine-breadth.md` as the first-pass worker;
- `cursor/agents/peregrine-investigation.md` as the strong verifier;
- `cursor/commands/peregrine-review.md` as the explicit Cursor review entrypoint.

The Cursor-specific files are kept outside the default `agents/` and `commands/` directories and are referenced explicitly from the manifest. That prevents Cursor-only agent definitions from being discovered by the Claude plugin while still reusing the root `skills/` tree.

## Native routing

The default Cursor topology is:

```text
Cursor chat / command — coordinator only
  -> peregrine-breadth
     model: composer-2.5[]
     readonly: true
  <- frozen candidate ledger
  -> peregrine-investigation
     model: grok-4.6[effort=xhigh]
     readonly: true
  <- verified review result
Cursor coordinator renders the report
```

Both workers are foreground subagents. They therefore run sequentially, which is required because the investigation worker receives the frozen breadth ledger.

Cursor custom subagents begin with clean context, so the coordinator must send each worker a complete self-contained packet. The role tags remain mandatory:

- `PEREGRINE_ROLE: breadth-worker`
- `PEREGRINE_ROLE: investigation-worker`

Neither worker may invoke Peregrine recursively or launch another review worker.

## Model fallback

Cursor may ignore a configured subagent model when the model is unavailable on the current plan, blocked by a team administrator, or restricted by legacy model settings. Peregrine must not silently claim the requested route ran.

Coverage confirmation records the requested and actual breadth and investigation models when Cursor exposes them. A model fallback does not relax the two-worker requirement: keep two distinct sequential workers. If Cursor cannot create both workers, stop before review judgment.

## Install and test locally

Until the repository is listed in the public Cursor Marketplace, test it from Cursor's local plugin directory. From a clone of this repository:

```bash
mkdir -p "$HOME/.cursor/plugins/local"
ln -s '/absolute/path/to/peregrine-bugbot' "$HOME/.cursor/plugins/local/peregrine"
```

Restart Cursor or run **Developer: Reload Window**, then open **Customize** and confirm that the Peregrine skills, two subagents, and `peregrine-review` command are visible.

For a non-symlinked installation, copy the repository into `$HOME/.cursor/plugins/local/peregrine` instead. A marketplace installation with the same plugin name takes precedence over a local copy.

## Invocation

Use the command when available:

```text
/peregrine-review review this pull request
```

The shared `invariant-first-pr-review` skill can also be invoked naturally. The skill's host-routing rules tell the coordinator to use the two named Cursor subagents.

Cursor's model frontmatter establishes the installed defaults. A per-request `peregrineRouting` override remains declarative input to the shared skill. If the active Cursor runtime can honor an exact worker override, use it; otherwise use the installed named-agent route as the fallback and report that the requested override was not available.

## Deliberate non-goals

This adapter does not:

- add Cursor as a `peregrine.config.json` Node runner;
- claim a scriptable `cursor plugin install` command that Cursor does not currently document;
- add hooks merely to duplicate the subagent contract;
- fork breadth or investigation packet text by host.

If automated CI execution is needed, continue using the existing Claude or Codex runner. Cursor here is the native interactive orchestration host.
