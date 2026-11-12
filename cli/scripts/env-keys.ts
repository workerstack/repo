/**
 * `bun repo env init`, `key import` and `key ci [--dry-run]`. init writes this repo's key pair: the recipient to
 * `.repo/env.keys.json`, the identity to `~/.workerstack/keys/<repo>.key` (0600). key import saves a pasted identity
 * that unlocks the keys file's recipient. key ci hands gh the identity that does, on stdin, as `WORKERSTACK_ENV_KEY`.
 * A rerun with the same key says `already set up`; a key file for another recipient is refused, never overwritten.
 */
import fs from "node:fs";
import path from "node:path";

import { ENV_KEY_VARIABLE, KEYS_FILE } from "../env.constants.ts";
import { newIdentity, reveal, seal } from "../env/age.ts";
import { identities } from "../env/keys.ts";
import { parseArgs, type EnvArgs } from "./env-args.ts";
import {
  EXIT_OK,
  GH_SECRET,
  JSON_INDENT,
  KEY_DIR_MODE,
  KEY_MODE,
  PREFIX,
  PROBE,
  RECIPIENT_SHOWN,
  VERB_CI,
  VERB_IMPORT,
  VERB_INIT,
  VERB_KEY,
} from "./env-command.constants.ts";
import {
  checkoutName,
  guarded,
  ioOf,
  keyFileOf,
  keysAt,
  keysOrRefuse,
  readSecret,
  refuse,
  repoRoot,
  usage,
  type EnvDeps,
  type EnvIo,
} from "./env-io.ts";

const NONE = { command: "none", switches: [], values: [], words: 0 } as const;
const DRY_RUN = "--dry-run";

/** A recipient as the lines show it: its first characters, then `…`. */
function short(recipient: string): string {
  return `${recipient.slice(0, RECIPIENT_SHOWN)}…`;
}

/** Whether `identity` opens a probe sealed for `recipient`; text that is no key opens nothing. */
async function unlocks(identity: string, recipient: string): Promise<boolean> {
  try {
    const [text] = await reveal([await seal(PROBE, recipient)], [identity]);

    return text === PROBE;
  } catch {
    return false;
  }
}

/** The identity a key file holds: its first line that is neither blank nor a `#` comment. */
function identityIn(file: string): string {
  const lines = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim());

  return lines
    .filter((line) => line !== "" && !line.startsWith("#"))
    .slice(0, 1)
    .join("");
}

/** Writes `identity` as a new 0600 key file, its folder 0700; never over one that exists. */
function writeKeyFile(file: string, identity: string): void {
  fs.mkdirSync(path.dirname(file), { mode: KEY_DIR_MODE, recursive: true });
  fs.writeFileSync(file, `${identity}\n`, { flag: "wx", mode: KEY_MODE });
}

/** What a key file already at `key` says: set up when it unlocks `recipient`, else refused; absent when none is. */
async function existing(
  key: { file: string; label: string },
  recipient: string | undefined,
  verb: string,
): Promise<boolean> {
  if (!fs.existsSync(key.file)) return false;

  if (recipient !== undefined && (await unlocks(identityIn(key.file), recipient))) return true;

  return refuse(`${verb} found ${key.label} for another recipient; move it aside first`);
}

async function init(io: EnvIo): Promise<number> {
  const root = repoRoot(io.cwd);
  const keys = keysAt(root);
  const repo = keys?.repo ?? checkoutName(root);
  const key = keyFileOf(io.home, repo);

  if (await existing(key, keys?.recipient, "init")) {
    io.stdout(`${PREFIX}already set up (${repo})\n`);

    return EXIT_OK;
  }

  if (keys !== undefined)
    refuse(`${KEYS_FILE} names a key and none is at ${key.label}; run \`bun repo env key import\``);
  const pair = await newIdentity();
  writeKeyFile(key.file, pair.identity);

  try {
    fs.mkdirSync(path.join(root, path.dirname(KEYS_FILE)), { recursive: true });
    const body = JSON.stringify({ recipient: pair.recipient, repo }, null, JSON_INDENT);
    fs.writeFileSync(path.join(root, KEYS_FILE), `${body}\n`);
  } catch (error) {
    // A key file with no keys file naming it would make the rerun refuse; take it back so the rerun sets up.
    fs.rmSync(key.file, { force: true });
    throw error;
  }

  const wrote = `${KEYS_FILE} (recipient ${short(pair.recipient)}) and ${key.label} (0600)`;
  io.stdout(`${PREFIX}wrote ${wrote}; back the key up in a password manager\n`);

  return EXIT_OK;
}

async function keyImport(io: EnvIo): Promise<number> {
  const keys = keysOrRefuse(repoRoot(io.cwd));
  const answer = await readSecret(io, "Paste this repo's age key");
  const pasted = answer.trim();

  if (!(await unlocks(pasted, keys.recipient)))
    refuse(`the pasted key does not unlock ${short(keys.recipient)}; paste this repo's key`);
  const key = keyFileOf(io.home, keys.repo);

  if (await existing(key, keys.recipient, "key import")) {
    io.stdout(`${PREFIX}already set up (${keys.repo})\n`);

    return EXIT_OK;
  }

  writeKeyFile(key.file, pasted);
  io.stdout(`${PREFIX}saved ${key.label} (0600); it unlocks ${KEYS_FILE}'s recipient\n`);

  return EXIT_OK;
}

async function keyCi(io: EnvIo, args: EnvArgs): Promise<number> {
  const root = repoRoot(io.cwd);
  const keys = keysOrRefuse(root);
  const candidates = identities({ home: io.home, source: io.env });
  const checks = await Promise.all(candidates.map((identity) => unlocks(identity, keys.recipient)));
  const identity = candidates.find((_, index) => checks[index] === true);
  const { label } = keyFileOf(io.home, keys.repo);

  if (identity === undefined && Number(io.env[ENV_KEY_VARIABLE]?.length) > 0)
    refuse(`${ENV_KEY_VARIABLE} does not unlock ${short(keys.recipient)}; unset it or run \`bun repo env key import\``);

  if (identity === undefined)
    refuse(`key ci needs this repo's key, and no key is at ${label}; run \`bun repo env key import\``);
  const call = `gh ${GH_SECRET.join(" ")}`;

  if (args.switches.has(DRY_RUN)) {
    io.stdout(`${PREFIX}would run: ${call} (the key on stdin)\n`);

    return EXIT_OK;
  }

  const result = io.gh([...GH_SECRET], root, identity);

  if (result.code !== 0) refuse(`${call} failed: ${result.stderr.trim().split("\n", 1).join("")}`);
  io.stdout(`${PREFIX}ran: ${call} (the key on stdin)\n`);

  return EXIT_OK;
}

/** Runs `init`, `key import` or `key ci`; see the file comment. */
export function main(argv: string[], deps?: EnvDeps): Promise<number> {
  const io = ioOf(deps);
  const [verb, ...rest] = argv;
  const [sub, ...flags] = verb === VERB_KEY ? rest : [];

  if (verb === VERB_INIT && parseArgs(rest, NONE) !== null) return guarded(io, () => init(io));

  if (sub === VERB_IMPORT && parseArgs(flags, NONE) !== null) return guarded(io, () => keyImport(io));
  const ci = sub === VERB_CI ? parseArgs(flags, { ...NONE, switches: [DRY_RUN] }) : null;

  if (ci !== null) return guarded(io, () => keyCi(io, ci));

  return Promise.resolve(usage(io));
}
