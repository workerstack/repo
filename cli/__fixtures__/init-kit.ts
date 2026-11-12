// Shared setup for the `init` suites: temp dirs, a stub package root, a typed fake exec and the config init writes.
import fs from "node:fs";
import path from "node:path";
import { vi, type Mock } from "vitest";
import { HOSTS } from "../config.ts";
import type { InitOptions } from "../init.ts";
import { packageJsonSchema, readJsonFile } from "../package-json.ts";
import { tempDir, useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";

/** Removes every dir `tmp` made after each test of the calling file. */
export function useInitKit(): void {
  useTempDirs();
}

/** A new empty temp dir named from `prefix`, removed after the test. */
export function tmp(prefix: string): string {
  return tempDir(prefix);
}

/** This checkout's root, the package init falls back to. */
export function checkoutRoot(): string {
  return path.join(import.meta.dirname, "..", "..");
}

/** A package.json as these tests read it back: scripts and devDependencies always there, empty when absent. */
export type WrittenPackage = {
  name?: string;
  version?: string;
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies: Record<string, string>;
  [key: string]: unknown;
};

export function readPkg(dir: string): WrittenPackage {
  const value = readJsonFile(path.join(dir, "package.json"), packageJsonSchema);
  return { ...value, scripts: value.scripts ?? {}, devDependencies: value.devDependencies ?? {} };
}

/** A fake installed package: only its package.json matters to init. */
export function stubPkgRoot(pkg: Record<string, unknown> = { name: "fixture-pkg", version: "1.2.3" }): string {
  const root = tmp("repo-pkg-");
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  return root;
}

type Exec = NonNullable<InitOptions["execFileSync"]>;

/** An `execFileSync` that runs nothing, so a test reads the commands init ran. */
export function fakeExec(impl?: Exec): Mock<Exec> {
  return impl === undefined ? vi.fn<Exec>() : vi.fn<Exec>(impl);
}

/** An `onPhase` that records each phase init reports. */
export function fakeOnPhase(): Mock<NonNullable<InitOptions["onPhase"]>> {
  return vi.fn<NonNullable<InitOptions["onPhase"]>>();
}

/** Every host, quoted and comma separated, as init lists them. */
export function hostsList(): string {
  return HOSTS.map((h) => JSON.stringify(h)).join(", ");
}

/** The `workerstack.config.ts` init writes around `body`. */
export const config = (body: string): string =>
  `import { defineConfig } from "@workerstack/repo";\n\nexport default defineConfig({\n${body}});\n`;

export const PACKS_LINE: string = `  packs: ["agents", "standards", "docs"],\n`;

/** The config body with the default packs and every host. */
export function defaultBody(): string {
  return `${PACKS_LINE}  agents: { hosts: [${hostsList()}] },\n`;
}

/** The pinned oxfmt's bin script, from its package.json. */
export function oxfmtBin(): string {
  const pkg = Bun.resolveSync("oxfmt/package.json", import.meta.dirname);
  const manifest: unknown = JSON.parse(fs.readFileSync(pkg, "utf8"));
  if (typeof manifest !== "object" || manifest === null || !("bin" in manifest)) throw new Error(`${pkg} has no bin`);
  const { bin } = manifest;
  if (typeof bin !== "object" || bin === null || !("oxfmt" in bin) || typeof bin.oxfmt !== "string")
    throw new Error(`${pkg} has no oxfmt bin`);
  return path.join(path.dirname(pkg), bin.oxfmt);
}
