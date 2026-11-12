---
name: oxlint-ast-null-children
paths: ["cli/lint/function-parameters.ts","cli/lint/type-aliases.ts","cli/scripts/lint-repo-rules.test.ts"]
hits: 1
last-hit: 2026-11-12
evidence: ["plan 141"]
---

# oxlint's AST holds null where typescript-eslint's holds undefined

A rule's unit tests ran green on eslint's Linter then crashed oxlint's JS plugin on 925 files.

## Mistake
Plan 141's `repo/no-object-parameters` skipped a parameter when its annotation was `=== undefined`. typescript-eslint's parser which `reportsOf` uses leaves an unannotated parameter's `typeAnnotation` undefined; oxlint's AST sets it to `null` so the rule read `null.typeAnnotation` on every file with an untyped parameter. The 91 unit tests and 100% coverage could not see it and the real-oxlint test planted only annotated parameters.

## Fix
Read an optional child (`typeAnnotation` `typeArguments` `default` `returnType` and the like) through `?? undefined` or `?.` before an `=== undefined` check never a bare strict compare. Every new rule's planted file in `cli/scripts/lint-repo-rules.test.ts` carries a negative case with the optional child absent so real oxlint runs that path.
