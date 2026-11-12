import { expect, it } from "vitest";

import type { JsonObject } from "../json.ts";
import { onCratesIo, workspaceCrates } from "./cargo-metadata.ts";
import type { CargoResult, CargoRun } from "./clippy.ts";

function entry(name: string, fields: JsonObject = {}) {
  return {
    id: `${name} 0.2.0`,
    manifest_path: `/work/${name}/Cargo.toml`,
    name,
    publish: null,
    version: "0.2.0",
    ...fields,
  };
}

/** A runner answering `packages` (the members are the first `members` of them) or `result`. */
function cargo(packages: { id: string }[], result: Partial<CargoResult> = {}, members = packages.length): CargoRun {
  return () => {
    const ids = packages.slice(0, members).map((pkg) => pkg.id);
    const stdout = JSON.stringify({ packages, workspace_members: ids });

    return { missing: false, status: 0, stderr: "", stdout, ...result };
  };
}

it("lists the workspace members with their version and manifest", () => {
  const run = cargo([entry("a", { publish: [] }), entry("b"), entry("dep")], {}, 2);
  expect(workspaceCrates("/work", run)).toMatchObject({
    crates: [
      { manifest_path: "/work/a/Cargo.toml", name: "a", publish: [], version: "0.2.0" },
      { manifest_path: "/work/b/Cargo.toml", name: "b", publish: null, version: "0.2.0" },
    ],
    kind: "crates",
  });
});

it("is stale when --locked made cargo exit 101", () => {
  const stderr = "error: the lock file needs to be updated but --locked was passed to prevent this\n";
  expect(workspaceCrates("/work", cargo([], { status: 101, stderr }))).toStrictEqual({ kind: "stale" });
});

it("fails with the same lines crateProblems gives", () => {
  expect(workspaceCrates("/work", cargo([], { missing: true, status: 1 }))).toStrictEqual({
    kind: "failed",
    problems: ["Cargo.toml is here but cargo is not on PATH; install rustup from https://rustup.rs"],
  });
  expect(workspaceCrates("/work", cargo([], { stdout: "nope" }))).toStrictEqual({
    kind: "failed",
    problems: ["cargo metadata printed output repo cannot read: nope"],
  });
});

it.each([
  [undefined, true],
  [null, true],
  [["crates-io"], true],
  [["my-registry", "crates-io"], true],
  [[], false],
  [["my-registry"], false],
])("reads publish %j as on crates.io: %s", (publish, expected) => {
  expect(onCratesIo({ publish })).toBe(expected);
});
