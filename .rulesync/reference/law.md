# Law

Protocol stays overview; domain fills this.

## Skills naming

Do not reuse a repo skill name for a consumer custom skill. `repo upgrade` prints the reserved list. Pack names stay reserved when their directory is absent.

Override: same name → one SSOT path (`.agents/skills/<name>/`). Re-init / `repo upgrade` force-refresh overwrites repo-owned names; consumer extras kept. Maps `origin` badge ≠ content picker.

Upgrade copies the current package trees and product scripts (to `.rulesync/scripts/`), then deletes any reserved skill dir this package no longer ships. `fs.cpSync` does not remove dest extras; prune is what drops them. Other consumer skills, refs and scripts stay. Extra `##` headings in shared reference docs (e.g. `law.md`) are kept. `repo:*` package scripts that differ from a known repo default stay; `repo:test:e2e` is added only when a vitest e2e config exists. A consumer changes the pipeline only through `.rulesync/repo.pipeline.jsonc` (`skip`, `extra`); upgrade never seeds it. doctor/listen/speak call the consumer's root `scripts/lib/env.mjs` `loadEnv` when that file exists.
