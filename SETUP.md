# Preach — Supabase setup (for Jake)

About 20 minutes. You only paste two values into `config.js`. Until you do, the app runs exactly as before: local-only, no sign-in.

## 1. Create the project
1. Go to https://supabase.com, sign in, and click **New project**.
2. Name it `preach`, set a strong database password (save it in your password manager), pick region **East US**, and choose the **Free** plan.
3. Wait about 2 minutes for it to finish setting up.

## 2. Create the tables, security rules and recordings bucket
1. Left sidebar → **SQL Editor** → **New query**.
2. Open `supabase/schema.sql` from this repo, copy all of it, paste it in, and click **Run**. You should see "Success. No rows returned."
   (It's safe to run again later. It won't delete any data.)
3. Check: **Table Editor** shows `profiles`, `sermons` and `recordings`. **Storage** shows a private bucket called `recordings`.

## 3. Auth settings
1. **Authentication → URL Configuration**
   - **Site URL:** your app address: `https://pastorontherun.github.io/preach/`
   - **Redirect URLs:** add the same address. For local testing, also add `http://localhost:8765/`.
2. **Authentication → Sign In / Providers → Email:** make sure Email is enabled. Turn **"Confirm email" off** (new accounts are protected by the team invite code instead, see step 3b).
3. **Email sending (required for preachers).** Supabase's built-in email only delivers to members of your Supabase team, about 2 emails per hour, from `noreply@mail.app.supabase.io`, and on the Free plan its templates **can't be edited**, so it sends a link, not the 6-digit code the app asks for. To send codes to preachers you need your own email sender:
   - In Resend (resend.com), **verify your church's domain** (Domains → Add, then add the DNS records it shows). Without a verified domain Resend only delivers to your own address.
   - Create a Resend API key with *Sending access* (it can be limited to that domain).
   - **Authentication → Emails → SMTP Settings** → enable custom SMTP: host `smtp.resend.com`, port `465`, user `resend`, password = that API key, sender email e.g. `preach@yourchurch.org`, sender name `Preach`.
   - **Authentication → Rate Limits** → raise "emails per hour" (e.g. 30).
4. **Authentication → Emails → Templates** (available once custom SMTP is on): for both **Magic Link** and **Confirm signup**, set the subject to `Your Preach sign-in code: {{ .Token }}` and paste the body from `supabase/email-templates/sign-in-code.html` (big code, no links). Sign-in codes are 6 digits and expire after 10 minutes (Authentication → Providers → Email → Email OTP length / expiration).

## 3b. Team sign-up with an invite code (no email needed) — already done on the live project
Preachers create their own account in the app: **Sign in → Create an account** (name, email, password, confirm password, team invite code). They're signed straight in; no email is sent. To stop strangers signing up, the server checks the invite code:

1. **Confirm email is off** (`mailer_autoconfirm`), see step 3.2.
2. In **SQL Editor**, run `supabase/team-invite.sql`. It creates a private settings table (not readable by the app or any signed-in user), a random starting code, the check function, and `get_invite_code()` for admins.
3. **Authentication → Hooks → Before User Created** → enable it, type *Postgres*, function `public.hook_require_invite_code`. (A Before User Created hook is used instead of a plain trigger on `auth.users` because Supabase hides trigger errors as "Database error saving new user", while hook messages reach the app, e.g. "That team invite code isn’t right. Check it with Jake and try again.")

**See the current code:** open the **Review** page while signed in as an admin. It's shown at the top.

**Change the code** (e.g. if it leaks) with one line in the SQL Editor. Codes ignore case, spaces and dashes when people type them:
```sql
update private.app_settings set value = 'HOPE-2468' where key = 'invite_code';
```
Existing accounts are never affected. Only new sign-ups need the code.

Notes:
- "Email me a sign-in code" only works for people who already have an account (it never creates one). Until a custom email sender is set up (step 3), preachers should sign in with their **password**.
- Because the hook requires a code for *every* new user, **Authentication → Users → Add user** in the dashboard may be refused. Use the app's Create an account page instead, or temporarily turn the hook off.

> **No email sender yet?** Password sign-in still works without one. Go to **Authentication → Users → Add user → Create new user**, enter the preacher's email and a password, and tick **Auto Confirm User**. Then give them the password.

## 4. Connect the app
1. **Project Settings → API** (or **Connect** at the top of the page). Copy the **Project URL** and the **anon / publishable** key. **Never** use the `service_role`/secret key.
2. Edit `config.js`:
   ```js
   supabaseUrl: 'https://abcdefghijkl.supabase.co',
   supabaseAnonKey: 'eyJhbGciOi...  (or sb_publishable_...)',
   ```
3. Commit and deploy as usual. The anon key is meant to be public. The security rules from step 2 are what protect each preacher's data.

## 5. Make yourself the admin
1. Open the app → **Sign in** → sign in (or **Create an account** with the team invite code).
2. In Supabase → **SQL Editor**, run this one line (with your email):
   ```sql
   update public.profiles set role = 'admin' where email = 'jake@yourchurch.org';
   ```
3. Reload the app. A **Review** button appears in the header, or go straight to `review.html`.

Everyone else who signs up is a "preacher". Preachers can only see their own sermons and recordings. Admins can see everyone's. Nobody can make themselves an admin from the app.

## 5b. Big screen (projector) mode — nothing extra to create
Screen mode uses Supabase **Realtime broadcast** on a public channel named after the pairing code. It works with the anon key out of the box
(**Realtime → Settings → “Allow public access to channels”** is Enabled by default; leave it on, or pairing stops working).
Only slide text is broadcast (headings, highlights, quotes, verses) — never manuscripts — and the 6-character code is what keeps strangers off your screen; tap **New code** in Settings any time.
To use it: open `https://pastorontherun.github.io/preach/screen.html` on the projector computer, then in the app on the iPad go to Settings › Big screen › Show code and type the code on the projector.

## 6. Quick test
- [ ] On a second device or browser, sign in as a test preacher, add a sermon, and preach a few pages.
- [ ] Sign in on another device with the same account. The sermon, timer and last page show up within about a minute (or tap the account button → **Sync now**).
- [ ] Record a short test and tap **Send for feedback**. It should say "Sent! Feedback is on its way."
- [ ] Open `review.html` as Jake. The sermon and recording are listed, the audio plays, and filtering by preacher works.
- [ ] In airplane mode the app still opens and preaches. Changes sync once you're back online.

## Things to know
- **Conflicts:** if the same sermon is edited on two devices while offline, the most recent save wins and the older edit is replaced.
- **Free plan:** files up to 50 MB (about 90 minutes of audio), and the project pauses after a week with no activity. Restore it from the dashboard, or use the Pro plan for a live ministry.
- **Removing a preacher:** Authentication → Users → delete. Their sermons and recordings rows are deleted too. Remove their files in Storage → recordings → their folder.

## 7. Phase 2: automatic AI feedback
When a preacher taps **Send for feedback**, the app uploads the recording and calls the Edge Function
`grade-recording` (in `supabase/functions/grade-recording/`). The function:
1. checks the caller owns the recording (or is an admin), marks it `processing`, and replies **202** straight away;
2. in the background, gives xAI speech-to-text (`POST https://api.x.ai/v1/stt`, model `grok-voice-transcribe-2.0`)
   a 1-hour signed link to the audio in the private `recordings` bucket (falls back to uploading the file);
3. hands off to a second run of itself, which sends the transcript, manuscript, timing (planned/actual/overtime,
   words per minute) and the preacher's question to Grok (`POST https://api.x.ai/v1/chat/completions`,
   model `grok-4.7`, strict JSON schema) with a fixed pastoral rubric;
4. saves `transcript`, `summary`, `grade_json`, sets `status = 'graded'` (or `error` with the reason in `status_detail`);
5. emails you the results through Resend (grade table, summary, strengths, growth areas, link to `review.html`).

The preacher sees **Feedback on its way…** and then **Grade B+ · View feedback** in their recordings list.
On `review.html` you see the full feedback and a **Run / Re-run AI feedback** button.

### What you need
- **xAI API key**: console.x.ai → API Keys. Cost is about $0.10 per hour of audio for transcription plus a few cents per sermon for grading.
- **Resend API key**: resend.com → sign up → API Keys → *Sending access*. Without a verified domain, Resend only
  delivers from `onboarding@resend.dev` **to the email address you signed up with**, so use that address as `FEEDBACK_EMAIL`.
  (Later: verify your church domain in Resend and set `FROM_EMAIL`, e.g. `Preach <feedback@yourchurch.org>`.)
- **Supabase CLI**: `brew install supabase/tap/supabase` (Mac) or `npx supabase …`.

### Steps (from the repo root, the folder containing `supabase/config.toml`)
1. Re-run **`supabase/schema.sql`** in the SQL editor (safe to re-run; it adds `status_detail`, `processing_started_at`, `graded_at`).
2. Deploy:
   ```bash
   supabase login                                    # opens the browser once
   supabase link --project-ref bpndhidtxzgjxmrgffyp  # press Enter if asked for the database password
   WEBHOOK_SECRET=$(openssl rand -hex 24); echo "$WEBHOOK_SECRET"   # keep this for step 3
   supabase secrets set XAI_API_KEY=xai-... RESEND_API_KEY=re_... FEEDBACK_EMAIL=you@example.com WEBHOOK_SECRET=$WEBHOOK_SECRET
   # optional: supabase secrets set FROM_EMAIL='Preach <feedback@yourchurch.org>'
   supabase functions deploy grade-recording --no-verify-jwt --use-api
   ```
   `--no-verify-jwt` is intended (it's also set in `supabase/config.toml`): the function checks every caller itself
   (signed-in user via `auth.getUser` + ownership, database trigger via `WEBHOOK_SECRET`, or the service key for its own hand-off).
3. *(Recommended backup trigger)* In the SQL editor run, with your secret from step 2:
   ```sql
   select vault.create_secret('https://bpndhidtxzgjxmrgffyp.supabase.co/functions/v1/grade-recording', 'grade_recording_url');
   select vault.create_secret('PASTE-WEBHOOK_SECRET', 'grade_recording_secret');
   ```
   then run **`supabase/grading-trigger.sql`**. Now grading also starts from the database if the phone drops off right after uploading.
   The function makes sure only one run grades each recording.
4. Test: record 30 seconds, **Send for feedback**, wait 1–3 minutes. Check the email, the recordings list and `review.html`.
   If something fails, the reason is on the review page (and in Dashboard → Edge Functions → grade-recording → Logs).

### Optional settings (secrets)
| Secret | Default | Use |
| --- | --- | --- |
| `FROM_EMAIL` | `Preach <onboarding@resend.dev>` | Sender once your domain is verified in Resend |
| `FEEDBACK_EMAIL` | (required for email) | Comma-separate several recipients (verified domain needed for non-owner addresses) |
| `XAI_MODEL` | `grok-4.7` | Grok model for grading |
| `XAI_REASONING_EFFORT` | `medium` | `low` / `medium` / `high` / `none` (faster vs deeper) |
| `XAI_STT_MODEL` | `grok-voice-transcribe-2.0` | Speech-to-text model |
| `REVIEW_URL` | `https://pastorontherun.github.io/preach/review.html` | Link in the email |
| `FEEDBACK_TIMEZONE` | `America/New_York` | Date shown in the email |

### Limits
Edge Functions have a wall-clock limit per run of **150 s on the Free plan (400 s on paid)**, and background work started
with `EdgeRuntime.waitUntil` must finish inside it. That's why transcription and grading run in **separate** invocations,
each with its own budget. A long sermon normally transcribes well within that, but if a run is killed the recording
stays `processing`; after 15 minutes anyone can tap **Retry feedback** (preacher) or **Run AI feedback** (you), and an
existing transcript is reused. Recordings are capped at 50 MB by the bucket (~90 min); xAI accepts up to 500 MB.
