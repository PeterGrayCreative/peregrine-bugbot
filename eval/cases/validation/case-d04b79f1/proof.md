# Curator proof

Run `go test -v ./backoff` at each revision. The base output includes `TestDelay/first_attempt`; the head output does not. Both revisions otherwise pass, demonstrating that the changed table deterministically removes the only assertion for the zero-attempt branch.
