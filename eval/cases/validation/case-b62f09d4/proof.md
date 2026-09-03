# Curator proof

Run `go test ./...` at each materialized revision. The base revision completes three jobs. The head revision fails `TestRunCollectsEveryResult` because the second sender blocks before `workers.Wait` can return.
