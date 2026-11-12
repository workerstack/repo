---
name: bun-fmt-config-name
paths: ["cli/scripts/lint.ts","cli/scripts/lint.constants.ts","cli/init.ts","cli/sync/outputs.ts"]
hits: 1
last-hit: 2026-11-12
evidence: ["roadmap 9"]
---

# bun fmt reads an oxfmt config only by its file name

A temp formatter config lost `sortPackageJson` and init wrote an unsorted package.json.

## Mistake
Plan 159 named init's temp config `fmt.json`. bun fmt treats a `--config` file as an oxfmt config only when it is named `.oxfmtrc.json` or `.oxfmtrc.jsonc`; under any other name it reads Bun's own format, warns `Ignored unknown option`, and drops the oxfmt keys. Two more traps sit beside it: `bun fmt` runs a package.json `fmt` script of the same name unless `--no-script` is passed, and a bunfig.toml `[fmt]` section overrides .oxfmtrc.jsonc keys even under `--config`.

## Fix
Name any config handed to bun fmt `OXFMT_CONFIG_PATH`, spawn it through lint.ts `commandOf("bun fmt")` (which passes `--no-script`), and never write a `[fmt]` section: sync owns bunfig.toml whole and `repo fmt --init` is refused.
