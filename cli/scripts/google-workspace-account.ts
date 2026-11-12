/** Where each Workspace account keeps its OAuth client and tokens, and the token lookup over those files. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ACCOUNT_RE,
  ADC_USER,
  DEFAULT_ACCOUNT,
  JSON_INDENT,
  SECRET_DIR_MODE,
  SECRET_FILE_MODE,
  TOKEN_META,
} from "./google-workspace.constants.ts";
import type { Rec, Token, WorkspaceAccount } from "./google-workspace.types.ts";
import { isRecord } from "./hook-input.ts";

export function rec(v: unknown): Rec {
  return isRecord(v) ? v : {};
}

/** `v` when it is a non-empty string, else undefined; a blank flag or JSON field reads as absent. */
export function filled(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

/** The account named `id` (blank is the default) under `home`; throws on a name that is not a plain id. */
export function accountContext(id?: unknown, home: string = os.homedir()): WorkspaceAccount {
  const s = filled(filled(id)?.trim()) ?? DEFAULT_ACCOUNT;

  if (!ACCOUNT_RE.test(s)) throw new Error("bad --account (letters, numbers, _- only)");

  return { home, id: s };
}

function stateHome(home: string): string {
  const d = path.join(home, ".workerstack");
  fs.mkdirSync(d, { mode: SECRET_DIR_MODE, recursive: true });

  return d;
}

function workspaceDir(account: WorkspaceAccount): string {
  return path.join(stateHome(account.home), "workspace", account.id);
}

export function tokenStorePath(account: WorkspaceAccount): string {
  return path.join(workspaceDir(account), "tokens.json");
}

export function credsDefaultPath(account: WorkspaceAccount): string {
  return path.join(workspaceDir(account), "google-oauth.json");
}

function adcPath(home: string): string {
  return path.join(home, ".config", "gcloud", "application_default_credentials.json");
}

export function readJson(p: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function writeSecretJson(p: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(p), { mode: SECRET_DIR_MODE, recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(obj, null, JSON_INDENT)}\n`, { mode: SECRET_FILE_MODE });
}

function toToken(j: Rec, p: string): Token | null {
  const refreshToken = filled(j.refresh_token);
  const clientId = filled(j.client_id);

  if (refreshToken === undefined || clientId === undefined) return null;

  return { ...j, client_id: clientId, refresh_token: refreshToken, sourcePath: p };
}

function tokenFromStore(account: WorkspaceAccount): Token | null {
  const p = tokenStorePath(account);
  const j = rec(readJson(p));

  return toToken(j, p);
}

function tokenFromAdc(home: string): Token | null {
  const p = adcPath(home);
  const j = rec(readJson(p));

  if (j.type === ADC_USER) return toToken(j, p);

  return null;
}

function tokenFromClasprc(home: string): Token | null {
  const p = path.join(home, ".clasprc.json");
  const t = rec(rec(rec(readJson(p)).tokens).default);
  const refreshToken = filled(t.refresh_token);

  if (refreshToken === undefined) return null;
  // Clasp's file carries no client_id check; the refresh needs one, so it stays whatever the file holds.
  const clientId = typeof t.client_id === "string" ? t.client_id : "";

  return { ...t, client_id: clientId, isClasprc: true, refresh_token: refreshToken, sourcePath: p };
}

/** The account's stored token, else gcloud's ADC user, else clasp's default token. */
export function loadToken(account: WorkspaceAccount): Token | null {
  return tokenFromStore(account) ?? tokenFromAdc(account.home) ?? tokenFromClasprc(account.home);
}

function publicFields(t: Token): Rec {
  return Object.fromEntries(Object.entries(t).filter(([k]) => !TOKEN_META.includes(k)));
}

/** Saves a refreshed token where it came from; an ADC token goes to the account store, not gcloud's file. */
export function persistToken(account: WorkspaceAccount, t: Token): void {
  if (t.isClasprc === true) {
    const raw = rec(readJson(t.sourcePath));
    const tokens = rec(raw.tokens);
    tokens.default = publicFields(t);
    raw.tokens = tokens;
    writeSecretJson(t.sourcePath, raw);

    return;
  }

  const dest = t.sourcePath === adcPath(account.home) ? tokenStorePath(account) : t.sourcePath;
  writeSecretJson(dest, publicFields(t));
}

/** One line per account dir under `home`: its name, whether it holds an OAuth client, and whether it holds tokens. */
export function listAccounts(home: string): string {
  const root = path.join(stateHome(home), "workspace");
  const names = new Set<string>();

  try {
    for (const ent of fs.readdirSync(root, { withFileTypes: true }))
      if (ent.isDirectory() && ACCOUNT_RE.test(ent.name)) names.add(ent.name);
  } catch {
    // none
  }

  const lines = [...names].toSorted().map((n) => {
    const account = accountContext(n, home);
    const creds = fs.existsSync(credsDefaultPath(account)) ? "oauth" : "-";
    const tok = fs.existsSync(tokenStorePath(account)) ? "tokens" : "-";

    return `${n}  ${creds}  ${tok}`;
  });

  return lines.length > 0 ? lines.join("\n") : "no accounts";
}
