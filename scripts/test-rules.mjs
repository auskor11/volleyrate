#!/usr/bin/env node
// Tests firestore.rules (the local file, before deploying) against Firebase's rules test service.
// Nothing is read from or written to the real database.   npm run test:rules
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const fb = path.join(root, 'node_modules', 'firebase-tools', 'lib');
const auth = require(path.join(fb, 'auth.js'));
const cfg = require(path.join(fb, 'configstore.js')).configstore;
const token = (await auth.getAccessToken(cfg.get('tokens').refresh_token, ['https://www.googleapis.com/auth/cloud-platform'])).access_token;
const src = readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const D = '/databases/(default)/documents/', TIME = '2026-10-13T10:00:00Z';

// who: null = signed out; { member: role | null (signed in, not on the list), playerId }
const as = (member, playerId = 'zz', email = 'p@x.com') => ({ member, playerId, email });
const guest = null, outsider = as(null, 'zz', 'new@x.com'), viewer = as('viewer'), editor = as('editor'), player = as('player', 'austin'),
  noRole = as(undefined, 'austin'), admin = as('admin');
const cases = [];
const t = (label, who, method, p, expect, next, cur) => cases.push({ label, c: {
  expectation: expect, ...(cur ? { resource: { data: cur } } : {}),
  request: { ...(who ? { auth: { uid: 'u', token: { email: who.email, email_verified: true } } } : {}), path: D + p, method, time: TIME, ...(next ? { resource: { data: next } } : {}) },
  functionMocks: [
    { function: 'exists', args: [{ anyValue: {} }], result: { value: !!who && who.member !== null } },
    { function: 'get', args: [{ anyValue: {} }], result: { value: { data: { playerId: who?.playerId ?? 'zz', ...(who?.member ? { role: who.member } : {}) } } } },
  ],
} });

const game = { title: 'G', rallies: [] }, pl = { name: 'A', number: 7, positions: ['S'], ratings: { spiking: 60 } };
const photo = 'data:image/webp;base64,AAAA', req = { name: 'New', want: 'editor', at: TIME };
// reading
for (const [who, ok] of [[guest, true], [outsider, true], [viewer, true], [admin, true]]) {
  t('read a game', who, 'get', 'games/g1', ok ? 'ALLOW' : 'DENY'); t('list players', who, 'list', 'players/x', 'ALLOW');
}
t('guest reads rating settings', guest, 'get', 'config/ratingsEngine', 'ALLOW');
t('guest reads detector model', guest, 'get', 'config/detector', 'DENY');
for (const c of ['members/x', 'highlights/x', 'games/g1/history/x', 'ratingBackups/x', 'accessRequests/x']) t(`guest lists ${c.split('/')[0]}`, guest, 'list', c, 'DENY');
t('viewer reads highlights', viewer, 'list', 'highlights/x', 'ALLOW');
// editing games, by role
for (const [name, who, edit, create, star] of [['guest', guest, 0, 0, 0], ['outsider', outsider, 0, 0, 0], ['viewer', viewer, 0, 0, 0], ['editor', editor, 1, 0, 0], ['player', player, 1, 1, 1], ['member with no role', noRole, 1, 1, 1], ['admin', admin, 1, 1, 1]]) {
  const R = x => (x ? 'ALLOW' : 'DENY');
  t(`${name}: tag a game`, who, 'update', 'games/g1', R(edit), { ...game, rallies: [1] }, game);
  t(`${name}: write history`, who, 'create', 'games/g1/history/h', R(edit), { at: 1 });
  t(`${name}: add a game`, who, 'create', 'games/g2', R(create), game);
  t(`${name}: add a highlight`, who, 'create', 'highlights/h', R(star), { by: 'p@x.com', playerId: 'a' });
  t(`${name}: change a photo`, who, 'update', 'players/a', R(star), { ...pl, photo, photoBy: 'x' }, pl);
  t(`${name}: delete a game`, who, 'delete', 'games/g1', R(name === 'admin'), null, game);
  t(`${name}: write detector data`, who, 'update', 'gameData/g1', R(edit), { peaks: [1] }, { peaks: [] });
}
t('guest reads detector data', guest, 'get', 'gameData/g1', 'DENY');
t('viewer reads detector data', viewer, 'get', 'gameData/g1', 'ALLOW');
t('player deletes detector data', player, 'delete', 'gameData/g1', 'DENY', null, { peaks: [] });
// players' own profile and photos
t('own positions', player, 'update', 'players/austin', 'ALLOW', { ...pl, positions: ['OH', 'S'] }, pl);
t('own ratings', player, 'update', 'players/austin', 'DENY', { ...pl, ratings: { spiking: 99 } }, pl);
t('bad position', player, 'update', 'players/austin', 'DENY', { ...pl, positions: ['GOD'] }, pl);
t("someone else's positions", player, 'update', 'players/darius', 'DENY', { ...pl, positions: ['OH'] }, pl);
t('photo: svg', player, 'update', 'players/a', 'DENY', { ...pl, photo: 'data:image/svg+xml;base64,AAAA', photoBy: 'S' }, pl);
t('photo: url', player, 'update', 'players/a', 'DENY', { ...pl, photo: 'https://evil.example/x.png', photoBy: 'S' }, pl);
t('photo: too big', player, 'update', 'players/a', 'DENY', { ...pl, photo: 'data:image/webp;base64,' + 'A'.repeat(160000), photoBy: 'S' }, pl);
t('photo + ratings', player, 'update', 'players/a', 'DENY', { ...pl, photo, ratings: { spiking: 99 } }, pl);
t('admin changes ratings', admin, 'update', 'players/a', 'ALLOW', { ...pl, ratings: { spiking: 99 } }, pl);
// access requests
t('outsider asks for access', outsider, 'create', 'accessRequests/new@x.com', 'ALLOW', req);
t('outsider asks to be a player', outsider, 'create', 'accessRequests/new@x.com', 'ALLOW', { ...req, want: 'player', playerId: 'austin', note: 'hi' });
t('outsider asks to be admin', outsider, 'create', 'accessRequests/new@x.com', 'DENY', { ...req, want: 'admin' });
t('outsider sneaks in a role', outsider, 'create', 'accessRequests/new@x.com', 'DENY', { ...req, role: 'admin' });
t('outsider asks for someone else', outsider, 'create', 'accessRequests/other@x.com', 'DENY', req);
t('guest asks for access', guest, 'create', 'accessRequests/new@x.com', 'DENY', req);
t('member asks again', player, 'create', 'accessRequests/p@x.com', 'DENY', req);
t('outsider withdraws own request', outsider, 'delete', 'accessRequests/new@x.com', 'ALLOW', null, req);
t('player lists requests', player, 'list', 'accessRequests/x', 'DENY');
t('admin lists requests', admin, 'list', 'accessRequests/x', 'ALLOW');

const r = await fetch('https://firebaserules.googleapis.com/v1/projects/volleyrate-f03aa:test', {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: src }] }, testSuite: { testCases: cases.map(x => x.c) } }) });
const j = await r.json();
if (j.error || j.issues?.length) { console.log(JSON.stringify(j.error ?? j.issues, null, 1)); process.exit(1); }
const bad = (j.testResults ?? []).map((x, i) => [x.state, cases[i].label]).filter(([s]) => s !== 'SUCCESS');
console.log(`${cases.length - bad.length}/${cases.length} rule checks passed`);
bad.forEach(([, l]) => console.log('FAIL', l));
process.exit(bad.length ? 1 : 0);
