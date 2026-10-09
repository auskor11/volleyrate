# VolleyRate

2K-style player ratings and game film for **Yappy's Bakery**, a 10-player volleyball team.

**Live app:** https://volleyrate-f03aa.web.app. Signing in requires a Google account on the team list.

## What it does

- **Player cards:** 11 attributes in six categories:
  - Attack: Spiking, Setting, Serving
  - Defence: Blocking, Receiving
  - Game Intelligence: Positioning, Adaptability, Reading
  - Consistency
  - Physical
  - Technique

  Each card shows a position-weighted overall and a gold, silver or bronze tier.
- **Game film:**
  - Upload a game as an unlisted YouTube video.
  - Pick the original file on your phone or laptop. The rally detector runs **on that device** and saves only the rally times.
- **Review:** fix the detected rallies (good / not a rally / adjust start and end / add missed ones). Each change is kept in the game's edit history.
- **Touch tagging:** tag every contact (serve → receive → set → attack …) and how each rally ended. Keyboard shortcuts and tap-friendly buttons; AI-suggested touch moments come from contact sounds.
  Before tagging, put both teams on a court view (positions 1–6 and subs). Roles belong to court spots: a set starts 1 OH1, 2 S, 3 MB, 4 OH2, 5 OPP, 6 L, and a clip that starts mid-set is set up by picking the roles at positions 1 and 2. Roles rotate with their spot, so players who swap spots swap roles and a sub takes the role of whoever they replace. While tagging, a third column shows the live rotation: it rotates on each side-out, brings the extra middle blocker on for the libero in the front row (libero back on at the 1 → 6 rotation), and pre-selects the server. Reviewers drag other subs and swaps in; only those hand changes are stored on the rally (`court.manual`) and carry forward, everything else is worked out from the setup (`src/lib/rotation.ts`, `src/components/Court.tsx`).
- **Stats and ratings:**
  - Tagged games produce a box score and per-player stats, with links to the clips.
  - Once the admin applies a game, its stats move the ratings. See **[docs/ratings.md](docs/ratings.md)** for exactly how.
- **Highlights:** bookmark rallies to a player's profile and play them back as a reel.
- **Admin:** roster and access, starting ratings, how sensitive ratings are to stats, rating backups, and retraining the detector.

Everything runs on free tiers: Firebase Spark and YouTube. No servers to pay for.

## Tech

- **App:** React 19, TypeScript, Vite, Tailwind CSS v4, React Router. Installable as a PWA.
- **Firebase:** Auth with Google sign-in, Firestore (asia-southeast1), and Hosting.
- **Detector:** runs in a Web Worker. It decodes the video with WebCodecs and mp4box.js, reads frames through WebGL, finds the yellow ball, adds audio onsets, and passes candidates through a small logistic-regression clip classifier. Built in [`rally-lab/`](rally-lab/).
- **Mobile:** Capacitor is configured (`capacitor.config.ts`) for later Android and iOS builds.

## Getting started

Requires Node 20+.

    npm install
    npm run dev          # http://localhost:5173

- **Sample data without signing in:**
  - `/__preview`: player cards
  - `/__preview/games`: games list
  - `/__preview/game`: game page
  - `/__preview/highlights`: highlight reel
- **Signing in from `localhost`:** works as long as `localhost` is under Firebase Console → Authentication → Settings → Authorized domains. It is there by default.

| Command | |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Type-check and build into `dist/` |
| `npm run lint` | oxlint |
| `npm run sync-detector` | Copy the browser detector from `rally-lab/web` into `public/detector` |
| `npx firebase deploy --only hosting` | Deploy the app (run `npm run build` first) |
| `npx firebase deploy --only firestore:rules` | Deploy the security rules |

Deploying needs `npx firebase login` with an account that has access to the `volleyrate-f03aa` project.

The Firebase web config in `src/lib/firebase.ts` is meant to be public. Access is controlled by `firestore.rules` and the team list, not by keeping the key secret.

## Project layout

```
src/
  lib/
    engine.ts        stats → rating adjustments (see docs/ratings.md)
    ratings.ts       attributes, categories, position weights, overall
    rated.ts         hooks: players with effective ratings, engine settings
    stats.ts         per-player stat lists with clip links
    games.ts         game/rally/touch types, tagging rules, Firestore access
    rotation.ts      court rotation: positions, side-outs, auto subs, who serves
    detector.ts      runs public/detector in a worker
    training.ts      in-browser retraining of the clip classifier
    backups.ts       rating backups
    highlights.ts    highlight bookmarks
    auth.tsx         Google sign-in and team-list check
    data.ts          players and members
    youtube.ts       YouTube IFrame API loader
  pages/             Home, Players, Games, GameView, Admin, Gate, DevPreview
  components/        Layout, PlayerCard, Court
public/detector/     browser rally detector (copied from rally-lab/web)
rally-lab/           Python detector lab + browser detector source (own README)
firestore.rules      security rules
docs/ratings.md      the rating calculations
private/             git-ignored: real roster emails and starting ratings
private.example/     the formats of the files in private/
```

## Data (Firestore)

| Collection | Contents | Who can write |
|---|---|---|
| `members/{email}` | `{ playerId, role: 'admin' \| 'player' }`: who may sign in | admin |
| `players/{id}` | `{ name, number, positions[], ratings{attr: 0–99} }`: starting ratings | admin |
| `games/{id}` | `{ title, date, youtubeId, duration, reviewed, rallies[], segments?, peaks?, rating?, court?: { a, b: { pos[6], roles[6], bench[], mb? }, serving } }` | team (only admin deletes) |
| `games/{id}/history` | append-only edit log | team (add only) |
| `highlights/{id}` | `{ playerId, gameId, youtubeId, s, e, note, by }` | the adder; removable by the adder, the player, or admin |
| `config/ratingsEngine` | rating sensitivity settings | admin |
| `config/detector` | active retrained clip classifier | admin |
| `ratingBackups/{id}` | snapshots of players, settings and game approvals | admin |

**A rally** is `{ s, e, st: auto|ok|bad|added, as?, ae?, touches?: [{ p, k, t }], end?: { i, r: point|error }, sk?, by?, court? }` (`court` = where everyone stood, saved when the rally is tagged or the court is edited).
- `as` / `ae` are the detector's original bounds, kept for retraining.
- In each touch, `p` is a player id or `guest`, `k` is the skill, and `t` is the video time.

**Admins:** the admin accounts are stored as SHA-256 hashes of their lowercase emails, in both `firestore.rules` and `src/lib/auth.tsx`. To add one:
1. Get the hash with `printf '%s' 'name@gmail.com' | shasum -a 256`.
2. Add it to both lists.
3. Deploy the rules and the app.

## Private files

`private/` is git-ignored and never deployed. It holds teammates' emails and the poll results.

- `private/roster.json`: imported in Admin → Roster.
- `private/starting_ratings.json`: imported in Admin → Ratings. Keyed by player id.

See `private.example/` for the formats.
