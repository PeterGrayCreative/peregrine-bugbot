# Response, error, transport, and observability contracts

<!-- manifest path-pattern: (routes?/|route\.|(^|/)api/|openapi|swagger|schemas?/|router|controller|serializ|handler) -->
<!-- manifest content-pattern: (\.output\(|optional\(\)|nullable\(\)|TRPCError|NextResponse|HttpException|Content-Type|application/json|image/|multipart|catch|logger|statusCode|status_code|serialize) -->

**Lane summary:** The published schema, the runtime behavior, and the persisted truth agree — and errors reveal nothing internal while losing no diagnostic evidence.

## Triggers

- input or output validation-schema changes (e.g., Zod, JSON Schema, serializers)
- optional, nullable, defaulted, or transformed fields
- error mapping, catch blocks, logging, status codes, headers
- binary or multipart routes
- API-spec generation (e.g., OpenAPI) or route/procedure resolution

## Invariants

- Runtime validation and published schema agree, or the contradiction is explicitly documented.
- Persistence nulls are mapped honestly to the public contract.
- 5xx responses do not expose internal procedure, schema, stack, or secret details.
- Every hidden client error retains server-side diagnostic evidence.
- Binary contracts return bytes and source MIME type, not JSON wrappers.
- Successful responses do not silently discard accepted input.

## Counterexamples

- schema says optional while runtime requires one literal;
- a nullable database value reaches a non-nullable output schema;
- a typed framework error bypasses generic 5xx sanitization;
- an early return bypasses request-error logging;
- a binary response flows through generic JSON serialization;
- a mapper emits `{}` or placeholder data despite a stored payload;
- unknown-resource, conflict, and forbidden paths disclose inconsistent information.

## Affected surfaces

Every transport that republishes the contract: the direct caller, HTTP route, REST/OpenAPI adapter, generated clients or tools, and UI consumers. A fix applied to one adapter and not its siblings is still a finding.
