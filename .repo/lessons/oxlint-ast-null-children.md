---
name: oxlint-ast-null-children
paths: ["cli/lint/function-parameters.ts","cli/lint/type-aliases.ts","cli/scripts/lint-repo-rules.test.ts"]
hits: 2
last-hit: 2026-11-12
evidence: ["plan 141","roadmap 8"]
---

# oxlint's AST has null where typescript-eslint's has undefined

## Mistake
Plan 141's rule checked `typeAnnotation === undefined`. Under oxlint an unannotated parameter's child is `null`, so the rule crashed on 925 files while 91 unit tests and 100% coverage stayed green.

## Fix
Read an optional child (`typeAnnotation`, `typeArguments`, `default`, `returnType`) through `?? undefined` or `?.` before an `=== undefined` check. Give each new rule a planted case in `lint-repo-rules.test.ts` where the child is absent, so real oxlint runs that path.
