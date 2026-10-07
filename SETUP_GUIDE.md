# 🚀 JapaQuest Setup Guide — Truehost Shared Hosting or VPS

JapaQuest is a Node.js (Express) app with an in-file SQLite database (sql.js). No external database server, no root access, no Docker required — which makes it unusually easy to host. This guide covers both supported paths:

| | **Option A: Truehost / cPanel shared hosting** | **Option B: VPS (Ubuntu + nginx)** |
|---|---|---|
| Skill needed | None (browser + light terminal) | Comfortable with Linux shell |
| Cost | Usually included in your hosting plan | ~$5–10/mo VPS |
| Best for | Fastest path to launch | Full control, custom domains, scaling |
| Time to launch | ~60–90 min | ~45–60 min |

Both paths end at the same place: app running, HTTPS on, backups on a cron, uptime monitoring active. Sections marked **Shared** or **VPS** are path-specific; everything else applies to both.

---

## 0. Requirements (both paths)

- **Node.js 18 or newer** (`node --version` to check)
- A domain (e.g. `japaquest.com`) you can point at the host
- At least one **AI provider API key** (OpenRouter has free models — get one at openrouter.ai/keys)
- Optional but recommended: a **self-hosted AI engine** (Ollama) so Llama/Qwen/DeepSeek run on your own server as the main AI — free per message and no data leaves your box. One-liner: `curl -fsSL https://ollama.ai/install.sh | sh && ollama serve & ollama pull llama3.1`
- An SMTP email account for outgoing mail (Truehost gives you mail accounts; Gmail works via app password — see `EMAIL_SETUP_GUIDE.md`)

---

## 1. Get the code onto the server

**Option A — Git (recommended):**
```bash
git clone <your-repo-url> japaquest
cd japaquest
```

**Option B — Upload:** zip the project **without** `node_modules/`, `data/`, and `.env`, upload via cPanel File Manager (shared) or `scp` (VPS), and extract:
```bash
unzip japaquest.zip -d japaquest && cd japaquest
```

---

## 2. Configure secrets and settings

```bash
cp .env.example .env
```

Edit `.env` (cPanel File Manager editor, `nano .env` on VPS). Minimum for production:

```ini
PORT=4001                          # shared: the port cPanel assigns; VPS: any free port
NODE_ENV=production
APP_URL=https://yourdomain.com     # drives affiliate links, QR codes, payment callbacks
DB_PATH=./data/jagaguru.db         # MUST be inside the app folder (survives redeploys)

# Generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=<64-char random hex>

# Enables /api/cron/tick (schedulers) and /api/cron/backup (nightly DB backup)
# Generate with: node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
CRON_SECRET=<random hex>

# At least one AI provider, e.g.:
OPENROUTER_API_KEY=sk-or-v1-...
```

**Never commit `.env` or the `data/` folder to git** — both are already in `.gitignore`. Payment gateway keys, SMTP credentials, and social media keys can be added later in the admin panel (Admin → Payment Gateways / Email) instead of `.env`.

---

## 3. Shared hosting (Truehost / any cPanel host)

### 3.1 Create the Node.js app
1. cPanel → **Setup Node.js App** → *Add Application*
   - **Node.js version:** 18+
   - **Application mode:** Production
   - **Application root:** your app folder (e.g. `japaquest`)
   - **Application URL:** your domain
   - **Application startup file:** `server.js`
2. Click **Create**, then **Run NPM Install** (or do it in terminal, next step).

> **Create fails with "Cloudlinux NodeJS Selector demands to store node modules … symlink"?** A real `node_modules` folder already sits in the Application root — typically because `npm install` (or `npm run start:prod`, which auto-installs) ran *before* the app was created. CloudLinux reserves that name for its own symlink into the virtual environment. Delete it in File Manager (or `cd ~/japaquest && rm -rf node_modules`), click **Create**, then **Run NPM Install**.

> **"Run NPM Install" says package.json not found?** cPanel looks for `package.json` **directly inside the Application root** — so the code from §1 must be uploaded *before* this step, and `package.json` must sit at `~/<application-root>/package.json`. If your zip extracted into a nested folder (`japaquest/japaquest/`), either move the files up one level or change the Application root to the inner folder. Verify in cPanel → **File Manager**.

> Don't see "Setup Node.js App" in cPanel? Open a ticket with Truehost support and ask them to enable Node.js on your plan — most plans support it.

### 3.2 Install dependencies
Only **after** the app is created in §3.1 — installing first creates a real `node_modules` folder that blocks app creation.
cPanel → **Terminal** (or the app page's npm button):
```bash
cd ~/japaquest            # your application root
npm install --omit=dev
```

### 3.3 Start the app
Click **Start** on the Setup Node.js App page, or run:
```bash
npm run start:prod
```
The start script pre-flights everything: installs dependencies if missing, warns about weak/missing secrets, tightens `.env` to `chmod 600`, verifies `data/` is writable, and prints the recommended cron jobs on boot.

First boot seeds the database and creates the admin account — the log/banner shows:
```
Admin: admin@jagaguru.ai / Admin@1234!
```
**Change this password immediately** — the admin panel has no self-service password form, so use the reset utility from the app folder:
```bash
node reset-admin.js 'you@yourdomain.com' 'YourNewStrongPassword!'
```
It updates the existing admin account in place. (Alternatively, sign in to the main app with the admin account and change it under Profile → 🔒 Change Password.)

### 3.4 Cron jobs (cPanel → Cron Jobs)
```cron
# Schedulers: social posting + journey reminders, every 10 minutes
*/10 * * * * curl -s "https://yourdomain.com/api/cron/tick?key=YOUR_CRON_SECRET" > /dev/null 2>&1

# Nightly database backup to your home directory
30 3 * * * curl -s "https://yourdomain.com/api/cron/backup?key=YOUR_CRON_SECRET" -o ~/backups/japaquest-$(date +\%Y\%m\%d).db
```
Run `mkdir -p ~/backups` once first. The backup response carries an `X-Row-Counts` header — if you ever see `users=0` in a cron log, restore from the previous night instead of letting it roll on (see §6 Troubleshooting).

That's the shared-hosting path done — continue to §5 for first-run setup.

---

## 4. VPS (Ubuntu 22.04/24.04 + nginx)

### 4.1 System packages
```bash
sudo apt update && sudo apt upgrade -y
# Node.js 20 LTS via NodeSource:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx git
sudo apt install -y certbot python3-certbot-nginx   # for HTTPS in 4.4
node --version   # must be >= 18
```

### 4.2 App user + code
```bash
sudo adduser --system --group --home /opt/japaquest japaquest
sudo -iu japaquest
git clone <your-repo-url> /opt/japaquest/app   # or upload the zip here
cd /opt/japaquest/app
cp .env.example .env && nano .env              # per section 2 above
npm install --omit=dev
```

### 4.3 Run it forever (systemd)
```bash
exit   # back to your sudo user
sudo tee /etc/systemd/system/japaquest.service > /dev/null <<'EOF'
[Unit]
Description=JapaQuest
After=network.target

[Service]
Type=simple
User=japaquest
WorkingDirectory=/opt/japaquest/app
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
# Port and other vars come from /opt/japaquest/app/.env (dotenv loads it)

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now japaquest
sudo systemctl status japaquest        # should be active (running)
journalctl -u japaquest -f             # live logs
```

The app listens on `PORT` from `.env` (default 4001). Confirm:
```bash
curl http://localhost:4001/api/health   # → {"status":"ok",...}
```

### 4.4 nginx reverse proxy + HTTPS
```bash
sudo tee /etc/nginx/sites-available/japaquest > /dev/null <<'EOF'
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    client_max_body_size 60m;        # document uploads + DB restore uploads (restore limit: 50 MB)

    location / {
        proxy_pass http://127.0.0.1:4001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 90;
    }
}
EOF
sudo ln -s /etc/nginx/sites-available/japaquest /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# DNS: point yourdomain.com's A record at this VPS IP first, then:
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com   # free HTTPS, auto-renews
```

Point `APP_URL=https://yourdomain.com` in `.env` and restart the app (`sudo systemctl restart japaquest`) so generated links use HTTPS.

### 4.5 Cron jobs
```bash
sudo crontab -u japaquest -e
```
```cron
*/10 * * * * curl -s "https://yourdomain.com/api/cron/tick?key=YOUR_CRON_SECRET" > /dev/null 2>&1
30 3 * * * mkdir -p ~/backups && curl -s "https://yourdomain.com/api/cron/backup?key=YOUR_CRON_SECRET" -o ~/backups/japaquest-$(date +\%Y\%m\%d).db
```

**VPS note:** the in-app schedulers also run on their own on a VPS, so the cron jobs are belt-and-braces — the tick endpoint additionally works as a 10-minute liveness probe.

Continue to §5 for first-run setup.

---

## 5. First-run setup (both paths)

1. **Log in** at `https://yourdomain.com/admin-login` with the seeded admin credentials, then rotate them if you haven't already (see §3.3: `node reset-admin.js`, or Profile → 🔒 Change Password in the main app).
2. **Branding & settings** — Admin → System Settings: app name, tagline, support email (defaults are already JapaQuest-themed).
3. **Email** — Admin → Email/SMTP: enter your SMTP details and send the **📤 Test** email. All system mail (welcome, password reset, digests, affiliate alerts) depends on this.
4. **AI engine** — Admin → AI Engine shows provider status; keys come from `.env`. Set **Default Model: ♾️ Auto — continuous rotation** so every chat spreads across the plan's provider pool: self-hosted engine first, then free gateways (OmniRoute, OpenRouter, Groq, Gemini, Cloudflare Workers AI), with Kimi/z.ai/DeepSeek-direct/OpenAI/Claude joining for paid plans. Rate-limited or failing providers cool down automatically and rejoin — no manual switching. Free plan = free pools only; Voyager/Unlimited unlock premium clouds (pool membership: `utils/ai-rotation.js`). The **Self-Hosted AI Engine** card at the top shows whether Ollama/vLLM/LM Studio is reachable and which model families (llama/qwen/deepseek/…) it serves — "Test engine now" sends a real health-check prompt. Chat is the core product, so verify a test conversation works. If the default model is a self-hosted one (llama-local / qwen-local / deepseek-local), replies come from your own hardware first and fall back to the configured free cloud providers (OpenRouter → Groq → …) whenever the engine is unreachable or can't serve that family.
5. **Payments** — Admin → Payment Gateways: paste keys for what you actually use (Paystack for NG cards, Stripe for international; crypto addresses for USDT/BTC). Set each provider's webhook URL in its dashboard to `https://yourdomain.com/api/payments/webhooks/<provider>` — without webhooks, card payments need manual confirmation.
6. **Take a backup** — Admin → Backup & Restore → **Create backup now**, and download the file locally.
7. **Rehearse a restore once before launch** — upload the file you just downloaded via **Restore from file**. The app archives the pre-restore DB automatically and hot-swaps without a restart. Doing this before you need it is the difference between a 2-minute recovery and a bad night.
8. **Set up monitoring** — two free UptimeRobot checks:
   - `https://yourdomain.com/` — HTTP monitor (downtime)
   - `https://yourdomain.com/api/health` — keyword monitor on `"status":"ok"` (also alerts on database wipe/corruption, since the health endpoint reports degraded when integrity fails)
9. **Smoke test as a real user** — register an account, run the Journey wizard, send one chat message, upgrade the test account through a test-mode payment.

---

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| 503 / app won't start (shared) | Check the cPanel app log; usually missing deps — rerun `npm install --omit=dev` |
| cPanel "Run NPM Install": package.json not found | Code isn't in the Application root yet, or it's nested one level too deep — upload per §1 and confirm `package.json` sits directly in that folder (check in File Manager) |
| App creation fails: "Cloudlinux NodeJS Selector demands to store node modules … symlink" | A real `node_modules` folder is in the app root (install ran before creation, or the zip included it) — delete it, Create the app, then **Run NPM Install** |
| `EADDRINUSE` | Port taken — stop the old instance (cPanel toggle, or `lsof -ti tcp:4001 \| xargs kill` on VPS) or change `PORT` |
| Domain shows nothing (shared) | Application URL mis-mapped in cPanel — point it at the app root + correct port |
| 502 on VPS | `systemctl status japaquest` — app down, or nginx `proxy_pass` port ≠ `PORT` in `.env` |
| DB resets after restart | `DB_PATH` must point inside the app folder on persistent storage — never `/tmp` |
| Emails not sending | Admin → Email/SMTP → 📤 Test; see `EMAIL_SETUP_GUIDE.md` (Gmail needs an app password) |
| `550 … discarded as high-probability spam` | Sender misalignment, not content — From domain must equal the SMTP mailbox domain; use a real cPanel mailbox on your domain, host `mail.<domain>`, and run cPanel → Email Deliverability → Repair (SPF/DKIM) |
| Auto chat: "All AI providers in your plan pool failed — <reasons>" | The error now names each provider's real failure. `Invalid API key` → fix that key in Admin → AI Engine; `Rate limit` → pool auto-retries in ~2 min (add a second free provider like Groq/Gemini to spread load) |
| AI replies fail | No AI key in `.env` — Admin → AI Engine shows which providers are live |
| Payment webhook 401s | The gateway secret in Admin → Payment Gateways must exactly match the provider dashboard |
| Everyone gets "Too many requests" | The app must see real client IPs — `trust proxy` is already set; behind Cloudflare, raise it to `trust proxy, 2` |
| `users=0` in health/backup | Database wiped — restore: Admin → Backup & Restore, or upload the latest `~/backups/japaquest-*.db` |
| Need to migrate hosts | Download a backup (Admin → Backup & Restore), install fresh on the new host, then Restore from file — done |

---

## 7. Launch checklist

- [ ] Node app running (cPanel **Started** / `systemctl status japaquest` active)
- [ ] `https://yourdomain.com/api/health` → `{"status":"ok"}`
- [ ] `.env` has `JWT_SECRET`, `APP_URL`, `CRON_SECRET`, at least one AI key; permissions 600
- [ ] Admin password changed from the default
- [ ] SMTP test email received
- [ ] Both cron jobs added (tick + nightly backup) and first backup file verified
- [ ] One backup downloaded off-server and a restore rehearsed
- [ ] Uptime monitors green (site + health/DB keyword)
- [ ] Test account: Journey wizard, chat, test-mode payment all worked
- [ ] Gateway webhooks configured and a real test payment settled

Full walkthroughs: `DEPLOY_TRUEHOST.md` (§9b has a phased go-live runbook with a rollback plan, §10 covers payments & affiliate go-live).
