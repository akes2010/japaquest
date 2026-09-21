# ✉️ Email (SMTP) Setup Guide

Japa+ sends **journey reminders** and the **Monday weekly digest** over SMTP. Everything is configured from inside the app — no code changes needed.

## Where to configure

**Admin → Notification Settings → Email / SMTP** — fill in:

| Field | What to put |
|---|---|
| SMTP Host | e.g. `smtp.resend.com` |
| SMTP Port | `587` (or `465` if the provider requires implicit TLS — then also tick *Secure*) |
| SMTP User | usually your API key or username |
| SMTP Password | API key / app password |
| From Name | `Japa+` (or your brand) |
| From Email | a sender on your domain, e.g. `noreply@japaquest.com` |

Then **Save Email Settings**, and verify:
1. **📤 Test** — sends a basic test email.
2. **📅 Sample digest** — sends the exact Monday-digest format (uses your real journeys if the admin account has any; otherwise a labelled sample).

If the toast says `SMTP not configured`, the fields weren't saved — re-save and retry.

## Provider cheat-sheet

### Resend (recommended — 3,000 emails/mo free)
1. Create an account at resend.com and add your domain (or use `onboarding@resend.dev` for testing).
2. **API Keys → Create API Key**.
3. SMTP credentials: host `smtp.resend.com`, port `587`, user `resend`, password = your API key (`re_…`).
4. From Email: `anything@your-verified-domain` (or `onboarding@resend.dev` while testing).

### Brevo (300 emails/day free)
- Host `smtp-relay.brevo.com`, port `587`, user/password from **SMTP & API** page.
- From Email must be a validated sender.

### Gmail (works, but limited)
- Enable 2FA on the Google account, then create an **App Password** (myaccount.google.com/apppasswords).
- Host `smtp.gmail.com`, port `587`, user = full Gmail address, password = the 16-char app password.
- Gmail rewrites/limits From addresses — fine for testing, not ideal for production volume.

### Mailgun / SendGrid
- Mailgun: host `smtp.mailgun.org`, port `587`, user = postmaster credentials from your domain page.
- SendGrid: host `smtp.sendgrid.net`, port `587`, user `apikey`, password = API key with Mail Send permission.

## Enabling the emails

| Toggle | Where | Effect |
|---|---|---|
| **Journey Reminder Emails** | Admin → Notification Settings | task due / overdue / departure / document expiry emails |
| **Weekly Digest Email** | Admin → Notification Settings | Monday digest for all active users (each user can switch it off in Profile → Preferences) |
| **Reminder emails / Weekly digest** | each user's Profile → Preferences | per-user opt-out |

## Testing without waiting for Monday

The digest only runs on Mondays. To test the real scheduled path any day:

```bash
JOURNEY_FORCE_DIGEST=1 npm start
```

(Leave it unset in production.)

## Troubleshooting

- **`SMTP not configured`** — host/user/pass missing; save settings first.
- **`Invalid login` / `535`** — wrong user/pass; for Gmail use an App Password, not the account password.
- **`self signed certificate`** — set port `465` + tick *Secure*, or `587` without secure.
- **Emails send but land in spam** — set up SPF/DKIM/DMARC on japaquest.com per your provider's docs.
- All emails are also logged as in-app notifications, so nothing is lost while SMTP is being fixed.
