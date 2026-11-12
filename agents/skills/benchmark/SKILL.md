---
name: benchmark
description: "Benchmark anything: pick the dimensions that serve a decision, weight them, run bun repo bench and report each number with what limits it. Use for /benchmark, benchmark X vs Y, or which of these is faster, smaller or cheaper."
---
# Benchmark

Compare candidates on what the decision needs, run them with `bun repo bench`, and report each number with its limit.

Slash `/benchmark` only. Not a session flag. Works for any subject: code, CLIs, compressors, prompts and models, build tools, data formats, services.

## Steps

1. Pin the subject, the candidates and the decision the numbers serve. Pin each candidate's settings too (level, flags, version, config) and state them in the question: they often decide the result. Ask only if one is missing.
2. Propose dimensions from `catalog.md` (beside this file). Each gets a metric, better (lower or higher), a weight and a one-line why. List the skipped ones with why. Dimensions that are not numbers go under judged.
3. Ask once: pick and weight these, or say "go". Ask again only if a candidate cannot run.
4. Write `.repo/bench/<name>.bench.ts` with `defineBench` from `@workerstack/repo/bench`. Put one harness per candidate under `.repo/bench/<name>/`. Each does identical work on identical input and prints `bench: {"name": n}` as its last stdout line. A shared helper in the same folder is encouraged so the work is identical. `run` commands start in the repo root. Each harness asserts its output is correct (a round trip, an expected hash) and exits non-zero when it is not, so a broken candidate fails instead of scoring. Use `setup` for builds. Spec fields: `node_modules/@workerstack/repo/references/exports.md` `## Bench`.
5. Run `bun repo bench <name>`. On a `!` line, rerun once with more runs and say whether the ranks held. Exit 1 or exit 4 is a bug in the spec or a harness: fix it, do not report it as a result.
6. When `os` lists other runners, run `bun repo bench <name> --remote`. On a refusal, quote the line and the step it names.
7. Read `/principle-explain-the-number`. For each candidate check it did the work: output, size, exit. Then check that each metric's absolute gap matters to the decision: the score is best/value, so a 0.1 ms gap can swing points. Say so in Limits or suggest a lower weight. Then report.

## Report

- The table exactly as printed, header line included.
- The winner by the user's weights, with scores.
- Limits, one line each: every `!`; every `~`; OSes the decision's users run that were not measured (no `os` means measured on this runner only); dimensions dropped or judged; an input that does not represent the real workload; and the limiter of each number, or that it is unmeasured.

Example:

```text
<table>
Winner by your weights: zstd 82, gzip 74, brotli 59.
Limits: gzip wall CV 14% (!): rerun at 20 runs gave 12%, so ranks hold but its wall is ±12%.
        rss sits at this runner's 44 MB floor (~): it cannot separate them.
        Measured on ubuntu-latest only. Not measured: decompress time (you dropped it).
```
