# Curator proof

Run `go test ./...` at each materialized revision. The base invokes the sender three times. The head invokes it four times and fails the unchanged attempt-count assertion.
