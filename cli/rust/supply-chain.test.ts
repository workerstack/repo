import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import type { GitRun } from "../sync/standards.ts";
import type { CargoResult, CargoRun } from "./clippy.ts";
import { cargoLock } from "./fixtures/cargo-lock.ts";
import { supplyChainAt } from "./supply-chain.ts";

const UNTRACKED = "Cargo.lock is not tracked; commit it (cargo runs with --locked)";
const MISSING_CARGO = "Cargo.toml is here but cargo is not on PATH; install rustup from https://rustup.rs";
const TEMPS: string[] = [];
afterAll(() => {
  for (const dir of TEMPS) fs.rmSync(dir, { recursive: true, force: true });
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

const ok = (stdout = "", stderr = ""): CargoResult => ({ status: 0, stdout, stderr, missing: false });
const META = JSON.stringify({
  packages: [
    { id: "b 0.1.0", name: "b", version: "0.1.0", manifest_path: "/x/b/Cargo.toml", publish: null, rust_version: null },
  ],
  workspace_members: ["b 0.1.0"],
});

type Script = { meta?: CargoResult; deny?: CargoResult; shear?: CargoResult; denyV?: CargoResult };

/** A cargo that answers each subcommand from `script` and records every call. */
function fakeCargo(script: Script = {}): { run: CargoRun; calls: string[] } {
  const calls: string[] = [];
  const run: CargoRun = (_root, args) => {
    const line = args.join(" ");
    calls.push(line);
    if (args[0] === "metadata") return script.meta ?? ok(JSON.stringify({ packages: [], workspace_members: [] }));
    if (line === "deny --version") return script.denyV ?? ok("cargo-deny 0.20.2");
    if (line === "shear --version") return ok("Version: 1.14.0");
    if (args[0] === "deny") return script.deny ?? ok();
    return script.shear ?? ok(JSON.stringify({ findings: [] }));
  };
  return { run, calls };
}

const tracked: GitRun = () => ({ status: 0, stdout: `${LOCK}\0`, stderr: "" });
const untracked: GitRun = () => ({ status: 0, stdout: "", stderr: "" });

it("returns nothing and spawns nothing without a root manifest", () => {
  const cargo = fakeCargo();
  const gitCalls: string[][] = [];
  const git: GitRun = (_root, args) => {
    gitCalls.push([...args]);
    return tracked(_root, args);
  };
  expect(supplyChainAt(rootWith(LOCK), ["standards"], { run: cargo.run, git })).toEqual([]);
  expect(cargo.calls).toEqual([]);
  expect(gitCalls).toEqual([]);
});

it("returns nothing and spawns nothing without a lock, which clippy reports", () => {
  const cargo = fakeCargo();
  expect(supplyChainAt(rootWith(MANIFEST), ["standards"], { run: cargo.run, git: untracked })).toEqual([]);
  expect(cargo.calls).toEqual([]);
});

it("names an untracked lock and asks git for it", () => {
  const cargo = fakeCargo();
  const gitCalls: string[][] = [];
  const git: GitRun = (_root, args) => {
    gitCalls.push([...args]);
    return untracked(_root, args);
  };
  const lines = supplyChainAt(rootWith(MANIFEST, LOCK), [], { run: cargo.run, git });
  expect(lines).toEqual([UNTRACKED]);
  expect(gitCalls).toEqual([["ls-files", "--cached", "--", LOCK]]);
  expect(cargo.calls).toEqual([]);
});

it("quotes a git that fails", () => {
  const git: GitRun = () => ({ status: 128, stdout: "", stderr: "fatal: not a git repository" });
  const lines = supplyChainAt(rootWith(MANIFEST, LOCK), [], { run: fakeCargo().run, git });
  expect(lines).toEqual(["git ls-files failed (exit 128): fatal: not a git repository"]);
});

it("runs no cargo tool without the standards pack", () => {
  const cargo = fakeCargo();
  expect(supplyChainAt(rootWith(MANIFEST, LOCK), ["release"], { run: cargo.run, git: tracked })).toEqual([]);
  expect(cargo.calls).toEqual([]);
});

it("returns what it has on a stale lock and runs nothing more", () => {
  const stale: CargoResult = { status: 101, stdout: "", stderr: "error: --locked was passed", missing: false };
  const cargo = fakeCargo({ meta: stale });
  const lines = supplyChainAt(rootWith(MANIFEST, LOCK), ["standards"], { run: cargo.run, git: untracked });
  expect(lines).toEqual([UNTRACKED]);
  expect(cargo.calls).toHaveLength(1);
});

it("drops the missing cargo line of a failed metadata run and stops", () => {
  const gone: CargoResult = { status: 1, stdout: "", stderr: "", missing: true };
  const cargo = fakeCargo({ meta: gone });
  expect(supplyChainAt(rootWith(MANIFEST, LOCK), ["standards"], { run: cargo.run, git: tracked })).toEqual([]);
  expect(MISSING_CARGO).toContain("cargo is not on PATH");
  expect(cargo.calls).toHaveLength(1);
});

it("keeps the other problems of a failed metadata run and stops", () => {
  const broken: CargoResult = { status: 1, stdout: "", stderr: "boom", missing: false };
  const cargo = fakeCargo({ meta: broken });
  const lines = supplyChainAt(rootWith(MANIFEST, LOCK), ["standards"], { run: cargo.run, git: tracked });
  expect(lines).toEqual(["cargo metadata exited 1: boom"]);
  expect(cargo.calls).toHaveLength(1);
});

it("lists untracked, crate, pin, deny and shear lines in that order", () => {
  const deny = ok(
    "",
    JSON.stringify({ type: "diagnostic", fields: { code: "rejected", severity: "error", message: "bad license" } }),
  );
  const shear: CargoResult = {
    status: 1,
    stdout: JSON.stringify({ findings: [{ code: "x", severity: "error", message: "unused dependency `itoa`" }] }),
    stderr: "",
    missing: false,
  };
  const denyFailed = { ...deny, status: 4 };
  const cargo = fakeCargo({ meta: ok(META), deny: denyFailed, shear });
  const lines = supplyChainAt(rootWith(MANIFEST, LOCK), ["standards"], { run: cargo.run, git: untracked });
  expect(lines).toHaveLength(4);
  expect(lines[0]).toBe(UNTRACKED);
  expect(lines[1]).toMatch(/^crate b \(.*b\/Cargo\.toml\) is publishable but has no /);
  expect(lines.slice(2)).toEqual(["cargo deny: licenses: bad license", "cargo shear: unused dependency `itoa`"]);
  expect(cargo.calls.slice(-2)).toEqual(["deny --locked --format json check", "shear --locked --format=json"]);
});

it("skips only the tool whose pin has a problem", () => {
  const old = ok("cargo-deny 0.19.0");
  const cargo = fakeCargo({ meta: ok(META), denyV: old });
  const lines = supplyChainAt(rootWith(MANIFEST, LOCK), ["standards"], { run: cargo.run, git: tracked });
  expect(lines.filter((line) => line.startsWith("cargo-deny"))).toHaveLength(1);
  expect(cargo.calls).not.toContain("deny --locked --format json check");
  expect(cargo.calls).toContain("shear --locked --format=json");
});

it("skips shear when its pin is wrong and still runs deny", () => {
  const cargo = fakeCargo({ meta: ok(META) });
  const run: CargoRun = (root, args) =>
    args.join(" ") === "shear --version" ? ok("Version: 1.0.0") : cargo.run(root, args);
  const lines = supplyChainAt(rootWith(MANIFEST, LOCK), ["standards"], { run, git: tracked });
  expect(lines.filter((line) => line.startsWith("cargo-shear"))).toHaveLength(1);
  expect(cargo.calls).toContain("deny --locked --format json check");
  expect(cargo.calls).not.toContain("shear --locked --format=json");
});

it("falls back to the real git inside a repository", () => {
  const root = rootWith(MANIFEST, LOCK);
  execFileSync("git", ["init", "-q"], { cwd: root });
  expect(supplyChainAt(root, [])).toEqual([UNTRACKED]);
});

it("leaves the no-license deny error of a workspace crate to the crate line, and keeps a dependency's", () => {
  const unlicensed = (name: string) =>
    JSON.stringify({
      type: "diagnostic",
      fields: {
        code: "unlicensed",
        severity: "error",
        message: `${name} = 0.1.0 is unlicensed`,
        graphs: [{ Krate: { name, version: "0.1.0" } }],
      },
    });
  const deny: CargoResult = {
    status: 4,
    stdout: "",
    stderr: `${unlicensed("b")}\n${unlicensed("dep")}\n`,
    missing: false,
  };
  const cargo = fakeCargo({ meta: ok(META), deny });
  const lines = supplyChainAt(rootWith(MANIFEST, LOCK), ["standards"], { run: cargo.run, git: tracked });
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatch(/^crate b \(.*\) is publishable but has no license, /);
  expect(lines[1]).toBe("cargo deny: licenses: dep 0.1.0: dep = 0.1.0 is unlicensed");
});
