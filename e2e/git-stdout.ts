import type { Sandbox } from "./sandbox";

/** What `git <args>` printed on stdout in the sandbox's repo. */
export async function gitStdout(sb: Sandbox, ...args: string[]): Promise<string> {
  const r = await sb.git(...args);
  return r.stdout;
}
