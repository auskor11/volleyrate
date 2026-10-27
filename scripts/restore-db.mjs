#!/usr/bin/env node
// Put documents back from a backup made by scripts/backup-db.mjs. Safe by default: it only lists what it would
// change. Nothing is written without --apply, and documents created after the backup are never deleted.
//
//   npm run restore -- <backup file>                       compare everything with the live database
//   npm run restore -- <backup file> --only games/<id>     just one document (or a whole collection: --only games)
//   npm run restore -- <backup file> --only games/<id> --apply
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--only');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';
const apply = args.includes('--apply');
if (!file) { console.error('Usage: npm run restore -- <backup file> [--only collection[/doc]] [--apply]'); process.exit(1); }
const backup = JSON.parse(readFileSync(path.resolve(file), 'utf8'));

const fb = path.join(root, 'node_modules', 'firebase-tools', 'lib');
const auth = require(path.join(fb, 'auth.js'));
const cfg = require(path.join(fb, 'configstore.js')).configstore;
const token = (await auth.getAccessToken(cfg.get('tokens').refresh_token, ['https://www.googleapis.com/auth/cloud-platform'])).access_token;
const base = 'https://firestore.googleapis.com/v1/projects/volleyrate-f03aa/databases/(default)/documents';
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

// every document in the backup as [path, fields]
const docs = [];
const walk = (coll, items) => { for (const [id, d] of Object.entries(items)) { docs.push([`${coll}/${id}`, d.fields]); for (const [c, sub] of Object.entries(d.sub ?? {})) walk(`${coll}/${id}/${c}`, sub); } };
for (const [c, items] of Object.entries(backup.collections)) walk(c, items);
const chosen = docs.filter(([p]) => !only || p === only || p.startsWith(`${only}/`));

// compare regardless of key order (Firestore returns map keys in no fixed order)
const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
const equal = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

let same = 0, changed = 0, missing = 0;
for (const [p, fields] of chosen) {
  const r = await fetch(`${base}/${p}`, { headers: H });
  const live = r.status === 404 ? null : (await r.json()).fields ?? {};
  if (live && equal(live, fields)) { same++; continue; }
  live ? changed++ : missing++;
  console.log(`${live ? 'differs' : 'missing'}  ${p}`);
  if (apply) {
    const w = await fetch(`${base}/${p}`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields }) });
    if (!w.ok) console.log(`   FAILED: ${(await w.json()).error?.message}`);
    else console.log('   restored');
  }
}
console.log(`${chosen.length} documents from ${backup.takenAt}: ${same} unchanged, ${changed} differ, ${missing} missing now.${apply ? '' : ' Nothing written (add --apply).'}`);
