---
name: peregrine-review
description: Run Peregrine's invariant-first PR review with native Cursor breadth and investigation subagents.
---

Run the `invariant-first-pr-review` skill for the requested pull request or branch.

In Cursor, keep the current agent coordinator-only and use the native Peregrine subagents in this exact sequence:

1. Resolve scope, routing, the trusted manifest, activated lanes, and bounded breadth context from the shared skill.
2. Invoke `peregrine-breadth` in the foreground. Its task must begin with `PEREGRINE_ROLE: breadth-worker` and include the complete bounded breadth worker packet.
3. Wait for the breadth result. Freeze and validate its ledger so every changed file is represented by a candidate, `CLEAR`, or unavailable-coverage entry.
4. Invoke a new `peregrine-investigation` worker in the foreground. Its task must begin with `PEREGRINE_ROLE: investigation-worker` and include the investigation packet, pinned evidence, and frozen breadth ledger.
5. Wait for the investigation result, then render the shared skill's required output. Do not perform either review pass in the coordinator.

Cursor defaults are `composer-2.5[]` for breadth and `grok-4.6[effort=xhigh]` for investigation. If Cursor falls back because a model is unavailable or restricted, preserve two distinct sequential workers and report requested versus actual routing. If Cursor cannot launch both workers, stop before review judgment rather than silently absorbing a stage into the coordinator.
