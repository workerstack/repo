import fs from "node:fs";
import path from "node:path";
import type { Captured } from "./scripts/lint.ts";
import { group, splitMarkdown } from "./docs-fences.ts";
import { LAST_INDEX, SECOND_GROUP, THIRD_GROUP } from "./docs-fences.constants.ts";
import {
  BUN_BUILD_ARGS,
  EXAMPLE_LANGS,
  JSON_INDENT,
  NO_OUTPUT,
  RUN_WORD,
  STOCK_TSCONFIG,
  TERMINATOR,
  THROWN_LINE,
  TSC_ARGS,
  TSC_LINE,
  TSX_LANG,
} from "./docs-examples.constants.ts";
import {
  SCRATCH_DIR,
  TSCONFIG_FILE,
  buildFailed,
  runError,
  typeError,
  typecheckCrash,
  under,
} from "./docs.constants.ts";

/** The tools an example check runs: `tsc` with its arguments, and `bun`. Each runs in `cwd` and is captured. */
export type ExampleTools = {
  tsc: (args: string[], cwd: string) => Captured;
  bun: (args: string[], cwd: string) => Captured;
};

/** A `ts`, `typescript` or `tsx` fence: where it sits and what it holds. `n` counts the file's examples from 1. */
export type Block = { md: string; rel: string; line: number; n: number; ext: "ts" | "tsx"; code: string; run: boolean };

/** The doc root an example check runs for: the repo `root`, the package `dir` ("" for the root), its `name` and whether `build` applies. */
export type ExampleRoot = { root: string; dir: string; name: string; build: boolean };

/** The examples in a reference file: `rel` is its path from the doc root, `dir` the doc root's folder. */
export function blocksOf(dir: string, rel: string, text: string): Block[] {
  const blocks: Block[] = [];
  for (const fence of splitMarkdown(text).fences) {
    const [lang, ...flags] = fence.info.split(/\s+/);
    if (!EXAMPLE_LANGS.includes(String(lang))) continue;
    blocks.push({
      md: under(dir, rel),
      rel,
      line: fence.start,
      n: blocks.length + 1,
      ext: lang === TSX_LANG ? "tsx" : "ts",
      code: fence.body.join("\n"),
      run: flags.includes(RUN_WORD),
    });
  }
  return blocks;
}

/** Whether any example imports the package `name` or one of its subpaths. */
export function importsName(blocks: readonly Block[], name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`["']${escaped}(?:/[^"']*)?["']`);
  return blocks.some((block) => pattern.test(block.code));
}

/** The line that says why a command failed: the first error-looking one, else the last line, else a note. */
function detailOf({ stdout, stderr }: Captured): string {
  const lines = `${stderr}\n${stdout}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return lines.find((line) => THROWN_LINE.test(line)) ?? lines.at(LAST_INDEX) ?? NO_OUTPUT;
}

function fileOf(block: Block): string {
  return `${block.rel}-${block.n}.${block.ext}`;
}

/** Writes each block and a tsconfig that extends the doc root's (or the stock bun one) and lists only the blocks. */
function writeScratch(ctx: ExampleRoot, blocks: readonly Block[]): string {
  const scratch = path.join(ctx.root, SCRATCH_DIR, ctx.dir);
  const own = path.join(ctx.root, ctx.dir, TSCONFIG_FILE);
  fs.rmSync(scratch, { recursive: true, force: true });
  for (const block of blocks) {
    const file = path.join(scratch, fileOf(block));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${block.code}\n${TERMINATOR}`);
  }
  const stock = path.join(import.meta.dirname, "..", "tsconfig", STOCK_TSCONFIG);
  const config = {
    extends: (fs.existsSync(own) ? own : stock).replaceAll("\\", "/"),
    compilerOptions: { noEmit: true },
    files: blocks.map(fileOf),
    include: [],
  };
  fs.writeFileSync(path.join(scratch, TSCONFIG_FILE), JSON.stringify(config, null, JSON_INDENT));
  return scratch;
}

/** The findings in tsc's output: each error in a block at its markdown line, any other line as it is. */
function typeFindings(ctx: ExampleRoot, blocks: readonly Block[], run: Captured): string[] {
  const findings: string[] = [];
  const lines = `${run.stdout}\n${run.stderr}`.replaceAll("\\", "/").split(/\r?\n/);
  for (const text of lines.filter((one) => one !== "" && !/^\s/.test(one))) {
    const match = TSC_LINE.exec(text);
    const block = match === null ? undefined : blocks.find((one) => `/${group(match, 1)}`.endsWith(`/${fileOf(one)}`));
    if (match === null || block === undefined) findings.push(typecheckCrash(ctx.dir, text));
    else
      findings.push(
        typeError(`${block.md}:${block.line + Number(group(match, SECOND_GROUP))}`, block.n, group(match, THIRD_GROUP)),
      );
  }
  return findings.length === 0 ? [typecheckCrash(ctx.dir, NO_OUTPUT)] : findings;
}

/**
 * Type-checks every example of a doc root in one tsc run and runs the `ts run` ones with bun from the doc root.
 * A doc root whose build script produces what its examples import is built first; a failed build ends the check.
 */
export function checkExamples(ctx: ExampleRoot, blocks: readonly Block[], tools: ExampleTools): string[] {
  if (blocks.length === 0) return [];
  const docRoot = path.join(ctx.root, ctx.dir);
  if (ctx.build && importsName(blocks, ctx.name)) {
    const built = tools.bun([...BUN_BUILD_ARGS], docRoot);
    if (built.code !== 0) return [buildFailed(ctx.dir, built.code, detailOf(built))];
  }
  const scratch = writeScratch(ctx, blocks);
  const typed = tools.tsc([...TSC_ARGS, path.join(scratch, TSCONFIG_FILE)], scratch);
  const findings = typed.code === 0 ? [] : typeFindings(ctx, blocks, typed);
  for (const block of blocks.filter((one) => one.run)) {
    const ran = tools.bun([path.join(scratch, fileOf(block))], docRoot);
    if (ran.code !== 0)
      findings.push(runError(`${block.md}:${block.line}`, block.n, { code: ran.code, detail: detailOf(ran) }));
  }
  return findings;
}
