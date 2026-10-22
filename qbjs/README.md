# Spaceship for the web (QBJS)

This folder builds a browser version of Spaceship with [QBJS](https://github.com/boxgaming/qbjs). It uses the same game code (`Spaceship.bas`, `src/`) and the same `data/` and `Audio/` as the QB64 version. Nothing here changes the QB64 build.

## Building

You need [Node.js](https://nodejs.org/) 18 or newer and a copy of the QBJS repository.

```
node qbjs/build.js                      # uses ~/git/qbjs
node qbjs/build.js --qbjs /path/to/qbjs # or set QBJS_HOME
```

The result is `qbjs/dist/`, a static website: `index.html`, the compiled `program.js`, the QBJS runtime, and copies of `data/` and `Audio/`. Serve it with any web server and open it in a browser:

```
python3 -m http.server 8000 -d qbjs/dist
```

Then go to http://localhost:8000. Opening `index.html` straight from disk does not work, because browsers don't let pages load files that way.

The folder can be uploaded as it is to any static host, such as GitHub Pages or itch.io (as an HTML game).

Rebuild after changing the game code or data. `dist/` is not kept in git.

## Packages for distribution

The build also writes two zip files to `qbjs/packages/` (not kept in git either):

- **`spaceship-qbjs.zip`** is a QBJS project. Open it in the QBJS IDE (Open, then pick the zip) or put it online and share a link that plays it straight away:
  `https://qbjs.org/?mode=play&src=https://example.com/spaceship-qbjs.zip`
  (`mode=auto` starts it without the play button). The server hosting the zip must allow cross-origin requests (raw.githubusercontent.com does).
  Its `main.bas` is only a loader: the IDE's compiler can't apply the build's fixes, so the project carries the already-compiled `program.js` and runs that, with `platform.js`, `data/` and `Audio/`.
- **`spaceship-web.zip`** is the standalone site (the contents of `dist/`). Upload it to itch.io as an HTML game, or unzip it on any web host.

## Testing

```
node qbjs/smoketest.js                                     # autopilot, 600 s of game time
node qbjs/smoketest.js -chapter 20 -autotest 800 -fast -god
```

This runs the game's autopilot in headless Chrome, prints the game log, and fails if the page throws an error. Set `CHROME` to the browser executable if it isn't found.

In the browser, the same command line options go in the address, separated by `&`:
`http://localhost:8000/?-chapter&9&-god`

## How it works

`build.js` reads `Spaceship.bas`, expands the `$INCLUDE` files, and changes the merged program in four ways before compiling it:

1. **Rewrite rules** (`RULES` in `build.js`) remove QB64-only statements (`$RESIZE`, `DECLARE LIBRARY`, `ON ERROR`, `_SCREENMOVE`...) and rename sound and gamepad calls to the web versions in `web.bm`. They also work around a few QBJS compiler gaps: `MID$(...) = ...` assignments, `OPEN` with an expression as the file name, numbers like `1E+09`, and `a.Field \ n`. Each rule states how many times it must match, so if the game code changes under a rule, the build stops and says which one.
2. **`overrides.bm`** replaces whole routines that have no QBJS equivalent (`LogMsg` writes to the browser console). An override must have the same name as a routine in `src/`.
3. **`web.bm`** adds the helpers the rules point to (`QJ_SndPlayCopy`, `QJ_Button%`...), which call into `platform.js`.
4. After compiling, it fixes two QB rules in the generated JavaScript: comparisons give -1 for true (QBJS gives 1, which breaks `NOT`), and assigning a TYPE variable copies it (QBJS shares it).

`platform.js` runs in the page next to the QBJS runtime:

- **Text mode.** QBJS has no real 80x25 text screen, so this file keeps a grid of character cells. `_PRINTSTRING` writes cells in column/row coordinates, the palette applies to the whole screen, colors 16-31 blink, and images put on the screen go behind the text, as in QB64.
- **Sound.** Web Audio plays the WAV and OGG files. A small built-in synthesizer plays the MIDI songs, since browsers can't play MIDI on their own.
- **Gamepad** through the browser's Gamepad API. Browsers only report a controller after you press one of its buttons.
- **Settings and high scores** (`spaceship.cfg`, `scores.dat`) are saved in the browser's local storage.
- Small fixes to QBJS runtime functions so they behave like QB64's (`STRING$`, `VAL`, `_PUTIMAGE`, `_COPYIMAGE`, `_FREEIMAGE`, `_FULLSCREEN`).

## Differences from the QB64 version

- The game starts after a click (browsers only allow sound after one).
- QUIT shows a goodbye screen. Press any key to play again.
- The MIDI songs use the built-in synthesizer, so they sound simpler than through QB64's MIDI player.
- There is no log file. Log lines go to the browser's developer console.
- Autotest screenshots (`-shots`) are not available.
- No touch controls: you need a keyboard or a gamepad.
- Browsers that can't decode Ogg Vorbis (some older Safari versions) play those three songs silently.
