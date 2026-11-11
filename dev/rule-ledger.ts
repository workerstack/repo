#!/usr/bin/env bun
/** Check that every rule line of the given docs maps to a slice, a decision, or a landed roadmap in a ledger. */
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { ARGV_START, HEADING, RULE_LINE, USAGE } from "./rule-ledger.constants.ts";

export type Io = { out: (line: string) => void; err: (line: string) => void };

const buildTargetSchema = () =>
  z.union([
    z.strictObject({ slice: z.number() }),
    z.strictObject({ decision: z.string() }),
    z.strictObject({ landed: z.string() }),
  ]);
const buildLedgerSchema = () =>
  z.strictObject({
    lines: z.record(z.string(), buildTargetSchema()),
    sections: z.record(z.string(), buildTargetSchema()),
  });
const ledgerSchema = /* @__PURE__ */ buildLedgerSchema();

type Ledger = z.infer<typeof ledgerSchema>;
type Target = Ledger["lines"][string];
type Kind = "slice" | "decision" | "landed";
type RuleLine = { lineno: number; text: string; section: string | null };
/** What the docs checked so far found: the mapped lines by kind, the problems, and the ledger keys they used. */
type Tally = {
  problems: number;
  counts: Record<Kind, number>;
  usedSections: Set<string>;
  usedLines: Set<string>;
};

/** The rule lines of a doc, each with its nearest preceding heading. */
function ruleLines(text: string): RuleLine[] {
  const found: RuleLine[] = [];
  let section: string | null = null;
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    const heading = HEADING.exec(line);
    if (heading !== null) section = heading[1] ?? "";
    else if (RULE_LINE.test(line)) found.push({ lineno: index + 1, section, text: line });
  });
  return found;
}

function kindOf(target: Target): Kind {
  if ("slice" in target) return "slice";
  return "decision" in target ? "decision" : "landed";
}

/** The ledger, and the tally the docs checked so far add to. */
type Check = { ledger: Ledger; tally: Tally };

/** The ledger target of a rule line: its own line key first, else its section's; records the keys it used. */
function targetOf(name: string, rule: RuleLine, { ledger, tally }: Check): Target | undefined {
  const sectionKey = rule.section === null ? null : `${name}#${rule.section}`;
  if (sectionKey !== null) tally.usedSections.add(sectionKey);
  const lineKey = `${name}#${rule.text}`;
  const own = ledger.lines[lineKey];
  if (own !== undefined) tally.usedLines.add(lineKey);
  return own ?? (sectionKey === null ? undefined : ledger.sections[sectionKey]);
}

/** Maps the rule lines of one doc, printing each unmapped one. */
function checkDoc(doc: string, check: Check, io: Io): void {
  const { tally } = check;
  const name = path.basename(doc);
  for (const rule of ruleLines(fs.readFileSync(doc, "utf8"))) {
    const target = targetOf(name, rule, check);
    if (target === undefined) {
      io.out(`${doc}:${rule.lineno}: unmapped: "${rule.text}"; add it to the ledger`);
      tally.problems++;
    } else {
      tally.counts[kindOf(target)]++;
    }
  }
}

/** Prints each key of the ledger that no doc used; returns how many. */
function reportStale(ledgerKeys: { keys: string[]; used: Set<string>; label: string }, io: Io): number {
  const { keys, used, label } = ledgerKeys;
  const stale = keys.filter((key) => !used.has(key));
  for (const key of stale) io.out(`stale ${label} key: ${key}`);
  return stale.length;
}

/** The ledger file parsed, or the message to print when it cannot be read or does not fit the schema. */
function readLedger(ledgerPath: string): { ledger: Ledger } | { error: string } {
  try {
    return { ledger: ledgerSchema.parse(JSON.parse(fs.readFileSync(ledgerPath, "utf8"))) };
  } catch (error) {
    return { error: `${ledgerPath}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Runs the ledger check; prints each problem or the summary through `io` and returns the exit code. */
export function run(argv: string[], io: Io): number {
  const [ledgerPath, ...docs] = argv;
  if (ledgerPath === undefined || docs.length === 0) {
    io.out(USAGE);
    return 1;
  }
  const read = readLedger(ledgerPath);
  if ("error" in read) {
    io.out(read.error);
    return 1;
  }
  const { ledger } = read;
  const tally: Tally = {
    counts: { decision: 0, landed: 0, slice: 0 },
    problems: 0,
    usedLines: new Set(),
    usedSections: new Set(),
  };
  for (const doc of docs) checkDoc(doc, { ledger, tally }, io);
  const stale =
    reportStale({ keys: Object.keys(ledger.lines), label: "line", used: tally.usedLines }, io) +
    reportStale({ keys: Object.keys(ledger.sections), label: "section", used: tally.usedSections }, io);
  if (tally.problems + stale > 0) return 1;
  const { slice, decision, landed } = tally.counts;
  io.out(
    `rule ledger: ${slice + decision + landed} lines mapped (${slice} to slices, ${decision} to decisions, ${landed} landed); 0 unmapped; 0 stale`,
  );
  return 0;
}

if (import.meta.main) {
  process.exitCode = run(process.argv.slice(ARGV_START), {
    err: (line) => process.stderr.write(`${line}\n`),
    out: (line) => process.stdout.write(`${line}\n`),
  });
}
