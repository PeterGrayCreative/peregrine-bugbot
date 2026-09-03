# Plan PR 4 validation record

Scope: benchmark-only lane contracts, curator truth, root-cause grading, blinded semantic decision evidence, adjudication, miss-stage vocabulary, report metrics, schemas, and tests. Production prompts, routing, posting, consolidation, and thresholds are unchanged.

Validation is run under the repository-pinned Node 22 toolchain.

- `npm run typecheck` - passed under Node 22.
- `node --import tsx --test tests/eval-grading.test.ts` - passed 11/11.
- `npm run validate` - passed: 152/152 Node tests, 26/26 skill checks, 9/9 packaging/install checks, 4/4 plugin-management checks, and structural smoke 8/8 attempts with 5/5 expected markers.

The structural smoke result is transport evidence only. It is not evidence that model recall, precision, token efficiency, or provider cost improved.

Known integration boundaries: the typed manifest registry being developed in Plan PR 6 must become the single canonical source during integration. Definitive behavioral miss attribution remains closed until runner-owned stage evidence exists; no guessed routing, breadth, budget, investigation, or presentation labels are reported. Live semantic experiments also remain closed until the accepted containment adapter owns judge execution and a separate judge budget/ledger is authenticated. This slice establishes and validates the grading contract without weakening either gate.
