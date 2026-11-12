import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ROOT_PREFIX } from "./temp-root.constants.ts";

/**
 * Where a run's tests get their temp dir: `<real tmpdir>/repo-test-<pid>` of the vitest main process. The config
 * may be evaluated more than once per project, so the path comes from the pid, not from chance.
 */
export function rootPath(pid: number = process.pid): string {
  return path.join(fs.realpathSync(os.tmpdir()), `${ROOT_PREFIX}${pid}`);
}

/** The temp dir variables of a test process, and where Node keeps its compile cache. */
type RootEnv = { NODE_COMPILE_CACHE: string; TEMP: string; TMP: string; TMPDIR: string };

/**
 * The environment that makes the root the temp dir of test processes only (workers and what they spawn); the main
 * process, and the tools it runs in-process such as miniflare, keep the real one.
 */
export function rootEnv(root: string = rootPath()): RootEnv {
  // Node's compile cache defaults to <tmpdir>/node-compile-cache; a worker would put it in the root.
  const cache = process.env.NODE_COMPILE_CACHE ?? path.join(path.dirname(root), "node-compile-cache");

  return { NODE_COMPILE_CACHE: cache, TEMP: root, TMP: root, TMPDIR: root };
}
