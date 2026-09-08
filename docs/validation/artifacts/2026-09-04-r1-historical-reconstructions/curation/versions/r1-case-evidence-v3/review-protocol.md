# R1 v3 canonical-diff curation protocol

V3 is append-only. It preserves the authenticated v1 and v2 packets and requires two fresh confirmations for all five cases because every exact-diff evidence claim changed.

The packet-bound `.diff` file is authoritative. Each was generated with `LC_ALL=C` and `LANG=C` using:

```text
git -c core.quotePath=true -c color.ui=false -c diff.renames=false diff --binary --full-index --no-ext-diff --no-textconv --no-renames --no-color --diff-algorithm=myers --src-prefix=a/ --dst-prefix=b/ --unified=3 <base> <head> --
```

Full object IDs eliminate repository-dependent abbreviation. Disabled rename detection, external diff/text conversion, color, and configurable prefixes/context make the byte format explicit. The capture-time Git version is recorded but may vary; the stored bytes and their SHA-256 remain authoritative.

Each curator must regenerate or inspect the canonical patch, verify the metadata's superseded claims and prior-bundle binding, and independently re-evaluate the root and limitations in the reused case document. A reused document's older diff hash is provenance only and is explicitly superseded by v3 metadata.

Only identities in the packet-bound `curatorRoster` may confirm. Each curator writes only its own `<caseId>.json` files in its assigned directory. Confirmations must bind both the case bundle and exact v3 `packetSha256`; a packet change makes prior confirmations stale.

Run `node scripts/evidence/validate-r1-curation.mjs`. It reports v1, v2, and v3 separately. `--require-complete` gates v3 only.
