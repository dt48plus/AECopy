// Author: Ilhan Turan - https://ilhanturan.fr
// AECopy v1.0.0 - Ctrl+C / Ctrl+V between several After Effects (2020 to 2026).
//
// Charge au demarrage de chaque After Effects (AECopy_startup.jsx dans le dossier
// Scripts\Startup de l'utilisateur), ou a la main : Fichier > Scripts > Executer le fichier de script.
// L'application AECopy.exe depose des commandes dans AECopy\mailbox :
//   mark   (Ctrl+C)  : retient ce qui est selectionne, sans rien serialiser
//   export (Ctrl+V dans un AUTRE After Effects) : ecrit la selection retenue dans clipboard.json
//   paste             : reconstruit clipboard.json dans ce After Effects
// ExtendScript ES3 : pas de JSON natif, pas d'Array.indexOf.

(function () {
    // Relance (Fichier > Scripts > Executer) : on remplace la version deja chargee.
    // (et l'ancienne version AE Transfer, global AETX).
    if ($.global.AECOPY && $.global.AECOPY.taskId) {
        try { app.cancelTask($.global.AECOPY.taskId); } catch (eOld) {}
    }
    if ($.global.AETX && $.global.AETX.taskId) {
        try { app.cancelTask($.global.AETX.taskId); } catch (eOld2) {}
        $.global.AETX = null;
    }

    var X = $.global.AECOPY = {};
    X.VERSION = "1.0.0";
    X.running = false;
    X.HOME = $.global.AECOPY_HOME || (new File($.fileName)).parent.fsName;
    // Hors d'AppData : un programme lance depuis une appli empaquetee (MSIX) y ecrit dans une copie redirigee.
    X.ROOT = X.HOME + "\\mailbox";
    X.EXE = X.HOME + "\\AECopy.exe";
    X.pid = 0;
    X.mark = null;
    X.warnings = [];

    var PVT = PropertyValueType;

    // ------------------------------------------------------------------ fichiers

    function ensureFolder(path) {
        var f = new Folder(path);
        if (!f.exists) f.create();
    }

    function readText(path) {
        var f = new File(path);
        if (!f.exists) return null;
        f.encoding = "UTF-8";
        if (!f.open("r")) return null;
        var s = f.read();
        f.close();
        return s;
    }

    // Ecriture atomique : .tmp puis renommage, le relais ne lit jamais un fichier a moitie ecrit.
    function writeText(path, s) {
        var tmp = new File(path + ".tmp");
        tmp.encoding = "UTF-8";
        tmp.lineFeed = "Unix";
        if (!tmp.open("w")) throw new Error("cannot write " + path);
        tmp.write(s);
        tmp.close();
        var dst = new File(path);
        if (dst.exists) dst.remove();
        if (!tmp.rename(dst.name)) throw new Error("cannot rename " + path);
    }

    function log(msg) {
        try {
            var f = new File(X.ROOT + "\\log.txt");
            f.encoding = "UTF-8";
            // Au-dela de 1 Mo : le journal devient log.old.txt (le precedent est remplace).
            if (f.exists && f.length > 1000000) {
                var old = new File(X.ROOT + "\\log.old.txt");
                if (old.exists) old.remove();
                f.rename("log.old.txt");
                f = new File(X.ROOT + "\\log.txt");
                f.encoding = "UTF-8";
            }
            if (f.open("a")) {
                f.writeln("[" + new Date().toString() + "] [" + X.pid + "] " + msg);
                f.close();
            }
        } catch (e) {}
    }

    function errText(e) {
        var s = (e && e.message) ? e.message : String(e);
        if (e && e.line) s += " (line " + e.line + ")";
        return s;
    }

    function warn(msg) {
        X.warnings.push(msg);
    }

    // ------------------------------------------------------------------ JSON

    var ESC = { "\\": "\\\\", "\"": "\\\"", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\b": "\\b", "\f": "\\f" };

    // U+2028 / U+2029 ajoutes par code : ecrits tels quels dans le source, ils couperaient la ligne.
    var ESC_RE = new RegExp("[\\\\\"\\x00-\\x1f" + String.fromCharCode(0x2028, 0x2029) + "]", "g");

    function quote(s) {
        return "\"" + String(s).replace(ESC_RE, function (c) {
            return ESC[c] || ("\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4));
        }) + "\"";
    }

    function toJSON(v) {
        if (v === null || v === undefined) return "null";
        var t = typeof v;
        if (t === "number") return isFinite(v) ? String(v) : "null";
        if (t === "boolean") return v ? "true" : "false";
        if (t === "string") return quote(v);
        var parts = [];
        if (v instanceof Array) {
            for (var i = 0; i < v.length; i++) parts.push(toJSON(v[i]));
            return "[" + parts.join(",") + "]";
        }
        for (var k in v) {
            if (!v.hasOwnProperty(k)) continue;
            var x = v[k];
            if (x === undefined || typeof x === "function") continue;
            parts.push(quote(k) + ":" + toJSON(x));
        }
        return "{" + parts.join(",") + "}";
    }

    function fromJSON(s) {
        if (!s || !/^\s*\{/.test(s)) throw new Error("unreadable clipboard");
        return eval("(" + s + ")");
    }

    // ------------------------------------------------------------------ outils AE

    // Comp active ; les tests (tests/roundtrip.jsx) la forcent, activeItem ne suit pas openInViewer() en script.
    function activeComp() {
        return X.testComp || app.activeItem;
    }

    function itemById(id) {
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i).id === id) return app.project.item(i);
        }
        return null;
    }

    function plainArray(a) {
        var out = [];
        for (var i = 0; i < a.length; i++) out.push(a[i]);
        return out;
    }

    function tryGet(obj, key) {
        try { return obj[key]; } catch (e) { return undefined; }
    }

    // Indices de propriete depuis le calque : chemin stable tant que la structure ne change pas.
    function pathOf(prop) {
        var path = [];
        var p = prop;
        while (p && p.parentProperty) {
            path.unshift(p.propertyIndex);
            p = p.parentProperty;
        }
        return path;
    }

    function resolve(layer, path) {
        var p = layer;
        for (var i = 0; i < path.length; i++) p = p.property(path[i]);
        return p;
    }

    // ------------------------------------------------------------------ valeurs

    // Tout ce qu'un TextDocument expose (les plus recents n'existent qu'a partir d'AE 2022-2024 :
    // absents a la lecture, ils sont simplement ignores).
    var TEXT_FIELDS = ["text", "font", "fontFamily", "fontStyle", "fontSize", "applyFill", "applyStroke",
        "fillColor", "strokeColor", "strokeWidth", "strokeOverFill", "lineJoinType", "justification",
        "tracking", "autoLeading", "leading", "leadingType", "baselineShift", "fauxBold", "fauxItalic",
        "allCaps", "smallCaps", "superscript", "subscript", "fontCapsOption", "fontBaselineOption",
        "horizontalScale", "verticalScale", "tsume", "kerningType", "kerning", "ligature", "noBreak",
        "digitSet", "direction", "lineOrientation", "firstLineIndent", "startIndent", "endIndent",
        "spaceBefore", "spaceAfter", "autoHyphenate", "hangingRoman", "everyLineComposer", "composerEngine",
        "baselineDirection", "autoKernType", "boxAutoFitPolicy", "boxFirstBaselineAlignment",
        "boxFirstBaselineAlignmentMinimum", "boxInsetSpacing", "boxVerticalAlignment", "boxOverflow",
        "boxText", "pointText", "boxTextSize", "boxTextPos"];
    // Lus pour information, jamais ecrits (lecture seule ou poses a part).
    var TEXT_SKIP = { text: 1, applyFill: 1, applyStroke: 1, boxText: 1, pointText: 1, fontFamily: 1, fontStyle: 1, boxOverflow: 1 };

    // Styles par caractere et par paragraphe (CharacterRange / ParagraphRange, AE 24.3+).
    var CHAR_ATTRS = ["font", "fontSize", "fillColor", "strokeColor", "strokeWidth", "strokeOverFill", "lineJoinType",
        "tracking", "autoLeading", "leading", "baselineShift", "fauxBold", "fauxItalic", "allCaps", "smallCaps",
        "superscript", "subscript", "fontCapsOption", "fontBaselineOption", "horizontalScale", "verticalScale", "tsume",
        "kerning", "autoKernType", "ligature", "noBreak", "digitSet", "baselineDirection", "applyFill", "applyStroke"];
    var PARA_ATTRS = ["justification", "firstLineIndent", "startIndent", "endIndent", "spaceBefore", "spaceAfter",
        "leadingType", "autoHyphenate", "everyLineComposer", "hangingRoman", "composerEngine", "direction"];

    function styleOf(range, attrs) {
        var st = {};
        for (var i = 0; i < attrs.length; i++) {
            var v = tryGet(range, attrs[i]);
            if (v !== undefined && v !== null) st[attrs[i]] = (typeof v === "object" && v.length !== undefined) ? plainArray(v) : v;
        }
        return st;
    }

    // Suites de caracteres au meme style ; null si tout le texte a un seul style (le document suffit).
    function charRuns(td) {
        var n = td.text.length;
        if (n < 2 || n > 5000) return null;
        var runs = [], last = null, lastSig = null;
        for (var i = 0; i < n; i++) {
            var st = styleOf(td.characterRange(i, i + 1), CHAR_ATTRS);
            var sig = toJSON(st);
            if (last && sig === lastSig) last.e = i + 1;
            else { last = { s: i, e: i + 1, st: st }; runs.push(last); lastSig = sig; }
        }
        return runs.length > 1 ? runs : null;
    }

    function paraRuns(td) {
        var count = tryGet(td, "paragraphCount");
        if (!count || count < 2) return null;
        var paras = [], differs = false, first = null;
        for (var p = 0; p < count; p++) {
            var cr = td.paragraphRange(p, p + 1).characterRange();
            var st = styleOf(cr, PARA_ATTRS);
            var sig = toJSON(st);
            if (first === null) first = sig; else if (sig !== first) differs = true;
            paras.push({ s: cr.characterStart, e: cr.characterEnd, st: st });
        }
        return differs ? paras : null;
    }

    // Pose un style sur une plage : remplissage/contour en dernier (poser une couleur les rallume).
    function applyStyle(range, st) {
        for (var k in st) {
            if (!st.hasOwnProperty(k) || k === "applyFill" || k === "applyStroke") continue;
            if (TEXT_STROKE[k] && st.applyStroke === false) continue;
            if (k === "fillColor" && st.applyFill === false) continue;
            if (k === "leading" && st.autoLeading) continue;
            try { range[k] = st[k]; } catch (e) {}
        }
        if (st.applyFill !== undefined) { try { range.applyFill = st.applyFill; } catch (e1) {} }
        if (st.applyStroke !== undefined) { try { range.applyStroke = st.applyStroke; } catch (e2) {} }
    }
    var TEXT_STROKE = { strokeColor: 1, strokeWidth: 1, strokeOverFill: 1, lineJoinType: 1 };
    var TEXT_NAMES = { font: "font", fontSize: "size", fillColor: "fill color", strokeColor: "stroke color",
        strokeWidth: "stroke width", strokeOverFill: "stroke over fill", applyFill: "fill", applyStroke: "stroke",
        justification: "alignment", tracking: "tracking", leading: "leading", autoLeading: "auto leading",
        baselineShift: "baseline shift", fauxBold: "faux bold", fauxItalic: "faux italic",
        allCaps: "all caps", smallCaps: "small caps", superscript: "superscript", subscript: "subscript",
        horizontalScale: "horizontal scale", verticalScale: "vertical scale", tsume: "tsume",
        boxTextSize: "text box size", text: "text" };

    function sameValue(a, b) {
        if (a instanceof Array || (b && typeof b === "object" && b.length !== undefined)) {
            if (!a || !b || a.length !== b.length) return false;
            for (var i = 0; i < a.length; i++) if (!sameValue(a[i], b[i])) return false;
            return true;
        }
        if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 0.01;
        return String(a) === String(b);
    }

    // Relit le texte applique et signale ce qu'After Effects a refuse de poser.
    function checkText(prop, d, layerName) {
        var td;
        try { td = prop.value; } catch (e) { return; }
        var off = [];
        for (var k in TEXT_NAMES) {
            if (d[k] === undefined || (k === "leading" && d.autoLeading)) continue;
            if (TEXT_STROKE[k] && !d.applyStroke) continue;
            if (k === "fillColor" && d.applyFill === false) continue;
            if (k === "boxTextSize" && !d.boxText) continue;
            var got = tryGet(td, k);
            if (got !== undefined && !sameValue(d[k], got)) off.push(TEXT_NAMES[k]);
        }
        if (off.length) warn("text \"" + layerName + "\": After Effects " + app.version.split("x")[0] + " refused " + off.join(", "));
    }

    var SHAPE_FEATHER = ["featherSegLocs", "featherRelSegLocs", "featherRadii", "featherInterps",
        "featherTensions", "featherTypes", "featherRelCornerAngles"];

    var MARKER_FIELDS = ["comment", "duration", "chapter", "url", "frameTarget", "cuePointName",
        "eventCuePoint", "label", "protectedRegion"];

    function valueOut(v, pvt) {
        if (v === null || v === undefined) return null;
        if (pvt === PVT.SHAPE) {
            var sh = { _sh: 1, closed: v.closed, v: plainArray(v.vertices), i: plainArray(v.inTangents), o: plainArray(v.outTangents) };
            for (var f = 0; f < SHAPE_FEATHER.length; f++) {
                var fv = tryGet(v, SHAPE_FEATHER[f]);
                if (fv && fv.length) sh[SHAPE_FEATHER[f]] = plainArray(fv);
            }
            return sh;
        }
        if (pvt === PVT.TEXT_DOCUMENT) {
            var td = { _td: 1 };
            for (var t = 0; t < TEXT_FIELDS.length; t++) {
                var tv = tryGet(v, TEXT_FIELDS[t]);
                if (tv === undefined || tv === null) continue;
                td[TEXT_FIELDS[t]] = (typeof tv === "object" && tv.length !== undefined) ? plainArray(tv) : tv;
            }
            if (typeof v.characterRange === "function") {
                try { var runs = charRuns(v); if (runs) td.runs = runs; } catch (eRuns) {}
                try { var paras = paraRuns(v); if (paras) td.paras = paras; } catch (eParas) {}
            }
            return td;
        }
        if (pvt === PVT.MARKER) {
            var mk = { _mk: 1 };
            for (var m = 0; m < MARKER_FIELDS.length; m++) {
                var mv = tryGet(v, MARKER_FIELDS[m]);
                if (mv !== undefined && mv !== null) mk[MARKER_FIELDS[m]] = mv;
            }
            return mk;
        }
        if (typeof v === "object" && v.length !== undefined) return plainArray(v);
        return v;
    }

    // Adapte un tableau au nombre de dimensions de la cible (calque 3D -> 2D et l'inverse).
    function fitArray(a, ref) {
        if (!(a instanceof Array) || !ref || ref.length === undefined || ref.length === a.length) return a;
        var out = [];
        for (var i = 0; i < ref.length; i++) out.push(i < a.length ? a[i] : ref[i]);
        return out;
    }

    function valueIn(prop, d, time) {
        if (d === null || d === undefined) return d;
        if (d._sh) {
            var sh = new Shape();
            sh.vertices = d.v;
            sh.inTangents = d.i;
            sh.outTangents = d.o;
            sh.closed = d.closed;
            for (var f = 0; f < SHAPE_FEATHER.length; f++) {
                if (d[SHAPE_FEATHER[f]]) { try { sh[SHAPE_FEATHER[f]] = d[SHAPE_FEATHER[f]]; } catch (e) {} }
            }
            return sh;
        }
        if (d._td) {
            // On modifie le TextDocument existant : AE refuse parfois un document construit de zero.
            var td = prop.valueAtTime(time || 0, false);
            // Repart du style par defaut : rien du calque cible ne doit rester (contour, faux gras...).
            try { td.resetCharStyle(); } catch (eR1) {}
            try { td.resetParagraphStyle(); } catch (eR2) {}
            if (d.text !== undefined) td.text = d.text;
            for (var t = 0; t < TEXT_FIELDS.length; t++) {
                var k = TEXT_FIELDS[t];
                if (TEXT_SKIP[k] || d[k] === undefined) continue;
                if (k === "boxTextSize" && !d.boxText) continue;
                if (k === "leading" && d.autoLeading) continue;
                // Toucher la couleur ou l'epaisseur du contour le rallume : seulement s'il est actif.
                if (TEXT_STROKE[k] && !d.applyStroke) continue;
                if (k === "fillColor" && d.applyFill === false) continue;
                try { td[k] = d[k]; } catch (e3) {}
            }
            // Remplissage et contour en dernier, apres tout ce qui peut les rallumer.
            if (d.applyFill !== undefined) { try { td.applyFill = d.applyFill; } catch (e1) {} }
            if (d.applyStroke !== undefined) { try { td.applyStroke = d.applyStroke; } catch (e2) {} }
            // Styles par caractere / paragraphe, si cette version d'After Effects sait les poser.
            if (d.runs || d.paras) {
                if (typeof td.characterRange === "function") {
                    var r;
                    if (d.paras) for (r = 0; r < d.paras.length; r++) { try { applyStyle(td.characterRange(d.paras[r].s, d.paras[r].e), d.paras[r].st); } catch (eP) {} }
                    if (d.runs) for (r = 0; r < d.runs.length; r++) { try { applyStyle(td.characterRange(d.runs[r].s, d.runs[r].e), d.runs[r].st); } catch (eC) {} }
                } else {
                    warn("text \"" + (d.text || "").substr(0, 30) + "\": several styles in one text need After Effects 2024.3 or later (first style kept)");
                }
            }
            return td;
        }
        if (d._mk) {
            var mv = new MarkerValue(d.comment || "");
            for (var m = 0; m < MARKER_FIELDS.length; m++) {
                var mf = MARKER_FIELDS[m];
                if (mf === "comment" || d[mf] === undefined) continue;
                try { mv[mf] = d[mf]; } catch (e4) {}
            }
            return mv;
        }
        if (d instanceof Array) return fitArray(d, tryGet(prop, "value"));
        return d;
    }

    // ------------------------------------------------------------------ serialisation

    // Groupes de calque qu'on ne recopie pas (styles de calque, proprietes essentielles, trackers).
    var SKIP_GROUPS = { "ADBE Layer Styles": 1, "ADBE Layer Overrides": 1, "ADBE MTrackers": 1 };
    // Proprietes toujours recopiees meme a leur valeur par defaut.
    var ALWAYS = { "ADBE Text Document": 1 };
    // Groupes recopies en entier, valeurs par defaut comprises (leurs proprietes cachees refusent en silence).
    var FULL_GROUPS = { "ADBE Transform Group": 1, "ADBE Material Options Group": 1 };

    function matters(p) {
        try { if (p.numKeys > 0) return true; } catch (e1) {}
        try { if (p.canSetExpression && p.expression !== "") return true; } catch (e2) {}
        try { return p.isModified === true; } catch (e3) { return true; }
    }

    function easeOut(list) {
        var out = [];
        for (var i = 0; i < list.length; i++) out.push([list[i].speed, list[i].influence]);
        return out;
    }

    function serKey(p, k, pvt) {
        var o = { t: p.keyTime(k), v: valueOut(p.keyValue(k), pvt) };
        try { o.ii = p.keyInInterpolationType(k); o.oi = p.keyOutInterpolationType(k); } catch (e1) {}
        try {
            o.ie = easeOut(p.keyInTemporalEase(k));
            o.oe = easeOut(p.keyOutTemporalEase(k));
            o.tc = p.keyTemporalContinuous(k);
            o.ta = p.keyTemporalAutoBezier(k);
        } catch (e2) {}
        if (p.isSpatial) {
            try {
                o.is = plainArray(p.keyInSpatialTangent(k));
                o.os = plainArray(p.keyOutSpatialTangent(k));
                o.sc = p.keySpatialContinuous(k);
                o.sa = p.keySpatialAutoBezier(k);
                o.r = p.keyRoving(k);
            } catch (e3) {}
        }
        // Etiquette de couleur de la cle (AE 22.6+).
        try { var lb = p.keyLabel(k); if (lb) o.lb = lb; } catch (e4) {}
        return o;
    }

    // CharacterRange (AE 24.3+) : lecture et pose des styles par caractere par script.
    X.hasCharRange = (function () {
        try { return typeof (new TextDocument("ab")).characterRange === "function"; } catch (e) { return false; }
    })();

    // Styles par caractere d'un calque texte via une expression getStyleAt (AE 17.0+) : un calque texte
    // temporaire lit l'original et renvoie le tout en JSON, puis il est supprime et la selection rendue.
    // Ce calque vit dans une comp temporaire jamais ouverte : rien n'apparait dans la timeline de
    // l'utilisateur. Seulement si deux comps portent le meme nom (expression comp("nom") ambigue),
    // il est pose dans la comp d'origine comme avant.
    var EXPR_STYLE = ["font", "fontSize", "fillColor", "applyFill", "applyStroke", "strokeColor", "strokeWidth",
        "tracking", "leading", "autoLeading", "baselineShift", "fauxBold", "fauxItalic", "allCaps", "smallCaps"];

    function compNameUnique(comp) {
        var n = 0;
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof CompItem && it.name === comp.name) n++;
        }
        return n === 1;
    }

    function exprRuns(layer, time) {
        var comp = layer.containingComp;
        var keep = [];
        for (var s = 0; s < comp.selectedLayers.length; s++) keep.push(comp.selectedLayers[s]);
        var keepItems = [];
        for (var ps = 0; ps < app.project.selection.length; ps++) keepItems.push(app.project.selection[ps]);
        var tmp = null, tmpComp = null, json = null;
        try {
            var ref;
            if (compNameUnique(comp)) {
                tmpComp = app.project.items.addComp("AECopy temp", 100, 100, 1, Math.max(comp.duration, 1), comp.frameRate);
                tmp = tmpComp.layers.addText("");
                ref = "comp(\"" + comp.name.replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\").layer(" + layer.index + ")";
            } else {
                tmp = comp.layers.addText("");
                ref = "thisComp.layer(" + layer.index + ")";
            }
            var expr = "var s = " + ref + ".text.sourceText; var n = s.value.length; var o = [];" +
                "if (n > 5000) n = 0;" +
                "for (var i = 0; i < n; i++) { var st = s.getStyleAt(i, " + time + ");" +
                " o.push([st.font, st.fontSize, st.fillColor, st.applyFill, st.applyStroke, st.strokeColor, st.strokeWidth," +
                " st.tracking, st.leading, st.autoLeading, st.baselineShift, st.isFauxBold, st.isFauxItalic, st.isAllCaps, st.isSmallCaps]); }" +
                " (typeof JSON !== 'undefined') ? JSON.stringify(o) : o.toSource();";
            var sp = tmp.property("ADBE Text Properties").property("ADBE Text Document");
            sp.expression = expr;
            json = sp.value.text;
        } catch (e) {
            log("text styles: " + errText(e));
        } finally {
            if (tmpComp) { try { tmpComp.remove(); } catch (eC) {} }
            else if (tmp) { try { tmp.remove(); } catch (eR) {} }
            try {
                for (var l = 1; l <= comp.numLayers; l++) comp.layer(l).selected = false;
                for (var k = 0; k < keep.length; k++) keep[k].selected = true;
                for (var pi = 0; pi < keepItems.length; pi++) keepItems[pi].selected = true;
            } catch (eS) {}
        }
        if (!json || json.charAt(0) !== "[") return null;
        var arr = eval("(" + json + ")");
        var runs = [], last = null, lastSig = null;
        for (var i = 0; i < arr.length; i++) {
            var st = {};
            for (var a = 0; a < EXPR_STYLE.length; a++) if (arr[i][a] !== undefined && arr[i][a] !== null) st[EXPR_STYLE[a]] = arr[i][a];
            var sig = toJSON(st);
            if (last && sig === lastSig) last.e = i + 1;
            else { last = { s: i, e: i + 1, st: st }; runs.push(last); lastSig = sig; }
        }
        return runs.length > 1 ? runs : null;
    }

    // keySel : indices de cles a garder (cles selectionnees), sinon toutes.
    function serProp(p, keySel) {
        var pvt = p.propertyValueType;
        if (pvt === PVT.NO_VALUE) return null;
        if (pvt === PVT.CUSTOM_VALUE) {
            warn("cannot be copied (After Effects internal data): " + p.name);
            return null;
        }
        var o = { m: p.matchName, n: p.name };
        // Reference a un autre calque (Displacement Map, Set Matte...) : renumerotee au collage.
        if (pvt === PVT.LAYER_INDEX) o.li = 1;
        if (p.numKeys > 0) {
            o.k = [];
            if (keySel && keySel.length) {
                for (var s = 0; s < keySel.length; s++) o.k.push(serKey(p, keySel[s], pvt));
            } else {
                for (var k = 1; k <= p.numKeys; k++) o.k.push(serKey(p, k, pvt));
            }
        } else {
            try { o.v = valueOut(p.value, pvt); } catch (e) { return null; }
        }
        // Avant AE 2024.3 le script ne voit que le style du 1er caractere : on lit les autres par expression.
        // Seulement si l'appli le demande (un After Effects 2024+ est ouvert) : sinon rien de temporaire n'apparait.
        if (pvt === PVT.TEXT_DOCUMENT && !X.hasCharRange && X.readRuns) {
            try {
                var tl = p.propertyGroup(p.propertyDepth);
                if (o.v && o.v._td && !o.v.runs) { var rv = exprRuns(tl, 0); if (rv) o.v.runs = rv; }
                if (o.k) for (var kr = 0; kr < o.k.length; kr++) {
                    if (o.k[kr].v && o.k[kr].v._td && !o.k[kr].v.runs) { var rk = exprRuns(tl, o.k[kr].t); if (rk) o.k[kr].v.runs = rk; }
                }
            } catch (eRuns) {}
        }
        try {
            if (p.canSetExpression && p.expression !== "") {
                o.x = p.expression;
                o.xe = p.expressionEnabled;
            }
        } catch (e2) {}
        return o;
    }

    // all : garde aussi les proprietes a leur valeur par defaut (Transform).
    function serGroup(g, all) {
        var o = { m: g.matchName, n: g.name, c: [] };
        try { if (g.canSetEnabled) o.en = g.enabled; } catch (e0) {}
        if (g.matchName === "ADBE Mask Atom") {
            o.mask = {};
            var MA = ["maskMode", "inverted", "rotoBezier", "maskMotionBlur", "maskFeatherFalloff", "color", "locked"];
            for (var a = 0; a < MA.length; a++) {
                var av = tryGet(g, MA[a]);
                if (av !== undefined) o.mask[MA[a]] = (typeof av === "object" && av.length !== undefined) ? plainArray(av) : av;
            }
        }
        if (g.matchName === "ADBE Transform Group") {
            try { o.sep = g.property("ADBE Position").dimensionsSeparated; } catch (e1) {}
        }
        for (var i = 1; i <= g.numProperties; i++) {
            var ch;
            try { ch = g.property(i); } catch (e2) { continue; }
            if (!ch || SKIP_GROUPS[ch.matchName]) continue;
            try {
                if (ch.propertyType === PropertyType.PROPERTY) {
                    var important = ALWAYS[ch.matchName] || matters(ch);
                    if (!all && !important) continue;
                    var sp = serProp(ch, null);
                    // Valeur par defaut recopiee par precaution : un refus a la pose reste silencieux.
                    if (sp && !important) sp.q = 1;
                    if (sp) o.c.push(sp);
                } else {
                    // Transform et effets en entier : des plugins (Sapphire...) ne signalent pas leurs
                    // reglages modifies (isModified faux), on perdait tout l'effet.
                    // Options de matiere aussi en entier : un calque cree dans une comp en rendu Calder nait avec
                    // « Casts Shadows » allume, l'original (cree avant le changement de rendu) l'avait eteint.
                    var sub = serGroup(ch, all || FULL_GROUPS[ch.matchName] || g.matchName === "ADBE Effect Parade");
                    // Un enfant de groupe indexe (effet, masque, forme...) existe meme sans valeur modifiee.
                    var keep = sub.c.length > 0 || g.propertyType === PropertyType.INDEXED_GROUP || sub.en === false;
                    if (keep) o.c.push(sub);
                }
            } catch (e3) {
                warn("cannot read " + ch.name + " (" + errText(e3) + ")");
            }
        }
        return o;
    }

    var LAYER_ATTRS = ["enabled", "audioEnabled", "solo", "shy", "motionBlur", "adjustmentLayer", "guideLayer",
        "collapseTransformation", "blendingMode", "quality", "samplingQuality", "label", "comment", "autoOrient",
        "frameBlendingType", "preserveTransparency", "effectsActive", "environmentLayer", "threeDPerChar", "locked"];

    function layerKind(L) {
        if (L instanceof TextLayer) return "text";
        if (L instanceof ShapeLayer) return "shape";
        if (L instanceof CameraLayer) return "camera";
        if (L instanceof LightLayer) return "light";
        if (L.nullLayer) return "null";
        var src = L.source;
        if (src instanceof CompItem) return "comp";
        if (src instanceof FootageItem) {
            if (src.mainSource instanceof SolidSource) return "solid";
            return "footage";
        }
        return "unknown";
    }

    function serLayer(L, pk) {
        var o = {
            kind: layerKind(L), name: L.name, index: L.index,
            startTime: L.startTime, stretch: L.stretch, inPoint: L.inPoint, outPoint: L.outPoint,
            threeD: !!tryGet(L, "threeDLayer"), a: {}
        };
        for (var i = 0; i < LAYER_ATTRS.length; i++) {
            var v = tryGet(L, LAYER_ATTRS[i]);
            if (v !== undefined && v !== null) o.a[LAYER_ATTRS[i]] = v;
        }
        if (L.parent) o.parent = L.parent.index;
        try { o.tr = L.timeRemapEnabled; } catch (e0) {}
        try { if (L.hasTrackMatte || L.trackMatteType !== TrackMatteType.NO_TRACK_MATTE) o.tmType = L.trackMatteType; } catch (e1) {}
        try { if (L.trackMatteLayer) o.tmLayer = L.trackMatteLayer.index; } catch (e2) {}
        if (o.kind === "light") { try { o.lightType = L.lightType; } catch (e3) {} }
        if (o.kind === "text") {
            try {
                var td = L.property("ADBE Text Properties").property("ADBE Text Document").value;
                if (td.boxText) o.box = plainArray(td.boxTextSize);
                // Texte vertical (AE 24.2+).
                if (typeof LineOrientation !== "undefined" && td.lineOrientation !== undefined && td.lineOrientation !== LineOrientation.HORIZONTAL) o.vertical = true;
            } catch (e4) {}
        }
        if (o.kind === "comp" || o.kind === "solid" || o.kind === "footage") o.src = serItem(L.source, pk);
        try {
            var styles = L.property("ADBE Layer Styles");
            for (var s = 2; styles && s <= styles.numProperties; s++) {
                if (styles.property(s).enabled) { warn("layer styles not copied: " + L.name); break; }
            }
        } catch (e5) {}
        o.props = serGroup(L, false);
        return o;
    }

    var SEQ_EXT = /\.(png|jpe?g|tiff?|exr|dpx|tga|bmp|psd|cin|hdr|sgi|rgb|iff|webp|gif)$/i;

    // Enregistre l'element (et ses dependances) dans pk.items, renvoie son id.
    function serItem(it, pk) {
        var key = String(it.id);
        if (pk.items[key]) return key;
        var o = { id: key, name: it.name };
        pk.items[key] = o;
        if (it instanceof CompItem) {
            o.type = "comp";
            o.w = it.width; o.h = it.height; o.pa = it.pixelAspect; o.dur = it.duration; o.fr = it.frameRate;
            o.bg = plainArray(it.bgColor);
            var CA = ["workAreaStart", "workAreaDuration", "displayStartTime", "motionBlur", "shutterAngle", "shutterPhase",
                "frameBlending", "preserveNestedFrameRate", "preserveNestedResolution", "draft3D", "hideShyLayers",
                "renderer", "dropFrame", "comment", "label", "motionBlurSamplesPerFrame", "motionBlurAdaptiveSampleLimit"];
            o.a = {};
            for (var c = 0; c < CA.length; c++) {
                var cv = tryGet(it, CA[c]);
                if (cv !== undefined && cv !== null) o.a[CA[c]] = cv;
            }
            try { o.res = plainArray(it.resolutionFactor); } catch (e0) {}
            try { if (it.markerProperty.numKeys > 0) o.markers = serProp(it.markerProperty, null); } catch (e1) {}
            o.layers = [];
            for (var i = 1; i <= it.numLayers; i++) o.layers.push(serLayer(it.layer(i), pk));
        } else if (it instanceof FootageItem) {
            var src = it.mainSource;
            o.w = it.width; o.h = it.height; o.pa = it.pixelAspect; o.dur = it.duration; o.fr = it.frameRate;
            if (src instanceof SolidSource) {
                o.type = "solid";
                o.color = plainArray(src.color);
            } else if (src instanceof FileSource && src.file) {
                o.type = "file";
                o.path = src.file.fsName;
                o.seq = !src.isStill && SEQ_EXT.test(o.path);
                o.interp = {};
                var IA = ["alphaMode", "premulColor", "invertAlpha", "conformFrameRate", "loop", "fieldSeparationType", "removePulldown", "highQualityFieldSeparation"];
                for (var f = 0; f < IA.length; f++) {
                    var iv = tryGet(src, IA[f]);
                    if (iv !== undefined && iv !== null) o.interp[IA[f]] = (typeof iv === "object" && iv.length !== undefined) ? plainArray(iv) : iv;
                }
            } else {
                o.type = "placeholder";
            }
        }
        return key;
    }

    // ------------------------------------------------------------------ Ctrl+C : ce qui est selectionne

    function ancestorSelected(p) {
        var q = p.parentProperty;
        while (q && q.parentProperty) {
            if (q.selected) return true;
            q = q.parentProperty;
        }
        return false;
    }

    // Suivi des selections : sous AE 2020 activeItem reste null, la comp ou l'on travaille est
    // celle dont la selection de calques/proprietes a change le plus recemment.
    X.selSig = {};
    X.selStamp = {};
    // workStamp : derniere comp ou l'on a travaille (selection de calques, meme vide, ou instant courant
    // change) ; sert a trouver la comp ou coller.
    X.workSig = {};
    X.workStamp = {};
    function trackSelection() {
        var now = new Date().getTime();
        for (var i = 1; i <= app.project.numItems; i++) {
            var c = app.project.item(i);
            if (!(c instanceof CompItem)) continue;
            var sl = c.selectedLayers;
            var sig = "";
            for (var j = 0; j < sl.length; j++) sig += sl[j].index + ":" + sl[j].selectedProperties.length + ",";
            var key = String(c.id);
            if (X.selSig[key] !== sig) {
                if (X.selSig[key] !== undefined && sig !== "") X.selStamp[key] = now;
                X.selSig[key] = sig;
            }
            var wsig = sig + "@" + c.time + "/" + c.numLayers;
            if (X.workSig[key] !== wsig) {
                if (X.workSig[key] !== undefined) X.workStamp[key] = now;
                X.workSig[key] = wsig;
            }
        }
        // Selection du panneau Projet : une comp cliquee la apres les calques = copie de la comp.
        var ps = app.project.selection, psig = "";
        for (var p = 0; p < ps.length; p++) psig += ps[p].id + ",";
        if (X.projSig !== psig) {
            if (X.projSig !== undefined && psig !== "") X.projStamp = now;
            X.projSig = psig;
        }
    }

    function inSelection(item, sel) {
        for (var i = 0; i < sel.length; i++) if (sel[i].id === item.id) return true;
        return false;
    }

    // AE 2020 : app.activeItem revient souvent null depuis la boite aux lettres. On retrouve la comp
    // dont les calques sont selectionnes : celle aussi selectionnee dans le panneau Projet d'abord,
    // sinon la seule qui en a ; une selection Projet sans calques choisis = copie de compositions.
    function markedComp() {
        var it = activeComp();
        // Activer le visualiseur de composition fait revenir activeItem sur sa comp.
        if (!it) {
            try {
                var v = app.activeViewer;
                if (v && v.type === ViewerType.VIEWER_COMPOSITION) { v.setActive(); it = activeComp(); }
            } catch (eV) {}
        }
        var sel = app.project.selection;
        if (it instanceof CompItem && it.selectedLayers.length > 0) {
            // Comp cliquee dans le panneau Projet apres le dernier choix de calques : c'est la comp qu'on copie.
            try { trackSelection(); } catch (eT0) {}
            if (inSelection(it, sel) && (X.projStamp || 0) > (X.selStamp[String(it.id)] || 0)) return "comps";
            return it;
        }
        if (it instanceof CompItem) return null;
        var cands = [];
        for (var i = 1; i <= app.project.numItems; i++) {
            var c = app.project.item(i);
            if (c instanceof CompItem && c.selectedLayers.length > 0) cands.push(c);
        }
        try { trackSelection(); } catch (eT) {}
        var names = [], best = null, bestStamp = 0;
        for (var n = 0; n < cands.length; n++) {
            var st = X.selStamp[String(cands[n].id)] || 0;
            names.push(cands[n].name + (st ? " (" + Math.round((new Date().getTime() - st) / 1000) + " s)" : ""));
            if (st > bestStamp) { bestStamp = st; best = cands[n]; }
        }
        log("Ctrl+C: activeItem " + (it ? it.name : "null") + ", comps with selected layers: " +
            (names.length ? names.join(", ") : "none") + " -> " + (best ? best.name : (cands.length === 1 ? cands[0].name : "?")));
        // Derniere action dans le panneau Projet (une comp y est selectionnee) : on copie la comp.
        var projComp = false;
        for (var pc = 0; pc < sel.length; pc++) if (sel[pc] instanceof CompItem) projComp = true;
        if (projComp && (X.projStamp || 0) > bestStamp) return "comps";
        // La selection la plus recente l'emporte ; sans historique, la comp aussi selectionnee dans le Projet.
        if (best) return best;
        for (var k = 0; k < cands.length; k++) if (inSelection(cands[k], sel)) return cands[k];
        for (var s = 0; s < sel.length; s++) if (sel[s] instanceof CompItem) return "comps";
        return cands.length === 1 ? cands[0] : null;
    }

    // AE 2020 : la commande Reveal Composition in Project selectionne la comp ouverte dans le panneau
    // Projet ; on la lit puis on rend la selection d'avant (sinon un Ctrl+C suivant copierait la comp).
    function revealedComp() {
        var id = 0;
        try { id = app.findMenuCommandId("Reveal Composition in Project"); } catch (eF) {}
        if (!id) return null;
        var keep = plainArray(app.project.selection), found = null;
        try {
            for (var k = 0; k < keep.length; k++) keep[k].selected = false;
            app.executeCommand(id);
            var sel = app.project.selection;
            if (sel.length === 1 && sel[0] instanceof CompItem) found = sel[0];
        } catch (e) { log("reveal comp: " + errText(e)); }
        try {
            var now = app.project.selection;
            for (var n = now.length - 1; n >= 0; n--) now[n].selected = false;
            for (var r = 0; r < keep.length; r++) keep[r].selected = true;
        } catch (eR) {}
        return found;
    }

    // Comp ou coller : la comp active ; sous AE 2020 (activeItem null) celle ou l'on a travaille en dernier
    // (ou celle cliquee dans le panneau Projet si c'est plus recent), sinon celle selectionnee dans le
    // panneau Projet, celle qui a des calques selectionnes, ou la seule comp du projet.
    function targetComp() {
        var it = activeComp();
        if (!it) {
            try {
                var v = app.activeViewer;
                if (v && v.type === ViewerType.VIEWER_COMPOSITION) { v.setActive(); it = activeComp(); }
            } catch (eV) {}
        }
        if (it instanceof CompItem) return it;
        var shown = revealedComp();
        if (shown) { log("Ctrl+V: open comp " + shown.name); return shown; }
        try { trackSelection(); } catch (eT) {}
        var sel = app.project.selection, selComp = null;
        for (var s = 0; s < sel.length; s++) if (sel[s] instanceof CompItem) { selComp = sel[s]; break; }
        var best = null, bestStamp = 0, withLayers = [], only = null, count = 0;
        for (var i = 1; i <= app.project.numItems; i++) {
            var c = app.project.item(i);
            if (!(c instanceof CompItem)) continue;
            only = c; count++;
            if (c.selectedLayers.length) withLayers.push(c);
            var st = X.workStamp[String(c.id)] || 0;
            if (st > bestStamp) { bestStamp = st; best = c; }
        }
        var pick = (selComp && (X.projStamp || 0) > bestStamp) ? selComp :
            best || selComp || (withLayers.length === 1 ? withLayers[0] : null) || (count === 1 ? only : null);
        log("Ctrl+V: activeItem null, last worked in " + (best ? best.name + " (" + Math.round((new Date().getTime() - bestStamp) / 1000) + " s)" : "none") +
            ", project selection " + (selComp ? selComp.name : "none") + " -> " + (pick ? pick.name : "new comp"));
        return pick;
    }

    X.doMark = function () {
        X.mark = null;
        // "comps" : copie de la (des) comp(s) selectionnee(s) dans le panneau Projet.
        var mc = markedComp();
        var it = mc === "comps" ? null : (mc || activeComp());
        if (it instanceof CompItem && it.selectedLayers.length > 0) {
            var props = [];
            var sel = it.selectedLayers;
            for (var i = 0; i < sel.length; i++) {
                var sp = sel[i].selectedProperties;
                for (var j = 0; j < sp.length; j++) {
                    if (ancestorSelected(sp[j])) continue;
                    var entry = { li: sel[i].index, path: pathOf(sp[j]) };
                    if (sp[j].propertyType === PropertyType.PROPERTY) {
                        try { if (sp[j].selectedKeys.length) entry.keys = plainArray(sp[j].selectedKeys); } catch (e) {}
                    }
                    props.push(entry);
                }
            }
            if (props.length) {
                X.mark = { kind: "props", comp: it.id, items: props };
                return "ok " + props.length + " property(ies)";
            }
            var idx = [];
            for (var k = 0; k < sel.length; k++) idx.push(sel[k].index);
            idx.sort(function (a, b) { return a - b; });
            X.mark = { kind: "layers", comp: it.id, layers: idx };
            return "ok " + idx.length + " layer(s)";
        }
        var comps = [];
        var ps = app.project.selection;
        for (var c = 0; c < ps.length; c++) if (ps[c] instanceof CompItem) comps.push(ps[c].id);
        if (!comps.length && it instanceof CompItem) comps.push(it.id);
        if (!comps.length) return "empty";
        X.mark = { kind: "comps", ids: comps };
        return "ok " + comps.length + " composition(s)";
    };

    // ------------------------------------------------------------------ export (cote source)

    X.doExport = function () {
        // Un seul pas d'annulation : la lecture des styles de texte (AE < 2024.3) ajoute un calque temporaire.
        app.beginUndoGroup("AECopy");
        try { return exportCore(); } finally { app.endUndoGroup(); }
    };

    function exportCore() {
        var m = X.mark;
        if (!m) throw new Error("nothing copied in this After Effects");
        var pk = {
            fmt: "AECopy", v: 1, ae: app.version, kind: m.kind, created: new Date().toString(),
            src: app.project.file ? app.project.file.displayName : "Untitled Project", items: {}
        };
        if (m.kind === "comps") {
            pk.roots = [];
            for (var i = 0; i < m.ids.length; i++) {
                var c = itemById(m.ids[i]);
                if (c) pk.roots.push(serItem(c, pk));
            }
            if (!pk.roots.length) throw new Error("the copied composition no longer exists");
        } else {
            var comp = itemById(m.comp);
            if (!(comp instanceof CompItem)) throw new Error("the copied composition no longer exists");
            pk.comp = { name: comp.name, w: comp.width, h: comp.height, pa: comp.pixelAspect, dur: comp.duration, fr: comp.frameRate };
            if (m.kind === "layers") {
                pk.layers = [];
                for (var l = 0; l < m.layers.length; l++) {
                    if (m.layers[l] <= comp.numLayers) pk.layers.push(serLayer(comp.layer(m.layers[l]), pk));
                }
            } else {
                pk.props = [];
                for (var p = 0; p < m.items.length; p++) {
                    var e = m.items[p];
                    if (e.li > comp.numLayers) continue;
                    var layer = comp.layer(e.li);
                    var prop;
                    try { prop = resolve(layer, e.path); } catch (eR) { continue; }
                    var chain = [];
                    var q = prop;
                    while (q && q.parentProperty) { chain.unshift(q.matchName); q = q.parentProperty; }
                    var spec = (prop.propertyType === PropertyType.PROPERTY) ? serProp(prop, e.keys) : serGroup(prop, false);
                    if (spec) pk.props.push({ chain: chain, spec: spec, leaf: prop.propertyType === PropertyType.PROPERTY });
                }
            }
        }
        writeText(X.ROOT + "\\clipboard.json", toJSON(pk));
        var n = pk.roots ? pk.roots.length : (pk.layers ? pk.layers.length : pk.props.length);
        return "ok " + n;
    }

    // ------------------------------------------------------------------ collage : proprietes

    function easeIn(list, want) {
        var out = [];
        for (var i = 0; i < want; i++) {
            var e = list[Math.min(i, list.length - 1)];
            out.push(new KeyframeEase(e[0], Math.max(0.1, Math.min(100, e[1]))));
        }
        return out;
    }

    function applyKeys(p, keys, offset) {
        var times = [], values = [], isMarker = false;
        for (var i = 0; i < keys.length; i++) {
            times.push(keys[i].t + offset);
            values.push(valueIn(p, keys[i].v, keys[i].t + offset));
            if (keys[i].v && keys[i].v._mk) isMarker = true;
        }
        if (isMarker || keys[0].v && keys[0].v._td) {
            for (var m = 0; m < times.length; m++) p.setValueAtTime(times[m], values[m]);
        } else {
            try { p.setValuesAtTimes(times, values); } catch (e) {
                for (var s = 0; s < times.length; s++) p.setValueAtTime(times[s], values[s]);
            }
        }
        // Les anciennes cles partent APRES la pose des nouvelles : vider d'abord une propriete
        // (Time Remap) la desactive, et les nouvelles cles ne passent plus.
        for (var old = p.numKeys; old >= 1; old--) {
            var kt = p.keyTime(old), keep = false;
            for (var w = 0; w < times.length; w++) if (Math.abs(times[w] - kt) < 1e-4) keep = true;
            if (!keep) p.removeKey(old);
        }
        for (var j = 0; j < keys.length; j++) {
            var kd = keys[j];
            var k = p.nearestKeyIndex(times[j]);
            // Ease d'abord : il force la cle en Bezier, l'interpolation lineaire/maintien est reposee ensuite.
            if (kd.ie && kd.oe) {
                try {
                    var want = p.keyInTemporalEase(k).length;
                    p.setTemporalEaseAtKey(k, easeIn(kd.ie, want), easeIn(kd.oe, want));
                } catch (e1) {}
            }
            if (kd.ii !== undefined) { try { p.setInterpolationTypeAtKey(k, kd.ii, kd.oi); } catch (e2) {} }
            if (kd.lb) { try { p.setLabelAtKey(k, kd.lb); } catch (eL) {} }
            if (kd.tc !== undefined) { try { p.setTemporalContinuousAtKey(k, kd.tc); } catch (e3) {} }
            if (kd.ta !== undefined) { try { p.setTemporalAutoBezierAtKey(k, kd.ta); } catch (e4) {} }
            if (kd.is && p.isSpatial) {
                try {
                    var ref = p.keyInSpatialTangent(k);
                    p.setSpatialTangentsAtKey(k, fitArray(kd.is, ref), fitArray(kd.os, ref));
                } catch (e5) {}
                if (kd.sc !== undefined) { try { p.setSpatialContinuousAtKey(k, kd.sc); } catch (e6) {} }
                if (kd.sa !== undefined) { try { p.setSpatialAutoBezierAtKey(k, kd.sa); } catch (e7) {} }
            }
        }
        // Le deplacement itinerant se pose en dernier : il depend des cles voisines.
        for (var r = 0; r < keys.length; r++) {
            if (keys[r].r) { try { p.setRovingAtKey(p.nearestKeyIndex(times[r]), true); } catch (e8) {} }
        }
    }

    // quiet : Transform est recopie en entier, ses proprietes 3D cachees sur un calque 2D refusent la valeur.
    function applyProp(p, spec, offset, quiet) {
        try {
            if (spec.k && spec.k.length) {
                applyKeys(p, spec.k, offset);
            } else if (spec.v !== undefined) {
                // Time Remap active sans cles : AE en pose deux d'office, il faut les garder.
                if (p.numKeys > 0 && p.matchName !== "ADBE Time Remapping") { while (p.numKeys > 0) p.removeKey(1); }
                // Texte cible vide (collage d'effets/animation sur un calque texte vide) : le texte d'abord.
                if (spec.v && spec.v._td && spec.v.text && p.value.text === "") {
                    var first = p.value; first.text = spec.v.text; p.setValue(first);
                }
                var v = valueIn(p, spec.v, 0);
                // Numero de calque : celui du calque recree (l'ordre change au collage), 0 si pas copie.
                if (spec.li && X.layerRemap && typeof v === "number" && v > 0) {
                    v = X.layerRemap[v] ? X.layerRemap[v].index : 0;
                }
                p.setValue(v);
                if (spec.v && spec.v._td) checkText(p, spec.v, p.propertyGroup(p.propertyDepth).name);
            }
        } catch (e) {
            if (!quiet && !spec.q) warn("value not applied: " + spec.n + " (" + errText(e) + ")");
        }
        if (spec.x !== undefined) {
            try { p.expression = spec.x; p.expressionEnabled = spec.xe !== false; } catch (e2) {
                warn("expression not applied: " + spec.n);
            }
        }
    }

    function findChild(g, matchName, occurrence) {
        var seen = 0;
        for (var i = 1; i <= g.numProperties; i++) {
            if (g.property(i).matchName === matchName) {
                seen++;
                if (seen === occurrence) return i;
            }
        }
        return 0;
    }

    // Les references de proprietes deviennent invalides apres un addProperty : on repart
    // toujours du calque par le chemin d'indices.
    function addChild(layer, path, spec) {
        var g = resolve(layer, path);
        if (!g.canAddProperty(spec.m)) return 0;
        var np = g.addProperty(spec.m);
        if (!np) return 0;
        var idx = np.propertyIndex;
        if (spec.n) { try { if (np.name !== spec.n) np.name = spec.n; } catch (e) {} }
        return idx;
    }

    function applyGroup(layer, path, spec, offset) {
        var g = resolve(layer, path);
        if (spec.mask) {
            for (var a in spec.mask) {
                if (a === "locked") continue;
                try { g[a] = spec.mask[a]; } catch (e0) {}
            }
        }
        if (spec.sep !== undefined) {
            try { g.property("ADBE Position").dimensionsSeparated = spec.sep; } catch (e1) {}
        }
        var seen = {};
        for (var i = 0; i < spec.c.length; i++) {
            var c = spec.c[i];
            var parent = resolve(layer, path);
            var idx = 0;
            if (parent.propertyType === PropertyType.INDEXED_GROUP && parent.canAddProperty(c.m)) {
                try { idx = addChild(layer, path, c); } catch (e3) { idx = 0; }
                if (!idx) { warn("missing in this After Effects: " + c.n + " (" + c.m + ")"); continue; }
            } else {
                seen[c.m] = (seen[c.m] || 0) + 1;
                // Groupe nomme a emplacements caches (Properties d'un animateur de texte : 95 proprietes
                // cachees) : addProperty fait apparaitre la propriete, sans quoi elle refuse toute valeur.
                if (parent.canAddProperty(c.m)) {
                    try { resolve(layer, path).addProperty(c.m); } catch (eShow) {}
                    parent = resolve(layer, path);
                }
                idx = findChild(parent, c.m, seen[c.m]);
                // Introuvable : signale seulement entre memes versions (sinon reglage d'une version plus recente).
                if (!idx) { if (X.pasteSameVersion && (c.c || c.k || c.x !== undefined || c.v !== undefined)) warn("not found here: " + c.n); continue; }
            }
            var cp = path.concat([idx]);
            if (c.c) {
                applyGroup(layer, cp, c, offset);
            } else {
                var p = resolve(layer, cp);
                if (c.m === "ADBE Position" && p.dimensionsSeparated) continue;
                if (p.isSeparationFollower && !p.parentProperty.property("ADBE Position").dimensionsSeparated) continue;
                applyProp(p, c, offset, FULL_GROUPS[spec.m] === 1);
            }
            if (c.en !== undefined) { try { resolve(layer, cp).enabled = c.en; } catch (e4) {} }
            if (c.mask && c.mask.locked) { try { resolve(layer, cp).locked = true; } catch (e5) {} }
        }
    }

    // ------------------------------------------------------------------ collage : elements et calques

    function findFootage(path) {
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            try {
                if (it instanceof FootageItem && it.mainSource instanceof FileSource && it.mainSource.file &&
                    it.mainSource.file.fsName.toLowerCase() === path.toLowerCase()) return it;
            } catch (e) {}
        }
        return null;
    }

    function makeFootage(rec, ctx) {
        if (ctx.made[rec.id]) return ctx.made[rec.id];
        var it = null;
        if (rec.type === "file") {
            it = findFootage(rec.path);
            if (!it) {
                var f = new File(rec.path);
                if (f.exists) {
                    var io = new ImportOptions(f);
                    if (rec.seq && io.canImportAs(ImportAsType.FOOTAGE)) { try { io.sequence = true; } catch (e0) {} }
                    it = app.project.importFile(io);
                    for (var k in rec.interp) { try { it.mainSource[k] = rec.interp[k]; } catch (e1) {} }
                    ctx.created.push(it);
                } else {
                    warn("missing file, replaced by a placeholder: " + rec.path);
                }
            }
        }
        if (!it) {
            it = app.project.importPlaceholder(rec.name, Math.max(4, rec.w || 1920), Math.max(4, rec.h || 1080),
                rec.fr || 25, Math.max(rec.dur || 0, 1 / (rec.fr || 25)));
            ctx.created.push(it);
        }
        ctx.made[rec.id] = it;
        return it;
    }

    function makeComp(id, ctx) {
        if (ctx.made[id]) return ctx.made[id];
        var rec = ctx.pk.items[id];
        var c = app.project.items.addComp(rec.name, rec.w, rec.h, rec.pa, Math.max(rec.dur, 1 / rec.fr), rec.fr);
        ctx.made[id] = c;
        ctx.created.push(c);
        try { c.bgColor = rec.bg; } catch (e0) {}
        for (var a in rec.a) {
            if (a === "workAreaStart" || a === "workAreaDuration") continue;
            try { c[a] = rec.a[a]; } catch (e1) {}
        }
        try { c.workAreaStart = rec.a.workAreaStart; c.workAreaDuration = rec.a.workAreaDuration; } catch (e2) {}
        try { if (rec.res) c.resolutionFactor = rec.res; } catch (e3) {}
        buildLayers(c, rec.layers, ctx, null);
        if (rec.markers) { try { applyProp(c.markerProperty, rec.markers, 0); } catch (e4) {} }
        return c;
    }

    // Texte du calque copie (valeur fixe ou premiere cle de Source Text).
    function layerText(L) {
        var found = null;
        (function walk(g) {
            for (var i = 0; i < g.c.length && found === null; i++) {
                var c = g.c[i];
                if (c.c) walk(c);
                else if (c.m === "ADBE Text Document") found = c.v ? c.v.text : (c.k && c.k.length ? c.k[0].v.text : null);
            }
        })(L.props);
        return found;
    }

    function createLayer(comp, L, ctx) {
        var dur = comp.duration;
        var nl;
        if (L.kind === "text") {
            // Jamais vide : sur un texte vide, AE 2020 ignore le style pose ensuite (police, taille, contour).
            var txt = layerText(L) || " ";
            if (L.vertical && typeof comp.layers.addVerticalText === "function") {
                nl = L.box ? comp.layers.addVerticalBoxText(L.box, txt) : comp.layers.addVerticalText(txt);
            } else {
                if (L.vertical) warn("vertical text needs After Effects 2024.2 or later: " + L.name);
                nl = L.box ? comp.layers.addBoxText(L.box, txt) : comp.layers.addText(txt);
            }
        } else if (L.kind === "shape") {
            nl = comp.layers.addShape();
        } else if (L.kind === "camera") {
            nl = comp.layers.addCamera(L.name, [comp.width / 2, comp.height / 2]);
        } else if (L.kind === "light") {
            nl = comp.layers.addLight(L.name, [comp.width / 2, comp.height / 2]);
            if (L.lightType !== undefined) { try { nl.lightType = L.lightType; } catch (e0) {} }
            // Lumiere d'environnement : seul le rendu « Calder » l'accepte, ailleurs AE la change en ambiante.
            if (L.lightType !== undefined && nl.lightType !== L.lightType) warn("light \"" + L.name + "\": this comp's 3D renderer does not support its light type (an environment light needs the Calder renderer)");
        } else if (L.kind === "null") {
            nl = comp.layers.addNull(dur);
        } else if (L.kind === "solid") {
            var rec = ctx.pk.items[L.src];
            if (ctx.made[L.src]) {
                nl = comp.layers.add(ctx.made[L.src]);
            } else {
                nl = comp.layers.addSolid(rec.color, rec.name, rec.w, rec.h, rec.pa, dur);
                ctx.made[L.src] = nl.source;
            }
        } else if (L.kind === "comp") {
            nl = comp.layers.add(makeComp(L.src, ctx));
        } else if (L.kind === "footage") {
            nl = comp.layers.add(makeFootage(ctx.pk.items[L.src], ctx));
        } else {
            warn("unknown layer type, replaced by a null: " + L.name);
            nl = comp.layers.addNull(dur);
        }
        try { if (nl.name !== L.name) nl.name = L.name; } catch (e1) {}
        return nl;
    }

    // Construit les calques L (ordre du haut vers le bas) dans comp. above : calque au-dessus duquel coller.
    function buildLayers(comp, layers, ctx, above) {
        var made = [];
        var byOld = {};
        // Chaque ajout se place en haut : on cree du bas vers le haut pour garder l'ordre.
        for (var i = layers.length - 1; i >= 0; i--) {
            var nl = createLayer(comp, layers[i], ctx);
            made[i] = nl;
        }
        if (above) {
            for (var m = 0; m < made.length; m++) { try { made[m].moveBefore(above); } catch (eM) {} }
        }
        for (var b = 0; b < layers.length; b++) byOld[layers[b].index] = made[b];

        for (var j = 0; j < layers.length; j++) {
            var L = layers[j], nl2 = made[j];
            try { nl2.threeDLayer = L.threeD; } catch (e0) {}
            try { if (L.stretch !== 100) nl2.stretch = L.stretch; } catch (e1) {}
            try { nl2.startTime = L.startTime; } catch (e2) {}
            if (L.tr) { try { nl2.timeRemapEnabled = true; } catch (e3) {} }
        }
        // Parentage sans compensation : les valeurs recopiees sont deja dans l'espace du parent.
        for (var p = 0; p < layers.length; p++) {
            if (layers[p].parent === undefined) continue;
            var par = byOld[layers[p].parent];
            if (!par) { warn("parent not copied: " + layers[p].name); continue; }
            try {
                if (typeof made[p].setParentWithJump === "function") made[p].setParentWithJump(par);
                else made[p].parent = par;
            } catch (eP) {}
        }
        X.layerRemap = byOld;
        for (var q = 0; q < layers.length; q++) {
            // Masques d'abord : « Path » d'un texte sur trace (et des effets) renvoie a un masque deja cree.
            var ordered = { m: layers[q].props.m, n: layers[q].props.n, c: [] };
            var rest = [];
            var material = null;
            for (var oc = 0; oc < layers[q].props.c.length; oc++) {
                var top = layers[q].props.c[oc];
                if (top.m === "ADBE Mask Parade") ordered.c.push(top);
                else if (top.m === "ADBE Material Options Group" && !layers[q].threeD) material = top;
                else rest.push(top);
            }
            ordered.c = ordered.c.concat(rest);
            // Calque 2D : ses options de matiere sont cachees et refusent toute valeur ; on le passe en 3D
            // le temps de les poser (sinon il garde les reglages par defaut du rendu de la comp cible).
            if (material) {
                try {
                    made[q].threeDLayer = true;
                    applyGroup(made[q], [], { m: ordered.m, n: ordered.n, c: [material] }, 0);
                } catch (eMat) {}
                try { made[q].threeDLayer = false; } catch (eMat2) {}
            }
            try { applyGroup(made[q], [], ordered, 0); } catch (eG) {
                warn("incomplete layer: " + layers[q].name + " (" + errText(eG) + ")");
            }
        }
        X.layerRemap = null;
        for (var r = 0; r < layers.length; r++) {
            var L2 = layers[r], nl3 = made[r];
            // Sur un solide, regler l'entree deplace aussi la sortie : la sortie se pose toujours en dernier.
            try { nl3.inPoint = L2.inPoint; } catch (e4) {}
            try { nl3.outPoint = L2.outPoint; } catch (e5) {}
            if (Math.abs(nl3.inPoint - L2.inPoint) > 1e-4) {
                try { nl3.inPoint = L2.inPoint; nl3.outPoint = L2.outPoint; } catch (e6) {}
            }
            if (L2.tmType !== undefined) {
                var matte = (L2.tmLayer !== undefined) ? byOld[L2.tmLayer] : null;
                try {
                    if (matte && typeof nl3.setTrackMatte === "function") nl3.setTrackMatte(matte, L2.tmType);
                    else nl3.trackMatteType = L2.tmType;
                } catch (e6) { warn("track matte not applied: " + L2.name); }
            }
            for (var a in L2.a) {
                if (a === "locked") continue;
                try { nl3[a] = L2.a[a]; } catch (e7) {}
            }
        }
        for (var s = 0; s < layers.length; s++) {
            if (layers[s].a.locked) { try { made[s].locked = true; } catch (e8) {} }
        }
        return made;
    }

    function pasteProps(pk) {
        var comp = targetComp();
        if (!(comp instanceof CompItem) || comp.selectedLayers.length === 0) {
            throw new Error("select the layer(s) to paste the effects / animation onto");
        }
        // Comme dans After Effects : des cles collees commencent a l'instant courant.
        var first = null;
        for (var i = 0; i < pk.props.length; i++) {
            var sp = pk.props[i].spec;
            if (pk.props[i].leaf && sp.k && sp.k.length) {
                for (var k = 0; k < sp.k.length; k++) if (first === null || sp.k[k].t < first) first = sp.k[k].t;
            }
        }
        var targets = comp.selectedLayers;
        for (var t = 0; t < targets.length; t++) {
            var layer = targets[t];
            for (var j = 0; j < pk.props.length; j++) {
                var e = pk.props[j];
                var path = [];
                var ok = true, created = false;
                var seen = {};
                for (var c = 0; c < e.chain.length; c++) {
                    var g = resolve(layer, path);
                    var m = e.chain[c];
                    var last = c === e.chain.length - 1;
                    var idx = 0;
                    if (last && !e.leaf && g.propertyType === PropertyType.INDEXED_GROUP && g.canAddProperty(m)) {
                        idx = addChild(layer, path, e.spec);
                        created = true;
                    } else {
                        idx = findChild(g, m, 1);
                        if (!idx && g.canAddProperty(m)) { idx = addChild(layer, path, { m: m }); }
                    }
                    if (!idx) { ok = false; break; }
                    path.push(idx);
                }
                if (!ok) { warn("does not apply to " + layer.name + ": " + e.spec.n); continue; }
                if (e.leaf) {
                    var off = (e.spec.k && first !== null) ? comp.time - first : 0;
                    applyProp(resolve(layer, path), e.spec, off);
                } else {
                    applyGroup(layer, path, e.spec, 0);
                    if (e.spec.en !== undefined) { try { resolve(layer, path).enabled = e.spec.en; } catch (eE) {} }
                }
            }
        }
        return pk.props.length + " property(ies) on " + targets.length + " layer(s)";
    }

    // ------------------------------------------------------------------ verification apres collage

    function roundDeep(v) {
        if (typeof v === "number") return Math.round(v * 1000) / 1000;
        if (v instanceof Array) { var a = []; for (var i = 0; i < v.length; i++) a.push(roundDeep(v[i])); return a; }
        if (v && typeof v === "object") { var o = {}; for (var k in v) if (v.hasOwnProperty(k)) o[k] = roundDeep(v[k]); return o; }
        return v;
    }

    // Styles par caractere comparables d'une version a l'autre : caractere par caractere, sur les seuls
    // reglages que lit aussi l'expression d'AE 2020 (EXPR_STYLE), puis regroupes en suites.
    function normRuns(runs) {
        var parts = [], prev = null;
        for (var r = 0; r < runs.length; r++) {
            var st = {};
            for (var a = 0; a < EXPR_STYLE.length; a++) {
                var k = EXPR_STYLE[a];
                if (runs[r].st[k] === undefined || (k === "leading" && runs[r].st.autoLeading)) continue;
                st[k] = roundDeep(runs[r].st[k]);
            }
            var sig = toJSON(st);
            if (prev && prev.sig === sig && prev.e === runs[r].s) prev.e = runs[r].e;
            else { prev = { s: runs[r].s, e: runs[r].e, sig: sig }; parts.push(prev); }
        }
        var outS = [];
        for (var p = 0; p < parts.length; p++) outS.push(parts[p].s + "-" + parts[p].e + ":" + parts[p].sig);
        return outS.join(" ");
    }

    // Arbre de proprietes -> { "Transform/Position": "valeur", ... } ; un TextDocument est eclate par champ.
    function flatten(spec, prefix, out) {
        var seen = {};
        for (var i = 0; i < spec.c.length; i++) {
            var c = spec.c[i];
            seen[c.m] = (seen[c.m] || 0) + 1;
            var key = prefix + "/" + (c.n || c.m) + (seen[c.m] > 1 ? "#" + seen[c.m] : "");
            if (c.c) { flatten(c, key, out); continue; }
            if (c.v && c.v._td) {
                for (var f in c.v) {
                    if (!c.v.hasOwnProperty(f) || f === "_td") continue;
                    out[key + " |text." + f] = f === "runs" ? normRuns(c.v.runs) : toJSON(roundDeep(c.v[f]));
                }
            } else {
                // Cle itinerante : After Effects recalcule lui-meme son instant, on ne le compare pas.
                var keys = c.k;
                if (keys) {
                    keys = [];
                    for (var r = 0; r < c.k.length; r++) {
                        var kc = {};
                        for (var kf in c.k[r]) if (c.k[r].hasOwnProperty(kf) && !(kf === "t" && c.k[r].r)) kc[kf] = c.k[r][kf];
                        keys.push(kc);
                    }
                }
                out[key] = toJSON(roundDeep(keys ? keys : c.v));
            }
            if (c.x !== undefined) out[key + " (expression)"] = toJSON(c.x);
        }
        return out;
    }

    // Premier ecart entre deux valeurs JSON : « key 3 .t: 2 -> 2.1 » plutot que deux longues chaines coupees.
    function explainDiff(a, b) {
        var va, vb;
        try { va = fromJSON("{\"x\":" + a + "}").x; vb = fromJSON("{\"x\":" + b + "}").x; } catch (e) { return a.substr(0, 80) + " -> " + b.substr(0, 80); }
        var path = "";
        for (var depth = 0; depth < 4; depth++) {
            if (va instanceof Array && vb instanceof Array) {
                if (va.length !== vb.length) return path + " " + va.length + " item(s) -> " + vb.length;
                var hit = -1;
                for (var i = 0; i < va.length && hit < 0; i++) if (toJSON(va[i]) !== toJSON(vb[i])) hit = i;
                if (hit < 0) break;
                path += (va[hit] && typeof va[hit] === "object" && va[hit].t !== undefined) ? " key " + (hit + 1) : "[" + hit + "]";
                va = va[hit]; vb = vb[hit];
            } else if (va && vb && typeof va === "object" && typeof vb === "object") {
                var field = null;
                for (var f in va) if (va.hasOwnProperty(f) && toJSON(va[f]) !== toJSON(vb[f])) { field = f; break; }
                if (field === null) for (var g in vb) if (vb.hasOwnProperty(g) && va[g] === undefined) { field = g; break; }
                if (field === null) break;
                path += "." + field;
                va = va[field]; vb = vb[field];
            } else break;
        }
        return (path ? path.replace(/^ /, "") + ": " : "") + toJSON(va).substr(0, 60) + " -> " + toJSON(vb).substr(0, 60);
    }

    function verifyLayers(src, made, srcVersion) {
        var total = 0;
        var sameVersion = String(srcVersion).split(".")[0] === app.version.split(".")[0];
        for (var i = 0; i < src.length && i < made.length; i++) {
            var saved = X.warnings;
            X.warnings = [];
            var got = serLayer(made[i], { items: {} });
            X.warnings = saved;
            var diffs = [];
            if (src[i].parent !== undefined && got.parent === undefined) diffs.push("parent: lost (the parent was not copied)");
            if (got.kind !== src[i].kind) diffs.push("layer type: " + src[i].kind + " -> " + got.kind);
            if (toJSON(roundDeep(got.box)) !== toJSON(roundDeep(src[i].box))) diffs.push("text box: " + toJSON(src[i].box) + " -> " + toJSON(got.box));
            var T = ["startTime", "stretch", "inPoint", "outPoint", "threeD"];
            for (var t = 0; t < T.length; t++) {
                if (toJSON(roundDeep(got[T[t]])) !== toJSON(roundDeep(src[i][T[t]]))) diffs.push(T[t] + " : " + src[i][T[t]] + " -> " + got[T[t]]);
            }
            for (var a in src[i].a) {
                if (src[i].a.hasOwnProperty(a) && toJSON(got.a[a]) !== toJSON(src[i].a[a])) diffs.push(a + " : " + toJSON(src[i].a[a]) + " -> " + toJSON(got.a[a]));
            }
            var fs = flatten(src[i].props, "", {}), fg = flatten(got.props, "", {});
            for (var k in fs) {
                if (!fs.hasOwnProperty(k)) continue;
                // Reglage de texte inconnu de cette version d'After Effects (AE 2020 face a 2025) : ignore.
                if (fg[k] === undefined && k.indexOf(" |text.") >= 0) continue;
                if (fg[k] === undefined) diffs.push(k + ": missing (original " + fs[k].substr(0, 80) + ")");
                else if (fg[k] !== fs[k]) diffs.push(k + ": " + explainDiff(fs[k], fg[k]));
            }
            // Reglages en plus dans la copie : entre deux versions d'AE ce sont ceux que seule la plus recente
            // connait (texte, nouveaux parametres d'effets), pas des erreurs.
            for (var g in fg) {
                if (!fg.hasOwnProperty(g) || fs[g] !== undefined || g.indexOf("Transform/") >= 0) continue;
                if (g.indexOf(" |text.") >= 0 || !sameVersion) continue;
                diffs.push(g + ": extra (" + fg[g].substr(0, 80) + ")");
            }
            total += diffs.length;
            log("check \"" + src[i].name + "\": " + (diffs.length ? diffs.length + " difference(s)\n    " + diffs.join("\n    ") : "identical"));
        }
        if (total) warn(total + " setting(s) differ from the original, details in the log");
    }

    function pasteLayers(pk, ctx) {
        var comp = targetComp();
        // Aucune comp ouverte : on en cree une aux reglages de la comp d'origine.
        if (!(comp instanceof CompItem)) {
            var pc = pk.comp || { name: "Pasted", w: 1920, h: 1080, pa: 1, dur: 10, fr: 25 };
            comp = app.project.items.addComp(pc.name, pc.w, pc.h, pc.pa, pc.dur, pc.fr);
            try { comp.openInViewer(); } catch (eO) {}
        }
        var above = null;
        var sel = comp.selectedLayers;
        for (var i = 0; i < sel.length; i++) if (!above || sel[i].index < above.index) above = sel[i];
        var made = buildLayers(comp, pk.layers, ctx, above);
        if (pk.comp && (pk.comp.w !== comp.width || pk.comp.h !== comp.height)) {
            log("source comp " + pk.comp.w + "x" + pk.comp.h + ", target comp " + comp.width + "x" + comp.height + ": positions copied as they are");
        }
        try { verifyLayers(pk.layers, made, pk.ae); } catch (eV) { log("check: " + errText(eV)); }
        for (var s = 1; s <= comp.numLayers; s++) comp.layer(s).selected = false;
        for (var m = 0; m < made.length; m++) { try { made[m].selected = true; } catch (e) {} }
        return made.length + " layer(s) in " + comp.name;
    }

    // nest : glisser-deposer d'une comp, comme dans After Effects elle est aussi posee en calque dans la
    // comp ouverte (au-dessus du calque selectionne). Ctrl+V : seulement dans le projet.
    function pasteComps(pk, ctx, nest) {
        // Comp d'arrivee choisie AVANT de creer les nouvelles (elles fausseraient « la seule comp du projet »).
        var host = nest ? targetComp() : null;
        var roots = [];
        for (var i = 0; i < pk.roots.length; i++) roots.push(makeComp(pk.roots[i], ctx));
        var nested = 0;
        if (host instanceof CompItem) {
            var above = null;
            for (var s = 0; s < host.selectedLayers.length; s++) if (!above || host.selectedLayers[s].index < above.index) above = host.selectedLayers[s];
            for (var l = 1; l <= host.numLayers; l++) host.layer(l).selected = false;
            for (var n = roots.length - 1; n >= 0; n--) {
                try {
                    var lay = host.layers.add(roots[n]);
                    if (above) lay.moveBefore(above);
                    lay.selected = true;
                    nested++;
                } catch (eN) { warn("could not place " + roots[n].name + " in " + host.name + ": " + errText(eN)); }
            }
        } else if (nest) {
            warn("no open composition to place it in: added to the Project panel only");
        }
        // Les dependances (precomps, rushes) vont dans un dossier, les comps collees restent a la racine.
        var deps = [];
        for (var c = 0; c < ctx.created.length; c++) {
            var isRoot = false;
            for (var r = 0; r < roots.length; r++) if (roots[r] === ctx.created[c]) isRoot = true;
            if (!isRoot) deps.push(ctx.created[c]);
        }
        if (deps.length) {
            var folder = app.project.items.addFolder(pk.src + " - pasted");
            for (var d = 0; d < deps.length; d++) { try { deps[d].parentFolder = folder; } catch (e) {} }
        }
        return roots.length + " composition(s)" + (nested ? " placed in " + host.name : "");
    }

    X.doPaste = function (opt) {
        // X.testClipboard : les tests collent leur propre fichier, jamais le presse-papiers partage.
        var pk = fromJSON(readText(X.testClipboard || (X.ROOT + "\\clipboard.json")));
        if (pk.fmt !== "AECopy") throw new Error("unknown clipboard");
        X.pasteSameVersion = String(pk.ae).split(".")[0] === app.version.split(".")[0];
        var ctx = { pk: pk, made: {}, created: [] };
        var what;
        app.beginUndoGroup("AECopy paste");
        try {
            if (pk.kind === "comps") what = pasteComps(pk, ctx, opt && opt.nest);
            else if (pk.kind === "layers") what = pasteLayers(pk, ctx);
            else what = pasteProps(pk);
        } finally {
            app.endUndoGroup();
        }
        return "ok " + what + " (from " + pk.src + ", AE " + pk.ae + ")";
    };

    // ------------------------------------------------------------------ boite aux lettres

    X.handle = function (line) {
        var parts = line.replace(/^\s+|\s+$/g, "").split(" ");
        var verb = parts[0], id = parts[1];
        var res;
        X.warnings = [];
        try {
            X.readRuns = verb === "copystyles";
            if (verb === "copy" || verb === "copystyles") {
                // Ctrl+C : on ecrit tout de suite, la tache de cet After Effects peut mourir avant le Ctrl+V.
                res = X.doMark();
                if (res.indexOf("ok") === 0) res = X.doExport() + " | " + res;
            }
            else if (verb === "mark") res = X.doMark();
            else if (verb === "export") res = X.doExport();
            else if (verb === "paste") res = X.doPaste();
            else if (verb === "dragpaste") res = X.doPaste({ nest: true });
            else if (verb === "ping") res = "ok " + app.version;
            else if (verb === "stop") {
                // AECopy quitte : plus de boucle ni de fiche ; il revient au prochain demarrage ou a l'injection.
                try { app.cancelTask(X.taskId); } catch (eStop) {}
                X.taskId = 0;
                X.running = false;
                try { (new File(X.ROOT + "\\inst_" + X.pid + ".txt")).remove(); } catch (eInst) {}
                log("stopped by AECopy");
                res = "ok stopped";
            }
            else if (verb === "reload") {
                // Recharge ce fichier juste apres la reponse (mise a jour sans redemarrer After Effects).
                app.scheduleTask("$.global.AECOPY_HOME = \"" + X.HOME.replace(/\\/g, "/") + "\"; $.evalFile(new File(\"" +
                    (X.HOME + "\\AECopy.jsx").replace(/\\/g, "/") + "\"));", 100, false);
                res = "ok reloading";
            }
            else res = "err unknown command: " + verb;
        } catch (e) {
            res = "err " + errText(e);
        }
        if (X.warnings.length) {
            res += "\n" + X.warnings.join("\n");
            log(verb + " : " + X.warnings.join(" | "));
        }
        if (res.indexOf("err") === 0) log(verb + " : " + res);
        try { writeText(X.ROOT + "\\done_" + id + ".txt", res); } catch (e2) { log("reply: " + errText(e2)); }
    };

    X.ticks = 0;
    X.poll = function () {
        try {
            if (X.ticks++ % 6 === 0) { try { trackSelection(); } catch (eT) {} } // toutes les 600 ms
            var f = new File(X.ROOT + "\\cmd_" + X.pid + ".txt");
            if (!f.exists) return;
            var s = readText(f.fsName);
            f.remove();
            if (s) X.handle(s);
        } catch (e) {
            log("poll : " + errText(e));
        }
    };

    function heartbeat() {
        writeText(X.ROOT + "\\inst_" + X.pid + ".txt", app.version + "\n" + X.VERSION);
    }

    // Le PID d'After Effects n'est pas lisible en ExtendScript : AECopy.exe --whoami
    // remonte ses processus parents jusqu'a AfterFX.exe et l'ecrit dans un fichier.
    // Au passage il demarre le relais clavier, detache : callSystem attend que tout heritier
    // de sa sortie se ferme, un relais lance directement d'ici gelait After Effects.
    X.findPid = function () {
        var out = X.ROOT + "\\whoami_" + (new Date().getTime()) + "_" + Math.floor(Math.random() * 1e6) + ".txt";
        system.callSystem("\"" + X.EXE + "\" --whoami \"" + out + "\"");
        var f = new File(out);
        for (var i = 0; i < 40 && !f.exists; i++) $.sleep(50);
        if (!f.exists) return 0;
        var s = readText(out);
        f.remove();
        return parseInt(s, 10) || 0;
    };

    X.arm = function () {
        if (X.taskId) { try { app.cancelTask(X.taskId); } catch (e) {} }
        X.taskId = app.scheduleTask("$.global.AECOPY.poll()", 100, true);
    };

    X.start = function () {
        ensureFolder(X.ROOT);
        if (!(new File(X.EXE)).exists) { log("not found: " + X.EXE); return false; }
        X.pid = X.findPid();
        if (!X.pid) { log("After Effects process id not found"); return false; }
        heartbeat();
        X.arm();
        // AE 2020 : une tache repetee posee pendant le demarrage (dossier Startup) ne tourne jamais ;
        // on la repose une fois l'application prete.
        app.scheduleTask("$.global.AECOPY.arm()", 3000, false);
        X.running = true;
        log("AECopy " + X.VERSION + " active in After Effects " + app.version);
        return true;
    };

    // Pour les tests (tests\fulltest.jsx).
    X.serLayer = serLayer;
    X.toJSON = toJSON;

    try { X.start(); } catch (e) { log("start: " + errText(e)); }
})();
