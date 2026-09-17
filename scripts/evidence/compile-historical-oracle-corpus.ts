import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { writeHistoricalOracleCorpus, type OracleArtifact } from "../../eval/historical-oracle.js";

// All inputs are curator-side evidence. This command only reads files and writes
// a new manifest; it never executes oracle commands or launches a provider.
const [evidenceRoot, refsPath, output, ...extra] = process.argv.slice(2);
if (!evidenceRoot || !refsPath || !output || extra.length) {
  throw new Error("Usage: node --import tsx scripts/evidence/compile-historical-oracle-corpus.ts <evidence-root> <case-refs.json> <new-manifest.json>");
}
const refs: unknown = JSON.parse(readFileSync(resolve(refsPath), "utf8"));
if (!Array.isArray(refs)) throw new Error("case-refs.json must be an array of {path, sha256} records");
const corpus = writeHistoricalOracleCorpus(resolve(output), resolve(evidenceRoot), refs as OracleArtifact[]);
console.log(JSON.stringify({ counts: corpus.counts, corpusSha256: corpus.corpusSha256 }, null, 2));
