import os from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { put, realTmp } from "./__fixtures__/doctor-kit.ts";
import { globalsRow, mapsRow } from "./doctor-rows.ts";
import { jevDoctorStatus, speakDoctorStatus, workspaceDoctorStatus } from "./doctor-status.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function tmp(): string {
  return realTmp("doc-status-");
}

/** A home the status functions read through `os.homedir`, with the env keys they look at cleared. */
function home() {
  const dir = tmp();
  vi.spyOn(os, "homedir").mockReturnValue(dir);
  for (const key of ["TYPESAFE_API_KEY", "ELEVENLABS_API_KEY", "OPENAI_API_KEY"]) vi.stubEnv(key, "");
  return dir;
}

describe("status rows read the process home and env by default", () => {
  it("jev: key from the env, key from the config, and neither", () => {
    const h = home();
    expect(jevDoctorStatus()).toStrictEqual({ extra: "", ok: false });
    put(h, ".workerstack/jev.json", JSON.stringify({ apiKey: "k" }));
    expect(jevDoctorStatus()).toStrictEqual({ extra: "config", ok: true });
    vi.stubEnv("TYPESAFE_API_KEY", "abc");
    expect(jevDoctorStatus()).toStrictEqual({ extra: "env", ok: true });
  });

  it("jev: a config without a key does not count", () => {
    const h = home();
    put(h, ".workerstack/jev.json", JSON.stringify({ other: 1 }));
    expect(jevDoctorStatus()).toStrictEqual({ extra: "", ok: false });
    put(h, ".workerstack/jev.json", JSON.stringify({ apiKey: "  " }));
    expect(jevDoctorStatus()).toStrictEqual({ extra: "", ok: false });
    put(h, ".workerstack/jev.json", "[]");
    expect(jevDoctorStatus()).toStrictEqual({ extra: "", ok: false });
  });
});

describe("speak and workspace rows read the process home and env by default", () => {
  it("speak: keys by name, a config file, and neither", () => {
    const h = home();
    expect(speakDoctorStatus()).toStrictEqual({ extra: "", ok: false });
    put(h, ".workerstack/speak.json", "{}");
    expect(speakDoctorStatus()).toStrictEqual({ extra: "config", ok: true });
    vi.stubEnv("OPENAI_API_KEY", "k");
    expect(speakDoctorStatus()).toStrictEqual({ extra: "openai", ok: true });
  });

  it("google-workspace: lists the credential kinds it finds and skips stray entries", () => {
    const h = home();
    expect(workspaceDoctorStatus()).toStrictEqual({ extra: "", ok: false });
    put(h, ".workerstack/workspace/work/google-oauth.json", "{}");
    put(h, ".workerstack/workspace/work2/tokens.json", "{}");
    put(h, ".workerstack/workspace/bad name/tokens.json", "{}");
    put(h, ".workerstack/workspace/readme.txt", "x");
    put(h, ".clasprc.json", "{}");
    expect(workspaceDoctorStatus()).toStrictEqual({ extra: "oauth,tokens,clasprc", ok: true });
  });
});

describe("mapsRow", () => {
  it("is null for a root that is not this package", () => {
    expect(mapsRow(tmp())).toBeNull();
  });
});

describe("globalsRow", () => {
  it("checks the package's own globals against the process home and given workspace", async () => {
    const h = home();
    const ws = tmp();
    const row = await globalsRow(ws, h);
    expect(row).toMatch(/^globals\s+\S/);
  });

  it("falls back to HOME and the working directory when none is given", async () => {
    const h = home();
    const ws = tmp();
    vi.stubEnv("HOME", h);
    vi.spyOn(process, "cwd").mockReturnValue(ws);
    expect(await globalsRow(undefined, undefined)).toMatch(/^globals\s+\S/);
  });
});
