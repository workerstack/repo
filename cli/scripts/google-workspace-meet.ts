/** Calendar meetings and Gmail: create an event (or print a template link), send and list mail. */
import { rec } from "./google-workspace-account.ts";
import { apiMessage, fail, gfetch, ok } from "./google-workspace-auth.ts";
import {
  ATTENDEE_SPLIT_RE,
  CALENDAR,
  CALENDAR_TEMPLATE_URL,
  GMAIL,
  HOUR_MS,
  MAIL_PAGE,
  PAD_RE,
  STAMP_MS_RE,
  STAMP_PUNCT_RE,
} from "./google-workspace.constants.ts";
import type { MeetingSpec, WorkspaceAccount } from "./google-workspace.types.ts";

type Opt = string | undefined;

type CalEvent = {
  summary: string;
  start: { dateTime: string };
  end: { dateTime: string };
  attendees?: { email: string }[];
};

function toGCalStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().replaceAll(STAMP_PUNCT_RE, "").replace(STAMP_MS_RE, "Z");
}

/** The event `spec` asks for: start defaults to `when`, else an hour from now; end to an hour after start. */
function toEvent({ title, start, end, when, attendees }: MeetingSpec): CalEvent {
  let startIso = start;
  if (!startIso && when) startIso = when;
  if (!startIso) startIso = new Date(Date.now() + HOUR_MS).toISOString();
  const endIso = end || new Date(new Date(startIso).getTime() + HOUR_MS).toISOString();
  const event: CalEvent = {
    end: { dateTime: endIso },
    start: { dateTime: startIso },
    summary: title || "meeting",
  };
  const emails = String(attendees || "")
    .split(ATTENDEE_SPLIT_RE)
    .map((e) => e.trim())
    .filter(Boolean);
  if (emails.length) event.attendees = emails.map((email) => ({ email }));
  return event;
}

export async function meetingCreate(account: WorkspaceAccount, spec: MeetingSpec): Promise<number> {
  const event = toEvent(spec);
  const r = await gfetch(account, `${CALENDAR}/calendars/primary/events`, {
    body: JSON.stringify(event),
    method: "POST",
  });
  if (r.ok) return ok(`${String(r.json.summary)}\n${String(r.json.htmlLink)}\nid=${String(r.json.id)}`);

  const stamp0 = toGCalStamp(event.start.dateTime);
  const stamp1 = toGCalStamp(event.end.dateTime);
  const dates = stamp0 && stamp1 ? `&dates=${stamp0}/${stamp1}` : "";
  const template = `${CALENDAR_TEMPLATE_URL}&text=${encodeURIComponent(event.summary)}${dates}`;
  return fail(`Calendar API blocked (${apiMessage(r.json, String(r.status))}). Open to confirm:\n${template}`);
}

export async function mailSend(
  account: WorkspaceAccount,
  { to, subject, body }: { to?: Opt; subject?: Opt; body?: Opt },
): Promise<number> {
  if (!to) return fail("mail send needs --to");
  const raw = [
    `To: ${to}`,
    `Subject: ${subject || "(no subject)"}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body || "",
  ].join("\r\n");
  const encoded = Buffer.from(raw).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(PAD_RE, "");
  const r = await gfetch(account, `${GMAIL}/users/me/messages/send`, {
    body: JSON.stringify({ raw: encoded }),
    method: "POST",
  });
  if (!r.ok) return fail(apiMessage(r.json, "mail send failed"));
  return ok(`sent id=${String(r.json.id)}`);
}

export async function mailList(account: WorkspaceAccount, { query, n }: { query?: Opt; n?: Opt }): Promise<number> {
  const q = new URLSearchParams({ maxResults: String(n || MAIL_PAGE) });
  if (query) q.set("q", query);
  const r = await gfetch(account, `${GMAIL}/users/me/messages?${q}`);
  if (!r.ok) return fail(apiMessage(r.json, "mail list failed"));
  const messages: unknown[] = Array.isArray(r.json.messages) ? r.json.messages : [];
  const ids = messages.map((m) => rec(m).id);
  return ok(ids.length ? ids.join("\n") : "no messages");
}
