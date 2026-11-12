# Benchmark catalog

Dimensions to offer for any subject: code, CLIs, compressors, prompts and models, build tools, data formats, services. Pick the few that serve the decision; skip the rest and say why.

The name column is what goes in `metrics` and in the `bench:` line. Names are the shape (`[a-z0-9-]+`), not a closed list. When one candidate does several operations, prefix the operation: `compress-p50`, `decompress-p50`.

Built-in metrics need no harness. A custom metric needs a harness that does the same work on the same input for every candidate and prints `bench: {"name": n}` as its last stdout line.

Runner limits that apply to every row:

- `wall` includes process start (`bun -e ""` is about 0.6 ms, `node` about 10 ms on a fast Linux desktop). Work smaller than that must be timed inside the harness and reported as a custom metric.
- On Linux `rss` never reads below the runner's own peak. A median within 5% of it gets `~`: the real peak is at most that, and candidates there cannot be told apart.
- A CV over 10% gets `!`. Rerun with more runs before ranking on that cell.

## time

| name | unit | better | how measured | fits when | usual limit |
| --- | --- | --- | --- | --- | --- |
| wall | ms | lower | built-in | the whole command is the unit of work | includes process start; noisy under load |
| cpu | ms | lower | built-in | work is multi-threaded or cost is billed per CPU | user plus system; tracks wall for a single thread |
| startup-cold | ms | lower | harness: first run after a cache drop or fresh install, one op, print it | users start it rarely or in a fresh container | needs a real cold state; the runner warms up by default |
| startup-warm | ms | lower | harness: a no-op run after warmup | users start it often | process start dominates tiny commands |
| p50 | ms | lower | harness, in-process op: time N ops inside it, print the median | per-request or per-call feel matters | p99 needs hundreds of ops or it is the max |
| p99 | ms | lower | harness, in-process op: time N ops inside it, print the 99th percentile | per-request or per-call feel matters | p99 needs hundreds of ops or it is the max |
| throughput | ops/s | higher | harness: ops done over a fixed window or fixed count | a batch or a server under load | one client rarely saturates a service |

## memory

| name | unit | better | how measured | fits when | usual limit |
| --- | --- | --- | --- | --- | --- |
| rss | MB | lower | built-in | the host has a memory cap | Linux floor (`~`); peak only, not steady state |
| heap | MB | lower | harness: runtime heap used after the work, print it | a long-lived process can leak or bloat | runtime-specific; excludes native memory |

## size

| name | unit | better | how measured | fits when | usual limit |
| --- | --- | --- | --- | --- | --- |
| artifact-bytes | B | lower | harness: size of the output file or bundle | users download or ship the output | raw or compressed must be the same for all |
| install-size | MB | lower | harness: install into a temp dir, size the dir | the tool is installed per machine or per CI run | counts transitive files; a cache hides it |
| deps | deps | lower | harness: count packages in the lockfile or tree | supply-chain surface or audit cost matters | a count, not a weight; one big dep beats many tiny |

## quality

| name | unit | better | how measured | fits when | usual limit |
| --- | --- | --- | --- | --- | --- |
| pass-rate | % | higher | harness: run a fixed set, print passed over total | candidates can be wrong, not only slow | the set must be fixed and representative; small sets are coarse |
| error-rate | % | lower | harness: failed calls over total on the same input | a service or model can fail or time out | failures cluster in time; one run can be unlucky |

## cost

| name | unit | better | how measured | fits when | usual limit |
| --- | --- | --- | --- | --- | --- |
| tokens | tokens | lower | harness: sum prompt plus completion tokens from the response | the candidate is a prompt or model | counts differ by tokenizer; compare within one provider |
| usd | USD | lower | harness: tokens or usage times the current price | the bill scales with use | prices change; print the price used |

## stability

| name | unit | better | how measured | fits when | usual limit |
| --- | --- | --- | --- | --- | --- |
| cv | CV % | lower | harness: run the work inside N times, print the CV | results must repeat; outputs are random | the runner already prints CV per cell; use this only for in-process spread |
| flake-rate | % | lower | harness: repeat a check N times, print failures over N | a test or service passes and fails on the same input | needs many repeats to see a 1% flake |

## judged

Ergonomics, docs, maintenance signals and anything else that is not a number. The report lists these unscored, one line each, with the evidence read.

A measurable proxy can be promoted to a metric: commits in the last 90 days via a harness calling `gh`, open issues older than a year, time to first working example. Promote it only when the user agrees the proxy stands for the thing.
