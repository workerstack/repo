#!/usr/bin/env node
/** Google Workspace verbs: sheet/doc/slide/meeting/mail. */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const MIME = {
  sheet: "application/vnd.google-apps.spreadsheet",
  doc: "application/vnd.google-apps.document",
  slide: "application/vnd.google-apps.presentation",
};

let accountId = "default";

export function setAccount(id) {
  const s = String(id || "default").trim() || "default";
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(s)) {
    throw new Error("bad --account (letters, numbers, _- only)");
  }
  accountId = s;
  return accountId;
}

function gruntHome() {
  const d = path.join(os.homedir(), ".grunt");
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}

function accountDir() {
  return path.join(gruntHome(), "workspace", accountId);
}

function tokenStorePath() {
  const nested = path.join(accountDir(), "tokens.json");
  if (accountId === "default") {
    const legacy = path.join(gruntHome(), "workspace-tokens.json");
    if (!fs.existsSync(nested) && fs.existsSync(legacy)) return legacy;
  }
  return nested;
}

function credsDefaultPath() {
  const nested = path.join(accountDir(), "google-oauth.json");
  if (accountId === "default") {
    const legacy = path.join(gruntHome(), "google-oauth.json");
    if (!fs.existsSync(nested) && fs.existsSync(legacy)) return legacy;
  }
  return nested;
}

function adcPath() {
  return path.join(os.homedir(), ".config", "gcloud", "application_default_credentials.json");
}

function clasprcPath() {
  return path.join(os.homedir(), ".clasprc.json");
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeSecretJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", { mode: 0o600 });
}

function tokenFromStore() {
  const p = tokenStorePath();
  const j = readJson(p);
  if (j && j.refresh_token && j.client_id) return { ...j, _path: p };
  return null;
}

function tokenFromAdc() {
  const p = adcPath();
  const j = readJson(p);
  if (j && j.type === "authorized_user" && j.refresh_token && j.client_id) {
    return { ...j, _path: p };
  }
  return null;
}

function tokenFromClasprc() {
  const p = clasprcPath();
  const j = readJson(p);
  const t = j && j.tokens && j.tokens.default;
  if (!t || !t.refresh_token) return null;
  return { ...t, _path: p, _clasprc: true };
}

function loadToken() {
  return tokenFromStore() || tokenFromAdc() || tokenFromClasprc();
}

function persistToken(t, access, expiry) {
  t.access_token = access;
  t.expiry_date = expiry;
  if (t._clasprc) {
    const raw = readJson(t._path) || { tokens: {} };
    raw.tokens = raw.tokens || {};
    const rest = { ...t };
    delete rest._path;
    delete rest._clasprc;
    raw.tokens.default = rest;
    writeSecretJson(t._path, raw);
    return;
  }
  const dest = t._path && t._path !== adcPath() ? t._path : tokenStorePath();
  const rest = { ...t };
  delete rest._path;
  delete rest._clasprc;
  writeSecretJson(dest, rest);
}

async function accessToken() {
  const t = loadToken();
  if (!t) throw new Error("not logged in; run node scripts/google-workspace.mjs login");
  if (t.access_token && Number(t.expiry_date) > Date.now() + 60_000) {
    return t.access_token;
  }
  const body = new URLSearchParams({
    client_id: t.client_id,
    client_secret: t.client_secret || "",
    refresh_token: t.refresh_token,
    grant_type: "refresh_token",
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = await r.json();
  if (!j.access_token) {
    throw new Error(j.error_description || j.error || "token refresh failed");
  }
  const expiry = j.expiry_date
    ? j.expiry_date
    : Date.now() + Number(j.expires_in || 3600) * 1000;
  persistToken(t, j.access_token, expiry);
  return j.access_token;
}

function whichGcloud() {
  const r = spawnSync("gcloud", ["--version"], { encoding: "utf8" });
  return r.status === 0;
}

function openUrl(url) {
  if (process.platform === "darwin") {
    spawnSync("open", [url], { stdio: "ignore" });
  } else if (process.platform === "win32") {
    spawnSync("cmd", ["/c", "start", "", url], {
      stdio: "ignore",
      windowsVerbatimArguments: true,
    });
  } else {
    spawnSync("xdg-open", [url], { stdio: "ignore" });
  }
}

async function loginLoopback(credsPath) {
  const raw = readJson(credsPath);
  const inst = raw && (raw.installed || raw.web);
  if (!inst || !inst.client_id) {
    throw new Error("OAuth JSON needs installed.client_id (Desktop app download)");
  }
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const server = http.createServer();
  await new Promise((res, rej) => {
    server.listen(0, "127.0.0.1", res);
    server.on("error", rej);
  });
  const port = server.address().port;
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
      client_id: inst.client_id,
      redirect_uri: redirect,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      scope,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("login timed out")), 180_000);
    server.on("request", (req, res) => {
      const u = new URL(req.url, redirect);
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
    client_id: inst.client_id,
    client_secret: inst.client_secret || "",
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
  const j = await r.json();
  if (!j.access_token) throw new Error(j.error_description || j.error || "token exchange failed");
  writeSecretJson(tokenStorePath(), {
    type: "authorized_user",
    client_id: inst.client_id,
    client_secret: inst.client_secret || "",
    refresh_token: j.refresh_token || (loadToken() || {}).refresh_token,
    access_token: j.access_token,
    expiry_date: Date.now() + Number(j.expires_in || 3600) * 1000,
  });
}

function loginGcloud() {
  const scopes = [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    ...EXTRA_SCOPES,
  ].join(",");
  const r = spawnSync(
    "gcloud",
    ["auth", "application-default", "login", `--scopes=${scopes}`],
    { stdio: "inherit" },
  );
  if (r.status !== 0) throw new Error("gcloud auth application-default login failed");
}

async function runLogin(flags) {
  const creds = flags.creds || credsDefaultPath();
  if (fs.existsSync(creds)) {
    await loginLoopback(creds);
    return ok(`logged in\n${tokenStorePath()}`);
  }
  if (whichGcloud()) {
    loginGcloud();
    return ok("logged in via gcloud ADC");
  }
  openUrl("https://console.cloud.google.com/projectcreate");
  openUrl("https://console.cloud.google.com/apis/credentials");
  return fail(
    [
      "Each person creates their own Desktop OAuth client (local only; Google blocks clasp's public app for Calendar/Gmail).",
      "1. Create a GCP project (yours)",
      "2. OAuth consent = Testing + your email as test user, or Internal on your Workspace",
      "3. Enable Calendar, Gmail, Sheets, Docs, Drive APIs",
      "4. Credentials → Create OAuth client → Desktop → download JSON",
      `5. Save as ${creds} (do not share or commit)`,
      "6. node scripts/google-workspace.mjs login",
      "Or: brew install --cask google-cloud-sdk && node scripts/google-workspace.mjs login",
    ].join("\n"),
  );
}

async function gfetch(url, init = {}) {
  const token = await accessToken();
  const r = await fetch(url, {
    ...init,
    headers: {
      Authorization: "Bearer " + token,
      ...(init.body && typeof init.body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...(init.headers || {}),
    },
  });
  const text = await r.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { status: r.status, json, ok: r.status >= 200 && r.status < 300 };
}

function parseArgv(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
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

function fail(msg) {
  process.stderr.write(msg.trimEnd() + "\n");
  return 1;
}

function ok(msg) {
  process.stdout.write(msg.trimEnd() + "\n");
  return 0;
}

async function whoami() {
  const r = await gfetch("https://www.googleapis.com/oauth2/v2/userinfo");
  if (!r.ok) return fail(r.json?.error?.message || "whoami failed");
  return ok(r.json.email || JSON.stringify(r.json));
}

async function createFile({ kind, title, csv, body }) {
  const mime = MIME[kind];
  if (!mime) throw new Error("unknown kind");
  const name = title || `grunt-${kind}`;
  if (kind === "sheet" && csv) {
    const meta = JSON.stringify({ name, mimeType: mime });
    const boundary = "grunt_ws_" + Date.now();
    const blob =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n` +
      `--${boundary}--`;
    const token = await accessToken();
    const r = await fetch(
      `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,webViewLink`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body: blob,
      },
    );
    const json = await r.json();
    if (!r.ok) throw new Error(json.error?.message || "upload failed");
    return json;
  }
  if (kind === "doc" && body) {
    const meta = JSON.stringify({ name, mimeType: mime });
    const boundary = "grunt_ws_" + Date.now();
    const blob =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}\r\n` +
      `--${boundary}--`;
    const token = await accessToken();
    const r = await fetch(
      `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,webViewLink`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body: blob,
      },
    );
    const json = await r.json();
    if (!r.ok) throw new Error(json.error?.message || "upload failed");
    return json;
  }
  const r = await gfetch(`${DRIVE}/files?fields=id,name,webViewLink`, {
    method: "POST",
    body: JSON.stringify({ name, mimeType: mime }),
  });
  if (!r.ok) throw new Error(r.json?.error?.message || "create failed");
  return r.json;
}

function fileLine(j) {
  return `${j.name}\n${j.webViewLink || j.id}\nid=${j.id}`;
}

export function parseCsv(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.split(",").map((c) => c.trim()))
    .filter((row) => row.some((c) => c !== ""));
}

async function sheetGet({ id, range }) {
  if (!id) return fail("sheet get needs --id");
  const r = await gfetch(
    `${SHEETS}/spreadsheets/${id}/values/${encodeURIComponent(range || "A1:Z50")}`,
  );
  if (!r.ok) return fail(r.json?.error?.message || "sheet get failed");
  const rows = r.json.values || [];
  if (!rows.length) return ok("(empty)");
  return ok(rows.map((row) => row.join("\t")).join("\n"));
}

async function sheetAppend({ id, csv, range }) {
  if (!id) return fail("sheet append needs --id");
  const values = parseCsv(csv);
  if (!values.length) return fail("sheet append needs --csv");
  const r = await gfetch(
    `${SHEETS}/spreadsheets/${id}/values/${encodeURIComponent(range || "A1")}:append?valueInputOption=USER_ENTERED`,
    { method: "POST", body: JSON.stringify({ values }) },
  );
  if (!r.ok) return fail(r.json?.error?.message || "sheet append failed");
  return ok(`appended ${r.json.updates?.updatedRows || values.length}`);
}

async function sheetClear({ id, range }) {
  if (!id) return fail("sheet clear needs --id");
  const r = await gfetch(
    `${SHEETS}/spreadsheets/${id}/values/${encodeURIComponent(range || "A1:Z")}:clear`,
    { method: "POST", body: "{}" },
  );
  if (!r.ok) return fail(r.json?.error?.message || "sheet clear failed");
  return ok(`cleared ${r.json.clearedRange || range || "A1:Z"}`);
}

async function docAppend({ id, body }) {
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
  if (!r.ok) return fail(r.json?.error?.message || "doc append failed");
  return ok(`appended id=${id}`);
}

async function driveList({ query, n }) {
  const q = new URLSearchParams({
    pageSize: String(n || 10),
    fields: "files(id,name,mimeType,webViewLink)",
  });
  if (query) q.set("q", query);
  const r = await gfetch(`${DRIVE}/files?${q}`);
  if (!r.ok) return fail(r.json?.error?.message || "drive list failed");
  const files = r.json.files || [];
  if (!files.length) return ok("no files");
  return ok(
    files
      .map((f) => `${f.name}\t${f.id}\t${f.webViewLink || f.mimeType || ""}`)
      .join("\n"),
  );
}

async function sheetSet({ id, cell, value }) {
  const range = encodeURIComponent(cell || "A1");
  const r = await gfetch(
    `${SHEETS}/spreadsheets/${id}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({ values: [[value ?? ""]] }),
    },
  );
  if (r.ok) return ok(`updated ${r.json.updatedRange || cell}`);
  const msg = r.json?.error?.message || "sheet set failed";
  return fail(
    msg.includes("has not been used") || msg.includes("SERVICE_DISABLED")
      ? `Sheets API is off on this OAuth project. Create the sheet with data instead: workspace sheet create --title … --csv "A1value"`
      : msg,
  );
}

function toGCalStamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function loginArgs() {
  return ["login", "--extra-scopes", EXTRA_SCOPES.join(",")];
}

async function scopes() {
  const token = await accessToken();
  const r = await fetch(
    "https://oauth2.googleapis.com/tokeninfo?access_token=" +
      encodeURIComponent(token),
  );
  const j = await r.json();
  const list = String(j.scope || "")
    .split(/\s+/)
    .filter(Boolean)
    .sort();
  return ok(list.join("\n") || j.error || "no scopes");
}

async function mailSend({ to, subject, body }) {
  if (!to) return fail("mail send needs --to");
  const raw = [
    `To: ${to}`,
    `Subject: ${subject || "(no subject)"}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body || "",
  ].join("\r\n");
  const encoded = Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const r = await gfetch(`${GMAIL}/users/me/messages/send`, {
    method: "POST",
    body: JSON.stringify({ raw: encoded }),
  });
  if (!r.ok) return fail(r.json?.error?.message || "mail send failed");
  return ok(`sent id=${r.json.id}`);
}

async function mailList({ query, n }) {
  const q = new URLSearchParams({ maxResults: String(n || 5) });
  if (query) q.set("q", query);
  const r = await gfetch(`${GMAIL}/users/me/messages?${q}`);
  if (!r.ok) return fail(r.json?.error?.message || "mail list failed");
  const ids = (r.json.messages || []).map((m) => m.id);
  return ok(ids.length ? ids.join("\n") : "no messages");
}

async function meetingCreate({ title, start, end, when, attendees }) {
  let startIso = start;
  let endIso = end;
  if (!startIso && when) startIso = when;
  if (!startIso) startIso = new Date(Date.now() + 3600_000).toISOString();
  if (!endIso) endIso = new Date(new Date(startIso).getTime() + 3600_000).toISOString();
  const event = {
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
    return ok(`${r.json.summary}\n${r.json.htmlLink}\nid=${r.json.id}`);
  }
  const stamp0 = toGCalStamp(startIso);
  const stamp1 = toGCalStamp(endIso);
  const template =
    "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    `&text=${encodeURIComponent(event.summary)}` +
    (stamp0 && stamp1 ? `&dates=${stamp0}/${stamp1}` : "");
  return fail(
    `Calendar API blocked (${r.json?.error?.message || r.status}). Open to confirm:\n${template}`,
  );
}

function listAccounts() {
  const root = path.join(gruntHome(), "workspace");
  const names = new Set();
  if (fs.existsSync(path.join(gruntHome(), "google-oauth.json")) ||
      fs.existsSync(path.join(gruntHome(), "workspace-tokens.json"))) {
    names.add("default");
  }
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

async function main(argv = process.argv.slice(2)) {
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
    return fail(String(e && e.message ? e.message : e));
  }
}

export { parseArgv, createFile, meetingCreate, whoami, accessToken, main };

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile || import.meta.url === pathToFileURL(invoked).href) {
  main().then((code) => process.exit(code));
}
