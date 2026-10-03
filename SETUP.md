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
2. **Authentication → Sign In / Providers → Email:** make sure Email is enabled. Leave "Confirm email" on.
3. **Email sending (required for preachers).** Supabase's built-in email only delivers to members of your Supabase team, and only about 2 emails per hour. To send to preachers you need your own email sender:
   - Create a free account at https://resend.com (or Postmark) and verify your church's domain.
   - **Authentication → Emails → SMTP Settings** → enable custom SMTP. Resend's values are host `smtp.resend.com`, port `465`, user `resend`, password = your Resend API key. Use a sender like `preach@yourchurch.org`.
   - Optional: **Authentication → Rate Limits** → raise "emails per hour" (the default is 30).
4. **Authentication → Emails → Templates → Magic Link:** add the 6-digit code so preachers using the iPad home-screen app can type it in (on iPhone/iPad, tapping the link opens Safari instead of the app). Replace the body with:
   ```html
   <h2>Sign in to Preach</h2>
   <p><a href="{{ .ConfirmationURL }}">Tap here to sign in</a></p>
   <p>Or type this code in the app: <strong>{{ .Token }}</strong></p>
   ```
   Do the same for the **Confirm signup** template. First-time magic-link users get that email instead.

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
1. Open the app → **Sign in** → enter your email → use the link or code.
2. In Supabase → **SQL Editor**, run this one line (with your email):
   ```sql
   update public.profiles set role = 'admin' where email = 'jake@yourchurch.org';
   ```
3. Reload the app. A **Review** button appears in the header, or go straight to `review.html`.

Everyone else who signs up is a "preacher". Preachers can only see their own sermons and recordings. Admins can see everyone's. Nobody can make themselves an admin from the app.

## 6. Quick test
- [ ] On a second device or browser, sign in as a test preacher, add a sermon, and preach a few pages.
- [ ] Sign in on another device with the same account. The sermon, timer and last page show up within about a minute (or tap the account button → **Sync now**).
- [ ] Record a short test and tap **Send for feedback**. It should say "Sent!"
- [ ] Open `review.html` as Jake. The sermon and recording are listed, the audio plays, and filtering by preacher works.
- [ ] In airplane mode the app still opens and preaches. Changes sync once you're back online.

## Things to know
- **Conflicts:** if the same sermon is edited on two devices while offline, the most recent save wins and the older edit is replaced.
- **Free plan:** files up to 50 MB (about 90 minutes of audio), and the project pauses after a week with no activity. Restore it from the dashboard, or use the Pro plan for a live ministry.
- **Removing a preacher:** Authentication → Users → delete. Their sermons and recordings rows are deleted too. Remove their files in Storage → recordings → their folder.

## Phase 2 (not built yet)
An Edge Function `grade-recording` will transcribe each recording, ask Grok for a summary and grade, fill in `transcript`, `summary`, `grade_json`, set `status = 'graded'`, and email you. The review page already shows those fields once they exist. See the notes at the bottom of `supabase/schema.sql`.
