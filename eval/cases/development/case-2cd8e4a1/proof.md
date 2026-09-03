# Curator proof

Run `go test ./...` at both materialized revisions. Both pass above-quota, below-quota, and exact-boundary cases. The head uses the Go built-in max for the same lower-bound operation.
