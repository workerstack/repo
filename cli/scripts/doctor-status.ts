/** Whether jev, speak and google-workspace have their keys, from the env or `~/.workerstack/`; never prints one. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import { tryJson } from "../json.ts";
import { repoEnv, type Env } from "../repo-env.ts";
import { WORKSPACE_ACCOUNT_RE, WORKSPACE_KIND_ORDER } from "./doctor.constants.ts";
import type { DoctorStatus } from "./doctor.types.ts";

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

export function jevDoctorStatus({ env = repoEnv.process, home = os.homedir() }: KeyOpts = {}): DoctorStatus {
  if ((env.TYPESAFE_API_KEY ?? "").trim() !== "") return { extra: "env", ok: true };

  try {
    const text = fs.readFileSync(path.join(home, ".workerstack", "jev.json"), "utf8");
    const key = tryJson(z.looseObject({ apiKey: z.string().optional() }), text)?.apiKey;

    if (key !== undefined && key.trim() !== "") return { extra: "config", ok: true };
  } catch {
    // absent
  }

  return { extra: "", ok: false };
}

export function speakDoctorStatus({ env = repoEnv.process, home = os.homedir() }: KeyOpts = {}): DoctorStatus {
  const names = SPEAK_KEYS.filter(([key]) => (env[key] ?? "").trim() !== "").map(([, name]) => name);
  const hasFile = isFile(path.join(home, ".workerstack", "speak.json"));

  if (names.length === 0 && !hasFile) return { extra: "", ok: false };

  return { extra: names.length > 0 ? names.join(",") : "config", ok: true };
}

export function workspaceDoctorStatus({ home = os.homedir() }: { home?: string } = {}): DoctorStatus {
  const repo = path.join(home, ".workerstack");
  const kinds = new Set<string>();

  function scanAccountDir(dir: string): void {
    if (isFile(path.join(dir, "google-oauth.json"))) kinds.add("oauth");

    if (isFile(path.join(dir, "tokens.json"))) kinds.add("tokens");
  }

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

  if (kinds.size === 0) return { extra: "", ok: false };

  return { extra: WORKSPACE_KIND_ORDER.filter((k) => kinds.has(k)).join(","), ok: true };
}
