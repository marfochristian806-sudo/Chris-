# Stack Tower

A Tetris-lite browser puzzle built for a data structures assignment, where the
**Stack (LIFO)** data structure is not decoration — it *is* the game.

No frameworks, no dependencies: `index.html` + `styles.css` + one
`<canvas>` driven by `game.js`.

## Play

```bash
python3 -m http.server 3000 --bind 0.0.0.0   # then open http://localhost:3000
```

- `←` `→` or `1`–`6` — choose a column · click/tap a column to drop there
- `Space` / `↓` / `Enter` — drop the block · `U` — undo · `P` — pause · `R` — restart

Drop blocks into the six columns. **3+ identical blocks stacked on top of each
other pop**, and each pop can cascade into another. If a column gets too tall,
**stack overflow** — game over.

## Where the Stack appears in the code

| Game element | Stack operation | Code |
|---|---|---|
| Every board column is a `Stack` object | `push` / `pop` / `peek` / `size` / `isEmpty` | `class Stack` in `game.js` |
| Placing a block | `stack.push(colour)` | `drop()` |
| Checking a colour without removing it | `stack.peek()` | `topRun()` |
| Clearing a match | repeated `stack.pop()` off the top | `finishPop()` |
| Undo / restart of a move | a second **history stack** of state snapshots | `snapshot()` / `undo()` |
| Losing the game | push beyond capacity → **stack overflow** | `drop()` |
| "Next block" preview | `peek()` at the front of the piece queue | `renderNext()` |

Only the top of a column is ever read or modified, so no block ever has to pass
through another one — the LIFO invariant holds by construction, which is why
clearing a match never needs a "falling" step.

## Rules

- 6 columns, capacity 9 blocks each (the dashed red line).
- A clear scores `blocks × 10 × combo`; consecutive clears raise the combo.
- Levels 1–3 introduce 4, 5 then 6 colours as your score climbs.
- Best score is saved in `localStorage`.