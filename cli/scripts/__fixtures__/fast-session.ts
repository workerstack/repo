// What the fast plan and fast roadmap parent suites share: a Claude session and file helpers.
import fs from "node:fs";

import { hookSession, type HookSession } from "./hook-session.ts";
import type { OrchestrateKit } from "./orchestrate-kit.ts";

export function read(file: string) {
  return fs.readFileSync(file, "utf8");
}

export function lines(s: string) {
  return s.split("\n");
}

/** A Claude-shaped session in `ws`. */
export function claudeSession(kit: OrchestrateKit, ws: string, sid: string): HookSession {
  return hookSession(kit, { casing: "claude", env: { CLAUDE_PROJECT_DIR: ws }, sid, ws });
}
