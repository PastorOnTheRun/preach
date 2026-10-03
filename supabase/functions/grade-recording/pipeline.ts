// grade-recording pipeline: claim → transcribe (xAI STT) → grade (Grok, structured JSON) → save → email (Resend).
// Everything external (database/storage, fetch, clock, background scheduling) is injected so the
// whole flow is unit-tested in pipeline_test.ts with mocks. index.ts wires the real implementations.
import {
  buildUserPrompt,
  type Feedback,
  FEEDBACK_SCHEMA,
  htmlToText,
  parseFeedback,
  SYSTEM_PROMPT,
  timingFacts,
  toGradeJson,
} from "./rubric.ts";
import { buildEmailHtml, emailSubject } from "./email.ts";

export const XAI_STT_URL = "https://api.x.ai/v1/stt";
export const XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions";
export const RESEND_URL = "https://api.resend.com/emails";
export const DEFAULT_CHAT_MODEL = "grok-4.7";
export const DEFAULT_STT_MODEL = "grok-voice-transcribe-2.0";
export const DEFAULT_FROM = "Preach <onboarding@resend.dev>";
export const DEFAULT_REVIEW_URL = "https://pastorontherun.github.io/preach/review.html";
/** A row stuck in 'processing' longer than this (crashed worker, wall-clock kill) may be claimed again. */
export const STALE_MS = 15 * 60 * 1000;

export interface RecordingRow {
  id: string;
  user_id: string;
  sermon_id: string | null;
  sermon_title: string | null;
  speaker: string | null;
  notes: string | null;
  storage_path: string;
  mime_type: string | null;
  duration: number | null;
  overtime_seconds: number | null;
  timer_minutes: number | null;
  created_at: string;
  status: "uploaded" | "processing" | "graded" | "error";
  status_detail: string | null;
  transcript: string | null;
  summary: string | null;
  grade_json: unknown;
  processing_started_at: string | null;
}

export interface ClaimWhen {
  /** Row status must be one of these… */
  statuses: string[];
  /** …or be 'processing' with processing_started_at older than this ISO time (stale job). */
  staleBefore?: string;
  /** If set, status_detail must equal this as well (used for the stage-2 hand-off). */
  detail?: string;
}

export interface Db {
  getRecording(id: string): Promise<RecordingRow | null>;
  /** Atomic conditional update; returns the updated row, or null if the row didn't match `when`. */
  claim(id: string, fields: Partial<RecordingRow>, when: ClaimWhen): Promise<RecordingRow | null>;
  update(id: string, fields: Partial<RecordingRow> & Record<string, unknown>): Promise<void>;
  getSermon(id: string): Promise<{ title: string | null; content_html: string | null } | null>;
  getProfile(userId: string): Promise<{ display_name: string | null; email: string | null; role?: string | null } | null>;
  createSignedUrl(path: string, expiresInSec: number): Promise<string>;
  download(path: string): Promise<Blob>;
}

export interface Env {
  XAI_API_KEY?: string;
  RESEND_API_KEY?: string;
  FEEDBACK_EMAIL?: string;
  FROM_EMAIL?: string;
  XAI_MODEL?: string;
  XAI_STT_MODEL?: string;
  XAI_REASONING_EFFORT?: string;
  REVIEW_URL?: string;
  FEEDBACK_TIMEZONE?: string;
}

export interface Deps {
  db: Db;
  fetch: typeof fetch;
  env: Env;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  log?: (...args: unknown[]) => void;
  /** Start stage 2 (grading) in a fresh invocation so each stage gets its own wall-clock budget. */
  chain?: (recordingId: string) => Promise<void>;
}

const nowOf = (d: Deps) => (d.now ? d.now() : new Date());
const logOf = (d: Deps) => d.log ?? ((...a: unknown[]) => console.log("[grade-recording]", ...a));
const sleepOf = (d: Deps) => d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function bodyExcerpt(res: Response): Promise<string> {
  try {
    const t = await res.text();
    try {
      const j = JSON.parse(t);
      const m = j?.error?.message ?? j?.error ?? j?.message;
      if (m) return String(typeof m === "string" ? m : JSON.stringify(m)).slice(0, 300);
    } catch { /* not JSON */ }
    return t.slice(0, 300);
  } catch {
    return "";
  }
}

/** fetch with retries on 429/500/503/504 (backoff). 502 is not retried: xAI STT uses it for "could not download url". */
async function fetchRetry(deps: Deps, url: string, init: () => RequestInit, tries = 3): Promise<Response> {
  let res: Response | null = null;
  for (let i = 0; i < tries; i++) {
    res = await deps.fetch(url, init());
    if (![429, 500, 503, 504].includes(res.status)) return res;
    if (i < tries - 1) {
      await res.body?.cancel();
      await sleepOf(deps)(2000 * (i + 1) ** 2);
    }
  }
  return res as Response;
}

// ------------------------------------------------------------------ caller authorisation
export type Caller =
  | { kind: "service" }
  | { kind: "webhook" }
  | { kind: "user"; userId: string; isAdmin: boolean }
  | { kind: "anonymous" };

export function canGrade(caller: Caller, row: Pick<RecordingRow, "user_id">): boolean {
  if (caller.kind === "service" || caller.kind === "webhook") return true;
  if (caller.kind === "user") return caller.isAdmin || caller.userId === row.user_id;
  return false;
}
export const canForce = (c: Caller) => c.kind === "service" || (c.kind === "user" && c.isAdmin);

// ------------------------------------------------------------------ stage 0: claim
export type ClaimResult =
  | { claimed: true; row: RecordingRow }
  | { claimed: false; status: number; reason: string; row?: RecordingRow };

export async function claimRecording(
  id: string,
  caller: Caller,
  deps: Deps,
  opts: { force?: boolean; retranscribe?: boolean } = {},
): Promise<ClaimResult> {
  const row = await deps.db.getRecording(id);
  if (!row) return { claimed: false, status: 404, reason: "Recording not found." };
  if (!canGrade(caller, row)) return { claimed: false, status: 403, reason: "Not allowed to grade this recording." };
  const force = !!opts.force && canForce(caller);
  if (row.status === "graded" && !force) return { claimed: false, status: 200, reason: "Already graded.", row };
  const now = nowOf(deps);
  const fields: Partial<RecordingRow> = {
    status: "processing",
    status_detail: "queued",
    processing_started_at: now.toISOString(),
  };
  if (opts.retranscribe && force) fields.transcript = null;
  const claimed = await deps.db.claim(id, fields, {
    statuses: force ? ["uploaded", "error", "graded"] : ["uploaded", "error"],
    staleBefore: new Date(now.getTime() - STALE_MS).toISOString(),
  });
  if (!claimed) return { claimed: false, status: 200, reason: "Already being processed.", row };
  return { claimed: true, row: claimed };
}

// ------------------------------------------------------------------ stage 1: transcribe
export interface Transcript {
  text: string;
  duration: number | null;
  language: string | null;
}

export function assertSafePath(row: Pick<RecordingRow, "storage_path" | "user_id">) {
  // Preachers can edit storage_path on their own row; never let it point into someone else's folder.
  const p = row.storage_path || "";
  if (!p.startsWith(`${row.user_id}/`) || p.includes("..")) throw new Error("Recording file path is not in the owner's folder.");
}

export async function transcribe(row: RecordingRow, deps: Deps): Promise<Transcript> {
  const key = deps.env.XAI_API_KEY;
  if (!key) throw new Error("XAI_API_KEY secret is not set.");
  assertSafePath(row);
  const log = logOf(deps);
  const model = deps.env.XAI_STT_MODEL || DEFAULT_STT_MODEL;
  const form = (extra: (f: FormData) => void) => () => {
    const f = new FormData();
    f.append("model", model);
    f.append("language", "en");
    f.append("format", "true"); // inverse text normalisation: numbers, dates, punctuation
    extra(f); // `url`, or `file` (which xAI requires to be the LAST field)
    return { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: f } as RequestInit;
  };
  const parse = async (res: Response): Promise<Transcript> => {
    const j = await res.json();
    const text = String(j?.text ?? "").trim();
    if (!text) throw new Error("No speech was found in the recording.");
    return { text, duration: typeof j.duration === "number" ? j.duration : null, language: j.language ?? null };
  };

  // 1) Preferred: hand xAI a short-lived signed URL so the audio never passes through this worker's memory.
  let signed: string | null = null;
  try {
    signed = await deps.db.createSignedUrl(row.storage_path, 60 * 60);
  } catch (e) {
    log("signed URL failed", String(e));
  }
  if (signed) {
    const url = signed;
    const res = await fetchRetry(deps, XAI_STT_URL, form((f) => f.append("url", url)));
    if (res.ok) return await parse(res);
    const msg = await bodyExcerpt(res);
    if (res.status === 401 || res.status === 403) throw new Error(`xAI speech-to-text rejected the API key (${res.status}): ${msg}`);
    log(`STT via url failed (${res.status}): ${msg}; falling back to file upload`);
  }

  // 2) Fallback: download with the service role and upload the bytes (bucket limit is 50 MB, xAI allows 500 MB).
  const blob = await deps.db.download(row.storage_path);
  const name = row.storage_path.split("/").pop() || "sermon.webm";
  const file = new File([blob], name, { type: (row.mime_type || blob.type || "audio/webm").split(";")[0] });
  const res = await fetchRetry(deps, XAI_STT_URL, form((f) => f.append("file", file)));
  if (!res.ok) throw new Error(`xAI speech-to-text failed (${res.status}): ${await bodyExcerpt(res)}`);
  return await parse(res);
}

// ------------------------------------------------------------------ stage 2: grade
export async function callGrok(system: string, user: string, deps: Deps): Promise<{ content: string; model: string }> {
  const key = deps.env.XAI_API_KEY;
  if (!key) throw new Error("XAI_API_KEY secret is not set.");
  const model = deps.env.XAI_MODEL || DEFAULT_CHAT_MODEL;
  let effort: string | undefined = deps.env.XAI_REASONING_EFFORT === "none" ? undefined : (deps.env.XAI_REASONING_EFFORT || "medium");
  const body = () =>
    JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_schema", json_schema: { name: "sermon_feedback", strict: true, schema: FEEDBACK_SCHEMA } },
      ...(effort ? { reasoning_effort: effort } : {}),
    });
  const init = () => ({ method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: body() });
  let res = await fetchRetry(deps, XAI_CHAT_URL, init);
  if (res.status === 400 && effort) {
    const msg = await bodyExcerpt(res);
    if (!/reasoning/i.test(msg)) throw new Error(`Grok request failed (400): ${msg}`);
    effort = undefined; // model doesn't take reasoning_effort: retry without it
    res = await fetchRetry(deps, XAI_CHAT_URL, init);
  }
  if (!res.ok) throw new Error(`Grok request failed (${res.status}): ${await bodyExcerpt(res)}`);
  const j = await res.json();
  const msg = j?.choices?.[0]?.message;
  if (msg?.refusal) throw new Error(`Grok declined: ${String(msg.refusal).slice(0, 200)}`);
  const content = msg?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("Grok returned an empty reply.");
  return { content, model: String(j?.model || model) };
}

export function formatDate(iso: string, tz = "America/New_York"): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "unknown date";
  return d.toLocaleDateString("en-US", { timeZone: tz, weekday: "short", year: "numeric", month: "short", day: "numeric" });
}

export function reviewLink(env: Env, id: string): string {
  const base = env.REVIEW_URL || DEFAULT_REVIEW_URL;
  return `${base}${base.includes("?") ? "&" : "?"}rec=${encodeURIComponent(id)}`;
}

export interface GradeOutcome {
  feedback: Feedback;
  gradeJson: ReturnType<typeof toGradeJson>;
  emailed: boolean;
  emailError?: string;
}

export async function gradeAndNotify(row: RecordingRow, deps: Deps, sttDuration?: number | null): Promise<GradeOutcome> {
  const { db, env } = deps;
  if (!row.transcript) throw new Error("No transcript to grade.");
  await db.update(row.id, { status_detail: "grading" });
  const [sermon, profile] = await Promise.all([
    row.sermon_id ? db.getSermon(row.sermon_id).catch(() => null) : Promise.resolve(null),
    db.getProfile(row.user_id).catch(() => null),
  ]);
  const preacher = row.speaker?.trim() || profile?.display_name?.trim() || profile?.email || "A preacher";
  const sermonTitle = row.sermon_title?.trim() || sermon?.title?.trim() || "Untitled sermon";
  const date = formatDate(row.created_at, env.FEEDBACK_TIMEZONE || "America/New_York");
  const timing = timingFacts(row, row.transcript, sttDuration);
  const question = row.notes?.trim() || null;
  const userPrompt = buildUserPrompt({
    preacher,
    sermonTitle,
    date,
    question,
    timing,
    transcript: row.transcript,
    manuscript: htmlToText(sermon?.content_html),
  });

  // One retry if the reply can't be used (structured outputs make this rare).
  let feedback: Feedback | null = null, model = "";
  let lastErr: unknown = null;
  for (let i = 0; i < 2 && !feedback; i++) {
    const r = await callGrok(SYSTEM_PROMPT, userPrompt, deps);
    model = r.model;
    try {
      feedback = parseFeedback(r.content, !!question);
    } catch (e) {
      lastErr = e;
      logOf(deps)("unusable reply", String(e));
    }
  }
  if (!feedback) throw lastErr instanceof Error ? lastErr : new Error("Grok's reply could not be used.");

  const gradedAt = nowOf(deps).toISOString();
  const gradeJson = toGradeJson(feedback, { model, timing, stt_model: env.XAI_STT_MODEL || DEFAULT_STT_MODEL, graded_at: gradedAt });
  await db.update(row.id, {
    status: "graded",
    status_detail: null,
    summary: feedback.summary,
    grade_json: gradeJson,
    graded_at: gradedAt,
  });

  // Email Jake. A failed email never un-grades the sermon; it is recorded in status_detail instead.
  if (!env.RESEND_API_KEY || !env.FEEDBACK_EMAIL) {
    await db.update(row.id, { status_detail: "Graded (email not configured)." });
    return { feedback, gradeJson, emailed: false, emailError: "not configured" };
  }
  try {
    await sendEmail(deps, {
      idempotencyKey: `grade-${row.id}-${gradedAt}`,
      subject: emailSubject({ preacher, sermonTitle, grade: gradeJson }),
      html: buildEmailHtml({
        preacher,
        sermonTitle,
        date,
        timing,
        grade: gradeJson,
        summary: feedback.summary,
        question,
        reviewUrl: reviewLink(env, row.id),
      }),
    });
    return { feedback, gradeJson, emailed: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(row.id, { status_detail: `Graded, but the email failed: ${msg}`.slice(0, 500) });
    return { feedback, gradeJson, emailed: false, emailError: msg };
  }
}

export async function sendEmail(deps: Deps, m: { subject: string; html: string; idempotencyKey?: string }): Promise<string | null> {
  const env = deps.env;
  const to = String(env.FEEDBACK_EMAIL || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!env.RESEND_API_KEY || !to.length) throw new Error("RESEND_API_KEY / FEEDBACK_EMAIL not set.");
  const headers: Record<string, string> = { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" };
  if (m.idempotencyKey) headers["Idempotency-Key"] = m.idempotencyKey;
  const res = await fetchRetry(deps, RESEND_URL, () => ({
    method: "POST",
    headers,
    body: JSON.stringify({ from: env.FROM_EMAIL || DEFAULT_FROM, to, subject: m.subject, html: m.html }),
  }));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await bodyExcerpt(res)}`);
  const j = await res.json().catch(() => ({}));
  return j?.id ?? null;
}

// ------------------------------------------------------------------ orchestration
async function markError(deps: Deps, id: string, e: unknown) {
  const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
  logOf(deps)("error", id, msg);
  try {
    await deps.db.update(id, { status: "error", status_detail: msg });
  } catch (e2) {
    logOf(deps)("could not save error", String(e2));
  }
}

export type RunResult = { stage: "graded" | "handed-off" | "error"; outcome?: GradeOutcome; error?: string };

/** Stage 1 (+ stage 2 inline if there is no chain or the hand-off fails). Never throws. */
export async function processRecording(row: RecordingRow, deps: Deps): Promise<RunResult> {
  try {
    let sttDuration: number | null = null;
    if (!row.transcript) {
      await deps.db.update(row.id, { status_detail: "transcribing" });
      const t = await transcribe(row, deps);
      sttDuration = t.duration;
      row = { ...row, transcript: t.text };
      await deps.db.update(row.id, { transcript: t.text, status_detail: "transcribed" });
      if (deps.chain) {
        try {
          await deps.chain(row.id);
          return { stage: "handed-off" };
        } catch (e) {
          logOf(deps)("hand-off failed, grading inline", String(e));
        }
      }
    }
    return { stage: "graded", outcome: await gradeAndNotify(row, deps, sttDuration) };
  } catch (e) {
    await markError(deps, row.id, e);
    return { stage: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

/** Stage 2 entry (self-invoked with the service role after transcription). Never throws. */
export async function continueGrading(id: string, deps: Deps): Promise<RunResult> {
  const row = await deps.db.claim(id, { status_detail: "grading" }, { statuses: ["processing"], detail: "transcribed" });
  if (!row) return { stage: "error", error: "Nothing to grade (not in the transcribed state)." };
  try {
    return { stage: "graded", outcome: await gradeAndNotify(row, deps) };
  } catch (e) {
    await markError(deps, id, e);
    return { stage: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

// ------------------------------------------------------------------ HTTP handler
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

export interface HandlerCtx extends Deps {
  identify(req: Request): Promise<Caller>;
  /** Keep work running after the response is sent (EdgeRuntime.waitUntil in production). */
  waitUntil(p: Promise<unknown>): void;
}

/**
 * Accepts:
 *   { recording_id, force?, retranscribe? }           – from the app (user JWT) or an admin re-run
 *   { type: "INSERT", table: "recordings", record }   – Database Webhook / trigger payload
 *   { recording_id, stage: "grade" }                  – internal hand-off (service role only)
 * Responds 202 as soon as the row is claimed; the work continues in the background.
 */
export async function handleRequest(req: Request, ctx: HandlerCtx): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Body must be JSON." });
  }
  const caller = await ctx.identify(req);
  if (caller.kind === "anonymous") return json(401, { error: "Sign in required." });

  if (body?.type && body?.record) {
    if (body.type !== "INSERT") return json(200, { ignored: body.type });
    body = { recording_id: body.record.id };
  }
  const id = typeof body?.recording_id === "string" ? body.recording_id : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "recording_id (uuid) is required." });

  if (body.stage === "grade") {
    if (caller.kind !== "service") return json(403, { error: "Internal stage." });
    ctx.waitUntil(continueGrading(id, ctx));
    return json(202, { status: "processing", stage: "grade" });
  }

  const c = await claimRecording(id, caller, ctx, { force: !!body.force, retranscribe: !!body.retranscribe });
  if (!c.claimed) return json(c.status, { status: c.row?.status ?? null, message: c.reason });
  ctx.waitUntil(processRecording(c.row, ctx));
  return json(202, { status: "processing", message: "Feedback is on its way." });
}
