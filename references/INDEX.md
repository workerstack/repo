# Law

Protocol stays overview; domain fills this.

## Skills naming

Do not reuse a repo skill name for a consumer custom skill: a repo-owned skill of the same name in `.repo/skills/` replaces the stock one. Pack names stay reserved when their directory is absent.

`bun repo sync` links the stock skills from the installed package into each host tree and writes the rest; it never copies stock references or scripts. doctor/listen/speak call the consumer's root `scripts/lib/env.mjs` `loadEnv` when that file exists.

Upgrading is running `bun repo update '@workerstack/*'`: it bumps every `@workerstack/*` package to its npm latest, installs, and prints what that install's sync wrote and removed, plus each package's CHANGELOG sections between the installed and the new version. The first sync in a repo an older `bun repo init` copied moves your own rules, subagents, skills, settings keys, lessons, hooks and references into `.repo/` and `references/`, untracks the generated paths, removes the copied `.rulesync/`, and prints one moved line per move. Commit the result.

Each section `bun repo sync` writes below, like its blocks in `.gitignore` and `.gitattributes`, sits between an opening and a closing comment that name it, and the opening one carries a short hash of the text sync wrote. Keep your own lines outside them: a line added or edited inside is moved just below the section by the next sync. A missing, doubled, misplaced or mangled comment is repaired rather than failing sync, each repair printing one line that names the file. A section a new version no longer writes is cut, and a shared file nothing writes any more keeps your lines with its sections cut, removed only when nothing else is left.

<!-- repo:skills 25c2be1f -->
| name | origin | description | task | commandPath | refs |
| --- | --- | --- | --- | --- | --- |
| ask | repo | Session flag. Finish one step, recap, then ask before the next. |  |  |  |
| auto | repo | Session flag. Default. Work the task through. Ask on blockers instead of monkey-patching. |  |  |  |
| away | repo | Session flag. Nobody is watching: decide instead of asking, log each choice, keep going. |  |  |  |
| benchmark | repo | Benchmark anything: pick the dimensions that serve a decision, weight them, run bun repo bench and report each number w… |  |  |  |
| blast-radius | repo | Find what a change could break somewhere else before it ships, beyond the diff, and prove the one fact it's safe becaus… |  |  |  |
| bro | repo | Restate the last message in plain human language, with no jargon. |  |  |  |
| browser | repo | Browse via bun repo browser (Lightpanda). App e2e uses Playwright. |  |  |  |
| clasp | repo | Low-level Apps Script CLI. Prefer /google-workspace for sheet, doc, meeting, mail. |  |  |  |
| commit | repo | Inspect the diff and commit with a Conventional Commits subject line. Use for /commit, "commit this", "commit these cha… |  |  |  |
| commit-push | repo | Commit with a Conventional Commits subject, then push. Use for /commit-push, "commit and push", "commit this and push".… |  |  |  |
| commit-push-deploy | repo | Commit, push, then deploy only if allowlisted infra already exists. Use for /commit-push-deploy, "commit push deploy",… |  |  |  |
| commit-push-release | repo | Commit, push, and for "release" run `bun repo release` from the main checkout (it bumps, stamps CHANGELOG.md, pushes, w… |  |  |  |
| correct | repo | Find the mistakes agents keep repeating in this repo and make each one impossible. Try architecture first, then types,… |  |  |  |
| do | repo | Do a small task now: no plan, no review. Worktree, nearest test and commit still apply. |  |  |  |
| explain | repo | Longer human recap this reply only. |  |  |  |
| google-workspace | repo | Google Sheets, Docs, Slides, Calendar, Gmail via bun repo google-workspace. |  |  |  |
| handoff | repo | Write a session handoff under .tmp/repo/handoffs/. Continue with /pickup. |  |  |  |
| implement-plan | repo | Execute remaining leaves in a .tmp/repo/plans checklist. Skip [x]. |  |  |  |
| implement-roadmap | repo | Run a locked roadmap in order. Use for /implement-roadmap. Writes each missing plan, then /implement-plan. Refuses a dr… |  |  |  |
| jev | repo | Yes/no or named-option decision on text already saved. Run bun repo jev --available first. On yes, one decision call. O… |  |  |  |
| listen | repo | Speech-to-text via bun repo listen (ffmpeg mic + local whisper.cpp, OpenAI fallback). Input only. |  |  |  |
| pickup | repo | Continue a handoff under .tmp/repo/handoffs/. |  |  |  |
| principle-attack-the-premise | repo | Apply when two or more fixes that share one premise have failed the same gate. Write the premise down and test it direc… |  |  |  |
| principle-boundary-discipline | repo | Apply when wiring validation, error handling, or framework adapters. Concentrate guards at system boundaries (CLI, conf… |  |  |  |
| principle-build-the-lever | repo | Apply to any non-trivial work, not just bulk work: edits, migrations, analyses, checks. Build the tool that does it or… |  |  |  |
| principle-encode-lessons-in-structure | repo | Apply when you catch yourself writing the same instruction a second time, or notice a recurring correction. Encode the… |  |  |  |
| principle-exhaust-the-design-space | repo | Apply when facing a novel UI interaction or architectural decision with no precedent in the codebase. Build 2-3 competi… |  |  |  |
| principle-experience-first | repo | Apply when product, UX, or feature-scope tradeoffs come up. Choose user delight over implementation convenience; ship f… |  |  |  |
| principle-explain-the-number | repo | Apply before you trust, report, or act on a number you measured: a speedup, a regression, a throughput, a latency, or a… |  |  |  |
| principle-fix-root-causes | repo | Apply when debugging. Trace each symptom back to the first place the system went wrong and fix it there. A guard is a f… |  |  |  |
| principle-foundational-thinking | repo | Apply before writing logic: choosing core types and data structures, sequencing scaffold-vs-feature work, asking what c… |  |  |  |
| principle-guard-the-context-window | repo | Apply when context is filling up: large outputs, long files, repeated reads, fan-out planning. Route bulk to job and `.… |  |  |  |
| principle-laziness-protocol | repo | Apply when refactoring, evaluating diff size, or tempted to add abstractions, layers, or signal threading. Bias toward… |  |  |  |
| principle-make-operations-idempotent | repo | Apply when designing commands, lifecycle steps, or processing loops that run amid crashes, restarts, and retries. Conve… |  |  |  |
| principle-migrate-callers-then-delete-legacy-apis | repo | Apply when introducing a new internal API while old callers still exist. Migrate callers and delete the old API in the… |  |  |  |
| principle-minimize-reader-load | repo | Apply when reviewing or shaping code that's hard to trace. Count layers between question and answer, and hidden state i… |  |  |  |
| principle-model-the-domain | repo | Apply when writing stateful logic, or when code branches a lot or repeats a shape assumption across files. Use for /pri… |  |  |  |
| principle-never-block-on-the-human | repo | Apply when tempted to ask 'should I do X?' on reversible work. Use for /principle-never-block-on-the-human. |  |  |  |
| principle-outcome-oriented-execution | repo | Apply during planned rewrites and migrations with explicit phase boundaries. Converge on the target architecture; don't… |  |  |  |
| principle-prove-it-works | repo | Apply after completing a task, before declaring done. Verify against the real artifact (run the feature, read the actua… |  |  |  |
| principle-redesign-from-first-principles | repo | Apply when integrating a new requirement into an existing design. Use for /principle-redesign-from-first-principles. |  |  |  |
| principle-separate-before-serializing-shared-state | repo | Apply when concurrent actors might write to the same file, branch, key, or state object. Eliminate the sharing first; s… |  |  |  |
| principle-sequence-verifiable-units | repo | Apply to multi-step work (sweeps, migrations, runs of similar edits) and to how you stack commits and PRs. Break work i… |  |  |  |
| principle-subtract-before-you-add | repo | Apply when sequencing an addition, refactor, or rewrite. Remove dead code, redundant validators, and stub references fi… |  |  |  |
| principle-test-behavior-not-implementation | repo | Apply when you write, change, or keep a test. Assert what the code's users can observe, so that the test fails when tha… |  |  |  |
| principle-type-system-discipline | repo | Apply when designing types, reviewing a function signature, or writing code in any statically-typed language. Make ille… |  |  |  |
| review-plan | repo | Review a plan in a fresh agent before approval. Use for /review-plan. |  |  |  |
| review-roadmap | repo | Review a roadmap in a fresh agent before lock. Use for /review-roadmap. |  |  |  |
| show-me | repo | Restate the current proposal as a concrete before and after: commands, output, errors, files. |  |  |  |
| speak | repo | Text-to-speech via bun repo speak (ElevenLabs or OpenAI). Output only. |  |  |  |
| su | repo | Short status update: done, next, and blockers or on-track ETA. |  |  |  |
| teach | repo | Explain a body of work plainly so a person actually understands it. Dig into how it works and why it is that way, then… |  |  |  |
| tmp | repo | Dump a one-off convo artifact under .tmp/repo/. |  |  |  |
| typescript-best-practices | repo | TypeScript best practices. Use when reading or editing any .ts or .tsx file, or for /typescript-best-practices. |  |  |  |
| unslop | repo | Cut AI tells from any writing. Use for /unslop. |  |  |  |
| write-plan | repo | Write a local checklist under .tmp/repo/plans/. Then /implement-plan {n}. |  |  |  |
| write-roadmap | repo | Write an ordered program of plans under .tmp/repo/roadmaps/. Use for /write-roadmap. Stops for y, which locks and runs… |  |  |  |
<!-- /repo:skills -->

<!-- repo:refs e93f7edb -->
| path | title | tags | summary |
| --- | --- | --- | --- |
| node_modules/@workerstack/repo/references/browser.md | Browser | browser | Zero-config in-tree session rail. Not MCP. Not env. Not raw Playwright. Lightpanda first; swap to Chromium when blocked. |
| node_modules/@workerstack/repo/references/cascade.md | Protocol | cascade | The session agent has tools. Fat Read/Grep/Bash dumps are rewritten to `<root>/node_modules/.bin/repo job` (squeez + st… |
| node_modules/@workerstack/repo/references/clasp.md | Clasp | clasp | Low-level Apps Script CLI. Optional. Doctor reports it. |
| node_modules/@workerstack/repo/references/cloudflare.md | Cloudflare | cloudflare | Use `cf` for every Cloudflare task. Do not run `wrangler` yourself and do not add it to a project that has none. |
| node_modules/@workerstack/repo/references/exports.md | Exports |  | What a repo imports from `@workerstack/repo`. `bun repo docs --check` type-checks each `ts` block below against the ins… |
| node_modules/@workerstack/repo/references/google-workspace.md | google-workspace | google-workspace | Create and edit Google Sheets, Docs, Slides, Calendar events, and Gmail from the session. |
| node_modules/@workerstack/repo/references/hooks.md | Hooks | hooks | SessionStart carries only the folder map: Claude / Codex run the `session-map` hook, which injects the code-only map `b… |
| node_modules/@workerstack/repo/references/implementation-format.md | Implementation format (SSOT) |  | Local session journal for `/implement-plan`. Not a plan, handoff, or git commit. |
| node_modules/@workerstack/repo/references/jev.md | Jev | jev | Closed external decision. The source text is already saved. The question is a yes/no or a named choice. One call. Not o… |
| node_modules/@workerstack/repo/references/lessons.md | Lessons | lessons | Mistakes that outlive one task. One committed file per mistake under `.repo/lessons/`, with a generated index. Not host… |
| node_modules/@workerstack/repo/references/listen.md | Listen | listen | Speech-to-text from the session. Input only. Not TTS. Not a live voice agent. Not MCP. |
| node_modules/@workerstack/repo/references/map.md | Map | map | Cheap outline. Not a file dump. |
| node_modules/@workerstack/repo/references/output.md | Output | output | en-US default. Detail behind the reply rules in `overview.md`, which stays the source for voice and shape. |
| node_modules/@workerstack/repo/references/plan-format.md | Plan format (SSOT) |  | Local session checklist. Not a design doc, PR stack, or DAG. |
| node_modules/@workerstack/repo/references/review-loop.md | Review loop | review-loop | Read this when the plan's `strategy` is `review-fast` or `review-deep`. You are the reviewer. An implementer agent writ… |
| node_modules/@workerstack/repo/references/roadmap-format.md | Roadmap format (SSOT) |  | Ordered program of child plans. Not a plan, a handoff, or a design doc. |
| node_modules/@workerstack/repo/references/rtk.md | RTK | rtk | Shell stdout compression. PreToolUse: Bash → `rtk <cmd>`. Not Read/Grep/Glob/prompts/images. |
| node_modules/@workerstack/repo/references/scope.md | Scope | scope | Plan by default. A straight shot is the exception. The plan caps the result, so its depth scales with the work. This fi… |
| node_modules/@workerstack/repo/references/setup.md | Setup | setup | Handheld machine setup for optional integrations. Any OS. Secrets stay in `~/.workerstack/` (Windows `%USERPROFILE%\.wo… |
| node_modules/@workerstack/repo/references/speak.md | Speak | speak | Text-to-speech from the session. Output only. Not STT. Not a mic. Not MCP. Speech-to-text is `/listen`: `node_modules/@… |
<!-- /repo:refs -->

<!-- repo:stack e4fdfa05 -->
- [@workerstack/references](../node_modules/@workerstack/references/references/INDEX.md)
<!-- /repo:stack -->

<!-- repo:available 1bb0856d -->
- [@workerstack/system](https://www.npmjs.com/package/@workerstack/system): Manage every OS dependency, built-in or custom, from one config
- [@workerstack/database](https://www.npmjs.com/package/@workerstack/database): Schema, queries and migrations for SQLite, D1 and Postgres
- [@workerstack/testing](https://www.npmjs.com/package/@workerstack/testing): End-to-end matrix testing for APIs, web apps and Workers
<!-- /repo:available -->
