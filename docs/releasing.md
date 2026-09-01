# Releasing

1. Update the package and both plugin manifest versions together. Claude uses the manifest version as its cache update signal.
2. Update pinned provider CLI versions only after checking the package registry and running live smoke tests.
3. Activate Node 22 and run `npm ci`, then `npm run validate` and `npm run doctor`.
4. Run one bounded Claude and one bounded Codex review without `--post`; record base/head, runner versions, result status, and target working-tree state.
5. Push the verified commit, run both native marketplace update commands, and confirm the installed plugins report the new version.
6. Tag the verified commit, then update reusable-workflow consumers to the immutable tag or commit SHA.
7. Keep copied installers for hosted/fallback surfaces, but do not treat installed copies as editable sources.

Rollback is a caller ref change to the previous verified tag. Do not retire the old skills repository or delete duplicate local installs until consumers have migrated and the user explicitly authorizes cleanup.
