// Supabase Edge Function: grade-recording
// Transcribes a sermon recording with xAI speech-to-text, grades it with Grok against a fixed
// pastoral rubric, saves transcript/summary/grade_json on public.recordings, and emails Jake via Resend.
// See pipeline.ts for the flow and SETUP.md ("Phase 2") for deployment.
import { createClient } from "@supabase/supabase-js";
import { type Caller, type ClaimWhen, type Db, handleRequest, type RecordingRow } from "./pipeline.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
// New-style secret keys (SUPABASE_SECRET_KEYS JSON) first, legacy service_role JWT as fallback.
function secretKeys(): string[] {
  const keys: string[] = [];
  try {
    const j = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    for (const v of Object.values(j)) if (typeof v === "string" && v) keys.push(v);
    if (typeof j.default === "string" && j.default) keys.unshift(j.default);
  } catch { /* not set */ }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) keys.push(legacy);
  return [...new Set(keys)];
}
const SERVICE_KEYS = secretKeys();
const SERVICE_KEY = SERVICE_KEYS[0] ?? "";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";
const BUCKET = "recordings";
const COLUMNS =
  "id, user_id, sermon_id, sermon_title, speaker, notes, storage_path, mime_type, duration, overtime_seconds, timer_minutes, created_at, status, status_detail, transcript, summary, grade_json, processing_started_at";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const db: Db = {
  async getRecording(id) {
    const { data, error } = await admin.from("recordings").select(COLUMNS).eq("id", id).maybeSingle();
    if (error) throw new Error(`DB read failed: ${error.message}`);
    return data as RecordingRow | null;
  },
  async claim(id, fields, when: ClaimWhen) {
    let q = admin.from("recordings").update(fields).eq("id", id);
    if (when.detail !== undefined) q = q.eq("status_detail", when.detail);
    const inList = `status.in.(${when.statuses.join(",")})`;
    q = when.staleBefore
      ? q.or(`${inList},and(status.eq.processing,processing_started_at.lt."${when.staleBefore}")`)
      : q.in("status", when.statuses);
    const { data, error } = await q.select(COLUMNS).maybeSingle();
    if (error) throw new Error(`DB claim failed: ${error.message}`);
    return data as RecordingRow | null;
  },
  async update(id, fields) {
    const { error } = await admin.from("recordings").update(fields).eq("id", id);
    if (error) throw new Error(`DB update failed: ${error.message}`);
  },
  async getSermon(id) {
    const { data } = await admin.from("sermons").select("title, content_html").eq("id", id).maybeSingle();
    return data;
  },
  async getProfile(userId) {
    const { data } = await admin.from("profiles").select("display_name, email, role").eq("id", userId).maybeSingle();
    return data;
  },
  async createSignedUrl(path, expiresIn) {
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, expiresIn);
    if (error || !data?.signedUrl) throw new Error(`Signed URL failed: ${error?.message ?? "no url"}`);
    return data.signedUrl;
  },
  async download(path) {
    const { data, error } = await admin.storage.from(BUCKET).download(path);
    if (error || !data) throw new Error(`Audio download failed: ${error?.message ?? "no data"}`);
    return data;
  },
};

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function identify(req: Request): Promise<Caller> {
  const secret = req.headers.get("x-webhook-secret") ?? "";
  if (WEBHOOK_SECRET && safeEqual(secret, WEBHOOK_SECRET)) return { kind: "webhook" };
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return { kind: "anonymous" };
  if (SERVICE_KEYS.some((k) => safeEqual(token, k))) return { kind: "service" };
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return { kind: "anonymous" };
  const { data: prof } = await admin.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  return { kind: "user", userId: data.user.id, isAdmin: prof?.role === "admin" };
}

const env = {
  XAI_API_KEY: Deno.env.get("XAI_API_KEY"),
  RESEND_API_KEY: Deno.env.get("RESEND_API_KEY"),
  FEEDBACK_EMAIL: Deno.env.get("FEEDBACK_EMAIL"),
  FROM_EMAIL: Deno.env.get("FROM_EMAIL"),
  XAI_MODEL: Deno.env.get("XAI_MODEL"),
  XAI_STT_MODEL: Deno.env.get("XAI_STT_MODEL"),
  XAI_REASONING_EFFORT: Deno.env.get("XAI_REASONING_EFFORT"),
  REVIEW_URL: Deno.env.get("REVIEW_URL"),
  FEEDBACK_TIMEZONE: Deno.env.get("FEEDBACK_TIMEZONE"),
};

/** Hand stage 2 to a fresh invocation (own wall-clock budget). Only waits for the 202, not the grading. */
async function chain(recordingId: string) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/grade-recording`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recording_id: recordingId, stage: "grade" }),
  });
  if (res.status !== 202) throw new Error(`hand-off returned ${res.status}`);
  await res.body?.cancel();
}

function waitUntil(p: Promise<unknown>) {
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(p);
  else p.catch((e) => console.error(e)); // local `deno run` without the edge runtime
}

Deno.serve((req) => handleRequest(req, { db, fetch, env, identify, waitUntil, chain: SERVICE_KEY ? chain : undefined }));
