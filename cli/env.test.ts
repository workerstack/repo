import { describe, expect, it, vi } from "vitest";
import { childEnv, readEnv } from "./env.ts";

/** The message of the error `run` throws, empty when it throws nothing. */
function thrownBy(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : "";
  }
  return "";
}

describe("readEnv", () => {
  it("parses the given source", () => {
    expect(readEnv({ HOME: "/home/x", PATH: "/bin" })).toMatchObject({ HOME: "/home/x", PATH: "/bin" });
  });

  it("leaves unset variables undefined", () => {
    expect(readEnv({}).WORKSPACE_ACCOUNT).toBeUndefined();
  });

  it("reads process.env by default", () => {
    vi.stubEnv("WORKSPACE_ACCOUNT", "me@example.com");
    expect(readEnv().WORKSPACE_ACCOUNT).toBe("me@example.com");
  });

  it("throws one line per bad variable, naming it", () => {
    const bad: Record<string, unknown> = { PATH: 1, HOME: 2 };
    const lines = thrownBy(() => readEnv(bad)).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.startsWith("repo: environment: "))).toBe(true);
    expect(lines.some((line) => line.startsWith("repo: environment: HOME: "))).toBe(true);
    expect(lines.some((line) => line.startsWith("repo: environment: PATH: "))).toBe(true);
  });
});

describe("childEnv", () => {
  it("copies process.env and applies overrides", () => {
    vi.stubEnv("CHILD_ENV_KEPT", "kept");
    vi.stubEnv("CHILD_ENV_REPLACED", "old");
    const env = childEnv({ CHILD_ENV_REPLACED: "new", CHILD_ENV_ADDED: "added" });
    expect(env).toMatchObject({ CHILD_ENV_KEPT: "kept", CHILD_ENV_REPLACED: "new", CHILD_ENV_ADDED: "added" });
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
