import { exactTextRe } from "./exact-text-re.ts";

/** One rewrite of upstream text; `id` names the miss reported when `re` no longer matches (none: optional). */
export type Rule = {
  re: RegExp;
  to: string;
  id?: string;
};

/** Body rewrites by skill name, applied in order. */
export const BODY_RULES: Partial<Record<string, readonly Rule[]>> = {
  "blast-radius": [
    {
      id: "blast-radius.how-why",
      re: /* @__PURE__ */ exactTextRe(
        "Companion to `how` and `why`. `how` tells you what the code does. `why` tells you why it's ",
        "shaped that way. Blast radius tells you what it breaks somewhere else.",
      ),
      to:
        "This is not a walkthrough of what the code does, and not a history of why it was built. Blast " +
        "radius is what the change breaks somewhere else.",
    },
    {
      id: "blast-radius.why-step-2",
      re: /Use `why` step 2 to pull the PR and commits\./,
      to:
        "Pull the PR and commits: `git log` / `git blame` on the changed files, `gh pr view` when a PR " +
        "number is in the history.",
    },
    {
      id: "blast-radius.why-rules",
      re: /* @__PURE__ */ exactTextRe(
        "Same rules as `why`. Cite a real `file:line`, a search that finds nothing is still an answer, ",
        "and never make up a caller or an API.",
      ),
      to: "Cite a real `file:line`. A search that finds nothing is still an answer. Never make up a caller or an API.",
    },
    {
      id: "blast-radius.arena",
      re: /* @__PURE__ */ exactTextRe(
        "For a big or wide change, run it as an `arena`. Ask more than one model the same question and ",
        "merge the answers.",
      ),
      to:
        "For a big or wide change, run a second independent pass (another model or a fresh read of the " +
        "same question) and merge the answers.",
    },
  ],
  correct: [
    {
      id: "correct.rule-table",
      re: /keep a table in the agent instruction file that pairs/,
      to: "keep a table in `AGENTS.md` (SSOT: `agents/rules/overview.md`) that pairs",
    },
  ],
  "principle-build-the-lever": [
    {
      id: "build-the-lever.subagents",
      re: /When you fan work out to subagents, write the lever as a skill they all read/,
      to: "When you split work across later turns or child runs, write the lever as a skill they all read",
    },
  ],
  "principle-explain-the-number": [
    {
      id: "explain-the-number.benchmark-checklist",
      re: /* @__PURE__ */ exactTextRe(
        "For a performance number, run the full procedure with the ",
        "[benchmark-checklist](../benchmark-checklist/SKILL.md) skill.",
      ),
      to:
        "For a performance number, run a full measured procedure: name the limiter, check tuning, count " +
        "errors, repeat, check end-to-end relevance, and confirm the work happened.",
    },
  ],
  "principle-never-block-on-the-human": [
    {
      id: "never-block-on-the-human.lead",
      re: /* @__PURE__ */ exactTextRe(
        "The human supervises asynchronously. Agents must stay unblocked. Make reasonable decisions, ",
        "proceed, and let the human course-correct after the fact. Since code changes are reversible and ",
        "reviewable, a wrong decision usually costs less than blocking.",
      ),
      to:
        "Don't ask preference on reversible execution. Make a reasonable call, do the work, and show the " +
        "result. Stop for plan approval (scope.md), real blockers, and irreversible actions (force-push, " +
        "delete production data, send external messages). A `locked` or `in-progress` roadmap that " +
        "`/implement-roadmap` is running is already that approval.",
    },
  ],
  "principle-prove-it-works": [
    { id: "prove-it-works.show-me-your-work", re: / \(the \*\*show-me-your-work\*\* skill\)/, to: "" },
  ],
  teach: [
    {
      id: "teach.how-why-lead",
      re: /* @__PURE__ */ exactTextRe(
        "Teach sits on top of `how` and `why`. Get your bearings on what the work is and what it touches, ",
        "then run `how` for how it works and `why` for why it's that way. Those are real skill ",
        "invocations that do their own digging. Blend what they find into one plain explanation, lead ",
        "with what matters to the person, and go deeper when they ask. Reword freely for teaching, with ",
        "one exception. Keep `why`'s confidence language intact (its hedges are findings, not style).",
      ),
      to:
        "Get your bearings on what the work is and what it touches, then find how it works and why it's " +
        "that way. Those are real reads of the code and of the history, not a restatement of the " +
        "question. Blend what they find into one plain explanation, lead with what matters to the person, " +
        "and go deeper when they ask. Reword freely for teaching, with one exception. Keep confidence " +
        "language from the history intact (its hedges are findings, not style).",
    },
    {
      id: "teach.step-2",
      re: /* @__PURE__ */ exactTextRe(
        "2. Let `how` and `why` do the work, don't redo it. Read the code yourself to get oriented, then ",
        "run `how` for how it works and `why` for why. Run them in parallel and combine the results. ",
        "Match the size to the question. Run both for a subsystem, maybe one is enough for a small ",
        "change. Keep `why` narrow by default since its full sweep is slow. Put the narrowing in the ask ",
        "itself (a scoped question, git plus a source or two) so `why` records the skipped categories per ",
        "its own contract, and widen it only when the reasons are the point.",
      ),
      to:
        "2. Dig, don't invent. Read the code yourself to get oriented, then work out how it works " +
        "(runtime path, where things live, gotchas) and why it is that way (`git log` / `git blame`, `gh " +
        "pr view` when a PR number is in the history, tickets when they exist). Do both in parallel when " +
        "the question is a subsystem. Match the size to the question. One side may be enough for a small " +
        "change. Keep the history sweep narrow by default. Put the narrowing in the ask itself (a scoped " +
        "question, git plus a source or two) and record what you skipped, and widen it only when the " +
        "reasons are the point.",
    },
    {
      id: "teach.image-tool",
      re: /* @__PURE__ */ exactTextRe(
        "When the idea is spatial, like layout, overlap, scroll position, or a before and after, reach ",
        "for the image-generation tool and draw it",
      ),
      to:
        "When the idea is spatial, like layout, overlap, scroll position, or a before and after, and the " +
        "harness has an image-generation tool, draw it",
    },
    {
      id: "teach.reply-chase",
      re: /and the threads worth chasing with `how` or `why`\./,
      to: "and the threads worth chasing next.",
    },
  ],
  "typescript-best-practices": [
    {
      id: "typescript.principles",
      re: /Apply the \*\*type-system-discipline\*\* principle skill first\.\n/,
      to:
        "Make illegal states unrepresentable. Brand semantic primitives. Parse external data at " +
        "boundaries. Exhaust variants. Derive types from the schema that owns the shape.\n\nValidate at the " +
        "boundary (CLI, config, network, external APIs). Trust types inside. Keep business logic in pure " +
        "functions.\n",
    },
    { id: "typescript.boundary-cell", re: / See the \*\*boundary-discipline\*\* principle skill\./, to: "" },
    {
      id: "typescript.examples",
      re: /Examples: `references\/patterns\.md`\./,
      to: "Examples: `references/patterns.md` next to this skill.",
    },
  ],
};

/** Description rewrites by skill name, applied in order. */
export const DESCRIPTION_RULES: Partial<Record<string, readonly Rule[]>> = {
  "principle-build-the-lever": [
    {
      id: "build-the-lever.desc-subagents",
      re: /or a skill your subagents follow/,
      to: "or a skill later turns follow",
    },
  ],
  "principle-guard-the-context-window": [
    {
      id: "guard-the-context-window.desc-subagents",
      re: /Route bulk to subagents; keep summaries in the main thread, not raw payloads\./,
      to: "Route bulk to job and `.tmp/repo/` scratch; keep summaries in the session, not raw payloads.",
    },
  ],
  teach: [
    {
      re: /Runs the `how` and `why` skills and weaves what they find into one clear explanation\./,
      to: "Dig into how it works and why it is that way, then weave that into one clear explanation.",
    },
  ],
};
