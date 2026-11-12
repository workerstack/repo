---
name: zod-unknown-key-required
paths: ["cli/json.ts"]
hits: 1
last-hit: 2026-11-12
evidence: ["roadmap 8"]
---

# A zod object key typed z.unknown() is required

A schema meant to accept a missing key refused every input that left it out.

## Mistake
Plan 139 moved JSON reads onto zod schemas and typed loosely held keys as `z.unknown()`, expecting them to be optional the way an `unknown` property type allows `undefined`. In zod 4.6, a `z.object` key typed `z.unknown()` is required. Inputs without the key failed to parse, and callers took the refusal branch.

## Fix
Add `.optional()` to every key that may be absent, `z.unknown()` included. Test a schema with that key absent as well as present.
