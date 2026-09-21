'use strict';
require('dotenv').config();
const path   = require('path');
const fs     = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'jagaguru.db');
const NEW_EMAIL = process.argv[2] || 'admin@jagaguru.ai';
const NEW_PASS  = process.argv[3] || 'Admin@1234!';

async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   Japa+ — Admin Reset Utility           ║');
  console.log('╚══════════════════════════════════════════╝\n');
  if (!fs.existsSync(DB_PATH)) { console.log('❌  Database not found. Run: npm start first.'); process.exit(1); }
  const SQL  = await require('sql.js')();
  const db   = new SQL.Database(fs.readFileSync(DB_PATH));
  const hash = await bcrypt.hash(NEW_PASS, 12);
  const stmt = db.prepare(`SELECT COUNT(*) as n FROM users WHERE role='admin'`);
  stmt.step(); const { n } = stmt.getAsObject(); stmt.free();
  if (parseInt(n) > 0) {
    db.run(`UPDATE users SET email=?,password_hash=?,status='active',updated_at=datetime('now') WHERE role='admin'`, [NEW_EMAIL, hash]);
    console.log('✅  Existing admin updated.');
  } else {
    const { v4: uuidv4 } = require('uuid');
    db.run(`INSERT INTO users(uuid,name,email,password_hash,role,plan_id,status,email_verified) VALUES(?,?,?,?,?,?,?,?)`, [uuidv4(),'Admin',NEW_EMAIL,hash,'admin',4,'active',1]);
    console.log('✅  Admin user created.');
  }
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  db.close();
  console.log(`\n  Email:    ${NEW_EMAIL}`);
  console.log(`  Password: ${NEW_PASS}`);
  console.log(`\n  Go to: http://localhost:${process.env.PORT||4001}/admin-login\n`);
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
