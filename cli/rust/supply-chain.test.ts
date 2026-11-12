import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, expect, it } from "vitest";

import type { GitRun } from "../sync/standards.ts";
import { cargoLock } from "./__fixtures__/cargo-lock.ts";
import type { CargoResult } from "./clippy.ts";
import { supplyChainAt } from "./supply-chain.ts";

const UNTRACKED = "Cargo.lock is not tracked; commit it (cargo runs with --locked)";
const MISSING_CARGO = "Cargo.toml is here but cargo is not on PATH; install rustup from https://rustup.rs";
const TEMPS: string[] = [];

afterAll(() => {
  for (const dir of TEMPS) fs.rmSync(dir, { force: true, recursive: true });
});

/** A temp root holding the named files. */
function rootWith(...files: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-supply-"));
  TEMPS.push(root);

  for (const file of files) fs.writeFileSync(path.join(root, file), file.endsWith(".lock") ? cargoLock("app") : "");

  return root;
}

const MANIFEST = "Cargo.toml";
const LOCK = ["Cargo", "lock"].join(".");

function ok(stdout = "", stderr = ""): CargoResult {
  return { missing: false, status: 0, stderr, stdout };
}

const META = JSON.stringify({
  packages: [
    { id: "b 0.1.0", manifest_path: "/x/b/Cargo.toml", name: "b", publish: null, rust_version: null, version: "0.1.0" },
  ],
  workspace_members: ["b 0.1.0"],
});

type Script = { meta?: CargoResult; deny?: CargoResult; shear?: CargoResult; denyV?: CargoResult };

/** A cargo that answers each subcommand from `script` and records every call. */
function fakeCargo(script: Script = {}) {
  const calls: string[] = [];

  function run(_root: string, args: readonly string[]): CargoResult {
    const line = args.join(" ");
    calls.push(line);

    if (args[0] === "metadata") return script.meta ?? ok(JSON.stringify({ packages: [], workspace_members: [] }));

    if (line === "deny --version") return script.denyV ?? ok("cargo-deny 0.20.2");

    if (line === "shear --version") return ok("Version: 1.14.0");

    if (args[0] === "deny") return script.deny ?? ok();

    return script.shear ?? ok(JSON.stringify({ findings: [] }));
  }

  return { calls, run };
}

function tracked(): ReturnType<GitRun> {
  return { status: 0, stderr: "", stdout: `${LOCK}\0` };
}

function untracked(): ReturnType<GitRun> {
  return { status: 0, stderr: "", stdout: "" };
}

/** A git that answers with `answer` and records the args of each call in `calls`. */
function recordingGit(calls: string[][], answer: GitRun): GitRun {
  return (root, args) => {
    calls.push([...args]);

    return answer(root, args);
  };
}

function gitFails(): ReturnType<GitRun> {
  return { status: 128, stderr: "fatal: not a git repository", stdout: "" };
}

function unlicensed(name: string) {
  return JSON.stringify({
    fields: {
      code: "unlicensed",
      graphs: [{ Krate: { name, version: "0.1.0" } }],
      message: `${name} = 0.1.0 is unlicensed`,
      severity: "error",
    },
    type: "diagnostic",
  });
}

it("returns nothing and spawns nothing without a root manifest", () => {
  const cargo = fakeCargo();
  const gitCalls: string[][] = [];
  const git = recordingGit(gitCalls, tracked);
  expect(supplyChainAt(rootWith(LOCK), ["standards"], { git, run: cargo.run })).toStrictEqual([]);
  expect(cargo.calls).toStrictEqual([]);
  expect(gitCalls).toStrictEqual([]);
});

it("returns nothing and spawns nothing without a lock, which clippy reports", () => {
  const cargo = fakeCargo();
  expect(supplyChainAt(rootWith(MANIFEST), ["standards"], { git: untracked, run: cargo.run })).toStrictEqual([]);
  expect(cargo.calls).toStrictEqual([]);
});

it("names an untracked lock and asks git for it", () => {
  const cargo = fakeCargo();
  const gitCalls: string[][] = [];
  const git = recordingGit(gitCalls, untracked);
  const lines = supplyChainAt(rootWith(MANIFEST, LOCK), [], { git, run: cargo.run });
  expect(lines).toStrictEqual([UNTRACKED]);
  expect(gitCalls).toStrictEqual([["ls-files", "--cached", "--", LOCK]]);
  expect(cargo.calls).toStrictEqual([]);
});

it("quotes a git that fails", () => {
  const lines = supplyChainAt(rootWith(MANIFEST, LOCK), [], { git: gitFails, run: fakeCargo().run });
  expect(lines).toStrictEqual(["git ls-files failed (exit 128): fatal: not a git repository"]);
});

it("runs no cargo tool without the standards pack", () => {
  const cargo = fakeCargo();
  expect(supplyChainAt(rootWith(MANIFEST, LOCK), ["release"], { git: tracked, run: cargo.run })).toStrictEqual([]);
  expect(cargo.calls).toStrictEqual([]);
});

it("returns what it has on a stale lock and runs nothing more", () => {
  const stale: CargoResult = { missing: false, status: 101, stderr: "error: --locked was passed", stdout: "" };
  const cargo = fakeCargo({ meta: stale });
  const lines = supplyChainAt(rootWith(MANIFEST, LOCK), ["standards"], { git: untracked, run: cargo.run });
  expect(lines).toStrictEqual([UNTRACKED]);
  expect(cargo.calls).toHaveLength(1);
});

it("drops the missing cargo line of a failed metadata run and stops", () => {
  const gone: CargoResult = { missing: true, status: 1, stderr: "", stdout: "" };
  const cargo = fakeCargo({ meta: gone });
  expect(supplyChainAt(rootWith(MANIFEST, LOCK), ["standards"], { git: tracked, run: cargo.run })).toStrictEqual([]);
  expect(MISSING_CARGO).toContain("cargo is not on PATH");
  expect(cargo.calls).toHaveLength(1);
});

it("keeps the other problems of a failed metadata run and stops", () => {
  const broken: CargoResult = { missing: false, status: 1, stderr: "boom", stdout: "" };
  const cargo = fakeCargo({ meta: broken });
  const lines = supplyChainAt(rootWith(MANIFEST, LOCK), ["standards"], { git: tracked, run: cargo.run });
  expect(lines).toStrictEqual(["cargo metadata exited 1: boom"]);
  expect(cargo.calls).toHaveLength(1);
});

it("lists untracked, crate, pin, deny and shear lines in that order", () => {
  const deny = ok(
    "",
    JSON.stringify({ fields: { code: "rejected", message: "bad license", severity: "error" }, type: "diagnostic" }),
  );

  const shear: CargoResult = {
    missing: false,
    status: 1,
    stderr: "",
    stdout: JSON.stringify({ findings: [{ code: "x", message: "unused dependency `itoa`", severity: "error" }] }),
  };

  const denyFailed = { ...deny, status: 4 };
  const cargo = fakeCargo({ deny: denyFailed, meta: ok(META), shear });
  const lines = supplyChainAt(rootWith(MANIFEST, LOCK), ["standards"], { git: untracked, run: cargo.run });
  expect(lines).toHaveLength(4);
  expect(lines[0]).toBe(UNTRACKED);
  expect(lines[1]).toMatch(/^crate b \(.*b\/Cargo\.toml\) is publishable but has no /);
  expect(lines.slice(2)).toStrictEqual(["cargo deny: licenses: bad license", "cargo shear: unused dependency `itoa`"]);
  expect(cargo.calls.slice(-2)).toStrictEqual(["deny --locked --format json check", "shear --locked --format=json"]);
});

it("skips only the tool whose pin has a problem", () => {
  const old = ok("cargo-deny 0.19.0");
  const cargo = fakeCargo({ denyV: old, meta: ok(META) });
  const lines = supplyChainAt(rootWith(MANIFEST, LOCK), ["standards"], { git: tracked, run: cargo.run });
  expect(lines.filter((line) => line.startsWith("cargo-deny"))).toHaveLength(1);
  expect(cargo.calls).not.toContain("deny --locked --format json check");
  expect(cargo.calls).toContain("shear --locked --format=json");
});

it("skips shear when its pin is wrong and still runs deny", () => {
  const cargo = fakeCargo({ meta: ok(META) });

  function run(root: string, args: readonly string[]) {
    return args.join(" ") === "shear --version" ? ok("Version: 1.0.0") : cargo.run(root, args);
  }

  const lines = supplyChainAt(rootWith(MANIFEST, LOCK), ["standards"], { git: tracked, run });
  expect(lines.filter((line) => line.startsWith("cargo-shear"))).toHaveLength(1);
  expect(cargo.calls).toContain("deny --locked --format json check");
  expect(cargo.calls).not.toContain("shear --locked --format=json");
});

it("falls back to the real git inside a repository", () => {
  const root = rootWith(MANIFEST, LOCK);
  execFileSync("git", ["init", "-q"], { cwd: root });
  expect(supplyChainAt(root, [])).toStrictEqual([UNTRACKED]);
});

it("leaves the no-license deny error of a workspace crate to the crate line, and keeps a dependency's", () => {
  const deny: CargoResult = {
    missing: false,
    status: 4,
    stderr: `${unlicensed("b")}\n${unlicensed("dep")}\n`,
    stdout: "",
  };

  const cargo = fakeCargo({ deny, meta: ok(META) });
  const lines = supplyChainAt(rootWith(MANIFEST, LOCK), ["standards"], { git: tracked, run: cargo.run });
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatch(/^crate b \(.*\) is publishable but has no license, /);
  expect(lines[1]).toBe("cargo deny: licenses: dep 0.1.0: dep = 0.1.0 is unlicensed");
});
