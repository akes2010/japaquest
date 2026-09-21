'use strict';
require('dotenv').config();
const path   = require('path');
const fs     = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'jagaguru.db');
let _db = null;

// ── SCHEMA ────────────────────────────────────────────────────────────────────
const SCHEMA = [
  // VisaGuru user-facing tables
  `CREATE TABLE IF NOT EXISTS plans(
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
    price REAL DEFAULT 0, daily_limit INTEGER DEFAULT 10, badge TEXT DEFAULT '',
    models TEXT DEFAULT '["claude"]', features TEXT DEFAULT '[]',
    active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'user', plan_id INTEGER DEFAULT 1,
    country TEXT DEFAULT 'Nigeria', country_flag TEXT DEFAULT '🇳🇬',
    passport_code TEXT DEFAULT 'NG',
    travel_budget TEXT DEFAULT 'medium',
    travel_purpose TEXT DEFAULT 'Tourism',
    avatar TEXT DEFAULT '', status TEXT DEFAULT 'active',
    email_verified INTEGER DEFAULT 1,
    email_opt_out INTEGER DEFAULT 0,
    digest_opt_out INTEGER DEFAULT 0,
    last_login TEXT, created_at TEXT DEFAULT(datetime('now')),
    updated_at TEXT DEFAULT(datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS conversations(
    id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL, title TEXT DEFAULT 'New Conversation',
    model TEXT DEFAULT 'claude', context TEXT DEFAULT '{}',
    created_at TEXT DEFAULT(datetime('now')),
    updated_at TEXT DEFAULT(datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS messages(
    id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER NOT NULL,
    role TEXT NOT NULL, content TEXT NOT NULL, model TEXT DEFAULT '',
    tokens INTEGER DEFAULT 0, created_at TEXT DEFAULT(datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS settings(
    key TEXT PRIMARY KEY, value TEXT DEFAULT '', grp TEXT DEFAULT 'general')`,
  `CREATE TABLE IF NOT EXISTS notifications(
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
    is_global INTEGER DEFAULT 0, title TEXT NOT NULL, message TEXT NOT NULL,
    type TEXT DEFAULT 'info', read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT(datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS usage_log(
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    model TEXT NOT NULL, tokens INTEGER DEFAULT 0,
    date TEXT DEFAULT(date('now')), created_at TEXT DEFAULT(datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS password_resets(
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL, expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0, created_at TEXT DEFAULT(datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS tool_results(
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    tool_type TEXT NOT NULL, title TEXT DEFAULT '',
    input_data TEXT DEFAULT '{}', result_text TEXT DEFAULT '',
    created_at TEXT DEFAULT(datetime('now')))`,

  // ── Japa Visa Intelligence tables ─────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS passports(
    code TEXT PRIMARY KEY, name TEXT NOT NULL, flag TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS destinations(
    code TEXT PRIMARY KEY, name TEXT NOT NULL, flag TEXT NOT NULL,
    region TEXT, capital TEXT, currency TEXT, language TEXT,
    avg_daily_budget_usd REAL, best_months TEXT)`,
  `CREATE TABLE IF NOT EXISTS visa_rules(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    passport_code TEXT NOT NULL REFERENCES passports(code),
    destination_code TEXT NOT NULL REFERENCES destinations(code),
    purpose TEXT NOT NULL DEFAULT 'Tourism',
    current_version_id INTEGER,
    created_at TEXT NOT NULL DEFAULT(datetime('now')),
    UNIQUE(passport_code, destination_code, purpose))`,
  `CREATE TABLE IF NOT EXISTS visa_rule_versions(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visa_rule_id INTEGER NOT NULL REFERENCES visa_rules(id),
    status TEXT NOT NULL CHECK(status IN
      ('visa_free','voa','evisa','eta','visa_required','needs_verification')),
    max_stay TEXT, conditions_json TEXT NOT NULL DEFAULT '[]',
    fees_json TEXT DEFAULT '{}', processing_days TEXT,
    application_method TEXT, official_url TEXT,
    source_authority TEXT, source_tier INTEGER DEFAULT 4,
    workflow_state TEXT NOT NULL DEFAULT 'published',
    confidence TEXT NOT NULL DEFAULT 'recently_reviewed',
    verified_by TEXT, verified_at TEXT, change_reason TEXT,
    effective_from TEXT NOT NULL DEFAULT(datetime('now')),
    effective_until TEXT, next_review_at TEXT,
    created_at TEXT NOT NULL DEFAULT(datetime('now')))`,

  // ── Travel Planning tables ────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS travel_profiles(
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE NOT NULL,
    budget_min_usd REAL DEFAULT 500, budget_max_usd REAL DEFAULT 2000,
    budget_label TEXT DEFAULT 'medium',
    preferred_purposes TEXT DEFAULT '["Tourism"]',
    preferred_regions TEXT DEFAULT '[]',
    travel_style TEXT DEFAULT 'backpacker',
    departure_country TEXT DEFAULT 'Nigeria',
    departure_code TEXT DEFAULT 'NG',
    interests TEXT DEFAULT '[]',
    updated_at TEXT DEFAULT(datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS travel_searches(
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    search_type TEXT NOT NULL,
    query_json TEXT NOT NULL DEFAULT '{}',
    results_json TEXT DEFAULT '[]',
    affiliate_clicks INTEGER DEFAULT 0,
    created_at TEXT DEFAULT(datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS affiliate_clicks(
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
    partner TEXT NOT NULL, link_type TEXT NOT NULL,
    destination TEXT, url TEXT,
    created_at TEXT DEFAULT(datetime('now')))`,

  `CREATE TABLE IF NOT EXISTS social_posts(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    platforms_json TEXT NOT NULL DEFAULT '[]',
    target_countries_json TEXT DEFAULT '[]',
    target_regions_json TEXT DEFAULT '[]',
    link_url TEXT DEFAULT '',
    status TEXT DEFAULT 'draft',
    scheduled_at TEXT,
    posted_at TEXT,
    result_json TEXT DEFAULT '[]',
    created_at TEXT DEFAULT(datetime('now')))`,

  // ── Brain Base — pattern memory + traveller case intelligence ──────────
  `CREATE TABLE IF NOT EXISTS brain_insights(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dedup_key TEXT UNIQUE NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    source TEXT DEFAULT 'system',
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT(datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS journey_cases(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    journey_id INTEGER NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    insight_key TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','dismissed')),
    resolution_notes TEXT DEFAULT '',
    action_taken_json TEXT DEFAULT '{}',
    detected_at TEXT DEFAULT(datetime('now')),
    resolved_at TEXT)`,

  // ── CONCIERGE — human assistance tickets ────────────────────────────────
  `CREATE TABLE IF NOT EXISTS concierge_tickets(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    subject TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    priority TEXT DEFAULT 'normal' CHECK(priority IN ('urgent','high','normal','low')),
    journey_id INTEGER,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','answered','closed')),
    first_response_at TEXT,
    created_at TEXT DEFAULT(datetime('now')),
    updated_at TEXT DEFAULT(datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS concierge_replies(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES concierge_tickets(id) ON DELETE CASCADE,
    author_role TEXT NOT NULL CHECK(author_role IN ('user','agent')),
    author_name TEXT DEFAULT '',
    body TEXT NOT NULL,
    file_name TEXT DEFAULT '',
    file_path TEXT DEFAULT '',
    file_size INTEGER DEFAULT 0,
    file_mime TEXT DEFAULT '',
    created_at TEXT DEFAULT(datetime('now')))`,

  // ── Japa Journey OS — smart trip execution system ────────────────────────
  `CREATE TABLE IF NOT EXISTS journeys(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    destination_code TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'Tourism',
    departure_date TEXT,
    return_date TEXT,
    travellers INTEGER DEFAULT 1,
    budget_usd REAL,
    status TEXT NOT NULL DEFAULT 'planning'
      CHECK(status IN ('planning','visa_process','booked','in_transit','completed','cancelled')),
    source_tier INTEGER,
    confidence TEXT,
    visa_status TEXT,
    visa_fee TEXT,
    processing_days TEXT,
    embassy_url TEXT,
    schema_version INTEGER DEFAULT 1,
    dossier_json TEXT,
    risk_json TEXT,
    fee_confidence_usd REAL,
    created_at TEXT DEFAULT(datetime('now')),
    updated_at TEXT DEFAULT(datetime('now')),
    UNIQUE(user_id, destination_code, purpose))`,
  `CREATE TABLE IF NOT EXISTS journey_tasks(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    journey_id INTEGER NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
    phase TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT DEFAULT '',
    offset_days INTEGER,
    deadline TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done')),
    completed_at TEXT,
    sort_order INTEGER DEFAULT 0,
    source TEXT DEFAULT 'template')`,
  `CREATE TABLE IF NOT EXISTS passport_wallet(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    doc_type TEXT NOT NULL,
    doc_number TEXT DEFAULT '',
    holder_name TEXT DEFAULT '',
    issue_date TEXT,
    expiry_date TEXT,
    issuing_country TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    file_name TEXT DEFAULT '',
    file_path TEXT DEFAULT '',
    file_size INTEGER DEFAULT 0,
    file_mime TEXT DEFAULT '',
    created_at TEXT DEFAULT(datetime('now')),
    updated_at TEXT DEFAULT(datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_users_email    ON users(email)`,
  `CREATE INDEX IF NOT EXISTS idx_convs_user     ON conversations(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_msgs_conv      ON messages(conversation_id)`,
  `CREATE INDEX IF NOT EXISTS idx_usage          ON usage_log(user_id,date)`,
  `CREATE INDEX IF NOT EXISTS idx_tools          ON tool_results(user_id,tool_type)`,
  `CREATE INDEX IF NOT EXISTS idx_rules_lookup   ON visa_rules(passport_code,destination_code,purpose)`,
  `CREATE INDEX IF NOT EXISTS idx_travel_user    ON travel_searches(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_affclicks_date ON affiliate_clicks(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_social_status  ON social_posts(status,scheduled_at)`,
  `CREATE INDEX IF NOT EXISTS idx_journeys_user  ON journeys(user_id,status)`,
  `CREATE INDEX IF NOT EXISTS idx_jtasks_journey ON journey_tasks(journey_id,status)`,
  `CREATE INDEX IF NOT EXISTS idx_wallet_user    ON passport_wallet(user_id)`,
];

// ── INIT ──────────────────────────────────────────────────────────────────────
async function initDB() {
  if (_db) return;
  const SQL = await require('sql.js')();
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  if (fs.existsSync(DB_PATH)) {
    _db = new SQL.Database(fs.readFileSync(DB_PATH));
    console.log('  ✅ Loaded existing database');
  } else {
    _db = new SQL.Database();
    console.log('  ✅ Created new database');
  }
  SCHEMA.forEach(s => _db.run(s));
  repairData();
  seedDefaults();
  rebrandLegacy();
  migrateJourneyOS();
  persist();
}

// Rename legacy brand strings that were never customised via the admin panel.
function rebrandLegacy() {
  const LEGACY = {
    app_name:     ['JapaGuru AI', 'VisaGuru AI', 'Japa+'],
    app_tagline:  ['Your African Travel Intelligence Partner', 'Travel smart. Land ready.'],
    smtp_from_name: ['JapaGuru AI', 'VisaGuru AI', 'Japa+'],
    support_email: ['support@jagaguru.ai', 'support@japaplus.app'],
  };
  const NEW = { app_name: 'JapaQuest', app_tagline: 'Your Journey. Our Intelligence.', smtp_from_name: 'JapaQuest', support_email: 'support@japaquest.com' };
  for (const [k, olds] of Object.entries(LEGACY)) {
    const row = queryOne('SELECT value FROM settings WHERE key=?', [k]);
    if (row && olds.includes(row.value)) exec('UPDATE settings SET value=? WHERE key=?', [NEW[k], k]);
  }
}

// ── PERSISTENCE ───────────────────────────────────────────────────────────────
// IMPORTANT: sql.js export() resets last_insert_rowid() to 0. Never persist
// inside exec() — writes are debounced so lastId() stays valid, then flushed.
let _dirty = false;
let _persistTimer = null;
function markDirty() {
  _dirty = true;
  if (_persistTimer) return;
  _persistTimer = setTimeout(() => { _persistTimer = null; persist(); }, 200);
  if (typeof _persistTimer.unref === 'function') _persistTimer.unref();
}
function persist() {
  if (!_db || !_dirty) return;
  _dirty = false;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(_db.export()));
}
function flushSync() { if (_dirty) persist(); }
process.on('exit', flushSync);
['SIGINT', 'SIGTERM'].forEach(sig => process.on(sig, () => { flushSync(); process.exit(0); }));

// ── HELPERS ───────────────────────────────────────────────────────────────────
function exec(sql, params = []) { _db.run(sql, params); markDirty(); }
function queryAll(sql, params = []) {
  const stmt = _db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}
function queryOne(sql, params = []) {
  const stmt = _db.prepare(sql);
  if (params.length) stmt.bind(params);
  let row;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  return row;
}
function queryScalar(sql, params = []) {
  const r = queryOne(sql, params);
  return r ? Object.values(r)[0] : 0;
}
function lastId() { return queryScalar('SELECT last_insert_rowid()'); }

// ── SEED ──────────────────────────────────────────────────────────────────────
// Self-heal databases corrupted by the old persist-inside-exec bug:
// visa_rules rows whose current_version_id was written as 0.
function repairData() {
  const broken = queryScalar(`SELECT COUNT(*) FROM visa_rules
    WHERE current_version_id IS NULL OR current_version_id=0`);
  if (broken > 0) {
    exec(`UPDATE visa_rules SET current_version_id =
      (SELECT MAX(id) FROM visa_rule_versions v WHERE v.visa_rule_id=visa_rules.id)
      WHERE current_version_id IS NULL OR current_version_id=0`);
    console.log(`  🔧 Repaired current_version_id on ${broken} visa rule(s)`);
  }
}

function seedDefaults() {
  // Plans
  if (!queryScalar('SELECT COUNT(*) FROM plans')) {
    [
      [1,'Free','free',0,10,'',JSON.stringify(['claude','deepseek']),JSON.stringify(['10 messages/day','2 AI models','Basic visa guidance','Document checklist'])],
      [2,'Explorer','explorer',4.99,50,'Popular',JSON.stringify(['claude','deepseek','qwen','llama','gemma']),JSON.stringify(['50 messages/day','5 AI models','Full visa tools','Travel planning','Hotel & flight recommendations'])],
      [3,'Voyager','voyager',12.99,200,'Best Value',JSON.stringify(['claude','deepseek','qwen','llama','gemma','mistral','llama-groq','gemini-flash']),JSON.stringify(['200 messages/day','8 AI models','All visa tools','Priority AI responses','Study abroad guidance','Personalised travel plans','Affiliate booking links'])],
      [4,'Unlimited','unlimited',29.99,99999,'Pro',JSON.stringify(['claude','deepseek','qwen','llama','gemma','mistral','llama-groq','gemini-flash','gemini-pro']),JSON.stringify(['Unlimited messages','All 9 AI models','All features','API access','Dedicated support'])],
    ].forEach(([id,name,slug,price,daily,badge,models,features]) =>
      exec(`INSERT OR IGNORE INTO plans(id,name,slug,price,daily_limit,badge,models,features) VALUES(?,?,?,?,?,?,?,?)`,
        [id,name,slug,price,daily,badge,models,features]));
  }

  // Settings
  const DEFAULTS = [
    ['app_name','JapaQuest','general'],['app_tagline','Your Journey. Our Intelligence.','general'],
    ['app_logo','✈','general'],['app_logo_url','','general'],
    ['support_email','support@japaplus.app','general'],
    ['concierge_notify_email','','general'],
    ['notif_email_concierge_user','0','notifications'],
    ['notif_email_concierge_admin','0','notifications'],
    ['app_url','http://localhost:4001','general'],
    ['upload_dir','./data/uploads','general'],
    ['maintenance_mode','0','general'],['registration_open','1','general'],
    ['ai_default_model','claude','ai'],['ai_stream','1','ai'],
    ['ai_max_tokens','1500','ai'],['ai_system_prompt_addon','','ai'],
    ['ai_anthropic_key','','ai'],['ai_openrouter_key','','ai'],
    ['ai_huggingface_key','','ai'],['ai_groq_key','','ai'],
    ['ai_gemini_key','','ai'],['ai_together_key','','ai'],
    ['ai_openai_key','','ai'],['ai_deepseek_key','','ai'],
    ['ai_ollama_url','http://localhost:11434','ai'],
    ['amadeus_client_id','','travel'],['amadeus_client_secret','','travel'],
    ['amadeus_env','test','travel'],
    ['booking_affiliate_id','','affiliates'],['skyscanner_affiliate_id','','affiliates'],
    ['rentalcars_affiliate_id','','affiliates'],['viator_api_key','','affiliates'],
    ['getyourguide_partner_id','','affiliates'],['hostelworld_affiliate_id','','affiliates'],
    ['paystack_secret_key','','payments'],['paystack_public_key','','payments'],
    ['flutterwave_secret_key','','payments'],['flutterwave_public_key','','payments'],
    ['stripe_secret_key','','payments'],['stripe_public_key','','payments'],
    ['smtp_host','','email'],['smtp_port','587','email'],['smtp_secure','0','email'],
    ['smtp_user','','email'],['smtp_pass','','email'],
    ['smtp_from_name','JapaQuest','email'],['smtp_from_email','','email'],
    ['notif_welcome_email','1','notifications'],['notif_new_user_alert','1','notifications'],
    ['notif_usage_alert','1','notifications'],['notif_usage_threshold','80','notifications'],
    ['notif_system_alerts','1','notifications'],
    ['notif_email_reminders','0','notifications'],
    ['notif_email_digest','0','notifications'],
  ];
  DEFAULTS.forEach(([k,v,g]) => exec(`INSERT OR IGNORE INTO settings(key,value,grp) VALUES(?,?,?)`, [k,v,g]));

  // Migrate stale localhost URLs (e.g. app moved off port 4000) to the current port.
  // Only rewrites http://localhost:<port> — real (non-localhost) URLs are left alone.
  try {
    const curUrl = queryOne(`SELECT value FROM settings WHERE key='app_url'`);
    const curPort = parseInt(process.env.PORT) || 4001;
    if (curUrl && curUrl.value && /^http:\/\/localhost:\d+/.test(curUrl.value) && !curUrl.value.includes(`:${curPort}`)) {
      exec(`UPDATE settings SET value=? WHERE key='app_url'`,
        [curUrl.value.replace(/^http:\/\/localhost:\d+(?=\/|$)/, `http://localhost:${curPort}`)]);
    }
  } catch {}

  // Admin user
  if (!queryScalar(`SELECT COUNT(*) FROM users WHERE role='admin'`)) {
    const hash = bcrypt.hashSync('Admin@1234!', 12);
    exec(`INSERT OR IGNORE INTO users(uuid,name,email,password_hash,role,plan_id,status,email_verified)
          VALUES(?,?,?,?,?,?,?,?)`,
      [uuidv4(), 'Admin', 'admin@jagaguru.ai', hash, 'admin', 4, 'active', 1]);
    console.log('  ✅ Admin created: admin@jagaguru.ai / Admin@1234!');
  }

  // Seed visa intelligence data
  seedVisaData();
}

function seedVisaData() {
  if (queryScalar('SELECT COUNT(*) FROM passports') > 0) return;

  const passports = [
    ['NG','Nigeria','🇳🇬'],['GH','Ghana','🇬🇭'],['KE','Kenya','🇰🇪'],['ZA','South Africa','🇿🇦'],
    ['ET','Ethiopia','🇪🇹'],['CM','Cameroon','🇨🇲'],['TZ','Tanzania','🇹🇿'],['UG','Uganda','🇺🇬'],['SN','Senegal','🇸🇳'],
  ];
  passports.forEach(([code,name,flag]) =>
    exec(`INSERT OR IGNORE INTO passports(code,name,flag) VALUES(?,?,?)`, [code,name,flag]));

  const destinations = [
    ['GH','Ghana','🇬🇭','Africa','Accra','GHS','English','50','Nov-Mar'],
    ['BJ','Benin','🇧🇯','Africa','Cotonou','XOF','French','40','Nov-Feb'],
    ['SN','Senegal','🇸🇳','Africa','Dakar','XOF','French','60','Nov-May'],
    ['RW','Rwanda','🇷🇼','Africa','Kigali','RWF','English/French','80','Jun-Sep'],
    ['KE','Kenya','🇰🇪','Africa','Nairobi','KES','English','90','Jan-Feb,Jul-Oct'],
    ['EG','Egypt','🇪🇬','Africa','Cairo','EGP','Arabic','60','Oct-Apr'],
    ['MA','Morocco','🇲🇦','Africa','Rabat','MAD','Arabic/French','70','Mar-May,Sep-Nov'],
    ['AE','United Arab Emirates','🇦🇪','Middle East','Dubai','AED','Arabic','150','Nov-Apr'],
    ['GB','United Kingdom','🇬🇧','Europe','London','GBP','English','180','May-Sep'],
    ['FR','France','🇫🇷','Europe','Paris','EUR','French','150','Apr-Jun,Sep-Oct'],
    ['DE','Germany','🇩🇪','Europe','Berlin','EUR','German','120','May-Sep'],
    ['US','United States','🇺🇸','North America','Washington DC','USD','English','200','Apr-Jun,Sep-Nov'],
    ['CA','Canada','🇨🇦','North America','Ottawa','CAD','English/French','150','Jun-Aug'],
    ['QA','Qatar','🇶🇦','Middle East','Doha','QAR','Arabic','100','Nov-Mar'],
    ['BB','Barbados','🇧🇧','Caribbean','Bridgetown','BBD','English','180','Dec-Apr'],
    ['SC','Seychelles','🇸🇨','Africa','Victoria','SCR','English/French','200','Apr-May,Oct-Nov'],
    ['SG','Singapore','🇸🇬','Asia','Singapore','SGD','English','150','Feb-Apr'],
    ['TR','Türkiye','🇹🇷','Europe','Ankara','TRY','Turkish','80','Apr-May,Sep-Oct'],
    ['TH','Thailand','🇹🇭','Asia','Bangkok','THB','Thai','60','Nov-Mar'],
    ['ID','Indonesia','🇮🇩','Asia','Jakarta','IDR','Indonesian','50','May-Sep'],
    ['NG','Nigeria','🇳🇬','Africa','Abuja','NGN','English','60','Nov-Mar'],
    ['ZA','South Africa','🇿🇦','Africa','Pretoria','ZAR','English','80','May-Sep'],
    ['UG','Uganda','🇺🇬','Africa','Kampala','UGX','English','70','Jun-Aug'],
    ['TZ','Tanzania','🇹🇿','Africa','Dodoma','TZS','Swahili','90','Jun-Oct'],
  ];
  destinations.forEach(([code,name,flag,region,capital,currency,language,budget,months]) =>
    exec(`INSERT OR IGNORE INTO destinations(code,name,flag,region,capital,currency,language,avg_daily_budget_usd,best_months)
          VALUES(?,?,?,?,?,?,?,?,?)`, [code,name,flag,region,capital,currency,language,parseFloat(budget),months]));

  const RULES = [
    ['NG','GH','Tourism','visa_free','90 days',['ECOWAS travel certificate or valid passport','Yellow fever certificate required'],'Ghana Immigration Service',1,'2026-06-02','Free','0-2 days'],
    ['NG','BJ','Tourism','visa_free','90 days',['ECOWAS member — free movement','Yellow fever certificate required'],'Benin Ministry of Interior',1,'2026-05-14','Free','0 days'],
    ['NG','SN','Tourism','visa_free','90 days',['ECOWAS member — free movement'],'Senegal Immigration',1,'2026-04-30','Free','0 days'],
    ['NG','RW','Tourism','visa_free','90 days',['African Union passport policy','Return ticket may be requested'],'Rwanda DGI',1,'2026-07-01','Free','0 days'],
    ['NG','KE','Tourism','eta','90 days',['Electronic Travel Authorization required before departure','Apply at etakenya.go.ke','72-hour approval typical'],'Kenya eTA Portal',1,'2026-07-20','$30','1-3 days'],
    ['NG','EG','Tourism','evisa','30 days',['Apply online at visa2egypt.gov.eg','Passport valid 6+ months'],'Egypt e-Visa Portal',1,'2026-06-18','$25','3-7 days'],
    ['NG','MA','Tourism','visa_required','—',['Apply at nearest Moroccan consulate','Bank statements 3 months','Hotel booking required'],'Consulate of Morocco',1,'2026-03-11','~$50','14-21 days'],
    ['NG','AE','Tourism','visa_required','30 days',['Apply via Emirates/FlyDubai/DNATA or online','Proof of onward travel','Hotel booking','Bank statement'],'UAE FAIC',1,'2026-05-02','~$90','3-5 days'],
    ['NG','GB','Tourism','visa_required','—',['Standard Visitor visa — UK Visas & Immigration','Biometrics appointment required','Bank statements 6 months £3,000+ average','Employment letter + payslips'],'UK UKVI',1,'2026-02-27','£115','3-8 weeks'],
    ['NG','FR','Tourism','visa_required','90 days',['Short-stay Schengen visa','Travel insurance €30,000 minimum','Hotel bookings entire stay','Bank statements 3 months'],'France-Visas TLScontact',1,'2026-01-19','€80','2-4 weeks'],
    ['NG','DE','Tourism','visa_required','90 days',['Schengen visa via German Embassy','Travel insurance mandatory','Bank statements','Employment proof'],'German Embassy',1,'2026-03-15','€80','2-4 weeks'],
    ['NG','US','Tourism','visa_required','—',['B1/B2 visa — in-person interview required','DS-160 form online','MRV fee $185','Strong home ties essential'],'U.S. Embassy Abuja',1,'2026-04-08','$185','2-12 months'],
    ['NG','CA','Tourism','visa_required','—',['TRV — IMM 5257 online','Biometrics CAD$85','Bank statements CAD$10,000+','Employment letter'],'IRCC Canada',1,'2026-05-20','CAD$100+','2-8 weeks'],
    ['NG','QA','Tourism','voa','30 days',['Available on arrival for tourism','Return ticket required','Hotel booking'],'Qatar MoI',1,'2026-06-25','$50-100','On arrival'],
    ['NG','BB','Tourism','visa_free','28 days',['Return ticket recommended','Sufficient funds evidence'],'Barbados Immigration',1,'2026-05-09','Free','0 days'],
    ['NG','SC','Tourism','voa','30 days',['Tourist visit permit on arrival','Proof of accommodation and funds'],'Seychelles Immigration',1,'2026-06-30','~$50','On arrival'],
    ['NG','TR','Tourism','evisa','90 days',['Apply via evisa.gov.tr only','Passport valid 6+ months','Valid email and card'],'Turkey e-Visa',1,'2026-07-05','$60','24-72 hours'],
    ['NG','TH','Tourism','visa_required','—',['Tourist visa 60 days via Thai Embassy','Proof of onward travel','Hotel bookings'],'Royal Thai Embassy',1,'2026-06-10','~$40','7-14 days'],
    ['NG','SG','Tourism','visa_required','—',['eVISA application for selected countries — verify eligibility first','Proof of hotel and funds'],'Singapore ICA',1,'2026-03-22','$30','1-3 days'],

    ['GH','NG','Tourism','visa_free','90 days',['ECOWAS member — free movement'],'Nigeria Immigration Service',1,'2026-06-02','Free','0 days'],
    ['GH','KE','Tourism','eta','90 days',['Electronic Travel Authorization required'],'Kenya eTA Portal',1,'2026-07-20','$30','1-3 days'],
    ['GH','RW','Tourism','visa_free','90 days',['African Union passport policy'],'Rwanda DGI',1,'2026-07-01','Free','0 days'],
    ['GH','GB','Tourism','visa_required','—',['Standard Visitor visa','Biometrics required'],'UK UKVI',1,'2026-02-27','£115','3-8 weeks'],
    ['GH','AE','Tourism','visa_required','30 days',['Tourist visa via airline or sponsor'],'UAE FAIC',1,'2026-05-02','~$90','3-5 days'],
    ['GH','TR','Tourism','evisa','90 days',['Apply via evisa.gov.tr'],'Turkey e-Visa',1,'2026-07-05','$60','24-72 hours'],
    ['GH','QA','Tourism','voa','30 days',['Available on arrival'],'Qatar MoI',1,'2026-06-25','$50','On arrival'],
    ['GH','US','Tourism','visa_required','—',['B1/B2 — interview required','DS-160','$185 MRV fee'],'U.S. Embassy Accra',1,'2026-04-08','$185','2-12 months'],

    ['KE','NG','Tourism','eta','90 days',['Electronic Travel Authorization required before departure'],'Nigeria Immigration Service',1,'2026-07-20','$30','1-3 days'],
    ['KE','GH','Tourism','visa_free','90 days',['African Union passport policy'],'Ghana Immigration Service',1,'2026-06-02','Free','0 days'],
    ['KE','RW','Tourism','visa_free','90 days',['EAC member — free movement'],'Rwanda DGI',1,'2026-07-01','Free','0 days'],
    ['KE','UG','Tourism','visa_free','90 days',['EAC member — free movement'],'Uganda Immigration',1,'2026-06-11','Free','0 days'],
    ['KE','TZ','Tourism','voa','90 days',['EAC nationals — verify current status'],'Tanzania Immigration',1,'2026-05-20','$50','On arrival'],
    ['KE','GB','Tourism','visa_required','—',['Standard Visitor visa required'],'UK UKVI',1,'2026-02-27','£115','3-8 weeks'],
    ['KE','AE','Tourism','voa','30 days',['Visa on arrival — verify eligibility'],'UAE FAIC',1,'2026-05-02','$100','On arrival'],

    ['ZA','GH','Tourism','visa_required','—',['Apply at Ghana High Commission'],'Ghana Immigration Service',1,'2026-02-14','~$50','7-14 days'],
    ['ZA','KE','Tourism','eta','90 days',['Electronic Travel Authorization required'],'Kenya eTA Portal',1,'2026-07-20','$30','1-3 days'],
    ['ZA','GB','Tourism','visa_free','180 days',['No pre-departure visa for standard visits'],'UK UKVI',1,'2026-02-27','Free','0 days'],
    ['ZA','US','Tourism','visa_required','—',['B1/B2 — interview required'],'U.S. Embassy Pretoria',1,'2026-04-08','$185','2-12 months'],
    ['ZA','TR','Tourism','visa_free','90 days',['No pre-departure visa required'],'Turkey MFA',1,'2026-07-05','Free','0 days'],
    ['ZA','AE','Tourism','visa_free','90 days',['No visa required for tourism'],'UAE FAIC',1,'2026-05-02','Free','0 days'],
    ['ZA','FR','Tourism','visa_required','90 days',['Schengen visa required','Travel insurance mandatory'],'France-Visas',1,'2026-01-19','€80','2-4 weeks'],
  ];

  RULES.forEach(([passport,dest,purpose,status,maxStay,conditions,source,tier,verified,fees,processing]) => {
    exec(`INSERT OR IGNORE INTO visa_rules(passport_code,destination_code,purpose) VALUES(?,?,?)`,
      [passport,dest,purpose]);
    const rule = queryOne(`SELECT id FROM visa_rules WHERE passport_code=? AND destination_code=? AND purpose=?`,
      [passport,dest,purpose]);
    if (!rule) return;
    exec(`INSERT INTO visa_rule_versions
      (visa_rule_id,status,max_stay,conditions_json,fees_json,processing_days,
       source_authority,source_tier,workflow_state,confidence,verified_by,verified_at,
       effective_from,next_review_at)
      VALUES(?,?,?,?,?,?,?,?,'published','recently_reviewed','JapaGuru Data Team',?,?,date(?,'+90 day'))`,
      [rule.id,status,maxStay,JSON.stringify(conditions),JSON.stringify({amount:fees||'Varies'}),
       processing,source,tier,verified,verified,verified]);
    const vid = lastId();
    exec(`UPDATE visa_rules SET current_version_id=? WHERE id=?`, [vid, rule.id]);
  });
  console.log('  ✅ Visa intelligence data seeded');
}

// ── Q — Query helpers ─────────────────────────────────────────────────────────
// Column additions for databases created before Journey OS v2 (Brain Base).
function migrateJourneyOS() {
  const alters = [
    ['users', "ALTER TABLE users ADD COLUMN email_opt_out INTEGER DEFAULT 0"],
    ['users', "ALTER TABLE users ADD COLUMN digest_opt_out INTEGER DEFAULT 0"],
    ['users', "ALTER TABLE users ADD COLUMN concierge_emails INTEGER DEFAULT 1"],
    ['users', "ALTER TABLE users ADD COLUMN geo_country TEXT"],
    ['users', "ALTER TABLE users ADD COLUMN geo_currency TEXT"],
    ['users', "ALTER TABLE users ADD COLUMN geo_lang TEXT"],
    ['concierge_tickets', "ALTER TABLE concierge_tickets ADD COLUMN priority TEXT DEFAULT 'normal'"],
    ['concierge_tickets', "ALTER TABLE concierge_tickets ADD COLUMN first_response_at TEXT"],
    ['concierge_replies', "ALTER TABLE concierge_replies ADD COLUMN file_name TEXT DEFAULT ''"],
    ['concierge_replies', "ALTER TABLE concierge_replies ADD COLUMN file_path TEXT DEFAULT ''"],
    ['concierge_replies', "ALTER TABLE concierge_replies ADD COLUMN file_size INTEGER DEFAULT 0"],
    ['concierge_replies', "ALTER TABLE concierge_replies ADD COLUMN file_mime TEXT DEFAULT ''"],
    ['journeys', "ALTER TABLE journeys ADD COLUMN dossier_json TEXT"],
    ['journeys', "ALTER TABLE journeys ADD COLUMN risk_json TEXT"],
    ['journeys', "ALTER TABLE journeys ADD COLUMN fee_confidence_usd REAL"],
    ['passport_wallet', "ALTER TABLE passport_wallet ADD COLUMN file_name TEXT DEFAULT ''"],
    ['passport_wallet', "ALTER TABLE passport_wallet ADD COLUMN file_path TEXT DEFAULT ''"],
    ['passport_wallet', "ALTER TABLE passport_wallet ADD COLUMN file_size INTEGER DEFAULT 0"],
    ['passport_wallet', "ALTER TABLE passport_wallet ADD COLUMN file_mime TEXT DEFAULT ''"],
    ['journey_tasks', "ALTER TABLE journey_tasks ADD COLUMN remind_sent INTEGER DEFAULT 0"],
  ];
  for (const [tbl, sql] of alters) {
    const exists = queryOne(`SELECT 1 FROM pragma_table_info('${tbl}') WHERE name=?`,
      [sql.match(/ADD COLUMN (\w+)/)[1]]);
    if (!exists) { try { exec(sql); } catch {} }
  }
}
const Q = {
  // RAW (read-only helper for workers/tools; prefer named helpers below)
  queryAllSafe: (sql, params = []) => queryAll(sql, params),

  // SETTINGS
  getSetting: (k) => queryOne('SELECT value FROM settings WHERE key=?',[k])?.value ?? '',
  setSetting: (k,v,grp) => {
    if (queryOne('SELECT 1 FROM settings WHERE key=?',[k])) exec('UPDATE settings SET value=? WHERE key=?',[String(v??''),k]);
    else exec('INSERT INTO settings(key,value,grp) VALUES(?,?,?)',[k,String(v??''),grp||'general']);
  },
  setSettings: (obj) => Object.entries(obj).forEach(([k,v]) => Q.setSetting(k, v)),
  getSettingsByGroup: (grp) => queryAll('SELECT key,value FROM settings WHERE grp=?',[grp])
    .reduce((a,r)=>({...a,[r.key]:r.value}),{}),

  // USERS
  getUserByEmail:  (e) => queryOne('SELECT * FROM users WHERE email=?',[e]),
  getUserById:     (id) => queryOne('SELECT * FROM users WHERE id=?',[id]),
  getUserByUUID:   (u) => queryOne('SELECT u.*,p.name as plan_name,p.slug as plan_slug,p.daily_limit,p.models,p.features FROM users u LEFT JOIN plans p ON p.id=u.plan_id WHERE u.uuid=?',[u]),
  createUser:      (data) => {
    exec(`INSERT INTO users(uuid,name,email,password_hash,role,plan_id,country,country_flag,passport_code,status,email_verified)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [data.uuid||uuidv4(),data.name,data.email,data.password_hash,
       data.role||'user',data.plan_id||1,data.country||'Nigeria',
       data.country_flag||'🇳🇬',data.passport_code||'NG','active',1]);
    return lastId();
  },
  updateUser: (id,fields) => {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    const sql = `UPDATE users SET ${keys.map(k=>k+'=?').join(',')},updated_at=datetime('now') WHERE id=?`;
    exec(sql, [...Object.values(fields), id]);
  },
  updateLastLogin: (id) => exec(`UPDATE users SET last_login=datetime('now') WHERE id=?`,[id]),
  deleteUser: (id) => {
    exec('DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id=?)',[id]);
    exec('DELETE FROM conversations WHERE user_id=?',[id]);
    ['tool_results','notifications','usage_log','password_resets','travel_profiles','affiliate_clicks']
      .forEach(t => exec(`DELETE FROM ${t} WHERE user_id=?`,[id]));
    exec('DELETE FROM users WHERE id=?',[id]);
    persist();
  },
  getAllUsers: (page,limit,search) => {
    const off = (page-1)*limit;
    const params = [];
    let w = '';
    if (search) { w = 'AND (u.name LIKE ? OR u.email LIKE ?)'; params.push(`%${search}%`,`%${search}%`); }
    const total = queryScalar(`SELECT COUNT(*) FROM users u WHERE 1=1 ${w}`, params);
    const users = queryAll(`SELECT u.*,p.name as plan_name,p.slug as plan_slug FROM users u LEFT JOIN plans p ON p.id=u.plan_id WHERE 1=1 ${w} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,[...params,limit,off]);
    return { users, total, pages: Math.ceil(total/limit) };
  },

  // PLANS
  getPlans:     () => queryAll('SELECT * FROM plans ORDER BY sort_order,price'),
  getPlanById:  (id) => queryOne('SELECT * FROM plans WHERE id=?',[id]),
  upsertPlan: (p) => {
    exec(`INSERT OR REPLACE INTO plans(id,name,slug,price,daily_limit,badge,models,features,active,sort_order)
          VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [p.id||null,p.name,p.slug,p.price||0,p.daily_limit||10,p.badge||'',
       JSON.stringify(p.models||[]),JSON.stringify(p.features||[]),
       p.active??1,p.sort_order||0]);
  },
  deletePlan: (id) => { exec('UPDATE users SET plan_id=1 WHERE plan_id=?',[id]); exec('DELETE FROM plans WHERE id=?',[id]); persist(); },

  // CONVERSATIONS
  getConversations: (userId,page=1,limit=20) => {
    const off=(page-1)*limit;
    const rows = queryAll(`SELECT c.*,(SELECT COUNT(*) FROM messages WHERE conversation_id=c.id) as msg_count
      FROM conversations c WHERE c.user_id=? ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`,[userId,limit,off]);
    const total = queryScalar('SELECT COUNT(*) FROM conversations WHERE user_id=?',[userId]);
    return { rows, total, pages:Math.ceil(total/limit) };
  },
  getConversation: (uuid,userId) => queryOne('SELECT * FROM conversations WHERE uuid=? AND user_id=?',[uuid,userId]),
  getConversationByUUID: (uuid) => queryOne(`SELECT c.*,u.name as user_name,u.email as user_email
    FROM conversations c JOIN users u ON u.id=c.user_id WHERE c.uuid=?`,[uuid]),
  createConversation: (userId,model='claude') => { const uuid=uuidv4(); exec('INSERT INTO conversations(uuid,user_id,model) VALUES(?,?,?)',[uuid,userId,model]); return uuid; },
  updateConversationTitle: (uuid,title) => exec('UPDATE conversations SET title=?,updated_at=datetime(\'now\') WHERE uuid=?',[title.slice(0,80),uuid]),
  updateConversationContext: (uuid,ctx) => exec('UPDATE conversations SET context=?,updated_at=datetime(\'now\') WHERE uuid=?',[JSON.stringify(ctx),uuid]),
  deleteConversation: (uuid,userId) => { const c=queryOne('SELECT id FROM conversations WHERE uuid=? AND user_id=?',[uuid,userId]); if(c){ exec('DELETE FROM messages WHERE conversation_id=?',[c.id]); exec('DELETE FROM conversations WHERE id=?',[c.id]); persist(); } },
  getMessages: (convId) => queryAll('SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at',[convId]),
  addMessage: (convId,role,content,model='',tokens=0) => exec('INSERT INTO messages(conversation_id,role,content,model,tokens) VALUES(?,?,?,?,?)',[convId,role,content,model,tokens]),
  getAllConversations: (page,limit,search) => {
    const off=(page-1)*limit;
    const params = [];
    let w = '';
    if (search) { w = 'AND (c.title LIKE ? OR u.email LIKE ? OR c.uuid LIKE ?)'; params.push(`%${search}%`,`%${search}%`,`%${search}%`); }
    const total = queryScalar(`SELECT COUNT(*) FROM conversations c JOIN users u ON u.id=c.user_id WHERE 1=1 ${w}`, params);
    const rows = queryAll(`SELECT c.*,u.name as user_name,u.email as user_email,
      (SELECT COUNT(*) FROM messages WHERE conversation_id=c.id) as msg_count
      FROM conversations c JOIN users u ON u.id=c.user_id WHERE 1=1 ${w}
      ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`,[...params,limit,off]);
    return { rows, total, pages:Math.ceil(total/limit) };
  },

  // USAGE
  logUsage: (userId,model,tokens=0) => exec('INSERT INTO usage_log(user_id,model,tokens) VALUES(?,?,?)',[userId,model,tokens]),
  getTodayUsage: (userId) => queryScalar(`SELECT COUNT(*) FROM usage_log WHERE user_id=? AND date=date('now')`,[userId]),
  getUserUsageStats: (userId,days=30) => queryAll(`SELECT date,COUNT(*) as count FROM usage_log WHERE user_id=? AND date>=date('now','-${days} day') GROUP BY date ORDER BY date`,[userId]),
  getAdminStats: () => {
    const signups = queryAll(`SELECT date(created_at) as date,COUNT(*) as count FROM users WHERE created_at>=datetime('now','-30 day') GROUP BY date(created_at) ORDER BY date`);
    const topModels = queryAll(`SELECT model,COUNT(*) as count FROM usage_log GROUP BY model ORDER BY count DESC LIMIT 8`);
    const planDist = queryAll(`SELECT p.name,COUNT(u.id) as count FROM plans p LEFT JOIN users u ON u.plan_id=p.id GROUP BY p.id ORDER BY count DESC`);
    return {
      totalUsers: queryScalar('SELECT COUNT(*) FROM users WHERE role!=?',['admin']),
      today: queryScalar(`SELECT COUNT(*) FROM users WHERE date(created_at)=date('now')`),
      totalConvs: queryScalar('SELECT COUNT(*) FROM conversations'),
      todayMsgs: queryScalar(`SELECT COUNT(*) FROM usage_log WHERE date=date('now')`),
      activeToday: queryScalar(`SELECT COUNT(DISTINCT user_id) FROM usage_log WHERE date=date('now')`),
      totalVisaRules: queryScalar('SELECT COUNT(*) FROM visa_rules'),
      dailySignups: signups, topModels, planDist,
    };
  },

  // NOTIFICATIONS
  getNotifications: (userId) => queryAll(`SELECT * FROM notifications WHERE user_id=? OR is_global=1 ORDER BY created_at DESC LIMIT 50`,[userId]),
  getUnreadCount: (userId) => queryScalar(`SELECT COUNT(*) FROM notifications WHERE (user_id=? OR is_global=1) AND read=0`,[userId]),
  markRead: (id,userId) => exec('UPDATE notifications SET read=1 WHERE id=? AND (user_id=? OR is_global=1)',[id,userId]),
  markAllRead: (userId) => exec('UPDATE notifications SET read=1 WHERE user_id=? OR is_global=1',[userId]),
  createNotification: (userId,title,message,type='info',global=0) =>
    exec('INSERT INTO notifications(user_id,title,message,type,is_global) VALUES(?,?,?,?,?)',[userId,title,message,type,global?1:0]),

  // PASSWORD RESET
  createResetToken: (userId,token,hoursValid=1) =>
    exec(`INSERT INTO password_resets(user_id,token,expires_at) VALUES(?,?,datetime('now', ?))`,[userId,token,`+${hoursValid} hours`]),
  getResetToken: (token) => queryOne(`SELECT * FROM password_resets WHERE token=? AND used=0 AND expires_at>datetime('now')`,[token]),
  useResetToken: (id) => exec('UPDATE password_resets SET used=1 WHERE id=?',[id]),

  // TOOL RESULTS
  saveToolResult: (userId,toolType,title,inputData,resultText) => {
    exec('INSERT INTO tool_results(user_id,tool_type,title,input_data,result_text) VALUES(?,?,?,?,?)',
      [userId,toolType,title,JSON.stringify(inputData||{}),resultText]);
    return lastId();
  },
  getToolResults: (userId,toolType,limit=50) => queryAll(
    `SELECT * FROM tool_results WHERE user_id=?${toolType?' AND tool_type=?':''} ORDER BY created_at DESC LIMIT ?`,
    toolType?[userId,toolType,limit]:[userId,limit]),
  getToolResult: (id,userId) => queryOne('SELECT * FROM tool_results WHERE id=? AND user_id=?',[id,userId]),
  deleteToolResult: (id,userId) => { exec('DELETE FROM tool_results WHERE id=? AND user_id=?',[id,userId]); persist(); },

  // VISA INTELLIGENCE
  getVisaRule: (passport,destination,purpose='Tourism') => {
    const rule = queryOne('SELECT * FROM visa_rules WHERE passport_code=? AND destination_code=? AND purpose=?',
      [passport.toUpperCase(),destination.toUpperCase(),purpose]);
    if (!rule) return null;
    const ver = queryOne('SELECT * FROM visa_rule_versions WHERE visa_rule_id=? ORDER BY id DESC LIMIT 1',[rule.id]);
    return { rule, ver };
  },
  getVisaRulesForPassport: (passport,purpose='Tourism') => queryAll(`
    SELECT vr.*,vrv.status,vrv.max_stay,vrv.conditions_json,vrv.fees_json,vrv.processing_days,
           vrv.source_authority,vrv.confidence,vrv.verified_at,vrv.official_url,
           d.name as dest_name,d.flag as dest_flag,d.region,d.avg_daily_budget_usd,d.best_months
    FROM visa_rules vr
    LEFT JOIN visa_rule_versions vrv ON vrv.id=vr.current_version_id
    JOIN destinations d ON d.code=vr.destination_code
    WHERE vr.passport_code=? AND vr.purpose=?
    ORDER BY vrv.status,d.name`,[passport.toUpperCase(),purpose]),
  getPassports: () => queryAll('SELECT * FROM passports ORDER BY name'),
  getDestinations: () => queryAll('SELECT * FROM destinations ORDER BY name'),
  getDestination: (code) => queryOne('SELECT * FROM destinations WHERE code=?',[code.toUpperCase()]),
  upsertDestination: (d) => {
    const code = String(d.code||'').toUpperCase().trim();
    if (!code || !d.name) return null;
    exec(`INSERT OR REPLACE INTO destinations(code,name,flag,region,capital,currency,language,avg_daily_budget_usd,best_months)
          VALUES(?,?,?,?,?,?,?,?,?)`,
      [code, d.name, d.flag||'🌍', d.region||'Africa', d.capital||'', d.currency||'',
       d.language||'', d.avg_daily_budget_usd ?? null, d.best_months||'']);
    return code;
  },
  upsertVisaRule: (data) => {
    const passport = String(data.passport_code||'').toUpperCase().trim();
    const dest     = String(data.destination_code||'').toUpperCase().trim();
    if (!passport || !dest) return null;
    const purpose = data.purpose || 'Tourism';
    exec('INSERT OR IGNORE INTO visa_rules(passport_code,destination_code,purpose) VALUES(?,?,?)',[passport,dest,purpose]);
    const rule = queryOne('SELECT id FROM visa_rules WHERE passport_code=? AND destination_code=? AND purpose=?',[passport,dest,purpose]);
    if (!rule) return null;
    exec(`INSERT INTO visa_rule_versions
      (visa_rule_id,status,max_stay,conditions_json,fees_json,processing_days,
       source_authority,source_tier,workflow_state,confidence,verified_by,verified_at,
       official_url,effective_from,change_reason)
      VALUES(?,?,?,?,?,?,?,?,'published','recently_reviewed','JapaGuru Editorial',datetime('now'),?,datetime('now'),?)`,
      [rule.id, data.status||'needs_verification', data.max_stay||'',
       JSON.stringify(data.conditions||[]), JSON.stringify(data.fees||{amount:'Varies'}),
       data.processing_days||'', data.source_authority||'JapaGuru Editorial Team',
       parseInt(data.source_tier)||1, data.official_url||'', data.change_reason||'']);
    const vid = lastId();
    exec('UPDATE visa_rules SET current_version_id=? WHERE id=?',[vid,rule.id]);
    return { ruleId: rule.id, versionId: vid };
  },

  // TRAVEL PROFILE
  getTravelProfile: (userId) => queryOne('SELECT * FROM travel_profiles WHERE user_id=?',[userId]),
  upsertTravelProfile: (userId,data) => {
    exec(`INSERT OR REPLACE INTO travel_profiles
      (user_id,budget_min_usd,budget_max_usd,budget_label,preferred_purposes,preferred_regions,travel_style,departure_country,departure_code,interests,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
      [userId,data.budget_min||500,data.budget_max||2000,data.budget_label||'medium',
       JSON.stringify(data.purposes||[]),JSON.stringify(data.regions||[]),
       data.travel_style||'backpacker',data.departure_country||'Nigeria',
       data.departure_code||'NG',JSON.stringify(data.interests||[])]);
  },

  // AFFILIATES
  logAffiliateClick: (userId,partner,linkType,destination,url) =>
    exec('INSERT INTO affiliate_clicks(user_id,partner,link_type,destination,url) VALUES(?,?,?,?,?)',
      [userId,partner,linkType,destination,url]),

  // AFFILIATE CLICK ANALYTICS (admin)
  getAffiliateClickStats: (days=30) => {
    const stats = {};
    stats.total = queryScalar('SELECT COUNT(*) FROM affiliate_clicks');
    stats.last7days = queryScalar("SELECT COUNT(*) FROM affiliate_clicks WHERE created_at >= datetime('now','-7 days')");
    stats.last30days = queryScalar("SELECT COUNT(*) FROM affiliate_clicks WHERE created_at >= datetime('now','-30 days')");
    stats.byPartner = queryAll(
      `SELECT partner, COUNT(*) as clicks,
              SUM(CASE WHEN created_at >= datetime('now','-7 days') THEN 1 ELSE 0 END) as clicks_7d,
              MAX(created_at) as last_click
         FROM affiliate_clicks GROUP BY partner ORDER BY clicks DESC`);
    stats.byType = queryAll(
      'SELECT link_type as type, COUNT(*) as clicks FROM affiliate_clicks GROUP BY link_type ORDER BY clicks DESC');
    stats.daily = queryAll(
      `SELECT date(created_at) as date, COUNT(*) as clicks FROM affiliate_clicks
        WHERE created_at >= datetime('now',?) GROUP BY date(created_at) ORDER BY date`,
      [`-${parseInt(days)||30} days`] );
    stats.topDestinations = queryAll(
      `SELECT destination, COUNT(*) as clicks FROM affiliate_clicks
        WHERE destination IS NOT NULL AND destination != '' AND destination != 'chat'
        GROUP BY destination ORDER BY clicks DESC LIMIT 8`);
    return stats;
  },

  // SOCIAL POSTS (admin marketing)
  createSocialPost: (data) => {
    exec(`INSERT INTO social_posts(title,content,platforms_json,target_countries_json,target_regions_json,link_url,status,scheduled_at)
          VALUES(?,?,?,?,?,?,?,?)`,
      [String(data.title||'').slice(0,150), String(data.content||'').slice(0,3000),
       JSON.stringify(data.platforms||[]), JSON.stringify(data.target_countries||[]),
       JSON.stringify(data.target_regions||[]), String(data.link_url||'').slice(0,500),
       data.status||'draft', data.scheduled_at||null]);
    return lastId();
  },
  updateSocialPost: (id,fields) => {
    const allowed = ['title','content','link_url','status','scheduled_at','posted_at','result_json'];
    const sets=[],params=[];
    for (const k of allowed) if (fields[k]!==undefined) { sets.push(`${k}=?`); params.push(fields[k]); }
    if (fields.platforms!==undefined) { sets.push('platforms_json=?'); params.push(JSON.stringify(fields.platforms)); }
    if (fields.target_countries!==undefined) { sets.push('target_countries_json=?'); params.push(JSON.stringify(fields.target_countries)); }
    if (fields.target_regions!==undefined) { sets.push('target_regions_json=?'); params.push(JSON.stringify(fields.target_regions)); }
    if (!sets.length) return;
    exec(`UPDATE social_posts SET ${sets.join(',')} WHERE id=?`,[...params,id]);
  },
  getSocialPost: (id) => queryOne('SELECT * FROM social_posts WHERE id=?',[id]),
  getSocialPosts: (limit=50) => queryAll(`SELECT * FROM social_posts ORDER BY created_at DESC LIMIT ?`,[limit]),
  getDueSocialPosts: () => queryAll(
    `SELECT * FROM social_posts WHERE status='scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= datetime('now')`),
  deleteSocialPost: (id) => exec('DELETE FROM social_posts WHERE id=?',[id]),

  // ── JOURNEY OS (smart trip execution) ───────────────────────────────────
  createJourney: (userId, data) => {
    exec(`INSERT OR IGNORE INTO journeys(user_id,destination_code,purpose,departure_date,return_date,travellers,budget_usd,
      status,source_tier,confidence,visa_status,visa_fee,processing_days,embassy_url)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [userId, String(data.destination_code||'').toUpperCase(), data.purpose||'Tourism',
       data.departure_date||null, data.return_date||null, parseInt(data.travellers)||1,
       data.budget_usd??null, data.status||'planning', data.source_tier??null,
       data.confidence||null, data.visa_status||null, data.visa_fee||null,
       data.processing_days||null, data.embassy_url||null]);
    return queryOne('SELECT * FROM journeys WHERE user_id=? AND destination_code=? AND purpose=?',
      [userId, String(data.destination_code||'').toUpperCase(), data.purpose||'Tourism']);
  },
  getJourneys: (userId) => queryAll(
    `SELECT j.*, d.name as dest_name, d.flag as dest_flag, d.region
     FROM journeys j LEFT JOIN destinations d ON d.code=j.destination_code
     WHERE j.user_id=? AND j.status!='cancelled' ORDER BY
       CASE WHEN j.departure_date IS NULL THEN 1 ELSE 0 END, j.departure_date, j.created_at DESC`,[userId]),
  getJourney: (id, userId) => queryOne(
    `SELECT j.*, d.name as dest_name, d.flag as dest_flag, d.region, d.currency, d.avg_daily_budget_usd
     FROM journeys j LEFT JOIN destinations d ON d.code=j.destination_code
     WHERE j.id=? AND j.user_id=?`,[id,userId]),
  updateJourney: (id,userId,fields) => {
    const allowed = ['destination_code','purpose','departure_date','return_date','travellers','budget_usd','status'];
    const sets=['updated_at=datetime(\'now\')'],params=[];
    for (const k of allowed) if (fields[k]!==undefined) { sets.push(`${k}=?`); params.push(fields[k]); }
    if (!sets.length) return;
    exec(`UPDATE journeys SET ${sets.join(',')} WHERE id=? AND user_id=?`,[...params,id,userId]);
  },
  deleteJourney: (id,userId) => {
    exec('DELETE FROM journey_tasks WHERE journey_id=?',[id]);
    exec('DELETE FROM journeys WHERE id=? AND user_id=?',[id,userId]); persist();
  },
  // Replace the whole checklist for a journey (regeneration)
  setJourneyTasks: (journeyId, tasks) => {
    exec('DELETE FROM journey_tasks WHERE journey_id=?',[journeyId]);
    for (const [i,t] of (tasks||[]).entries()) {
      exec(`INSERT INTO journey_tasks(journey_id,phase,title,detail,offset_days,deadline,sort_order,source)
        VALUES(?,?,?,?,?,?,?,?)`,
        [journeyId, t.phase, t.title, t.detail||'', t.offset_days??null, t.deadline||null, i, t.source||'template']);
    }
    persist();
  },
  getJourneyTasks: (journeyId) => queryAll(
    `SELECT * FROM journey_tasks WHERE journey_id=? ORDER BY
      CASE WHEN deadline IS NULL THEN 1 ELSE 0 END, deadline, sort_order`,[journeyId]),
  updateJourneyTask: (id,journeyId,status) => exec(
    `UPDATE journey_tasks SET status=?, completed_at=${status==='done' ? "datetime('now')" : 'NULL'} WHERE id=? AND journey_id=?`,
    [status,id,journeyId]),
  getWalletDocs: (userId) => queryAll('SELECT * FROM passport_wallet WHERE user_id=? ORDER BY expiry_date IS NULL, expiry_date',[userId]),
  getWalletDoc: (id,userId) => queryOne('SELECT * FROM passport_wallet WHERE id=? AND user_id=?',[id,userId]),
  upsertWalletDoc: (userId,data) => {
    if (data.id) {
      exec(`UPDATE passport_wallet SET doc_type=?,doc_number=?,holder_name=?,issue_date=?,expiry_date=?,issuing_country=?,notes=?,updated_at=datetime('now') WHERE id=? AND user_id=?`,
        [data.doc_type||'passport',data.doc_number||'',data.holder_name||'',data.issue_date||null,
         data.expiry_date||null,data.issuing_country||'',data.notes||'',data.id,userId]);
      return data.id;
    }
    exec(`INSERT INTO passport_wallet(user_id,doc_type,doc_number,holder_name,issue_date,expiry_date,issuing_country,notes)
      VALUES(?,?,?,?,?,?,?,?)`,
      [userId,data.doc_type||'passport',data.doc_number||'',data.holder_name||'',
       data.issue_date||null,data.expiry_date||null,data.issuing_country||'',data.notes||'']);
    return lastId();
  },
  deleteWalletDoc: (id,userId) => { exec('DELETE FROM passport_wallet WHERE id=? AND user_id=?',[id,userId]); persist(); },

  // ── BRAIN BASE (pattern memory + case intelligence) ────────────────────
  saveBrainInsight: (dedupKey, payload, source='system') => {
    try { exec('INSERT OR IGNORE INTO brain_insights(dedup_key,payload_json,source) VALUES(?,?,?)',
      [String(dedupKey).slice(0,120), JSON.stringify(payload||{}), source]); } catch {}
  },
  getBrainInsight: (dedupKey) => queryOne('SELECT * FROM brain_insights WHERE dedup_key=? AND active=1',[dedupKey]),
  createCase: (journeyId,userId,kind,insightKey,payload) => {
    const open = queryOne(`SELECT id FROM journey_cases WHERE journey_id=? AND kind=? AND status='open'`,[journeyId,kind]);
    if (open) return open.id;
    exec(`INSERT INTO journey_cases(journey_id,user_id,kind,insight_key,payload_json) VALUES(?,?,?,?,?)`,
      [journeyId,userId,kind,insightKey||null,JSON.stringify(payload||{})]);
    return lastId();
  },
  getOpenCase: (journeyId,kind) => queryOne(
    `SELECT * FROM journey_cases WHERE journey_id=? AND kind=? AND status='open' ORDER BY id DESC LIMIT 1`,[journeyId,kind]),
  getOpenCases: (userId) => queryAll(
    `SELECT jc.*, d.name as dest_name, d.flag as dest_flag
     FROM journey_cases jc JOIN journeys j ON j.id=jc.journey_id LEFT JOIN destinations d ON d.code=j.destination_code
     WHERE jc.user_id=? AND jc.status='open' ORDER BY jc.detected_at DESC`,[userId]),
  getCase: (id,userId) => queryOne('SELECT * FROM journey_cases WHERE id=? AND user_id=?',[id,userId]),
  resolveCase: (id,userId,notes,action) => exec(
    `UPDATE journey_cases SET status='resolved', resolution_notes=?, action_taken_json=?, resolved_at=datetime('now') WHERE id=? AND user_id=?`,
    [String(notes||'').slice(0,1000), JSON.stringify(action||{}), id, userId]),
  dismissCase: (id,userId,notes) => exec(
    `UPDATE journey_cases SET status='dismissed', resolution_notes=?, resolved_at=datetime('now') WHERE id=? AND user_id=?`,
    [String(notes||'').slice(0,1000), id, userId]),
  getResolvedCases: (limit=50) => queryAll(
    `SELECT kind, insight_key, resolution_notes, action_taken_json, detected_at, resolved_at
     FROM journey_cases WHERE status='resolved' ORDER BY resolved_at DESC LIMIT ?`,[limit]),
  saveJourneyDossier: (id,userId,json) => exec('UPDATE journeys SET dossier_json=?, updated_at=datetime(\'now\') WHERE id=? AND user_id=?',[json,id,userId]),
  saveJourneyRisk: (id,userId,json) => exec('UPDATE journeys SET risk_json=?, updated_at=datetime(\'now\') WHERE id=? AND user_id=?',[json,id,userId]),
  setTaskRemindSent: (id,sent) => exec('UPDATE journey_tasks SET remind_sent=? WHERE id=?',[sent?1:0,id]),
  setEmailOptOut: (userId,optOut) => exec('UPDATE users SET email_opt_out=?,updated_at=datetime(\'now\') WHERE id=?',[optOut?1:0,userId]),
  setDigestOptOut: (userId,optOut) => exec('UPDATE users SET digest_opt_out=?,updated_at=datetime(\'now\') WHERE id=?',[optOut?1:0,userId]),
  setConciergeEmailsPref: (userId,on) => exec('UPDATE users SET concierge_emails=?,updated_at=datetime(\'now\') WHERE id=?',[on?1:0,userId]),
  setUserGeoPrefs: (userId,updates) => {
    const keys = Object.keys(updates).filter(k => ['geo_country','geo_currency','geo_lang'].includes(k));
    if (!keys.length) return;
    const set = keys.map(k => `${k}=?`).join(',');
    exec(`UPDATE users SET ${set},updated_at=datetime('now') WHERE id=?`, [...keys.map(k => updates[k]), userId]);
  },

  // ── CONCIERGE — human assistance tickets ────────────────────────────────
  createConciergeTicket: (userId, data) => {
    exec(`INSERT INTO concierge_tickets(user_id,subject,category,priority,journey_id)
      VALUES(?,?,?,?,?)`,
      [userId, data.subject || 'Assistance request', data.category || 'general', data.priority || 'normal', data.journey_id || null]);
    return lastId();
  },
  getConciergeTicket: (id, userId) => queryOne(
    `SELECT t.*, u.name as user_name, u.email as user_email
     FROM concierge_tickets t LEFT JOIN users u ON u.id=t.user_id
     WHERE t.id=?${userId ? ' AND t.user_id=?' : ''}`,
    userId ? [id, userId] : [id]),
  getConciergeTickets: (userId) => queryAll(
    `SELECT t.*, (SELECT body FROM concierge_replies r WHERE r.ticket_id=t.id ORDER BY r.id DESC LIMIT 1) as last_reply,
            (SELECT COUNT(*) FROM concierge_replies r WHERE r.ticket_id=t.id) as replies
     FROM concierge_tickets t WHERE t.user_id=? ORDER BY t.updated_at DESC, t.id DESC`,[userId]),
  listConciergeTickets: (status) => queryAll(
    `SELECT t.*, u.name as user_name, u.email as user_email,
            (SELECT body FROM concierge_replies r WHERE r.ticket_id=t.id ORDER BY r.id DESC LIMIT 1) as last_reply,
            (SELECT COUNT(*) FROM concierge_replies r WHERE r.ticket_id=t.id) as replies
     FROM concierge_tickets t LEFT JOIN users u ON u.id=t.user_id
     ${status ? "WHERE t.status='" + String(status).replace(/'/g, "''") + "'" : ''}
     ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'answered' THEN 1 ELSE 2 END, t.updated_at DESC, t.id DESC LIMIT 200`),
  getConciergeReplies: (ticketId) => queryAll(
    'SELECT * FROM concierge_replies WHERE ticket_id=? ORDER BY id',[ticketId]),
  addConciergeReply: (ticketId, authorRole, authorName, body, file) => {
    exec(`INSERT INTO concierge_replies(ticket_id,author_role,author_name,body,file_name,file_path,file_size,file_mime)
      VALUES(?,?,?,?,?,?,?,?)`,
      [ticketId, authorRole, authorName||'', body, file?.file_name || '', file?.file_path || '', file?.file_size || 0, file?.file_mime || '']);
    exec(`UPDATE concierge_tickets SET updated_at=datetime('now') WHERE id=?`,[ticketId]);
    return lastId();
  },
  setConciergeTicketStatus: (id, status) => exec(
    `UPDATE concierge_tickets SET status=?, updated_at=datetime('now') WHERE id=?`,[status,id]),
  setConciergeTicketJourney: (id, journeyId) => exec(
    `UPDATE concierge_tickets SET journey_id=? WHERE id=?`,[journeyId,id]),
  setConciergeTicketPriority: (id, priority) => exec(
    `UPDATE concierge_tickets SET priority=?, updated_at=datetime('now') WHERE id=?`,[priority,id]),
  markConciergeFirstResponse: (id) => exec(
    `UPDATE concierge_tickets SET first_response_at=datetime('now')
     WHERE id=? AND first_response_at IS NULL`,[id]),
  conciergeTicketStats: () => ({
    total: queryScalar('SELECT COUNT(*) FROM concierge_tickets'),
    open: queryScalar("SELECT COUNT(*) FROM concierge_tickets WHERE status='open'"),
    answered: queryScalar("SELECT COUNT(*) FROM concierge_tickets WHERE status='answered'"),
    closed: queryScalar("SELECT COUNT(*) FROM concierge_tickets WHERE status='closed'"),
    slaOpen: queryAll(`SELECT priority, COUNT(*) as count FROM concierge_tickets WHERE status='open' GROUP BY priority`),
    avgFirstResponseMins: queryScalar('SELECT AVG((julianday(first_response_at)-julianday(created_at))*1440) FROM concierge_tickets WHERE first_response_at IS NOT NULL'),
    breachedCount: queryScalar(`SELECT COUNT(*) FROM concierge_tickets t
      WHERE t.status='open' AND t.first_response_at IS NULL
      AND (julianday('now')-julianday(t.created_at))*24 > CASE t.priority WHEN 'urgent' THEN 2 WHEN 'high' THEN 8 WHEN 'low' THEN 72 ELSE 24 END`),
  }),

  // ── ADMIN: Journey/Brain analytics (optionally filterable) ──────────────
  getJourneyStats: (filters = {}) => {
    const clauses = []; const params = [];
    if (filters.user) { clauses.push('(u.email LIKE ? OR u.name LIKE ?)'); const like = `%${filters.user}%`; params.push(like, like); }
    const W = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const byStatus = queryAll(`SELECT j.status, COUNT(*) as count FROM journeys j LEFT JOIN users u ON u.id=j.user_id ${W} GROUP BY j.status ORDER BY count DESC`, params);
    const byDestination = queryAll(`SELECT j.destination_code as code, d.name as name, d.flag as flag, COUNT(*) as journeys,
      SUM(CASE WHEN j.status='completed' THEN 1 ELSE 0 END) as completed
      FROM journeys j LEFT JOIN destinations d ON d.code=j.destination_code LEFT JOIN users u ON u.id=j.user_id
      ${W} GROUP BY j.destination_code ORDER BY journeys DESC LIMIT 10`, params);
    const byPurpose = queryAll(`SELECT j.purpose, COUNT(*) as count FROM journeys j LEFT JOIN users u ON u.id=j.user_id ${W} GROUP BY j.purpose ORDER BY count DESC`, params);
    const total = queryScalar(`SELECT COUNT(*) FROM journeys j LEFT JOIN users u ON u.id=j.user_id ${W}`, params);
    const active = queryScalar(`SELECT COUNT(*) FROM journeys j LEFT JOIN users u ON u.id=j.user_id ${W ? W + ' AND' : 'WHERE'} j.status NOT IN ('completed','cancelled')`, params);
    const upcoming = queryScalar(`SELECT COUNT(*) FROM journeys j LEFT JOIN users u ON u.id=j.user_id ${W ? W + ' AND' : 'WHERE'} j.departure_date IS NOT NULL AND j.departure_date >= date('now') AND j.status != 'cancelled'`, params);
    return { total, active, upcoming, byStatus, byDestination, byPurpose };
  },
  getCaseStats: (filters = {}) => {
    const clauses = []; const params = [];
    if (filters.kind) { clauses.push('jc.kind = ?'); params.push(String(filters.kind)); }
    if (filters.status) { clauses.push('jc.status = ?'); params.push(String(filters.status)); }
    if (filters.user) { clauses.push('(u.email LIKE ? OR u.name LIKE ?)'); const like = `%${filters.user}%`; params.push(like, like); }
    const W = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const kindUserOnly = [filters.kind ? 'jc.kind = ?' : null, filters.user ? '(u.email LIKE ? OR u.name LIKE ?)' : null].filter(Boolean);
    const kindUserParams = [...(filters.kind ? [String(filters.kind)] : []), ...(filters.user ? [`%${filters.user}%`, `%${filters.user}%`] : [])];
    const W2 = kindUserOnly.length ? 'WHERE ' + kindUserOnly.join(' AND ') : '';
    const byKind = queryAll(`SELECT jc.kind, jc.status, COUNT(*) as count FROM journey_cases jc LEFT JOIN users u ON u.id=jc.user_id ${W} GROUP BY jc.kind, jc.status ORDER BY jc.kind, count DESC`, params);
    const openByKind = queryAll(`SELECT jc.kind, COUNT(*) as count FROM journey_cases jc LEFT JOIN users u ON u.id=jc.user_id ${W2 ? W2 + ' AND' : 'WHERE'} jc.status='open' GROUP BY jc.kind ORDER BY count DESC`, kindUserParams);
    const recent = queryAll(`SELECT jc.*, d.name as dest_name, d.flag as dest_flag, u.name as user_name, u.email as user_email
      FROM journey_cases jc
      LEFT JOIN journeys j ON j.id=jc.journey_id
      LEFT JOIN destinations d ON d.code=j.destination_code
      LEFT JOIN users u ON u.id=jc.user_id
      ${W}
      ORDER BY jc.detected_at DESC LIMIT 40`, params);
    const resolvedReports = queryAll(`SELECT jc.kind, jc.insight_key, jc.resolution_notes, jc.action_taken_json, jc.detected_at, jc.resolved_at,
      d.name as dest_name, u.email as user_email
      FROM journey_cases jc
      LEFT JOIN journeys j ON j.id=jc.journey_id
      LEFT JOIN destinations d ON d.code=j.destination_code
      LEFT JOIN users u ON u.id=jc.user_id
      ${W2 ? W2 + ' AND' : 'WHERE'} jc.status='resolved' ORDER BY jc.resolved_at DESC LIMIT 30`, kindUserParams);
    const topInsights = queryAll(`SELECT jc.insight_key, COUNT(*) as uses FROM journey_cases jc LEFT JOIN users u ON u.id=jc.user_id ${W ? W + ' AND' : 'WHERE'} jc.insight_key IS NOT NULL GROUP BY jc.insight_key ORDER BY uses DESC LIMIT 8`, params);
    const total = queryScalar(`SELECT COUNT(*) FROM journey_cases jc LEFT JOIN users u ON u.id=jc.user_id ${W}`, params);
    const open = queryScalar(`SELECT COUNT(*) FROM journey_cases jc LEFT JOIN users u ON u.id=jc.user_id ${W2 ? W2 + ' AND' : 'WHERE'} jc.status='open'`, kindUserParams);
    const reported = queryScalar(`SELECT COUNT(*) FROM journey_cases jc LEFT JOIN users u ON u.id=jc.user_id ${W ? W + ' AND' : 'WHERE'} jc.resolution_notes LIKE 'REPORTED:%'`, params);
    return { total, open, reported, byKind, openByKind, recent, resolvedReports, topInsights };
  },
};

module.exports = { initDB, Q, persist, exec };
