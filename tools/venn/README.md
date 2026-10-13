# Venn

Daily rotating-circle puzzle at `/venn/`.

| File | What it is |
| --- | --- |
| `static/venn/engine.js` | Puzzle logic: geometry, moves, scrambles, hints, daily schedule |
| `static/venn/venn.js` | Game page: board drawing, dragging, timer, stats, archive, sharing |
| `static/venn/venn.css` | Styles (light and dark) |
| `layouts/venn/single.html` | Page markup (full-screen, outside the PaperMod theme) |
| `content/venn.md` | Hugo page that serves `/venn/` |
| `static/venn/solutions.json` | Precomputed shortest solution for every daily puzzle (used by "Watch Solution") |
| `tools/venn/solve.js` | Generates `solutions.json`: `node tools/venn/solve.js [first] [last]` (about 11 minutes for 2 years) |
| `api/venn.mjs` | Vercel Function at `/api/venn`: global results and feedback (thin wrapper) |
| `lib/venn/scores.mjs` | Server logic: checks a solve by replaying it, one score per player per day, counts by moves, feedback |
| `lib/venn/redis.mjs` | Storage on Upstash Redis through its REST API (no npm packages) |
| `tools/venn/engine.test.js`, `scores.test.mjs` | Tests: `npm run test:venn` (no install needed) |

## Making puzzles

A layout is two numbers in `LAYOUTS` (engine.js):

```js
{ centers: 3, radii: [1.15, 1.53, 1.91] }
```

- `centers`: circle centers, evenly spaced on a unit ring.
- `radii`: the concentric circles drawn around every center.

Points are placed wherever circles from different centers cross. Faces (the clusters
that must end up one color) are worked out automatically. With 3 centers, N radii
gives 6 faces of N×N points, like an N×N×N cube.

## Daily schedule

`SCHEDULES` in engine.js is a list of weekly schedules, each with a start date:

```js
{ from: '2026-10-13', days: { 1: { label: 'Easy', layout: 2, moves: 2 }, ... } }
```

A puzzle uses the last schedule that started on or before its date. **To change
difficulty or add a new layout, add a new schedule with a future `from` date.
Never edit a schedule or layout that has already been used**, or past puzzles
(and people's saved progress) would change. The tests fail if that happens.

For example, to make Fridays a new layout starting 2026-12-04: add the layout to
`LAYOUTS` under a new key, copy the latest schedule into a new entry with
`from: '2026-12-04'`, change day `5`, then run `node tools/venn/solve.js 2026-12-04 2028-12-31`.

- `layout`: key in `LAYOUTS`
- `moves`: scramble length (1 to 6, since solve.js finds solutions up to 6 moves)
- `step` (optional): turn size used when scrambling. Defaults to one quarter turn
  (the number of rings).

`LAUNCH` in venn.js is the date of Venn #1.

## Scoring and practice

- There is no timer. Moves = turns made, minus undos, plus 2 per hint (`HINT_COST` in engine.js,
  shared with the server).
  Stats average moves by difficulty.
- Drag sensitivity is `DRAG_SPEED` in venn.js (0.9 = the circle turns 90% as far as the finger).
- Practice modes, never saved or counted: `/venn/?free=Easy` (also Medium, Hard,
  Expert; add `&seed=anything` to repeat one) and `/venn/?replay=YYYY-MM-DD`.
  Both are linked from the Play (calendar) menu and the results screen.

## Hints

Hints aim for the shortest solution. When 4 or fewer moves remain, the game
searches for the exact best move (and says how many moves are left). Otherwise
it walks back along the player's own moves to the nearest point on the
precomputed shortest route and continues along it.

## Shortest solutions

`solutions.json` currently runs from 2026-10-14 to 2028-12-31. Re-run
`tools/venn/solve.js` after changing layouts, the schedule or the scramble code,
or to extend the range (for example `node tools/venn/solve.js 2026-10-14 2030-12-31`).
The tests fail if the file stops covering the next 365 days or no longer
matches the puzzles. If a day is missing, the game still offers a solution
(it unwinds the scramble) but labels it "Solution" instead of "Shortest solution".

## Share image and icons

`og.png` (link preview), `apple-touch-icon.png`, `favicon-32.png` and the Home Screen icons (`icon-*.png`, used by `manifest.webmanifest`) are drawn
from the real puzzle by `tools/venn/make-images.py` (needs Python Playwright).
Re-run it if the colors or layouts change.

## Feedback

The feedback form posts to `/api/venn?op=feedback`, which stores messages in
Upstash Redis (newest first, last 2000 kept; 5 per hour per visitor). To read
them, set a `VENN_ADMIN_KEY` environment variable in Vercel (any long random
string) and open `/api/venn?op=feedback&key=<that string>`, or browse the
`venn:feedback` key in the Upstash console.

## Saved data

Everything is stored in the browser under the `venn-v1` localStorage key. The
theme uses PaperMod's `pref-theme` key, so it matches the rest of the site.

## Global results ("Everyone today")

The site is hosted on Vercel. When a player solves today's puzzle on its own
day, the page sends the date, a random anonymous player id, its list of turns
and its hint count to `/api/venn`. The function replays the turns to check the
puzzle really was solved, works out the move score itself, keeps only the first
score per player per day, and returns how many players finished in each number
of moves. Archive and practice games are never sent.

Storage is Upstash Redis, added from the Vercel Marketplace (it sets
`KV_REST_API_URL` and `KV_REST_API_TOKEN`). Until it is connected the function
answers 503 and the game simply hides the "Everyone today" section.
Keys: `venn:c:<date>` (hash of moves -> players), `venn:p:<date>:<id>` (one per player, expires after 30 days).
