#!/usr/bin/env bash
# Apply the Preach sign-in code email (Magic Link + Confirm signup), 6-digit codes, 10-minute expiry.
# Needs custom SMTP enabled first (Supabase refuses template edits on the Free plan's built-in email).
# Usage: SUPABASE_ACCESS_TOKEN=... ./apply.sh [project_ref]
set -euo pipefail
REF="${1:-bpndhidtxzgjxmrgffyp}"
DIR="$(cd "$(dirname "$0")" && pwd)"
python3 - "$DIR/sign-in-code.html" > /tmp/preach-auth-patch.json <<'PY'
import json, sys
html = open(sys.argv[1]).read()
subj = "Your Preach sign-in code: {{ .Token }}"
print(json.dumps({"mailer_templates_magic_link_content": html, "mailer_templates_confirmation_content": html,
                  "mailer_subjects_magic_link": subj, "mailer_subjects_confirmation": subj,
                  "mailer_otp_length": 6, "mailer_otp_exp": 600}))
PY
code=$(curl -sS -o /tmp/preach-auth-resp.json -w "%{http_code}" -X PATCH "https://api.supabase.com/v1/projects/$REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data @/tmp/preach-auth-patch.json)
if [ "$code" = 200 ]; then echo "Templates applied."; else echo "HTTP $code: $(python3 -c "import json;print(json.load(open('/tmp/preach-auth-resp.json')).get('message'))")"; fi
rm -f /tmp/preach-auth-patch.json /tmp/preach-auth-resp.json
