/** Whether jev, speak and google-workspace have their keys, from the env or `~/.workerstack/`; never prints one. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readEnv } from "../env.ts";
import type { Env } from "../env.ts";
import { WORKSPACE_ACCOUNT_RE, WORKSPACE_KIND_ORDER } from "./doctor.constants.ts";
import type { DoctorStatus } from "./doctor.types.ts";
import { isRecord } from "./hook-input.ts";

type KeyOpts = { env?: Env; home?: string };

/** The speak providers' env keys, in row order. */
const SPEAK_KEYS = [
  ["ELEVENLABS_API_KEY", "elevenlabs"],
  ["OPENAI_API_KEY", "openai"],
] as const;

function isFile(abs: string): boolean {
  try {
    return fs.statSync(abs).isFile();
  } catch {
    return false;
  }
}

export function jevDoctorStatus({ env = readEnv(), home = os.homedir() }: KeyOpts = {}): DoctorStatus {
  if (String(env.TYPESAFE_API_KEY || "").trim()) return { extra: "env", ok: true };
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(home, ".workerstack", "jev.json"), "utf8"));
    if (String(isRecord(parsed) && parsed.apiKey ? parsed.apiKey : "").trim()) return { extra: "config", ok: true };
  } catch {
    // absent
  }
  return { extra: "", ok: false };
}

export function speakDoctorStatus({ env = readEnv(), home = os.homedir() }: KeyOpts = {}): DoctorStatus {
  const names = SPEAK_KEYS.filter(([key]) => String(env[key] ?? "").trim() !== "").map(([, name]) => name);
  const hasFile = isFile(path.join(home, ".workerstack", "speak.json"));
  if (!names.length && !hasFile) return { extra: "", ok: false };
  return { extra: names.length ? names.join(",") : "config", ok: true };
}

export function workspaceDoctorStatus({ home = os.homedir() }: { home?: string } = {}): DoctorStatus {
  const repo = path.join(home, ".workerstack");
  const kinds = new Set<string>();
  const scanAccountDir = (dir: string): void => {
    if (isFile(path.join(dir, "google-oauth.json"))) kinds.add("oauth");
    if (isFile(path.join(dir, "tokens.json"))) kinds.add("tokens");
  };
  const root = path.join(repo, "workspace");
  try {
    for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
      if (!ent.isDirectory() || !WORKSPACE_ACCOUNT_RE.test(ent.name)) continue;
      scanAccountDir(path.join(root, ent.name));
    }
  } catch {
    // none
  }
  if (isFile(path.join(home, ".config", "gcloud", "application_default_credentials.json"))) kinds.add("adc");

  if (isFile(path.join(home, ".clasprc.json"))) kinds.add("clasprc");
  if (!kinds.size) return { extra: "", ok: false };
  return { extra: WORKSPACE_KIND_ORDER.filter((k) => kinds.has(k)).join(","), ok: true };
}
