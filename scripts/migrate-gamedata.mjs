#!/usr/bin/env node
// One-off: move each game's detector data (peaks, segments, serves, and the same for extra cameras) from the
// game record to gameData/{game id}. Dry run unless --apply. Checks every game can be put back together exactly.
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const apply = process.argv.includes('--apply');
const fb = path.join(root, 'node_modules', 'firebase-tools', 'lib');
const auth = require(path.join(fb, 'auth.js'));
const cfg = require(path.join(fb, 'configstore.js')).configstore;
const token = (await auth.getAccessToken(cfg.get('tokens').refresh_token, ['https://www.googleapis.com/auth/cloud-platform'])).access_token;
const base = 'https://firestore.googleapis.com/v1/projects/volleyrate-f03aa/databases/(default)/documents';
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const HEAVY = ['peaks', 'segments', 'serves'];
const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

const games = (await (await fetch(`${base}/games?pageSize=300`, { headers: H })).json()).documents ?? [];
let moved = 0;
for (const g of games) {
  const id = g.name.split('/').pop(), f = g.fields ?? {};
  const title = f.title?.stringValue ?? id;
  const heavy = {}, angleHeavy = {};
  for (const k of HEAVY) if (f[k]) heavy[k] = f[k];
  const angles = f.angles?.arrayValue?.values ?? [];
  const lightAngles = angles.map(a => {
    const af = a.mapValue?.fields ?? {}, aid = af.id?.stringValue;
    const h = Object.fromEntries(HEAVY.filter(k => af[k]).map(k => [k, af[k]]));
    if (aid && Object.keys(h).length) angleHeavy[aid] = { mapValue: { fields: h } };
    return { mapValue: { fields: Object.fromEntries(Object.entries(af).filter(([k]) => !HEAVY.includes(k))) } };
  });
  if (!Object.keys(heavy).length && !Object.keys(angleHeavy).length) { console.log(`skip   ${title} (nothing to move)`); continue; }
  const data = { ...heavy, ...(Object.keys(angleHeavy).length ? { angles: { mapValue: { fields: angleHeavy } } } : {}) };
  // check: putting the two back together gives exactly the original game
  const back = { ...Object.fromEntries(Object.entries(f).filter(([k]) => !HEAVY.includes(k) && k !== 'angles')), ...heavy,
    ...(f.angles ? { angles: { arrayValue: { values: lightAngles.map(a => { const aid = a.mapValue.fields.id?.stringValue; return { mapValue: { fields: { ...a.mapValue.fields, ...(angleHeavy[aid]?.mapValue.fields ?? {}) } } }; }) } } } : {}) };
  if (!same(back, f)) { console.log(`STOP   ${title}: the split doesn't reproduce the game; not moving it`); continue; }
  const kb = n => `${Math.round(JSON.stringify(n).length / 1024)} KB`;
  console.log(`${apply ? 'move ' : 'would'}  ${title}: ${kb(data)} of detector data (game record ${kb(f)} → ${kb(back) === kb(f) ? '' : ''}${kb({ ...back, ...Object.fromEntries(HEAVY.map(k => [k, undefined])) })})`);
  if (!apply) continue;
  // 1) the detector data into gameData (fails if it already exists, so nothing newer is overwritten)
  const w1 = await fetch(`${base}/gameData?documentId=${id}`, { method: 'POST', headers: H, body: JSON.stringify({ fields: data }) });
  if (!w1.ok) { console.log(`   gameData not written: ${(await w1.json()).error?.message}; game left as it is`); continue; }
  // 2) remove it from the game (fields in the mask but not in the body are deleted)
  const mask = [...HEAVY, ...(f.angles ? ['angles'] : [])].map(k => `updateMask.fieldPaths=${k}`).join('&');
  const w2 = await fetch(`${base}/games/${id}?${mask}&currentDocument.exists=true`, { method: 'PATCH', headers: H,
    body: JSON.stringify({ fields: f.angles ? { angles: { arrayValue: { values: lightAngles } } } : {} }) });
  if (!w2.ok) { console.log(`   game not trimmed: ${(await w2.json()).error?.message} (the data is in both places; harmless)`); continue; }
  moved++;
}
console.log(apply ? `Moved ${moved} games.` : 'Dry run: nothing written. Add --apply to move.');
