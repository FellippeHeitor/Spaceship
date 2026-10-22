#!/usr/bin/env node
// Builds the QBJS (web) version of Spaceship from the same sources as the QB64 version.
//
//   node qbjs/build.js [--qbjs <path to the qbjs repo>] [--out <dir>]
//
// What it does:
//   1. Reads Spaceship.bas and expands every '$INCLUDE (src/*.bi, src/*.bm) into one program.
//   2. Applies the rewrites in RULES below (QB64-only statements, renamed sound and
//      gamepad calls). Each rule says how many times it must match, so the build stops
//      if the QB64 code changes under it.
//   3. Replaces routines with the versions in qbjs/overrides.bm (same name) and adds
//      the helpers in qbjs/web.bm.
//   4. Quotes bare words in DATA statements (QBJS needs quoted strings there).
//   5. Compiles the result with the QBJS compiler and writes a ready-to-serve folder:
//      qbjs/dist/  (index.html, program.js, the QBJS runtime, data/ and Audio/)
//   6. Packages it for distribution in qbjs/packages/:
//      spaceship-qbjs.zip  a QBJS project: open it in the QBJS IDE (qbjs.org) or link to
//                          https://qbjs.org/?mode=play&src=<url of the zip>
//      spaceship-web.zip   the standalone site (dist/), for itch.io or any web host
//
// The QB64 sources are only read, never changed.

"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.resolve(__dirname, "..");
const HERE = __dirname;

function arg(name, def) {
    const i = process.argv.indexOf(name);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

// A JavaScript parser for the boolean pass below: the acorn package if installed,
// otherwise the copy bundled inside Node (needs --expose-internals, so re-run with it)
function loadAcorn() {
    try { return require("acorn"); } catch (e) { }
    try { return require("internal/deps/acorn/acorn/dist/acorn"); } catch (e) { }
    return null;
}
if (!loadAcorn() && !process.execArgv.includes("--expose-internals")) {
    const r = require("child_process").spawnSync(process.execPath,
        ["--expose-internals", __filename].concat(process.argv.slice(2)), { stdio: "inherit" });
    process.exit(r.status === null ? 1 : r.status);
}

const QBJS = path.resolve(arg("--qbjs", process.env.QBJS_HOME || path.join(os.homedir(), "git", "qbjs")));
const OUT = path.resolve(arg("--out", path.join(HERE, "dist")));
const PKG = path.join(HERE, "packages");

// ---------------------------------------------------------------------------
// Rewrites. file: which source file the rule applies to ("*" = all).
// count: exact number of matches expected (the build fails otherwise).
// ---------------------------------------------------------------------------
const RULES = [
    // Main module: metacommands and statements QBJS does not have
    { file: "Spaceship.bas", find: /^\$RESIZE:.*$/im, repl: "", count: 1 },
    { file: "Spaceship.bas", find: /^\$EXEICON:.*$/im, repl: "", count: 1 },
    { file: "Spaceship.bas", find: /^DECLARE LIBRARY\r?\n[\s\S]*?^END DECLARE\s*$/im, repl: "", count: 1 },
    { file: "Spaceship.bas", find: /^ON ERROR GOTO ErrHandler\s*$/im, repl: "QJ_Init", count: 1 },
    { file: "Spaceship.bas", find: /^\$IF WIN THEN\r?\n[\s\S]*?^\$END IF\s*$/im, repl: 'Sep = "/"', count: 1 },
    { file: "Spaceship.bas", find: /^\s*_SCREENHIDE\s*$/im, repl: "", count: 1 },
    { file: "Spaceship.bas", find: /^\s*_SCREENMOVE _MIDDLE\s*$/im, repl: "", count: 1 },
    { file: "Spaceship.bas", find: /^_DISPLAYORDER .*$/im, repl: "", count: 1 },
    // The browser cannot close its window: show a goodbye screen instead of SYSTEM
    { file: "Spaceship.bas", find: /^SaveConfig\r?\nSYSTEM\s*$/im, repl: "SaveConfig\nQJ_Quit", count: 1 },
    // No error trapping in QBJS: errors stop the program and show in the browser console
    { file: "Spaceship.bas", find: /^ErrHandler:\r?\n[\s\S]*?^RESUME NEXT\s*$/im, repl: "", count: 1 },

    // OPEN takes the file name as a single word: anything longer goes through a variable
    { file: "Spaceship.bas", find: /^'\$INCLUDE: 'src\/types\.bi'\s*$/im,
      repl: "'$INCLUDE: 'src/types.bi'\nDIM SHARED QJ_FileName AS STRING", count: 1 },
    { file: "*", find: /^(\s*)OPEN\s+(.+?)\s+FOR\s+(INPUT|OUTPUT|APPEND|BINARY)\s+AS\s+(.*)$/gim, count: 3,
      repl: (m, ind, name, mode, rest) => /^[A-Za-z_][A-Za-z0-9_.]*\$?$/.test(name) ? m
          : ind + "QJ_FileName = " + name + ": OPEN QJ_FileName FOR " + mode + " AS " + rest,
      changes: true },

    // Numbers like 1E+09: QBJS reads "1E + 09"; write them out in full
    { file: "*", find: /\b(\d+(?:\.\d*)?)E\+(\d+)\b/gi, count: 2,
      repl: (m, a, b) => String(Number(a + "e" + b)) },

    // MID$(target, start[, len]) = value: QBJS miscompiles this when the target is a TYPE field
    { file: "*", find: /^(\s*)MID\$\((.*)\)\s*=\s*(.+?)\s*$/gim, count: 6,
      repl: (m, ind, args, value) => {
          const a = splitArgs(args);
          if (a.length < 2 || a.length > 3) throw new Error("cannot rewrite: " + m.trim());
          return ind + a[0] + " = QJ_MidSet$(" + a[0] + ", " + a[1] + ", " + (a[2] || "-1") + ", " + value + ")";
      } },

    // a.Field \ n: QBJS miscompiles integer division right after a TYPE field
    { file: "*", find: /([A-Za-z_]\w*(?:\([^()]*\))?\.[A-Za-z_]\w*)\s*\\/g, repl: "($1) \\", count: 6 },

    // Image handles: QB64's are negative (< -1 means valid), QBJS's are positive
    { file: "src/render.bm", find: /\bLogoImages\(f\) < -1\b/g, repl: "LogoImages(f) > 0", count: 1 },

    // ERASE is not supported
    { file: "src/states.bm", find: /^(\s*)ERASE ScreenMap\s*$/im, repl: "$1QJ_EraseScreenMap", count: 1 },

    // Sound: the web build plays sounds with Web Audio (wav, ogg and midi) - see platform.js
    { file: "*", find: /\b_SNDOPEN\(/gi, repl: "QJ_SndOpen&(", count: 1 },
    { file: "*", find: /\b_SNDPLAYCOPY\b/gi, repl: "QJ_SndPlayCopy", count: 1 },
    { file: "*", find: /\b_SNDPLAYING\(/gi, repl: "QJ_SndPlaying%(", count: 4 },
    { file: "*", find: /\b_SNDPAUSED\(/gi, repl: "QJ_SndPaused%(", count: 1 },
    { file: "*", find: /\b_SNDPAUSE\b/gi, repl: "QJ_SndPause", count: 2 },
    { file: "*", find: /\b_SNDSTOP\b/gi, repl: "QJ_SndStop", count: 2 },
    { file: "*", find: /\b_SNDVOL\b/gi, repl: "QJ_SndVol", count: 1 },
    { file: "*", find: /\b_SNDLOOP\b/gi, repl: "QJ_SndLoop", count: 1 },

    // Gamepad: the browser Gamepad API stands in for QB64's device functions
    { file: "*", find: /\b_DEVICES\b(?!\$)/gi, repl: "QJ_Devices%", count: 1 },
    { file: "*", find: /\b_DEVICE\$\(/gi, repl: "QJ_Device$(", count: 1 },
    { file: "*", find: /\b_DEVICEINPUT\(/gi, repl: "QJ_DeviceInput%(", count: 2 },
    { file: "*", find: /\b_LASTBUTTON\(/gi, repl: "QJ_LastButton%(", count: 2 },
    { file: "*", find: /\b_BUTTON\(/gi, repl: "QJ_Button%(", count: 2 },
    { file: "*", find: /\b_LASTAXIS\(/gi, repl: "QJ_LastAxis%(", count: 1 },
    { file: "*", find: /\b_AXIS\(/gi, repl: "QJ_Axis!(", count: 2 },

    // High resolution clock (QB64 calls SDL_GetTicks through DECLARE LIBRARY)
    { file: "*", find: /\bGetUptime\b/gi, repl: "QJ_Ticks#", count: 1 },

    // Autotest screenshots: not available in the browser
    { file: "*", find: /^(\s*)_SAVEIMAGE\s+(.*)$/gim, repl: "$1QJ_SaveImage $2", count: 1 },
];

// Splits "a, f(b, c), d" at the top-level commas
function splitArgs(s) {
    const out = [];
    let depth = 0, inQ = false, cur = "";
    for (const ch of s) {
        if (ch === '"') inQ = !inQ;
        if (!inQ && ch === "(") depth++;
        if (!inQ && ch === ")") depth--;
        if (!inQ && depth === 0 && ch === ",") { out.push(cur.trim()); cur = ""; } else cur += ch;
    }
    out.push(cur.trim());
    return out;
}

// ---------------------------------------------------------------------------

const lines = [];      // { text, file, line }
const ruleHits = RULES.map(() => 0);

function readSource(rel) {
    let text = fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
    RULES.forEach((r, i) => {
        if (r.file !== "*" && r.file !== rel) return;
        const re = new RegExp(r.find.source, r.find.flags.includes("g") ? r.find.flags : r.find.flags + "g");
        text = text.replace(re, function () {
            const m = arguments;
            const out = typeof r.repl === "function" ? r.repl.apply(null, m)
                : r.repl.replace(/\$(\d)/g, (_, d) => m[+d] || "");
            if (!r.changes || out !== m[0]) ruleHits[i]++;
            return out;
        });
    });
    return text.split("\n");
}

function addFile(rel) {
    const src = readSource(rel);
    lines.push({ text: "'=== " + rel, file: rel, line: 0 });
    src.forEach((t, i) => {
        const inc = t.match(/^\s*'\s*\$INCLUDE\s*:\s*'([^']+)'/i);
        if (inc) {
            addFile(path.normalize(inc[1]).replace(/\\/g, "/"));
        } else {
            lines.push({ text: t, file: rel, line: i + 1 });
        }
    });
}

// Routine blocks: SUB name ... END SUB / FUNCTION name ... END FUNCTION
const RX_START = /^\s*(SUB|FUNCTION)\s+([A-Za-z_][A-Za-z0-9_.]*)[%&!#$~`]*/i;
const RX_END = /^\s*END\s+(SUB|FUNCTION)\b/i;

function routines(list) {
    const out = [];
    let cur = null;
    list.forEach((l, i) => {
        const t = l.text.replace(/'.*$/, "");
        if (!cur) {
            const m = t.match(RX_START);
            if (m && !/^\s*(SUB|FUNCTION)\s+\w+[%&!#$~`]*\s*=/i.test(t)) cur = { name: m[2].toUpperCase(), start: i };
        } else if (RX_END.test(t)) {
            cur.end = i;
            out.push(cur);
            cur = null;
        }
    });
    return out;
}

function loadExtra(rel) {
    return fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n").split("\n")
        .map((t, i) => ({ text: t, file: rel, line: i + 1 }));
}

// DATA: QBJS copies DATA items into JavaScript as they are, so bare words must be quoted
function quoteData(t) {
    const m = t.match(/^(\s*DATA\s+)(.*)$/i);
    if (!m) return t;
    const items = [];
    let cur = "", inQ = false;
    for (const ch of m[2]) {
        if (ch === '"') inQ = !inQ;
        if (ch === "," && !inQ) { items.push(cur); cur = ""; } else cur += ch;
    }
    items.push(cur);
    return m[1] + items.map(s => {
        const v = s.trim();
        if (v === "" || v.startsWith('"')) return v;
        if (/^[-+]?(\d+\.?\d*|\.\d+)(E[-+]?\d+)?$/i.test(v) || /^&H[0-9A-F]+$/i.test(v)) return v;
        return '"' + v + '"';
    }).join(",");
}

// Two QB semantics QBJS does not follow, fixed on the compiled JavaScript:
//  - QB comparisons give -1 (true) or 0; QBJS leaves JavaScript's true/false, which
//    become 1 when stored or combined. NOT then breaks (NOT 1 is -2, still true) and
//    so does arithmetic with comparisons. Every comparison becomes (a == b ? -1 : 0).
//  - Assigning a TYPE variable or array element copies it in QB; in QBJS both names
//    end up sharing one object (HighScores(i) = HighScores(i - 1) then makes two
//    entries that change together). Plain "a = b" assignments go through $qbcopy.
function qbSemantics(js) {
    const acorn = loadAcorn();
    if (!acorn) fail("no JavaScript parser available (install acorn: npm install acorn)");
    const ast = acorn.parse(js, { ecmaVersion: "latest", sourceType: "script" });
    const OPS = new Set(["==", "!=", "===", "!==", "<", ">", "<=", ">="]);
    const ins = [];
    const wrap = (start, end, before, after) => {
        ins.push({ pos: start, text: before, key: -(end - start) });
        ins.push({ pos: end, text: after, key: end - start });
    };
    let comparisons = 0, copies = 0;
    (function walk(n) {
        if (!n || typeof n.type !== "string") return;
        if (n.type === "BinaryExpression" && OPS.has(n.operator)) {
            wrap(n.start, n.end, "(", " ? -1 : 0)");
            comparisons++;
        }
        if (n.type === "AssignmentExpression" && n.operator === "=" &&
            (n.right.type === "Identifier" || n.right.type === "MemberExpression")) {
            wrap(n.right.start, n.right.end, "$qbcopy(", ")");
            copies++;
        }
        for (const k in n) {
            const v = n[k];
            if (Array.isArray(v)) v.forEach(walk);
            else if (v && typeof v.type === "string") walk(v);
        }
    })(ast);
    // outer before inner at the same start, inner before outer at the same end
    ins.sort((a, b) => a.pos - b.pos || a.key - b.key);
    let out = "", last = 0;
    for (const i of ins) {
        out += js.slice(last, i.pos) + i.text;
        last = i.pos;
    }
    out += js.slice(last);
    out = out.replace(/^async function __qbjs_run\(\) \{\n/, m => m +
        "function $qbcopy(v) { return (v !== null && typeof v === \"object\") ? JSON.parse(JSON.stringify(v)) : v; }\n");
    return { js: out, comparisons, copies };
}

// --- Minimal zip writer (deflate, no dependencies) -------------------------
const zlib = require("zlib");
const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c;
    }
    return t;
})();
function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}

// files: [[name in zip, Buffer], ...]
function writeZip(file, files) {
    const parts = [], central = [];
    let offset = 0;
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const [name, data] of files) {
        const nameBuf = Buffer.from(name, "utf8");
        const packed = zlib.deflateRawSync(data, { level: 9 });
        const store = packed.length >= data.length;
        const body = store ? data : packed;
        const crc = crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
        local.writeUInt16LE(store ? 0 : 8, 8); local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12);
        local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
        const cen = Buffer.alloc(46);
        cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
        cen.writeUInt16LE(store ? 0 : 8, 10); cen.writeUInt16LE(dosTime, 12); cen.writeUInt16LE(dosDate, 14);
        cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(data.length, 24);
        cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42);
        parts.push(local, nameBuf, body);
        central.push(cen, nameBuf);
        offset += local.length + nameBuf.length + body.length;
    }
    const cenBuf = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(cenBuf.length, 12); end.writeUInt32LE(offset, 16);
    fs.writeFileSync(file, Buffer.concat(parts.concat([cenBuf, end])));
}

// All files under dir, as [relative path with "/", Buffer]
function listFiles(dir, prefix = "") {
    let out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (e.name.startsWith(".")) continue;
        const full = path.join(dir, e.name), rel = prefix + e.name;
        if (e.isDirectory()) out = out.concat(listFiles(full, rel + "/"));
        else out.push([rel, fs.readFileSync(full)]);
    }
    return out;
}

function copyDir(src, dst, filter) {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
        if (e.name.startsWith(".")) continue;
        const s = path.join(src, e.name), d = path.join(dst, e.name);
        if (e.isDirectory()) copyDir(s, d, filter);
        else if (!filter || filter(e.name)) fs.copyFileSync(s, d);
    }
}

function fail(msg) {
    console.error("BUILD FAILED: " + msg);
    process.exit(1);
}

async function main() {
    if (!fs.existsSync(path.join(QBJS, "qb2js.js"))) {
        fail("QBJS not found at " + QBJS + " (use --qbjs <path> or set QBJS_HOME)");
    }

    // 1-2. Merge the sources and apply the rules
    addFile("Spaceship.bas");
    let bad = false;
    RULES.forEach((r, i) => {
        if (ruleHits[i] !== r.count) {
            console.error("Rule " + r.find + " in " + r.file + " matched " + ruleHits[i] + " time(s), expected " + r.count);
            bad = true;
        }
    });
    if (bad) fail("the QB64 sources changed under the rewrite rules in qbjs/build.js; update RULES");

    // 3. Overrides replace routines of the same name, web.bm helpers go at the end
    const over = loadExtra("qbjs/overrides.bm");
    const overR = routines(over);
    let merged = lines;
    const have = routines(merged);
    for (const o of overR) {
        const target = have.find(r => r.name === o.name);
        if (!target) fail("qbjs/overrides.bm: " + o.name + " does not exist in the QB64 sources (move it to web.bm?)");
    }
    const replaced = new Set();
    const result = [];
    let idx = 0;
    for (const r of have) {
        const o = overR.find(x => x.name === r.name);
        if (!o) continue;
        if (replaced.has(r.name)) fail("routine " + r.name + " is defined twice");
        replaced.add(r.name);
        while (idx < r.start) result.push(merged[idx++]);
        result.push({ text: "'(replaced by qbjs/overrides.bm)", file: merged[r.start].file, line: merged[r.start].line });
        for (let k = o.start; k <= o.end; k++) result.push(over[k]);
        idx = r.end + 1;
    }
    while (idx < merged.length) result.push(merged[idx++]);
    merged = result;
    merged.push({ text: "'=== qbjs/web.bm", file: "qbjs/web.bm", line: 0 });
    merged = merged.concat(loadExtra("qbjs/web.bm"));

    // Name clashes between web.bm and the game
    const names = {};
    for (const r of routines(merged)) {
        if (names[r.name]) fail("routine " + r.name + " is defined twice (" + merged[names[r.name]].file + ", " + merged[r.start].file + ")");
        names[r.name] = r.start;
    }

    // 4. DATA quoting
    merged.forEach(l => { l.text = quoteData(l.text); });

    const source = merged.map(l => l.text).join("\n") + "\n";

    // 5. Compile
    const qbc = await require(path.join(QBJS, "qb2js.js")).QBCompiler();
    let js = "async function __qbjs_run() {\n" + await qbc.compile(source) + "\n}\n";
    let errors = 0;
    const seen = new Set();
    for (const w of qbc.getWarnings()) {
        const at = merged[w.line - 1];
        const where = at ? at.file + ":" + at.line : "line " + w.line;
        const msg = (w.mtype ? "ERROR " : "warning ") + where + ": " + w.text;
        if (seen.has(msg)) continue;
        seen.add(msg);
        if (w.mtype) errors++;
        console.log(msg);
    }
    if (errors) fail(errors + " compile error(s)");
    let sem;
    try {
        sem = qbSemantics(js);
        js = sem.js;
    } catch (e) {
        fail("the compiled program is not valid JavaScript: " + e.message);
    }
    try {
        new (require("vm").Script)(js, { filename: "program.js" });
    } catch (e) {
        fail("the compiled program is not valid JavaScript: " + e.message + "\n" + (e.stack || "").split("\n").slice(0, 4).join("\n"));
    }

    // Output folder
    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "Spaceship.bas"), source);
    fs.writeFileSync(path.join(OUT, "program.js"), js);
    fs.copyFileSync(path.join(HERE, "index.html"), path.join(OUT, "index.html"));
    fs.copyFileSync(path.join(HERE, "platform.js"), path.join(OUT, "platform.js"));

    // QBJS runtime (the same set of files the QBJS IDE puts in an exported program)
    const runtime = [
        ["qb.js", "qb.js"], ["vfs.js", "vfs.js"], ["gx/gx.js", "gx/gx.js"],
        ["gx/__gx_font_default.png", "gx/__gx_font_default.png"],
        ["gx/__gx_font_default_black.png", "gx/__gx_font_default_black.png"],
        ["util/pako.2.1.0.min.js", "pako.2.1.0.min.js"], ["qbjs.woff2", "qbjs.woff2"],
        ["fonts/WebPlus_IBM_EGA_8x8.woff", "fonts/WebPlus_IBM_EGA_8x8.woff"],
        ["export/qbjs.css", "qbjs.css"],
        ["export/fullscreen.svg", "fullscreen.svg"], ["export/fullscreen-hover.svg", "fullscreen-hover.svg"], ["export/3rd-party-licenses.txt", "3rd-party-licenses.txt"],
        ["LICENSE", "QBJS-LICENSE.txt"],
    ];
    for (const [from, to] of runtime) {
        const d = path.join(OUT, to);
        fs.mkdirSync(path.dirname(d), { recursive: true });
        fs.copyFileSync(path.join(QBJS, from), d);
    }

    // Game data, shared with the QB64 version
    copyDir(path.join(ROOT, "data"), path.join(OUT, "data"));
    copyDir(path.join(ROOT, "Audio"), path.join(OUT, "Audio"));
    fs.copyFileSync(path.join(ROOT, "LICENSE.md"), path.join(OUT, "LICENSE.md"));
    fs.copyFileSync(path.join(ROOT, "ship.ico"), path.join(OUT, "favicon.ico"));

    // Packages
    fs.mkdirSync(PKG, { recursive: true });
    const site = listFiles(OUT).filter(([n]) => n !== "Spaceship.bas");
    writeZip(path.join(PKG, "spaceship-web.zip"), site);
    const project = [["main.bas", fs.readFileSync(path.join(HERE, "project-main.bas"))]]
        .concat(site.filter(([n]) => /^(program\.js|platform\.js|LICENSE\.md|data\/|Audio\/)/.test(n)));
    writeZip(path.join(PKG, "spaceship-qbjs.zip"), project);
    const kb = f => Math.round(fs.statSync(path.join(PKG, f)).size / 1024) + " KB";
    console.log("Packages: qbjs/packages/spaceship-qbjs.zip (" + kb("spaceship-qbjs.zip") + "), " +
        "qbjs/packages/spaceship-web.zip (" + kb("spaceship-web.zip") + ")");

    console.log("Built " + path.relative(ROOT, OUT) + " (" + merged.length + " lines, " +
        replaced.size + " routines overridden; " + sem.comparisons + " comparisons and " + sem.copies +
        " assignments made QB-style)");
    console.log("Serve it with any static web server, for example:");
    console.log("  python3 -m http.server 8000 -d " + path.relative(ROOT, OUT) + "   then open http://localhost:8000");
}

main().catch(e => fail(e.stack || String(e)));
