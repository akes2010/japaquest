# 🚀 Deploying JapaQuest on Truehost (shared hosting / cPanel)

This app is a **Node.js (Express) server** with a file-based SQLite database (sql.js) — it runs fine on shared hosts that support Node.js apps (Truehost cPanel → *Setup Node.js App*). No root, no Docker needed.

---

## 1. What you need

- A Truehost plan with **Node.js support** (cPanel → look for *"Setup Node.js App"* — if you can't find it, ask Truehost support to enable Node on your plan)
- Your domain (e.g. `japaquest.com`) pointed to the hosting account
- SSH access (optional but much easier; Truehost provides it on most plans)

---

## 2. Upload the code

**Option A — Git (recommended):** in cPanel → Terminal:
```bash
cd ~/apps          # or wherever you keep apps
git clone <your-repo-url> japaquest
cd japaquest
```

**Option B — File Manager:** zip the project (without `node_modules/`, `data/`, `.env`) and upload + extract in cPanel File Manager.

---

## 3. Create the Node.js app in cPanel

1. cPanel → **Setup Node.js App** → *Add Application*
2. **Node.js version:** 18 or newer
3. **Application mode:** Production
4. **Application root:** the folder you uploaded to (e.g. `japaquest`)
5. **Application URL:** your domain (e.g. `japaquest.com`)
6. **Application startup file:** `server.js`
7. Click **Create**

---

## 4. Install dependencies & configure

In cPanel Terminal (or the "Run NPM Install" button on the Node.js app page):

```bash
cd ~/apps/japaquest
npm install --omit=dev
cp .env.example .env
nano .env    # or edit in File Manager
```

**Minimum `.env` for production:**
```ini
PORT=4001            # must match the port cPanel assigns/shows for the app
NODE_ENV=production
JWT_SECRET=<64-char random hex — see .env.example for the generator>
APP_URL=https://japaquest.com
CRON_SECRET=<random hex — enables the /api/cron/tick endpoint>

# At least one AI key (OpenRouter has free models):
OPENROUTER_API_KEY=sk-or-v1-...
```

⚠️ **Port:** cPanel's Node.js app usually proxies your domain to the app — use the port cPanel shows on the app page. If cPanel didn't assign one, keep `PORT=4001`.

---

## 5. Start the app

In the cPanel **Setup Node.js App** page click **Start** (or via terminal: `npm run start:prod`).

`npm run start:prod` runs a pre-flight check first: installs dependencies if missing, warns about weak/missing secrets (JWT_SECRET, AI keys), verifies `data/` is writable, then boots in production mode. `npm start` skips the checks if you prefer.

First boot creates the database and the admin account — the log/banner shows the credentials:

```
Admin: admin@jagaguru.ai / Admin@1234!
```

**Change that password immediately** (Dashboard → Profile → Change Password) and set your real **Admin → System Settings** (app name, tagline — defaults are already `JapaQuest / Your Journey. Our Intelligence.`). The prod start script (`npm run start:prod`) auto-tightens `.env` to `chmod 600` on boot, and prints the recommended cron lines for schedulers and the nightly DB backup.

---

## 6. Keep data private

The SQLite database and uploaded documents live under `data/` — never serve or commit them. Confirm `.gitignore` includes `data/`. The wallet download endpoint authenticates every file, so uploaded passports are safe from public URLs.

---

## 7. Cron: reminders, schedulers & nightly backups on shared hosting

On a VPS the schedulers run inside the app. On shared hosting, sleeping processes or restarts can pause them — so JapaQuest exposes **two secured tick endpoints**. In cPanel → **Cron Jobs**, add:

```cron
# Schedulers — social posting + journey reminders, every 10 minutes
*/10 * * * * curl -s "https://japaquest.com/api/cron/tick?key=YOUR_CRON_SECRET" > /dev/null 2>&1

# Nightly database backup — snapshots the live SQLite file to your home dir
30 3 * * * curl -s "https://japaquest.com/api/cron/backup?key=YOUR_CRON_SECRET" -o ~/backups/japaquest-$(date +\%Y\%m\%d).db
```

(For the backup line, run `mkdir -p ~/backups` once first. Both endpoints refuse to run without the secret — 401/503.)

Every 10 minutes the tick endpoint runs both schedulers. The backup endpoint flushes the in-memory database and returns the exact file, with an `X-Row-Counts` header (e.g. `users=42;payments=7;conversations=310`) so a wiped or corrupt database is caught before it overwrites yesterday's good backup — if `users=0` appears in your cron log, restore from the previous night instead of letting it roll on. Without the secret both endpoints refuse to run (401/503).

### Admin backup panel & restore

For one-off copies or an on-server archive, use **Admin → Backup & Restore**: create/download/delete snapshots of the live database, or upload a `.db` file to restore it. Restoring archives the pre-restore database to `data/backups/pre-restore-*.db` first, validates the uploaded file (SQLite header + integrity check + required tables), and hot-swaps the running app — no restart needed. For unattended copies the cron above still writes straight to `~/backups/`; the two approaches complement each other.

Uptime monitors should also watch **`/api/health`**: it now reports an `integrity` block (`status`, `db_bytes`, `row_counts`, `quick_check`). Alert on `integrity.status != "ok"` — `suspicious` means a core table is empty (possible wipe), `corrupt` means the database failed its integrity check.

### Uptime monitoring (free, ~10 minutes to set up)

Use [UptimeRobot](https://uptimerobot.com) (free: 50 monitors, 5-min checks) or Better Stack. Create two HTTP monitors:

| Monitor | URL | Type | Alert when |
|---|---|---|---|
| Site up | `https://yourdomain.com/` | HTTP | Status ≠ 200 (uptime) |
| Health & DB | `https://yourdomain.com/api/health` | HTTP (keyword) | Keyword `"status":"ok"` missing |

The second monitor catches more than downtime: `/api/health` returns a top-level `status` of `ok` **only when the database also passes its integrity check**. If the DB is wiped (`users=0`), corrupt (`quick_check` fails) or unreachable, the response is `"status":"degraded"` — the keyword disappears, your monitor alerts, and you can inspect the `integrity` block in the response body (or **Admin → Dashboard**, which shows the same state as a banner). The app also self-reports degraded state via the amber/red banner on the admin dashboard.

**Testing the digest today:** temporarily set `JOURNEY_FORCE_DIGEST=1` in `.env`, restart, hit the tick URL, remove the flag again.

---

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| 503 / app won't start | Check cPanel app log; usually a missing dependency — run `npm install --omit=dev` again inside the app root |
| `EADDRINUSE` | The port is taken — stop the app in cPanel, or change `PORT` in `.env` and the app's port field |
| Domain shows nothing | Application URL mis-mapped in cPanel — point it at the app root + correct port |
| Emails not sending | Set SMTP in **Admin → Email Settings** (see `EMAIL_SETUP_GUIDE.md`), then use 📤 Test |
| AI replies fail | Add an AI key to `.env` (Admin → AI Engine shows provider status) |
| DB resets after restart | `DB_PATH` in `.env` must point to a persistent path like `./data/jagaguru.db` inside the app root — and never delete `data/` |
| "Too many requests" for everyone | The app must see real client IPs behind the proxy — `app.set('trust proxy', 1)` is already set in `server.js`; if you put Cloudflare in front, raise it to `trust proxy, 2` |
| Payment webhook 401s | The gateway secret in **Admin → Payment Gateways** must exactly match the provider dashboard (Paystack signs with your secret key; Flutterwave/OPay use their webhook hash). Webhook URL per provider: `https://yourdomain.com/api/payments/webhooks/<provider>` |
| Crypto payments not appearing | Crypto is **manual**: traveller submits the tx hash, you confirm in **Admin → Payment Gateways → Manual payment confirmations** |
| Affiliate commissions not crediting | The buyer must register through the affiliate's link (30-day cookie) and the affiliate must be **approved**; self-referrals and buyers already attributed to another affiliate are refused by design — check the ⚠️ flag in Admin → Affiliates |

---

## 9. Quick launch checklist

- [ ] Node app created in cPanel and **Started** (`npm run start:prod`)
- [ ] `npm install --omit=dev` completed
- [ ] `.env` has `JWT_SECRET`, `APP_URL`, `CRON_SECRET`, at least one AI key
- [ ] Domain loads the landing page (all 8 suite cards visible)
- [ ] `https://yourdomain.com/api/health` returns `{"status":"ok"}` — point an uptime monitor at it
- [ ] Cron job hitting `/api/cron/tick?key=…` every 10 minutes (section 7)
- [ ] Nightly DB backup cron added and first backup file verified in `~/backups/` (section 7)
- [ ] `.env` chmod 600 (the prod start script does this automatically — verify with `ls -l .env`)
- [ ] Admin password changed from the default
- [ ] SMTP configured + 📤 Test email received
- [ ] cPanel cron added for `/api/cron/tick`
- [ ] Register a test account, run the Journey wizard end-to-end

---

## 9b. Go-live runbook (Truehost, start to finish)

A sequenced version of everything above — do the steps in this order; each one is verifiable before you move on.

**Phase 1 — Provision (cPanel, ~20 min)**
1. Confirm the plan has **Setup Node.js App** (ask Truehost support to enable it if missing).
2. Point the domain's DNS at the hosting account; wait for propagation (check with `ping yourdomain.com`).
3. cPanel → **Setup Node.js App** → Add Application: Node 18+, Production mode, your app root, startup file `server.js`.
4. cPanel → **Terminal**: upload or `git clone` the code into the app root, then `npm install --omit=dev`.
5. `cp .env.example .env`, then generate secrets and fill in the minimum:
   ```bash
   node -e "console.log('JWT_SECRET='+require('crypto').randomBytes(64).toString('hex'))"
   node -e "console.log('CRON_SECRET='+require('crypto').randomBytes(24).toString('hex'))"
   ```
   Set `NODE_ENV=production`, `APP_URL=https://yourdomain.com`, `DB_PATH=./data/jagaguru.db`, at least one AI key. The start script tightens `.env` to 600 on boot.
6. Click **Start** (or `npm run start:prod`). The banner prints the seeded admin login.
7. **Verify:** `curl https://yourdomain.com/api/health` → `"status":"ok"`.

**Phase 2 — Lock down (~15 min)**
1. Log in at `/admin-login` with the seeded credentials and **change the admin password immediately** (Dashboard → Profile).
2. Admin → System Settings: set your real support email and app branding; keep `registration_open` on unless you're invite-only.
3. Confirm `data/` is not web-listable (visit `https://yourdomain.com/` routes only; the DB lives under `data/`, which is never served).

**Phase 3 — Email & schedulers (~15 min)**
1. Admin → Email/SMTP: enter SMTP (Truehost offers built-in email accounts; Gmail needs an app password), send the **📤 Test** email.
2. Add the two cPanel cron jobs from section 7 (`/api/cron/tick` every 10 min, nightly `/api/cron/backup`). `mkdir -p ~/backups` first.
3. **Verify:** next morning, `ls -l ~/backups/` shows a file ≈ the size reported in Admin → Backup & Restore; check its `X-Row-Counts`/health counts are non-zero.

**Phase 4 — Backup & monitoring (~10 min)**
1. In **Admin → Backup & Restore**, click **Create backup now** and download it locally — keep this first off-server copy somewhere safe.
2. Rehearse a restore once *before* launch: upload the file you just downloaded via **Restore from file**; confirm the app reloads intact (it archives the current DB as `pre-restore-*.db` automatically).
3. Set up the two UptimeRobot monitors from the **Uptime monitoring** subsection above.
4. **Verify:** the health monitor shows green; temporarily stop the app in cPanel and confirm you get the alert email, then start it again.

**Phase 5 — Money (section 10, ~30 min)**
1. Paste gateway keys in **Admin → Payment Gateways** (start with Paystack test keys), set webhooks in each provider dashboard, add crypto addresses if used.
2. Run one full test loop: register through an affiliate link → pay via test keys → confirm the plan upgraded, commission credited, emails arrived, and the payment shows in **Admin → Finance Ledger**.
3. Switch gateway keys from test to live only after the test loop passes.
4. Take one more backup snapshot — that's your pre-launch restore point.

**Rollback plan (keep this bookmarked):** if the site misbehaves after launch, grab **Admin → Backup & Restore → Create backup now** first (snapshot the broken state for later analysis), then restore the most recent known-good `snapshot-*.db` or `~/backups/japaquest-YYYY-MM-DD.db` via **Restore from file**. Restart the Node app from cPanel if anything still looks stale.

---

## 10. Payments & affiliate go-live

1. **Gateways** — Admin → Payment Gateways: paste keys for what you actually use
   (Paystack is the usual first choice for NG; Stripe for international cards).
   Secrets fall back to `.env` if left empty here. Commission rate: base `0.30` = 30%.
2. **Performance tiers (optional)** — same page, add rows like `≥10 conversions → 0.35`.
   An affiliate with enough *settled* conversions automatically earns the higher rate.
3. **Webhooks** — in each provider's dashboard set the webhook URL to
   `https://yourdomain.com/api/payments/webhooks/paystack` (or `flutterwave`, `stripe`,
   `opay`). Without this, card payments won't auto-settle — you'd confirm them manually.
4. **Crypto** — paste receiving addresses (USDT TRC-20 etc.). Travellers get the address +
   submit a tx hash; you confirm in **Manual payment confirmations** after checking the chain.
5. **Affiliate program** — link your partners to `https://yourdomain.com/affiliate`.
   They apply, you approve in **Admin → Affiliates**, they share `/r/CODE` links
   (WhatsApp/X/Facebook buttons are built in) and track conversions in their dashboard.
   Payouts: send money via their stated method, then click **Pay** to mark credits paid
   (they get an email).
6. **Test one real loop** — register through an affiliate link, pay ₦100 via Paystack test
   keys, confirm the plan upgraded, the commission credited, and both emails arrived.

