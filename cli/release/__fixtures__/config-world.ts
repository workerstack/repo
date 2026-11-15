import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript-5.9";
import { INSTALLED_DIR, TSCONFIG } from "../consumer.constants.ts";
import { apiWorld } from "./api-world.ts";
import type { Version, World } from "./api-world.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const ENTRY = "cli/config.ts";

/** The repo's own files the types of `cli/config.ts` load, by repo-relative path to their text. */
function configFiles(): Record<string, string> {
  const options = { ...ts.convertCompilerOptionsFromJson(TSCONFIG.compilerOptions, ROOT).options, types: [] };
  const program = ts.createProgram([path.join(ROOT, ENTRY)], options);
  const own = program
    .getSourceFiles()
    .map((file) => path.relative(ROOT, file.fileName).split(path.sep).join("/"))
    .filter((file) => file.startsWith("cli/"));

  return Object.fromEntries(own.map((file) => [file, fs.readFileSync(path.join(ROOT, file), "utf8")]));
}

/** This checkout's config types as one version of the fixture package. */
function configVersion(version: string): Version {
  return { exports: { ".": { types: `./${ENTRY}`, default: `./${ENTRY}` } }, files: configFiles(), version };
}

/** Two copies of this checkout's config types installed side by side, with the zod they import linked in. */
export function configTwins(): World {
  const world = apiWorld(configVersion("1.0.0"), configVersion("1.0.1"));
  const zod = path.dirname(createRequire(import.meta.url).resolve("zod/package.json"));
  fs.symlinkSync(zod, path.join(world.project, INSTALLED_DIR, "zod"), "junction");
  return world;
}
