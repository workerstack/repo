import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { adaptFile } from "./sync-pstack-adapt.ts";
import type { TextFetch } from "./sync-pstack-fetch.ts";
import { HTTP_OK, PSTACK_SKILLS } from "./sync-pstack-skills.constants.ts";
import type { Io } from "./sync-pstack-write.ts";

/** adaptFile for inputs that must adapt: narrows the result to its ok variant. */
export function adaptOk(...args: Parameters<typeof adaptFile>): Extract<ReturnType<typeof adaptFile>, { ok: true }> {
  const out = adaptFile(...args);

  if (!out.ok) throw new Error(out.error);

  return out;
}

export function skill(name: string): (typeof PSTACK_SKILLS)[number] {
  const found = PSTACK_SKILLS.find((s) => s.name === name);

  if (found === undefined) throw new Error(`no pstack skill ${name}`);

  return found;
}

type Principle = {
  name: string;
  files: string[];
  slash: boolean;
};

/** A principle skill as the port lists it. */
export function principle(name: string): Principle {
  return { files: ["SKILL.md"], name, slash: true };
}

/** A fetch that answers every url with `body`. */
export function respond(body: string): TextFetch {
  return () => Promise.resolve({ ok: true, status: HTTP_OK, text: () => Promise.resolve(body) });
}

type Captured = {
  out: string[];
  err: string[];
  io: Io;
};

/** An `Io` that collects what it is given. */
export function capture(): Captured {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { err: (line) => void err.push(line), out: (line) => void out.push(line) };

  return { err, io, out };
}

/** Make a temp directory the caller removes with `removeAll`. */
export function tmpDir(prefix: string, made: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);

  return dir;
}

/** The upstream bro skill's body line. */
export const BRO_BODY: string =
  "Restate your last message. Stop using jargon and speak coherently. State it more simply and concisely, " +
  "like one human talking to another.";

const UNSLOP_LEAD =
  "Edit text to remove AI patterns. Scan for the patterns below, then rewrite. " +
  "Preserve meaning and match the intended tone.";

const BLAST_COMPANION =
  "Companion to `how` and `why`. `how` tells you what the code does. `why` tells you why it's shaped that way. " +
  "Blast radius tells you what it breaks somewhere else.";

const BLAST_STEP_4 =
  "4. Same rules as `why`. Cite a real `file:line`, a search that finds nothing is still an answer, " +
  "and never make up a caller or an API.";

const CORRECT_LEAD =
  "The operator keeps correcting agents in this repo for the same mistakes. " +
  "Change the repo so the next agent can't make them.";

export const BRO_UPSTREAM: string = `---
name: bro
description: Restate the last message in plain human language, with no jargon.
disable-model-invocation: true
---

${BRO_BODY}
`;

export const UNSLOP_UPSTREAM: string = `---
name: unslop
description: Cut AI tells from any writing.
disable-model-invocation: true
---

# Unslop

${UNSLOP_LEAD}

## Patterns to detect and fix

7. **AI vocabulary.** Additionally, crucial, delve.
`;

export const BLAST_UPSTREAM: string = `---
name: blast-radius
description: "Find what a change could break. Use for 'blast radius of X'."
disable-model-invocation: true
---

# Blast radius

Find what a change breaks somewhere else, before it ships.

${BLAST_COMPANION}

1. Read the change. Use \`why\` step 2 to pull the PR and commits.
${BLAST_STEP_4}
6. For a big or wide change, run it as an \`arena\`. Ask more than one model the same question and merge the answers.

Write it through \`unslop\`, cite real code.
`;

export const CORRECT_UPSTREAM: string = `---
name: correct
description: "Find the mistakes. Use for /correct."
---

# Correct

${CORRECT_LEAD}

Last, keep a table in the agent instruction file that pairs each rule with what enforces it.
`;

export const TYPESCRIPT_UPSTREAM: string = `---
name: typescript-best-practices
description: TypeScript best practices. Use when reading or editing any .ts or .tsx file.
paths: ["**/*.ts", "**/*.tsx"]
disable-model-invocation: true
---

# TypeScript best practices

Apply the **type-system-discipline** principle skill first.

| Rule | Summary |
|------|---------|
| Boundary validation | Parse where data crosses in. See the **boundary-discipline** principle skill. |

Examples: \`references/patterns.md\`.
`;

export const BLAST_MISSING: string = `---
name: blast-radius
description: "Find what a change could break."
---

# Blast radius

Find what a change breaks.

No companion line here.
`;
