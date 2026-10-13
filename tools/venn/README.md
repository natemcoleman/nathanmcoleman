# Venn

Daily rotating-circle puzzle at `/venn/`.

| File | What it is |
| --- | --- |
| `static/venn/engine.js` | Puzzle logic: geometry, moves, scrambles, hints, daily schedule |
| `static/venn/venn.js` | Game page: board drawing, dragging, timer, stats, archive, sharing |
| `static/venn/venn.css` | Styles (light and dark) |
| `layouts/venn/single.html` | Page markup (full-screen, outside the PaperMod theme) |
| `content/venn.md` | Hugo page that serves `/venn/` |
| `tools/venn/engine.test.js` | Engine tests: `node --test tools/venn/engine.test.js` |

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

`SCHEDULE` in engine.js sets each weekday's layout and scramble length:

```js
1: { label: 'Easy', rings: 2, moves: 2 },   // Monday
```

`step` (optional) is the turn size used when scrambling. It defaults to one
quarter turn (= the number of rings). Changing the schedule, layouts or scramble
code changes every puzzle, past ones included, so treat them as fixed once live.

`LAUNCH` in venn.js is the date of Venn #1.

## Saved data

Everything is stored in the browser under the `venn-v1` localStorage key. The
theme uses PaperMod's `pref-theme` key, so it matches the rest of the site.
