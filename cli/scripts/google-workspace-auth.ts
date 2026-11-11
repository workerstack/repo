/** Logging in to Google (loopback OAuth or gcloud ADC), refreshing the access token, and the authorized fetch. */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

import {
  accountContext,
  loadToken,
  persistToken,
  readJson,
  rec,
  tokenStorePath,
  writeSecretJson,
} from "./google-workspace-account.ts";
import {
  ADC_USER,
  AUTH_URL,
  DARWIN,
  DEFAULT_LIFETIME_S,
  EMAIL_SCOPE,
  EXPIRY_SLACK_MS,
  EXTRA_SCOPES,
  FORM_TYPE,
  HTTP_MULTIPLE,
  HTTP_OK,
  LOGIN_TIMEOUT_MS,
  MS_PER_SECOND,
  PROFILE_SCOPE,
  RAW_REPLY_CHARS,
  TOKEN_URL,
  VERIFIER_BYTES,
  WIN32,
} from "./google-workspace.constants.ts";
import type { GResult, Rec, SpawnFn, SpawnSyncOpts, Token, WorkspaceAccount } from "./google-workspace.types.ts";
import { isRecord } from "./hook-input.ts";

/** The `error.message` of a Google API reply, or the fallback. */
export function apiMessage(json: unknown, fallback: string): string {
  const m = rec(rec(json).error).message;
  return m ? String(m) : fallback;
}

export function errMessage(e: unknown): string {
  const m = isRecord(e) ? e.message : undefined;
  return String(m || e);
}

export async function jsonRecord(r: Response): Promise<Rec> {
  const j: unknown = await r.json();
  return rec(j);
}

export function fail(msg: string): number {
  process.stderr.write(`${msg.trimEnd()}\n`);
  return 1;
}

export function ok(msg: string): number {
  process.stdout.write(`${msg.trimEnd()}\n`);
  return 0;
}

function postForm(body: URLSearchParams): Promise<Response> {
  return fetch(TOKEN_URL, { body, headers: { "Content-Type": FORM_TYPE }, method: "POST" });
}

/** The token server's reply's error text, its code, or `fallback`. */
function tokenError(j: Rec, fallback: string): Error {
  return new Error(String(j.error_description || j.error || fallback));
}

/** When a token the server just issued expires: its own date, else `expires_in` (an hour by default) from now. */
function expiryOf(j: Rec): unknown {
  if (j.expiry_date) return j.expiry_date;
  return Date.now() + Number(j.expires_in || DEFAULT_LIFETIME_S) * MS_PER_SECOND;
}

function cachedAccess(t: Token): string | undefined {
  const isFresh = Number(t.expiry_date) > Date.now() + EXPIRY_SLACK_MS;
  return typeof t.access_token === "string" && t.access_token && isFresh ? t.access_token : undefined;
}

/** A fresh access token for the account, refreshed and saved back when the cached one is near expiry. */
export async function accessToken(account: WorkspaceAccount = accountContext()): Promise<string> {
  const t = loadToken(account);
  if (!t) throw new Error("not logged in; run bun repo google-workspace login");
  const cached = cachedAccess(t);
  if (cached !== undefined) return cached;

  const form = { client_id: t.client_id, client_secret: String(t.client_secret || "") };
  const grant = { ...form, grant_type: "refresh_token", refresh_token: t.refresh_token };
  const j = await jsonRecord(await postForm(new URLSearchParams(grant)));
  if (typeof j.access_token !== "string" || !j.access_token) throw tokenError(j, "token refresh failed");

  t.access_token = j.access_token;
  t.expiry_date = expiryOf(j);
  persistToken(account, t);
  return j.access_token;
}

export function openUrl(
  url: string,
  {
    platform = process.platform,
    spawnSyncFn = spawnSync,
  }: { platform?: NodeJS.Platform; spawnSyncFn?: (cmd: string, args: string[], opts: SpawnSyncOpts) => unknown } = {},
): void {
  if (platform === DARWIN) {
    spawnSyncFn("open", [url], { stdio: "ignore" });
  } else if (platform === WIN32) {
    spawnSyncFn("cmd", ["/c", "start", "", url], {
      stdio: "ignore",
      windowsVerbatimArguments: true,
    });
  } else {
    spawnSyncFn("xdg-open", [url], { stdio: "ignore" });
  }
}

/** A loopback server on a free port, and the redirect URI that reaches it. */
async function listenLoopback(): Promise<{ server: http.Server; redirect: string }> {
  const server = http.createServer();
  await new Promise<void>((res, rej) => {
    server.listen(0, "127.0.0.1", res);
    server.on("error", rej);
  });
  const { port } = server.address() /* listening on a TCP port, so never a pipe path or null */ as AddressInfo;
  return { redirect: `http://127.0.0.1:${port}`, server };
}

function consentUrl(clientId: string, challenge: string, redirect: string): string {
  const scope = [...EXTRA_SCOPES, EMAIL_SCOPE, PROFILE_SCOPE, "openid"].join(" ");
  return `${AUTH_URL}?${new URLSearchParams({
    access_type: "offline",
    client_id: clientId,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "consent",
    redirect_uri: redirect,
    response_type: "code",
    scope,
  }).toString()}`;
}

/** Opens the consent page and waits for the browser to hit the loopback with a code; always closes the server. */
function awaitCode(loop: { server: http.Server; redirect: string }, auth: string, spawn: SpawnFn): Promise<string> {
  const { server, redirect } = loop;
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("login timed out")), LOGIN_TIMEOUT_MS);
    server.on("request", (req, res) => {
      const u = new URL(String(req.url), redirect);
      const c = u.searchParams.get("code");
      const err = u.searchParams.get("error");
      res.writeHead(HTTP_OK, { "Content-Type": "text/plain" });
      res.end(c ? "Logged in. Return to the terminal." : String(err || "missing code"));
      clearTimeout(timer);
      if (c) resolve(c);
      else reject(new Error(err || "missing code"));
    });
    openUrl(auth, { spawnSyncFn: spawn });
  }).finally(() => server.close());
}

/** The Desktop client in the OAuth JSON at `credsPath`; throws when it names no client id. */
function readClient(credsPath: string): { clientId: string; clientSecret: string } {
  const raw = rec(readJson(credsPath));
  const inst = rec(raw.installed || raw.web);
  if (!inst.client_id) throw new Error("OAuth JSON needs installed.client_id (Desktop app download)");
  return { clientId: String(inst.client_id), clientSecret: String(inst.client_secret || "") };
}

export async function loginLoopback(
  credsPath: string,
  account: WorkspaceAccount = accountContext(),
  spawn: SpawnFn = spawnSync,
): Promise<void> {
  const { clientId, clientSecret } = readClient(credsPath);
  const verifier = crypto.randomBytes(VERIFIER_BYTES).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const loop = await listenLoopback();
  const { redirect } = loop;
  const code = await awaitCode(loop, consentUrl(clientId, challenge, redirect), spawn);
  const grant = { client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier };
  const j = await jsonRecord(
    await postForm(new URLSearchParams({ ...grant, grant_type: "authorization_code", redirect_uri: redirect })),
  );
  if (!j.access_token) throw tokenError(j, "token exchange failed");
  writeSecretJson(tokenStorePath(account), {
    access_token: j.access_token,
    client_id: clientId,
    client_secret: clientSecret,
    expiry_date: Date.now() + Number(j.expires_in || DEFAULT_LIFETIME_S) * MS_PER_SECOND,
    refresh_token: j.refresh_token || loadToken(account)?.refresh_token,
    type: ADC_USER,
  });
}

export function loginArgs(): string[] {
  return ["login", "--extra-scopes", EXTRA_SCOPES.join(",")];
}

function parseReply(text: string): Rec {
  try {
    const parsed: unknown = text ? JSON.parse(text) : null;
    return rec(parsed);
  } catch {
    return { raw: text.slice(0, RAW_REPLY_CHARS) };
  }
}

/** A Google API call with the account's bearer token; a string body is sent as JSON. */
export async function gfetch(
  account: WorkspaceAccount,
  url: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<GResult> {
  const token = await accessToken(account);
  const r = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const json = parseReply(await r.text());
  return { json, ok: r.status >= HTTP_OK && r.status < HTTP_MULTIPLE, status: r.status };
}
