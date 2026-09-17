# Oracle corpus protocol checkpoint

Date: 2026-09-16. Implementation base: `44ad42b605a06804daeb98eb9454bf853cdac5a5`.
Branch: `research/r2-oracle-protocol`.

Implemented the additive `historical-oracle-v1` compiler and schemas described
in the [protocol](../plans/2026-09-16-oracle-backed-corpus-protocol.md). It admits
only visible-development records after checking retained artifact bytes,
case/revision/program/target bindings, before/after assertion outcomes and two
explicit AI review records. Formal records additionally retain a checker
certificate. Comparison records require a documented negative control.

All checks ran under Node `v22.22.1`, activated with `nvm use 22`:

- `npm run typecheck`: passed.
- `npm run test:evidence-capture`: passed, including legacy human packet and
  partition tests plus the new oracle suite.
- `npm run test:historical-truth`: 44 passed.
- Final `node --import tsx --test --test-reporter=spec tests/eval-historical-oracle.test.ts`:
  20 passed, including the compiler CLI and exclusive output creation.
- `git diff --check`: passed.

These are structural tests using clearly labeled synthetic evidence. They do
not prove historical source authenticity, oracle semantic adequacy, model
identity, corpus completeness or Peregrine efficacy. No real corpus case was
admitted and no provider run was launched by this implementation. Full
`npm run validate` and a fresh independent implementation review remain for
integration before publication.

Resume by finishing real oracle evidence and two semantic reviews per case in
the private evidence repository. Then compile a new manifest, report actual
counts and reconstruction losses, and review it before adding an explicit
adapter for future experiment registration. Keep the original 36 draft
proposals, old packets and failed evidence unchanged. Fresh reserved selection
uses a separate partition path.
