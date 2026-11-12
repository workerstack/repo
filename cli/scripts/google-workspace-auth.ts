/** Logging in to Google (loopback OAuth or gcloud ADC), refreshing the access token, and the authorized fetch. */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { z } from "zod";

import { tryJson } from "../json.ts";
import {
  accountContext,
  filled,
  loadToken,
  persistToken,
  readSecretJson,
  tokenStorePath,
  writeSecretJson,
} from "./google-workspace-account.ts";
import { jsonRecord } from "./google-workspace-reply.ts";
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

function postForm(body: URLSearchParams): Promise<Response> {
  return fetch(TOKEN_URL, { body, headers: { "Content-Type": FORM_TYPE }, method: "POST" });
}

/** The token server's reply's error text, its code, or `fallback`. */
function tokenError(j: Rec, fallback: string): Error {
  return new Error(filled(j.error_description) ?? filled(j.error) ?? fallback);
}

/** When a token the server just issued expires, `expires_in` seconds (an hour by default) from now. */
function expiryFromNow(j: Rec): number {
  const seconds = Number(j.expires_in);

  return Date.now() + (seconds > 0 ? seconds : DEFAULT_LIFETIME_S) * MS_PER_SECOND;
}

/** When a refreshed token expires: the server's own date, else `expires_in` from now. */
function expiryOf(j: Rec): number {
  return typeof j.expiry_date === "number" && j.expiry_date > 0 ? j.expiry_date : expiryFromNow(j);
}

function cachedAccess(t: Token): string | undefined {
  const isFresh = Number(t.expiry_date) > Date.now() + EXPIRY_SLACK_MS;

  return isFresh ? filled(t.access_token) : undefined;
}

/** A fresh access token for the account, refreshed and saved back when the cached one is near expiry. */
export async function accessToken(account: WorkspaceAccount = accountContext()): Promise<string> {
  const t = loadToken(account);

  if (t === null) throw new Error("not logged in; run bun repo google-workspace login");
  const cached = cachedAccess(t);

  if (cached !== undefined) return cached;

  const form = { client_id: t.client_id, client_secret: filled(t.client_secret) ?? "" };
  const grant = { ...form, grant_type: "refresh_token", refresh_token: t.refresh_token };
  const reply = await postForm(new URLSearchParams(grant));
  const j = await jsonRecord(reply);
  const access = filled(j.access_token);

  if (access === undefined) throw tokenError(j, "token refresh failed");

  t.access_token = access;
  t.expiry_date = expiryOf(j);
  persistToken(account, t);

  return access;
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
      const why = filled(err) ?? "missing code";
      const code = filled(c);
      res.end(code === undefined ? why : "Logged in. Return to the terminal.");
      clearTimeout(timer);

      if (code === undefined) reject(new Error(why));
      else resolve(code);
    });
    openUrl(auth, { spawnSyncFn: spawn });
  }).finally(() => server.close());
}

/** An OAuth client JSON: its installed or web client, each with a client id and an optional secret. */
function credsSchema() {
  const client = z
    .looseObject({ client_id: z.string().min(1), client_secret: z.string().catch("") })
    .optional()
    .catch(undefined);

  return z.looseObject({ installed: client, web: client });
}

/** The Desktop client in the OAuth JSON at `credsPath`; throws when it names no client id. */
function readClient(credsPath: string): { clientId: string; clientSecret: string } {
  const creds = readSecretJson(credsPath, credsSchema());
  const inst = creds?.installed ?? creds?.web;

  if (inst === undefined) throw new Error("OAuth JSON needs installed.client_id (Desktop app download)");

  return { clientId: inst.client_id, clientSecret: inst.client_secret };
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

  const reply = await postForm(
    new URLSearchParams({ ...grant, grant_type: "authorization_code", redirect_uri: redirect }),
  );

  const j = await jsonRecord(reply);
  const access = filled(j.access_token);

  if (access === undefined) throw tokenError(j, "token exchange failed");
  writeSecretJson(tokenStorePath(account), {
    access_token: access,
    client_id: clientId,
    client_secret: clientSecret,
    expiry_date: expiryFromNow(j),
    refresh_token: filled(j.refresh_token) ?? loadToken(account)?.refresh_token,
    type: ADC_USER,
  });
}

export function loginArgs(): string[] {
  return ["login", "--extra-scopes", EXTRA_SCOPES.join(",")];
}

/** Google's reply body: its object, empty for no body or another JSON value, or the start of text that is not JSON. */
function parseReply(text: string): Rec {
  if (text === "") return {};

  return tryJson(z.record(z.string(), z.json()).catch({}), text) ?? { raw: text.slice(0, RAW_REPLY_CHARS) };
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
      ...(filled(init.body) === undefined ? {} : { "Content-Type": "application/json" }),
      ...init.headers,
    },
  });

  const text = await r.text();
  const json = parseReply(text);

  return { json, ok: r.status >= HTTP_OK && r.status < HTTP_MULTIPLE, status: r.status };
}
