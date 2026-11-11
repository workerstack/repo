import { expect, it } from "vitest";

import { context } from "../fixtures/release-context.ts";
import type { SyncContext } from "./outputs.ts";
import { ciJobNames, release } from "./release.ts";
import type { PackageJson } from "./workspace.ts";

const MATRIX_NAME = "${{ matrix.label }}";

/** The job names the generated YAML declares, each matrix name expanded over the labels of its own job's include. */
function yamlNames(ctx: SyncContext): string[] {
  const output = release(ctx).outputs[0];
  const text = output?.kind === "file" ? output.content : "";
  return text.split(/^\n/m).flatMap((job) => {
    const name = /^ {4}name: (.*)$/m.exec(job)?.[1];
    if (name === undefined) return [];
    const labels = [...job.matchAll(/label: (.*) \}$/gm)].map((match) => match[1] ?? "");
    return name.includes(MATRIX_NAME) ? labels.map((label) => name.replace(MATRIX_NAME, label)) : [name];
  });
}

const E2E = { "test:e2e": "vitest" };
const CARGO = { "Cargo.toml": "[package]\n" };
const VARIANTS: [string, PackageJson, Record<string, string>][] = [
  ["plain", {}, {}],
  ["e2e", { scripts: E2E }, {}],
  ["public", { name: "pkg", private: false }, {}],
  ["public with e2e", { name: "pkg", private: false, scripts: E2E }, {}],
  ["unsharded e2e", { scripts: { "test:e2e": "tsx e2e.ts" } }, {}],
  ["Rust public with e2e", { name: "pkg", private: false, scripts: E2E }, CARGO],
];

it.each(VARIANTS)("ciJobNames equals the generated YAML's job names for a %s root", (_, manifest, files) => {
  const ctx = context(["release"], manifest, files);
  expect(ciJobNames(ctx).toSorted()).toStrictEqual(yamlNames(ctx).toSorted());
});

const TEST_NAMES = [
  "test (ubuntu-latest)",
  "test (windows-latest 1/3)",
  "test (windows-latest 2/3)",
  "test (windows-latest 3/3)",
  "test (macos-latest 1/2)",
  "test (macos-latest 2/2)",
];

it("ciJobNames lists the labelled matrix names, each shard its own, and the single jobs in file order", () => {
  const ctx = context(["release"], { name: "pkg", private: false, scripts: E2E });
  expect(ciJobNames(ctx)).toStrictEqual([
    ...TEST_NAMES,
    "commits",
    "skips",
    "no-node",
    "e2e (ubuntu-latest)",
    "e2e (windows-latest 1/3)",
    "e2e (windows-latest 2/3)",
    "e2e (windows-latest 3/3)",
    "e2e (macos-latest)",
    "consumer",
  ]);
});

it("ciJobNames lists one e2e name per OS for a script that takes no --shard", () => {
  expect(ciJobNames(context(["release"], { scripts: { "test:e2e": "tsx e2e.ts" } })).slice(-3)).toStrictEqual([
    "e2e (ubuntu-latest)",
    "e2e (windows-latest)",
    "e2e (macos-latest)",
  ]);
});

it("ciJobNames lists semver then msrv last for a Rust repo, as the YAML orders it", () => {
  expect(ciJobNames(context(["release"], {}, CARGO))).toStrictEqual([
    ...TEST_NAMES,
    "commits",
    "skips",
    "no-node",
    "semver",
    "msrv",
  ]);
});

it("ciJobNames is empty without the release pack, which writes no ci.yml", () => {
  expect(ciJobNames(context(["standards"]))).toStrictEqual([]);
});
