// Feedback pipeline.
//
// 1. Uploads the recording to the private Supabase Storage bucket
//    `recordings/<user_id>/<sermon_id>/<timestamp>.<ext>` and inserts a `recordings` row (status 'uploaded').
// 2. Phase 2: asks the `grade-recording` Edge Function (supabase/functions/grade-recording) to
//    transcribe it with xAI speech-to-text, grade it with Grok against the pastoral rubric, save
//    transcript / summary / grade_json on the row and email Jake. The function answers 202 straight
//    away and works in the background; the preacher sees the grade later in their recordings list.
//    (An optional database trigger, supabase/grading-trigger.sql, starts the same job server-side.)
// API keys live only in Edge Function secrets, never in this static site.
import { isConfigured, initAuth, auth, uploadRecording, requestGrading } from './cloud.js';

let syncEngine = null;
/** app.js registers the sync engine so the sermon row exists before we link the recording to it. */
export function setFeedbackSync(engine) { syncEngine = engine; }

/**
 * Send a sermon recording for feedback.
 * @param {Blob} audioBlob  The recorded audio (audio/webm on Chrome/Android, audio/mp4 on Safari/iOS).
 * @param {object} metadata { recordingId, sermonId, sermonTitle, speaker, notes, recordedAt (ISO), durationSec,
 *                            mimeType, timerMinutes, overtimeSec, manuscript (plain text) }
 * @returns {Promise<{ok: boolean, stub?: boolean, needsSignIn?: boolean, message: string, recordingRowId?: string, storagePath?: string, gradingStarted?: boolean}>}
 */
export async function sendForFeedback(audioBlob, metadata) {
  if (!isConfigured()) {
    return { ok: false, stub: true, message: 'Feedback sending isn’t switched on yet (team accounts aren’t set up in this copy of the app). Your recording is saved on this device and can be downloaded.' };
  }
  await initAuth();
  if (!auth.user) return { ok: false, needsSignIn: true, message: 'Please sign in first, then tap Send again.' };
  if (!navigator.onLine) return { ok: false, message: 'You’re offline. Your recording is safe on this device. Try again when you’re connected.' };
  if (!audioBlob || !audioBlob.size) return { ok: false, message: 'This recording is empty.' };

  // Make sure the sermon itself is in the cloud first, so the recording can link to it.
  if (syncEngine) { try { await syncEngine.syncNow(); } catch {} }

  const { id, path } = await uploadRecording(audioBlob, metadata);

  // Kick off transcription + grading. Don't let a slow/failed call hold up the "Sent" message:
  // the upload is what matters, and grading can be retried from the recordings list.
  const grading = await Promise.race([
    requestGrading(id),
    new Promise(r => setTimeout(() => r({ ok: true, pending: true }), 8000))
  ]);

  return {
    ok: true, recordingRowId: id, storagePath: path, gradingStarted: !!grading.ok,
    message: grading.ok
      ? 'Sent! Feedback is on its way. Your grade will appear in your recordings list in a few minutes.'
      : 'Sent! Your recording is uploaded. Feedback should follow shortly. If no grade appears in your recordings list, tap “Retry feedback” there.'
  };
}

