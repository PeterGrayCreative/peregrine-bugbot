# Comparison recovery checkpoint: batch 1

Date: 2026-09-07. Scope: previously prepared frozen slots `r2-random-001`, `r2-random-002`, `r2-random-004`, and `r2-random-007` only.

Four new recovery-version comparison drafts are prepared in persistent curator storage at `/Users/petergray/Documents/peregrine-bugbot/.worktrees/evidence-curation/comparison-recovery-v1/`. Their causal proofs and decision cards remain there; this tracked report contains metadata only. They are inputs to the sole later consolidated human review, not a final packet or partial review request.

| Slot | Status | Case manifest SHA-256 |
| --- | --- | --- |
| `r2-random-001` | Recovered draft, human decision blank | `709783744f2f7f9434ff17cf4c58b62c79da320edfa629689e96f6f84abbaa70` |
| `r2-random-002` | Recovered draft, human decision blank | `6d4afaff1d3f85bdefe98bf01eead71a129117a0f3504b754ddb748af2506351` |
| `r2-random-004` | Recovered draft, human decision blank | `1873082e7f4c377797349bc1e7afa27c66b811726be0fe2d97195041809e3f81` |
| `r2-random-007` | Recovered draft, human decision blank | `34e62cfaecba7af6c991574e8375843fddf6a504d6e9def64941bb88ecd56b1c` |

Batch manifest: `batch-manifest.json`, SHA-256 `c523f499ea93b28872d8e210516f912087198fb8dcea1fce22a1f633afbd56f4`.

Verification recovered exact base/head/tree identities, merge bases and full canonical diffs; all four diff hashes match their preserved old aggregate bindings. It authenticated 24 original request receipts, 72 exact source/test snapshot entries, four historical licenses and all 251 case-file bindings. Independent read-only replay is available in the persistent root as `verify.mjs` (run under repository-pinned Node 22). This checks complete file inventories and every stored byte count/hash without reading causal text into its output.

The old proof/card/manifest bytes were lost. Their hashes are not claimed to match these new recovery versions. Each newly authored proof declares a narrow positive comparison contract, contemporaneous protection, limitations, and blank human controls; no global-clean conclusion or human confirmation is created. All source and proof changes remain outside the implementation checkout.

One resolved extraction-tool failure is preserved: a newly added file was initially requested from the base tree. The corrected presence check completed recovery without replacing a slot. This is not a sampled loss or comparison rejection. Aggregate acquisition and preparation storage at sealing was 26,092 KiB, within the shared 250 MiB cap; each source acquisition completed in seconds and the bounded preparation finished within the per-case 30-minute initial cap.

Remaining gates: authentic shallow source boundaries remain, so these are not complete-history materializer inputs. No historical code, dependencies, tests, builds, providers, human decisions, admissions, or partition assignments occurred. Storage access control and protected-selection eligibility are not established. The final packet still needs packet-wide reconciliation, other recovery work, and sole-human governance. Per the stop instruction, no further batch was started after this checkpoint. The persistent curator bytes remain local-only; this report does not establish remote durability for them.
