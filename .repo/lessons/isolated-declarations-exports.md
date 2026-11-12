---
name: isolated-declarations-exports
paths: ["tsconfig.src.json","tsconfig/strict.json"]
hits: 1
last-hit: 2026-11-12
evidence: ["roadmap 8"]
---

# isolatedDeclarations limits the shape of every export

A typing fix passed `tsc -p .`, then failed `tsc -p tsconfig.src.json`.

## Mistake
Plan 152 replaced written types on exports with inference and `satisfies`. `tsconfig.src.json` extends `tsconfig/strict.json`, which enables `isolatedDeclarations`, and that rejects an export whose type tsc would have to infer: a `satisfies` or spread table, an untyped function return, a filled `{}` accumulator.

## Fix
Give each exported function a written return type. Write an exported table as plain `as const` or as a closed `Record<Union, V>`. Build an accumulated object with `Object.fromEntries` or a `Map`. Run all three tsc commands: `-p .`, `-p tsconfig.src.json` and `-p tsconfig.build.json`.
