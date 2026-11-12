/** The Desktop OAuth client `repo setup google-workspace` installs, and the console pages it opens. */
import fs from "node:fs";
import path from "node:path";

import { isRecord } from "../json.ts";
import { writeSecretJson } from "./setup-files.ts";
import { OAUTH_FILE } from "./setup.constants.ts";
import type { SetupSpawnSync } from "./setup.types.ts";
import { str } from "./voice-args.ts";

/** The file names Google gives a downloaded OAuth client. */
const CLIENT_SECRET_JSON = /client_secret.*\.json$/i;

function rec(v: unknown): Record<string, unknown> {
  return isRecord(v) ? v : {};
}

export function parseDesktopOAuth(raw: unknown): Record<string, unknown> {
  const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  const j = rec(parsed);
  const inst = rec(j.installed ?? j.web);
  const hasClientId = typeof inst.client_id === "string" && inst.client_id !== "";

  if (!hasClientId) throw new Error("OAuth JSON needs installed.client_id (Desktop app download)");

  if (!isRecord(j.installed)) throw new Error("OAuth JSON must be a Desktop client (installed), not a Web client");

  return j;
}

export function loadOAuthInput(s: unknown): Record<string, unknown> {
  const t = str(s);

  if (t === "") throw new Error("OAuth JSON path or JSON body required");

  if (t.startsWith("{")) return parseDesktopOAuth(t);

  if (!fs.existsSync(t) || !fs.statSync(t).isFile()) throw new Error(`OAuth JSON not found: ${t}`);

  return parseDesktopOAuth(fs.readFileSync(t, "utf8"));
}

export function installOAuthJson({ src, dest }: { src: string; dest: string }): string {
  const j = loadOAuthInput(src);
  writeSecretJson(dest, j);

  return dest;
}

export function findDownloadedOAuthJson(home: string): string {
  const dirs = [path.join(home, "Downloads"), path.join(home, "downloads")];
  const hits: { p: string; m: number }[] = [];

  for (const dir of dirs) {
    let ents: string[];

    try {
      ents = fs.readdirSync(dir);
    } catch {
      continue;
    }

    for (const name of ents) {
      if (!CLIENT_SECRET_JSON.test(name) && name.toLowerCase() !== OAUTH_FILE) continue;

      const p = path.join(dir, name);

      try {
        const st = fs.statSync(p);

        if (st.isFile()) hits.push({ m: st.mtimeMs, p });
      } catch {
        // skip
      }
    }
  }

  hits.sort((a, b) => b.m - a.m);

  return hits[0]?.p ?? "";
}

export function workspaceConsoleUrls(
  projectId: unknown,
): Record<"projectCreate" | "branding" | "enableApis" | "clientCreate", string> {
  const p = str(projectId);
  const enc = encodeURIComponent(p);

  return {
    branding:
      p === ""
        ? "https://console.cloud.google.com/auth/overview/create"
        : `https://console.cloud.google.com/auth/overview/create?project=${enc}`,
    clientCreate:
      p === ""
        ? "https://console.cloud.google.com/auth/clients/create"
        : `https://console.cloud.google.com/auth/clients/create?project=${enc}`,
    enableApis:
      p === ""
        ? "https://console.cloud.google.com/flows/enableapi?apiid=calendar-json.googleapis.com,gmail.googleapis.com,sheets.googleapis.com,docs.googleapis.com,drive.googleapis.com"
        : `https://console.cloud.google.com/flows/enableapi?apiid=calendar-json.googleapis.com,gmail.googleapis.com,sheets.googleapis.com,docs.googleapis.com,drive.googleapis.com&project=${enc}`,
    projectCreate: "https://console.cloud.google.com/projectcreate",
  };
}

export async function openUrl(
  url: string,
  {
    platform = process.platform,
    spawnSyncFn,
    openUrlFn,
  }: {
    platform?: NodeJS.Platform | undefined;
    spawnSyncFn?: SetupSpawnSync | undefined;
    openUrlFn?: ((url: string) => unknown) | undefined;
  } = {},
): Promise<void> {
  if (typeof openUrlFn === "function") {
    openUrlFn(url);

    return;
  }

  const { openUrl: openWorkspaceUrl } = await import("./google-workspace-auth.ts");
  openWorkspaceUrl(url, spawnSyncFn === undefined ? { platform } : { platform, spawnSyncFn });
}
