# Curator proof

Run `go test -list . ./settings` at each revision. The base lists `TestSavePropagatesWriterError`; the head lists only `TestSaveWritesPayload`. The production function still exposes the writer error contract, so the head deterministically removes the only failure-path assertion while remaining green under `go test ./...`.
