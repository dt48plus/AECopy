// Author: Ilhan Turan - https://ilhanturan.fr
// AECopy v1.1.0 - extension invisible d'After Effects.
//
// Une tache de fond d'After Effects (app.scheduleTask) faisait clignoter le curseur a chaque execution (Rotopaint,
// pinceaux), et la moindre fenetre ouverte dans After Effects la coupait pour de bon. Ici, la boite aux lettres est
// surveillee hors d'After Effects (moteur web d'Adobe, Node) ; After Effects n'execute le script qu'a l'arrivee
// d'une commande.
// %HOME% est remplace par le dossier d'AECopy quand AECopy.exe installe l'extension.
(function () {
    var fs = require("fs");
    var HOME = "%HOME%";
    var ROOT = HOME + "/mailbox";
    var cep = window.__adobe_cep__;
    var pid = 0, busy = false;

    function log(msg) {
        try { fs.appendFileSync(ROOT + "/cep.log", new Date().toISOString() + " " + msg + "\n"); } catch (e) {}
    }

    function evalES(code, done) {
        cep.evalScript(code, done || function () {});
    }

    // Charge le moteur en mode extension (sans tache de fond) et recupere le numero de processus d'After Effects.
    function start() {
        busy = true;
        var file = (HOME + "/AECopy.jsx").replace(/\\/g, "/");
        evalES("$.global.AECOPY_HOME = \"" + HOME.replace(/\//g, "\\\\") + "\";" +
            "try { $.evalFile(new File(\"" + file + "\")); } catch (e) {}" +
            "($.global.AECOPY && $.global.AECOPY.pid) ? String($.global.AECOPY.pid) : \"0\";", function (r) {
            busy = false;
            pid = parseInt(r, 10) || 0;
            log("engine " + (pid ? "started in After Effects " + pid : "not started (" + r + "), retry in 5 s"));
            if (!pid) setTimeout(start, 5000);
        });
    }

    // Une commande attend : le moteur la lit, l'execute et ecrit sa reponse. Une seule a la fois ; pendant
    // qu'une fenetre est ouverte dans After Effects, evalScript attend qu'elle se ferme.
    function tick() {
        if (busy || !pid) return;
        var cmd = ROOT + "/cmd_" + pid + ".txt";
        if (!fs.existsSync(cmd)) return;
        busy = true;
        evalES("$.global.AECOPY ? ($.global.AECOPY.poll(), \"ok\") : \"none\";", function (r) {
            busy = false;
            if (r !== "ok") { log("engine missing (" + r + "): reload"); pid = 0; start(); }
        });
    }

    // Reload d'AECopy : il ecrit un nouveau jeton dans cepreload.txt ; la page se recharge (main.js et le moteur
    // relus sur le disque). Remplace l'injection AfterFX.exe -r, qui faisait sauter la fenetre d'After Effects.
    var RELOAD = ROOT + "/cepreload.txt";
    function reloadToken() { try { return fs.readFileSync(RELOAD, "utf8"); } catch (e) { return ""; } }
    var token = reloadToken();
    setInterval(function () {
        var t = reloadToken();
        if (t !== token) { token = t; log("reload asked by AECopy"); location.reload(); }
    }, 500);

    if (!fs.existsSync(HOME + "/AECopy.jsx")) { log("AECopy.jsx not found in " + HOME); return; }
    start();
    setInterval(tick, 50);
})();
