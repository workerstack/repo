/** What `repo set` takes: setting words and the session whose store they change. */
export const SET_SUMMARY = "Set this session's approval, effort or strategy (the hook adds --session for an agent)";
export const USAGE = "usage: repo set --session <id> <ask|away|fast|deep|free|spawn-fast|spawn-deep>...";

export const SESSION_FLAG = "--session";
export const NEEDS_SESSION = "repo set: needs --session <id>; the hook adds it for an agent";
export const EXIT_USAGE = 2;
