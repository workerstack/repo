#!/usr/bin/env bun
/** Google Workspace verbs: sheet/doc/slide/meeting/mail. */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isRecord } from "./hook-input.ts";

type Rec = Record<string, unknown>;

/** A stored OAuth refresh token plus where it was read from. */
export type Token = Rec & {
  refresh_token: string;
  client_id: string;
  _path: string;
  _clasprc?: true;
};

export interface SpawnSyncOpts {
  stdio: "ignore";
  windowsVerbatimArguments?: boolean;
}

export interface FileSpec {
  kind: string;
  title?: string;
  csv?: string;
  body?: string;
}

export interface MeetingSpec {
  title?: string;
  start?: string;
  end?: string;
  when?: string;
  attendees?: string;
}

interface GResult {
  status: number;
  json: Rec;
  ok: boolean;
}

function rec(v: unknown): Rec {
  return isRecord(v) ? v : {};
}

/** The `error.message` of a Google API reply, or the fallback. */
function apiMessage(json: unknown, fallback: string): string {
  const m = rec(rec(json).error).message;
  return m ? String(m) : fallback;
}

function errMessage(e: unknown): string {
  const m = isRecord(e) ? e.message : undefined;
  return String(m || e);
}

async function jsonRecord(r: Response): Promise<Rec> {
  const j: unknown = await r.json();
  return rec(j);
}

const DRIVE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const SHEETS = "https://sheets.googleapis.com/v4";
const DOCS = "https://docs.googleapis.com/v1";
const CALENDAR = "https://www.googleapis.com/calendar/v3";
const GMAIL = "https://gmail.googleapis.com/gmail/v1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Extra clasp login scopes. Clasp's default consent is Apps Script + Drive only. */
export const EXTRA_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/forms.body",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/contacts",
  "https://www.googleapis.com/auth/tasks",
];
const MIME: Record<string, string> = {
  sheet: "application/vnd.google-apps.spreadsheet",
  doc: "application/vnd.google-apps.document",
  slide: "application/vnd.google-apps.presentation",
};

let accountId = "default";

export function setAccount(id: unknown): string {
  const s = String(id || "default").trim() || "default";
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(s)) {
    throw new Error("bad --account (letters, numbers, _- only)");
  }
  accountId = s;
  return accountId;
}

function stateHome() {
  const d = path.join(os.homedir(), ".workerstack");
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}

function accountDir() {
  return path.join(stateHome(), "workspace", accountId);
}

export function tokenStorePath(): string {
  return path.join(accountDir(), "tokens.json");
}

export function credsDefaultPath(): string {
  return path.join(accountDir(), "google-oauth.json");
}

function adcPath() {
  return path.join(os.homedir(), ".config", "gcloud", "application_default_credentials.json");
}

function clasprcPath() {
  return path.join(os.homedir(), ".clasprc.json");
}

function readJson(p: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeSecretJson(p: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", { mode: 0o600 });
}

function toToken(j: Rec, p: string, extra: { _clasprc?: true } = {}): Token | null {
  if (typeof j.refresh_token !== "string" || !j.refresh_token) return null;
  if (typeof j.client_id !== "string" || !j.client_id) return null;
  return { ...j, refresh_token: j.refresh_token, client_id: j.client_id, _path: p, ...extra };
}

function tokenFromStore(): Token | null {
  const p = tokenStorePath();
  const j = rec(readJson(p));
  return toToken(j, p);
}

function tokenFromAdc(): Token | null {
  const p = adcPath();
  const j = rec(readJson(p));
  if (j.type === "authorized_user") return toToken(j, p);
  return null;
}

function tokenFromClasprc(): Token | null {
  const p = clasprcPath();
  const t = rec(rec(rec(readJson(p)).tokens).default);
  if (typeof t.refresh_token !== "string" || !t.refresh_token) return null;
  // Clasp's file carries no client_id check; the refresh needs one, so it stays whatever the file holds.
  return { ...t, refresh_token: t.refresh_token, client_id: String(t.client_id ?? ""), _path: p, _clasprc: true };
}

function loadToken(): Token | null {
  return tokenFromStore() || tokenFromAdc() || tokenFromClasprc();
}

function publicFields(t: Token): Rec {
  return Object.fromEntries(Object.entries(t).filter(([k]) => k !== "_path" && k !== "_clasprc"));
}

function persistToken(t: Token, access: unknown, expiry: unknown): void {
  t.access_token = access;
  t.expiry_date = expiry;
  if (t._clasprc) {
    const loaded = readJson(t._path);
    const raw: Rec = isRecord(loaded) ? loaded : { tokens: {} };
    const tokens: Rec = isRecord(raw.tokens) ? raw.tokens : {};
    tokens.default = publicFields(t);
    raw.tokens = tokens;
    writeSecretJson(t._path, raw);
    return;
  }
  const dest = t._path && t._path !== adcPath() ? t._path : tokenStorePath();
  writeSecretJson(dest, publicFields(t));
}

export async function accessToken(): Promise<string> {
  const t = loadToken();
  if (!t) throw new Error("not logged in; run bun repo google-workspace login");
  if (typeof t.access_token === "string" && t.access_token && Number(t.expiry_date) > Date.now() + 60_000) {
    return t.access_token;
  }
  const body = new URLSearchParams({
    client_id: t.client_id,
    client_secret: String(t.client_secret || ""),
    refresh_token: t.refresh_token,
    grant_type: "refresh_token",
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = await jsonRecord(r);
  if (typeof j.access_token !== "string" || !j.access_token) {
    throw new Error(String(j.error_description || j.error || "token refresh failed"));
  }
  const expiry = j.expiry_date ? j.expiry_date : Date.now() + Number(j.expires_in || 3600) * 1000;
  persistToken(t, j.access_token, expiry);
  return j.access_token;
}

function whichGcloud(): boolean {
  const r = spawnSync("gcloud", ["--version"], { encoding: "utf8" });
  return r.status === 0;
}

export function openUrl(
  url: string,
  {
    platform = process.platform,
    spawnSyncFn = spawnSync,
  }: { platform?: NodeJS.Platform; spawnSyncFn?: (cmd: string, args: string[], opts: SpawnSyncOpts) => unknown } = {},
): void {
  if (platform === "darwin") {
    spawnSyncFn("open", [url], { stdio: "ignore" });
  } else if (platform === "win32") {
    spawnSyncFn("cmd", ["/c", "start", "", url], {
      stdio: "ignore",
      windowsVerbatimArguments: true,
    });
  } else {
    spawnSyncFn("xdg-open", [url], { stdio: "ignore" });
  }
}

export async function loginLoopback(credsPath: string): Promise<void> {
  const raw = rec(readJson(credsPath));
  const inst = rec(raw.installed || raw.web);
  if (!inst.client_id) {
    throw new Error("OAuth JSON needs installed.client_id (Desktop app download)");
  }
  const clientId = String(inst.client_id);
  const clientSecret = String(inst.client_secret || "");
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const server = http.createServer();
  await new Promise<void>((res, rej) => {
    server.listen(0, "127.0.0.1", res);
    server.on("error", rej);
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("login server has no port");
  const port = addr.port;
  const redirect = `http://127.0.0.1:${port}`;
  const scope = [
    ...EXTRA_SCOPES,
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "openid",
  ].join(" ");
  const auth =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirect,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      scope,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("login timed out")), 180_000);
    server.on("request", (req, res) => {
      const u = new URL(req.url ?? "/", redirect);
      const c = u.searchParams.get("code");
      const err = u.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(c ? "Logged in. Return to the terminal." : String(err || "missing code"));
      clearTimeout(timer);
      if (c) resolve(c);
      else reject(new Error(err || "missing code"));
    });
    openUrl(auth);
  });
  server.close();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    code_verifier: verifier,
    redirect_uri: redirect,
    grant_type: "authorization_code",
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = await jsonRecord(r);
  if (!j.access_token) throw new Error(String(j.error_description || j.error || "token exchange failed"));
  writeSecretJson(tokenStorePath(), {
    type: "authorized_user",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: j.refresh_token || loadToken()?.refresh_token,
    access_token: j.access_token,
    expiry_date: Date.now() + Number(j.expires_in || 3600) * 1000,
  });
}

function loginGcloud(): void {
  const scopes = [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    ...EXTRA_SCOPES,
  ].join(",");
  const r = spawnSync("gcloud", ["auth", "application-default", "login", `--scopes=${scopes}`], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("gcloud auth application-default login failed");
}

async function runLogin(flags: Record<string, string>): Promise<number> {
  const creds = flags.creds || credsDefaultPath();
  if (fs.existsSync(creds)) {
    await loginLoopback(creds);
    return ok(`logged in\n${tokenStorePath()}`);
  }
  if (whichGcloud()) {
    loginGcloud();
    return ok("logged in via gcloud ADC");
  }
  return fail(`missing Desktop OAuth JSON (${creds}). setup: bun repo setup google-workspace`);
}

async function gfetch(
  url: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<GResult> {
  const token = await accessToken();
  const r = await fetch(url, {
    ...init,
    headers: {
      Authorization: "Bearer " + token,
      ...(init.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await r.text();
  let json: Rec;
  try {
    const parsed: unknown = text ? JSON.parse(text) : null;
    json = rec(parsed);
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { status: r.status, json, ok: r.status >= 200 && r.status < 300 };
}

function parseArgv(argv: string[]): { _: string[]; flags: Record<string, string> } {
  const out: { _: string[]; flags: Record<string, string> } = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!; // i < argv.length
    if (a === "--") {
      out._.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const nxt = argv[i + 1];
      if (nxt && !nxt.startsWith("--")) {
        out.flags[key] = nxt;
        i += 1;
      } else out.flags[key] = "1";
    } else out._.push(a);
  }
  return out;
}

function fail(msg: string): number {
  process.stderr.write(msg.trimEnd() + "\n");
  return 1;
}

function ok(msg: string): number {
  process.stdout.write(msg.trimEnd() + "\n");
  return 0;
}

async function whoami(): Promise<number> {
  const r = await gfetch("https://www.googleapis.com/oauth2/v2/userinfo");
  if (!r.ok) return fail(apiMessage(r.json, "whoami failed"));
  return ok(String(r.json.email || JSON.stringify(r.json)));
}

async function createFile({ kind, title, csv, body }: FileSpec): Promise<Rec> {
  const mime = MIME[kind];
  if (!mime) throw new Error("unknown kind");
  const name = title || `repo-${kind}`;
  if (kind === "sheet" && csv) {
    const meta = JSON.stringify({ name, mimeType: mime });
    const boundary = "repo_ws_" + Date.now();
    const blob =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n` +
      `--${boundary}--`;
    const token = await accessToken();
    const r = await fetch(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,webViewLink`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: blob,
    });
    const json = await jsonRecord(r);
    if (!r.ok) throw new Error(apiMessage(json, "upload failed"));
    return json;
  }
  if (kind === "doc" && body) {
    const meta = JSON.stringify({ name, mimeType: mime });
    const boundary = "repo_ws_" + Date.now();
    const blob =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}\r\n` +
      `--${boundary}--`;
    const token = await accessToken();
    const r = await fetch(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,webViewLink`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: blob,
    });
    const json = await jsonRecord(r);
    if (!r.ok) throw new Error(apiMessage(json, "upload failed"));
    return json;
  }
  const r = await gfetch(`${DRIVE}/files?fields=id,name,webViewLink`, {
    method: "POST",
    body: JSON.stringify({ name, mimeType: mime }),
  });
  if (!r.ok) throw new Error(apiMessage(r.json, "create failed"));
  return r.json;
}

function fileLine(j: Rec): string {
  return `${j.name}\n${j.webViewLink || j.id}\nid=${j.id}`;
}

export function parseCsv(text: unknown): string[][] {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.split(",").map((c) => c.trim()))
    .filter((row) => row.some((c) => c !== ""));
}

async function sheetGet({ id, range }: { id?: string; range?: string }): Promise<number> {
  if (!id) return fail("sheet get needs --id");
  const r = await gfetch(`${SHEETS}/spreadsheets/${id}/values/${encodeURIComponent(range || "A1:Z50")}`);
  if (!r.ok) return fail(apiMessage(r.json, "sheet get failed"));
  const rows: unknown[] = Array.isArray(r.json.values) ? r.json.values : [];
  if (!rows.length) return ok("(empty)");
  return ok(rows.map((row) => (Array.isArray(row) ? row : []).join("\t")).join("\n"));
}

async function sheetAppend({ id, csv, range }: { id?: string; csv?: string; range?: string }): Promise<number> {
  if (!id) return fail("sheet append needs --id");
  const values = parseCsv(csv);
  if (!values.length) return fail("sheet append needs --csv");
  const r = await gfetch(
    `${SHEETS}/spreadsheets/${id}/values/${encodeURIComponent(range || "A1")}:append?valueInputOption=USER_ENTERED`,
    { method: "POST", body: JSON.stringify({ values }) },
  );
  if (!r.ok) return fail(apiMessage(r.json, "sheet append failed"));
  return ok(`appended ${String(rec(r.json.updates).updatedRows || values.length)}`);
}

async function sheetClear({ id, range }: { id?: string; range?: string }): Promise<number> {
  if (!id) return fail("sheet clear needs --id");
  const r = await gfetch(`${SHEETS}/spreadsheets/${id}/values/${encodeURIComponent(range || "A1:Z")}:clear`, {
    method: "POST",
    body: "{}",
  });
  if (!r.ok) return fail(apiMessage(r.json, "sheet clear failed"));
  return ok(`cleared ${String(r.json.clearedRange || range || "A1:Z")}`);
}

async function docAppend({ id, body }: { id?: string; body?: string }): Promise<number> {
  if (!id) return fail("doc append needs --id");
  const r = await gfetch(`${DOCS}/documents/${id}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          insertText: {
            endOfSegmentLocation: {},
            text: String(body ?? ""),
          },
        },
      ],
    }),
  });
  if (!r.ok) return fail(apiMessage(r.json, "doc append failed"));
  return ok(`appended id=${id}`);
}

async function driveList({ query, n }: { query?: string; n?: string }): Promise<number> {
  const q = new URLSearchParams({
    pageSize: String(n || 10),
    fields: "files(id,name,mimeType,webViewLink)",
  });
  if (query) q.set("q", query);
  const r = await gfetch(`${DRIVE}/files?${q}`);
  if (!r.ok) return fail(apiMessage(r.json, "drive list failed"));
  const files: unknown[] = Array.isArray(r.json.files) ? r.json.files : [];
  if (!files.length) return ok("no files");
  return ok(
    files
      .map(rec)
      .map((f) => `${String(f.name)}\t${String(f.id)}\t${String(f.webViewLink || f.mimeType || "")}`)
      .join("\n"),
  );
}

async function sheetSet({ id, cell, value }: { id?: string; cell?: string; value?: string }): Promise<number> {
  const range = encodeURIComponent(cell || "A1");
  const r = await gfetch(`${SHEETS}/spreadsheets/${id}/values/${range}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values: [[value ?? ""]] }),
  });
  if (r.ok) return ok(`updated ${String(r.json.updatedRange || cell)}`);
  const msg = apiMessage(r.json, "sheet set failed");
  return fail(
    msg.includes("has not been used") || msg.includes("SERVICE_DISABLED")
      ? `Sheets API is off on this OAuth project. Create the sheet with data instead: workspace sheet create --title … --csv "A1value"`
      : msg,
  );
}

function toGCalStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export function loginArgs(): string[] {
  return ["login", "--extra-scopes", EXTRA_SCOPES.join(",")];
}

async function scopes(): Promise<number> {
  const token = await accessToken();
  const r = await fetch("https://oauth2.googleapis.com/tokeninfo?access_token=" + encodeURIComponent(token));
  const j = await jsonRecord(r);
  const list = String(j.scope || "")
    .split(/\s+/)
    .filter(Boolean)
    .sort();
  return ok(list.join("\n") || String(j.error || "no scopes"));
}

async function mailSend({ to, subject, body }: { to?: string; subject?: string; body?: string }): Promise<number> {
  if (!to) return fail("mail send needs --to");
  const raw = [
    `To: ${to}`,
    `Subject: ${subject || "(no subject)"}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body || "",
  ].join("\r\n");
  const encoded = Buffer.from(raw).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const r = await gfetch(`${GMAIL}/users/me/messages/send`, {
    method: "POST",
    body: JSON.stringify({ raw: encoded }),
  });
  if (!r.ok) return fail(apiMessage(r.json, "mail send failed"));
  return ok(`sent id=${String(r.json.id)}`);
}

async function mailList({ query, n }: { query?: string; n?: string }): Promise<number> {
  const q = new URLSearchParams({ maxResults: String(n || 5) });
  if (query) q.set("q", query);
  const r = await gfetch(`${GMAIL}/users/me/messages?${q}`);
  if (!r.ok) return fail(apiMessage(r.json, "mail list failed"));
  const messages: unknown[] = Array.isArray(r.json.messages) ? r.json.messages : [];
  const ids = messages.map((m) => rec(m).id);
  return ok(ids.length ? ids.join("\n") : "no messages");
}

async function meetingCreate({ title, start, end, when, attendees }: MeetingSpec): Promise<number> {
  let startIso = start;
  let endIso = end;
  if (!startIso && when) startIso = when;
  if (!startIso) startIso = new Date(Date.now() + 3600_000).toISOString();
  if (!endIso) endIso = new Date(new Date(startIso).getTime() + 3600_000).toISOString();
  const event: {
    summary: string;
    start: { dateTime: string };
    end: { dateTime: string };
    attendees?: { email: string }[];
  } = {
    summary: title || "meeting",
    start: { dateTime: startIso },
    end: { dateTime: endIso },
  };
  const emails = String(attendees || "")
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  if (emails.length) {
    event.attendees = emails.map((email) => ({ email }));
  }
  const r = await gfetch(`${CALENDAR}/calendars/primary/events`, {
    method: "POST",
    body: JSON.stringify(event),
  });
  if (r.ok) {
    return ok(`${String(r.json.summary)}\n${String(r.json.htmlLink)}\nid=${String(r.json.id)}`);
  }
  const stamp0 = toGCalStamp(startIso);
  const stamp1 = toGCalStamp(endIso);
  const template =
    "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    `&text=${encodeURIComponent(event.summary)}` +
    (stamp0 && stamp1 ? `&dates=${stamp0}/${stamp1}` : "");
  return fail(`Calendar API blocked (${apiMessage(r.json, String(r.status))}). Open to confirm:\n${template}`);
}

function listAccounts(): string {
  const root = path.join(stateHome(), "workspace");
  const names = new Set<string>();
  try {
    for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
      if (ent.isDirectory() && /^[a-zA-Z0-9_-]{1,40}$/.test(ent.name)) names.add(ent.name);
    }
  } catch {
    /* none */
  }
  const lines = [...names].sort().map((n) => {
    setAccount(n);
    const creds = fs.existsSync(credsDefaultPath()) ? "oauth" : "-";
    const tok = fs.existsSync(tokenStorePath()) ? "tokens" : "-";
    return `${n}  ${creds}  ${tok}`;
  });
  setAccount("default");
  return lines.length ? lines.join("\n") : "no accounts";
}

async function main(argv: string[]): Promise<number> {
  const { _, flags } = parseArgv(argv);
  setAccount(flags.account || process.env.WORKSPACE_ACCOUNT || "default");
  const verb = (_[0] || "").toLowerCase();
  const noun = (_[1] || "").toLowerCase();
  try {
    if (verb === "accounts") return ok(listAccounts());
    if (verb === "whoami") return await whoami();
    if (verb === "scopes") return await scopes();
    if (verb === "login") return await runLogin(flags);
    if (verb === "mail" && noun === "send") {
      return await mailSend({
        to: flags.to,
        subject: flags.subject,
        body: flags.body,
      });
    }
    if (verb === "mail" && (noun === "list" || noun === "ls")) {
      return await mailList({ query: flags.query || flags.q, n: flags.n });
    }
    if (verb === "sheet" && noun === "create") {
      const j = await createFile({
        kind: "sheet",
        title: flags.title,
        csv: flags.csv,
      });
      return ok(fileLine(j));
    }
    if (verb === "sheet" && noun === "set") {
      return await sheetSet({
        id: flags.id,
        cell: flags.cell || flags.range,
        value: flags.value ?? flags.a1,
      });
    }
    if (verb === "sheet" && noun === "get") {
      return await sheetGet({ id: flags.id, range: flags.range || flags.cell });
    }
    if (verb === "sheet" && noun === "append") {
      return await sheetAppend({
        id: flags.id,
        csv: flags.csv,
        range: flags.range || flags.cell,
      });
    }
    if (verb === "sheet" && noun === "clear") {
      return await sheetClear({ id: flags.id, range: flags.range || flags.cell });
    }
    if (verb === "doc" && noun === "append") {
      return await docAppend({ id: flags.id, body: flags.body });
    }
    if (verb === "drive" && (noun === "list" || noun === "ls" || !noun)) {
      return await driveList({ query: flags.query || flags.q, n: flags.n });
    }
    if (verb === "doc" && noun === "create") {
      const j = await createFile({
        kind: "doc",
        title: flags.title,
        body: flags.body,
      });
      return ok(fileLine(j));
    }
    if ((verb === "slide" || verb === "slides") && noun === "create") {
      const j = await createFile({ kind: "slide", title: flags.title });
      return ok(fileLine(j));
    }
    if ((verb === "meeting" || verb === "event") && noun === "create") {
      return await meetingCreate({
        title: flags.title,
        start: flags.start,
        end: flags.end,
        when: flags.when,
        attendees: flags.attendees || flags.to,
      });
    }
    return fail(
      "usage: google-workspace [--account NAME] whoami | scopes | accounts | login | sheet create --title T [--csv csv] | sheet set --id ID --cell A1 --value V | sheet get --id ID [--range A1:B2] | sheet append --id ID --csv csv | sheet clear --id ID [--range A1:Z] | doc create --title T [--body text] | doc append --id ID --body text | drive list [--query Q] | slide create --title T | meeting create --title T [--start ISO --end ISO] [--attendees a@b,c@d] | mail send --to E --subject S --body T | mail list",
    );
  } catch (e) {
    return fail(errMessage(e));
  }
}

export { parseArgv, createFile, meetingCreate, whoami, main };

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile || import.meta.url === pathToFileURL(invoked).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
