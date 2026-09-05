# Archived screening stores

Raw capture bytes and immutable request receipts are copied unchanged from the
screeners' scratch stores. Absolute paths in their original reports resolve as:

| Original prefix | Repository-relative archive prefix (from the R2 artifact root) |
| --- | --- |
| `/private/tmp/peregrine-r2-alpha-sources/` | `screening-sources/alpha/` |
| `/private/tmp/peregrine-r2-beta-sources/` | `screening-sources/beta/` |

The reports remain original screening records, not adjudication or admission.
Receipts preserve request parameters, retrieval time, source URL, byte length,
and content digest. The GitHub author type is not proof of human authorship.
Incomplete search pages and rejected screening leads remain preserved.
