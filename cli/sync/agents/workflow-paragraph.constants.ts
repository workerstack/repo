/** The workflow paragraph of the root `AGENTS.md`, rendered for the repo's `workflow`. */
import type { Workflow } from "../../workflow.ts";

/** How the stock worktree paragraph starts; a root rule line that starts with it is the mode's paragraph. */
export const WORKFLOW_ANCHOR = "Every change happens in a worktree.";

/** A line end, CRLF or LF, so a rule checked out with CRLF still matches the anchor. */
export const LINE_END: RegExp = /\r?\n/;

/** The paragraph each workflow other than worktree renders in place of the line that starts with the anchor. */
export const WORKFLOW_PARAGRAPHS: Readonly<Record<Exclude<Workflow, "worktree">, string>> = {
  main:
    "Changes happen in the main checkout, on the default branch. Edit, test and commit there, then run " +
    "`bun repo push`. Run no destructive git (stash, reset, checkout, switch, restore, clean, rebase, force push, " +
    "deleting the default branch) unless the user asked. Never drop stashes you did not make.",
  "pull-request":
    "Every change happens in a worktree, and the default branch takes changes only through pull requests. Run " +
    "`bun repo worktree add <name>`, then edit, test and commit in `.worktrees/<name>`, then run " +
    "`bun repo worktree finish <name>` from the root: it pushes `wt/<name>` and opens its pull request. Run it " +
    "again after more commits to push them to the open pull request. Once it merges, run it again to land it and " +
    "clean up. A closed pull request is refused until you reopen it with `gh pr reopen <number>`. Never push the " +
    "default branch. Never write product files in the main checkout. Any git is fine in your worktree. In the main " +
    "checkout or on the default branch, run no destructive git (stash, reset, checkout, switch, restore, clean, " +
    "rebase, force push, deleting the default branch) unless the user asked. Never drop stashes you did not make.",
};
