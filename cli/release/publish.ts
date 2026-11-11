import type { Runner } from "../scripts/ci-wait.ts";
import { packTarball, type PackIo } from "./pack.ts";
import { refuse } from "./refuse.ts";
import {
  PUBLISH_PREFIX,
  WAIT_USAGE,
  alreadyOnNpm,
  bootstrap,
  headNotTag,
  listedNotServed,
  npmFailed,
  publishedLine,
  registryDown,
  tarballDiffers,
  tarballNotServed,
} from "./release-messages.constants.ts";
import {
  ACCESS_URL,
  GITHUB_REPO,
  GIT_HEAD,
  GIT_ORIGIN_URL,
  GIT_TAG_REF,
  NPM_PUBLISH,
  NPM_TAG,
  RELEASE_WORKFLOW,
  REPO_PLACEHOLDER,
  TARBALL_URL,
  WAIT_GIVE_UP_MINUTES,
} from "./release.constants.ts";
import { listing, poll, registryDoc, splitSpec, type RegistryAnswer, type Spec, type WaitIo } from "./wait.ts";

/** What `repo release publish` works through: pack's tools, git, npm, the registry, the clock and whether it runs in CI. */
export type PublishIo = PackIo & Pick<WaitIo, "fetch" | "now" | "sleep"> & { git: Runner; npm: Runner; ci: boolean };

const served = async (fetcher: WaitIo["fetch"], url: string): Promise<true | null> => {
  try {
    return (await fetcher(url)).ok ? true : null;
  } catch {
    return null;
  }
};

/** Polls the tarball url of `parts` until npm serves it; `announce` prints one line at the first miss. */
async function tarballServed(io: PublishIo, parts: Spec, announce: boolean): Promise<boolean> {
  const url = TARBALL_URL(parts.name, parts.version);
  let told = false;
  const probe = async (): Promise<true | null> => {
    const got = await served(io.fetch, url);
    if (got === null && announce && !told) {
      told = true;
      io.stdout(`${PUBLISH_PREFIX}${listedNotServed(parts.version)}\n`);
    }
    return got;
  };
  return (await poll(io, probe, io.now())) !== null;
}

/** The registry's answer for `name`, asked again every 10 seconds while it does not answer; unreachable after 15 minutes. */
async function settled(io: PublishIo, name: string): Promise<RegistryAnswer> {
  let why = "";
  const probe = async (): Promise<RegistryAnswer | null> => {
    const answer = await registryDoc(io.fetch, name);
    if (answer.kind === "unreachable") why = answer.why;
    return answer.kind === "unreachable" ? null : answer;
  };
  return (await poll(io, probe, io.now())) ?? { kind: "unreachable", why };
}

/** `owner/repo` of origin when it is on GitHub, else a placeholder. */
function ownerRepo(io: PublishIo): string {
  return GITHUB_REPO.exec(io.git([...GIT_ORIGIN_URL], io.cwd).stdout.trim())?.[1] ?? REPO_PLACEHOLDER;
}

/** Packs and publishes the tag's package; the exit code. */
async function publishNew(io: PublishIo, parts: Spec, tag: string): Promise<number> {
  const packed = packTarball(io);
  if (typeof packed === "string") return refuse(io, PUBLISH_PREFIX, packed);
  if (packed.name !== parts.name || packed.version !== parts.version) {
    return refuse(io, PUBLISH_PREFIX, tarballDiffers(`${packed.name}@${packed.version}`, tag));
  }
  const prerelease = parts.version.includes("-");
  const run = io.npm(NPM_PUBLISH(packed.tarball, prerelease), io.cwd);
  if (run.code !== 0 && listing(await registryDoc(io.fetch, parts.name), parts.version) === null) {
    return refuse(io, PUBLISH_PREFIX, npmFailed(run.code, parts.version));
  }
  if (!(await tarballServed(io, parts, false))) {
    return refuse(io, PUBLISH_PREFIX, tarballNotServed(tag, WAIT_GIVE_UP_MINUTES));
  }
  io.stdout(`${PUBLISH_PREFIX}${publishedLine(tag, NPM_TAG(prerelease))}\n`);
  return 0;
}

/** A version npm lists: waits until it serves the tarball, then reports that there is nothing to publish. */
async function alreadyThere(io: PublishIo, parts: Spec, tag: string): Promise<number> {
  if (!(await tarballServed(io, parts, true))) {
    return refuse(io, PUBLISH_PREFIX, tarballNotServed(tag, WAIT_GIVE_UP_MINUTES));
  }
  io.stdout(`${PUBLISH_PREFIX}${alreadyOnNpm(tag)}\n`);
  return 0;
}

/** `repo release publish <name>@<version>`: packs the checked-out tag and publishes it, unless npm already serves it. */
export async function releasePublish(argv: readonly string[], io: PublishIo): Promise<number> {
  const tag = argv[0] ?? "";
  const parts = argv.length === 1 ? splitSpec(tag) : null;
  if (parts === null) return refuse(io, PUBLISH_PREFIX, WAIT_USAGE);
  const head = io.git([...GIT_HEAD], io.cwd).stdout.trim();
  if (head === "" || head !== io.git(GIT_TAG_REF(tag), io.cwd).stdout.trim()) {
    return refuse(io, PUBLISH_PREFIX, headNotTag(tag));
  }
  const answer = await settled(io, parts.name);
  if (answer.kind === "unreachable") {
    return refuse(io, PUBLISH_PREFIX, registryDown(answer.why, WAIT_GIVE_UP_MINUTES));
  }
  if (listing(answer, parts.version) !== null) return alreadyThere(io, parts, tag);
  if (answer.kind === "missing" && io.ci) {
    const url = ACCESS_URL(parts.name);
    return refuse(
      io,
      PUBLISH_PREFIX,
      bootstrap({ name: parts.name, repo: ownerRepo(io), tag, url, workflow: RELEASE_WORKFLOW }),
    );
  }
  return publishNew(io, parts, tag);
}
