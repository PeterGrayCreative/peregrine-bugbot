# R3 methodology analysis binding

Status: structural verification only. No provider or historical review ran.

`methodology-analysis-binding.json` is the final append-only join between one
authenticated execution and its separate analysis store. It derives the run ID
and schedule from the invocation registration, then revalidates every scheduled
grading projection, the grade set, all-finding adjudication, descriptive report,
resource set, and resource report before binding their caller-held digests.

The binding also hashes the exact runtime repository bytes for the analysis
module and its declared direct contract dependencies. Creation verifies that
the binding module itself was loaded from that repository root. A separate
source verifier detects later drift. This closes the earlier caller-invented
analysis run-ID gap without changing old artifact formats.

The binding keeps provider identity and efficacy explicitly unestablished.
It does not replace R4 preregistration, inferential analysis, real human case
admission, runtime availability evidence, or provider-connected containment.

Verification under Node 22:

- `npm run typecheck`
- `node --import tsx --test tests/eval-methodology-grading-projection.test.ts`
- full methodology-focused suite before commit
