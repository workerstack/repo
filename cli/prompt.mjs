import * as clack from "@clack/prompts"

export function isInteractive({
  argv = process.argv.slice(2),
  env = process.env,
  stdin = process.stdin,
  stdout = process.stdout,
} = {}) {
  if (!stdin?.isTTY || !stdout?.isTTY) return false
  const ci = env.CI
  if (ci != null && ci !== "" && ci !== "0" && ci !== "false") return false
  for (const a of argv) {
    if (a === "--yes" || a === "-y" || a === "--non-interactive") return false
  }
  return true
}

export function bailIfCancel(value) {
  if (clack.isCancel(value)) {
    clack.cancel("Aborted")
    process.exit(0)
  }
  return value
}

export async function select(opts) {
  return bailIfCancel(await clack.select(opts))
}

export async function confirm(opts) {
  return bailIfCancel(await clack.confirm(opts))
}

export async function text(opts) {
  return bailIfCancel(await clack.text(opts))
}

export async function password(opts) {
  return bailIfCancel(await clack.password(opts))
}

export function spinner() {
  return clack.spinner()
}
