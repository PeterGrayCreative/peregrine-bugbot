import { readdirSync } from "node:fs";
import { join } from "node:path";
import { isCoreLaneId, type CoreLaneId } from "../src/core/lanes.js";
import { assertNoSecrets } from "../src/security/secrets.js";
import { sha256 } from "../src/core/telemetry.js";
import { parseBreadthResult } from "../src/core/breadth-result.js";
import { canonicalJson, canonicalJsonSha256, readExperimentJson, writeExclusiveJson } from "./experiment.js";
import {
  parseHistoricalMethodologyCaseRegistration,
  type HistoricalMethodologyAdmissionBinding,
  type HistoricalMethodologyCaseRegistration,
} from "./historical-methodology-case.js";
import { parseMethodologyAssetManifest, type MethodologyAssetManifest } from "./methodology-assets.js";
import { type MethodologyInvocationInput, readMethodologyInvocationRegistration } from "./methodology-invocations.js";
import type { MethodologyLaneActivation } from "./methodology-lane-activation.js";
import { parseMethodologyDiscoveryOutput } from "./methodology-output.js";
import {
  compileMethodologyDiscoveryPrompt,
  compileMethodologyReviewPrompt,
  parseMethodologyRawScope,
  type CompiledMethodologyPrompt,
  type MethodologyRawScope,
} from "./methodology-prompts.js";
import { METHODOLOGY_ARM_IDS, type MethodologyArmId } from "./methodology-schedule.js";

const PLAN_FILE = "methodology-input-plan.json";
const PLAN_PROTOCOL = "historical-methodology-input-plan-v1" as const;
const HANDOFF_SLOT = "__PEREGRINE_CANONICAL_HANDOFF_V1__";
const SHA256 = /^[a-f0-9]{64}$/;
const OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export interface MethodologyInputPlanCaseInput {
  historicalRegistration: unknown;
  admissionBinding: unknown;
  rawScope: unknown;
  laneActivation: unknown;
}

export interface MethodologyInputPlanCase {
  caseName: string;
  historicalRegistration: HistoricalMethodologyCaseRegistration;
  admissionBinding: HistoricalMethodologyAdmissionBinding;
  rawScope: MethodologyRawScope;
  laneActivation: MethodologyLaneActivation;
}

export interface MethodologyStaticStageContract {
  kind: "static-prompt";
  caseName: string;
  armId: MethodologyArmId;
  stageIndex: 1;
  assetsTreeSha256: string;
  compiled: CompiledMethodologyPrompt;
}

export interface MethodologyHandoffStageContract {
  kind: "canonical-handoff-template";
  caseName: string;
  armId: "C" | "D";
  stageIndex: 2;
  assetsTreeSha256: string;
  schemaPath: string;
  rawScopeSha256: string;
  methodSourceSha256: string | null;
  handoffFormat: "methodology-discovery-v1" | "breadth-result-v1";
  promptTemplate: string;
  promptTemplateSha256: string;
}

export type MethodologyStageContract = MethodologyStaticStageContract | MethodologyHandoffStageContract;

export interface MethodologyInputPlan {
  schemaVersion: 1;
  protocol: typeof PLAN_PROTOCOL;
  invocationRegistrationSha256: string;
  cases: MethodologyInputPlanCase[];
  stages: MethodologyStageContract[];
  boundaries: {
    sourceAuthentication: "caller-supplied-admission-and-activation-bound-not-rederived";
    modelVisibility: "must-remain-outside-reviewer-mounted-assets";
  };
  recordSha256: string;
}

/**
 * Freeze the exact historical admission, code-only lane activation, and prompt
 * contract before any methodology provider work. Dynamic C/D reviewer prompts
 * are represented by an exact template whose sole variable is the canonical,
 * authenticated first-stage output.
 */
export async function registerMethodologyInputPlan(root: string, input: {
  invocationRegistrationSha256: string;
  cases: readonly MethodologyInputPlanCaseInput[];
}): Promise<string> {
  const registration = readMethodologyInvocationRegistration(root, input.invocationRegistrationSha256);
  assertNoBegunMethodologyWork(root);
  const cases = parseInputCases(input.cases);
  assertCasesMatchRegistration(cases, registration);
  const stages = await compileStageContracts(cases, registration.assetsByArm);
  const body = {
    schemaVersion: 1 as const,
    protocol: PLAN_PROTOCOL,
    invocationRegistrationSha256: input.invocationRegistrationSha256,
    cases,
    stages,
    boundaries: {
      sourceAuthentication: "caller-supplied-admission-and-activation-bound-not-rederived" as const,
      modelVisibility: "must-remain-outside-reviewer-mounted-assets" as const,
    },
  };
  const record: MethodologyInputPlan = { ...body, recordSha256: canonicalJsonSha256(body) };
  assertNoSecrets(record, "methodology input plan");
  // Prompt compilation reads trusted method sources asynchronously. Close the
  // registration race immediately before the exclusive plan write.
  assertNoBegunMethodologyWork(root);
  writeExclusiveJson(root, join(root, PLAN_FILE), record);
  return record.recordSha256;
}

export function readMethodologyInputPlan(
  root: string,
  invocationRegistrationSha256: string,
  expectedPlanSha256: string,
): MethodologyInputPlan {
  if (!isHash(expectedPlanSha256)) throw new Error("caller-held methodology input-plan digest is required");
  const registration = readMethodologyInvocationRegistration(root, invocationRegistrationSha256);
  const record = parsePlan(readExperimentJson(join(root, PLAN_FILE)));
  if (record.invocationRegistrationSha256 !== invocationRegistrationSha256) {
    throw new Error("methodology input plan registration mismatch");
  }
  const { recordSha256, ...body } = record;
  if (recordSha256 !== expectedPlanSha256 || recordSha256 !== canonicalJsonSha256(body)) {
    throw new Error("methodology input plan digest mismatch");
  }
  assertCasesMatchRegistration(record.cases, registration);
  assertStageContractsMatchRegistration(record.cases, record.stages, registration.assetsByArm);
  assertNoSecrets(record, "methodology input plan");
  return record;
}

/**
 * Validate the exact runtime input against the frozen plan. This is intended to
 * be composed with, not substituted for, the existing invocation recorder.
 */
export function verifyMethodologyPlannedInvocation(input: {
  root: string;
  invocationRegistrationSha256: string;
  inputPlanSha256: string;
  invocation: MethodologyInvocationInput;
}): void {
  const plan = readMethodologyInputPlan(
    input.root,
    input.invocationRegistrationSha256,
    input.inputPlanSha256,
  );
  const registration = readMethodologyInvocationRegistration(input.root, input.invocationRegistrationSha256);
  const invocation = parseInvocation(input.invocation);
  const attempt = registration.schedule.attempts.find((candidate) => candidate.id === invocation.attemptId);
  if (!attempt || attempt.armId !== invocation.compiled.armId || invocation.stageIndex > attempt.expectedStages) {
    throw new Error("methodology planned invocation is not scheduled");
  }
  if (invocation.model !== registration.schedule.design.callerConfig.model || invocation.effort !== "high" ||
      invocation.stageMaximumMs !== attempt.stageDeadlineMs[invocation.stageIndex - 1]) {
    throw new Error("methodology planned invocation route or deadline mismatch");
  }
  const plannedCase = plan.cases.find((candidate) => candidate.caseName === attempt.caseName)!;
  if (invocation.compiled.rawScopeSha256 !== canonicalJsonSha256(plannedCase.rawScope)) {
    throw new Error("methodology planned invocation scope mismatch");
  }
  const registeredAssets = registration.assetsByArm.find((candidate) => candidate.armId === attempt.armId)!;
  const invocationAssets = parseMethodologyAssetManifest(invocation.assets);
  if (canonicalJson(invocationAssets) !== canonicalJson(registeredAssets)) {
    throw new Error("methodology planned invocation assets mismatch");
  }
  const schema = registeredAssets.files.find((candidate) => candidate.path === invocation.compiled.schemaPath);
  if (!schema || typeof invocation.schemaText !== "string" || sha256(invocation.schemaText) !== schema.sha256 ||
      Buffer.byteLength(invocation.schemaText) !== schema.bytes) {
    throw new Error("methodology planned invocation schema mismatch");
  }
  const contract = plan.stages.find((candidate) => candidate.caseName === attempt.caseName &&
    candidate.armId === attempt.armId && candidate.stageIndex === invocation.stageIndex);
  if (!contract) throw new Error("methodology planned invocation lacks a frozen stage contract");
  if (contract.assetsTreeSha256 !== invocationAssets.treeSha256) {
    throw new Error("methodology planned invocation asset tree mismatch");
  }
  if (contract.kind === "static-prompt") {
    if (invocation.previousOutput !== null || canonicalJson(invocation.compiled) !== canonicalJson(contract.compiled)) {
      throw new Error("methodology static prompt differs from its frozen input plan");
    }
    return;
  }
  if (typeof invocation.previousOutput !== "string") {
    throw new Error("methodology dynamic reviewer requires the exact first-stage output");
  }
  const handoff = canonicalHandoff(contract.armId, invocation.previousOutput);
  const prompt = renderHandoffTemplate(contract.promptTemplate, handoff.text);
  const expected: CompiledMethodologyPrompt = {
    armId: contract.armId,
    stage: "review",
    schemaPath: contract.schemaPath,
    prompt,
    promptSha256: sha256(prompt),
    rawScopeSha256: contract.rawScopeSha256,
    methodSourceSha256: contract.methodSourceSha256,
    handoffSha256: handoff.sha256,
  };
  if (canonicalJson(invocation.compiled) !== canonicalJson(expected)) {
    throw new Error("methodology dynamic prompt differs from its frozen handoff template");
  }
}

/**
 * Rebind a freshly materialized case and freshly derived code-only activation
 * to the frozen plan. The plan itself only binds its caller-supplied artifacts;
 * callers use this at the trusted materialization boundary before invocation.
 */
export function verifyMethodologyInputPlanPreparation(input: {
  root: string;
  invocationRegistrationSha256: string;
  inputPlanSha256: string;
  historicalRegistration: unknown;
  admissionBinding: unknown;
  rawScope: unknown;
  laneActivation: unknown;
}): void {
  const plan = readMethodologyInputPlan(
    input.root,
    input.invocationRegistrationSha256,
    input.inputPlanSha256,
  );
  const fresh = parseCase({ historicalRegistration: input.historicalRegistration,
    admissionBinding: input.admissionBinding, rawScope: input.rawScope,
    laneActivation: input.laneActivation }, "fresh methodology input-plan preparation");
  const frozen = plan.cases.find((candidate) => candidate.caseName === fresh.caseName);
  if (!frozen || canonicalJson(fresh) !== canonicalJson(frozen)) {
    throw new Error("fresh methodology preparation differs from the frozen input plan");
  }
}

async function compileStageContracts(
  cases: MethodologyInputPlanCase[],
  assetsByArm: MethodologyAssetManifest[],
): Promise<MethodologyStageContract[]> {
  const output: MethodologyStageContract[] = [];
  for (const caseItem of cases) {
    const lanes = caseItem.laneActivation.activatedLanes;
    for (const armId of METHODOLOGY_ARM_IDS) {
      const assets = assetsByArm.find((candidate) => candidate.armId === armId)!;
      if (armId === "A" || armId === "B") {
        const compiled = await compileMethodologyReviewPrompt({ armId, scope: caseItem.rawScope,
          ...(armId === "B" ? { activatedLanes: lanes } : {}) });
        output.push(staticContract(caseItem.caseName, armId, assets, compiled));
        continue;
      }
      const discovery = await compileMethodologyDiscoveryPrompt({ armId, scope: caseItem.rawScope,
        ...(armId === "D" ? { activatedLanes: lanes } : {}) });
      output.push(staticContract(caseItem.caseName, armId, assets, discovery));
      const dummy = armId === "C" ? dummyDiscovery() : dummyBreadth(caseItem.rawScope.rawChangedPaths[0]!);
      const review = await compileMethodologyReviewPrompt({ armId, scope: caseItem.rawScope,
        ...(armId === "D" ? { activatedLanes: lanes } : {}), handoff: dummy });
      output.push(handoffContract(caseItem.caseName, armId, assets, review, canonicalJson(dummy)));
    }
  }
  return output;
}

function staticContract(caseName: string, armId: MethodologyArmId, assets: MethodologyAssetManifest,
  compiled: CompiledMethodologyPrompt): MethodologyStaticStageContract {
  if (compiled.handoffSha256 !== null) throw new Error("methodology static prompt unexpectedly contains a handoff");
  return { kind: "static-prompt", caseName, armId, stageIndex: 1,
    assetsTreeSha256: assets.treeSha256, compiled };
}

function handoffContract(caseName: string, armId: "C" | "D", assets: MethodologyAssetManifest,
  compiled: CompiledMethodologyPrompt, canonicalDummy: string): MethodologyHandoffStageContract {
  const tag = armId === "C" ? "candidate-handoff" : "breadth-handoff";
  const block = `<${tag} untrusted="true">\n${canonicalDummy}\n</${tag}>`;
  const replacement = `<${tag} untrusted="true">\n${HANDOFF_SLOT}\n</${tag}>`;
  if (compiled.stage !== "review" || compiled.handoffSha256 !== sha256(canonicalDummy) ||
      compiled.prompt.split(block).length !== 2) {
    throw new Error("methodology dynamic prompt cannot be reduced to one canonical handoff slot");
  }
  const promptTemplate = compiled.prompt.replace(block, replacement);
  return {
    kind: "canonical-handoff-template",
    caseName,
    armId,
    stageIndex: 2,
    assetsTreeSha256: assets.treeSha256,
    schemaPath: compiled.schemaPath,
    rawScopeSha256: compiled.rawScopeSha256,
    methodSourceSha256: compiled.methodSourceSha256,
    handoffFormat: armId === "C" ? "methodology-discovery-v1" : "breadth-result-v1",
    promptTemplate,
    promptTemplateSha256: sha256(promptTemplate),
  };
}

function parseInputCases(value: readonly MethodologyInputPlanCaseInput[]): MethodologyInputPlanCase[] {
  if (!Array.isArray(value)) throw new Error("methodology input-plan cases must be an array");
  return value.map((entry, index) => {
    const item = exactObject(entry, `methodology input-plan case ${index}`, [
      "historicalRegistration", "admissionBinding", "rawScope", "laneActivation",
    ]);
    return parseCase({
      historicalRegistration: item.historicalRegistration,
      admissionBinding: item.admissionBinding,
      rawScope: item.rawScope,
      laneActivation: item.laneActivation,
    }, `methodology input-plan case ${index}`);
  });
}

function parseCase(value: unknown, source: string): MethodologyInputPlanCase {
  const root = exactObject(value, source, [
    "historicalRegistration", "admissionBinding", "rawScope", "laneActivation",
  ], ["caseName"]);
  const historicalRegistration = parseHistoricalMethodologyCaseRegistration(root.historicalRegistration);
  const admissionBinding = parseAdmissionBinding(root.admissionBinding, historicalRegistration);
  const rawScope = parseMethodologyRawScope(root.rawScope);
  const laneActivation = parseLaneActivation(root.laneActivation, canonicalJsonSha256(rawScope));
  const caseName = root.caseName === undefined ? historicalRegistration.caseName : root.caseName;
  if (caseName !== historicalRegistration.caseName) throw new Error(`${source} case identity mismatch`);
  if (sha256(rawScope.diff) !== admissionBinding.materializedDiffSha256 ||
      rawScope.taskSpecification !== historicalRegistration.inputs.taskSpecification ||
      sha256(rawScope.taskSpecification) !== historicalRegistration.inputs.taskSpecificationSha256) {
    throw new Error(`${source} raw scope differs from its historical admission or task specification`);
  }
  return { caseName, historicalRegistration, admissionBinding, rawScope, laneActivation };
}

function parseAdmissionBinding(
  value: unknown,
  registration: HistoricalMethodologyCaseRegistration,
): HistoricalMethodologyAdmissionBinding {
  const root = exactObject(value, "methodology historical admission binding", [
    "registrationSha256", "caseBundleSha256", "truthScopeSha256", "sourceIdentitySha256",
    "sourceBaseRef", "sourceHeadRef", "sourceMergeBase", "sourceBaseTree", "sourceHeadTree",
    "materializedDiffSha256", "verificationBoundary",
  ]);
  for (const field of ["registrationSha256", "caseBundleSha256", "truthScopeSha256",
    "sourceIdentitySha256", "materializedDiffSha256"] as const) {
    if (!isHash(root[field])) throw new Error(`methodology admission ${field} is invalid`);
  }
  for (const field of ["sourceBaseRef", "sourceHeadRef", "sourceMergeBase", "sourceBaseTree", "sourceHeadTree"] as const) {
    if (typeof root[field] !== "string" || !OBJECT_ID.test(root[field] as string)) {
      throw new Error(`methodology admission ${field} is invalid`);
    }
  }
  if (root.verificationBoundary !== "declared-bundle-policy-and-materialized-source" ||
      root.registrationSha256 !== registration.registrationSha256 ||
      root.caseBundleSha256 !== registration.caseBundleSha256 ||
      root.truthScopeSha256 !== registration.truth.scopeSha256 ||
      root.sourceIdentitySha256 !== registration.source.repositoryIdentitySha256 ||
      root.sourceBaseRef !== registration.source.baseCommit || root.sourceHeadRef !== registration.source.headCommit ||
      root.sourceMergeBase !== registration.source.baseCommit ||
      root.materializedDiffSha256 !== registration.source.changeIdentitySha256) {
    throw new Error("methodology admission binding differs from its historical registration");
  }
  return root as unknown as HistoricalMethodologyAdmissionBinding;
}

function parseLaneActivation(value: unknown, rawScopeSha256: string): MethodologyLaneActivation {
  const root = exactObject(value, "methodology lane activation", [
    "schemaVersion", "protocol", "rawScopeSha256", "routingSourceSha256", "manifestSha256",
    "activatedLanes", "profilePolicy", "activationSha256",
  ]);
  if (root.schemaVersion !== 1 || root.protocol !== "methodology-code-only-lanes-v1" ||
      root.rawScopeSha256 !== rawScopeSha256 || !isHash(root.routingSourceSha256) ||
      !isHash(root.manifestSha256) || root.profilePolicy !== "no-profile-or-custom-lanes" ||
      !Array.isArray(root.activatedLanes)) {
    throw new Error("methodology lane activation identity is invalid");
  }
  const activatedLanes = root.activatedLanes.map((lane) => {
    if (!isCoreLaneId(lane)) throw new Error("methodology input plan contains an unknown lane");
    return lane;
  });
  if (new Set(activatedLanes).size !== activatedLanes.length) {
    throw new Error("methodology input plan contains duplicate lanes");
  }
  const { activationSha256, ...body } = root;
  if (!isHash(activationSha256) || activationSha256 !== canonicalJsonSha256(body)) {
    throw new Error("methodology lane activation digest mismatch");
  }
  return { ...body, activatedLanes, activationSha256 } as MethodologyLaneActivation;
}

function parsePlan(value: unknown): MethodologyInputPlan {
  const root = exactObject(value, "methodology input plan", [
    "schemaVersion", "protocol", "invocationRegistrationSha256", "cases", "stages", "boundaries", "recordSha256",
  ]);
  if (root.schemaVersion !== 1 || root.protocol !== PLAN_PROTOCOL ||
      !isHash(root.invocationRegistrationSha256) || !isHash(root.recordSha256) ||
      !Array.isArray(root.cases) || !Array.isArray(root.stages)) {
    throw new Error("methodology input plan identity is invalid");
  }
  const cases = root.cases.map((entry, index) => parseCase(entry, `methodology input plan cases[${index}]`));
  const stages = root.stages.map((entry, index) => parseStage(entry, `methodology input plan stages[${index}]`));
  const boundaries = exactObject(root.boundaries, "methodology input plan boundaries", [
    "sourceAuthentication", "modelVisibility",
  ]);
  if (boundaries.sourceAuthentication !== "caller-supplied-admission-and-activation-bound-not-rederived" ||
      boundaries.modelVisibility !== "must-remain-outside-reviewer-mounted-assets") {
    throw new Error("methodology input plan boundaries are invalid");
  }
  return { schemaVersion: 1, protocol: PLAN_PROTOCOL,
    invocationRegistrationSha256: root.invocationRegistrationSha256, cases, stages,
    boundaries: {
      sourceAuthentication: "caller-supplied-admission-and-activation-bound-not-rederived",
      modelVisibility: "must-remain-outside-reviewer-mounted-assets",
    },
    recordSha256: root.recordSha256 };
}

function parseStage(value: unknown, source: string): MethodologyStageContract {
  const base = exactObject(value, source, ["kind"], [
    "caseName", "armId", "stageIndex", "assetsTreeSha256", "compiled", "schemaPath",
    "rawScopeSha256", "methodSourceSha256", "handoffFormat", "promptTemplate", "promptTemplateSha256",
  ]);
  if (base.kind === "static-prompt") {
    const root = exactObject(value, source, [
      "kind", "caseName", "armId", "stageIndex", "assetsTreeSha256", "compiled",
    ]);
    const armId = parseArmId(root.armId);
    const compiled = parseCompiled(root.compiled, source);
    if (typeof root.caseName !== "string" || root.stageIndex !== 1 || !isHash(root.assetsTreeSha256) ||
        compiled.armId !== armId || compiled.handoffSha256 !== null) throw new Error(`${source} is invalid`);
    return { kind: "static-prompt", caseName: root.caseName, armId, stageIndex: 1,
      assetsTreeSha256: root.assetsTreeSha256, compiled };
  }
  const root = exactObject(value, source, [
    "kind", "caseName", "armId", "stageIndex", "assetsTreeSha256", "schemaPath",
    "rawScopeSha256", "methodSourceSha256", "handoffFormat", "promptTemplate", "promptTemplateSha256",
  ]);
  const armId = root.armId;
  if (root.kind !== "canonical-handoff-template" || (armId !== "C" && armId !== "D") ||
      typeof root.caseName !== "string" || root.stageIndex !== 2 || !isHash(root.assetsTreeSha256) ||
      typeof root.schemaPath !== "string" || !isHash(root.rawScopeSha256) ||
      !(root.methodSourceSha256 === null || isHash(root.methodSourceSha256)) ||
      root.handoffFormat !== (armId === "C" ? "methodology-discovery-v1" : "breadth-result-v1") ||
      typeof root.promptTemplate !== "string" || root.promptTemplate.split(HANDOFF_SLOT).length !== 2 ||
      root.promptTemplateSha256 !== sha256(root.promptTemplate)) throw new Error(`${source} is invalid`);
  return root as unknown as MethodologyHandoffStageContract;
}

function parseCompiled(value: unknown, source: string): CompiledMethodologyPrompt {
  const root = exactObject(value, `${source} compiled prompt`, [
    "armId", "stage", "schemaPath", "prompt", "promptSha256", "rawScopeSha256",
    "methodSourceSha256", "handoffSha256",
  ]);
  const armId = parseArmId(root.armId);
  if ((root.stage !== "discovery" && root.stage !== "review") || typeof root.schemaPath !== "string" ||
      typeof root.prompt !== "string" || root.promptSha256 !== sha256(root.prompt) ||
      !isHash(root.rawScopeSha256) || !(root.methodSourceSha256 === null || isHash(root.methodSourceSha256)) ||
      !(root.handoffSha256 === null || isHash(root.handoffSha256))) throw new Error(`${source} compiled prompt is invalid`);
  return { armId, stage: root.stage, schemaPath: root.schemaPath, prompt: root.prompt,
    promptSha256: root.promptSha256, rawScopeSha256: root.rawScopeSha256,
    methodSourceSha256: root.methodSourceSha256, handoffSha256: root.handoffSha256 };
}

function assertCasesMatchRegistration(cases: MethodologyInputPlanCase[], registration: ReturnType<typeof readMethodologyInvocationRegistration>): void {
  if (canonicalJson(cases.map((item) => item.caseName)) !== canonicalJson(registration.schedule.cases.map((item) => item.caseName))) {
    throw new Error("methodology input-plan cases must exactly follow the registered schedule");
  }
  for (const caseItem of cases) {
    const descriptor = registration.schedule.cases.find((candidate) => candidate.caseName === caseItem.caseName)!;
    if (caseItem.historicalRegistration.corpus !== descriptor.corpus ||
        caseItem.historicalRegistration.truth.registeredRootCount !== descriptor.expectedBugCount ||
        canonicalJsonSha256(caseItem.rawScope) !== registration.scopeSha256ByCase[caseItem.caseName] ||
        caseItem.laneActivation.rawScopeSha256 !== registration.scopeSha256ByCase[caseItem.caseName]) {
      throw new Error("methodology input-plan case differs from the invocation registration");
    }
  }
}

function assertStageContractsMatchRegistration(
  cases: MethodologyInputPlanCase[],
  stages: MethodologyStageContract[],
  assetsByArm: MethodologyAssetManifest[],
): void {
  const expectedKeys = cases.flatMap((caseItem) => METHODOLOGY_ARM_IDS.flatMap((armId) =>
    armId === "C" || armId === "D"
      ? [`${caseItem.caseName}\0${armId}\0${1}`, `${caseItem.caseName}\0${armId}\0${2}`]
      : [`${caseItem.caseName}\0${armId}\0${1}`]));
  const observedKeys = stages.map((stage) => `${stage.caseName}\0${stage.armId}\0${stage.stageIndex}`);
  if (canonicalJson(observedKeys) !== canonicalJson(expectedKeys)) {
    throw new Error("methodology input-plan stages do not match the registered topology");
  }
  for (const stage of stages) {
    const caseItem = cases.find((candidate) => candidate.caseName === stage.caseName)!;
    const assets = assetsByArm.find((candidate) => candidate.armId === stage.armId)!;
    const expectedSchema = stage.stageIndex === 2 || stage.armId === "A" || stage.armId === "B"
      ? "schemas/methodology-review.schema.json"
      : stage.armId === "C" ? "schemas/methodology-discovery.schema.json" : "schemas/breadth-result.schema.json";
    const compiledSchema = stage.kind === "static-prompt" ? stage.compiled.schemaPath : stage.schemaPath;
    const rawScopeSha256 = stage.kind === "static-prompt" ? stage.compiled.rawScopeSha256 : stage.rawScopeSha256;
    if (stage.assetsTreeSha256 !== assets.treeSha256 || compiledSchema !== expectedSchema ||
        !assets.files.some((file) => file.path === expectedSchema) ||
        rawScopeSha256 !== canonicalJsonSha256(caseItem.rawScope)) {
      throw new Error("methodology input-plan stage differs from registered assets or scope");
    }
  }
}

function parseInvocation(value: unknown): MethodologyInvocationInput {
  const root = exactObject(value, "methodology planned invocation", [
    "attemptId", "stageIndex", "compiled", "assets", "schemaText", "model", "effort",
    "stageMaximumMs", "attemptDeadlineAt", "previousOutput", "requestedAt",
  ]);
  if (typeof root.attemptId !== "string" || (root.stageIndex !== 1 && root.stageIndex !== 2) ||
      typeof root.schemaText !== "string" || root.model !== "gpt-5.6-sol" || root.effort !== "high" ||
      !Number.isSafeInteger(root.stageMaximumMs) || Number(root.stageMaximumMs) <= 0 ||
      typeof root.attemptDeadlineAt !== "string" || typeof root.requestedAt !== "string" ||
      !(root.previousOutput === null || typeof root.previousOutput === "string")) {
    throw new Error("methodology planned invocation is invalid");
  }
  return { attemptId: root.attemptId, stageIndex: root.stageIndex,
    compiled: parseCompiled(root.compiled, "methodology planned invocation"),
    assets: parseMethodologyAssetManifest(root.assets), schemaText: root.schemaText,
    model: "gpt-5.6-sol", effort: "high", stageMaximumMs: Number(root.stageMaximumMs),
    attemptDeadlineAt: root.attemptDeadlineAt, previousOutput: root.previousOutput,
    requestedAt: root.requestedAt };
}

function canonicalHandoff(armId: "C" | "D", raw: string): { text: string; sha256: string } {
  const parsed: unknown = JSON.parse(raw);
  const text = canonicalJson(armId === "C"
    ? parseMethodologyDiscoveryOutput(parsed)
    : parseBreadthResult(parsed, "methodology planned breadth handoff"));
  return { text, sha256: sha256(text) };
}

function renderHandoffTemplate(template: string, handoff: string): string {
  if (template.split(HANDOFF_SLOT).length !== 2) throw new Error("methodology handoff template is invalid");
  return template.replace(HANDOFF_SLOT, handoff);
}

function dummyDiscovery() {
  return { status: "completed" as const, limitations: [] as string[], candidates: [] as never[] };
}

function dummyBreadth(path: string) {
  return { model: "gpt-5.6-sol", candidates: [], clear: [], escalations: [],
    coverage: { coveredFiles: [path], unavailable: [] } };
}

function parseArmId(value: unknown): MethodologyArmId {
  if (!METHODOLOGY_ARM_IDS.includes(value as MethodologyArmId)) throw new Error("methodology input-plan arm is invalid");
  return value as MethodologyArmId;
}

function assertNoBegunMethodologyWork(root: string): void {
  const begun = /(?:^|\/)(?:attempt-[0-9]{6}[^/]*\.json|methodology-run-(?:stop|terminal-seal)\.json)$/;
  const visit = (directory: string, prefix = ""): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error("methodology input-plan evidence tree must not contain symlinks");
      if (entry.isDirectory()) visit(join(directory, entry.name), relative);
      else if (!entry.isFile()) throw new Error("methodology input-plan evidence tree contains an unsupported entry");
      else if (begun.test(relative)) {
        throw new Error("methodology input plan cannot be registered after attempt work has begun");
      }
    }
  };
  visit(root);
}

function exactObject(
  value: unknown,
  source: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source} must be an object`);
  const root = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.hasOwn(root, key)) || Object.keys(root).some((key) => !allowed.has(key))) {
    throw new Error(`${source} has invalid fields`);
  }
  return root;
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}
