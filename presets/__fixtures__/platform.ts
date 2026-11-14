import { afterEach, beforeEach, vi } from "vitest";

/** Makes `process.platform` read `value` until the hooks `usePresetDefaults` registers restore it. */
export type SetPlatform = (value: NodeJS.Platform) => void;

/**
 * Per test: starts without `REPO_VITEST_TIMEOUT`, which `repo coverage` sets for its own run, so the preset's
 * defaults are the platform's; and puts back the real `process.platform` after. Returns the platform setter.
 */
export function usePresetDefaults(): SetPlatform {
  const platform = process.platform;

  function setPlatform(value: NodeJS.Platform) {
    Object.defineProperty(process, "platform", { configurable: true, enumerable: true, value });
  }

  beforeEach(() => vi.stubEnv("REPO_VITEST_TIMEOUT", undefined));
  afterEach(() => setPlatform(platform));

  return setPlatform;
}
