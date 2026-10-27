#!/usr/bin/env node
// Copy the whole VolleyRate database (every collection and sub-collection) to private/backups/ on this Mac.
// Read-only: nothing in Firebase changes. Values are kept exactly as Firestore stores them, so a backup can be
// restored as-is (scripts/restore-db.mjs). Keeps the newest 26 backups (about half a year of weekly runs).
//
//   npm run backup              (also runs weekly on its own: see docs/backups.md)
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = path.join(root, 'private', 'backups');
const require = createRequire(import.meta.url);
const KEEP = 26;

const fb = path.join(root, 'node_modules', 'firebase-tools', 'lib');
const auth = require(path.join(fb, 'auth.js'));
const cfg = require(path.join(fb, 'configstore.js')).configstore;
const refresh = cfg.get('tokens')?.refresh_token;
if (!refresh) { console.error('Not logged in to Firebase. Run: npx firebase login'); process.exit(1); }
const token = (await auth.getAccessToken(refresh, ['https://www.googleapis.com/auth/cloud-platform'])).access_token;
const base = 'https://firestore.googleapis.com/v1/projects/volleyrate-f03aa/databases/(default)/documents';
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function call(url, init) {
  const r = await fetch(url, { headers: H, ...init });
  const j = await r.json();
  if (!r.ok) throw new Error(`${url}: ${j.error?.message ?? r.status}`);
  return j;
}
const collectionIds = async docPath => (await call(`${base}${docPath}:listCollectionIds`, { method: 'POST', body: JSON.stringify({ pageSize: 300 }) })).collectionIds ?? [];

/** Every document in a collection, with its sub-collections, as { id: { fields, sub: { name: {...} } } }. */
async function dumpCollection(collPath) {
  const out = {};
  let page = '';
  do {
    const j = await call(`${base}${collPath}?pageSize=300${page ? `&pageToken=${page}` : ''}`);
    for (const d of j.documents ?? []) {
      const id = d.name.split('/').pop();
      const docPath = `${collPath}/${id}`;
      const sub = {};
      for (const c of await collectionIds(docPath)) sub[c] = await dumpCollection(`${docPath}/${c}`);
      out[id] = { fields: d.fields ?? {}, ...(Object.keys(sub).length ? { sub } : {}) };
    }
    page = j.nextPageToken ?? '';
  } while (page);
  return out;
}

const started = Date.now();
const data = {};
for (const c of await collectionIds('')) data[c] = await dumpCollection(`/${c}`);
const stamp = new Date().toISOString().slice(0, 16).replace(':', '');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `volleyrate-${stamp}.json`);
writeFileSync(file, JSON.stringify({ takenAt: new Date().toISOString(), project: 'volleyrate-f03aa', collections: data }));
const counts = Object.entries(data).map(([c, docs]) => `${c} ${Object.keys(docs).length}`).join(', ');
console.log(`${new Date().toISOString()} backed up ${counts} → ${path.relative(root, file)} (${((Date.now() - started) / 1000).toFixed(1)} s)`);

// keep the newest KEEP backups
const all = readdirSync(dir).filter(f => /^volleyrate-.*\.json$/.test(f)).sort();
for (const f of all.slice(0, Math.max(0, all.length - KEEP))) rmSync(path.join(dir, f));
