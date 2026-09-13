# Canary assessment v3: global item-ID ownership

Independent review rejected public `3851df0` and private `ac0a7f3`: v2 recorded
MCP IDs only, so an earlier `agent_message` or `reasoning` item could claim a read
ID without rejection. Duplicate IDs among non-MCP items were also unchecked.
Both rejected ancestors and their artifacts remain unchanged.

The v3 assessor records ownership at the first occurrence of every item ID.
An ID cannot change item type, start twice, or reappear after completion. Only
same-type start/update/completion transitions may share an open ID; non-I/O items
may first appear completed, whereas reads still require a matching start and
exact server/tool/arguments. No additional model capability is admitted.

Forty new collision controls cover all four permitted non-MCP types before,
during and after a read, plus every ordered non-MCP type pair including duplicate
completions. A positive control retains distinct completion-only and streaming
non-I/O items. Mutations refresh terminal telemetry and the authenticated inventory
so stale hashes cannot mask a lifecycle defect. The predecessor fails both new
negative groups (8/10 focused groups pass); successor validation is archived in
private `canary-assessment-v3/` alongside exact reproduction source and failures.
Successor Node22 typecheck, 10 focused groups, 62 prediction, 13 HTTP and 101
affected reader/runtime/engine tests, plus diff checks, passed.

Retro: the missed assumption was that read-only ID tracking established global
ownership. This was insufficient verification. The prevention rule is to test
every permitted producer as the first ID owner, in both orders, with all dependent
evidence hashes synchronized and a positive fixture control.

No provider/client/Docker/image operation, route change, Sol-low amendment or
batch authorization occurs. Actual observer evidence remains absent and the
real assessment remains `not-eligible`, with all 64 review slots unstarted.
