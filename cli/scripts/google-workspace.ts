#!/usr/bin/env bun
/** Google Workspace verbs: sheet/doc/slide/meeting/mail. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";

import { repoEnv } from "../repo-env.ts";
import { accountContext, credsDefaultPath, filled, listAccounts, tokenStorePath } from "./google-workspace-account.ts";
import { accessToken, gfetch, loginLoopback } from "./google-workspace-auth.ts";
import {
  createFile,
  docAppend,
  driveList,
  fileLine,
  sheetAppend,
  sheetClear,
  sheetGet,
  sheetSet,
} from "./google-workspace-files.ts";
import { mailList, mailSend, meetingCreate } from "./google-workspace-meet.ts";
import { apiMessage, errMessage, fail, jsonRecord, ok } from "./google-workspace-reply.ts";
import {
  ARG_END,
  CLOUD_SCOPE,
  DEFAULT_ACCOUNT,
  EMAIL_SCOPE,
  EXTRA_SCOPES,
  FLAG_PREFIX,
  FLAG_PREFIX_LEN,
  FLAG_SET,
  KIND_DOC,
  KIND_SHEET,
  KIND_SLIDE,
  SPACES_RE,
  TOKENINFO_URL,
  USAGE,
  USERINFO_URL,
} from "./google-workspace.constants.ts";
import type { Flags, ParsedArgv, SpawnFn, Verb, VerbCtx, WorkspaceAccount } from "./google-workspace.types.ts";

export function parseArgv(argv: string[]): ParsedArgv {
  const out: ParsedArgv = { _: [], flags: {} };
  const rest = [...argv];

  for (let a = rest.shift(); a !== undefined; a = rest.shift()) {
    if (a === ARG_END) {
      out._.push(...rest);
      break;
    }

    if (a.startsWith(FLAG_PREFIX)) {
      const key = a.slice(FLAG_PREFIX_LEN);
      const nxt = rest[0];

      if (nxt !== undefined && nxt !== "" && !nxt.startsWith(FLAG_PREFIX)) {
        out.flags[key] = nxt;
        rest.shift();
      } else {
        out.flags[key] = FLAG_SET;
      }
    } else {
      out._.push(a);
    }
  }

  return out;
}

export async function whoami(account: WorkspaceAccount): Promise<number> {
  const r = await gfetch(account, USERINFO_URL);

  if (!r.ok) return fail(apiMessage(r.json, "whoami failed"));

  return ok(filled(r.json.email) ?? JSON.stringify(r.json));
}

async function scopeList(account: WorkspaceAccount): Promise<number> {
  const token = await accessToken(account);
  const reply = await fetch(`${TOKENINFO_URL}?access_token=${encodeURIComponent(token)}`);
  const j = await jsonRecord(reply);

  const list = (filled(j.scope) ?? "")
    .split(SPACES_RE)
    .filter((scope) => scope !== "")
    .toSorted();

  return ok(filled(list.join("\n")) ?? filled(j.error) ?? "no scopes");
}

function loginGcloud(spawn: SpawnFn): void {
  const list = [CLOUD_SCOPE, EMAIL_SCOPE, ...EXTRA_SCOPES].join(",");
  const r = spawn("gcloud", ["auth", "application-default", "login", `--scopes=${list}`], { stdio: "inherit" });

  if (r.status !== 0) throw new Error("gcloud auth application-default login failed");
}

/** `login`: the loopback flow when the OAuth JSON exists, else gcloud ADC when gcloud is on PATH. */
async function runLogin({ account, flags, spawn }: VerbCtx): Promise<number> {
  const creds = filled(flags.creds) ?? credsDefaultPath(account);

  if (fs.existsSync(creds)) {
    await loginLoopback(creds, account, spawn);

    return ok(`logged in\n${tokenStorePath(account)}`);
  }

  if (spawn("gcloud", ["--version"], { encoding: "utf8" }).status === 0) {
    loginGcloud(spawn);

    return ok("logged in via gcloud ADC");
  }

  return fail(`missing Desktop OAuth JSON (${creds}). setup: bun repo setup google-workspace`);
}

async function createKind({ account, flags }: VerbCtx, kind: string): Promise<number> {
  const j = await createFile(account, { body: flags.body, csv: flags.csv, kind, title: flags.title });

  return ok(fileLine(j));
}

function sendMail({ account, flags }: VerbCtx): Promise<number> {
  return mailSend(account, { body: flags.body, subject: flags.subject, to: flags.to });
}

function listMail({ account, flags }: VerbCtx): Promise<number> {
  return mailList(account, { n: flags.n, query: filled(flags.query) ?? flags.q });
}

function listDrive({ account, flags }: VerbCtx): Promise<number> {
  return driveList(account, { n: flags.n, query: filled(flags.query) ?? flags.q });
}

function createMeeting({ account, flags }: VerbCtx): Promise<number> {
  const { attendees, end, start, title, when } = flags;

  return meetingCreate(account, { attendees: filled(attendees) ?? flags.to, end, start, title, when });
}

function range(flags: Flags): string | undefined {
  return filled(flags.range) ?? flags.cell;
}

type Table<T> = Readonly<Record<string, T>>;

/** The verbs that ignore the noun. */
const SOLO: Table<Verb> = {
  accounts: ({ account }) => Promise.resolve(ok(listAccounts(account.home))),
  login: runLogin,
  scopes: ({ account }) => scopeList(account),
  whoami: ({ account }) => whoami(account),
};

const SHEET_VERBS: Table<Verb> = {
  append: ({ account, flags }) => sheetAppend(account, { csv: flags.csv, id: flags.id, range: range(flags) }),
  clear: ({ account, flags }) => sheetClear(account, { id: flags.id, range: range(flags) }),
  create: (ctx) => createKind(ctx, KIND_SHEET),
  get: ({ account, flags }) => sheetGet(account, { id: flags.id, range: range(flags) }),
  set: ({ account, flags }) =>
    sheetSet(account, { cell: filled(flags.cell) ?? flags.range, id: flags.id, value: flags.value ?? flags.a1 }),
};

const SLIDE_VERBS: Table<Verb> = { create: (ctx) => createKind(ctx, KIND_SLIDE) };
const MEETING_VERBS: Table<Verb> = { create: createMeeting };

/** The verb-noun pairs; `drive` alone lists. */
const PAIRS: Table<Table<Verb>> = {
  doc: {
    append: ({ account, flags }) => docAppend(account, { body: flags.body, id: flags.id }),
    create: (ctx) => createKind(ctx, KIND_DOC),
  },
  drive: { "": listDrive, list: listDrive, ls: listDrive },
  event: MEETING_VERBS,
  mail: { list: listMail, ls: listMail, send: sendMail },
  meeting: MEETING_VERBS,
  sheet: SHEET_VERBS,
  slide: SLIDE_VERBS,
  slides: SLIDE_VERBS,
};

/** `table`'s own entry for `key`; inherited names such as `constructor` are not verbs. */
function own<T>(table: Table<T> | undefined, key: string): T | undefined {
  return table !== undefined && Object.hasOwn(table, key) ? table[key] : undefined;
}

export async function main(argv: string[], spawn: SpawnFn = spawnSync): Promise<number> {
  const { _, flags } = parseArgv(argv);
  const account = accountContext(filled(flags.account) ?? filled(repoEnv.process.WORKSPACE_ACCOUNT) ?? DEFAULT_ACCOUNT);
  const verb = (_[0] ?? "").toLowerCase();
  const noun = (_[1] ?? "").toLowerCase();
  const run = own(SOLO, verb) ?? own(own(PAIRS, verb), noun);

  try {
    if (run !== undefined) return await run({ account, flags, spawn });

    return fail(USAGE);
  } catch (e) {
    return fail(errMessage(e));
  }
}
