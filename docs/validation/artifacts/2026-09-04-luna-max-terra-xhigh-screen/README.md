# Luna Max / Terra Xhigh smoke experiment archive

This directory preserves the complete sanitized evidence for the stopped Luna
max breadth / Terra xhigh investigation experiment.

- `treatment-only-smoke/` is run `2026-09-04T23-26-53-741Z`.
- `paired-smoke/` is run `2026-09-04T23-47-36-593Z`.

Together the directories retain all 18 scheduled terminal review attempts,
all corresponding graded attempts, every contained semantic-judge decision,
provider-started and attempt-started markers, immutable manifests, terminal and
grading seals, benchmark JSON and HTML reports, and write-once funnel decisions.
No attempt was dropped or consolidated.

The artifacts passed the repository secret scanner before being added. Codex
session material, registry credentials, environment files, and container home
directories are not present. The source run directories remain ignored local
working evidence; these copies are the versioned record.

The treatment-only run is diagnostic evidence. The paired run's sealed funnel
decision is inconclusive because one control-only unmatched finding remains
unresolved. The operator separately stopped the treatment because every paired
case favored the control on wall time and the paired median treatment slowdown
was approximately 82.7%. See
[`../../2026-09-04-luna-max-terra-xhigh-smoke-results.md`](../../2026-09-04-luna-max-terra-xhigh-smoke-results.md).
