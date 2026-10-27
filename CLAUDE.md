# VolleyRate: notes for coding agents

Ratings and game-film app for a weekly volleyball group (React + Vite + Firebase, project `volleyrate-f03aa`).
Read `README.md` for the layout and `docs/ratings.md` for the rating maths.

## Changing how ratings or stats are calculated
Anything touching `src/lib/engine.ts`, `src/lib/stats.ts`, `src/lib/ratings.ts`, or the rally rules in
`src/lib/games.ts` (`forcedBy`, `assistIndex`, `rallyResult`, …):
1. **Before editing:** `npm run ratings:snapshot` (saves live data + everyone's current numbers).
2. Make the change. The same rule is often applied in more than one place (stats, the rating engine, the
   game page's rally results): search for every use, not just the first.
3. **After editing:** `npm run ratings:diff`. Show the user the result and check that only the players and
   numbers you expected moved. Unexpected changes mean a bug or a missed knock-on effect.
4. Update `docs/ratings.md` (and `README.md` if it mentions the rule) to match the code.

## Deploying
- `npm run build` immediately before `npx firebase deploy --only hosting` (add `,firestore:rules` when the
  rules changed). Then confirm the live bundle contains the change, e.g.
  `curl -s https://volleyrate-f03aa.web.app/ | grep -o 'assets/index-[^"]*\.js'` and grep that file.
- Test Firestore rule changes before deploying them: `npm run test:rules` (add cases to scripts/test-rules.mjs).
- Before changing stored data, back it up: `npm run backup` (see docs/backups.md).

## Data and privacy
- Never commit or deploy `private/` (roster emails) or `.ratings-check/` (a copy of the team's data).
- Owner emails appear only as SHA-256 hashes in code.
- Firestore from the command line is for reading; ask the user before writing their data.

## UI
Two looks, switchable per device: Classic (the original) and Clean (`<html data-ui="clean">`, see the end of
`src/index.css` and `src/lib/theme.ts`). Keep Classic unchanged when restyling; redesign work goes into Clean.
Backup before the redesign: git tag `v1.5-before-ui-redesign`.
