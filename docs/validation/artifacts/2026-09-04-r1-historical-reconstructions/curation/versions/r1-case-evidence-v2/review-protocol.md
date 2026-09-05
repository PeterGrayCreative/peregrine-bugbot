# R1 v2 independent curation protocol

V2 preserves the immutable v1 packet. It carries forward only the three byte-identical v1 case bundles that received two confirmations and no blocker. The two rejected cases have new, content-addressed evidence bundles and require two fresh confirmations each.

Curators reviewing a corrected case must authenticate `packet-manifest.json`, inspect its v2 metadata and Markdown, inspect every bound raw source, and independently regenerate the exact base-to-head diff from the canonical repository. They must also inspect the superseded v1 bundle and both v1 rejections so the correction cannot hide the original defect.

For TypeScript, verify that the v2 base is the merge base and that the superseded base was a non-ancestor whose two-dot comparison reverse-included unrelated content. For Karma, evaluate only the ordinary refresh-loaded local-file root and independently inspect the disclosed absolute-URL and watcher-added-file type-loss seams and the absence of an explicit later script regression test.

Write one new JSON confirmation per corrected case under `reviews/<identity-slug>/` using `confirmation.schema.json`. Do not copy or rewrite a v1 confirmation. `confirm` requires every check to be true and no exceptions. The exact independence declaration remains:

> I independently inspected the authenticated sources and exact historical diff before accepting or rejecting the primary trace.

Run `node scripts/evidence/validate-r1-curation.mjs`. The report deliberately retains v1's failed status and reports v2 readiness separately. `--require-complete` gates the latest v2 packet only.
