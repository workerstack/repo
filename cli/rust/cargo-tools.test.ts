import { expect, it } from "vitest";
import type { CargoResult, CargoRun } from "./clippy.ts";
import { DENY_PIN, LLVM_COV_PIN, NEXTEST_PIN, SHEAR_PIN } from "./cargo-tools.constants.ts";
import { shearProblems } from "./shear-problems.ts";
import { denyProblems, pinProblem } from "./cargo-tools.ts";

const result = (over: Partial<CargoResult>): CargoResult => ({
  status: 0,
  stdout: "",
  stderr: "",
  missing: false,
  ...over,
});
const fake =
  (out: Partial<CargoResult>): CargoRun =>
  () =>
    result(out);

const REJECTED =
  '{"fields":{"code":"rejected","graphs":[{"Krate":{"name":"b","version":"0.1.0"}}],"labels":[{"column":10,"line":6,"message":"","span":"GPL-3.0-only"},{"column":10,"line":6,"message":"rejected: license is not explicitly allowed","span":"GPL-3.0-only"}],"message":"failed to satisfy license requirements","notes":["GPL-3.0-only - GNU General Public License v3.0 only:"],"severity":"error"},"type":"diagnostic"}';
const SUMMARY = '{"fields":{"advisories":{"errors":0,"helps":0,"notes":0,"warnings":0}},"type":"summary"}';
const WARNING =
  '{"fields":{"code":"license-not-encountered","labels":[],"message":"license was not encountered","severity":"warning"},"type":"diagnostic"}';
const FETCH =
  '{"fields":{"level":"ERROR","message":"failed to fetch advisory database https://github.com/RustSec/advisory-db with cli: failed to clone: [...]\\nfatal: unable to access","timestamp":"t"},"type":"log"}';
const SHEAR =
  '{"summary":{"errors":1,"warnings":0,"fixed":0},"findings":[{"code":"shear/unused_dependency","severity":"error","message":"unused dependency `itoa`","file":"a/Cargo.toml","location":{"offset":115,"length":4},"help":"remove this dependency","fixable":true}]}';
const INSTALL_DENY = "cargo install --locked cargo-deny@0.20.2";

it("names the rejected license with its crate, section and label", () => {
  const run = fake({ status: 4, stderr: `${REJECTED}\n${SUMMARY}\n` });
  expect(denyProblems("/r", run)).toEqual([
    "cargo deny: licenses: b 0.1.0: failed to satisfy license requirements (GPL-3.0-only: rejected: license is not explicitly allowed)",
  ]);
});

it("runs deny locked with json output", () => {
  const seen: string[][] = [];
  const run: CargoRun = (_root, args) => {
    seen.push([...args]);
    return result({});
  };
  denyProblems("/r", run);
  expect(seen).toEqual([["deny", "--locked", "--format", "json", "check"]]);
});

it("passes a clean deny run and ignores warnings", () => {
  expect(denyProblems("/r", fake({ stderr: `${SUMMARY}\n` }))).toEqual([]);
  expect(denyProblems("/r", fake({ stderr: `${WARNING}\n${SUMMARY}\n` }))).toEqual([]);
});

it("turns the advisory fetch log into one line asking for the network", () => {
  const out = denyProblems("/r", fake({ status: 1, stderr: `${FETCH}\n` }));
  expect(out).toEqual([
    "cargo deny: failed to fetch advisory database https://github.com/RustSec/advisory-db; check the network and rerun",
  ]);
});

it("prints the first line of any other error log", () => {
  const log = '{"fields":{"level":"ERROR","message":"boom\\nmore"},"type":"log"}';
  expect(denyProblems("/r", fake({ status: 1, stderr: `${log}\n` }))).toEqual(["cargo deny: boom"]);
  const info = '{"fields":{"level":"INFO","message":"hi"},"type":"log"}';
  expect(denyProblems("/r", fake({ stderr: info }))).toEqual([]);
});

it("omits the section of an unknown code and the crate of a graph-less diagnostic", () => {
  const odd = '{"fields":{"code":"zzz","message":"odd","severity":"error","labels":[]},"type":"diagnostic"}';
  expect(denyProblems("/r", fake({ status: 2, stderr: odd }))).toEqual(["cargo deny: odd"]);
  const bare = '{"fields":{"message":"bare","severity":"error"},"type":"diagnostic"}';
  expect(denyProblems("/r", fake({ status: 2, stderr: bare }))).toEqual(["cargo deny: bare"]);
  const bans =
    '{"fields":{"code":"wildcard","message":"wild","severity":"error","graphs":[{"Other":1}]},"type":"diagnostic"}';
  expect(denyProblems("/r", fake({ status: 2, stderr: bans }))).toEqual(["cargo deny: bans: wild"]);
});

it("quotes the stderr when deny fails with no error line", () => {
  const info = `{"fields":{"level":"INFO","message":"${"x".repeat(100)}"},"type":"log"}`;
  const out = denyProblems("/r", fake({ status: 1, stderr: `${info}\n` }));
  expect(out).toEqual([`cargo deny exited 1 and printed no error: ${info.slice(0, 80)}...`]);
  expect(denyProblems("/r", fake({ status: 3 }))).toEqual(["cargo deny exited 3 and printed no error"]);
  expect(denyProblems("/r", fake({ status: 1, stderr: '{"type":"summary"}' }))).toEqual([
    'cargo deny exited 1 and printed no error: {"type":"summary"}',
  ]);
});

it("reports a deny line it cannot read", () => {
  const out = denyProblems(
    "/r",
    fake({ stderr: `not json\n{"type":"diagnostic"}\n{"type":"log"}\n{}\n${"y".repeat(90)}\n` }),
  );
  expect(out).toEqual([
    "cargo deny printed a line repo cannot read: not json",
    'cargo deny printed a line repo cannot read: {"type":"diagnostic"}',
    'cargo deny printed a line repo cannot read: {"type":"log"}',
    "cargo deny printed a line repo cannot read: {}",
    `cargo deny printed a line repo cannot read: ${"y".repeat(80)}...`,
  ]);
});

it("says so when cargo is missing for deny", () => {
  const out = denyProblems("/r", fake({ status: 1, missing: true }));
  expect(out).toHaveLength(1);
  expect(out[0]).toContain("cargo is not on PATH");
});

it("names an unused dependency with what to do", () => {
  const run = fake({ status: 1, stdout: SHEAR });
  expect(shearProblems("/r", run)).toEqual([
    "cargo shear: a/Cargo.toml: unused dependency `itoa`; remove it or list it under [package.metadata.cargo-shear] ignored",
  ]);
});

it("runs shear locked with json output", () => {
  const seen: string[][] = [];
  const run: CargoRun = (_root, args) => {
    seen.push([...args]);
    return result({ stdout: '{"summary":{},"findings":[]}' });
  };
  expect(shearProblems("/r", run)).toEqual([]);
  expect(seen).toEqual([["shear", "--locked", "--format=json"]]);
});

it("turns a backslash shear file into a POSIX path and appends the help of other codes", () => {
  const finding = {
    code: "shear/misplaced",
    severity: "warning",
    message: "misplaced",
    file: "a\\b\\Cargo.toml",
    help: "move it",
  };
  const stdout = JSON.stringify({ summary: {}, findings: [finding, { code: "x", severity: "error", message: "m" }] });
  expect(shearProblems("/r", fake({ status: 1, stdout }))).toEqual([
    "cargo shear: a/b/Cargo.toml: misplaced; move it",
    "cargo shear: m",
  ]);
});

it("quotes shear's stderr on exit 2", () => {
  const out = shearProblems("/r", fake({ status: 2, stderr: `${"e".repeat(100)}` }));
  expect(out).toEqual([`cargo shear exited 2: ${"e".repeat(80)}...`]);
  expect(shearProblems("/r", fake({ status: null }))).toEqual(["cargo shear exited null"]);
});

it("reports shear output it cannot read", () => {
  expect(shearProblems("/r", fake({ stdout: "oops" }))).toEqual(["cargo shear printed output repo cannot read: oops"]);
  expect(shearProblems("/r", fake({ stdout: "{}" }))).toEqual(["cargo shear printed output repo cannot read: {}"]);
});

it("reports shear exit 1 with no finding and missing cargo", () => {
  const out = shearProblems("/r", fake({ status: 1, stdout: '{"summary":{},"findings":[]}' }));
  expect(out).toEqual(["cargo shear exited 1 and printed no finding"]);
  expect(shearProblems("/r", fake({ status: 1, missing: true }))[0]).toContain("cargo is not on PATH");
});

it("says a tool is not installed in both forms", () => {
  const want = `cargo-deny is not installed; run \`${INSTALL_DENY}\``;
  const stderr = "error: no such command: `deny`";
  expect(pinProblem("/r", fake({ status: 101, stderr }), DENY_PIN)).toBe(want);
  expect(pinProblem("/r", fake({ status: 1, missing: true }), DENY_PIN)).toBe(want);
});

it("names the installed version when it is not the pin", () => {
  const run = fake({ stdout: "cargo-deny 0.19.0\n" });
  expect(pinProblem("/r", run, DENY_PIN)).toBe(
    `cargo-deny 0.19.0 is installed but repo pins 0.20.2; run \`${INSTALL_DENY}\``,
  );
});

it("accepts the pinned version in both output forms", () => {
  expect(pinProblem("/r", fake({ stdout: "cargo-deny 0.20.2\n" }), DENY_PIN)).toBeNull();
  expect(pinProblem("/r", fake({ stdout: "Version: 1.14.0\n" }), SHEAR_PIN)).toBeNull();
});

it("pins nextest and llvm-cov, reading the version before the build text", () => {
  expect(NEXTEST_PIN).toEqual({ tool: "nextest", version: "0.9.151" });
  expect(LLVM_COV_PIN).toEqual({ tool: "llvm-cov", version: "0.9.1" });
  const nextest = fake({ stdout: "cargo-nextest 0.9.151 (6b3f99457 2026-11-02)\n" });
  expect(pinProblem("/r", nextest, NEXTEST_PIN)).toBeNull();
  expect(pinProblem("/r", fake({ stdout: "cargo-llvm-cov 0.9.1\n" }), LLVM_COV_PIN)).toBeNull();
});

it("tells how to install a missing or wrong nextest or llvm-cov", () => {
  expect(pinProblem("/r", fake({ missing: true }), NEXTEST_PIN)).toBe(
    "cargo-nextest is not installed; run `cargo install --locked cargo-nextest@0.9.151`",
  );
  expect(pinProblem("/r", fake({ stdout: "cargo-llvm-cov 0.8.0\n" }), LLVM_COV_PIN)).toBe(
    "cargo-llvm-cov 0.8.0 is installed but repo pins 0.9.1; run `cargo install --locked cargo-llvm-cov@0.9.1`",
  );
});

it("reports a version output with no version", () => {
  const out = pinProblem("/r", fake({ stdout: "hello", stderr: "" }), SHEAR_PIN);
  expect(out).toBe("cargo-shear printed a version repo cannot read: hello");
  expect(pinProblem("/r", fake({ status: 2, stderr: "bad" }), SHEAR_PIN)).toBe("cargo-shear --version exited 2: bad");
});

it("leaves out the no-license errors of the crates it is told to, never another crate's", () => {
  const line = (code: string, name: string) =>
    `{"fields":{"code":"${code}","message":"${name} is unlicensed","severity":"error","graphs":[{"Krate":{"name":"${name}","version":"0.1.0"}}]},"type":"diagnostic"}`;
  const stderr = [
    line("unlicensed", "b"),
    line("no-license-field", "b"),
    line("unlicensed", "dep"),
    line("rejected", "b"),
  ];
  const out = denyProblems("/r", fake({ status: 4, stderr: stderr.join("\n") }), new Set(["b"]));
  expect(out).toEqual([
    "cargo deny: licenses: dep 0.1.0: dep is unlicensed",
    "cargo deny: licenses: b 0.1.0: b is unlicensed",
  ]);
  const only = fake({ status: 4, stderr: line("unlicensed", "b") });
  expect(denyProblems("/r", only, new Set(["b"]))).toEqual([]);
});
