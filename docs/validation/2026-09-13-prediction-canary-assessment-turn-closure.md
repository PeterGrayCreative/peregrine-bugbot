# Canary assessment v4: one turn and complete item closure

Independent review rejected public `28493e9` and private `102ccd2`: a missing or
duplicate `turn.started` and unfinished non-MCP items could pass v3. Both rejected
ancestors and all prior evidence remain immutable.

The v4 gate requires exactly one `thread.started`, then one `turn.started`, all
item events, and one final `turn.completed`. Every started item, of any type, must
complete before that terminal. Existing global ID ownership, same-type lifecycle,
read identity, search authentication and token-evidence checks are unchanged.

The [official non-interactive JSONL example](https://learn.chatgpt.com/docs/non-interactive-mode#make-output-machine-readable)
shows an `agent_message` completion without a preceding item start. V4 retains
that narrow exception, not a blanket exception for reasoning or bookkeeping.
Completion-only variants of those other types fail closed. This documentation
check is not authenticated proof of the pinned 0.152 client or its full catalog;
actual client observations remain required and unknown support is not inferred.

Twelve turn-boundary mutations cover missing/duplicate/misordered starts,
missing/duplicate/early terminals and post-terminal items. Eight controls cover
unfinished started/updated items across all four permitted non-MCP types; three
more reject unestablished completion-only variants. All mutations synchronize
raw stream, terminal token-event digest and authenticated inventory. The unchanged
predecessor fails all three new groups (10/13 focused groups pass). Exact source
and logs are retained in additive private `canary-assessment-v4/`.
Successor Node22 typecheck, all 13 focused groups, 65 prediction, 13 HTTP and
101 affected reader/runtime/engine tests, plus diff checks, passed.

Retro: validating ID ownership and read closure did not establish a closed turn.
The missed invariant was one complete turn enclosing every item lifecycle.
Tests now independently mutate each boundary and each non-MCP completion.

No provider/client/Docker/image operation, Sol-low amendment or production route
change occurs. All 64 review slots remain unstarted; absent actual observer
evidence still yields `not-eligible`, with readiness and authorization false.
