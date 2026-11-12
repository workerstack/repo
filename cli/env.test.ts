import { describe, expect, it, vi } from "vitest";

import { childEnv } from "./env.ts";

describe("childEnv", () => {
  it("copies process.env and applies overrides", () => {
    vi.stubEnv("CHILD_ENV_KEPT", "kept");
    vi.stubEnv("CHILD_ENV_REPLACED", "old");
    const env = childEnv({ CHILD_ENV_ADDED: "added", CHILD_ENV_REPLACED: "new" });
    expect(env).toMatchObject({ CHILD_ENV_ADDED: "added", CHILD_ENV_KEPT: "kept", CHILD_ENV_REPLACED: "new" });
  });

  it("drops an override that is undefined", () => {
    vi.stubEnv("CHILD_ENV_GONE", "here");
    expect("CHILD_ENV_GONE" in childEnv({ CHILD_ENV_GONE: undefined })).toBe(false);
  });

  it("returns a copy, not process.env", () => {
    const env = childEnv();
    env.CHILD_ENV_COPY = "x";
    expect("CHILD_ENV_COPY" in childEnv()).toBe(false);
  });
});
