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

Only six attributes can be measured from tagged touches:

| Attribute | Metric | Formula | rate | k |
|---|---|---|---|---|
| Spiking | Hitting efficiency | (kills − attack errors − times blocked) ÷ attacks | 0.5 | 25 |
| Serving | Serve efficiency | (aces − serve errors) ÷ serves | 0.5 | 25 |
| Setting | Set efficiency | (assists − set errors) ÷ sets | 0.4 | 25 |
| Receiving | Ball control | 1 − (receive + dig errors) ÷ (receives + digs) | 1.0 | 25 |
| Blocking | Block efficiency | (block points − block errors) ÷ block touches | 0.5 | 15 |
| Consistency | Error rate | errors ÷ all touches (lower is better) | −1.5 | 25 |

```
adjustment = rate × strength × (player metric − team benchmark) × 100 × n / (n + k × dataScale)
```

- **`(metric − benchmark) × 100`**: how many percentage points better or worse than the team the player is.
- **`rate`**: rating points per percentage point. Consistency's rate is negative because a *lower* error rate is better.
- **`n / (n + k × dataScale)`**: confidence. With few attempts the adjustment is small; it approaches the full amount as attempts grow. At `n = k × dataScale` it is exactly half.
- Attributes without a metric (Positioning, Adaptability, Reading, Physical, Technique) only get starting rating + experience.

### Benchmark (frozen)

- The benchmark is the whole team's pooled metric over the first sessions that hold 5 tagged games.
- It always uses whole sessions: every game dated on or before the 5th game's date is included.
- After that it stays fixed. If the team improves, everyone's ratings go up, rather than the average being reset each time.
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
  - Attack → kill; serve → ace; block → block point.
  - If the attack came straight after a set by a **different** player, that setter gets an **assist**.
  - If a block point came straight after an attack by a **different** player, that attacker is **blocked** (counts against hitting efficiency).

- **Rally ends on an error** by the player who made it:
  - The error adds to their errors (Consistency) and to that skill's errors: attack error, serve error, set error, block error, or receive/dig error.
  - **Forced errors:** if the erring touch came straight after the other side's touch by a **different** player, the earlier touch earns the point:

    | Previous touch | Error on | Credited as |
    |---|---|---|
    | Serve | receive / dig | ace |
    | Attack | receive / dig / block | kill (plus the assist rule above) |
    | Block | receive / dig | block point |

  - A forced **receive or dig** error counts **0.5** against the defender's Receiving and Consistency (`FORCED_ERROR_WEIGHT`). A forced block error counts in full.

- A player is never credited for their own touch: no assist for setting yourself, and no "blocked" for blocking your own attack.
- Guests are left out of both ratings and the benchmark. Their touches still affect credit: for example, a guest's serve still makes the next receive error count as forced (0.5).
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

**Category scores** (Attack, Defence, Game Intelligence…) are plain averages of their attributes.
