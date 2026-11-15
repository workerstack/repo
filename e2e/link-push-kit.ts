/** The link-push suite's world: a source package with the installed bin and hooks, and a consumer that links it. */
import fs from "node:fs";
import path from "node:path";

import { expectClean, ROOT_VARS } from "./hosts-kit";
import { PACKAGE_NAME } from "./registry";
import { Sandbox } from "./sandbox";

const NAME = "linkme";
export const PUSHED = "repo link: pushed";

/** The consumer's dir, beside the source checkout. */
function consumerOf(sb: Sandbox): string {
  return path.join(sb.root, "consumer");
}

/** The version of the copy the consumer has installed. */
export function installed(sb: Sandbox): string {
  const text = fs.readFileSync(path.join(consumerOf(sb), "node_modules", NAME, "package.json"), "utf8");

  return /"version":\s*"([^"]+)"/.exec(text)?.[1] ?? "";
}

/** Sets the source's package version in its working tree. */
export function setVersion(sb: Sandbox, version: string): void {
  sb.write("package.json", sb.read("package.json").replace(/"version":\s*"[^"]+"/, `"version": "${version}"`));
}

/** `git commit -a` in the source with its own hooks on, except the two that check the message and lint. */
export function commitAll(sb: Sandbox, message: string) {
  return sb.run("git", ["commit", "-q", "-a", "--no-verify", "-m", message], { env: ROOT_VARS });
}

/** A source package with the installed bin and generated hooks, and a consumer that links it at 1.0.0. */
export async function makeWorld(): Promise<Sandbox> {
  const sb = new Sandbox("link-push");
  await sb.scaffold({ main: "src/index.ts", name: NAME, private: false, version: "1.0.0" });
  expectClean(sb, await sb.launch(PACKAGE_NAME, "init"));
  await sb.commit("chore: init");
  fs.mkdirSync(path.join(consumerOf(sb), "node_modules"), { recursive: true });
  const manifest = { dependencies: { [NAME]: "^1.0.0" }, name: "consumer-app", private: true };
  fs.writeFileSync(path.join(consumerOf(sb), "package.json"), JSON.stringify(manifest));
  const bin = path.join(sb.repo, "node_modules", PACKAGE_NAME, "bin", "repo.ts");
  expectClean(sb, await sb.run("sh", ["-c", `cd '${consumerOf(sb)}' && bun '${bin}' link ${NAME}`]));

  return sb;
}
