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
  Before tagging, enter both teams (serving order, roles, and players who don't serve, e.g. a libero), or copy them from the last game. The server is then pre-selected for every rally from which team won the one before; correcting it restarts the rotation from that player (`src/lib/rotation.ts`).
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
    rotation.ts      serving rotation: predicts who serves next from the teams' orders
    detector.ts      runs public/detector in a worker
    training.ts      in-browser retraining of the clip classifier
    backups.ts       rating backups
    highlights.ts    highlight bookmarks
    auth.tsx         Google sign-in and team-list check
    data.ts          players and members
    youtube.ts       YouTube IFrame API loader
  pages/             Home, Players, Games, GameView, Admin, Gate, DevPreview
  components/        Layout, PlayerCard
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
| `games/{id}` | `{ title, date, youtubeId, duration, reviewed, rallies[], segments?, peaks?, rating?, lineup?: { a[], b[], nonServing?, roles? } }` | team (only admin deletes) |
| `games/{id}/history` | append-only edit log | team (add only) |
| `highlights/{id}` | `{ playerId, gameId, youtubeId, s, e, note, by }` | the adder; removable by the adder, the player, or admin |
| `config/ratingsEngine` | rating sensitivity settings | admin |
| `config/detector` | active retrained clip classifier | admin |
| `ratingBackups/{id}` | snapshots of players, settings and game approvals | admin |

**A rally** is `{ s, e, st: auto|ok|bad|added, as?, ae?, touches?: [{ p, k, t }], end?: { i, r: point|error }, sk?, by? }`.
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
