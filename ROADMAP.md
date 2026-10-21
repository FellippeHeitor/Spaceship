# Spaceship — Roadmap to a Full Space Shooter

This plan builds on the current engine in `Spaceship.bas`. It keeps the 80×25 CP437 text-mode look and makes the engine data-driven, so that new levels, enemies and bosses are cheap to add.

---

## Status (October 2026)

Milestones M0–M7 are implemented. The full campaign plays from start to finish in autotest with no runtime errors, on all three difficulty levels. See `README.md` for how to play, mod and test.

| Milestone | Status |
|---|---|
| M0 Fixes | Done. Every bug in §2 is fixed or made obsolete by the rewrite. |
| M1 Engine refactor | Done: modules in `src/`, a state machine, entity pools, a 60 Hz fixed timestep, and an input layer with held/pressed states. |
| M2 Data-driven content | Done: `data/sprites.txt`, `data/enemies.txt`, `data/campaign.txt`, `data/levels/*.lvl`. |
| M3 Gameplay systems | Done: four weapon levels, four specials, combos, boss framework (health bar, phases, weak points), three difficulties. |
| M4 Sector 2 | Done. |
| M5 Menus and screens | Done: title, options, controls and rebinding, high scores, sector select, briefings, tally, continue, name entry, ending. |
| M6 Sectors 3–5 | Done, including terrain, fog, ion storms, gates, the Leviathan, the Dreadnought and the Hive Mind. |
| M7 Polish | Mostly done: new sound effects, MIDI music for sectors 2–5, the final boss, bonus stages and ending, a balance pass, and an autopilot test harness. |

**Where the build differs from the plan:**
- **Source encoding (§2 #14):** instead of a `cp437` editor setting, all source files are now pure ASCII. CP437 characters are written with `CHR$()`, and sprites use an ASCII legend, so editors can't corrupt them.
- **Shooting pickups:** the original let you destroy power-ups by shooting them. That now happens on Hard only.
- **Shield:** it still activates as soon as you pick it up; it isn't carried as a special.
- **Dreadnought:** its four turrets sit on the front half, and the hull has an open bay so lasers can reach the core.
- **Bonus stage:** the "Supply Run" plays after each of sectors 1–4.

**Not done yet (ideas for later):**
- the half-row collision map (§3.8)
- an in-game sprite editor
- an energy percentage readout
- an attract/demo mode on the title screen
- remixed "faster" bosses in chapter 19 (it is currently a plain boss rush)
- hand-composed music to replace the generated MIDI tracks

---

## 1. Where the engine stands today

**How it works**

- **Display.** 80×25 text mode with 16 colors. The ship moves in half-rows (`y` runs from 2 to 50) using the ▀/▄ half-block trick. Shields, smoke, the logo and the progress bar are hardware images drawn *under* the text layer, because palette color 0 is transparent and `_DISPLAYORDER _HARDWARE, _SOFTWARE` is set.
- **Main loop.** One module-level `DO … LOOP` with three GOSUBs (`ShotsFired`, `EnemyShotsFired`, `UpdateStats`) and about 100 globals.
- **Collision.** `DrawElements` rebuilds `ScreenMap(80, 25)` every frame. Each cell holds a code: bonus = `1`, enemy laser = `3 + i/100`, enemy = `-id`. Bullets and the ship look up the cells they cover. This is cheap and works well, so we keep it.
- **Entities.** Stars, enemies and beams all use `ObjectsTYPE`. Shapes are animation frames packed into `STRING * 4000`. Movement is a string of `MKI$` vertical steps, and colors use the same kind of string.
- **Content.** One `SELECT CASE` in `SetLevel` and one in `CreateEnemy` per chapter. There are three chapters and a boss (Space Amoeba), after which the game loops back to chapter 1.
- **Time.** `GetTICKS` is a clock that stops while the game is paused, combined with `_LIMIT 30`.

**Features to keep:** the look, the radio chatter, the recharge sequence at the start of each chapter, the big→small ship damage mechanic, energy as a resource spent on moving and shooting, and Time Freeze.

---

## 2. Bugs to fix first (Milestone 0)

| # | Where | Problem | Fix |
|---|-------|---------|-----|
| 1 | L1894 | `Enemies(id).IsVisible = -1` runs for every enemy. Off-screen enemies (X up to 160) therefore fire, use up the 10 beam slots and reset the shared 0.5 s cooldown, so visible enemies shoot less. | `Enemies(id).IsVisible = AnyPartVisible` |
| 2 | L1047 | The "out of energy" explosion is placed at `Boom.Y = y / 2`, but the explosion code expects half-rows (`row = y / 2`). It appears at about ¼ height. | `Boom.Y = y` |
| 3 | L952, L959 | When an enemy *laser* kills you, the explosion is placed using a stale `CheckEnemy` from an earlier collision. | Use the ship's `x`/`y`. |
| 4 | L751 | A stray `_DISPLAY` runs when your laser cancels an enemy laser. It shows a half-drawn frame, which causes flicker. | Remove it. |
| 5 | `Boom.*` globals | Only one explosion can play at a time, so a second kill restarts the animation somewhere else. Explosions also start at the enemy's top-left corner, which looks wrong on the 15-wide saucer and the 32-wide amoeba. | Use an explosion pool (§3.3) centered on `X + Width\2, Y + Height\2`. |
| 6 | L2000 | The boss chapter has `ChapterGoal = 2` with a single boss, so killing the amoeba spawns a second one. Enemies 2–10 told to "escape" vanish at once because `MaxEnemies` drops to 1. | Set `ChapterGoal = 1` (unless the double boss is intended), and let the escapees finish leaving. |
| 7 | L2008 | After the boss, `CASE ELSE` silently restarts at chapter 1. There is no ending. | Add a campaign end or ending state. |
| 8 | L406–429 | `RestartGame` doesn't reset `totalfreeze`, `Beams()`, `EnemyBeams()` or the power-up timers. Freeze charges carry over into a new game. | Add a `ResetGame` SUB. |
| 9 | L1028–1031 | The pause screen rebuilds the logo from DATA with `PSET`, one pixel at a time, every frame. | Pre-render about 16 fade frames once. |
| 10 | L292–303 | Key rebinding can't be reached: the "DELETE to reassign keys" block sits after `GOTO DemoStart`. | Move it to an Options menu (§7). |
| 11 | L179–184 | If no key is pressed within 10 s of launch, the game prints "No controller detected" and **quits**. | Default to keyboard, and detect controllers in the background. |
| 12 | L9 | `godMode = -1` is committed (fullscreen plus the L/F cheat keys). | Make it a runtime flag, e.g. a `-god` command-line argument. |
| 13 | L81 | `Collision AS _BYTE`. Rounding `3.05 → 3` only works by accident, and enemy ids are capped at 127. | Use an `INTEGER`/`LONG` map with clean encoding (§3.8). |
| 14 | Encoding | The uncommitted diff turned the CP437 ship sketch in the comments (L763–767) into `�`. The code itself is safe because it uses `CHR$()`, but any literal CP437 string would be corrupted the same way. | Add `.vscode/settings.json` with `"files.encoding": "cp437"`. |
| 15 | Repo hygiene | `Spaceship` (binary), `.DS_Store` and `controller.dat` are untracked. | Add a `.gitignore`. |

---

## 3. Engine improvements

### 3.1 Code structure
- Split the code into `$INCLUDE` files: `types.bi`, `globals.bi`, `input.bm`, `render.bm`, `entities.bm`, `behaviors.bm`, `levels.bm`, `audio.bm`, `ui.bm`. The game still compiles to a single exe.
- Replace the `GOTO RestartGame`/`AssignKeys` flow with a **game state machine**:
  `TITLE → OPTIONS → BRIEFING → PLAYING ⇄ PAUSED → CHAPTER_CLEAR → GAME_OVER / ENDING`.
- Turn the GOSUBs into SUBs, and group the globals into TYPEs (`Player`, `Game`, `Hud`) instead of ~100 loose variables.

### 3.2 Timing
- Beams currently move one cell per frame, so their speed depends on the frame rate. Give every moving thing a speed in **cells per second** and move it by `dt` using `SINGLE` positions.
- Keep `GetTICKS` (the pause-aware clock is good). Run logic at a fixed 60 Hz and draw at whatever rate the machine manages.

### 3.3 Entity pools
Use one pool per kind of thing, with a shared lifecycle (`Active`, `Spawn`, `Update`, `Draw`, `Kill`):

| Pool | Replaces | Notes |
|------|----------|-------|
| `Enemies()` | today's array | Each enemy references a `SpriteID` instead of carrying a 4 KB shape string. Today's 200 × ~4.8 KB is mostly unused padding. |
| `Bullets()` | `Beams()` and `EnemyBeams()` | Adds `Owner`, `DX`/`DY` (SINGLE), `Damage`, `Char`, `Color`, `Lifetime`, `Pierce`. This allows aimed, angled and spread shots. |
| `Pickups()` | the single global `Bonus.*` | Lets several pickups be on screen and enemies drop items. |
| `FX()` | `Boom.*` and the points pop-up | Explosions, sparks, debris and floating score text, all running at the same time. |

### 3.4 Data-driven enemy definitions
```basic
TYPE EnemyDefType
    Name AS STRING * 16
    SpriteID AS INTEGER          ' index into Sprites()
    HP AS INTEGER
    Points AS INTEGER
    Speed AS SINGLE              ' cells/sec
    Behavior AS INTEGER          ' see 3.5
    P1 AS SINGLE: P2 AS SINGLE: P3 AS SINGLE  ' behavior params
    FirePattern AS INTEGER       ' NONE, BEAM, AIMED, SPREAD3, RING, ZAP...
    FireRate AS SINGLE
    DropTable AS INTEGER
    OnDeath AS INTEGER           ' NOTHING, SPLIT, SPAWN, EXPLODE_AREA
    WoundedDef AS INTEGER        ' today's "second form" (chapters 1 & 2)
END TYPE
```
`CreateEnemy id, Chapter` becomes `SpawnEnemy defID, x, y`, and the per-chapter `SELECT CASE` blocks go away.

### 3.5 Movement behaviors
Replace the `MKI$` step strings with a behavior id plus parameters. Each behavior is one `SELECT CASE` branch.

- `PATTERN`: the current step strings, kept for compatibility.
- `ZIGZAG`: the current default.
- `CHASE`: the current kamikaze.
- `SINE`: amplitude and period.
- `DIVE`: approach, then swoop at the player's row.
- `HOVER_SHOOT`: stop at column X, fire N times, retreat.
- `FORMATION`: follow a leader with an offset (V, line and wave shapes).
- `ORBIT`: circle a point or a parent entity (boss satellites).
- `FOLLOW_PATH`: replay the leader's position history (for segmented bosses).
- `ANCHORED`: fixed to terrain (turrets).
- `MIRROR`: copies the player's input (final boss).

### 3.6 Level scripts
Each chapter becomes a text file that the engine reads at load time, so you can edit levels without recompiling:

```
# levels/05_rock_alley.lvl
NAME   ROCK ALLEY
MUSIC  sector2.ogg
GOAL   SURVIVE 90
AT 0   TIP  BASE: ASTEROID FIELD AHEAD, CAPTAIN.
AT 1   WAVE ROCK_L  x4  RANDOM
AT 6   WAVE FIGHTER x5  FORMATION V  Y=8
AT 20  TIP  CAPTAIN: SOMETHING IS MOVING|INSIDE THOSE ROCKS...
AT 22  WAVE DRILLER x3  FROM ROCK
AT 40  SPAWN PICKUP WEAPON
LOOP   6 TO 40
```
- Goal types: `KILLS n`, `SURVIVE secs`, `DISTANCE n`, `BOSS name`, `COLLECT n`.
- Radio tips fire on script events instead of a fixed 15 s timer.
- Chapters 1–4 get ported to scripts first. That proves the format can reproduce today's game.

### 3.7 Sprites
- Move shapes out of DATA into `sprites/*.txt`: CP437 art plus a matching **per-cell color layer**. Today each enemy has a single color, except for the `ColorPattern` cycling.
- Optional side project: a small sprite editor written in QB64, which would make art much faster to produce.

### 3.8 Collision map
- Make `ScreenMap` an `INTEGER` array with clean encoding: `type * 1000 + index` (`ENEMY`, `ENEMY_PART`, `BULLET`, `PICKUP`, `TERRAIN`).
- Add `ENEMY_PART` so bosses can have weak points and armored areas.
- Optionally use a half-row map (80×50) so bullets and enemies get the same vertical precision as the ship.

### 3.9 Rendering and feel
- **Hit flash:** multi-HP enemies flash white for one frame when hit. Today the only feedback is the 5-cell knockback.
- **Background layers:** large hardware images (planets, nebula clouds, the enemy armada far away) drawn behind the text layer, using the same trick as the shield. They cost almost nothing to draw.
- **Screen flash and shake:** extend the existing damage palette flash to big explosions and boss deaths.
- **Boss entrance:** a flashing "⚠ WARNING ⚠" banner and siren.
- **Smoother scrolling:** add a fourth star layer and occasional streaking "warp" stars when moving forward.

### 3.10 Input
- Look up button indices once. Today `GetButton` runs `UCASE$`/`RTRIM$` string compares across the whole map on every call, roughly 8 times per frame.
- Distinguish **pressed this frame** from **held**, so menus and specials don't need hand-rolled `> .3` debounce timers.
- Ship with default keyboard bindings (arrows, Z/X, Enter, Shift) so first launch needs no setup.
- Let keyboard and gamepad work at the same time, with rebinding in Options.

### 3.11 Audio
- `SONG(Level + 2)` always plays `level1.ogg` because `Level` never changes. Use one song per sector, plus boss, ending and title themes.
- New sound effects: boss warning, pickup, menu move/select, weapon upgrade, smart bomb, mine beep, low-energy beep.
- Separate music and sound volumes, saved in the config file.

### 3.12 Saving and debugging
- `config.dat` for controls, volumes, difficulty and fullscreen; it replaces `controller.dat`. Also save a high-score table and unlocked sectors.
- Debug overlay (F1): FPS, entity counts, current script line. Add a level-select cheat and invincibility, both behind `-god`.

---

## 4. Gameplay systems

### 4.1 Weapons
Collect **W** pickups to raise the weapon level. Taking damage drops it by one level, which fits the existing big→small ship mechanic.

| Lv | Weapon |
|----|--------|
| 1 | Single laser (today) |
| 2 | Twin laser (two rows) |
| 3 | Twin plus **diagonal spread**. The existing diagonal fire animation becomes damaging; the commented-out code at L659–676 shows this was already planned. |
| 4 | Piercing beam: passes through enemies and cancels enemy shots |

### 4.2 Specials
The SPECIAL button uses the current special, and SELECT cycles through them. `CurrentSpecial` is already set up for this, and SELECT currently does nothing.

- **Time Freeze**: already in the game.
- **Smart Bomb**: clears the screen of normal enemies and bullets, and deals heavy damage to a boss.
- **Homing Missiles**: 6 missiles that track the nearest enemies.
- **Overdrive**: rapid fire with no energy cost for 8 s.
- **Shield**: becomes something you can carry and use when you choose, in addition to auto-use on pickup.

The HUD shows the carried specials as icons on row 1, the same way freeze charges are shown today.

### 4.3 Energy
Energy spent on moving and shooting sets this game apart, so keep it. Add:
- energy cells dropped by some enemies,
- a short recharge pit stop between chapters,
- a percentage readout next to the bar.

### 4.4 Scoring
- **Combo multiplier:** kills within 1.5 s of each other chain into ×2, ×3 … ×8.
- **Chapter tally screen:** kills, accuracy, damage taken, a no-damage bonus and time.
- An extra life every 50,000 points.
- A high-score table with 3-letter initials.

### 4.5 Difficulty
`EASY` exists as a constant but is never used. Turn it into Easy / Normal / Hard settings that scale:
- enemy fire rate and HP,
- energy drain,
- the `WeKilledFirst` rule ("enemies only shoot after you've attacked"). This rule becomes Easy-only.

### 4.6 Boss framework
- An HP bar on row 25, reusing `LifeBarImage`.
- Phases triggered at HP thresholds (e.g. 66% and 33%), each with a new behavior and fire pattern.
- Weak points and armored parts using `ENEMY_PART` codes in the collision map.
- The boss can't be damaged during its entrance.
- A death sequence with chained explosions, a screen flash and a score shower.

### 4.7 Terrain and hazards
- Scrolling top and bottom walls built from CP437 tiles. They write `TERRAIN` codes into the collision map.
- Laser gates, ion storms and asteroids.

---

## 5. Campaign: 5 sectors, 20 chapters

**Story arc.** It builds on existing radio lines. In chapter 1 the captain says *"Sometimes I can almost believe they're coordinated"*, and in chapter 4 the base reports *"These are not metal ships… these creatures are radioactive"*. The payoff: the invaders are a single biological **Hive Mind**, and the player flies to its homeworld.

### Sector 1: Outer Rim (existing, polished)
| Ch | Name | Content | Goal |
|----|------|---------|------|
| 1 | Let There Be War! | Fighters | 50 kills |
| 2 | Looking for Flying Saucers in the Sky | Saucers | 50 kills |
| 3 | Kamikaze Frenzy | Kamikazes | 100 kills |
| 4 | **BOSS: Space Amoeba** | New: fires aimed "spore" shots; at 50% HP it **splits** into two half-size amoebas. | Boss |

### Sector 2: The Asteroid Belt
| Ch | Name | Content | Goal |
|----|------|---------|------|
| 5 | Rock Alley | Asteroids that break into smaller rocks when shot, plus a few fighters | Survive 90 s |
| 6 | Minefield | Mines and Minelayers | 40 kills |
| 7 | Drillers | Drillers burst out of asteroids | 40 kills |
| 8 | **BOSS: The Roach** | Uses the **Cockroach sprite already in the code** (28×14, 4 frames; currently unused). It scuttles along the top and bottom edges and lays eggs that hatch into Larvae. | Boss |

### Sector 3: Ion Nebula
| Ch | Name | Content | Goal |
|----|------|---------|------|
| 9 | Into the Fog | Limited visibility: enemies are drawn in dark gray except near your ship. Jellyfish. | 40 kills |
| 10 | Ion Storm | Lightning columns flash a warning, then strike, and drain energy unless you're shielded | Survive 90 s |
| 11 | Phantoms | Cloaking fighters, visible only when they fire | 30 kills |
| 12 | **BOSS: Nebula Leviathan** | A segmented space serpent: the head plus 12 segments, each repeating the head's path. Destroy the segments to expose the head. | Boss |

### Sector 4: The Armada
| Ch | Name | Content | Goal |
|----|------|---------|------|
| 13 | Picket Line | Interceptors in V and wave formations; Gunships | 60 kills |
| 14 | Carrier Escort | Mini-boss **Carrier** launches Drone swarms | Destroy the carrier |
| 15 | Fortress Run | Scrolling walls with Turrets, laser gates and narrow passages | Distance |
| 16 | **BOSS: Dreadnought** | A huge multi-part ship that scrolls in. Destroy its 4 turrets, then the core opens. | Boss |

### Sector 5: The Hive
| Ch | Name | Content | Goal |
|----|------|---------|------|
| 17 | Living Walls | Organic terrain and Spore Pods | Distance |
| 18 | Coordinated | Radio: *"You were right, Captain."* Every enemy type attacks in synchronized formations. | 80 kills |
| 19 | Echoes | Boss rush: faster, remixed Amoeba, Roach and Leviathan | Boss ×3 |
| 20 | **FINAL BOSS: The Hive Mind** | 1) A brain behind a rotating ring of cells (`ORBIT`). 2) Spawns red **Mirror Ships** that copy your input. 3) A final burst of radial bullet patterns. | Boss → Ending |

**Bonus stage between sectors: "Supply Run."** High-speed flight with no enemies. Collect energy cells and score stars, and dodge debris. It rewards energy and lives going into the next sector.

---

## 6. Enemy list

| Enemy | Look (CP437) | HP | Pts | Behavior | Attack | First seen |
|-------|--------------|----|-----|----------|--------|------------|
| Fighter *(exists)* | 5×3 `▄▄▄ ▐█▓▒▌` | 2 | 50 | ZIGZAG; becomes a wounded second form when hit | Beam | 1 |
| Saucer *(exists)* | 15×5 with flashing lights | 2 | 100 | ZIGZAG; flees when wounded | Beam | 2 |
| Kamikaze *(exists)* | 5×3 | 1 | 50 | CHASE | Ramming | 3 |
| Asteroid L / M / S | `▒▓▒` blobs, 6×3 / 3×2 / 1×1 | 4/2/1 | 20/10/5 | Drift; split on death | Collision | 5 |
| Mine | `☼` (CHR 15), blinks red when armed | 1 | 30 | Drift; arms when the ship is within 10 cells | Explodes in a + pattern | 6 |
| Minelayer | 9×3 | 4 | 150 | Moves along fixed rows, drops mines | — | 6 |
| Driller | `►◄` with a `≡` drill | 2 | 80 | Hides in an asteroid, then DIVEs | Ramming | 7 |
| Larva | `~∞~` | 1 | 10 | CHASE (slow) | Ramming | 8 |
| Jellyfish | `▲` dome with `║║` tentacles | 3 | 120 | SINE, slow | Short vertical zap | 9 |
| Phantom | 7×3, drawn in color 8 while cloaked | 2 | 200 | Cloaks and uncloaks | Aimed shot when visible | 11 |
| Interceptor | `═►` | 1 | 75 | FORMATION | — | 13 |
| Gunship | 9×4 | 6 | 300 | HOVER_SHOOT | 3-way spread | 13 |
| Drone | `·` / `•` | 1 | 25 | Swarm, launched by the Carrier | Ramming | 14 |
| Turret | `╦` / `╩` on walls | 3 | 100 | ANCHORED | Aimed shots | 15 |
| Spore Pod | `○` on organic walls | 4 | 150 | ANCHORED | Releases spores (slow homing) | 17 |
| Mirror Ship | Your ship's sprite in red | 2 | 500 | MIRROR | Copies your shots | 20 |

**Bosses:** Space Amoeba (exists) · The Roach (sprite exists) · Carrier (mini-boss) · Nebula Leviathan · Dreadnought · Hive Mind.

---

## 7. Menus and screens
- **Title / attract mode:** the existing logo over a live starfield, plus a menu: *Start · Continue · Sector Select · Options · High Scores · Quit*.
- **Options:** difficulty, music and sound volume, fullscreen, controls (detect, rebind, reset), and a "swap fire/special" toggle.
- **Briefing:** a short radio intro before each sector.
- **Chapter clear:** the tally from §4.4.
- **Game over:** continue (score resets, chapter kept), then high-score entry.
- **Ending and credits** after the Hive Mind.

---

## 8. Milestones

| Milestone | Scope | Done when |
|-----------|-------|-----------|
| **M0: Fixes** | Bugs from §2, godMode off, cp437 setting, `.gitignore` | The current game plays cleanly from start to boss |
| **M1: Engine refactor** | State machine, `$INCLUDE` split, entity pools (bullets, FX, pickups), input cache, `dt` movement | The game plays **the same as before**, and multiple explosions work |
| **M2: Data-driven content** | `EnemyDef`, behaviors, sprite files, level script loader; chapters 1–4 ported to scripts | Chapters 1–4 run from `.lvl` files |
| **M3: Gameplay systems** | Weapons, specials, combo scoring, boss framework (HP bar and phases), difficulty | The amoeba fight uses the new boss framework |
| **M4: Sector 2** | Asteroids, mines, drillers, larvae, **The Roach** | First new sector is playable from start to finish |
| **M5: Menus and screens** | Title and menu, options, rebinding, high scores, `config.dat` | First launch needs no setup |
| **M6: Sectors 3–5** | Terrain system, nebula effects, Leviathan, Dreadnought, Hive Mind, ending | The full campaign can be finished |
| **M7: Polish** | New music, balance pass, playtesting, bonus stages | Release |

**Recommended order:** M0, then M1. Every enemy and level after that is mostly data instead of new code, so it gets much cheaper to add.

---

## 9. Open questions
1. **Stay in 80×25 text mode?** This plan assumes yes, since it is the game's identity. A half-row collision map (§3.8) gives finer motion without leaving text mode.
2. **Keep the energy-drain mechanic** on every difficulty, or only on Normal and Hard?
3. **External level and sprite files, or everything compiled in?** Files are easier to edit; compiled-in content is simpler to ship.
