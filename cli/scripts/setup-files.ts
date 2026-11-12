/** The secret files `repo setup` writes under `~/.workerstack/`, each readable by the user only. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { JsonObject } from "../json.ts";
import { JSON_INDENT, OAUTH_FILE, SECRET_DIR_MODE, SECRET_FILE_MODE } from "./setup.constants.ts";
import type { SpeakPatch } from "./setup.types.ts";
import { readObjectFile, section, str } from "./voice-args.ts";

export function stateHome(home: string = os.homedir()): string {
  const d = path.join(home, ".workerstack");
  fs.mkdirSync(d, { mode: SECRET_DIR_MODE, recursive: true });

  try {
    fs.chmodSync(d, SECRET_DIR_MODE);
  } catch {
    // win
  }

  return d;
}

export function writeSecretJson(p: string, obj: unknown): string {
  fs.mkdirSync(path.dirname(p), { mode: SECRET_DIR_MODE, recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(obj, null, JSON_INDENT)}\n`, { mode: SECRET_FILE_MODE });

  try {
    fs.chmodSync(p, SECRET_FILE_MODE);
  } catch {
    // win
  }

  return p;
}

export function speakJsonPath(home: string): string {
  return path.join(home, ".workerstack", "speak.json");
}

export function mergeSpeakJson(home: string, patch: SpeakPatch): string {
  stateHome(home);
  const p = speakJsonPath(home);
  const cur = readObjectFile(p);
  const next: JsonObject = { ...cur, ...patch };

  if (patch.elevenlabs !== undefined) next.elevenlabs = { ...section(cur, "elevenlabs"), ...patch.elevenlabs };

  if (patch.openai !== undefined) next.openai = { ...section(cur, "openai"), ...patch.openai };

  if (patch.listen !== undefined) next.listen = { ...section(cur, "listen"), ...patch.listen };

  writeSecretJson(p, next);

  return p;
}

export function oauthWritePath(home: string, account: unknown): string {
  return path.join(home, ".workerstack", "workspace", str(account, "default"), OAUTH_FILE);
}
