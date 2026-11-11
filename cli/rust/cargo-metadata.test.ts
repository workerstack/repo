import { expect, it } from "vitest";

import { crateProblems } from "./cargo-metadata.ts";
import type { CargoResult, CargoRun } from "./clippy.ts";

/** One `packages[]` entry as cargo 1.99.1 prints it for a workspace member. */
const entry = (name: string, fields: Record<string, unknown>, manifest = `/work/${name}/Cargo.toml`) => ({
  description: null,
  id: `${name} 0.1.0`,
  license: null,
  license_file: null,
  manifest_path: manifest,
  name,
  publish: null,
  repository: null,
  rust_version: null,
  version: "0.1.0",
  ...fields,
});
const FULL = { description: "d", license: "MIT", repository: "https://x", rust_version: "1.86" };

/** A runner that records its call and returns `packages` as the metadata, or `result` when given; `members` are the workspace member ids (all of `packages` by default). */
function cargo(packages: { id: string }[], result: Partial<CargoResult> = {}, members?: string[]) {
  const calls: { root: string; args: readonly string[] }[] = [];
  const run: CargoRun = (root, args) => {
    calls.push({ args, root });
    const ids = members ?? packages.map((pkg) => pkg.id);
    const stdout = JSON.stringify({ packages, version: 1, workspace_members: ids, workspace_root: root });
    return { missing: false, status: 0, stderr: "", stdout, ...result };
  };
  return { calls, run };
}
const problems = (packages: { id: string }[]) => crateProblems("/work", cargo(packages).run);

it("runs cargo metadata locked, for the members only", () => {
  const { run, calls } = cargo([]);
  expect(crateProblems("/work", run)).toStrictEqual({ kind: "checked", problems: [], unlicensed: new Set() });
  expect(calls).toStrictEqual([{ args: ["metadata", "--format-version", "1", "--locked"], root: "/work" }]);
});

it("passes a private crate with nothing set, and a publishable crate with every field", () => {
  expect(problems([entry("a", { publish: [] }), entry("b", FULL)])).toStrictEqual({
    kind: "checked",
    problems: [],
    unlicensed: new Set(),
  });
});

it("names each missing field in order, with the manifest root-relative", () => {
  expect(problems([entry("b", {})])).toStrictEqual({
    kind: "checked",
    problems: [
      "crate b (b/Cargo.toml) is publishable but has no license, description, repository, rust-version; add them or set publish = false",
    ],
    unlicensed: new Set(["b"]),
  });
});

it.each([
  ["license", { ...FULL, license: null }, "license"],
  ["description", { ...FULL, description: "" }, "description"],
  ["repository", { ...FULL, repository: null }, "repository"],
  ["rust-version", { ...FULL, rust_version: null }, "rust-version"],
])("names a crate that lacks only its %s", (_field, fields, named) => {
  expect(problems([entry("b", fields)])).toStrictEqual({
    kind: "checked",
    problems: [`crate b (b/Cargo.toml) is publishable but has no ${named}; add them or set publish = false`],
    unlicensed: new Set(_field === "license" ? ["b"] : []),
  });
});

it("counts license_file as a license", () => {
  const fields = { ...FULL, license: null, license_file: "LICENSE" };
  expect(problems([entry("b", fields)])).toStrictEqual({ kind: "checked", problems: [], unlicensed: new Set() });
});

it("treats a registry list as publishable and an unset publish as publishable", () => {
  const lines = problems([entry("b", { publish: ["crates-io"] }), entry("c", { publish: null })]);
  expect(lines).toMatchObject({
    kind: "checked",
    problems: [expect.stringContaining("crate b"), expect.stringContaining("crate c")],
  });
});

it("makes a Windows manifest path with backslashes root-relative POSIX", () => {
  const manifest = "C:\\work\\members\\b\\Cargo.toml";
  const result = crateProblems("C:\\work", cargo([entry("b", FULL, manifest), entry("c", {}, manifest)]).run);
  expect(result).toStrictEqual({
    kind: "checked",
    problems: [
      "crate c (members/b/Cargo.toml) is publishable but has no license, description, repository, rust-version; add them or set publish = false",
    ],
    unlicensed: new Set(["c"]),
  });
});

it("ignores a dependency package that is not a workspace member", () => {
  const result = crateProblems("/work", cargo([entry("b", FULL), entry("dep", {})], {}, ["b 0.1.0"]).run);
  expect(result).toStrictEqual({ kind: "checked", problems: [], unlicensed: new Set() });
});

it("does not count a private crate as unlicensed", () => {
  expect(problems([entry("a", { publish: [] })])).toStrictEqual({
    kind: "checked",
    problems: [],
    unlicensed: new Set(),
  });
});

it("is stale when --locked made cargo exit 101", () => {
  const stderr = "error: the lock file needs to be updated but --locked was passed to prevent this\n";
  expect(crateProblems("/work", cargo([], { status: 101, stderr }).run)).toStrictEqual({ kind: "stale" });
});

it("makes any other exit 101 a problem quoting stderr", () => {
  const stderr = `error: ${"x".repeat(100)}\n`;
  const result = crateProblems("/work", cargo([], { status: 101, stderr }).run);
  expect(result).toStrictEqual({
    kind: "failed",
    problems: [`cargo metadata exited 101: error: ${"x".repeat(73)}...`],
  });
});

it("makes a signal a problem", () => {
  const result = crateProblems("/work", cargo([], { status: null, stderr: "killed" }).run);
  expect(result).toStrictEqual({ kind: "failed", problems: ["cargo metadata exited by signal: killed"] });
});

it("makes unreadable output a problem quoting it", () => {
  const bad = (stdout: string) => crateProblems("/work", cargo([], { stdout }).run);
  const message = "cargo metadata printed output repo cannot read: ";
  expect(bad("not json")).toStrictEqual({ kind: "failed", problems: [`${message}not json`] });
  expect(bad('{"packages":[{"name":1}]}')).toStrictEqual({
    kind: "failed",
    problems: [`${message}{"packages":[{"name":1}]}`],
  });
});

it("tells where to get cargo when it is not on PATH", () => {
  const result = crateProblems("/work", cargo([], { missing: true, status: 1 }).run);
  expect(result).toStrictEqual({
    kind: "failed",
    problems: ["Cargo.toml is here but cargo is not on PATH; install rustup from https://rustup.rs"],
  });
});
