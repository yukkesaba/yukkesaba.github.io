/*
 * GraphMaker.jsx  -  Illustrator 用 再編集可能グラフ作成スクリプト
 *
 * 使い方:
 *   ・何も選択せずに実行 → 新規グラフを作成（画面中央に配置）
 *   ・GraphMaker で作ったグラフ（またはその中の任意のオブジェクト）を選択して実行
 *     → 設定を読み込んで再編集。OK で同じ位置に描き直す
 *
 * 設定はグラフのグループの「メモ(note)」に保存されるため、.ai ファイルを
 * 保存・再オープンしても再編集できます。
 */
#target illustrator

(function () {

    var TAG = "GRAPHMAKER_V1:";
    var PREFS_FILE = new File(Folder.userData + "/GraphMaker_prefs.txt");
    var PALETTE = ["#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F",
                   "#EDC948", "#B07AA1", "#FF9DA7", "#9C755F", "#BAB0AC"];

    // ------------------------------------------------------------------
    // 汎用ユーティリティ (ExtendScript は ES3 なので自前で用意)
    // ------------------------------------------------------------------
    function trim(s) { return String(s).replace(/^\s+|\s+$/g, ""); }

    function clone(o) { return eval(o.toSource()); }

    function merge(def, src) {
        // def をベースに src の値で上書き（src に無いキーは def の値を残す）
        if (src === undefined || src === null) return def;
        if (def instanceof Array || typeof def !== "object" || def === null) return src;
        for (var k in def) {
            if (def.hasOwnProperty(k) && src.hasOwnProperty(k)) def[k] = merge(def[k], src[k]);
        }
        return def;
    }

    function getPath(o, path) {
        var p = path.split(".");
        for (var i = 0; i < p.length; i++) o = o[p[i]];
        return o;
    }

    function setPath(o, path, v) {
        var p = path.split(".");
        for (var i = 0; i < p.length - 1; i++) o = o[p[i]];
        o[p[p.length - 1]] = v;
    }

    function num(v, fallback) {
        var n = parseFloat(v);
        return isNaN(n) ? fallback : n;
    }

    // ------------------------------------------------------------------
    // 既定の設定
    // ------------------------------------------------------------------
    function defaultSeriesStyle(i) {
        return {
            color: PALETTE[i % PALETTE.length], // 棒の塗り / 線の色 / 面の塗り
            lineWidth: 2,                       // 折れ線・面の線幅
            borderColor: "none",                // 棒・マーカーの枠線色
            borderWidth: 0.5,
            marker: "circle",                   // none / circle / square / diamond
            markerSize: 5,
            dash: "",                           // 例 "4,2"
            opacity: 100
        };
    }

    function textStyle(size) { return { font: "", size: size, color: "#333333" }; }

    function defaults() {
        return {
            type: "bar", // bar / stacked / line / area
            data: "項目,2023年,2024年\nA,120,150\nB,80,95\nC,140,130\nD,60,110",
            width: 300,
            height: 200,
            barRatio: 70,      // カテゴリ幅に対する棒グループの幅(%)
            barGap: 2,         // 同一カテゴリ内の棒同士の間隔(pt)
            plotBg: "none",
            series: [],
            valueLabels: { show: false, decimals: 0, style: textStyle(7) },
            axis: {
                color: "#333333", width: 0.75, tickLen: 4, xTicks: true,
                yMin: "", yMax: "", yStep: "",
                decimals: 0, thousands: true, prefix: "", suffix: "",
                showYAxisLine: true,
                xRotate: 0,
                xStyle: textStyle(8), yStyle: textStyle(8),
                xTitle: "", yTitle: "", titleStyle: textStyle(9)
            },
            grid: { show: true, color: "#CCCCCC", width: 0.5, dash: "2,2" },
            title: { text: "", style: { font: "", size: 14, color: "#000000" } },
            legend: { show: true, position: "right", style: textStyle(8) }
        };
    }

    // ------------------------------------------------------------------
    // データ解析
    //   1 行目: 見出し（1 列目は無視、2 列目以降が系列名）
    //   2 行目以降: ラベル, 値, 値, ...   区切りはカンマ or タブ
    // ------------------------------------------------------------------
    function parseData(text) {
        var lines = String(text).replace(/\r\n?/g, "\n").split("\n");
        var rows = [];
        var sep = String(text).indexOf("\t") >= 0 ? "\t" : ",";
        for (var i = 0; i < lines.length; i++) {
            if (trim(lines[i]) === "") continue;
            var cells = lines[i].split(sep);
            for (var j = 0; j < cells.length; j++) cells[j] = trim(cells[j]);
            rows.push(cells);
        }
        if (rows.length < 2) throw new Error("データは見出し行 + 1 行以上必要です。");
        var head = rows[0];
        var names = [];
        for (var c = 1; c < head.length; c++) names.push(head[c] || ("系列" + c));
        if (names.length === 0) throw new Error("値の列がありません。");
        var labels = [], values = [];
        for (c = 0; c < names.length; c++) values.push([]);
        for (var r = 1; r < rows.length; r++) {
            labels.push(rows[r][0]);
            for (c = 0; c < names.length; c++) {
                var raw = rows[r][c + 1];
                var v = (raw === undefined || raw === "") ? null : parseFloat(raw.replace(/,/g, ""));
                values[c].push(isNaN(v) ? null : v);
            }
        }
        return { names: names, labels: labels, values: values };
    }

    function ensureSeries(s, count) {
        for (var i = s.series.length; i < count; i++) s.series.push(defaultSeriesStyle(i));
    }

    // ------------------------------------------------------------------
    // 色・スタイル
    // ------------------------------------------------------------------
    function makeColor(hex) {
        hex = trim(hex || "").replace(/^#/, "");
        if (hex === "" || hex.toLowerCase() === "none") return null;
        if (hex.length === 3) hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
        var c = new RGBColor();
        c.red = parseInt(hex.substr(0, 2), 16) || 0;
        c.green = parseInt(hex.substr(2, 2), 16) || 0;
        c.blue = parseInt(hex.substr(4, 2), 16) || 0;
        return c;
    }

    function colorToHex(c) {
        function h(v) { var s = Math.round(Math.max(0, Math.min(255, v))).toString(16); return s.length < 2 ? "0" + s : s; }
        var r, g, b;
        if (c.typename === "RGBColor") { r = c.red; g = c.green; b = c.blue; }
        else if (c.typename === "CMYKColor") {
            r = 255 * (1 - c.cyan / 100) * (1 - c.black / 100);
            g = 255 * (1 - c.magenta / 100) * (1 - c.black / 100);
            b = 255 * (1 - c.yellow / 100) * (1 - c.black / 100);
        } else if (c.typename === "GrayColor") { r = g = b = 255 * (1 - c.gray / 100); }
        else return null;
        return ("#" + h(r) + h(g) + h(b)).toUpperCase();
    }

    function setFill(item, hex) {
        var c = makeColor(hex);
        if (c) { item.filled = true; item.fillColor = c; } else item.filled = false;
    }

    function setStroke(item, hex, width, dash) {
        var c = makeColor(hex);
        if (c && width > 0) {
            item.stroked = true; item.strokeColor = c; item.strokeWidth = width;
            item.strokeDashes = parseDash(dash);
        } else item.stroked = false;
    }

    function parseDash(d) {
        var out = [];
        if (!d) return out;
        var p = String(d).split(/[,\s]+/);
        for (var i = 0; i < p.length; i++) { var n = parseFloat(p[i]); if (!isNaN(n)) out.push(n); }
        return out;
    }

    // ------------------------------------------------------------------
    // 図形・テキスト描画ヘルパー（座標は Illustrator 座標系: y は上向き）
    // ------------------------------------------------------------------
    function line(parent, x1, y1, x2, y2, hex, width, dash) {
        var p = parent.pathItems.add();
        p.setEntirePath([[x1, y1], [x2, y2]]);
        p.filled = false;
        setStroke(p, hex, width, dash);
        return p;
    }

    function marker(parent, type, x, y, size, fill, border, borderW) {
        if (type === "none" || size <= 0) return null;
        var r = size / 2, m;
        if (type === "square") m = parent.pathItems.rectangle(y + r, x - r, size, size);
        else if (type === "diamond") {
            m = parent.pathItems.add();
            m.setEntirePath([[x, y + r], [x + r, y], [x, y - r], [x - r, y]]);
            m.closed = true;
        } else m = parent.pathItems.ellipse(y + r, x - r, size, size);
        setFill(m, fill);
        setStroke(m, border, borderW, "");
        return m;
    }

    // align: left/center/right  valign: top/middle/bottom  → (x, y) を基準点にする
    function text(parent, str, x, y, st, align, valign, rot) {
        var tf = parent.textFrames.add();
        tf.contents = String(str);
        var ca = tf.textRange.characterAttributes;
        if (st.font) { try { ca.textFont = app.textFonts.getByName(st.font); } catch (e) { } }
        ca.size = st.size;
        var c = makeColor(st.color);
        if (c) ca.fillColor = c;
        if (rot) tf.rotate(rot);
        var b = tf.visibleBounds; // [left, top, right, bottom]
        var w = b[2] - b[0], h = b[1] - b[3];
        var nx = align === "center" ? x - w / 2 : (align === "right" ? x - w : x);
        var ny = valign === "middle" ? y + h / 2 : (valign === "bottom" ? y + h : y);
        tf.translate(nx - b[0], ny - b[1]);
        return tf;
    }

    function bounds(item) {
        try { if (item.pageItems.length === 0) return null; } catch (e) { }
        return item.visibleBounds;
    }

    function formatNumber(v, dec, thousands, prefix, suffix) {
        var s = Math.abs(v).toFixed(dec);
        if (thousands) {
            var parts = s.split(".");
            parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
            s = parts.join(".");
        }
        return (v < 0 && parseFloat(s.replace(/,/g, "")) !== 0 ? "-" : "") + (prefix || "") + s + (suffix || "");
    }

    // ------------------------------------------------------------------
    // 目盛り計算
    // ------------------------------------------------------------------
    function niceStep(range, count) {
        var raw = range / count;
        var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
        var n = raw / mag;
        var s = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
        return s * mag;
    }

    function computeScale(s, d) {
        var lo = Infinity, hi = -Infinity, i, j;
        if (s.type === "stacked") {
            for (i = 0; i < d.labels.length; i++) {
                var pos = 0, neg = 0;
                for (j = 0; j < d.values.length; j++) {
                    var v = d.values[j][i];
                    if (v === null) continue;
                    if (v >= 0) pos += v; else neg += v;
                }
                if (pos > hi) hi = pos;
                if (neg < lo) lo = neg;
            }
        } else {
            for (j = 0; j < d.values.length; j++)
                for (i = 0; i < d.values[j].length; i++) {
                    var w = d.values[j][i];
                    if (w === null) continue;
                    if (w < lo) lo = w;
                    if (w > hi) hi = w;
                }
        }
        if (lo === Infinity) { lo = 0; hi = 1; }
        if (s.type !== "line" || lo > 0) lo = Math.min(0, lo);
        if (hi === lo) hi = lo + 1;

        var ax = s.axis;
        var min = trim(ax.yMin) === "" ? null : num(ax.yMin, null);
        var max = trim(ax.yMax) === "" ? null : num(ax.yMax, null);
        var step = trim(ax.yStep) === "" ? null : num(ax.yStep, null);
        var rMin = min !== null ? min : lo, rMax = max !== null ? max : hi;
        if (rMax <= rMin) rMax = rMin + 1;
        if (!step || step <= 0) step = niceStep(rMax - rMin, 5);
        if (min === null) rMin = Math.floor(rMin / step + 1e-9) * step;
        if (max === null) rMax = Math.ceil(rMax / step - 1e-9) * step;
        if (rMax <= rMin) rMax = rMin + step;
        return { min: rMin, max: rMax, step: step };
    }

    // ------------------------------------------------------------------
    // グラフ描画本体
    //   ox, oy : プロット領域の左上座標
    // ------------------------------------------------------------------
    function drawGraph(s, ox, oy, container) {
        var d = parseData(s.data);
        ensureSeries(s, d.names.length);
        var W = s.width, H = s.height;
        var n = d.labels.length, ns = d.names.length;
        var sc = computeScale(s, d);
        var ax = s.axis;

        var g = container.groupItems.add();
        g.name = "GraphMaker";

        function py(v) {
            v = Math.max(sc.min, Math.min(sc.max, v));
            return oy - H + (v - sc.min) / (sc.max - sc.min) * H;
        }
        var band = W / n;
        function cx(i) { return ox + band * (i + 0.5); }
        var baseY = py(Math.max(sc.min, Math.min(sc.max, 0)));

        // プロット領域（再編集時の位置の基準にもなる）
        var plot = g.pathItems.rectangle(oy, ox, W, H);
        plot.name = "gm-plot";
        setFill(plot, s.plotBg);
        plot.stroked = false;

        // グリッド
        var steps = Math.round((sc.max - sc.min) / sc.step);
        if (s.grid.show) {
            var gg = g.groupItems.add(); gg.name = "grid";
            for (var t = 0; t <= steps; t++) {
                var gy = py(sc.min + t * sc.step);
                line(gg, ox, gy, ox + W, gy, s.grid.color, s.grid.width, s.grid.dash);
            }
        }

        // 系列
        var vlabels = [];
        var stackPos = [], stackNeg = [];
        for (var i = 0; i < n; i++) { stackPos.push(0); stackNeg.push(0); }
        var groupW = band * s.barRatio / 100;
        var barW = (groupW - s.barGap * (ns - 1)) / ns;
        if (barW < 0.1) barW = 0.1;

        for (var k = 0; k < ns; k++) {
            var st = s.series[k];
            var sg = g.groupItems.add();
            sg.name = d.names[k];
            var vals = d.values[k];

            if (s.type === "bar" || s.type === "stacked") {
                for (i = 0; i < n; i++) {
                    var v = vals[i];
                    if (v === null) continue;
                    var x0, w, yTop, yBot;
                    if (s.type === "bar") {
                        x0 = cx(i) - groupW / 2 + k * (barW + s.barGap);
                        w = barW;
                        yTop = Math.max(py(v), baseY); yBot = Math.min(py(v), baseY);
                        vlabels.push({ v: v, x: x0 + w / 2, y: v >= 0 ? yTop : yBot, below: v < 0 });
                    } else {
                        x0 = cx(i) - groupW / 2; w = groupW;
                        var from = v >= 0 ? stackPos[i] : stackNeg[i];
                        var to = from + v;
                        if (v >= 0) stackPos[i] = to; else stackNeg[i] = to;
                        yTop = Math.max(py(from), py(to)); yBot = Math.min(py(from), py(to));
                        vlabels.push({ v: v, x: x0 + w / 2, y: (yTop + yBot) / 2, mid: true });
                    }
                    var r = sg.pathItems.rectangle(yTop, x0, w, Math.max(yTop - yBot, 0.01));
                    setFill(r, st.color);
                    setStroke(r, st.borderColor, st.borderWidth, "");
                }
            } else {
                // 折れ線 / 面：null で線を区切る
                var segs = [], cur = [];
                for (i = 0; i < n; i++) {
                    if (vals[i] === null) { if (cur.length) segs.push(cur); cur = []; continue; }
                    cur.push([cx(i), py(vals[i])]);
                    vlabels.push({ v: vals[i], x: cx(i), y: py(vals[i]) + st.markerSize / 2 });
                }
                if (cur.length) segs.push(cur);
                for (var q = 0; q < segs.length; q++) {
                    var pts = segs[q];
                    if (s.type === "area" && pts.length > 1) {
                        var ap = sg.pathItems.add();
                        var poly = pts.slice(0);
                        poly.push([pts[pts.length - 1][0], baseY]);
                        poly.push([pts[0][0], baseY]);
                        ap.setEntirePath(poly);
                        ap.closed = true;
                        setFill(ap, st.color);
                        ap.stroked = false;
                        ap.opacity = st.opacity;
                    }
                    if (pts.length > 1) {
                        var lp = sg.pathItems.add();
                        lp.setEntirePath(pts);
                        lp.filled = false;
                        setStroke(lp, st.color, st.lineWidth, st.dash);
                        lp.strokeJoin = StrokeJoin.ROUNDENDJOIN;
                        lp.strokeCap = StrokeCap.ROUNDENDCAP;
                    }
                    for (var m = 0; m < pts.length; m++)
                        marker(sg, st.marker, pts[m][0], pts[m][1], st.markerSize, st.color, st.borderColor, st.borderWidth);
                }
            }
            if (s.type !== "area") sg.opacity = st.opacity;
        }

        // 軸
        var ag = g.groupItems.add(); ag.name = "axes";
        line(ag, ox, oy - H, ox + W, oy - H, ax.color, ax.width, "");
        if (baseY > oy - H + 0.01) line(ag, ox, baseY, ox + W, baseY, ax.color, ax.width, "");
        if (ax.showYAxisLine) line(ag, ox, oy, ox, oy - H, ax.color, ax.width, "");

        // Y 目盛りとラベル
        var yl = g.groupItems.add(); yl.name = "y-labels";
        for (t = 0; t <= steps; t++) {
            var val = sc.min + t * sc.step;
            var ty = py(val);
            if (ax.tickLen > 0) line(ag, ox - ax.tickLen, ty, ox, ty, ax.color, ax.width, "");
            text(yl, formatNumber(val, ax.decimals, ax.thousands, ax.prefix, ax.suffix),
                 ox - ax.tickLen - 3, ty, ax.yStyle, "right", "middle", 0);
        }

        // X 目盛りとラベル
        var xl = g.groupItems.add(); xl.name = "x-labels";
        for (i = 0; i < n; i++) {
            if (ax.xTicks && ax.tickLen > 0) line(ag, cx(i), oy - H, cx(i), oy - H - ax.tickLen, ax.color, ax.width, "");
            var ly = oy - H - Math.max(ax.tickLen, 0) - 3;
            if (ax.xRotate) text(xl, d.labels[i], cx(i), ly, ax.xStyle, "right", "top", ax.xRotate);
            else text(xl, d.labels[i], cx(i), ly, ax.xStyle, "center", "top", 0);
        }

        // 値ラベル
        if (s.valueLabels.show) {
            var vg = g.groupItems.add(); vg.name = "value-labels";
            for (i = 0; i < vlabels.length; i++) {
                var L = vlabels[i];
                var str = formatNumber(L.v, s.valueLabels.decimals, ax.thousands, ax.prefix, ax.suffix);
                if (L.mid) text(vg, str, L.x, L.y, s.valueLabels.style, "center", "middle", 0);
                else if (L.below) text(vg, str, L.x, L.y - 2, s.valueLabels.style, "center", "top", 0);
                else text(vg, str, L.x, L.y + 2, s.valueLabels.style, "center", "bottom", 0);
            }
        }

        // 軸タイトル
        if (trim(ax.xTitle) !== "") {
            var xb = bounds(xl);
            var xty = xb ? xb[3] - 4 : oy - H - 12;
            text(g, ax.xTitle, ox + W / 2, xty, ax.titleStyle, "center", "top", 0).name = "x-title";
        }
        if (trim(ax.yTitle) !== "") {
            var yb = bounds(yl);
            var ytx = yb ? yb[0] - 4 : ox - 30;
            text(g, ax.yTitle, ytx, oy - H / 2, ax.titleStyle, "right", "middle", 90).name = "y-title";
        }

        // 凡例
        if (s.legend.show) drawLegend(s, d, g, ox, oy, W, H);

        // タイトル
        if (trim(s.title.text) !== "") {
            var gb = g.visibleBounds;
            text(g, s.title.text, ox + W / 2, gb[1] + 8, s.title.style, "center", "bottom", 0).name = "title";
        }

        g.note = TAG + s.toSource();
        return g;
    }

    function drawLegend(s, d, g, ox, oy, W, H) {
        var gb = g.visibleBounds; // 凡例を置く前のグラフ全体の範囲
        var lg = g.groupItems.add(); lg.name = "legend";
        var ls = s.legend.style;
        var sw = Math.max(ls.size, 6);
        var isLine = (s.type === "line");
        var entryW = isLine ? sw * 2 : sw;
        var vertical = s.legend.position === "right";
        var x = 0, y = 0;
        for (var k = 0; k < d.names.length; k++) {
            var st = s.series[k];
            var e = lg.groupItems.add(); e.name = d.names[k];
            if (isLine) {
                line(e, x, y - sw / 2, x + entryW, y - sw / 2, st.color, st.lineWidth, st.dash);
                marker(e, st.marker, x + entryW / 2, y - sw / 2, st.markerSize, st.color, st.borderColor, st.borderWidth);
            } else {
                var r = e.pathItems.rectangle(y, x, sw, sw);
                setFill(r, st.color);
                setStroke(r, st.borderColor, st.borderWidth, "");
                r.opacity = st.opacity;
            }
            var tf = text(e, d.names[k], x + entryW + 4, y - sw / 2, ls, "left", "middle", 0);
            if (vertical) y -= sw + ls.size * 0.6;
            else x = tf.visibleBounds[2] + ls.size * 1.2;
        }
        var lb = lg.visibleBounds;
        if (vertical) lg.translate(ox + W + 12 - lb[0], oy - lb[1]);
        else if (s.legend.position === "top") lg.translate(ox + W / 2 - (lb[0] + lb[2]) / 2, gb[1] + 8 - lb[3]);
        else lg.translate(ox + W / 2 - (lb[0] + lb[2]) / 2, gb[3] - 10 - lb[1]);
    }

    // ------------------------------------------------------------------
    // 選択中の GraphMaker グラフを探す
    // ------------------------------------------------------------------
    function findGraph(item) {
        while (item && item.typename !== "Layer" && item.typename !== "Document") {
            if (item.typename === "GroupItem" && String(item.note).indexOf(TAG) === 0) return item;
            item = item.parent;
        }
        return null;
    }

    function loadSettingsFrom(g) {
        return merge(defaults(), eval(String(g.note).substr(TAG.length)));
    }

    function loadPrefs() {
        var s = defaults();
        try {
            if (PREFS_FILE.exists) {
                PREFS_FILE.encoding = "UTF-8";
                PREFS_FILE.open("r");
                var src = PREFS_FILE.read();
                PREFS_FILE.close();
                s = merge(s, eval(src));
            }
        } catch (e) { }
        return s;
    }

    function savePrefs(s) {
        try {
            PREFS_FILE.encoding = "UTF-8";
            PREFS_FILE.open("w");
            PREFS_FILE.write(s.toSource());
            PREFS_FILE.close();
        } catch (e) { }
    }

    // ------------------------------------------------------------------
    // フォント選択ダイアログ
    // ------------------------------------------------------------------
    var fontCache = null;
    function pickFont(current) {
        if (!fontCache) {
            fontCache = [];
            for (var i = 0; i < app.textFonts.length; i++) {
                var f = app.textFonts[i];
                fontCache.push({ name: f.name, label: f.family + " " + f.style + "  (" + f.name + ")" });
            }
        }
        var w = new Window("dialog", "フォントを選択");
        w.alignChildren = "fill";
        var q = w.add("edittext", undefined, "");
        q.characters = 40;
        q.helpTip = "フォント名で絞り込み";
        var lb = w.add("listbox", [0, 0, 420, 320]);
        function fill() {
            lb.removeAll();
            var key = q.text.toLowerCase(), c = 0;
            for (var i = 0; i < fontCache.length && c < 400; i++) {
                if (key && fontCache[i].label.toLowerCase().indexOf(key) < 0) continue;
                var it = lb.add("item", fontCache[i].label);
                it.fontName = fontCache[i].name;
                if (fontCache[i].name === current) lb.selection = it;
                c++;
            }
        }
        q.onChanging = fill;
        fill();
        var bg = w.add("group"); bg.alignment = "right";
        bg.add("button", undefined, "既定に戻す", { name: "reset" }).onClick = function () { w.close(2); };
        bg.add("button", undefined, "キャンセル", { name: "cancel" });
        bg.add("button", undefined, "OK", { name: "ok" });
        lb.onDoubleClick = function () { w.close(1); };
        var res = w.show();
        if (res === 2) return "";
        if (res === 1 && lb.selection) return lb.selection.fontName;
        return current;
    }

    // ------------------------------------------------------------------
    // ダイアログ
    // ------------------------------------------------------------------
    function showDialog(s, isEdit, onPreview, onClearPreview) {
        var reg = [];   // UI コントロールと設定パスの対応表
        var dlg = new Window("dialog", isEdit ? "GraphMaker - グラフを再編集" : "GraphMaker - グラフを作成");
        dlg.orientation = "column";
        dlg.alignChildren = "fill";

        function row(parent, label, labelW) {
            var g = parent.add("group");
            g.orientation = "row";
            g.alignChildren = "center";
            var st = g.add("statictext", undefined, label);
            st.preferredSize.width = labelW || 110;
            return g;
        }
        function numField(parent, label, path, chars, unit) {
            var g = row(parent, label);
            var e = g.add("edittext", undefined, "");
            e.characters = chars || 6;
            if (unit) g.add("statictext", undefined, unit);
            reg.push({ path: path, ctrl: e, kind: "num" });
            return e;
        }
        function textField(parent, label, path, chars) {
            var g = row(parent, label);
            var e = g.add("edittext", undefined, "");
            e.characters = chars || 20;
            reg.push({ path: path, ctrl: e, kind: "text" });
            return e;
        }
        function colorField(parent, label, path) {
            var g = row(parent, label);
            var e = g.add("edittext", undefined, "");
            e.characters = 9;
            e.helpTip = "#RRGGBB 形式、または none";
            var b = g.add("button", undefined, "選択…");
            b.preferredSize.width = 60;
            b.onClick = function () {
                var c = makeColor(e.text) || makeColor("#000000");
                var r = app.showColorPicker(c);
                var hx = r ? colorToHex(r) : null;
                if (hx) e.text = hx;
            };
            reg.push({ path: path, ctrl: e, kind: "text" });
            return e;
        }
        function checkField(parent, label, path) {
            var c = parent.add("checkbox", undefined, label);
            reg.push({ path: path, ctrl: c, kind: "bool" });
            return c;
        }
        function listField(parent, label, path, labels, values) {
            var g = row(parent, label);
            var dd = g.add("dropdownlist", undefined, labels);
            reg.push({ path: path, ctrl: dd, kind: "list", values: values });
            return dd;
        }
        function styleField(parent, label, path) {
            var p = parent.add("panel", undefined, label);
            p.alignChildren = "left";
            p.margins = [10, 14, 10, 8];
            var g = row(p, "フォント", 60);
            var fe = g.add("edittext", undefined, "");
            fe.characters = 22;
            fe.helpTip = "PostScript 名。空欄で Illustrator の既定フォント";
            g.add("button", undefined, "…").onClick = function () { fe.text = pickFont(fe.text); };
            reg.push({ path: path + ".font", ctrl: fe, kind: "text" });
            var g2 = p.add("group");
            var st = g2.add("statictext", undefined, "サイズ"); st.preferredSize.width = 60;
            var se = g2.add("edittext", undefined, ""); se.characters = 5;
            g2.add("statictext", undefined, "pt   色");
            reg.push({ path: path + ".size", ctrl: se, kind: "num" });
            var ce = g2.add("edittext", undefined, ""); ce.characters = 9;
            g2.add("button", undefined, "選択…").onClick = function () {
                var r = app.showColorPicker(makeColor(ce.text) || makeColor("#000000"));
                var hx = r ? colorToHex(r) : null;
                if (hx) ce.text = hx;
            };
            reg.push({ path: path + ".color", ctrl: ce, kind: "text" });
            return p;
        }

        var tabs = dlg.add("tabbedpanel");
        tabs.alignChildren = "fill";
        tabs.preferredSize = [520, 470];

        // --- タブ1: データ ---
        var t1 = tabs.add("tab", undefined, "データ・種類");
        t1.alignChildren = "left";
        listField(t1, "グラフの種類", "type", ["棒グラフ", "積み上げ棒グラフ", "折れ線グラフ", "面グラフ"], ["bar", "stacked", "line", "area"]);
        t1.add("statictext", undefined, "データ（1行目=見出し、1列目=ラベル／カンマ or タブ区切り。Excel から貼り付け可）");
        var dataEt = t1.add("edittext", [0, 0, 490, 170], "", { multiline: true, scrolling: true, wantReturn: true });
        reg.push({ path: "data", ctrl: dataEt, kind: "text" });
        var sz = t1.add("group");
        numField(sz, "プロット幅", "width", 6, "pt");
        numField(sz, "高さ", "height", 6, "pt");
        var bgp = t1.add("group");
        numField(bgp, "棒の太さ", "barRatio", 5, "%（カテゴリ幅比）");
        numField(bgp, "棒の間隔", "barGap", 4, "pt");
        colorField(t1, "プロット背景色", "plotBg");
        var vp = t1.add("panel", undefined, "値ラベル");
        vp.alignChildren = "left";
        var vg = vp.add("group");
        checkField(vg, "値を表示", "valueLabels.show");
        numField(vg, "小数桁数", "valueLabels.decimals", 3);
        styleField(vp, "値ラベルの文字", "valueLabels.style");

        // --- タブ2: 系列 ---
        var t2 = tabs.add("tab", undefined, "系列スタイル");
        t2.alignChildren = "left";
        var selRow = row(t2, "系列");
        var seriesDD = selRow.add("dropdownlist", undefined, []);
        seriesDD.preferredSize.width = 220;
        var sp = t2.add("panel", undefined, "スタイル");
        sp.alignChildren = "left";
        var sColor = row(sp, "色（塗り/線）").add("edittext", undefined, ""); sColor.characters = 9;
        sColor.parent.add("button", undefined, "選択…").onClick = function () { pickInto(sColor); };
        var sLineW = row(sp, "線幅（折れ線）").add("edittext", undefined, ""); sLineW.characters = 5;
        sLineW.parent.add("statictext", undefined, "pt");
        var sDash = row(sp, "破線").add("edittext", undefined, ""); sDash.characters = 10;
        sDash.parent.add("statictext", undefined, "例: 4,2（空欄で実線）");
        var sBorder = row(sp, "枠線の色").add("edittext", undefined, ""); sBorder.characters = 9;
        sBorder.parent.add("button", undefined, "選択…").onClick = function () { pickInto(sBorder); };
        var sBorderW = row(sp, "枠線の幅").add("edittext", undefined, ""); sBorderW.characters = 5;
        sBorderW.parent.add("statictext", undefined, "pt");
        var sMarker = row(sp, "マーカー").add("dropdownlist", undefined, ["なし", "円", "四角", "ひし形"]);
        var MARKERS = ["none", "circle", "square", "diamond"];
        var sMarkerSize = row(sp, "マーカーサイズ").add("edittext", undefined, ""); sMarkerSize.characters = 5;
        sMarkerSize.parent.add("statictext", undefined, "pt");
        var sOpacity = row(sp, "不透明度").add("edittext", undefined, ""); sOpacity.characters = 5;
        sOpacity.parent.add("statictext", undefined, "%");
        t2.add("statictext", undefined, "※ 色は #RRGGBB 形式。枠線を付けない場合は none");
        var applyAll = t2.add("button", undefined, "この系列の線幅・マーカー・枠線を全系列に適用");

        function pickInto(e) {
            var r = app.showColorPicker(makeColor(e.text) || makeColor("#000000"));
            var hx = r ? colorToHex(r) : null;
            if (hx) e.text = hx;
        }

        var curSeries = -1;
        function storeSeries() {
            if (curSeries < 0 || !s.series[curSeries]) return;
            var st = s.series[curSeries];
            st.color = trim(sColor.text);
            st.lineWidth = num(sLineW.text, st.lineWidth);
            st.dash = trim(sDash.text);
            st.borderColor = trim(sBorder.text) || "none";
            st.borderWidth = num(sBorderW.text, st.borderWidth);
            st.marker = sMarker.selection ? MARKERS[sMarker.selection.index] : st.marker;
            st.markerSize = num(sMarkerSize.text, st.markerSize);
            st.opacity = Math.max(0, Math.min(100, num(sOpacity.text, st.opacity)));
        }
        function loadSeries(i) {
            curSeries = i;
            var st = s.series[i];
            if (!st) return;
            sColor.text = st.color; sLineW.text = st.lineWidth; sDash.text = st.dash;
            sBorder.text = st.borderColor; sBorderW.text = st.borderWidth;
            for (var m = 0; m < MARKERS.length; m++) if (MARKERS[m] === st.marker) sMarker.selection = m;
            sMarkerSize.text = st.markerSize; sOpacity.text = st.opacity;
        }
        function refreshSeriesList() {
            storeSeries();
            var names;
            try { names = parseData(dataEt.text).names; } catch (e) { names = []; }
            ensureSeries(s, names.length);
            var keep = Math.max(0, Math.min(curSeries, names.length - 1));
            seriesDD.removeAll();
            for (var i = 0; i < names.length; i++) seriesDD.add("item", (i + 1) + ": " + names[i]);
            curSeries = -1;
            if (names.length) { seriesDD.selection = keep; loadSeries(keep); }
        }
        seriesDD.onChange = function () {
            if (!seriesDD.selection) return;
            storeSeries();
            loadSeries(seriesDD.selection.index);
        };
        applyAll.onClick = function () {
            storeSeries();
            var src = s.series[curSeries];
            if (!src) return;
            for (var i = 0; i < s.series.length; i++) {
                var t = s.series[i];
                t.lineWidth = src.lineWidth; t.dash = src.dash; t.marker = src.marker;
                t.markerSize = src.markerSize; t.borderColor = src.borderColor;
                t.borderWidth = src.borderWidth; t.opacity = src.opacity;
            }
        };

        // --- タブ3: 軸・目盛り ---
        var t3 = tabs.add("tab", undefined, "軸・目盛り");
        t3.alignChildren = "left";
        var a1 = t3.add("group");
        colorField(a1, "軸の色", "axis.color");
        numField(a1, "軸の太さ", "axis.width", 4, "pt");
        var a2 = t3.add("group");
        numField(a2, "目盛りの長さ", "axis.tickLen", 4, "pt");
        checkField(a2, "X 目盛り線", "axis.xTicks");
        checkField(a2, "Y 軸線", "axis.showYAxisLine");
        var a3 = t3.add("group");
        textField(a3, "Y 最小/最大/間隔", "axis.yMin", 5).helpTip = "空欄で自動";
        var yMaxE = a3.add("edittext", undefined, ""); yMaxE.characters = 5; reg.push({ path: "axis.yMax", ctrl: yMaxE, kind: "text" });
        var yStepE = a3.add("edittext", undefined, ""); yStepE.characters = 5; reg.push({ path: "axis.yStep", ctrl: yStepE, kind: "text" });
        a3.add("statictext", undefined, "（空欄=自動）");
        var a4 = t3.add("group");
        numField(a4, "小数桁数", "axis.decimals", 3);
        checkField(a4, "3桁区切り", "axis.thousands");
        var a5 = t3.add("group");
        textField(a5, "接頭辞/接尾辞", "axis.prefix", 5);
        var sufE = a5.add("edittext", undefined, ""); sufE.characters = 5; reg.push({ path: "axis.suffix", ctrl: sufE, kind: "text" });
        a5.add("statictext", undefined, "例: ¥ / %");
        numField(t3, "X ラベル回転", "axis.xRotate", 4, "°（例: 45）");
        var gp = t3.add("panel", undefined, "グリッド線");
        gp.orientation = "row";
        checkField(gp, "表示", "grid.show");
        var gc = gp.add("edittext", undefined, ""); gc.characters = 9; reg.push({ path: "grid.color", ctrl: gc, kind: "text" });
        gp.add("button", undefined, "色…").onClick = function () { pickInto(gc); };
        gp.add("statictext", undefined, "幅");
        var gw = gp.add("edittext", undefined, ""); gw.characters = 4; reg.push({ path: "grid.width", ctrl: gw, kind: "num" });
        gp.add("statictext", undefined, "破線");
        var gd = gp.add("edittext", undefined, ""); gd.characters = 6; reg.push({ path: "grid.dash", ctrl: gd, kind: "text" });
        var stRow = t3.add("group");
        stRow.alignChildren = "top";
        styleField(stRow, "X 目盛りの文字", "axis.xStyle");
        styleField(stRow, "Y 目盛りの文字", "axis.yStyle");
        var atRow = t3.add("group");
        textField(atRow, "X 軸タイトル", "axis.xTitle", 12);
        textField(atRow, "Y 軸タイトル", "axis.yTitle", 12).parent.children[0].preferredSize.width = 70;
        styleField(t3, "軸タイトルの文字", "axis.titleStyle");

        // --- タブ4: タイトル・凡例 ---
        var t4 = tabs.add("tab", undefined, "タイトル・凡例");
        t4.alignChildren = "left";
        textField(t4, "グラフタイトル", "title.text", 30);
        styleField(t4, "タイトルの文字", "title.style");
        var lp = t4.add("panel", undefined, "凡例");
        lp.alignChildren = "left";
        checkField(lp, "凡例を表示", "legend.show");
        listField(lp, "位置", "legend.position", ["右", "上", "下"], ["right", "top", "bottom"]);
        styleField(lp, "凡例の文字", "legend.style");

        // --- ボタン ---
        var btns = dlg.add("group");
        btns.alignment = "right";
        var prevBtn = btns.add("button", undefined, "プレビュー");
        btns.add("button", undefined, "キャンセル", { name: "cancel" });
        btns.add("button", undefined, isEdit ? "更新" : "作成", { name: "ok" });

        // UI ⇔ 設定
        function toUI() {
            for (var i = 0; i < reg.length; i++) {
                var r = reg[i], v = getPath(s, r.path);
                if (r.kind === "bool") r.ctrl.value = !!v;
                else if (r.kind === "list") {
                    for (var j = 0; j < r.values.length; j++) if (r.values[j] === v) r.ctrl.selection = j;
                    if (!r.ctrl.selection) r.ctrl.selection = 0;
                } else r.ctrl.text = String(v);
            }
            refreshSeriesList();
        }
        function fromUI() {
            for (var i = 0; i < reg.length; i++) {
                var r = reg[i];
                if (r.kind === "bool") setPath(s, r.path, r.ctrl.value);
                else if (r.kind === "list") setPath(s, r.path, r.values[r.ctrl.selection ? r.ctrl.selection.index : 0]);
                else if (r.kind === "num") setPath(s, r.path, num(r.ctrl.text, getPath(s, r.path)));
                else setPath(s, r.path, r.ctrl.text);
            }
            storeSeries();
            if (s.width <= 0) s.width = 100;
            if (s.height <= 0) s.height = 100;
            s.barRatio = Math.max(1, Math.min(100, s.barRatio));
        }

        tabs.onChange = function () { if (tabs.selection === t2) refreshSeriesList(); };
        dataEt.onChange = refreshSeriesList;

        function validate() {
            fromUI();
            try { parseData(s.data); } catch (e) { alert(e.message); return false; }
            return true;
        }
        prevBtn.onClick = function () {
            if (!validate()) return;
            try { onPreview(clone(s)); } catch (e) { alert("プレビューに失敗しました:\n" + e.message); }
        };
        dlg.defaultElement = null; // 複数行入力で Enter を使えるように
        btns.children[2].onClick = function () { if (validate()) dlg.close(1); };

        toUI();
        tabs.selection = t1;
        var res = dlg.show();
        onClearPreview();
        return res === 1 ? s : null;
    }

    // ------------------------------------------------------------------
    // メイン
    // ------------------------------------------------------------------
    if (app.documents.length === 0) {
        alert("ドキュメントを開いてから実行してください。");
        return;
    }
    var doc = app.activeDocument;
    var old = null;
    if (doc.selection && doc.selection.length) {
        for (var i = 0; i < doc.selection.length && !old; i++) old = findGraph(doc.selection[i]);
    }

    var settings, ox, oy, container;
    if (old) {
        settings = loadSettingsFrom(old);
        var plot = null;
        try { plot = old.pathItems.getByName("gm-plot"); } catch (e) { }
        var pb = plot ? plot.geometricBounds : old.geometricBounds;
        ox = pb[0]; oy = pb[1];
        container = old.layer;
    } else {
        settings = loadPrefs();
        settings.title.text = "";
        var cp = doc.activeView.centerPoint;
        ox = cp[0] - settings.width / 2;
        oy = cp[1] + settings.height / 2;
        container = doc.activeLayer;
        if (container.locked || !container.visible) {
            alert("アクティブなレイヤーがロックまたは非表示です。");
            return;
        }
    }

    var preview = null;
    function clearPreview() {
        if (preview) { try { preview.remove(); } catch (e) { } preview = null; }
        if (old) old.hidden = false;
        app.redraw();
    }
    function doPreview(s) {
        if (preview) { try { preview.remove(); } catch (e) { } preview = null; }
        var pox = ox, poy = oy;
        if (!old) { pox = doc.activeView.centerPoint[0] - s.width / 2; poy = doc.activeView.centerPoint[1] + s.height / 2; }
        preview = drawGraph(s, pox, poy, container);
        if (old) { preview.move(old, ElementPlacement.PLACEBEFORE); old.hidden = true; }
        app.redraw();
    }

    var result = showDialog(settings, !!old, doPreview, clearPreview);
    if (!result) return;

    try {
        if (!old) {
            ox = doc.activeView.centerPoint[0] - result.width / 2;
            oy = doc.activeView.centerPoint[1] + result.height / 2;
        }
        var g = drawGraph(result, ox, oy, container);
        if (old) {
            g.move(old, ElementPlacement.PLACEBEFORE);
            old.remove();
        }
        doc.selection = null;
        g.selected = true;
        var p = clone(result);
        p.data = result.data; // 次回の新規作成用に保存
        savePrefs(p);
    } catch (e) {
        alert("グラフの作成に失敗しました:\n" + e.message + (e.line ? "\n(line " + e.line + ")" : ""));
    }

})();
