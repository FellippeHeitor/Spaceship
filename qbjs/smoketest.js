#!/usr/bin/env node
// Runs the web build's autopilot in headless Chrome and reports what happened.
//
//   node qbjs/smoketest.js [game options]
//   node qbjs/smoketest.js -autotest 600 -fast -god          (the default)
//   node qbjs/smoketest.js -chapter 20 -autotest 800 -fast -god
//
// Build first (node qbjs/build.js). Prints the game log and exits with an error if
// the page throws, the game reports runtime errors, or the run does not finish.
// Set CHROME to the browser executable if it is not found.

"use strict";
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os");
const { spawn } = require("child_process");

const DIST = path.join(__dirname, "dist");
const args = process.argv.slice(2).length ? process.argv.slice(2) : ["-autotest", "600", "-fast", "-god"];
const TIMEOUT_MS = 10 * 60 * 1000;

function findChrome() {
    const c = [process.env.CHROME,
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"];
    return c.find(p => p && fs.existsSync(p));
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png",
    ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".wav": "audio/wav",
    ".ogg": "audio/ogg", ".mid": "audio/midi" };

function done(code, msg) {
    if (msg) console.log(msg);
    process.exit(code);
}

if (!fs.existsSync(path.join(DIST, "program.js"))) done(1, "Build first: node qbjs/build.js");
const chromePath = findChrome();
if (!chromePath) done(1, "Chrome not found; set CHROME to its executable");

const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(DIST, p);
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
});

server.listen(0, "127.0.0.1", async () => {
    const port = server.address().port;
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "spaceship-smoke-"));
    const chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + profile,
        "--autoplay-policy=no-user-gesture-required", "--no-first-run", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
    const finish = (code, msg) => {
        try { chrome.kill(); } catch (e) { }
        server.close();
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { }
        done(code, msg);
    };
    setTimeout(() => finish(1, "FAILED: timed out"), TIMEOUT_MS);

    const wsUrl = await new Promise(resolve => {
        let buf = "";
        chrome.stderr.on("data", d => { buf += d; const m = buf.match(/DevTools listening on (ws:\S+)/); if (m) resolve(m[1]); });
    });
    const dport = wsUrl.match(/:(\d+)\//)[1];
    const page = (await (await fetch("http://127.0.0.1:" + dport + "/json/list")).json()).find(t => t.type === "page");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise(r => ws.onopen = r);
    let id = 0;
    const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));

    let errors = 0, finished = false, gameErrors = 0;
    ws.onmessage = ev => {
        const m = JSON.parse(ev.data);
        if (m.method === "Runtime.consoleAPICalled") {
            const s = m.params.args.map(a => a.value !== undefined ? a.value : a.description).join(" ");
            if (/Hit by /.test(s)) return;
            console.log(s);
            const e = s.match(/runtime errors:\s*(\d+)/);
            if (e) gameErrors = +e[1];
            if (/AUTOTEST FINISHED/.test(s)) finished = true;
            if (finished && e) finish(gameErrors ? 1 : 0, gameErrors ? "FAILED: runtime errors" : "PASSED");
        } else if (m.method === "Runtime.exceptionThrown") {
            const d = m.params.exceptionDetails;
            console.log("EXCEPTION: " + ((d.exception && d.exception.description) || d.text));
            errors++;
            finish(1, "FAILED: the page threw an error");
        }
    };
    send("Runtime.enable");
    send("Page.enable");
    send("Page.navigate", { url: "http://127.0.0.1:" + port + "/index.html?" + args.map(encodeURIComponent).join("&") });
    await new Promise(r => setTimeout(r, 1500));
    // The page waits for a click before starting (browsers only allow sound after one)
    send("Runtime.evaluate", { expression: "startProgram()" });
});
