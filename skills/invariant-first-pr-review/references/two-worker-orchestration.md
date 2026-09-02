# Two-Worker Orchestration

Interactive Peregrine reviews use two sequential workers by default. The
calling agent is a coordinator, not either review worker.

## Required topology

1. Resolve the requested breadth and investigation route from
   `invocation-routing.md`.
2. Prepare the pinned scope, trusted manifest, activated lanes, and bounded
   breadth context.
3. Launch one breadth worker with `breadth-worker-packet.md` on the resolved
   breadth model and effort. Wait for its complete ledger.
4. Validate that every changed file is represented by a candidate, `CLEAR`, or
   unavailable-coverage entry.
5. Launch one new investigation worker with
   `investigation-worker-packet.md` on the resolved investigation model and
   effort. Give it the frozen breadth ledger plus the pinned evidence packet.
6. Wait for the investigation result. The coordinator may check formatting,
   refresh mutable PR metadata, and render the result, but must not replace,
   supplement, or silently redo investigation itself.

The workers are sequential because the investigator must receive the frozen
breadth ledger. Do not run them in parallel and do not count the coordinator as
one of the two workers.

## Role isolation

Every delegated prompt must identify exactly one role:

- `PEREGRINE_ROLE: breadth-worker`
- `PEREGRINE_ROLE: investigation-worker`

A role-tagged worker must execute its packet directly. It must not invoke
Peregrine again, spawn another review worker, or become the coordinator. This
prevents recursive delegation when a worker can also see the installed skill.

For Codex, use a bounded fork that permits the requested child model and effort
rather than a full-history fork that inherits the coordinator's route. Send the
minimum complete packet explicitly. Use the equivalent isolated-agent controls
on Claude when available.

## Routing failure

Preserve the two-worker topology when a requested model or effort is
unavailable: launch that stage as a separate worker on the closest available or
current model, and report the requested and actual route. Never absorb a worker
stage into the coordinator merely because model override is unavailable.

If the host cannot launch two separate workers at all, stop before review
judgment and report that the interactive two-worker contract could not be
satisfied. Recommend the automated runner, which already starts isolated
breadth and investigation processes. Do not describe a coordinator-run pass as
a two-worker Peregrine review.

## Coordinator output

Coverage confirmation must record:

- coordinator model when exposed;
- requested and actual breadth model and effort;
- requested and actual investigation model and effort;
- confirmation that two distinct workers ran sequentially;
- every routing fallback or unavailable worker capability.
