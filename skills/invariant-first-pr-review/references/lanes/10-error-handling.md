# Error Handling and Recovery

**Lane summary:** Verify that failures remain observable, correctly classified, and recoverable without swallowing errors, corrupting state, or reporting false success.

<!-- manifest path-pattern: (^|/)(errors?|exceptions?|retries?|recovery|fallbacks?)(/|\.|-)|\.(error|exception)\.(ts|tsx|js|jsx|py|rb|go|rs|java)$ -->
<!-- manifest content-pattern: (catch[[:space:]]*\(|throw[[:space:]]|try[[:space:]]*\{|onError|error[[:space:]]*=>|\.catch[[:space:]]*\(|finally[[:space:]]*\{|Result<|recover|retry) -->

## Triggers

- new or changed catches, retries, fallbacks, error mapping, cleanup, or partial-success paths;
- ignored promise rejections or callbacks whose error branch does not reach the caller;
- state mutation before a failure with no rollback or compensating action;
- user-visible success produced after an internal failure.

## Invariants

- A material failure cannot become silent success.
- Error mapping preserves the distinction between invalid input, missing data, authorization failure, conflict, dependency failure, and internal failure.
- Cleanup does not hide the primary error and always runs at the correct boundary.
- Retry behavior is bounded, idempotent where required, and does not duplicate side effects.

## Counterexamples

Force the first dependency failure, a failure after partial mutation, the final retry failure, and an error thrown from cleanup. Trace what the caller and user observe.

## Verification

Find the consumer of the returned or thrown error and confirm its observable status, message, state, and telemetry. Reject style-only preferences about exception syntax.
