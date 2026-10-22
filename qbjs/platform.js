// Spaceship (QBJS build) - browser platform layer.
//
// The game is written for QB64's 80x25 text screen. QBJS draws text straight onto a
// canvas, which is not quite the same thing, so this file adds what the game expects:
//
//  * Text mode: an 80x25 grid of character cells. _PRINTSTRING on the screen writes
//    cells (in column/row coordinates, like QB64's SCREEN 0), CLS clears them, and
//    _DISPLAY draws the frame. A cell replaces whatever was in it before, palette
//    changes (_PALETTECOLOR) apply to the whole screen, colors 16-31 blink, and
//    images put on the screen with _PUTIMAGE go behind the text, like QB64's
//    hardware images with _DISPLAYORDER _HARDWARE, _SOFTWARE.
//  * Sound with Web Audio: many copies of an effect at once (_SNDPLAYCOPY), looping
//    music with pause and resume, and a small synthesizer for the MIDI songs.
//  * Gamepad through the browser Gamepad API.
//  * spaceship.cfg and scores.dat are kept in the browser's localStorage.
//  * Command line options come from the page address: index.html?-chapter&5&-god
//  * Letter keys are tracked by physical key, so Shift does not leave them stuck.
//  * A few QBJS runtime functions behave like QB64's: STRING$ with a character code,
//    VAL, _COPYIMAGE after PSET, _PUTIMAGE with a source rectangle, _FREEIMAGE of
//    the current _DEST, and _FULLSCREEN _OFF when not in full screen.
//
// It is loaded after qb.js and before program.js. (Two more fixes, for comparisons
// and TYPE assignments, are applied to the compiled program by build.js.)

"use strict";

var SSWeb = window.SSWeb || (function () {
    const COLS = 80, ROWS = 25, CW = 8, CH = 16, CELLS = COLS * ROWS;

    // ------------------------------------------------------------------ text mode
    const cellCh = new Uint8Array(CELLS);
    const cellFg = new Float64Array(CELLS);  // 0-31, or a 32-bit color
    const cellBg = new Float64Array(CELLS);
    let curFg = 7, curBg = 0;
    const hwQueue = [];

    // QB64's 16 text colors
    const DEFAULT_PAL = [
        0x000000, 0x0000AA, 0x00AA00, 0x00AAAA, 0xAA0000, 0xAA00AA, 0xAA5500, 0xAAAAAA,
        0x555555, 0x5555FF, 0x55FF55, 0x55FFFF, 0xFF5555, 0xFF55FF, 0xFFFF55, 0xFFFFFF];
    const pal = new Array(16);   // css color strings, null = transparent

    function css32(c) {
        const a = (c >>> 24) & 255, r = (c >>> 16) & 255, g = (c >>> 8) & 255, b = c & 255;
        if (a === 0) return null;
        return a === 255 ? "rgb(" + r + "," + g + "," + b + ")" : "rgba(" + r + "," + g + "," + b + "," + (a / 255) + ")";
    }

    function resetPalette() {
        for (let i = 0; i < 16; i++) pal[i] = css32(0xFF000000 | DEFAULT_PAL[i]);
    }

    function colorOf(v) {
        if (v >= 0 && v < 16) return pal[v];
        if (v >= 16 && v < 256) return pal[v & 15];
        return css32(v);
    }

    function clearCells(bg) {
        cellCh.fill(32);
        cellFg.fill(7);
        cellBg.fill(bg);
    }

    // Glyph atlas: the 256 CP437 characters drawn in white with QBJS's DOS font,
    // then one tinted copy per color in use
    let atlas = null;
    const tinted = new Map();

    function buildAtlas() {
        atlas = document.createElement("canvas");
        atlas.width = 256 * CW;
        atlas.height = CH;
        const ctx = atlas.getContext("2d");
        ctx.font = "16px dosvga";
        ctx.fillStyle = "#fff";
        for (let c = 0; c < 256; c++) {
            if (c === 0 || c === 32 || c === 255) continue;
            const s = QB.convertToUTF(String.fromCharCode(c));
            const tm = ctx.measureText(s);
            const fh = tm.fontBoundingBoxAscent ? tm.fontBoundingBoxAscent + tm.fontBoundingBoxDescent
                : tm.actualBoundingBoxAscent + tm.actualBoundingBoxDescent;
            ctx.save();
            ctx.beginPath();
            ctx.rect(c * CW, 0, CW, CH);
            ctx.clip();
            ctx.fillText(s, c * CW, fh - 4);  // same baseline as QBJS's _PRINTSTRING
            ctx.restore();
        }
        tinted.clear();
    }

    function glyphs(color) {
        let g = tinted.get(color);
        if (!g) {
            g = document.createElement("canvas");
            g.width = atlas.width;
            g.height = atlas.height;
            const ctx = g.getContext("2d");
            ctx.drawImage(atlas, 0, 0);
            ctx.globalCompositeOperation = "source-in";
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, g.width, g.height);
            tinted.set(color, g);
        }
        return g;
    }

    // The text layer is drawn on its own canvas and then laid over the images, like
    // QB64's software screen over its hardware images. Characters in a transparent
    // color (the game makes color 0 transparent) cut holes in their cell background.
    let layer = null;

    let frameCount = 0;

    function render() {
        frameCount++;
        if (!atlas) buildAtlas();
        const canvas = QB.getImage(0);
        const ctx = canvas.getContext("2d");
        if (!layer) {
            layer = document.createElement("canvas");
            layer.width = COLS * CW;
            layer.height = ROWS * CH;
        }
        const lc = layer.getContext("2d");
        lc.globalCompositeOperation = "source-over";
        lc.clearRect(0, 0, layer.width, layer.height);

        // Cell backgrounds, in runs of the same color
        for (let r = 0; r < ROWS; r++) {
            let c = 0;
            while (c < COLS) {
                const i = r * COLS + c;
                const color = colorOf(cellBg[i]);
                let n = 1;
                while (c + n < COLS && cellBg[i + n] === cellBg[i]) n++;
                if (color) {
                    lc.fillStyle = color;
                    lc.fillRect(c * CW, r * CH, n * CW, CH);
                }
                c += n;
            }
        }

        // Characters
        const blinkOn = (performance.now() % 500) < 250;
        let holes = false;
        for (let pass = 0; pass < 2; pass++) {
            if (pass === 1) {
                if (!holes) break;
                lc.globalCompositeOperation = "destination-out";
            }
            for (let i = 0; i < CELLS; i++) {
                const ch = cellCh[i];
                if (ch === 32 || ch === 0 || ch === 255) continue;
                let fg = cellFg[i];
                if (fg >= 16 && fg < 32) {
                    if (!blinkOn) continue;
                    fg -= 16;
                }
                const color = colorOf(fg);
                if (pass === 0) {
                    if (!color) { holes = true; continue; }
                    lc.drawImage(glyphs(color), ch * CW, 0, CW, CH, (i % COLS) * CW, ((i / COLS) | 0) * CH, CW, CH);
                } else if (!color) {
                    lc.drawImage(glyphs("#000"), ch * CW, 0, CW, CH, (i % COLS) * CW, ((i / COLS) | 0) * CH, CW, CH);
                }
            }
        }

        // Compose: black, then the images, then the text layer
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
        for (const args of hwQueue) origPutImage.apply(QB, args);
        hwQueue.length = 0;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        ctx.drawImage(layer, 0, 0);
        ctx.restore();
    }

    // ------------------------------------------------------------------ QB patches
    let origPutImage = null;

    // _PUTIMAGE coordinates the QB64 way, written out for QBJS:
    //  - a STEP second corner is relative to the first corner of the same rectangle
    //  - rectangles include both corners: (0,0)-(9,9) is 10x10 pixels
    //  - with only a top-left destination, a source rectangle is copied at its own size
    //    (QBJS stretches it to the whole source image size)
    function putImageArgs(a) {
        let [dstep1, dx1, dy1, dstep2, dx2, dy2, src, dst, sstep1, sx1, sy1, sstep2, sx2, sy2, smooth] = a;
        if (sx1 !== undefined && sx2 !== undefined && !sstep1) {
            if (sstep2) { sx2 += sx1; sy2 += sy1; sstep2 = false; }
            const x0 = Math.min(sx1, sx2), x1 = Math.max(sx1, sx2), y0 = Math.min(sy1, sy2), y1 = Math.max(sy1, sy2);
            sx1 = x0; sy1 = y0; sx2 = x1 + 1; sy2 = y1 + 1;
            if (dx1 !== undefined && dx2 === undefined && !dstep1) {
                dx2 = dx1 + (sx2 - sx1);
                dy2 = dy1 + (sy2 - sy1);
                dstep2 = false;
            }
        }
        if (dx1 !== undefined && dx2 !== undefined && !dstep1) {
            if (dstep2) { dx2 += dx1; dy2 += dy1; dstep2 = false; }
        }
        return [dstep1, dx1, dy1, dstep2, dx2, dy2, src, dst, sstep1, sx1, sy1, sstep2, sx2, sy2, smooth];
    }

    function install() {
        const origColor = QB.sub_Color;
        QB.sub_Color = function (fg, bg) {
            if (fg !== undefined) curFg = fg;
            if (bg !== undefined) curBg = bg;
            return origColor.apply(QB, arguments);
        };

        const origPrint = QB.sub__PrintString;
        QB.sub__PrintString = function (x, y, s) {
            if (QB.func__Dest() !== 0) return origPrint.apply(QB, arguments);
            const row = Math.round(y) - 1;
            if (row < 0 || row >= ROWS) return;
            const str = QB.convertTo437(String(s));
            let col = Math.round(x) - 1;
            for (let k = 0; k < str.length; k++, col++) {
                if (col < 0 || col >= COLS) continue;
                const i = row * COLS + col;
                cellCh[i] = str.charCodeAt(k) & 255;
                cellFg[i] = curFg;
                cellBg[i] = curBg;
            }
        };

        const origCls = QB.sub_Cls;
        QB.sub_Cls = function (method, bg) {
            if (QB.func__Dest() !== 0) return origCls.apply(QB, arguments);
            clearCells(bg !== undefined ? bg : curBg);
        };

        origPutImage = QB.sub__PutImage;
        QB.sub__PutImage = function () {
            const args = putImageArgs(Array.prototype.slice.call(arguments));
            let dest = args[7];
            if (dest === undefined) dest = QB.func__Dest();
            if (dest === 0) {
                hwQueue.push(args);
                return;
            }
            return origPutImage.apply(QB, args);
        };

        const origPalette = QB.sub__PaletteColor;
        QB.sub__PaletteColor = function (i, c) {
            if (i >= 0 && i < 16) pal[i] = css32(c >>> 0);
            return origPalette.apply(QB, arguments);
        };

        QB.sub__Display = function () { render(); };

        // Letter keys: QBJS tracks "z" and "Z" separately, so releasing Z while Shift
        // is held would leave "z" down. Answer from the physical keys instead.
        const origKeyDown = QB.func__KeyDown;
        QB.func__KeyDown = function (k) {
            if ((k >= 65 && k <= 90) || (k >= 97 && k <= 122)) {
                return physKeys.has("Key" + String.fromCharCode(k & ~32)) ? -1 : 0;
            }
            return origKeyDown.apply(QB, arguments);
        };

        // Command line options from the page address
        QB.func__CommandCount = function () { return cmdArgs.length; };
        QB.func_Command = function (i) {
            if (i === undefined) return cmdArgs.join(" ");
            if (i === 0) return "spaceship";
            return cmdArgs[i - 1] || "";
        };

        // Keep the settings and scores files in localStorage
        const origClose = QB.sub_Close;
        QB.sub_Close = function () {
            const r = origClose.apply(QB, arguments);
            saveFiles();
            return r;
        };

        // QB64 refuses to free the image that is the current _DEST (the game's error
        // handler then skips the line); QBJS would free it and fail on the next _DEST
        const origFree = QB.sub__FreeImage;
        QB.sub__FreeImage = function (imageId) {
            if (imageId === undefined || imageId === QB.func__Dest() || imageId === 0) return;
            return origFree.apply(QB, arguments);
        };

        // QBJS keeps PSET pixels in a cache that _COPYIMAGE does not flush first:
        // switching _DEST to the source and back flushes it
        const origCopy = QB.func__CopyImage;
        QB.func__CopyImage = function (src) {
            const d = QB.func__Dest();
            QB.sub__Dest(src === undefined ? d : src);
            QB.sub__Dest(d);
            return origCopy.apply(QB, arguments);
        };

        // STRING$(n, code) must map the code through CP437 like CHR$ does
        // (QBJS's STRING$(5, 196) gives five A-umlauts instead of a line)
        const origString = QB.func_String;
        QB.func_String = function (n, s) {
            if (typeof s !== "string") s = QB.func_Chr(s);
            return origString.call(QB, n, s);
        };

        // VAL as QB64 does it: read the number at the start, ignore the rest
        // (QBJS 's VAL returns 0 for text like "12,5" and logs to the console)
        QB.func_Val = function (value) {
            const v = String(value).replace(/\s+/g, "").toUpperCase();
            const pre = v.substring(0, 2);
            let r;
            if (pre === "&H") r = parseInt(v.slice(2), 16);
            else if (pre === "&O") r = parseInt(v.slice(2), 8);
            else if (pre === "&B") r = parseInt(v.slice(2), 2);
            else {
                const m = v.match(/^[+-]?(\d+\.?\d*|\.\d+)([ED][+-]?\d+)?/);
                r = m ? Number(m[0].replace("D", "E")) : 0;
            }
            return isNaN(r) ? 0 : r;
        };

        // The browser only changes full screen mode on request, and throws if asked
        // to leave it when it is not in it
        const origFull = QB.sub__FullScreen;
        QB.sub__FullScreen = function (mode) {
            const isFull = !!document.fullscreenElement;
            if ((mode === QB.OFF) !== isFull) return;
            try { return origFull.apply(QB, arguments); } catch (e) { }
        };

        // spaceship.cfg and scores.dat come from localStorage: don't look for them on the server
        const origExists = QB.func__FileExists;
        QB.func__FileExists = async function (p) {
            if (SAVED.includes(String(p).toLowerCase())) {
                const vfs = QB.vfs(), f = vfs.getNode(p, QB.vfsCwd());
                return f && f.type === vfs.FILE ? -1 : 0;
            }
            return origExists.apply(QB, arguments);
        };

        const origHalt = QB.halt;
        QB.halt = function () {
            stopAllSound();
            return origHalt.apply(QB, arguments);
        };
    }

    // ------------------------------------------------------------------ keyboard
    const physKeys = new Set();
    addEventListener("keydown", e => { physKeys.add(e.code); unlockAudio(); });
    addEventListener("keyup", e => physKeys.delete(e.code));
    addEventListener("blur", () => physKeys.clear());

    // ------------------------------------------------------------------ arguments
    const cmdArgs = (function () {
        const q = location.search.replace(/^\?/, "");
        if (!q) return [];
        const list = q.split(/[&+]/).map(s => decodeURIComponent(s)).filter(s => s.length);
        // name=value pairs belong to the page that hosts the game (the QBJS IDE uses
        // ?mode=play&src=...), not to the game
        return list.some(s => s.includes("=")) ? [] : list;
    })();

    // ------------------------------------------------------------------ saved files
    const SAVED = ["spaceship.cfg", "scores.dat"];
    const STORE = "spaceship-qbjs/";

    function loadFiles() {
        const vfs = QB.vfs();
        const root = vfs.rootDirectory();
        for (const name of SAVED) {
            let text = null;
            try { text = localStorage.getItem(STORE + name); } catch (e) { }
            if (text === null) continue;
            const f = vfs.createFile(name, root);
            vfs.writeText(f, text);
        }
    }

    function saveFiles() {
        const vfs = QB.vfs();
        for (const name of SAVED) {
            const f = vfs.getNode(name, vfs.rootDirectory());
            if (!f || f.type !== vfs.FILE) continue;
            try { localStorage.setItem(STORE + name, vfs.readText(f)); } catch (e) { }
        }
    }

    // ------------------------------------------------------------------ sound
    let actx = null, master = null;
    const sounds = [];   // handle - 1

    function audioCtx() {
        if (!actx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            actx = new AC();
            master = actx.createGain();
            master.connect(actx.destination);
        }
        return actx;
    }

    function unlockAudio() {
        const c = audioCtx();
        if (c && c.state === "suspended") c.resume();
    }

    function sndOpen(file) {
        const s = { file: file, ready: false, failed: false, buffer: null, song: null,
            vol: 1, looping: false, paused: false, src: null, gain: null, startAt: 0, offset: 0 };
        sounds.push(s);
        const handle = sounds.length;
        const ctx = audioCtx();
        readFile(file).then(data => {
            if (/\.midi?$/i.test(file)) {
                s.song = parseMidi(data);
                return;
            }
            return new Promise((ok, bad) => ctx.decodeAudioData(data, ok, bad)).then(b => { s.buffer = b; });
        }).then(() => {
            s.ready = true;
            if (s.looping && !s.paused) startLoop(s);
        }).catch(err => {
            s.failed = true;
            console.warn("Spaceship: could not load " + file + ": " + err);
        });
        return handle;
    }

    // From the QBJS virtual file system (a project loaded in the QBJS IDE), or the server
    function readFile(file) {
        const vfs = QB.vfs(), f = vfs.getNode(file, QB.vfsCwd());
        if (f && f.type === vfs.FILE) return Promise.resolve(f.data.slice(0));
        return fetch(file).then(r => {
            if (!r.ok) throw new Error(r.status + " " + r.statusText);
            return r.arrayBuffer();
        });
    }

    function snd(h) { return sounds[h - 1]; }

    function sndPlayCopy(h, vol) {
        const s = snd(h);
        if (!s || !s.ready || !s.buffer || !actx) return;
        const src = actx.createBufferSource();
        src.buffer = s.buffer;
        const g = actx.createGain();
        g.gain.value = vol;
        src.connect(g).connect(master);
        src.start();
    }

    function startLoop(s) {
        if (!actx || s.src || s.player) return;
        s.gain = actx.createGain();
        s.gain.gain.value = s.vol;
        s.gain.connect(master);
        if (s.buffer) {
            const src = actx.createBufferSource();
            src.buffer = s.buffer;
            src.loop = true;
            src.connect(s.gain);
            const ofs = s.offset % s.buffer.duration;
            src.start(0, ofs);
            s.startAt = actx.currentTime - ofs;
            s.src = src;
        } else if (s.song) {
            s.player = new MidiPlayer(s.song, s.gain, s.offset);
        }
    }

    function stopNode(s) {
        if (s.src) {
            s.offset = actx.currentTime - s.startAt;
            try { s.src.stop(); } catch (e) { }
            s.src.disconnect();
            s.src = null;
        }
        if (s.player) {
            s.offset = s.player.position();
            s.player.stop();
            s.player = null;
        }
        if (s.gain) { s.gain.disconnect(); s.gain = null; }
    }

    function sndLoop(h) {
        const s = snd(h);
        if (!s) return;
        s.looping = true;
        s.paused = false;
        if (s.ready) startLoop(s);
    }

    function sndPause(h) {
        const s = snd(h);
        if (!s) return;
        if (s.looping) {
            stopNode(s);
            s.paused = true;
            s.looping = false;
        }
    }

    function sndStop(h) {
        const s = snd(h);
        if (!s) return;
        stopNode(s);
        s.offset = 0;
        s.looping = false;
        s.paused = false;
    }

    function sndVol(h, v) {
        const s = snd(h);
        if (!s) return;
        s.vol = v;
        if (s.gain) s.gain.gain.value = v;
    }

    function stopAllSound() {
        for (let i = 1; i <= sounds.length; i++) sndStop(i);
    }

    // --- MIDI: a small synthesizer, good enough for the game's generated songs

    function parseMidi(buf) {
        const b = new DataView(buf);
        let p = 0;
        const u8 = () => b.getUint8(p++);
        const u16 = () => { const v = b.getUint16(p); p += 2; return v; };
        const u32 = () => { const v = b.getUint32(p); p += 4; return v; };
        const vlq = () => { let v = 0, c; do { c = u8(); v = (v << 7) | (c & 127); } while (c & 128); return v; };
        if (u32() !== 0x4D546864) throw new Error("not a MIDI file");
        p += 4;
        u16();
        const ntracks = u16(), div = u16();
        const events = [];
        let endTick = 0;
        for (let t = 0; t < ntracks; t++) {
            if (u32() !== 0x4D54726B) throw new Error("bad MIDI track");
            const len = u32();
            const end = p + len;
            let tick = 0, status = 0, seq = 0;
            while (p < end) {
                tick += vlq();
                let st = b.getUint8(p);
                if (st & 0x80) p++; else st = status;
                if (st < 0xF0) status = st;
                const type = st >> 4, ch = st & 15;
                if (st === 0xFF) {
                    const mt = u8(), len = vlq();
                    if (mt === 0x51) events.push({ tick, seq: seq++, kind: "tempo", v: (b.getUint8(p) << 16) | (b.getUint8(p + 1) << 8) | b.getUint8(p + 2) });
                    if (mt === 0x2F) endTick = Math.max(endTick, tick);
                    p += len;
                } else if (st === 0xF0 || st === 0xF7) {
                    p += vlq();
                } else if (type === 0xC) {
                    events.push({ tick, seq: seq++, kind: "prog", ch, v: u8() });
                } else if (type === 0xD) {
                    p++;
                } else {
                    const a = u8(), c = u8();
                    if (type === 0x9 && c > 0) events.push({ tick, seq: seq++, kind: "on", ch, note: a, vel: c });
                    else if (type === 0x8 || type === 0x9) events.push({ tick, seq: seq++, kind: "off", ch, note: a });
                    else if (type === 0xB) events.push({ tick, seq: seq++, kind: "cc", ch, cc: a, v: c });
                }
            }
            p = end;
        }
        events.sort((x, y) => x.tick - y.tick || (x.kind === "off" ? -1 : 0) - (y.kind === "off" ? -1 : 0));

        // Ticks to seconds, then pair note on/off
        let tempo = 500000, lastTick = 0, time = 0;
        const sec = tick => time + (tick - lastTick) * tempo / 1e6 / div;
        const prog = new Array(16).fill(0), vol = new Array(16).fill(100), pan = new Array(16).fill(64);
        const open = {}, notes = [];
        for (const e of events) {
            const t = sec(e.tick);
            if (e.kind === "tempo") { time = t; lastTick = e.tick; tempo = e.v; continue; }
            if (e.kind === "prog") { prog[e.ch] = e.v; continue; }
            if (e.kind === "cc") { if (e.cc === 7) vol[e.ch] = e.v; if (e.cc === 10) pan[e.ch] = e.v; continue; }
            const key = e.ch * 128 + e.note;
            if (e.kind === "on") {
                if (open[key]) { open[key].dur = t - open[key].t; }
                const n = { t, dur: 0.25, ch: e.ch, note: e.note, vel: e.vel, prog: prog[e.ch], vol: vol[e.ch], pan: pan[e.ch] };
                notes.push(n);
                open[key] = n;
            } else if (open[key]) {
                open[key].dur = Math.max(0.02, t - open[key].t);
                delete open[key];
            }
        }
        const length = Math.max(sec(endTick), notes.length ? notes[notes.length - 1].t + 0.1 : 1);
        return { notes, length };
    }

    // Overall level of the synthesized songs, to sit with the recorded (ogg) music
    const MIDI_GAIN = 1.8;

    // Instrument sounds by General MIDI program
    function patch(prog) {
        if (prog >= 32 && prog <= 39) return { wave: prog === 32 ? "triangle" : "sawtooth", a: 0.005, d: 0.25, s: 0.5, r: 0.08, cut: 900, cutEnv: 2.5, gain: 0.13 };
        if (prog >= 40 && prog <= 47) return { wave: "triangle", a: 0.002, d: 0.9, s: 0.0, r: 0.3, cut: 4000, gain: 0.2 };   // harp
        if (prog >= 8 && prog <= 15) return { wave: "sine", a: 0.002, d: 1.2, s: 0.0, r: 0.6, cut: 8000, gain: 0.16, bell: true };
        if (prog >= 72 && prog <= 79) return { wave: "sine", a: 0.06, d: 0.2, s: 0.8, r: 0.15, cut: 6000, gain: 0.16, vibrato: true }; // flute
        if (prog === 80) return { wave: "square", a: 0.005, d: 0.12, s: 0.6, r: 0.06, cut: 3200, gain: 0.08 };
        if (prog === 81 || prog === 84 || prog === 87) return { wave: "sawtooth", a: 0.005, d: 0.15, s: 0.6, r: 0.08, cut: 2600, gain: 0.08 };
        if (prog >= 88 && prog <= 95) return { wave: "sawtooth", a: 0.35, d: 0.5, s: 0.8, r: 0.6, cut: 1100, gain: 0.045, detune: 9 }; // pads
        if (prog >= 96 && prog <= 103) return { wave: "triangle", a: 0.003, d: 0.6, s: 0.1, r: 0.3, cut: 5000, gain: 0.14, bell: true };
        return { wave: "triangle", a: 0.01, d: 0.3, s: 0.6, r: 0.1, cut: 4000, gain: 0.12 };
    }

    let noiseBuf = null;
    function noise() {
        if (!noiseBuf) {
            noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
            const d = noiseBuf.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        return noiseBuf;
    }

    class MidiPlayer {
        constructor(song, out, startPos) {
            this.song = song;
            this.out = out;
            this.voices = new Set();
            this.t0 = actx.currentTime + 0.05 - (startPos % song.length);
            this.loop = 0;
            this.idx = 0;
            // skip notes before the start position
            const pos = startPos % song.length;
            while (this.idx < song.notes.length && song.notes[this.idx].t < pos) this.idx++;
            this.timer = setInterval(() => this.pump(), 25);
            this.pump();
        }
        position() { return (actx.currentTime - this.t0) % this.song.length; }
        pump() {
            const horizon = actx.currentTime + 0.2;
            const notes = this.song.notes;
            for (; ;) {
                if (this.idx >= notes.length) {
                    this.idx = 0;
                    this.t0 += this.song.length;
                }
                const n = notes[this.idx];
                if (!n) return;
                const when = this.t0 + n.t;
                if (when > horizon) return;
                if (when >= actx.currentTime - 0.05) this.play(n, Math.max(when, actx.currentTime));
                this.idx++;
            }
        }
        track(node, end) {
            this.voices.add(node);
            node.onended = () => this.voices.delete(node);
            node.stop(end);
        }
        dest(n) {
            let out = this.out;
            if (n.pan !== 64 && actx.createStereoPanner) {
                const p = actx.createStereoPanner();
                p.pan.value = (n.pan - 64) / 64;
                p.connect(out);
                out = p;
            }
            return out;
        }
        play(n, when) {
            const amp = MIDI_GAIN * Math.pow(n.vel / 127, 1.5) * (n.vol / 127);
            if (n.ch === 9) return this.drum(n.note, when, amp);
            const P = patch(n.prog);
            const f = 440 * Math.pow(2, (n.note - 69) / 12);
            const g = actx.createGain();
            const filt = actx.createBiquadFilter();
            filt.type = "lowpass";
            filt.frequency.value = P.cut;
            filt.connect(g);
            g.connect(this.dest(n));
            const peak = P.gain * amp;
            const end = when + n.dur;
            g.gain.setValueAtTime(0, when);
            g.gain.linearRampToValueAtTime(peak, when + P.a);
            g.gain.setTargetAtTime(peak * P.s, when + P.a, P.d / 3);
            g.gain.setTargetAtTime(0, Math.max(end, when + P.a), P.r / 3);
            if (P.cutEnv) {
                filt.frequency.setValueAtTime(P.cut * P.cutEnv, when);
                filt.frequency.setTargetAtTime(P.cut, when, 0.08);
            }
            const stopAt = Math.max(end, when + P.a) + P.r * 2 + 0.05;
            const oscs = P.detune ? [-P.detune, P.detune] : [0];
            for (const dt of oscs) {
                const o = actx.createOscillator();
                o.type = P.wave;
                o.frequency.value = f;
                o.detune.value = dt;
                o.connect(filt);
                if (P.vibrato) {
                    const lfo = actx.createOscillator(), lg = actx.createGain();
                    lfo.frequency.value = 5;
                    lg.gain.value = f * 0.006;
                    lfo.connect(lg).connect(o.frequency);
                    lfo.start(when);
                    this.track(lfo, stopAt);
                }
                o.start(when);
                this.track(o, stopAt);
            }
            if (P.bell) {
                const o = actx.createOscillator(), bg = actx.createGain();
                o.type = "sine";
                o.frequency.value = f * 3.01;
                bg.gain.setValueAtTime(peak * 0.4, when);
                bg.gain.setTargetAtTime(0, when, 0.15);
                o.connect(bg).connect(g);
                o.start(when);
                this.track(o, stopAt);
            }
        }
        drum(note, when, amp) {
            const out = this.out;
            const hit = (src, dur) => { src.start(when); this.track(src, when + dur); };
            if (note === 35 || note === 36) {                         // kick
                const o = actx.createOscillator(), g = actx.createGain();
                o.frequency.setValueAtTime(150, when);
                o.frequency.exponentialRampToValueAtTime(40, when + 0.12);
                g.gain.setValueAtTime(0.22 * amp, when);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.3);
                o.connect(g).connect(out);
                hit(o, 0.32);
                return;
            }
            if (note >= 41 && note <= 50 && note !== 42 && note !== 44 && note !== 46 && note !== 49) {  // toms
                const o = actx.createOscillator(), g = actx.createGain();
                const f = 80 + (note - 41) * 18;
                o.frequency.setValueAtTime(f * 1.6, when);
                o.frequency.exponentialRampToValueAtTime(f, when + 0.1);
                g.gain.setValueAtTime(0.15 * amp, when);
                g.gain.exponentialRampToValueAtTime(0.001, when + 0.35);
                o.connect(g).connect(out);
                hit(o, 0.37);
                return;
            }
            // noise based: snare, clap, hats, cymbals
            let dur = 0.05, type = "highpass", freq = 7000, level = 0.05;
            if (note === 38 || note === 40) { dur = 0.18; type = "bandpass"; freq = 1800; level = 0.14; }
            else if (note === 39) { dur = 0.15; type = "bandpass"; freq = 1200; level = 0.12; }
            else if (note === 46) { dur = 0.3; level = 0.045; }
            else if (note === 49 || note === 57 || note === 52 || note === 55) { dur = 1.2; freq = 5000; level = 0.05; }
            else if (note === 51 || note === 59 || note === 53) { dur = 0.6; freq = 8000; level = 0.03; }
            const src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
            src.buffer = noise();
            src.loop = true;
            f.type = type;
            f.frequency.value = freq;
            g.gain.setValueAtTime(level * amp, when);
            g.gain.exponentialRampToValueAtTime(0.001, when + dur);
            src.connect(f).connect(g).connect(out);
            hit(src, dur + 0.02);
            if (note === 38 || note === 40) {
                const o = actx.createOscillator(), og = actx.createGain();
                o.frequency.value = 185;
                og.gain.setValueAtTime(0.1 * amp, when);
                og.gain.exponentialRampToValueAtTime(0.001, when + 0.1);
                o.connect(og).connect(out);
                hit(o, 0.12);
            }
        }
        stop() {
            clearInterval(this.timer);
            for (const v of this.voices) { try { v.stop(); } catch (e) { } }
            this.voices.clear();
        }
    }

    // ------------------------------------------------------------------ gamepad
    // Browser "standard" button order, rearranged into the order QB64 reports for
    // an XInput pad: A B X Y LB RB BACK START LS RS LT RT, then the d-pad
    const PAD_ORDER = [0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 6, 7, 12, 13, 14, 15, 16];
    let pad = null;
    // Some controllers report buttons as half pressed, or sticks off center, while
    // idle (a PS3 pad on macOS rests its pressure-sensitive buttons at 0.5, right
    // at the browser's "pressed" threshold, so they flicker). A button counts when
    // the browser says it is pressed and its value is well above the lowest value
    // it has shown; a stick counts once it has been seen centered.
    const rest = new Map();   // pad index -> { id, buttons: [], axes: [] }

    function firstPad() {
        const list = navigator.getGamepads ? navigator.getGamepads() : [];
        for (const p of list) if (p && p.connected) return p;
        return null;
    }

    function padPoll() {
        pad = firstPad();
        if (!pad) return;
        let r = rest.get(pad.index);
        if (!r || r.id !== pad.id) { r = { id: pad.id, buttons: [], axes: [] }; rest.set(pad.index, r); }
        pad.buttons.forEach((b, i) => { if (r.buttons[i] === undefined || b.value < r.buttons[i]) r.buttons[i] = b.value; });
        pad.axes.forEach((v, i) => { if (r.axes[i] === undefined || Math.abs(v) < r.axes[i]) r.axes[i] = Math.abs(v); });
    }

    function stdButton(i) {
        const b = pad.buttons[i];
        if (!b) return false;
        return b.pressed && b.value - rest.get(pad.index).buttons[i] > 0.6;
    }

    function padDeviceName(d) {
        if (d !== 3) return "";
        const p = firstPad();
        let name = p ? p.id.replace(/\s*\(.*$/, "").replace(/[\[\]]/g, "").trim() : "";
        if (!name) name = "ANY GAMEPAD";
        return "[CONTROLLER][[" + name.toUpperCase() + "]][BUTTON][AXIS]";
    }

    function padButtonCount() { return PAD_ORDER.length; }

    function padButton(b) {
        if (!pad) return false;
        return stdButton(PAD_ORDER[b - 1]);
    }

    function padAxis(a) {
        if (!pad) return 0;
        let v = pad.axes[a - 1] || 0;
        if (rest.get(pad.index).axes[a - 1] > 0.3) v = 0;   // never seen centered
        if (pad.mapping === "standard") {   // the d-pad steers too
            if (a === 1) { if (stdButton(14)) v = -1; if (stdButton(15)) v = 1; }
            if (a === 2) { if (stdButton(12)) v = -1; if (stdButton(13)) v = 1; }
        }
        return v;
    }

    // ------------------------------------------------------------------ startup
    async function init() {
        resetPalette();
        curFg = 7;
        curBg = 0;
        clearCells(0);
        hwQueue.length = 0;
        try { await document.fonts.load("16px dosvga"); } catch (e) { }
        buildAtlas();
        loadFiles();
    }

    function log(t, s) {
        console.log("[" + Number(t).toFixed(2) + "] " + s);
    }

    install();
    resetPalette();
    clearCells(0);

    return {
        init, log, unlockAudio,
        sndOpen, sndPlayCopy, sndLoop, sndPause, sndStop, sndVol,
        sndPlaying: h => { const s = snd(h); return !!(s && s.looping); },
        sndPaused: h => { const s = snd(h); return !!(s && s.paused); },
        padPoll, padDeviceName, padButtonCount, padButton, padAxis,
        // for debugging from the browser console
        _cells: () => ({ cellCh, cellFg, cellBg }),
        _frames: () => frameCount,
        _level: () => {   // output loudness (rms, peak) for checking the mix
            if (!master._an) { master._an = actx.createAnalyser(); master._an.fftSize = 8192; master.connect(master._an); }
            const d = new Float32Array(master._an.fftSize);
            master._an.getFloatTimeDomainData(d);
            let sum = 0, peak = 0;
            for (const v of d) { sum += v * v; peak = Math.max(peak, Math.abs(v)); }
            return [Math.sqrt(sum / d.length), peak];
        },
        _sounds: () => sounds.map(s => ({ file: s.file, ready: s.ready, failed: s.failed, looping: s.looping,
            paused: s.paused, notes: s.song ? s.song.notes.length : 0, secs: s.song ? s.song.length : s.buffer ? s.buffer.duration : 0 })),
    };
})();
