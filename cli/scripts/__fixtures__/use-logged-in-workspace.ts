/** A Workspace suite whose every test starts logged in under a fresh home, with `main` run and its output captured. */
import { afterEach, beforeEach } from "vitest";

import { useTempDirs } from "../../sync/__fixtures__/temp-dirs.ts";
import { main } from "../google-workspace.ts";
import { plantLoggedIn, resetCase, withIo } from "./google-workspace-kit.ts";

/** Each test gets a home under a `prefix` temp dir whose default account holds a valid token; stubs reset after. */
export function useLoggedInWorkspace(prefix: string): void {
  useTempDirs();
  beforeEach(() => {
    plantLoggedIn(prefix);
  });
  afterEach(resetCase);
}

/** `main` on `argv`, with its exit code and what it printed to stdout and stderr. */
export function runWorkspace(...argv: string[]): ReturnType<typeof withIo> {
  return withIo(() => main(argv));
}
