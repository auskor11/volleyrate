# How ratings are calculated

All of this is in [`src/lib/engine.ts`](../src/lib/engine.ts) (stats → attribute ratings) and [`src/lib/ratings.ts`](../src/lib/ratings.ts) (attributes → overall). Ratings are recalculated live, in the browser, from every game whose stats have been applied.

```
shown rating = clamp(0, 99, round(starting rating + experience + stats adjustment))
```

## 1. Starting ratings

Starting ratings come from a team poll. For each player and attribute:

- Average the 1–10 votes, leaving out the player's own vote.
- Starting rating = 35 + 5 × average.

They are stored in `players/{id}.ratings`. The admin imports or edits them in Admin → Ratings.

## 2. Experience

```
experience = min(expMax, expPerGame × games played)
```

- This is added to **every** attribute.
- "Games played" means applied, touch-tagged games in which the player has at least one touch.
- Each game counts with its per-player strength (see section 5). For example, a game applied at 0.5× counts as half a game.

## 3. Stats adjustment

Only six attributes can be measured from tagged touches. Setting and Receiving have two metrics each, and their adjustments are **added together**.

| Attribute | Metric | Formula | rate | k |
|---|---|---|---|---|
| Spiking | Hitting efficiency | (kills − attack errors − times blocked) ÷ attacks | 0.5 | 25 |
| Serving | Serve efficiency | (aces − serve errors) ÷ serves | 0.5 | 25 |
| Setting | Set efficiency | (assists + set-over points − set errors) ÷ sets | 0.4 | 25 |
| Setting | Set quality *(graded)* | (average grade of non-error sets − 1) ÷ 2 | 0.3 | 25 |
| Receiving | Ball control | 1 − (receive + dig errors) ÷ (receives + digs) | 1.0 | 25 |
| Receiving | Pass quality *(graded)* | (average grade of non-error receives + digs − 1) ÷ 2 | 0.3 | 25 |
| Consistency | Error rate | errors ÷ all touches (lower is better) | −1.5 | 25 |

```
adjustment = rate × strength × (player metric − team benchmark) × 100 × n / (n + k × dataScale)
attribute's stats adjustment = sum of its metrics' adjustments
```

**Blocking works differently: a bonus that only goes up.** You're beginners, so blocking attempts shouldn't cost rating.

```
Blocking bonus = min(15, strength × (2 × block points + 0.5 × other block touches))
```

- **Block points** are blocks that won the rally, directly or by forcing a receive/dig error.
- **Other block touches** are soft blocks and deflections that kept the rally going.
- **Block errors** count 0.
- **No team comparison and no confidence factor**, so dataScale doesn't apply. Recent sessions and each game's strength still weight the counts.
- **Example** at strength 1.2: 1 block point + 5 other touches = 1.2 × (2 + 2.5) = **+5.4**. The bonus stops at **+15**.

**Graded metrics:**
- Grades are optional: passes 3 perfect / 2 OK / 1 poor, sets 3 good / 2 OK / 1 poor.
- **Scale:** the average grade is put on a 0–100% scale, so 1.0 = 0%, 2.0 = 50%, 3.0 = 100%. `n` is the number of graded touches.
- **Ungraded sets count as OK (2).** Ungraded passes are left out.
- **Errors are left out:** a touch that ended the rally as an error isn't graded here. Errors already count in Set efficiency and Ball control, so they aren't counted twice.

- **`(metric − benchmark) × 100`**: how many percentage points better or worse than the team the player is.
- **`rate`**: rating points per percentage point. Consistency's rate is negative because a *lower* error rate is better.
- **`n / (n + k × dataScale)`**: confidence. With few attempts the adjustment is small; it approaches the full amount as attempts grow. At `n = k × dataScale` it is exactly half.
- Attributes without a metric (Positioning, Adaptability, Reading, Physical, Technique) only get starting rating + experience.

### Benchmark (frozen)

- The benchmark is the whole team's pooled metric over the first sessions that hold 5 tagged games.
- It always uses whole sessions: every game dated on or before the 5th game's date is included.
- After that it stays fixed. If the team improves, everyone's ratings go up, rather than the average being reset each time.
- **Graded metrics** (set and pass quality) count from the first sessions holding 5 games **that have grades**, since older games have none. Ungraded sets count as OK, so set quality's benchmark comes from your first 5 games and is about 50% (an OK set). Until 5 graded games exist, their benchmark uses whatever graded games there are.
- It uses plain (unweighted) counts from every player except guests.

### Recent games count more

- A **session** is one date.
- `age` is how many sessions ago the game's date was. The newest session has age 0.
- Each game's counts are multiplied by `0.5 ^ (age / 8)`, so a session's weight halves every 8 sessions.
- All games on the same date weigh the same.

The player's metric and `n` above use these weighted counts. The player page also shows the plain, unweighted value.

## 4. What counts as what (per rally)

A rally counts only if it is not marked "Not a rally", has touches tagged, and has an ending (which touch, point or error).

- **Every touch** adds 1 to the player's touches and 1 to that skill's attempts:
  - attack → attacks
  - serve → serves
  - set → sets
  - block → block touches
  - receive or dig → ball control

- **Rally ends on a point**, credited to the touch that ended it:
  - Attack → kill; serve → ace; block → block point; a set that goes over and lands → **set-over point** for the setter.
  - If the attack came straight after a set by a **different** player on the **same team**, that setter gets an **assist**. A set that goes over and is attacked by the other team is not an assist.
  - A **dig straight to the attacker** (no set in between) by a teammate also gets an assist. Teams come from the game's court setup, and a dig by someone on the other team never counts. Dig assists show in Assists stats only; Setting's set efficiency counts set assists only.
  - If a block point came straight after an attack by a **different** player, that attacker is **blocked** (counts against hitting efficiency).

- **Rally ends on an error** by the player who made it:
  - The error adds to their errors (Consistency) and to that skill's errors: attack error, serve error, set error, block error, or receive/dig error.
  - **Forced errors:** if the erring touch came straight after the other side's touch by a **different** player, the earlier touch earns the point:

    | Previous touch | Error on | Credited as |
    |---|---|---|
    | Serve | receive / dig | ace |
    | Attack | any touch by the other team (receive, dig, block, set, free ball, …) | kill (plus the assist rule above) |
    | Block | receive / dig | block point |
    | Set that goes over | receive / dig / block | set-over point (counts like an assist in set efficiency) |

  - **An attack the other team couldn't get back over** also earns the kill (and its assist): they touched it up to 3 times (a block doesn't count), sent nothing over (no attack or free ball), and the rally ended on their error, e.g. attack → dig → hustle set into the net. The error at the end of that scramble counts **0.5**, like a forced receive. Needs the teams set up.
  - After an attack, a receive / dig / block error is always forced. Any other error (a set, a free ball, …) is forced only when the court setup puts the attacker and the player who erred on different teams.
  - A forced **receive or dig** error counts **0.5** against the defender's Receiving and Consistency (`FORCED_ERROR_WEIGHT`). Other forced errors (block, set, …) count in full.

- **Double blocks:** a block touch can name a second blocker. Both players get the block touch, and both get the block point if it scores (directly or by forcing an error). An attacker who is blocked by two players counts as blocked once.
- **Error after a poor touch:** an error straight after a teammate's receive, dig or set graded **Poor** counts **0.5** (e.g. a bad pass the setter couldn't save, or a bad set the hitter put into the net). Only a touch actually graded Poor counts (OK or ungraded doesn't). It doesn't stack with a forced or scramble error (still 0.5), but a miscommunication still splits it (0.25 each). Ratings, game ratings and player page counts.
- **Miscommunication:** any receive, dig, set, attack or free ball that ended the rally as an error can name a second player (both went for it, or both left it, e.g. a set dropping between two hitters). The touch and the error are shared, **half each**: 0.5 of a touch and 0.5 of an error for each player (0.25 each if the error was forced, e.g. off an ace). This applies to ratings, game ratings and the player page counts.
- **Blockouts:** when a block straight after the other team's attack goes out (or is tagged as a block error), the attacker gets the kill, and the blocker is **not** marked down: it counts as a block touch (+0.5 block credit), not an error, for ratings, stats and game ratings. Tagging it as "the attack scored" gives exactly the same result.
- A player is never credited for their own touch: no assist for setting yourself, and no "blocked" for blocking your own attack.
- Guests are left out of both ratings and the benchmark. Their touches still affect credit: for example, a guest's serve still makes the next receive error count as forced (0.5).
- **Free ball** (an easy ball sent over) counts as a touch, so it counts for Consistency, and an error on it counts as an error. It is **not an attack**, so it doesn't affect hitting efficiency, and it can't force an error.
- **Attack type** (spike / tip / smart placement) doesn't change any rating. Every attack still counts for Spiking. Types are for stats only: tips, smart placements, and kills from each.
- Old point-only tags (one tag per rally) appear in the stats lists but are **ignored by the ratings**, because they have no attempt counts.

## 5. Applying a game (admin)

- New games start as **not applied**: their stats don't count yet.
- In the game's Box score → Rating changes, the admin picks a strength for each player (0, 0.5, 1, 1.5 or 2×) and applies the game.
- The strength multiplies that player's counts from the game, and so also their experience from it.
- A strength of 0 means the game doesn't count for that player at all.
- Games from before this approval step existed count at 1×.
- Every apply, update or undo first saves an automatic backup. Restore it in Admin → Ratings → Backups.

## 6. Settings (Admin → Ratings → Sensitivity)

Stored in `config/ratingsEngine`.

| Setting | Default | Meaning |
|---|---|---|
| `strength` | 1.6 | Multiplies every `rate`: how strongly stats move ratings |
| `dataScale` | 0.4 | Multiplies every `k`: smaller means fewer attempts before stats count fully |
| `expPerGame` | 1.5 | Experience points per game played |
| `expMax` | 20 | Experience cap |

The sliders preview the new ratings before saving.

## Worked example

**Settings:** strength 1.2, dataScale 0.4, expPerGame 0.25. That makes k × dataScale = 25 × 0.4 = 10.

**Spiking:**
- Starting rating 70; 8 games played → experience 2.
- 20 weighted attacks at 25% hitting efficiency; team benchmark 10%.
- confidence = 20 / (20 + 10) = 0.667
- adjustment = 0.5 × 1.2 × (25 − 10) × 0.667 = **+6.0**
- shown Spiking = round(70 + 2 + 6.0) = **78**

**Pass quality** (Receiving's second metric):
- 20 graded passes averaging 2.6, i.e. (2.6 − 1) ÷ 2 = 80%; team benchmark 60%.
- confidence = 20 / (20 + 10) = 0.667
- adjustment = 0.3 × 1.2 × (80 − 60) × 0.667 = **+4.8**, added to Ball control's adjustment

**Consistency:**
- 60 weighted touches with an 8% error rate; team benchmark 12%.
- confidence = 60 / 70 = 0.857
- adjustment = −1.5 × 1.2 × (8 − 12) × 0.857 = **+6.2**

## 7. Overall rating

Each position weights the 11 attributes differently (each row sums to 100%):

| | SPK | SET | SRV | BLK | REC | POS | ADP | READ | CON | PHY | TEC |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Setter | 2 | 30 | 6 | 5 | 5 | 7 | 7 | 8 | 12 | 6 | 12 |
| Outside | 20 | 2 | 8 | 7 | 18 | 6 | 5 | 6 | 10 | 8 | 10 |
| Opposite | 28 | 2 | 9 | 14 | 4 | 6 | 5 | 6 | 10 | 10 | 6 |
| Middle | 18 | 1 | 7 | 28 | 2 | 7 | 4 | 10 | 8 | 10 | 5 |
| Libero | – | 6 | – | – | 34 | 12 | 7 | 12 | 12 | 7 | 10 |

- Overall = weighted average of the attributes that have a rating. Unrated attributes are left out and the remaining weights rescaled.
- At least 50% of the weight must be rated, otherwise there is no overall.

**Card tier:**
- Gold: 80 or more
- Silver: 70–79
- Bronze: below 70

**Category scores** (Attack, Defence, Game Intelligence…) are plain averages of their attributes, except a **libero's Defence**, which is 85% Receiving and 15% Blocking. This uses the player's main position.

## 8. Game ratings (per game, Mobile Legends style)

A separate 0–10 score for each player in each game (`src/lib/gameRating.ts`). It never changes the player
ratings above.

- **Net points** from that game's tags:
  - plus: kill, ace, block point and set-over point 1 each; assist 0.6; dig 0.25; receive 0.15; block touch 0.15; free ball 0.1
  - minus: attack, serve, receive/dig and other errors 1 each (0.5 for a forced receive / dig error, e.g. off an ace or a kill, and for the error ending a scramble after an attack); getting blocked 0.5
- **Score** = 6 + 0.5 × net points × (50 ÷ tagged rallies in the game), +0.5 for the winning team, kept between 0 and 10
  (one decimal). The winner is the team with more points in the game's score sheet (needs the team setup).
- **MVP** (👑) is the best score on the winning team; **MVP** on the losing team is that team's best.
  Everyone else gets a medal: **Gold** from 7.5, **Silver** from 6.0, otherwise **Bronze**.
- **Titles:** the game's outright leader (at least 2) in kills, aces, block points, assists ("Playmaker") or digs,
  and "N in a row" for a player credited with the point in 3 or more rallies running.
- **Session ratings** (on the session recap): each player's average game rating that Saturday, ranked, with the
  same medal cut-offs. **Session MVP** is the best average among players who played at least half the games.
- Guests are left out.
