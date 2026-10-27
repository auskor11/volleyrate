# Database backups

`npm run backup` copies the whole database (every collection, including game history, the team list, highlights
and rating backups) to `private/backups/volleyrate-<date>.json` on this Mac. It only reads from Firebase, and keeps
the newest 26 backups. `private/` never goes to GitHub.

## Run it every week automatically

Once, in Terminal:

```
cp ~/Codes/Projects/volleyrate/scripts/app.volleyrate.backup.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/app.volleyrate.backup.plist
```

It then runs every Sunday at 12:00 (or when the Mac next wakes, if it was asleep), logging to
`private/backups/backup.log`. To stop it: `launchctl bootout gui/$(id -u)/app.volleyrate.backup`.

## Restoring

`npm run restore -- private/backups/<file>.json` only lists what differs from the live database. Narrow it with
`--only games/<id>` (one document) or `--only games` (a collection), then add `--apply` to write those documents
back. Documents created after the backup are never deleted.
