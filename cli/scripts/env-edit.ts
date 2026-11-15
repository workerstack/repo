/**
 * `bun repo env set KEY --scope <global|local|dev|prod> [--plain] [--file f]`: reads the value from a hidden prompt or
 * stdin, seals it for `.repo/env.keys.json`'s recipient (or, with `--plain`, keeps it as text) and writes it into the
 * env file's config with oxc-parser: the property's value replaced, or the property appended to its block. The file is
 * written whole through a temp file and a rename, every other byte kept; on any failure it is left as it was.
 */
import fs from "node:fs";
import path from "node:path";

import type { ImportSpecifier, ObjectExpression } from "oxc-parser";

import { DEFINE_ENV } from "../check-env-values.constants.ts";
import { nameOf, sourceOf, type Source } from "../env-syntax.ts";
import { seal } from "../env/age.ts";
import { isKeyName, isScopeName, parseArgs } from "./env-args.ts";
import { ENV_MODULE, EXIT_OK, LAST, NOT_FOUND, SEALED_NAME, VERB_SET } from "./env-command.constants.ts";
import { chooseFile, mainConfig, propertiesOf } from "./env-files.ts";
import { guarded, ioOf, keysOrRefuse, readSecret, refuse, repoRoot, usage, type EnvDeps } from "./env-io.ts";

const SPEC = { command: "none", switches: ["--plain"], values: ["--scope", "--file"], words: 1 } as const;
const INDENT_STEP = "  ";
const FILE_MODE_BITS = 0o777;

/** One replacement of `text`: the range `[start, end)` becomes `insert`. */
type Edit = { readonly start: number; readonly end: number; readonly insert: string };

/** The whitespace that starts the line `position` is on. */
function indentAt(text: string, position: number): string {
  const line = text.slice(text.lastIndexOf("\n", position - 1) + 1);

  return line.slice(0, line.length - line.trimStart().length);
}

/** `text` from `start` to `end` with every comment in that range blanked to spaces, so its offsets stay. */
function codeBetween({ comments, text }: Source, start: number, end: number): string {
  let code = text.slice(start, end);

  for (const comment of comments) {
    if (comment.start < start || comment.end > end) continue;
    const at = comment.start - start;
    code = code.slice(0, at) + " ".repeat(comment.end - comment.start) + code.slice(comment.end - start);
  }

  return code;
}

/** The edit that adds `entry` to `block`, after its last property and in its layout. */
function appendTo(source: Source, block: ObjectExpression, entry: string): Edit {
  const { text } = source;
  const open = block.start + 1;
  const close = block.end - 1;
  const isMultiline = text.slice(open, close).includes("\n");
  const last = block.properties.at(LAST);

  if (last === undefined) {
    if (isMultiline) return { end: open, insert: `\n${indentAt(text, close)}${INDENT_STEP}${entry},`, start: open };

    return { end: close, insert: ` ${entry} `, start: open };
  }

  if (!isMultiline) return { end: last.end, insert: `, ${entry}`, start: last.end };
  // The first code after the last property is its trailing comma, when the block has one.
  const tail = codeBetween(source, last.end, close);
  const comma = tail.trimStart().startsWith(",") ? tail.indexOf(",") : NOT_FOUND;
  const after = comma === NOT_FOUND ? last.end : last.end + comma + 1;
  const newline = text.indexOf("\n", after);
  const lineEnd = newline !== NOT_FOUND && newline < close ? newline : close;
  // The rest of the last value's line stays on it; its trailing spaces move after the entry, before a close brace.
  const rest = text.slice(after, lineEnd);
  const kept = rest.trimEnd();
  const added = `${indentAt(text, last.start)}${entry},${rest.slice(kept.length)}`;
  const insert = `${comma === NOT_FOUND ? "," : ""}${kept}\n${added}`;

  return { end: lineEnd, insert, start: after };
}

/** The local name `sealed` goes by in `source`, and the edit that imports it beside defineEnv when it is missing. */
function sealedImport(source: Source) {
  const imports = source.program.body.flatMap((statement) =>
    statement.type === "ImportDeclaration"
      ? [statement.specifiers.filter((specifier): specifier is ImportSpecifier => specifier.type === "ImportSpecifier")]
      : [],
  );

  const held = imports.flat().find((specifier) => nameOf(specifier.imported) === SEALED_NAME);

  if (held !== undefined) return { edits: [], name: held.local.name };
  const beside = imports.find((specifiers) => specifiers.some((specifier) => specifier.local.name === DEFINE_ENV));

  const last =
    beside?.at(LAST) ??
    refuse(`${source.rel} imports no defineEnv to add sealed beside; import ${SEALED_NAME} from ${ENV_MODULE}`);

  return { edits: [{ end: last.end, insert: `, ${SEALED_NAME}`, start: last.end }], name: SEALED_NAME };
}

/** What `set` writes: plain text, or a cipher wrapped in `sealed(…)`. */
type Written = { readonly kind: "plain"; readonly text: string } | { readonly kind: "sealed"; readonly cipher: string };

/** Where `set` writes: the file, its text, the key and the block it goes in. */
type Place = { readonly rel: string; readonly text: string; readonly key: string; readonly scope: string };

/** `text` with `place.key` set to `written` in its block, the sealed import added when a sealed value needs it. */
function edited(place: Place, written: Written): string {
  const { rel, text } = place;
  const source = parsed(rel, text);

  const config =
    mainConfig(source) ??
    refuse(`${rel} has no defineEnv config set can edit (an object literal, inline or in a same-file const)`);

  const block = propertiesOf(config).get(place.scope)?.value;

  if (block?.type !== "ObjectExpression")
    return refuse(`${rel} has no ${place.scope} block to write to; add \`${place.scope}: {}\``);
  const added = written.kind === "sealed" ? sealedImport(source) : { edits: [], name: SEALED_NAME };

  const entry =
    written.kind === "sealed" ? `${added.name}(${JSON.stringify(written.cipher)})` : JSON.stringify(written.text);

  const held = propertiesOf(block).get(place.key)?.value;

  const edit =
    held === undefined
      ? appendTo(source, block, `${place.key}: ${entry}`)
      : { end: held.end, insert: entry, start: held.start };

  const edits = [edit, ...added.edits].toSorted((a, b) => b.start - a.start);

  return edits.reduce((out, { end, insert, start }) => out.slice(0, start) + insert + out.slice(end), text);
}

/** `text` of `rel` as oxc read it; refuses a file that does not parse, before or after an edit. */
function parsed(rel: string, text: string): Source {
  const source = sourceOf(rel, text);

  return source.isBroken ? refuse(`${rel} would not parse after the edit; nothing was written`) : source;
}

/** Writes `text` over `file` through a temp file beside it and a rename, refusing a result that does not parse. */
function writeAtomic(rel: string, file: string, text: string): void {
  parsed(rel, text);
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  const fd = fs.openSync(temp, "wx", fs.statSync(file).mode & FILE_MODE_BITS);

  // Once the temp file is ours it goes on every way out: renamed over the file, or removed when a step fails.
  try {
    try {
      fs.writeFileSync(fd, text);
    } finally {
      fs.closeSync(fd);
    }

    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

/** Runs `set`; see the file comment. */
export function main(argv: string[], deps?: EnvDeps): Promise<number> {
  const io = ioOf(deps);
  const args = argv[0] === VERB_SET ? parseArgs(argv.slice(1), SPEC) : null;
  const [key] = args?.words ?? [];
  const scope = args?.values.get("--scope");

  if (args === null || !isKeyName(key) || !isScopeName(scope)) return Promise.resolve(usage(io));
  const isPlain = args.switches.has("--plain");

  return guarded(io, async () => {
    const root = repoRoot(io.cwd);
    const rel = chooseFile(root, io.cwd, { anyOne: true, file: args.values.get("--file"), key });
    const file = path.join(root, rel);
    const text = fs.readFileSync(file, "utf8");
    const recipient = isPlain ? "" : keysOrRefuse(root).recipient;
    // A dry edit first: a file set cannot edit is refused before the value is asked for.
    const place = { key, rel, scope, text };
    edited(place, isPlain ? { kind: "plain", text: "" } : { cipher: "", kind: "sealed" });
    const secret = await readSecret(io, `${scope}.${key}`);

    const written: Written = isPlain
      ? { kind: "plain", text: secret }
      : { cipher: await seal(secret, recipient), kind: "sealed" };

    writeAtomic(rel, file, edited(place, written));
    io.stdout(`repo env: ${isPlain ? "wrote" : "sealed"} ${scope}.${key}${isPlain ? " (plain)" : ""} in ${rel}\n`);

    return EXIT_OK;
  });
}
