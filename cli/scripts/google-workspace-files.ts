/** Drive files, Sheets values and Docs text: the create, read and write verbs. */
import type { Json } from "../json.ts";
import { filled, rec } from "./google-workspace-account.ts";
import { accessToken, gfetch } from "./google-workspace-auth.ts";
import { apiMessage, fail, jsonRecord, ok } from "./google-workspace-reply.ts";
import {
  CSV_TYPE,
  DOCS,
  DRIVE,
  DRIVE_PAGE,
  DRIVE_UPLOAD,
  KIND_DOC,
  KIND_SHEET,
  LINE_RE,
  MIME,
  SHEETS,
  TEXT_TYPE,
} from "./google-workspace.constants.ts";
import type { FileSpec, Rec, WorkspaceAccount } from "./google-workspace.types.ts";
import { jsonText } from "./json-text.ts";

type Opt = string | undefined;

/** Creates a Drive file named `name` of type `mime` holding `content` of type `type`, in one multipart upload. */
async function uploadFile(
  account: WorkspaceAccount,
  file: { mime: string; name: string },
  part: string[],
): Promise<Rec> {
  const [type, content] = part;
  const meta = JSON.stringify({ mimeType: file.mime, name: file.name });
  const boundary = `repo_ws_${Date.now()}`;

  const blob =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: ${type}\r\n\r\n${content}\r\n` +
    `--${boundary}--`;

  const token = await accessToken(account);

  const r = await fetch(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,webViewLink`, {
    body: blob,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    method: "POST",
  });

  const json = await jsonRecord(r);

  if (!r.ok) throw new Error(apiMessage(json, "upload failed"));

  return json;
}

/** A new Drive doc, sheet or slide deck; a sheet with `csv` or a doc with `body` is uploaded with that content. */
export async function createFile(account: WorkspaceAccount, { kind, title, csv, body }: FileSpec): Promise<Rec> {
  const mime = MIME[kind];

  if (mime === undefined) throw new Error("unknown kind");
  const file = { mime, name: filled(title) ?? `repo-${kind}` };
  const sheetCsv = kind === KIND_SHEET ? filled(csv) : undefined;

  if (sheetCsv !== undefined) return uploadFile(account, file, [CSV_TYPE, sheetCsv]);
  const docBody = kind === KIND_DOC ? filled(body) : undefined;

  if (docBody !== undefined) return uploadFile(account, file, [TEXT_TYPE, docBody]);

  const r = await gfetch(account, `${DRIVE}/files?fields=id,name,webViewLink`, {
    body: JSON.stringify({ mimeType: mime, name: file.name }),
    method: "POST",
  });

  if (!r.ok) throw new Error(apiMessage(r.json, "create failed"));

  return r.json;
}

export function fileLine(j: Rec): string {
  return `${jsonText(j.name)}\n${filled(j.webViewLink) ?? jsonText(j.id)}\nid=${jsonText(j.id)}`;
}

export function parseCsv(text: string | undefined): string[][] {
  return (text ?? "")
    .split(LINE_RE)
    .map((line) => line.split(",").map((c) => c.trim()))
    .filter((row) => row.some((c) => c !== ""));
}

export async function sheetGet(account: WorkspaceAccount, { id, range }: { id?: Opt; range?: Opt }): Promise<number> {
  if (filled(id) === undefined) return fail("sheet get needs --id");
  const cells = encodeURIComponent(filled(range) ?? "A1:Z50");
  const r = await gfetch(account, `${SHEETS}/spreadsheets/${id}/values/${cells}`);

  if (!r.ok) return fail(apiMessage(r.json, "sheet get failed"));
  const rows: unknown[] = Array.isArray(r.json.values) ? r.json.values : [];

  if (rows.length === 0) return ok("(empty)");

  return ok(rows.map((row) => (Array.isArray(row) ? row : []).join("\t")).join("\n"));
}

export async function sheetAppend(
  account: WorkspaceAccount,
  { id, csv, range }: { id?: Opt; csv?: Opt; range?: Opt },
): Promise<number> {
  if (filled(id) === undefined) return fail("sheet append needs --id");
  const values = parseCsv(csv);

  if (values.length === 0) return fail("sheet append needs --csv");
  const cells = encodeURIComponent(filled(range) ?? "A1");

  const r = await gfetch(account, `${SHEETS}/spreadsheets/${id}/values/${cells}:append?valueInputOption=USER_ENTERED`, {
    body: JSON.stringify({ values }),
    method: "POST",
  });

  if (!r.ok) return fail(apiMessage(r.json, "sheet append failed"));
  const rows = Number(rec(r.json.updates).updatedRows);

  return ok(`appended ${rows > 0 ? rows : values.length}`);
}

export async function sheetClear(account: WorkspaceAccount, { id, range }: { id?: Opt; range?: Opt }): Promise<number> {
  if (filled(id) === undefined) return fail("sheet clear needs --id");
  const cells = encodeURIComponent(filled(range) ?? "A1:Z");

  const r = await gfetch(account, `${SHEETS}/spreadsheets/${id}/values/${cells}:clear`, {
    body: "{}",
    method: "POST",
  });

  if (!r.ok) return fail(apiMessage(r.json, "sheet clear failed"));

  return ok(`cleared ${filled(r.json.clearedRange) ?? range ?? "A1:Z"}`);
}

export async function sheetSet(
  account: WorkspaceAccount,
  { id, cell, value }: { id?: Opt; cell?: Opt; value?: Opt },
): Promise<number> {
  const range = encodeURIComponent(filled(cell) ?? "A1");

  const r = await gfetch(account, `${SHEETS}/spreadsheets/${id}/values/${range}?valueInputOption=USER_ENTERED`, {
    body: JSON.stringify({ values: [[value ?? ""]] }),
    method: "PUT",
  });

  if (r.ok) return ok(`updated ${filled(r.json.updatedRange) ?? String(cell)}`);
  const msg = apiMessage(r.json, "sheet set failed");

  return fail(
    msg.includes("has not been used") || msg.includes("SERVICE_DISABLED")
      ? "Sheets API is off on this OAuth project. " +
          'Create the sheet with data instead: workspace sheet create --title … --csv "A1value"'
      : msg,
  );
}

export async function docAppend(account: WorkspaceAccount, { id, body }: { id?: Opt; body?: Opt }): Promise<number> {
  if (filled(id) === undefined) return fail("doc append needs --id");
  const insertText = { endOfSegmentLocation: {}, text: body ?? "" };

  const r = await gfetch(account, `${DOCS}/documents/${id}:batchUpdate`, {
    body: JSON.stringify({ requests: [{ insertText }] }),
    method: "POST",
  });

  if (!r.ok) return fail(apiMessage(r.json, "doc append failed"));

  return ok(`appended id=${id}`);
}

export async function driveList(account: WorkspaceAccount, { query, n }: { query?: Opt; n?: Opt }): Promise<number> {
  const q = new URLSearchParams({
    fields: "files(id,name,mimeType,webViewLink)",
    pageSize: filled(n) ?? String(DRIVE_PAGE),
  });

  const filter = filled(query);

  if (filter !== undefined) q.set("q", filter);
  const r = await gfetch(account, `${DRIVE}/files?${q.toString()}`);

  if (!r.ok) return fail(apiMessage(r.json, "drive list failed"));
  const files: Json[] = Array.isArray(r.json.files) ? r.json.files : [];

  if (files.length === 0) return ok("no files");

  return ok(
    files
      .map(rec)
      .map((f) => `${jsonText(f.name)}\t${jsonText(f.id)}\t${filled(f.webViewLink) ?? filled(f.mimeType) ?? ""}`)
      .join("\n"),
  );
}
