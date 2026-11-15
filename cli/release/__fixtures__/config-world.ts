import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { withFiles, withTsApi } from "../../ts-api.ts";
import { posix } from "../../ts-program.ts";
import { INSTALLED_DIR, TSCONFIG } from "../consumer.constants.ts";
import { apiWorld } from "./api-world.ts";
import type { Version, World } from "./api-world.ts";

const ROOT = posix(fs.realpathSync(path.resolve(import.meta.dirname, "../../..")));
const ENTRY = "cli/config.ts";
const BASE = "tsconfig.config-world.json";

/** The repo's own files the types of `cli/config.ts` load, by repo-relative path to their text. */
function configFiles(): Promise<Record<string, string>> {
  return withTsApi(ROOT, (run) => {
    run.virtual.set(`${ROOT}/${BASE}`, JSON.stringify({ compilerOptions: { ...TSCONFIG.compilerOptions, types: [] } }));

    return withFiles(run, { base: BASE, dir: ROOT, files: [ENTRY] }, async (project) => {
      const own = (await project.program.getSourceFileNames())
        .map((file) => path.posix.relative(ROOT, file))
        .filter((file) => file.startsWith("cli/"));

      return Object.fromEntries(own.map((file) => [file, fs.readFileSync(path.join(ROOT, file), "utf8")]));
    });
  });
}

/** This checkout's config types as one version of the fixture package. */
function configVersion(version: string, files: Record<string, string>): Version {
  return { exports: { ".": { types: `./${ENTRY}`, default: `./${ENTRY}` } }, files, version };
}

/** Two copies of this checkout's config types installed side by side, with the zod they import linked in. */
export async function configTwins(): Promise<World> {
  const files = await configFiles();
  const world = apiWorld(configVersion("1.0.0", files), configVersion("1.0.1", files));
  const zod = path.dirname(createRequire(import.meta.url).resolve("zod/package.json"));
  fs.symlinkSync(zod, path.join(world.project, INSTALLED_DIR, "zod"), "junction");
  return world;
}
