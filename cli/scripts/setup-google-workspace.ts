/** `repo setup google-workspace`: installs the user's Desktop OAuth client, then logs in through the browser. */
import fs from "node:fs";
import os from "node:os";

import { oauthWritePath, stateHome } from "./setup-files.ts";
import { logLine } from "./setup-io.ts";
import { findDownloadedOAuthJson, installOAuthJson, openUrl, workspaceConsoleUrls } from "./setup-oauth.ts";
import type { SetupCtx, SetupIo } from "./setup.types.ts";
import { str } from "./voice-args.ts";

/** One console page: the lines logged first, the page, and the question asked once it is done. */
type Step = { lines: string[]; url: string; confirm: string };

async function step(io: SetupIo, ctx: SetupCtx, s: Step): Promise<void> {
  for (const line of s.lines) logLine(io, line);
  logLine(io, `Open: ${s.url}`);
  await openUrl(s.url, ctx);

  if (typeof io.confirm === "function") await io.confirm({ initialValue: true, message: s.confirm });
}

async function askOAuthSource(io: SetupIo, home: string): Promise<string> {
  const found = findDownloadedOAuthJson(home);

  const src = str(
    typeof io.text === "function"
      ? await io.text({
          defaultValue: found,
          initialValue: found,
          message: "Path to Desktop OAuth JSON (or paste the JSON)",
        })
      : found,
  );

  if (src === "") throw new Error("need path to Desktop OAuth JSON");

  return src;
}

/** Walks the console pages a Desktop OAuth client needs and returns the downloaded JSON's path or body. */
async function consoleWalk(io: SetupIo, ctx: SetupCtx, home: string): Promise<string> {
  const flagProject = str(ctx.flags?.project);
  const share = "Each person uses their own GCP Desktop OAuth client. Do not share JSON or tokens.";
  const created = "GCP project created? Continue";
  await step(io, ctx, { confirm: created, lines: [share], url: workspaceConsoleUrls(flagProject).projectCreate });

  const projectId =
    typeof io.text === "function"
      ? str(
          await io.text({ initialValue: flagProject, message: "Project ID (from the console URL ?project=)" }),
          flagProject,
        )
      : flagProject;

  const urls = workspaceConsoleUrls(projectId);
  const consent = "Consent: Internal on paid Workspace, else Testing + add your email as a test user.";
  await step(io, ctx, { confirm: "Branding / audience done? Continue", lines: [consent], url: urls.branding });
  await step(io, ctx, { confirm: "APIs enabled? Continue", lines: [], url: urls.enableApis });
  const client = "Create OAuth client: application type Desktop app → Download JSON.";
  await step(io, ctx, { confirm: "JSON downloaded? Continue", lines: [client], url: urls.clientCreate });

  return askOAuthSource(io, home);
}

async function installCreds(ctx: SetupCtx, home: string, dest: string): Promise<void> {
  const flags = ctx.flags ?? {};
  const credsFlag = str(flags.creds, str(flags.json));
  const { io } = ctx;
  const canAsk = ctx.interactive === true && io !== undefined && io !== null;

  if (credsFlag === "" && canAsk) installOAuthJson({ dest, src: await consoleWalk(io, ctx, home) });
  else if (credsFlag !== "") installOAuthJson({ dest, src: credsFlag });
  else if (!fs.existsSync(dest)) throw new Error(`need --creds PATH (or TTY: bun repo setup google-workspace)`);
}

export async function setupGoogleWorkspace(ctx: SetupCtx = {}): Promise<{ ok: true; dest: string; tokens: string }> {
  const { home = os.homedir(), io, loginFn } = ctx;
  const { accountContext, tokenStorePath } = await import("./google-workspace-account.ts");
  const { loginLoopback } = await import("./google-workspace-auth.ts");
  const account = accountContext(str(ctx.flags?.account, "default"), home);
  stateHome(home);
  const dest = oauthWritePath(home, account.id);
  await installCreds(ctx, home, dest);

  logLine(io, `oauth ${dest}`);
  await (loginFn === undefined ? loginLoopback(dest, account) : loginFn(dest, home));
  const tokens = tokenStorePath(account);
  logLine(io, `tokens ${tokens}`);

  return { dest, ok: true, tokens };
}
