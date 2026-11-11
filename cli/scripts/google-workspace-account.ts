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

/** The account named `id` (blank is the default) under `home`; throws on a name that is not a plain id. */
export function accountContext(id?: unknown, home: string = os.homedir()): WorkspaceAccount {
  const s = String(id || DEFAULT_ACCOUNT).trim() || DEFAULT_ACCOUNT;
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
  if (typeof j.refresh_token !== "string" || !j.refresh_token) return null;
  if (typeof j.client_id !== "string" || !j.client_id) return null;
  return { ...j, _path: p, client_id: j.client_id, refresh_token: j.refresh_token };
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
  if (typeof t.refresh_token !== "string" || !t.refresh_token) return null;
  // Clasp's file carries no client_id check; the refresh needs one, so it stays whatever the file holds.
  return { ...t, _clasprc: true, _path: p, client_id: String(t.client_id ?? ""), refresh_token: t.refresh_token };
}

/** The account's stored token, else gcloud's ADC user, else clasp's default token. */
export function loadToken(account: WorkspaceAccount): Token | null {
  return (tokenFromStore(account) ?? tokenFromAdc(account.home)) || tokenFromClasprc(account.home);
}

function publicFields(t: Token): Rec {
  return Object.fromEntries(Object.entries(t).filter(([k]) => !TOKEN_META.includes(k)));
}

/** Saves a refreshed token where it came from; an ADC token goes to the account store, not gcloud's file. */
export function persistToken(account: WorkspaceAccount, t: Token): void {
  if (t._clasprc) {
    const raw = rec(readJson(t._path));
    const tokens = rec(raw.tokens);
    tokens.default = publicFields(t);
    raw.tokens = tokens;
    writeSecretJson(t._path, raw);
    return;
  }
  const dest = t._path === adcPath(account.home) ? tokenStorePath(account) : t._path;
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
  return lines.length ? lines.join("\n") : "no accounts";
}
