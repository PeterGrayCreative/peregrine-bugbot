# PR3 pre-telemetry artifact fixture

This sanitized fixture preserves the schema-v1 writer contract at repository
commit `8f667f4fa1c59e679efa08ce2776ab1908c3a4d2`. At that commit, matrix attempts
and run records had corpus and history provenance but no runner field, raw
breadth/investigation stages contained only output, usage, and duration, and
aggregate usage had no telemetry aggregation or availability provenance.

The identifiers and provider values are deterministic test data; the field
shape is the writer-era contract under compatibility test.
