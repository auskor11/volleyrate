# Code backup tags

Before every feature or fix, the code is tagged and pushed to GitHub (a "backup tag"). Each tag is the app
**exactly as it was before** the change listed next to it, so going back to a tag undoes that change and
everything after it. The database is backed up separately (see [backups.md](backups.md)).

## Going back to a tag

Look first, change nothing:

```bash
git checkout v1.38-before-no-win-bonus   # the code as it was then (read-only look)
git checkout main                        # back to now
```

Put the live site back to a tag (the code on `main` stays as it is):

```bash
git checkout v1.38-before-no-win-bonus && npm run build && npx firebase deploy --only hosting && git checkout main
```

To undo one change for good, revert its commit on `main` (`git revert <commit>`), then build and deploy as usual.

## The tags

| Tag | Date | The change made after it |
|---|---|---|
| `v1.0-list-teams` | 2026-10-09 | 95aeb6a Court-view rotation: setup on a court, live rotation column in the tagger, auto subs, drag to swap |
| `v1.1-court-rotation` | 2026-10-09 | 2d35598 Better stats: pass and set quality grades, attack types, free ball skill |
| `v1.2-better-stats` | 2026-10-09 | 6ae48e8 Set-over points for the setter; automatic score tracker |
| `v1.4-before-angles` | 2026-10-10 | f111e52 Several cameras per game: camera switcher, audio auto-sync, separate back-camera rally detector |
| `v1.5-before-ui-redesign` | 2026-10-12 | 3543cbe Clean UI theme, switchable with Classic in the account menu |
| `v1.6-before-share-reels` | 2026-10-12 | 8d00ab6 Share a rally link, play all of a stat's clips back to back, game page fills the screen in Clean |
| `v1.7-before-roles` | 2026-10-13 | f659be1 Viewer and Editor roles: viewers watch only, editors also review and tag; set in Admin → Access |
| `v1.8-before-guests` | 2026-10-13 | 46efbb5 Guest access: anyone can watch without signing in; sign-in users ask to be editors or players, admins approve in Admin → Access |
| `v1.9-before-recap-redesign` | 2026-10-13 | fc6e6fa Session recaps (rating movers, leaders, plays to watch) and each player's overall by session |
| `v1.10-before-game-ratings` | 2026-10-14 | ee631ea Game ratings (MVPs, medals, titles) on box scores, recaps and profiles; session compilation reel; autoplay in every playlist |
| `v1.11-before-backcourt-serve` | 2026-10-14 | 565615d Back-court player: choose who serves in his partner's turn (him, or the partner who then swaps); setter/opposite labels; a confirmed server swaps the pair instead of re-rotating |
| `v1.12-before-tag-redesign` | 2026-10-26 | d0db2a7 Tag page redesign: two columns, focus mode, roomier skills/players/results, touch trail, shortcut sheet, compact court |
| `v1.13-before-offline` | 2026-10-26 | 4171418 Database backup and restore scripts (npm run backup / restore), weekly schedule file, docs/backups.md |
| `v1.14-before-last-seen` | 2026-10-27 | 973807a Last seen: signed-in members stamp their own entry (rule-limited); shown in Admin → Access |
| `v1.15-backup-28-oct` | 2026-10-27 | adee324 Net line can tilt (slanted camera) and change mid-video (camera knocked): drag ends, Level, Camera moved here; detector follows the line at each time |
| `v1.16-backup-1-nov` | 2026-10-27 | adee324 Net line can tilt (slanted camera) and change mid-video (camera knocked): drag ends, Level, Camera moved here; detector follows the line at each time |
| `v1.17-before-static-filter` | 2026-11-01 | 3efd996 Rally detector ignores yellow that stays put (indoor doors, lights, walls): 31 Oct went from 1 clip to 99; Refresh can find the rallies again on an untouched game |
| `v1.18-before-indoor` | 2026-11-01 | e3a99fa Indoor court switch for back cameras: a top line under the ceiling lights (nothing above counts) and no sound check; outdoor detection unchanged |
| `v1.19-before-serve-options-fix` | 2026-11-02 | 2890248 Review: a rally whose teams were changed by hand still offers both serve choices (again / side-out); picking the other team saves its court with the side-out |
| `v1.20-before-libero-off` | 2026-11-02 | 758b2d1 Teams from a rally: 'No libero' option, and turning the libero off now sticks (saved as none instead of being refilled from the starting teams) |
| `v1.21-before-game-end` | 2026-11-03 | 46979ab Review: 'Game ended before this rally' marks the warm-down / fun play after a game as not rallies and leaves it out of detector training (undoable) |
| `v1.22-before-voice-tagging` | 2026-11-03 | 9584450 Voice tagging in Tag: say 'Alex serve, Ben pass, Chris set, Dana kill' and the touches, timing and result fill in (browser speech recognition, free) |
| `v1.23-before-voice-fix` | 2026-11-04 | f9c1408 Voice tagging: stop instead of restarting the mic in a loop when speech recognition fails, say why; fall back to one phrase at a time (Safari) and US English; Voice opens the first untagged rally |
| `v1.24-before-guest-voice` | 2026-11-04 | 95a3801 Voice tagging: understand common mishearings of Guest A / Guest B (guessed be, guest v, guestbee…) and guest one / two |
| `v1.25-before-voice-names` | 2026-11-04 | 9b64532 Voice names: admins give players extra names for voice tagging (English name, how speech hears it); full and run-together names (yijie) match too |
| `v1.26-before-reel-cameras` | 2026-11-04 | 980b180 Playlists (player stats, highlights, session reels) can switch between a game's cameras; the choice carries to the next clips |
| `v1.27-before-double-block` | 2026-11-05 | 4626dc3 Double blocks (second blocker gets the block touch and point; voice: 'Brayden and Jeremy block'); blockouts aren't the blocker's error, they count as a block touch |
| `v1.28-before-chain-kills` | 2026-11-09 | 4299106 An attack the other team touched but couldn't get back over (up to 3 touches, nothing sent over) is a kill; the error ending their scramble counts half |
| `v1.29-before-scramble-gamerating` | 2026-11-09 | fd530b9 Game ratings: the error ending a scramble after an attack costs 0.5, like in the player ratings |
| `v1.30-before-forced-receive-gamerating` | 2026-11-09 | 11986dd Game ratings: a forced receive / dig error (off an ace or a kill) costs 0.5, like in the player ratings |
| `v1.31-before-offline-fix` | 2026-11-10 | def5cf1 Player page error counts use halves; offline: page opens from the saved copy after 3 s on a weak signal, fonts don't block and are kept offline, sign-in uses the saved member copy first, storage kept when videos are saved |
| `v1.32-before-shared-error` | 2026-11-10 | 7631544 Miscommunication: a receive / dig error shared by two players, half the touch and half the error each (tagger button, voice 'Ben and Chris receive error') |
| `v1.33-before-shared-any` | 2026-11-10 | 1b5683e Miscommunication can be on any receive, dig, set, attack or free ball (e.g. a set dropping between two hitters), not just receives and digs |
| `v1.34-before-poor-setup` | 2026-11-10 | 0f04665 An error straight after a teammate's receive, dig or set graded Poor counts half (not stacked with forced/scramble; a miscommunication still splits it) |
| `v1.35-before-rally-teams` | 2026-11-10 | 31c9a4d Teams per rally: a player who switched sides mid-game (court changed by hand) counts with their new team for assists, kills and forced errors |
| `v1.36-before-merge-rallies` | 2026-11-10 | 6b3ec34 Start / End over another rally merges it in (the detector split one rally in two); asks first if that rally has tags |
| `v1.37-before-merge-tags` | 2026-11-10 | 3de4d1b Merging a rally in keeps its tags: touches join in time order, the last tagged part's ending counts |
| `v1.38-before-no-win-bonus` | 2026-11-10 | 7229419 Game ratings: no bonus for the winning team |
| `v1.39-before-lowlights` | 2026-11-10 | a00985a Lowlights: like highlights (🙈 on the game page and stat playlists, a Lowlights section on player pages), stored as highlights with kind 'low' |
| `v1.40-before-batch` | 2026-11-10 | (this batch) medal cut-offs, exact error weights on player pages, error notes on results, sets-graded counter, Bloopers reel, head to head, this list |

`v1.15-backup-28-oct` and `v1.16-backup-1-nov` are named by date and point at the same code (the net-line change came after both).
Add a row here with each new tag.
