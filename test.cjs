/**
 * S.O.S. — Autonomous Test Suite
 * Run with: node test.js
 * Tests Supabase connectivity, table access, auth logic, and file integrity.
 */

const SUPABASE_URL  = 'https://ktkczqvxoifzosmkaoco.supabase.co';
const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0a2N6cXZ4b2lmem9zbWthb2NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxODcyNDgsImV4cCI6MjA4OTc2MzI0OH0.m5B30L1SiOhlnifRNaKvLP_JEaqy65zGLBM_Nft2bl8';
const fs   = require('fs');
const path = require('path');
const BASE = __dirname;

let pass = 0, fail = 0, warn = 0;

function ok(label)      { console.log(`  ✅  ${label}`); pass++; }
function ko(label, why) { console.log(`  ❌  ${label}${why ? ` — ${why}` : ''}`); fail++; }
function wn(label, why) { console.log(`  ⚠️   ${label}${why ? ` — ${why}` : ''}`); warn++; }

async function sbGet(table, query = 'limit=1') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  return { status: res.status, ok: res.ok, body: await res.text() };
}

// ────────────────────────────────────────────────────────────
console.log('\n╔══════════════════════════════════════════════╗');
console.log('║   S.O.S. AUTOMATED TEST SUITE               ║');
console.log('╚══════════════════════════════════════════════╝\n');

// ── SECTION 1: File Integrity ─────────────────────────────
console.log('【1】 File Integrity');
const requiredFiles = [
  'index.html', 'dashboard.html', 'service_operations.html',
  'discussion_portal.html', 'profile.html',
  'main.js', 'supabase.js', 'style.css', 'tw-config.js',
  'logo.png', 'vite.config.js', '.env',
];
for (const f of requiredFiles) {
  fs.existsSync(path.join(BASE, f)) ? ok(f) : ko(f, 'missing');
}

// ── SECTION 2: HTML Structure Checks ────────────────────
console.log('\n【2】 HTML Element Checks');
const checks = {
  'dashboard.html':          ['ai-fab-btn','ai-chat-panel','ai-input','ai-send-btn','ai-img-btn','ai-img-input'],
  'profile.html':            ['settings-gear-btn','settings-sheet','run-health-check','kb-add-btn','theme-toggle-btn'],
  'service_operations.html': ['form-error-msg','client-name-input','fault-desc-input'],
  'index.html':              ['login-form','email','password','forgot-modal'],
};
for (const [file, ids] of Object.entries(checks)) {
  const html = fs.readFileSync(path.join(BASE, file), 'utf8');
  for (const id of ids) {
    html.includes(`id="${id}"`) ? ok(`${file} → #${id}`) : ko(`${file} → #${id}`, 'missing from HTML');
  }
}

// ── SECTION 3: Theme/Font Script ────────────────────────
console.log('\n【3】 Theme & Font Persistence Scripts');
const pages = ['dashboard.html','service_operations.html','discussion_portal.html','profile.html','index.html'];
for (const p of pages) {
  const html = fs.readFileSync(path.join(BASE, p), 'utf8');
  const hasTheme = html.includes('sos_theme');
  const hasFont  = html.includes('sos_font');
  const hasDark  = html.includes('classList.add("dark")');
  if (hasTheme && hasFont && hasDark) ok(`${p} — theme+font script present`);
  else if (hasTheme && hasDark)       wn(`${p} — theme OK, font script missing`);
  else                                ko(`${p} — theme-apply script missing`);
}

// ── SECTION 4: Logo References ───────────────────────────
console.log('\n【4】 Logo References');
for (const p of pages) {
  const html = fs.readFileSync(path.join(BASE, p), 'utf8');
  if (html.includes('logo.png'))      ok(`${p} → logo.png ✓`);
  else if (html.includes('logo.svg')) wn(`${p} → still uses logo.svg`);
  else                                ko(`${p} → no logo reference`);
}

// ── SECTION 5: Dark Mode CSS ─────────────────────────────
console.log('\n【5】 Dark Mode CSS');
const css = fs.readFileSync(path.join(BASE, 'style.css'), 'utf8');
const darkRules = (css.match(/html\.dark/g) || []).length;
if (darkRules >= 20) ok(`style.css — ${darkRules} dark-mode overrides`);
else if (darkRules > 0) wn(`style.css — only ${darkRules} dark-mode overrides (expect 20+)`);
else ko('style.css — no dark-mode overrides found');

// ── SECTION 6: Supabase Connectivity ────────────────────
console.log('\n【6】 Supabase Table Connectivity');
const tables = ['users','job_cards','parts','logs','announcements','threads','knowledge_base','performance'];

async function runSupabaseTests() {
  for (const table of tables) {
    try {
      const r = await sbGet(table);
      if (r.ok)                                    ok(`${table} → HTTP ${r.status}`);
      else if (r.status === 404 && table === 'knowledge_base')
                                                   wn(`${table} → 404 (run CREATE TABLE SQL in Supabase)`);
      else                                         ko(`${table} → HTTP ${r.status}`, r.body.slice(0,80));
    } catch (e) {
      ko(`${table} → network error`, e.message);
    }
  }

  // ── SECTION 7: Auth Record Check ────────────────────────
  console.log('\n【7】 User Accounts');
  try {
    const r = await sbGet('users', 'select=employee_id,username,role&limit=20');
    if (r.ok) {
      const users = JSON.parse(r.body);
      ok(`users table — ${users.length} account(s) found`);
      const admins = users.filter(u => u.role === 'admin');
      const techs  = users.filter(u => u.role === 'technician');
      admins.length ? ok(`admin accounts: ${admins.map(u=>u.username).join(', ')}`)
                    : ko('no admin account found');
      techs.length  ? ok(`technician accounts: ${techs.length} (${techs.map(u=>u.username).join(', ')})`)
                    : wn('no technician accounts found');
    } else {
      ko('users table query failed', `HTTP ${r.status}`);
    }
  } catch (e) {
    ko('users table query', e.message);
  }

  // ── SECTION 8: Data Isolation Logic ─────────────────────
  console.log('\n【8】 Data Isolation (supabase.js logic check)');
  const sb = fs.readFileSync(path.join(BASE, 'supabase.js'), 'utf8');
  sb.includes('if (!global)') && sb.includes('technician_id=eq.')
    ? ok('JobCards.list — global=false always filters by technician_id')
    : ko('JobCards.list — data isolation logic missing or broken');

  // ── SECTION 9: Error Boundaries ─────────────────────────
  console.log('\n【9】 Error Boundaries (main.js)');
  const main = fs.readFileSync(path.join(BASE, 'main.js'), 'utf8');
  main.includes('safeInit') ? ok('safeInit wrapper present') : ko('safeInit missing');
  main.includes('showErrorToast') ? ok('showErrorToast present') : ko('showErrorToast missing');
  main.includes('healthCheck') ? ok('healthCheck wired in admin panel') : ko('healthCheck not used');

  // ── SECTION 10: AI Proxy Config ──────────────────────────
  console.log('\n【10】 AI / Vite Proxy Config');
  const vite = fs.readFileSync(path.join(BASE, 'vite.config.js'), 'utf8');
  vite.includes('/api/claude') ? ok('Vite proxy configured for Claude API') : ko('Claude proxy missing from vite.config.js');
  const env = fs.existsSync(path.join(BASE, '.env')) ? fs.readFileSync(path.join(BASE, '.env'), 'utf8') : '';
  env.includes('ANTHROPIC_API_KEY') ? ok('.env — ANTHROPIC_API_KEY set') : wn('.env — ANTHROPIC_API_KEY not set (AI disabled)');

  // ── SUMMARY ──────────────────────────────────────────────
  const total = pass + fail + warn;
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log(`║  RESULTS: ${pass}/${total} passed · ${fail} failed · ${warn} warnings`.padEnd(47) + '║');
  const readiness = fail === 0 ? '🟢 READY FOR TEAM TESTING' : fail <= 3 ? '🟡 MOSTLY READY — fix failures above' : '🔴 NOT READY — too many failures';
  console.log(`║  ${readiness}`.padEnd(47) + '  ║');
  console.log('╚══════════════════════════════════════════════╝\n');
  process.exit(fail > 0 ? 1 : 0);
}

runSupabaseTests().catch(e => { console.error('Test runner crashed:', e); process.exit(2); });
