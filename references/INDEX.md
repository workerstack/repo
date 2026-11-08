# Law

Protocol stays overview; domain fills this.

## Skills naming

Do not reuse a repo skill name for a consumer custom skill. `bun repo upgrade` prints the reserved list. Pack names stay reserved when their directory is absent.

Override: same name → one SSOT path (`.agents/skills/<name>/`). Re-init / `bun repo upgrade` force-refresh overwrites repo-owned names; consumer extras kept. Maps `origin` badge ≠ content picker.

Upgrade copies the current package trees and product scripts (to `.rulesync/scripts/`), then deletes any reserved skill dir this package no longer ships. `fs.cpSync` does not remove dest extras; prune is what drops them. Other consumer skills and scripts stay. Stock references are not copied: a consumer reads them from `node_modules/@workerstack/repo/references/`, and upgrade deletes the unchanged copies an older init left in the old reference directory. `repo:*` package scripts that differ from a known repo default stay; `repo:test:e2e` is added only when a vitest e2e config exists. A consumer changes the pipeline only through `.rulesync/repo.pipeline.jsonc` (`skip`, `extra`); upgrade never seeds it. doctor/listen/speak call the consumer's root `scripts/lib/env.mjs` `loadEnv` when that file exists.

<!-- repo:skills -->
| name | origin | description | task | commandPath | refs |
| --- | --- | --- | --- | --- | --- |
| ask | repo | Session flag. Finish one step, recap, then ask before the next. |  |  |  |
| auto | repo | >- |  |  |  |
| blast-radius | repo | >- |  |  |  |
| bro | repo | Restate the last message in plain human language, with no jargon. |  |  |  |
| browser | repo | >- |  |  |  |
| clasp | repo | >- |  |  |  |
| commit | repo | Inspect the diff and commit with a Conventional Commits subject line. Use for /commit, "commit this", "commit these cha… |  |  |  |
| commit-and-push | repo | Alias of commit-push (1-release stub). Use for /commit-and-push, "commit and push", "commit this and push". Must push.… |  |  |  |
| commit-push | repo | Commit with a Conventional Commits subject, then push. Use for /commit-push, "commit and push", "commit this and push".… |  |  |  |
| commit-push-deploy | repo | Commit, push, then deploy only if allowlisted infra already exists. Use for /commit-push-deploy, "commit push deploy",… |  |  |  |
| commit-push-release | repo | Commit, push, bump package.json, tag vX.Y.Z, push the tag. CI publishes. Use for /commit-push-release, "commit push rel… |  |  |  |
| correct | repo | >- |  |  |  |
| explain | repo | Longer human recap this reply only. |  |  |  |
| google-workspace | repo | >- |  |  |  |
| handoff | repo | Write a session handoff under .tmp/repo/handoffs/. Continue with /pickup. |  |  |  |
| implement-plan | repo | Execute remaining leaves in a .tmp/repo/plans checklist. Skip [x]. |  |  |  |
| implement-roadmap | repo | >- |  |  |  |
| jev | repo | >- |  |  |  |
| listen | repo | >- |  |  |  |
| pickup | repo | Continue a handoff under .tmp/repo/handoffs/. |  |  |  |
| principle-attack-the-premise | repo | >- |  |  |  |
| principle-boundary-discipline | repo | >- |  |  |  |
| principle-build-the-lever | repo | >- |  |  |  |
| principle-encode-lessons-in-structure | repo | >- |  |  |  |
| principle-exhaust-the-design-space | repo | >- |  |  |  |
| principle-experience-first | repo | >- |  |  |  |
| principle-explain-the-number | repo | >- |  |  |  |
| principle-fix-root-causes | repo | >- |  |  |  |
| principle-foundational-thinking | repo | >- |  |  |  |
| principle-guard-the-context-window | repo | >- |  |  |  |
| principle-laziness-protocol | repo | >- |  |  |  |
| principle-make-operations-idempotent | repo | >- |  |  |  |
| principle-migrate-callers-then-delete-legacy-apis | repo | >- |  |  |  |
| principle-minimize-reader-load | repo | >- |  |  |  |
| principle-model-the-domain | repo | >- |  |  |  |
| principle-never-block-on-the-human | repo | >- |  |  |  |
| principle-outcome-oriented-execution | repo | >- |  |  |  |
| principle-prove-it-works | repo | >- |  |  |  |
| principle-redesign-from-first-principles | repo | >- |  |  |  |
| principle-separate-before-serializing-shared-state | repo | >- |  |  |  |
| principle-sequence-verifiable-units | repo | >- |  |  |  |
| principle-subtract-before-you-add | repo | >- |  |  |  |
| principle-test-behavior-not-implementation | repo | >- |  |  |  |
| principle-type-system-discipline | repo | >- |  |  |  |
| review-plan | repo | Review a plan in a fresh agent before approval. Use for /review-plan. |  |  |  |
| review-roadmap | repo | Review a roadmap in a fresh agent before lock. Use for /review-roadmap. |  |  |  |
| speak | repo | >- |  |  |  |
| su | repo | Short status update: done, next, and blockers or on-track ETA. |  |  |  |
| teach | repo | >- |  |  |  |
| tmp | repo | Dump a one-off convo artifact under .tmp/repo/. |  |  |  |
| typescript-best-practices | repo | >- |  |  |  |
| unslop | repo | Cut AI tells from any writing. Use for /unslop. |  |  |  |
| write-plan | repo | Write a local checklist under .tmp/repo/plans/. Then /implement-plan {n}. |  |  |  |
| write-roadmap | repo | >- |  |  |  |
<!-- /repo:skills -->

<!-- repo:refs -->
| path | title | tags | summary |
| --- | --- | --- | --- |
| node_modules/@workerstack/repo/references/browser.md | Browser | browser | Zero-config in-tree session rail. Not MCP. Not env. Not raw Playwright. Lightpanda first; swap to Chromium when blocked. |
| node_modules/@workerstack/repo/references/cascade.md | Protocol | cascade | The session agent has tools. Fat Read/Grep/Bash dumps are rewritten to `<root>/node_modules/.bin/repo job` (squeez + st… |
| node_modules/@workerstack/repo/references/clasp.md | Clasp | clasp | Low-level Apps Script CLI. Optional. Doctor reports it. |
| node_modules/@workerstack/repo/references/cloudflare.md | Cloudflare | cloudflare | Use `cf` for every Cloudflare task. Do not run `wrangler` yourself and do not add it to a project that has none. |
| node_modules/@workerstack/repo/references/google-workspace.md | google-workspace | google-workspace | Create and edit Google Sheets, Docs, Slides, Calendar events, and Gmail from the session. |
| node_modules/@workerstack/repo/references/hooks.md | Hooks | hooks | SessionStart carries only the folder map: Claude / Codex run the `session-map` hook, which injects the code-only map `b… |
| node_modules/@workerstack/repo/references/implementation-format.md | Implementation format (SSOT) |  | Local session journal for `/implement-plan`. Not a plan, handoff, or git commit. |
| node_modules/@workerstack/repo/references/jev.md | Jev | jev | Closed external decision. The source text is already saved. The question is a yes/no or a named choice. One call. Not o… |
| node_modules/@workerstack/repo/references/lessons.md | Lessons | lessons | Mistakes that outlive one task. One committed file per mistake under `.rulesync/lessons/`, with a generated index. Not… |
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

<!-- repo:stack -->
<!-- /repo:stack -->
