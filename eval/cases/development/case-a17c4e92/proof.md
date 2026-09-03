# Curator proof

Run `go test ./...` at each materialized revision. The base revision passes. At head, `TestConcurrentCreditsPersist` observes that concurrent credits leave the shared balance at zero, while the independent `TestReservationPersists` observes that Reserve returns true without changing the shared held amount.
