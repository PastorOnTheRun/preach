// Feedback pipeline hook.
//
// Phase 1.5 (now): uploads the recording to the private Supabase Storage bucket
//   `recordings/<user_id>/<sermon_id>/<timestamp>.<ext>` and inserts a `recordings` row
//   with status 'uploaded'. Jake can listen to it on review.html.
// Phase 2 (TODO): a Supabase Edge Function `grade-recording` that
//   1. downloads the audio (service role) and transcribes it with xAI Speech-to-Text
//      (POST https://api.x.ai/v1/stt, model grok-voice-transcribe-2.0),
//   2. sends transcript + manuscript to the xAI Grok API for a summary and rubric grade,
//   3. writes transcript / summary / grade_json, sets status 'graded', and emails Jake.
// API keys live only in Edge Function secrets, never in this static site.
import { isConfigured, initAuth, auth, uploadRecording, getClient } from './cloud.js';

let syncEngine = null;
/** app.js registers the sync engine so the sermon row exists before we link the recording to it. */
export function setFeedbackSync(engine) { syncEngine = engine; }

/**
 * Send a sermon recording for feedback.
 * @param {Blob} audioBlob  The recorded audio (audio/webm on Chrome/Android, audio/mp4 on Safari/iOS).
 * @param {object} metadata { recordingId, sermonId, sermonTitle, speaker, notes, recordedAt (ISO), durationSec,
 *                            mimeType, timerMinutes, overtimeSec, manuscript (plain text) }
 * @returns {Promise<{ok: boolean, stub?: boolean, needsSignIn?: boolean, message: string, recordingRowId?: string, storagePath?: string}>}
 */
export async function sendForFeedback(audioBlob, metadata) {
  if (!isConfigured()) {
    return { ok: false, stub: true, message: 'Feedback sending isn’t switched on yet (coming in Phase 2, once team accounts are set up). Your recording is saved on this device and can be downloaded.' };
  }
  await initAuth();
  if (!auth.user) return { ok: false, needsSignIn: true, message: 'Please sign in first, then tap Send again.' };
  if (!navigator.onLine) return { ok: false, message: 'You’re offline. Your recording is safe on this device. Try again when you’re connected.' };
  if (!audioBlob || !audioBlob.size) return { ok: false, message: 'This recording is empty.' };

  // Make sure the sermon itself is in the cloud first, so the recording can link to it.
  if (syncEngine) { try { await syncEngine.syncNow(); } catch {} }

  const { id, path } = await uploadRecording(audioBlob, metadata);

  // TODO(phase 2): kick off transcription + Grok grading + email via an Edge Function, e.g.
  //   const client = await getClient();
  //   await client.functions.invoke('grade-recording', { body: { recording_id: id } });
  // (Or trigger it server-side from a Storage/DB webhook so the app doesn't need to wait.)
  void getClient;

  return {
    ok: true, recordingRowId: id, storagePath: path,
    message: 'Sent! Your recording is uploaded for review. (Automatic AI feedback is coming in Phase 2.)'
  };
}
