import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { crateProblems } from "./cargo-metadata.ts";
import { runCargo } from "./clippy.ts";

/** A cold cargo run of a tiny workspace, with room for a busy CI runner. */
const CARGO_MS = 300_000;

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** Writes a no-dependency crate called `name` under `dir`. */
function writeCrate(dir: string, name: string, extra = ""): void {
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "Cargo.toml"),
    `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\n${extra}`,
  );
  fs.writeFileSync(path.join(dir, "src/lib.rs"), "");
}

it("is stale when Cargo.toml gained a dependency the lock lacks", { timeout: CARGO_MS }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-metadata-"));
  temps.push(root);
  writeCrate(root, "app");
  writeCrate(path.join(root, "dep"), "dep");
  expect(runCargo(root, ["generate-lockfile", "--offline"]).status).toBe(0);
  expect(crateProblems(root, runCargo).kind).toBe("checked");
  fs.appendFileSync(path.join(root, "Cargo.toml"), '\n[dependencies]\ndep = { path = "dep" }\n');
  expect(crateProblems(root, runCargo)).toStrictEqual({ kind: "stale" });
});
