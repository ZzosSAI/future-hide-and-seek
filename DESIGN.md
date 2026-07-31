# Future Hide & Seek — Design Document

A polished, browser-based, pass-and-play hide-and-seek game for children aged 9–12,
built with plain HTML, CSS and JavaScript — no frameworks,
no servers, no accounts, no ads, no purchases, no personal data. Open `public/index.html` and play.

---

## 1. Game Structure

The game is split into two clearly separated layers:

| Layer | File | Responsibility |
|---|---|---|
| **Core logic** | `js/game-core.js` | Rules engine: state machine, hiding, searching, scoring, rounds, leaderboard, power-ups, clue generation. Pure JavaScript — no DOM access. Runs in the browser **and** in Node.js (for automated tests). |
| **UI layer** | `js/ui.js` | Screens, the SVG city map, input handling, sounds/music, confetti, tutorial, localStorage persistence. Only talks to the core through its public, *sanitised* API. |
| **Styles** | `css/style.css` | Neon-futuristic theme, responsive layout, kid-friendly sizes. |
| **Shell** | `index.html` | All 9 screens as simple `<section class="screen">` elements toggled with `.active`. |

The core exposes `FHS.createGame(config, rng)` returning a game object. The UI holds
one instance in `game` and re-renders the current screen after every core call.

## 2. Game Screens

1. **Main Menu** — title, Start Game, How to Play, sound settings, Best Champions (localStorage).
2. **Setup** — player count (2–5), name/avatar/colour pickers, difficulty cards.
3. **How to Play** — rules, scoring table, power-up list, safety note.
4. **Tutorial** — interactive 6-step walkthrough (skippable, shown on first game).
5. **Hider Turn** — top bar + city map + "choose your secret hiding place" + confirm modal.
6. **Privacy Pass** — "Pass the device to X" with the **Ready — Pass to the Next Player** button.
7. **Seeker Turn** — top bar (guesses, hiders left) + map + search confirm + result modals.
8. **Round Results** — found/escaped lists, round points, leaderboard, Next Round / See Champion.
9. **Champion** — trophy, winner, final leaderboard, confetti, Play Again / Main Menu.

Plus a global **modal overlay** for confirmations/feedback and a **confetti canvas**.

## 3. Main JavaScript Variables & Game States

**Core (`game-core.js`), inside the `createGame()` closure:**

- `players` — `{ id, name, avatarId, color, score, index }` (score persists across rounds).
- `phase` — `'hider' → 'seeker' → 'round-end' → 'champion'` (the state machine).
- `currentRound`, `roundTotal` (= number of players), `seekerOrder` (shuffled once — **every player is Seeker exactly once**).
- `hiderQueue` — hiders still to hide this round; `targets` + `targetIndex` — hiders still to be searched.
- `hides` — **private** map `hiderId → spotId` (see §4).
- `hiderFlags` — per-hider power-up flags `{ silent, tunnel, decoy, tunnelApplied }`.
- `powerUps` — `playerId → { power, used }` (one random power-up per player per round).
- `activeSpotIds` — the hiding spots available this game (10/15/22 by difficulty).
- `hintSpots`, `decoySpots`, `scannerSpots`, `seekerUsedPower`, `guessesLeft`, `roundStartScores`, `resolved`.

**UI (`ui.js`):** `game` (core instance), `U.pendingSpot` / `U.pendingPowerUp` (map selection),
`tutorialStep`, `setupPlayers`, `setupDifficulty`, `setupData`, `settings`.

**Phases and transitions:**

```
menu → setup → tutorial → hider(hide) → privacy → hider → … → privacy(seeker) → seeker
seeker → (found/escaped per target) → round-results → nextRound → hider … → champion
```

## 4. How Secret Hiding Locations Stay Hidden from the Seeker

Because this is a local pass-and-play game on one device, we can't use cryptography —
any kid determined enough could open DevTools. What we *can* guarantee is that the game
never leaks hiding data by accident, and that honest players have full privacy:

1. **Module-private state.** `hides` lives inside the `createGame()` closure. No public
   function ever returns the whole map — the UI can only receive hiding data through
   four narrow "reveal paths":
   - `commitHide()` → the hider's own confirmation (their own pick),
   - `beginTargetSearch()` → applies Secret Tunnels (no data is revealed),
   - `searchSpot()` → the result *after* a search (found / escaped),
   - `getRoundSummary()` → revealed only **after the round ends**.
2. **Sanitised public state.** `getState()` and `getSeekerSearchState()` contain no hide
   locations (verified by automated tests: the seeker-state JSON never contains any spot
   id that is currently a hiding place).
3. **Visual privacy.** The map is rendered fresh with zero markers for the Seeker; the
   hider's own selection highlight is cleared the moment they confirm.
4. **Pass-and-play flow.** After each hider confirms, a **privacy screen** requires
   pressing "Ready — Pass to the Next Player", so the next player cannot see the screen.

## 5. Scoring & Turn System

**Guesses:** each Hider gets 3 guesses (4 on Beginner). Guesses reset when the Seeker
moves to the next Hider. Extra Guess power-up adds +1 for that Hider.

| Outcome | Seeker | Hider |
|---|---|---|
| Found on guess 1 | +100 | — |
| Found on guess 2 | +60 | — |
| Found on guess 3 | +30 | +30 (survived 2 guesses) |
| Found on guess 4 (Beginner) | +20 | +30 |
| Not found (escaped) | — | +100 |

**Rounds:** at game start the players are shuffled into `seekerOrder`. Round *n* uses
`seekerOrder[n-1]` as Seeker, everyone else hides. After every round, round results
show found/escaped players, round points, and the live leaderboard. After N rounds
(every player has been Seeker once) the highest total score is the **Champion**.

**Power-ups** (optional, one use per round): Seeker — Scanner Pulse (highlights 3 spots
including the target), Robot Clue (attribute-based clue), Extra Guess. Hider — Hologram
Decoy (fake shimmer elsewhere), Silent Mode (spot never appears in Advanced shimmer
hints), Secret Tunnel (moves you to a connected spot before the first guess).

**Secrecy of clues:** clues are generated *inside* the core from the private spot data —
the UI only ever receives the finished clue sentence, never the spot.

---

## Running & Testing

```bash
npm install          # dev dependency: jsdom (only needed for UI tests)
npm test             # 21 automated tests: core logic + full DOM playthroughs
```

Open `index.html` in any modern browser (desktop, tablet or phone) — no server needed.
