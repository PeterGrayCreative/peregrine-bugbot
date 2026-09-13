import assert from "node:assert/strict";
import test from "node:test";
import { fixtureContainer, fixtureIdentity, fixtureNetwork, sidecarHostFixture } from "./eval-methodology-inspect-fixture.js";
import { ACCEPTED_METHODOLOGY_EGRESS_IMAGE, METHODOLOGY_EGRESS_BASE_ENV } from "../eval/methodology-egress.js";
import { METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE } from "../eval/methodology-runtime-image.js";
import { parseObservationRecords, parseStrictIpv4, parseStrictIpv4Cidr, observationSubnet, observationTimestamp, observationReceiptTimestamp,
  validateMethodologyObservationGraph, validateMethodologyDeadlinePhases, type ObservationGraph, type ContainerExpectation } from "../eval/methodology-observation.js";

// An independently assembled prospective profile, not real running evidence.
function fixture(): ObservationGraph {
  const at = Date.parse("2026-09-13T12:00:00Z");
  const helper = (index: 0 | 1): ContainerExpectation => ({ name: index ? "forwarder" : "gateway", network: "internal", externalNetwork: "external",
    subnet: "10.254.1.0/28", externalSubnet: "10.254.2.0/28", image: ACCEPTED_METHODOLOGY_EGRESS_IMAGE,
    entrypoint: index ? "/usr/local/bin/peregrine-methodology-mcp-forwarder" : "/usr/local/bin/peregrine-egress-gateway",
    alias: index ? "mcp-forwarder" : "egress-gateway", env: {}, baseEnv: METHODOLOGY_EGRESS_BASE_ENV, ...(index ? { addHost: "host.docker.internal:host-gateway" } : {}) });
  const helpers: [ContainerExpectation, ContainerExpectation] = [helper(0), helper(1)];
  const receipt = (start: number, stdout: string) => ({ startedAt: at + start, closedAt: at + start + 1, stdout });
  const containers = helpers.map((h, index) => fixtureContainer({ ...h, index, at: at + 20 + index * 2, external: h.externalNetwork, env: [...h.baseEnv] }, sidecarHostFixture(h.externalNetwork, h.addHost)));
  const networks = [fixtureNetwork({ name: "internal", subnet: helpers[0].subnet, internal: true, names: helpers.map(h => h.name), at: at + 12 }),
    fixtureNetwork({ name: "external", subnet: helpers[0].externalSubnet, internal: false, names: helpers.map(h => h.name), at: at + 10 })];
  return { helpers, containers, networks, networkCreates: [receipt(12, fixtureIdentity("internal") + "\n"), receipt(10, fixtureIdentity("external") + "\n")],
    launches: [receipt(20, fixtureIdentity("gateway") + "\n"), receipt(22, fixtureIdentity("forwarder") + "\n")], containerInspect: receipt(30, JSON.stringify(containers)),
    networkInspects: [receipt(40, JSON.stringify([networks[0]])), receipt(42, JSON.stringify([networks[1]]))] };
}
function repin(f: ObservationGraph) {
  f.containerInspect.stdout = JSON.stringify(f.containers);
  f.networkInspects.forEach((r, index) => { r.stdout = JSON.stringify([f.networks[index]]); });
}
function reject(mutate: (f: any) => void, label: string) {
  const f = fixture(); mutate(f); repin(f); assert.throws(() => validateMethodologyObservationGraph(f), Error, label);
}

test("gate v7 reproduction: distinct SandboxIDs cannot alias one namespace path", () => {
  for (const index of [0, 1]) reject(f => {
    const target = f.containers[index].NetworkSettings, other = f.containers[1 - index].NetworkSettings;
    target.SandboxID = other.SandboxID.slice(0, 12) + "f".repeat(52);
    target.SandboxKey = other.SandboxKey;
    assert.notEqual(target.SandboxID, other.SandboxID);
  }, "distinct full IDs sharing validated prefix/path");
});

function phaseFixture() {
  const clock = (elapsed: number) => ({ kind: "node-performance-clock-v1", processId: 4242, timeOriginMs: 1_700_000_000_000,
    monotonicMs: 1000.25 + elapsed, unixMs: 1_700_000_001_000 + Math.floor(0.25 + elapsed) });
  const row = (a: number, b: number) => ({ start: { startedAt: clock(a).unixMs, clock: clock(a) }, terminal: { closedAt: clock(b).unixMs, clock: clock(b) } });
  const deadline = { kind: "prediction-cli-deadline-terminal-v2", clock: clock(0), elapsedMs: 310,
    events: ["start", "exec-start", "exec-closed", "teardown-complete"].map((kind, i) => ({ kind, elapsedMs: i * 100 })) };
  return { deadline, phases: { preparation: [row(10, 11), row(30, 33)], execution: [row(100, 101), row(105, 106), row(110, 111)], teardown: [row(220, 221), row(243, 244)] }, clock, row };
}
const phaseNames = ["preparation", "execution", "teardown"] as const;
test("deadline phases follow setup, contained client plus remove/absence, then sidecar teardown", () => {
  const f = phaseFixture(); validateMethodologyDeadlinePhases(f.deadline, f.phases);
  for (let phase = 0; phase < 3; phase++) {
    const exact = phaseFixture(); exact.phases[phaseNames[phase]!] = [exact.row(phase * 100, (phase + 1) * 100)];
    if (phase === 0) exact.phases.execution[0] = exact.row(100, 101);
    validateMethodologyDeadlinePhases(exact.deadline, exact.phases);
  }
  for (const times of [[0,100,100,300], [0,100,200,200], [0,0,200,300], [0,101,100,300], [100,0,200,300], [0,100,301,300]]) {
    const invalid = phaseFixture(); invalid.deadline.events.forEach((e, i) => { e.elapsedMs = times[i]!; });
    assert.throws(() => validateMethodologyDeadlinePhases(invalid.deadline, invalid.phases), Error, String(times));
  }
});
test("every clocked receipt rejects out-of-phase endpoints, overlap and foreign clock identities", () => {
  let cases = 0;
  for (const [phase, name] of phaseNames.entries()) for (let rowIndex = 0; rowIndex < phaseFixture().phases[name].length; rowIndex++) {
    const check = (mutate: (f: ReturnType<typeof phaseFixture>) => void) => { const f = phaseFixture(); mutate(f); assert.throws(() => validateMethodologyDeadlinePhases(f.deadline, f.phases)); cases++; };
    for (const point of ["start", "terminal"] as const) {
      const key = point === "start" ? "startedAt" : "closedAt";
      check(f => { const r = f.phases[name][rowIndex]![point] as any; const at = point === "start" ? phase * 100 - 0.000001 : (phase + 1) * 100 + 0.000001; r.clock = f.clock(at); r[key] = r.clock.unixMs; });
      for (const mutation of [(c: any) => { c.processId++; }, (c: any) => { c.timeOriginMs++; }, (c: any) => { c.kind = "other-clock"; }, (c: any) => { c.unixMs += 2; }, (c: any) => { c.monotonicMs += 2; }, (c: any) => { delete c.monotonicMs; }, (c: any) => { c.extra = 0; }])
        check(f => mutation(f.phases[name][rowIndex]![point].clock));
      check(f => { const r = f.phases[name][rowIndex]![point] as any; r.clock.unixMs += 5000; r[key] += 5000; });
    }
    check(f => { const r = f.phases[name][rowIndex]!; r.terminal.clock = f.clock(r.start.clock.monotonicMs - f.deadline.clock.monotonicMs - 0.000001); r.terminal.closedAt = r.terminal.clock.unixMs; });
    if (rowIndex) check(f => { const r = f.phases[name][rowIndex]!, previous = f.phases[name][rowIndex - 1]!; r.start.clock = f.clock(previous.terminal.clock.monotonicMs - f.deadline.clock.monotonicMs - 0.000001); r.start.startedAt = r.start.clock.unixMs; });
  }
  assert.equal(cases, 137);
});
test("phase clock quantization is exactly 1ms and cannot justify a zero positive-duration phase", () => {
  for (const delta of [-1, 1]) {
    const f = phaseFixture(), r = f.phases.execution[1]!;
    r.start.clock.unixMs += delta; r.start.startedAt += delta;
    validateMethodologyDeadlinePhases(f.deadline, f.phases);
  }
  for (const delta of [-2, 2]) {
    const f = phaseFixture(), r = f.phases.execution[1]!;
    r.start.clock.unixMs += delta; r.start.startedAt += delta;
    assert.throws(() => validateMethodologyDeadlinePhases(f.deadline, f.phases), /quantization/);
  }
  const f = phaseFixture(); f.deadline.events[2]!.elapsedMs = 100; f.phases.execution = [f.row(100, 100)];
  f.phases.execution[0]!.terminal.clock.unixMs++; f.phases.execution[0]!.terminal.closedAt++;
  assert.throws(() => validateMethodologyDeadlinePhases(f.deadline, f.phases), /positive wall span/);
});
test("shared quantization cannot accumulate opposite endpoint errors into a wider phase", () => {
  const f = phaseFixture(); f.deadline.events[2]!.elapsedMs = 100.1; f.phases.execution = [f.row(100, 100)];
  const row = f.phases.execution[0]!;
  row.start.startedAt--; row.start.clock.unixMs--; row.terminal.closedAt++; row.terminal.clock.unixMs++;
  assert.throws(() => validateMethodologyDeadlinePhases(f.deadline, f.phases), /positive wall span/);
  const spread = phaseFixture(); spread.phases.preparation[0]!.start.startedAt--; spread.phases.preparation[0]!.start.clock.unixMs--;
  spread.phases.teardown[1]!.terminal.closedAt++; spread.phases.teardown[1]!.terminal.clock.unixMs++;
  assert.throws(() => validateMethodologyDeadlinePhases(spread.deadline, spread.phases), /shared 1ms quantization/);
  const zero = phaseFixture(); zero.deadline.events[2]!.elapsedMs = 100; zero.phases.execution = [zero.row(100,100), zero.row(100,100)];
  zero.phases.execution[1]!.start.startedAt++; zero.phases.execution[1]!.start.clock.unixMs++;
  zero.phases.execution[1]!.terminal.closedAt++; zero.phases.execution[1]!.terminal.clock.unixMs++;
  assert.throws(() => validateMethodologyDeadlinePhases(zero.deadline, zero.phases), /positive wall span/);
});
test("phase evidence fails closed on missing source, impossible whole intervals and source-origin drift", () => {
  for (const mutation of [(d: any) => { delete d.clock; }, (d: any) => { d.kind = "prediction-cli-deadline-terminal-v1"; }, (d: any) => { d.clock.unixMs += 2; }, (d: any) => { d.clock.monotonicMs = NaN; }, (d: any) => { d.clock.timeOriginMs = -1; }, (d: any) => { d.clock.processId = 0; }, (d: any) => { d.elapsedMs = 1200000; }, (d: any) => { d.elapsedMs = 100; }, (d: any) => { d.events.reverse(); }]) {
    const f = phaseFixture(); mutation(f.deadline); assert.throws(() => validateMethodologyDeadlinePhases(f.deadline, f.phases));
  }
  for (const name of phaseNames) { const f = phaseFixture(); f.phases[name] = []; assert.throws(() => validateMethodologyDeadlinePhases(f.deadline, f.phases)); }
});

test("gate v7 reproduction: one-nanosecond producer inversions cannot collapse to equal milliseconds", () => {
  for (const index of [0, 1]) {
    reject(f => { f.containers[index].Created = new Date(f.launches[index].startedAt).toISOString().replace("Z", "000001Z"); }, "created one ns after started");
    reject(f => { f.containers[index].State.StartedAt = new Date(f.launches[index].closedAt).toISOString().replace("Z", "000001Z"); }, "started one ns after launch closed");
    reject(f => { f.networks[index].Created = new Date(f.networkCreates[index].closedAt).toISOString().replace("Z", "000001Z"); }, "network created one ns after receipt closed");
  }
});

test("canonical running graph accepts the registered two-helper topology and pretty complete JSON", () => {
  const f = fixture(); validateMethodologyObservationGraph(f);
  f.containerInspect.stdout = JSON.stringify(f.containers, null, 2); validateMethodologyObservationGraph(f);
  for (const text of ["", "{}\n{}", "bad\n{}", "[]", "[null]", "[{},false]", "null", "1", '"x"']) assert.throws(() => parseObservationRecords(text));
  assert.deepEqual(parseObservationRecords("{}"), [{}]);
  for (const text of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"State":{"Running":false,"Running":true}}', '[{"a":[{"x":1,"x":2}]}]']) assert.throws(() => parseObservationRecords(text), /duplicate raw/);
  assert.deepEqual(parseObservationRecords('{"a":{"a":1},"b":[{"a":2}],"escaped":"\\\"{}:[],"}'), [{ a: { a: 1 }, b: [{ a: 2 }], escaped: '"{}:[],' }]);
});

test("canonical schema rejects deletion, type substitution and extras at every retained object key", t => {
  const original = fixture(); let cases = 0;
  const visit = (value: any, path: (string | number)[]) => {
    if (!value || typeof value !== "object") return;
    const locate = (f: any) => path.reduce((v, key) => v[key], f);
    if (!Array.isArray(value)) {
      reject(f => { locate(f).__unregistered = null; }, path.join(".") + " unknown"); cases++;
      for (const key of Object.keys(value)) {
        reject(f => { delete locate(f)[key]; }, path.join(".") + " missing " + key); cases++;
        reject(f => { locate(f)[key] = { __unregistered: "host" }; }, path.join(".") + " substitution " + key); cases++;
      }
    } else {
      reject(f => { locate(f).push("__unregistered"); }, path.join(".") + " extra array entry"); cases++;
    }
    for (const key of Object.keys(value)) visit(value[key], [...path, key]);
  };
  original.containers.forEach((v, i) => visit(v, ["containers", i]));
  original.networks.forEach((v, i) => visit(v, ["networks", i]));
  t.diagnostic(`Exhaustive retained-object traversal: ${cases} rejected schema mutations`);
});

test("only explicit harmless default variants are normalized", () => {
  const f: any = fixture();
  for (const c of f.containers) {
    c.Config.Cmd = []; c.Config.ArgsEscaped = true; c.Config.Env.reverse();
    for (const key of ["Binds", "VolumesFrom", "CapAdd", "Dns", "GroupAdd", "Links", "DeviceCgroupRules", "DeviceRequests"]) c.HostConfig[key] = [];
    c.Config.Labels = Object.fromEntries(Object.entries(c.Config.Labels).reverse());
    c.HostConfig.Tmpfs = Object.fromEntries(Object.entries(c.HostConfig.Tmpfs).reverse());
  }
  repin(f); validateMethodologyObservationGraph(f);
  for (let i = 0; i < 2; i++) {
    const name = f.helpers[i].name, alias = f.helpers[i].alias, id = f.containers[i].Id.slice(0, 12);
    for (const aliases of [[alias], [alias, name], [alias, name, id]]) { f.containers[i].NetworkSettings.Networks.internal.Aliases = aliases; repin(f); validateMethodologyObservationGraph(f); }
    for (const aliases of [null, [], [name], [name, id]]) { f.containers[i].NetworkSettings.Networks.external.Aliases = aliases; repin(f); validateMethodologyObservationGraph(f); }
  }
  for (const value of [false, null, [], "true", 1]) reject(f => { f.containers[0].Config.ArgsEscaped = value; }, "ArgsEscaped " + JSON.stringify(value));
});

function metadata(c: any) {
  return { ResolvConfPath: `/var/lib/docker/containers/${c.Id}/resolv.conf`, HostnamePath: `/var/lib/docker/containers/${c.Id}/hostname`, HostsPath: `/var/lib/docker/containers/${c.Id}/hosts`,
    LogPath: `/var/lib/docker/containers/${c.Id}/${c.Id}-json.log`, Driver: "overlayfs", Platform: "linux", MountLabel: "", ProcessLabel: "", AppArmorProfile: "", ExecIDs: null,
    Storage: { RootFS: { Snapshot: { Name: "overlayfs" } } }, ImageManifestDescriptor: { mediaType: "application/vnd.oci.image.manifest.v1+json", digest: METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE.platforms["linux/arm64"], size: 2951, platform: { architecture: "arm64", os: "linux" } } };
}
test("optional inert producer metadata is validated fully whenever present", () => {
  const f: any = fixture(); f.containers.forEach((c: any) => Object.assign(c, metadata(c))); repin(f); validateMethodologyObservationGraph(f);
  for (const key of Object.keys(metadata(f.containers[0]))) {
    const invalid = structuredClone(f); invalid.containers[0][key] = { unexpected: "host" }; repin(invalid); assert.throws(() => validateMethodologyObservationGraph(invalid), Error, key);
    if (key !== "ImageManifestDescriptor") { const absent = structuredClone(f); delete absent.containers[0][key]; repin(absent); validateMethodologyObservationGraph(absent); }
  }
  for (const path of [["Storage"], ["Storage", "RootFS"], ["Storage", "RootFS", "Snapshot"], ["ImageManifestDescriptor"], ["ImageManifestDescriptor", "platform"]]) {
    const get = (v: any) => path.reduce((v, k) => v[k], v.containers[0]);
    for (const key of Object.keys(get(f))) {
      const missing = structuredClone(f); delete get(missing)[key]; repin(missing); assert.throws(() => validateMethodologyObservationGraph(missing), Error, path + " missing " + key);
      const changed = structuredClone(f); get(changed)[key] = "unregistered"; repin(changed); assert.throws(() => validateMethodologyObservationGraph(changed), Error, path + " changed " + key);
    }
    const extra = structuredClone(f); get(extra).Unknown = null; repin(extra); assert.throws(() => validateMethodologyObservationGraph(extra));
  }
  const configIds = ["sha256:62865aa83e5c9dcaf99e9a3a4689b5ec6ce2425faec19a34e1de15765834bc20", "sha256:dbc568e7993b88d86cfcb64a95e5806b46197b0cffafdcaf1fcd71eec0b33c97"];
  for (const [i, arch] of ["amd64", "arm64"].entries()) {
    const valid = structuredClone(f); valid.containers.forEach((c: any) => { c.Image = configIds[i]; c.ImageManifestDescriptor.digest = METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE.platforms[("linux/" + arch) as "linux/arm64"]; c.ImageManifestDescriptor.platform.architecture = arch; }); repin(valid); validateMethodologyObservationGraph(valid);
    valid.containers[0].Image = configIds[1 - i]; repin(valid); assert.throws(() => validateMethodologyObservationGraph(valid));
  }
});

test("IPv4 CIDR and producer timestamps parse canonically without suffix loss or date normalization", () => {
  for (const value of [null, "10.0.0.2", "10.0.0.2/28/x", "10.0.0.2//28", "10.0.0.2/028", "10.0.0.2/+28", "10.0.0.2/ 28", "10.0.0.2/28 ", "10.0.0.2/33", "10.0.0.2/2.8", "10.0.0.2/2e1", "10.00.0.2/28", "256.0.0.2/28"]) assert.throws(() => parseStrictIpv4Cidr(value), Error, String(value));
  for (const value of ["10.0.0.2/0", "10.0.0.2/28", "10.0.0.2/32"]) assert.equal(parseStrictIpv4Cidr(value).address, "10.0.0.2");
  for (const value of ["10.0.0.0/0", "10.0.0.1/28", "10.0.0.0/32"]) assert.throws(() => observationSubnet(value));
  for (const value of [null, "1.2.3", "1.2.3.4.5", "01.2.3.4", "1.2.3.256", "1.2.3.-1", "1.2.3.4\n"]) assert.throws(() => parseStrictIpv4(value));
  for (const value of [null, 0, "0001-01-01T00:00:00Z", "1970-01-01T00:00:00Z", "2026-02-31T00:00:00Z", "2026-09-13", "2026-09-13T00:00:00+00:00", "2026-09-13T24:00:00Z", "2026-09-13T00:00:00.1234567890Z"]) assert.throws(() => observationTimestamp(value));
  assert.equal(observationTimestamp("2026-09-13T00:00:00.123456789Z"), BigInt(Date.parse("2026-09-13T00:00:00Z")) * 1_000_000n + 123_456_789n);
});

test("nanosecond chronology preserves accepted producer forms and rejects strict boundary inversions", () => {
  const second = "2026-09-13T12:00:00", base = observationTimestamp(second + "Z");
  for (let digits = 1; digits <= 9; digits++) {
    const fraction = "123456789".slice(0, digits);
    assert.equal(observationTimestamp(second + "." + fraction + "Z"), base + BigInt(fraction.padEnd(9, "0")));
    assert.equal(observationTimestamp(second + "." + "0".repeat(digits) + "Z"), base);
  }
  assert.equal(observationTimestamp(second + ".999999999Z") + 1n, observationTimestamp("2026-09-13T12:00:01Z"));
  assert.equal(observationTimestamp("2024-02-29T23:59:59.999999999Z") + 1n, observationTimestamp("2024-03-01T00:00:00Z"));
  for (const value of [second + "Z\n", second + "Z\r\n", " " + second + "Z", second + ".Z", second + ".0000000001Z", second + ".1e-9Z", second + ".000000001+00:00", "2026-02-29T00:00:00Z", "2026-09-13T12:00:60Z", "2026-09-13t12:00:00z"]) assert.throws(() => observationTimestamp(value), Error, value);
  for (const value of [NaN, Infinity, -1, 1.000001, "1", Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => observationReceiptTimestamp(value));
  assert.equal(observationReceiptTimestamp(Number.MAX_SAFE_INTEGER), BigInt(Number.MAX_SAFE_INTEGER) * 1_000_000n);
  for (const index of [0, 1]) {
    const f: any = fixture(), time = new Date(f.launches[index].startedAt).toISOString();
    f.containers[index].Created = time.replace("Z", "000001Z");
    f.containers[index].State.StartedAt = time.replace("Z", "999999Z");
    repin(f); validateMethodologyObservationGraph(f);
    f.containers[index].State.StartedAt = f.containers[index].Created;
    repin(f); validateMethodologyObservationGraph(f);
    reject(f => { f.containers[index].State.FinishedAt = "0001-01-01T00:00:00.000000001Z"; }, "finished sentinel must remain exact");
    reject(f => { f.containers[index].State.FinishedAt = "0001-01-01T00:00:00.000000000Z"; }, "unregistered alternate finished sentinel");
    reject(f => { f.containers[index].Created = new Date(f.launches[index].startedAt - 1).toISOString().replace("Z", "999999Z"); }, "created one ns before launch start");
    reject(f => { f.networks[index].Created = new Date(f.networkCreates[index].startedAt - 1).toISOString().replace("Z", "999999Z"); }, "network one ns before create start");
    for (const kind of ["launches", "networkCreates", "networkInspects"] as const) {
      reject(f => { f[kind][index].startedAt += 0.000244140625; }, "fractional receipt start is not a producer millisecond");
      reject(f => { f[kind][index].closedAt += 0.000244140625; }, "fractional receipt close is not a producer millisecond");
    }
  }
});

test("every helper endpoint is cross-bound to static address, prefix, gateway, network/member identity and MAC", () => {
  for (const i of [0, 1]) for (const j of [0, 1]) {
    const network = j ? "external" : "internal";
    for (const [key, value] of Object.entries({ IPAddress: `10.254.${j + 1}.14`, IPPrefixLen: 0, Gateway: "10.254.9.1", NetworkID: "a".repeat(64), EndpointID: "b".repeat(64), MacAddress: "02:aa:bb:cc:dd:ee", GlobalIPv6Address: "2001:db8::1", GlobalIPv6PrefixLen: 64, IPv6Gateway: "::1" }))
      reject(f => { f.containers[i].NetworkSettings.Networks[network][key] = value; }, `${i}/${j}/${key}`);
    for (const [key, value] of Object.entries({ Name: "foreign", EndpointID: "c".repeat(64), MacAddress: "02:aa:bb:cc:dd:ee", IPv4Address: `10.254.${j + 1}.${i + 2}/0`, IPv6Address: "::" }))
      reject(f => { f.networks[j].Containers[f.containers[i].Id][key] = value; }, `${i}/${j}/member/${key}`);
    for (const suffix of ["", "/0", "/28/garbage"]) reject(f => { f.networks[j].Containers[f.containers[i].Id].IPv4Address = `10.254.${j + 1}.${i + 2}${suffix}`; }, "CIDR " + suffix);
    reject(f => { f.containers[i].NetworkSettings.Networks[network].IPAddress = `10.254.${j + 1}.14`; f.networks[j].Containers[f.containers[i].Id].IPv4Address = `10.254.${j + 1}.14/28`; }, "coherently wrong static address");
    reject(f => { const endpoint = f.containers[i].NetworkSettings.Networks[network]; endpoint.EndpointID = f.containers[i].Id; f.networks[j].Containers[f.containers[i].Id].EndpointID = endpoint.EndpointID; }, "cross-kind identity reuse");
    reject(f => { const endpoint = f.containers[i].NetworkSettings.Networks[network]; const other = f.containers[1-i].NetworkSettings.Networks[network]; endpoint.EndpointID = other.EndpointID; f.networks[j].Containers[f.containers[i].Id].EndpointID = other.EndpointID; }, "duplicate endpoint identity");
  }
});

test("running lifecycle, identity and creation/inspection/launch intervals cannot contradict", () => {
  for (const i of [0, 1]) {
    for (const [key, value] of Object.entries({ Running: false, Paused: true, Restarting: true, OOMKilled: true, Dead: true, Pid: 0, ExitCode: 1, Error: "failed", Status: "paused", StartedAt: "0001-01-01T00:00:00Z", FinishedAt: "2026-09-13T12:00:01Z" })) reject(f => { f.containers[i].State[key] = value; }, `${i}/state/${key}`);
    reject(f => { f.containers[i].State.Pid = f.containers[1-i].State.Pid; }, "duplicate live helper PID");
    reject(f => { f.containers[i].Created = new Date(f.launches[i].startedAt - 1).toISOString(); }, "created before launch");
    reject(f => { f.containers[i].State.StartedAt = new Date(f.launches[i].closedAt + 1).toISOString(); }, "started after launch closed");
    reject(f => { f.launches[i].stdout = "a".repeat(64) + "\n"; }, "launch identity");
    reject(f => { f.launches[i].closedAt = f.containerInspect.startedAt + 1; }, "launch after inspect");
    reject(f => { f.networkCreates[i].stdout = "a".repeat(64) + "\n"; }, "network creation identity");
    reject(f => { f.networks[i].Created = new Date(f.networkCreates[i].closedAt + 1).toISOString(); }, "network created outside receipt");
    reject(f => { f.networkCreates[i].closedAt = f.launches[0].startedAt + 1; }, "network creation after launch");
    reject(f => { f.networkInspects[i].startedAt = f.containerInspect.closedAt - 1; }, "network inspect precedes container inspect close");
  }
  reject(f => { f.containers.reverse(); }, "swapped helpers"); reject(f => { f.networks.reverse(); }, "swapped networks");
  reject(f => { f.launches.reverse(); }, "swapped launch identities"); reject(f => { f.networkCreates.reverse(); }, "swapped network identities");
  reject(f => { f.networkInspects[0].closedAt = f.networkInspects[1].startedAt + 1; }, "overlapping inspect receipts");
  reject(f => { f.launches[0].closedAt = f.launches[1].startedAt + 1; }, "overlapping launches");
  reject(f => { f.networkCreates[1].closedAt = f.networkCreates[0].startedAt + 1; }, "overlapping creates");
  for (const key of ["launches", "networkCreates", "networkInspects"] as const) for (const i of [0, 1]) reject(f => { f[key][i].closedAt = f[key][i].startedAt - 1; }, `negative interval ${key}/${i}`);
  const f = fixture(); f.containerInspect.stdout = "[]"; assert.throws(() => validateMethodologyObservationGraph(f));
});
