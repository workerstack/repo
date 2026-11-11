import fs from "node:fs";
import path from "node:path";
import { tempDir, write } from "../../__fixtures__/planted-repo.ts";
import type { CargoResult, CargoRun } from "../../rust/clippy.ts";
import { OLD } from "./api-cases.ts";
import { apiRepo, NAME, PREFIX } from "./api-repo.ts";

export type Member = { name: string; version: string; publish?: string[] | null };
export const PIN = {
  status: 0,
  stdout: "cargo-semver-checks 0.51.0\n",
  stderr: "",
  missing: false,
};
export const PASS: CargoResult = {
  status: 0,
  stdout: "",
  stderr: "Summary no semver update required\n",
  missing: false,
};
export const BROKEN = [
  "--- failure function_missing: pub fn removed or renamed ---",
  "Failed in:",
  "  function a::gone, previously in file /x/lib.rs:1",
  "Summary semver requires new major version: 1 major and 0 minor checks failed",
].join("\n");

/** A cargo that lists `members`, answers the version probe with `pin`, and runs every check as `check`. */
export function cargo(members: Member[], pin: Partial<CargoResult> = {}, check: Partial<CargoResult> = {}) {
  const calls: (readonly string[])[] = [];
  const run: CargoRun = (root, args) => {
    calls.push(args);
    if (args[0] === "metadata") {
      const packages = members.map((m) => ({
        ...m,
        id: m.name,
        manifest_path: path.join(root, m.name, "Cargo.toml"),
      }));
      const stdout = JSON.stringify({
        packages,
        workspace_members: members.map((m) => m.name),
      });
      return { status: 0, stdout, stderr: "", missing: false };
    }
    return args[1] === "--version" ? { ...PIN, ...pin } : { ...PASS, ...check };
  };
  return {
    run,
    checks: () => calls.filter((args) => args.includes("check-release")),
  };
}

export const row = (vers: string) => JSON.stringify({ vers, yanked: false, pubtime: "2026-01-01T00:00:00Z" });
export const index = (vers: string) => () => Promise.resolve(new Response(row(vers)));
export const absent = () => Promise.resolve(new Response("", { status: 404 }));

/** A repo with a root Cargo.toml: a plain directory, or the TypeScript fixture repo when `ts` says how public it is. */
export function rustRepo(ts?: { private?: boolean }): string {
  const dir = ts === undefined ? tempDir() : apiRepo(OLD, [], false);
  if (ts !== undefined) {
    const file = path.join(dir, "package.json");
    const manifest = JSON.parse(fs.readFileSync(file, "utf8")) /* the fixture wrote this JSON object */ as Record<
      string,
      unknown
    >;
    fs.writeFileSync(file, JSON.stringify({ ...manifest, private: ts.private }));
  }
  write(dir, { "Cargo.toml": "" });
  return dir;
}

export const A: Member = { name: "a", version: "1.0.2" };
export const OK_A = `${PREFIX}crate a 1.0.2 from crates.io → this checkout · patch · ok\n`;
export const NO_TAG = `${PREFIX}no tag ${NAME}@1.0.0 for the version in package.json; nothing to compare\n`;
