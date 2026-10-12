#!/usr/bin/env node
// Before/after check for changes to how ratings or stats are calculated.
//
//   npm run ratings:snapshot   reads the live games + players (read-only) and saves them, with everyone's
//                              current ratings and stats, to .ratings-check/snapshot.json
//   (change the code)
//   npm run ratings:diff       recomputes from the SAME saved data with the changed code and lists every
//                              player whose overall, attributes or stat counts moved
//
// Because the data is frozen in the snapshot, any difference comes from the code change alone.
// The snapshot holds the team's game data, so it stays out of git (.gitignore).
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const file = path.join(root, '.ratings-check', 'snapshot.json');
const require = createRequire(import.meta.url);

// The app's modules expect a browser; give them just enough to load (nothing here talks to Firebase).
globalThis.location ??= { hostname: 'localhost', pathname: '/' };
globalThis.window ??= globalThis;

/** Load scripts/ratings-core.ts (and the app code it imports) through Vite. */
async function core() {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
  try { return { mod: await vite.ssrLoadModule('/scripts/ratings-core.ts'), close: () => vite.close() }; }
  catch (e) { await vite.close(); throw e; }
}

/** Live games, players and rating settings, read with the Firebase CLI login (read-only). */
async function fetchLive() {
  const fb = path.join(root, 'node_modules', 'firebase-tools', 'lib');
  const auth = require(path.join(fb, 'auth.js'));
  const cfg = require(path.join(fb, 'configstore.js')).configstore;
  const refresh = cfg.get('tokens')?.refresh_token;
  if (!refresh) throw new Error('Not logged in to Firebase. Run: npx firebase login');
  const token = (await auth.getAccessToken(refresh, ['https://www.googleapis.com/auth/cloud-platform'])).access_token;
  const base = 'https://firestore.googleapis.com/v1/projects/volleyrate-f03aa/databases/(default)/documents/';
  const val = v => 'stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue
    : 'booleanValue' in v ? v.booleanValue : 'nullValue' in v ? null : 'timestampValue' in v ? v.timestampValue
    : 'arrayValue' in v ? (v.arrayValue.values || []).map(val)
    : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, val(x)])) : undefined;
  const fields = f => Object.fromEntries(Object.entries(f || {}).map(([k, x]) => [k, val(x)]));
  const get = async p => {
    const r = await fetch(base + p, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    if (!r.ok && r.status !== 404) throw new Error(`Firestore ${p}: ${j.error?.message ?? r.status}`);
    return j;
  };
  const all = async coll => {
    const out = [];
    let page = '';
    do {
      const j = await get(`${coll}?pageSize=300${page ? `&pageToken=${page}` : ''}`);
      for (const d of j.documents || []) out.push({ id: d.name.split('/').pop(), ...fields(d.fields) });
      page = j.nextPageToken || '';
    } while (page);
    return out;
  };
  const conf = await get('config/ratingsEngine');
  // photos aren't needed for the maths and make the file huge
  const players = (await all('players')).map(({ photo: _p, ...rest }) => rest);
  return { games: await all('games'), players, settings: conf.fields ? fields(conf.fields) : null };
}

const commit = () => { try { return execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim() + (execSync('git status --porcelain src', { cwd: root }).toString().trim() ? ' (+ uncommitted changes)' : ''); } catch { return '?'; } };

function report(before, after) {
  const fmt = x => (x === null || x === undefined ? '–' : String(x));
  const lines = [];
  let changed = 0;
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[id], b = after[id];
    if (!a || !b) { lines.push(`  ${(a ?? b).name}: ${a ? 'removed' : 'added'}`); changed++; continue; }
    const diffs = [];
    if (a.overall !== b.overall) diffs.push(`OVERALL ${fmt(a.overall)} → ${fmt(b.overall)} (as ${b.position})`);
    for (const k of new Set([...Object.keys(a.ratings), ...Object.keys(b.ratings)]))
      if (a.ratings[k] !== b.ratings[k]) diffs.push(`${k} ${fmt(a.ratings[k])} → ${fmt(b.ratings[k])}`);
    for (const k of new Set([...Object.keys(a.stats), ...Object.keys(b.stats)]))
      if ((a.stats[k] ?? 0) !== (b.stats[k] ?? 0)) diffs.push(`stat ${k} ${a.stats[k] ?? 0} → ${b.stats[k] ?? 0}`);
    if (diffs.length) { changed++; lines.push(`  ${b.name}:`, ...diffs.map(d => `      ${d}`)); }
  }
  return { changed, lines };
}

const cmd = process.argv[2];
if (cmd === 'snapshot') {
  const data = await fetchLive();
  const { mod, close } = await core();
  const results = mod.compute(data);
  await close();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ takenAt: new Date().toISOString(), commit: commit(), data, results }));
  console.log(`Saved ${data.games.length} games and ${data.players.length} players, computed with ${commit()}.`);
  for (const r of Object.values(results).sort((x, y) => (y.overall ?? -1) - (x.overall ?? -1)))
    console.log(`  ${r.name.padEnd(12)} ${String(r.overall ?? 'NR').padStart(3)}  (${r.position})`);
  console.log('Now change the code, then run: npm run ratings:diff');
} else if (cmd === 'diff') {
  if (!existsSync(file)) { console.error('No snapshot yet. Run: npm run ratings:snapshot (before changing the code)'); process.exit(1); }
  const snap = JSON.parse(readFileSync(file, 'utf8'));
  const { mod, close } = await core();
  const now = mod.compute(snap.data);
  await close();
  const { changed, lines } = report(snap.results, now);
  console.log(`Same data (saved ${snap.takenAt.slice(0, 16).replace('T', ' ')}), code ${snap.commit} → ${commit()}`);
  console.log(changed ? `${changed} player(s) changed:\n${lines.join('\n')}` : 'No changes: every rating and stat is identical.');
} else {
  console.log('Usage: npm run ratings:snapshot   (before a change)\n       npm run ratings:diff       (after it)');
}
