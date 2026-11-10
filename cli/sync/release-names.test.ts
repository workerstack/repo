import { expect, it } from "vitest";
import { context } from "../fixtures/release-context.ts";
import type { SyncContext } from "./outputs.ts";
import { ciJobNames, release } from "./release.ts";
import type { PackageJson } from "./workspace.ts";

const MATRIX_NAME = "${{ matrix.os }}";

/** The job names the generated YAML declares, each matrix name expanded over the matrix's own OS list. */
function yamlNames(ctx: SyncContext): string[] {
  const output = release(ctx).outputs[0];
  const text = output?.kind === "file" ? output.content : "";
  const oses = (/os: \[(.*)\]/.exec(text)?.[1] ?? "").split(", ");
  const names = [...text.matchAll(/^ {4}name: (.*)$/gm)].map((match) => match[1] ?? "");
  return names.flatMap((name) =>
    name.includes(MATRIX_NAME) ? oses.map((os) => name.replace(MATRIX_NAME, os)) : [name],
  );
}

const E2E = { "test:e2e": "vitest" };
const CARGO = { "Cargo.toml": "[package]\n" };
const VARIANTS: [string, PackageJson, Record<string, string>][] = [
  ["plain", {}, {}],
  ["e2e", { scripts: E2E }, {}],
  ["public", { name: "pkg", private: false }, {}],
  ["public with e2e", { name: "pkg", private: false, scripts: E2E }, {}],
  ["Rust public with e2e", { name: "pkg", private: false, scripts: E2E }, CARGO],
];

it.each(VARIANTS)("ciJobNames equals the generated YAML's job names for a %s root", (_, manifest, files) => {
  const ctx = context(["release"], manifest, files);
  expect(ciJobNames(ctx).toSorted()).toEqual(yamlNames(ctx).toSorted());
});

it("ciJobNames lists the expanded matrix names, then the single jobs", () => {
  const ctx = context(["release"], { name: "pkg", private: false, scripts: E2E });
  expect(ciJobNames(ctx)).toEqual([
    "test (ubuntu-latest)",
    "test (windows-latest)",
    "test (macos-latest)",
    "commits",
    "skips",
    "no-node",
    "e2e (ubuntu-latest)",
    "e2e (windows-latest)",
    "e2e (macos-latest)",
    "consumer",
  ]);
});

it("ciJobNames lists msrv last for a Rust repo, as the YAML orders it", () => {
  expect(ciJobNames(context(["release"], {}, CARGO))).toEqual([
    "test (ubuntu-latest)",
    "test (windows-latest)",
    "test (macos-latest)",
    "commits",
    "skips",
    "no-node",
    "msrv",
  ]);
});

it("ciJobNames is empty without the release pack, which writes no ci.yml", () => {
  expect(ciJobNames(context(["standards"]))).toEqual([]);
});
