# Curator proof

Run `go test -race ./...` at both materialized revisions. Both pass. The head changes the read-only Snapshot method from an exclusive lock to the matching read lock while preserving exclusion against Put and copying under protection.
