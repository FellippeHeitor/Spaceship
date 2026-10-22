'Spaceship, by @FellippeHeitor - web edition
'
'This is the QBJS project version of Spaceship. The game itself is written for QB64
'(https://github.com/FellippeHeitor/Spaceship); its web build compiles that code with
'QBJS and adds a few fixes, and the result is program.js in this project.
'This main.bas only loads it, together with platform.js (text mode, sound,
'gamepad and saved settings for the browser), and runs it.
'
'Controls: arrows/WASD move, Z/Space fire, X/Shift special, C/Tab switch special,
'Enter/P/Esc pause, M mute. A gamepad works too.

$If Javascript Then
    async function ssLoadScript(name) {
        var vfs = QB.vfs();
        var f = vfs.getNode(name, vfs.rootDirectory());
        var text = (f && f.type == vfs.FILE) ? new TextDecoder().decode(f.data) : await (await fetch(name)).text();
        var s = document.createElement("script");
        s.text = text;
        document.head.appendChild(s);
    }
    await ssLoadScript("platform.js");
    await ssLoadScript("program.js");
    await __qbjs_run();
$End If
