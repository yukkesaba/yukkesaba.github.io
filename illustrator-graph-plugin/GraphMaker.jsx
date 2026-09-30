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
    var MM = 72 / 25.4; // 1mm = 2.8346pt（内部は pt で保持）
    // 初期配色（CMYK）
    var PALETTE = ["cmyk(75,45,10,0)", "cmyk(0,55,85,0)", "cmyk(5,80,60,0)", "cmyk(55,10,35,0)", "cmyk(70,15,85,0)",
                   "cmyk(5,20,80,0)", "cmyk(35,60,15,0)", "cmyk(0,50,20,0)", "cmyk(40,55,65,5)", "cmyk(25,25,25,0)"];

    // ------------------------------------------------------------------
    // 汎用ユーティリティ (ExtendScript は ES3 なので自前で用意)
    // ------------------------------------------------------------------
    function trim(s) { return String(s).replace(/^\s+|\s+$/g, ""); }

    // toSource() は改行(\r)をエスケープしないことがあり eval で
    // 「ストリング定数が終了していません」になるため、自前で直列化する
    function serialize(o) {
        if (o === null || o === undefined) return "null";
        if (typeof o === "number" || typeof o === "boolean") return String(o);
        if (typeof o === "string") {
            var out = "\"";
            for (var i = 0; i < o.length; i++) {
                var c = o.charCodeAt(i);
                if (c < 32 || c > 126 || c === 34 || c === 92) {
                    var h = c.toString(16);
                    while (h.length < 4) h = "0" + h;
                    out += "\\u" + h;
                } else out += o.charAt(i);
            }
            return out + "\"";
        }
        var parts = [];
        if (o instanceof Array) {
            for (var j = 0; j < o.length; j++) parts.push(serialize(o[j]));
            return "[" + parts.join(",") + "]";
        }
        for (var k in o) if (o.hasOwnProperty(k)) parts.push(serialize(k) + ":" + serialize(o[k]));
        return "{" + parts.join(",") + "}";
    }

    function deserialize(str) { return eval("(" + str + ")"); }

    function clone(o) { return deserialize(serialize(o)); }

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

    function textStyle(size) { return { font: "", size: size, color: "cmyk(0,0,0,80)" }; }

    function defaults() {
        return {
            type: "bar", // bar / stacked / hbar / hstacked / line / area
            data: "項目,2023年,2024年\nA,120,150\nB,80,95\nC,140,130\nD,60,110",
            width: 100 * MM,   // 内部は pt。画面では mm で表示
            height: 70 * MM,
            barRatio: 70,      // カテゴリ幅に対する棒グループの幅(%)
            barGap: 2,         // 同一カテゴリ内の棒同士の間隔(pt)
            plotBg: "none",
            plotFrame: { show: false, color: "cmyk(0,0,0,80)", width: 0.75, dash: "" },
            pie: {
                hole: 0,              // ドーナツの穴の大きさ(%)。0 で通常の円グラフ
                startAngle: 0,        // 開始角度（12 時の位置が 0°）
                clockwise: true,
                borderColor: "cmyk(0,0,0,0)", borderWidth: 1,
                labelPos: "outside",  // inside / outside / none
                showName: true, showPercent: true, showValue: false,
                pctDecimals: 0,
                leader: true, leaderColor: "cmyk(0,0,0,60)", leaderWidth: 0.5,
                labelStyle: textStyle(8)
            },
            outerFrame: { show: false, color: "cmyk(0,0,0,80)", width: 0.75, dash: "", fill: "none", padding: 10, radius: 0 },
            series: [],
            valueLabels: { show: false, decimals: 0, style: textStyle(7) },
            axis: {
                color: "cmyk(0,0,0,80)", width: 0.75, tickLen: 4,
                xAxisLine: true, yAxisLine: true, xTicks: true, yTicks: true,
                yMin: "", yMax: "", yStep: "",
                decimals: 0, thousands: true, prefix: "", suffix: "",
                xRotate: 0,
                catAlign: "center",
                lineOrder: "asc",    // 折れ線・面の重ね順 asc（系列1が下） / desc（系列1が上）
                lineFromAxis: false, // 折れ線・面を Y 軸（左端）から右端まで描く  // 横棒の項目ラベルの揃え left / center / right
                xStyle: textStyle(8), yStyle: textStyle(8),
                xTitle: "", yTitle: "", titleStyle: textStyle(9)
            },
            grid: {
                xShow: false, xColor: "cmyk(0,0,0,20)", xWidth: 0.5, xDash: "2,2",
                yShow: true, yColor: "cmyk(0,0,0,20)", yWidth: 0.5, yDash: "2,2"
            },
            title: { text: "", style: { font: "", size: 14, color: "cmyk(0,0,0,100)" } },
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
    // 色の文字列表現: "#RRGGBB"（RGB） / "C,M,Y,K" または "cmyk(C,M,Y,K)"（CMYK, 0〜100） / "none"
    function makeColor(str) {
        str = trim(str || "");
        if (str === "" || str.toLowerCase() === "none") return null;
        var m = str.match(/^(?:cmyk\s*\()?\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)?$/i);
        if (m) {
            var k = new CMYKColor();
            k.cyan = clamp100(m[1]); k.magenta = clamp100(m[2]);
            k.yellow = clamp100(m[3]); k.black = clamp100(m[4]);
            return k;
        }
        var hex = str.replace(/^#/, "");
        if (hex.length === 3) hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
        var c = new RGBColor();
        c.red = parseInt(hex.substr(0, 2), 16) || 0;
        c.green = parseInt(hex.substr(2, 2), 16) || 0;
        c.blue = parseInt(hex.substr(4, 2), 16) || 0;
        return c;
    }

    function clamp100(v) { return Math.max(0, Math.min(100, parseFloat(v) || 0)); }

    // カラーピッカーの結果を文字列に（CMYK は CMYK のまま保持）
    function colorToString(c) {
        function h(v) { var s = Math.round(Math.max(0, Math.min(255, v))).toString(16); return s.length < 2 ? "0" + s : s; }
        function n(v) { return String(Math.round(v * 10) / 10); }
        if (c.typename === "RGBColor") return ("#" + h(c.red) + h(c.green) + h(c.blue)).toUpperCase();
        if (c.typename === "CMYKColor") return "cmyk(" + n(c.cyan) + "," + n(c.magenta) + "," + n(c.yellow) + "," + n(c.black) + ")";
        if (c.typename === "GrayColor") return "cmyk(0,0,0," + n(c.gray) + ")";
        return null;
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
        if (s.type === "stacked" || s.type === "hstacked") {
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
        var W = s.width, H = s.height;
        if (s.type === "pie") {
            ensureSeries(s, d.labels.length);
            var pg = container.groupItems.add();
            pg.name = "GraphMaker";
            drawPie(s, d, pg, ox, oy, W, H);
            return finishGraph(s, { names: d.labels }, pg, ox, oy, W, H);
        }
        ensureSeries(s, d.names.length);
        var n = d.labels.length, ns = d.names.length;
        var sc = computeScale(s, d);
        var ax = s.axis;
        var horiz = (s.type === "hbar" || s.type === "hstacked");
        var stacked = (s.type === "stacked" || s.type === "hstacked");
        var isBar = horiz || s.type === "bar" || s.type === "stacked";

        var g = container.groupItems.add();
        g.name = "GraphMaker";

        // 値 → 座標（縦グラフは y、横棒は x）
        function vp(v) {
            v = Math.max(sc.min, Math.min(sc.max, v));
            var r = (v - sc.min) / (sc.max - sc.min);
            return horiz ? ox + r * W : oy - H + r * H;
        }
        // カテゴリ i の中心座標（縦グラフは x（左→右）、横棒は y（上→下））
        var band = (horiz ? H : W) / n;
        // 折れ線・面で「Y 軸から始める」ときは、最初の項目を左端・最後の項目を右端に置く
        var edge = !isBar && ax.lineFromAxis && n > 1;
        function cp(i) {
            if (edge) return ox + W * i / (n - 1);
            return horiz ? oy - band * (i + 0.5) : ox + band * (i + 0.5);
        }
        var basePos = vp(Math.max(sc.min, Math.min(sc.max, 0)));

        // 目盛りリスト（X=下辺, Y=左辺）
        var steps = Math.round((sc.max - sc.min) / sc.step);
        var valTicks = [], catTicks = [], valGrid = [], catGrid = [];
        for (var t = 0; t <= steps; t++) {
            var tv = sc.min + t * sc.step;
            valTicks.push({ pos: vp(tv), label: formatNumber(tv, ax.decimals, ax.thousands, ax.prefix, ax.suffix) });
            valGrid.push(vp(tv));
        }
        for (var i = 0; i < n; i++) catTicks.push({ pos: cp(i), label: d.labels[i] });
        for (i = 0; i < n; i++) catGrid.push(cp(i)); // 項目の位置（目盛りと同じ）
        var xTickList = horiz ? valTicks : catTicks, yTickList = horiz ? catTicks : valTicks;
        var xGridList = horiz ? valGrid : catGrid, yGridList = horiz ? catGrid : valGrid;

        // プロット領域（再編集時の位置の基準にもなる）
        var plot = g.pathItems.rectangle(oy, ox, W, H);
        plot.name = "gm-plot";
        setFill(plot, s.plotBg);
        plot.stroked = false;

        // グリッド
        if (s.grid.xShow || s.grid.yShow) {
            var gg = g.groupItems.add(); gg.name = "grid";
            if (s.grid.xShow) for (t = 0; t < xGridList.length; t++)
                line(gg, xGridList[t], oy, xGridList[t], oy - H, s.grid.xColor, s.grid.xWidth, s.grid.xDash);
            if (s.grid.yShow) for (t = 0; t < yGridList.length; t++)
                line(gg, ox, yGridList[t], ox + W, yGridList[t], s.grid.yColor, s.grid.yWidth, s.grid.yDash);
        }

        // 系列
        var vlabels = [];
        var stackPos = [], stackNeg = [];
        for (i = 0; i < n; i++) { stackPos.push(0); stackNeg.push(0); }
        var groupW = band * s.barRatio / 100;
        var barW = (groupW - s.barGap * (ns - 1)) / ns;
        if (barW < 0.1) barW = 0.1;

        // 重ね順：昇順＝系列1が一番下（後の系列ほど上）、降順＝系列1が一番上（折れ線・面のみ）
        var desc = !isBar && ax.lineOrder === "desc";
        for (var kk = 0; kk < ns; kk++) {
            var k = desc ? ns - 1 - kk : kk;
            var st = s.series[k];
            var sg = g.groupItems.add();
            sg.name = d.names[k];
            var vals = d.values[k];

            if (isBar) {
                for (i = 0; i < n; i++) {
                    var v = vals[i];
                    if (v === null) continue;
                    var c0, cw, p1, p2; // c0: カテゴリ方向の開始位置, p1/p2: 値方向の両端
                    if (!stacked) {
                        cw = barW;
                        c0 = horiz ? cp(i) + groupW / 2 - k * (barW + s.barGap)   // 上から順に
                                   : cp(i) - groupW / 2 + k * (barW + s.barGap);
                        p1 = basePos; p2 = vp(v);
                    } else {
                        cw = groupW;
                        c0 = horiz ? cp(i) + groupW / 2 : cp(i) - groupW / 2;
                        var from = v >= 0 ? stackPos[i] : stackNeg[i];
                        var to = from + v;
                        if (v >= 0) stackPos[i] = to; else stackNeg[i] = to;
                        p1 = vp(from); p2 = vp(to);
                    }
                    var lo = Math.min(p1, p2), hi = Math.max(p1, p2), len = Math.max(hi - lo, 0.01);
                    var r, lc = horiz ? c0 - cw / 2 : c0 + cw / 2; // 棒の中心（カテゴリ方向）
                    if (horiz) {
                        r = sg.pathItems.rectangle(c0, lo, len, cw);
                        if (stacked) vlabels.push({ v: v, x: (lo + hi) / 2, y: lc, pos: "mid" });
                        else vlabels.push({ v: v, x: v >= 0 ? hi : lo, y: lc, pos: v >= 0 ? "right" : "left" });
                    } else {
                        r = sg.pathItems.rectangle(hi, c0, cw, len);
                        if (stacked) vlabels.push({ v: v, x: lc, y: (lo + hi) / 2, pos: "mid" });
                        else vlabels.push({ v: v, x: lc, y: v >= 0 ? hi : lo, pos: v >= 0 ? "above" : "below" });
                    }
                    setFill(r, st.color);
                    setStroke(r, st.borderColor, st.borderWidth, "");
                }
            } else {
                // 折れ線 / 面：null で線を区切る
                var segs = [], cur = [];
                for (i = 0; i < n; i++) {
                    if (vals[i] === null) { if (cur.length) segs.push(cur); cur = []; continue; }
                    cur.push([cp(i), vp(vals[i])]);
                    vlabels.push({ v: vals[i], x: cp(i), y: vp(vals[i]) + st.markerSize / 2, pos: "above" });
                }
                if (cur.length) segs.push(cur);
                for (var q = 0; q < segs.length; q++) {
                    var pts = segs[q];
                    if (s.type === "area" && pts.length > 1) {
                        var ap = sg.pathItems.add();
                        var poly = pts.slice(0);
                        poly.push([pts[pts.length - 1][0], basePos]);
                        poly.push([pts[0][0], basePos]);
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

        // プロット枠
        if (s.plotFrame.show) {
            var pf = g.pathItems.rectangle(oy, ox, W, H);
            pf.name = "plot-frame";
            pf.filled = false;
            setStroke(pf, s.plotFrame.color, s.plotFrame.width, s.plotFrame.dash);
        }

        // 軸線
        var ag = g.groupItems.add(); ag.name = "axes";
        if (ax.xAxisLine) line(ag, ox, oy - H, ox + W, oy - H, ax.color, ax.width, "");
        if (ax.yAxisLine) line(ag, ox, oy, ox, oy - H, ax.color, ax.width, "");
        // 値 0 の基準線（最小値が負のとき）
        if (horiz && ax.yAxisLine && basePos > ox + 0.01) line(ag, basePos, oy, basePos, oy - H, ax.color, ax.width, "");
        if (!horiz && ax.xAxisLine && basePos > oy - H + 0.01) line(ag, ox, basePos, ox + W, basePos, ax.color, ax.width, "");

        var tl = Math.max(ax.tickLen, 0);
        // X（下辺）目盛りとラベル
        var xl = g.groupItems.add(); xl.name = "x-labels";
        for (i = 0; i < xTickList.length; i++) {
            var xp = xTickList[i].pos;
            if (ax.xTicks && tl > 0) line(ag, xp, oy - H, xp, oy - H - tl, ax.color, ax.width, "");
            var ly = oy - H - (ax.xTicks ? tl : 0) - 3;
            if (ax.xRotate) text(xl, xTickList[i].label, xp, ly, ax.xStyle, "right", "top", ax.xRotate);
            else text(xl, xTickList[i].label, xp, ly, ax.xStyle, "center", "top", 0);
        }
        // Y（左辺）目盛りとラベル
        var yl = g.groupItems.add(); yl.name = "y-labels";
        for (i = 0; i < yTickList.length; i++) {
            var yp = yTickList[i].pos;
            if (ax.yTicks && tl > 0) line(ag, ox - tl, yp, ox, yp, ax.color, ax.width, "");
            text(yl, yTickList[i].label, ox - (ax.yTicks ? tl : 0) - 3, yp, ax.yStyle, "right", "middle", 0);
        }
        // 横棒の項目ラベルは、ラベル列の中で 左 / 中央 / 右 揃え
        if (horiz && yl.textFrames.length) {
            var colW = 0, tfs = yl.textFrames, rightX = ox - (ax.yTicks ? tl : 0) - 3;
            var al = ax.catAlign || "center";
            var just = al === "left" ? Justification.LEFT : (al === "right" ? Justification.RIGHT : Justification.CENTER);
            for (i = 0; i < tfs.length; i++) {
                try { tfs[i].textRange.paragraphAttributes.justification = just; } catch (e) { }
                var vb = tfs[i].visibleBounds;
                if (vb[2] - vb[0] > colW) colW = vb[2] - vb[0];
            }
            for (i = 0; i < tfs.length; i++) {
                var cb = tfs[i].visibleBounds;
                var dx = al === "left" ? (rightX - colW) - cb[0]
                       : al === "right" ? rightX - cb[2]
                       : rightX - colW / 2 - (cb[0] + cb[2]) / 2;
                tfs[i].translate(dx, 0);
            }
        }

        // 値ラベル
        if (s.valueLabels.show) {
            var vg = g.groupItems.add(); vg.name = "value-labels";
            var vs = s.valueLabels.style;
            for (i = 0; i < vlabels.length; i++) {
                var L = vlabels[i];
                var str = formatNumber(L.v, s.valueLabels.decimals, ax.thousands, ax.prefix, ax.suffix);
                if (L.pos === "mid") text(vg, str, L.x, L.y, vs, "center", "middle", 0);
                else if (L.pos === "below") text(vg, str, L.x, L.y - 2, vs, "center", "top", 0);
                else if (L.pos === "right") text(vg, str, L.x + 3, L.y, vs, "left", "middle", 0);
                else if (L.pos === "left") text(vg, str, L.x - 3, L.y, vs, "right", "middle", 0);
                else text(vg, str, L.x, L.y + 2, vs, "center", "bottom", 0);
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

        return finishGraph(s, d, g, ox, oy, W, H);
    }

    // 凡例・タイトル・全体枠・設定の保存（全グラフ共通）
    function finishGraph(s, d, g, ox, oy, W, H) {
        // 凡例
        if (s.legend.show) drawLegend(s, d, g, ox, oy, W, H);

        // タイトル
        if (trim(s.title.text) !== "") {
            var gb = g.visibleBounds;
            text(g, s.title.text, ox + W / 2, gb[1] + 8, s.title.style, "center", "bottom", 0).name = "title";
        }

        // グラフ全体の枠（最背面）
        if (s.outerFrame.show) {
            var ob = g.visibleBounds, pd = s.outerFrame.padding, rr = Math.max(0, s.outerFrame.radius);
            var fw = ob[2] - ob[0] + pd * 2, fh = ob[1] - ob[3] + pd * 2;
            var of = rr > 0 ? g.pathItems.roundedRectangle(ob[1] + pd, ob[0] - pd, fw, fh, rr, rr)
                            : g.pathItems.rectangle(ob[1] + pd, ob[0] - pd, fw, fh);
            of.name = "outer-frame";
            setFill(of, s.outerFrame.fill);
            setStroke(of, s.outerFrame.color, s.outerFrame.width, s.outerFrame.dash);
            of.zOrder(ZOrderMethod.SENDTOBACK);
        }

        g.note = TAG + serialize(s);
        return g;
    }

    // ------------------------------------------------------------------
    // 円グラフ（1 列目の値を使用。各行が 1 つの扇形）
    // ------------------------------------------------------------------
    function arcPoints(cx, cy, r, a0, a1) {
        // a0 → a1 の円弧をベジェで近似した点列 [{a:anchor, l:left, r:right}]
        var sweep = a1 - a0;
        var m = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
        var dt = sweep / m;
        var h = 4 / 3 * Math.tan(Math.abs(dt) / 4) * r;
        var dir = sweep >= 0 ? 1 : -1;
        var pts = [];
        for (var i = 0; i <= m; i++) {
            var t = a0 + dt * i;
            var ax = cx + r * Math.cos(t), ay = cy + r * Math.sin(t);
            var tx = -Math.sin(t) * dir * h, ty = Math.cos(t) * dir * h; // 進行方向の接線
            pts.push({
                a: [ax, ay],
                l: i === 0 ? [ax, ay] : [ax - tx, ay - ty],
                r: i === m ? [ax, ay] : [ax + tx, ay + ty]
            });
        }
        return pts;
    }

    function addPoints(path, pts) {
        for (var i = 0; i < pts.length; i++) {
            var pp = path.pathPoints.add();
            pp.anchor = pts[i].a;
            pp.leftDirection = pts[i].l;
            pp.rightDirection = pts[i].r;
            pp.pointType = PointType.CORNER;
        }
    }

    function drawPie(s, d, g, ox, oy, W, H) {
        var P = s.pie;
        var plot = g.pathItems.rectangle(oy, ox, W, H);
        plot.name = "gm-plot";
        setFill(plot, s.plotBg);
        plot.stroked = false;

        var vals = d.values[0], total = 0, i;
        for (i = 0; i < vals.length; i++) if (vals[i] !== null && vals[i] > 0) total += vals[i];
        if (total <= 0) throw new Error("円グラフには正の値が必要です（1 列目の値を使います）。");

        var R = Math.min(W, H) / 2;
        var r0 = R * Math.max(0, Math.min(95, P.hole)) / 100;
        var cx = ox + W / 2, cy = oy - H / 2;
        var dir = P.clockwise ? -1 : 1;
        var ang = Math.PI / 2 - P.startAngle * Math.PI / 180 * (P.clockwise ? 1 : -1);

        var sg = g.groupItems.add(); sg.name = "slices";
        var labels = [];
        for (i = 0; i < vals.length; i++) {
            var v = vals[i];
            if (v === null || v <= 0) continue;
            var st = s.series[i];
            var sweep = v / total * Math.PI * 2 * dir;
            var a1 = ang + sweep, item;
            if (Math.abs(sweep) >= Math.PI * 2 - 1e-6 && r0 === 0) {
                item = sg.pathItems.ellipse(cy + R, cx - R, R * 2, R * 2);
            } else if (Math.abs(sweep) >= Math.PI * 2 - 1e-6) {
                item = sg.compoundPathItems.add();
                var outer = item.pathItems.ellipse(cy + R, cx - R, R * 2, R * 2);
                var inner = item.pathItems.ellipse(cy + r0, cx - r0, r0 * 2, r0 * 2);
                inner.reversed = !outer.reversed;
            } else {
                item = sg.pathItems.add();
                addPoints(item, arcPoints(cx, cy, R, ang, a1));
                if (r0 > 0) addPoints(item, arcPoints(cx, cy, r0, a1, ang));
                else addPoints(item, [{ a: [cx, cy], l: [cx, cy], r: [cx, cy] }]);
                item.closed = true;
            }
            item.name = d.labels[i];
            var tgt = item.typename === "CompoundPathItem" ? item.pathItems : [item];
            for (var q = 0; q < tgt.length; q++) {
                setFill(tgt[q], st.color);
                setStroke(tgt[q], P.borderColor, P.borderWidth, "");
            }
            item.opacity = st.opacity;
            labels.push({ i: i, v: v, mid: ang + sweep / 2 });
            ang = a1;
        }

        // ラベル
        if (P.labelPos === "none") return;
        var lg = g.groupItems.add(); lg.name = "pie-labels";
        for (var k = 0; k < labels.length; k++) {
            var L = labels[k], parts = [];
            if (P.showName) parts.push(d.labels[L.i]);
            if (P.showPercent) parts.push(formatNumber(L.v / total * 100, P.pctDecimals, false, "", "%"));
            if (P.showValue) parts.push(formatNumber(L.v, s.axis.decimals, s.axis.thousands, s.axis.prefix, s.axis.suffix));
            if (!parts.length) continue;
            var str = parts.join(" "), c = Math.cos(L.mid), sn = Math.sin(L.mid);
            if (P.labelPos === "inside") {
                var lr = r0 > 0 ? (r0 + R) / 2 : R * 0.62;
                text(lg, str, cx + c * lr, cy + sn * lr, P.labelStyle, "center", "middle", 0);
            } else {
                var e1 = R + 4, e2 = R + 14;
                var ex = cx + c * e2, ey = cy + sn * e2;
                var right = c >= 0;
                var hx = ex + (right ? 6 : -6);
                if (P.leader) {
                    var ln = lg.pathItems.add();
                    ln.setEntirePath([[cx + c * e1, cy + sn * e1], [ex, ey], [hx, ey]]);
                    ln.filled = false;
                    setStroke(ln, P.leaderColor, P.leaderWidth, "");
                }
                text(lg, str, hx + (right ? 2 : -2), ey, P.labelStyle, right ? "left" : "right", "middle", 0);
            }
        }
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
        return merge(defaults(), deserialize(String(g.note).substr(TAG.length)));
    }

    function loadPrefs() {
        var s = defaults();
        try {
            if (PREFS_FILE.exists) {
                PREFS_FILE.encoding = "UTF-8";
                PREFS_FILE.open("r");
                var src = PREFS_FILE.read();
                PREFS_FILE.close();
                s = merge(s, deserialize(src));
            }
        } catch (e) { }
        return s;
    }

    function savePrefs(s) {
        try {
            PREFS_FILE.encoding = "UTF-8";
            PREFS_FILE.open("w");
            PREFS_FILE.write(serialize(s));
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

        var LABEL_W = 90;

        // ---------- 部品 ----------
        function row(parent, label, labelW) {
            var g = parent.add("group");
            g.orientation = "row";
            g.alignChildren = "center";
            g.spacing = 6;
            if (label !== null) {
                var st = g.add("statictext", undefined, label);
                st.preferredSize.width = labelW || LABEL_W;
            }
            return g;
        }
        function panel(parent, title) {
            var p = parent.add("panel", undefined, title);
            p.orientation = "column";
            p.alignChildren = "left";
            p.alignment = "fill";
            p.margins = [12, 16, 12, 10];
            p.spacing = 6;
            return p;
        }
        function hint(parent, str) {
            var t = parent.add("statictext", undefined, str);
            t.graphics.foregroundColor = t.graphics.newPen(t.graphics.PenType.SOLID_COLOR, [0.45, 0.45, 0.45], 1);
            return t;
        }
        function pickInto(e) {
            var r = app.showColorPicker(makeColor(e.text) || makeColor("#000000"));
            var hx = r ? colorToString(r) : null;
            if (hx) e.text = hx;
        }
        // 以下の add* はすべて既存の行 g に部品を追加する
        function addNum(g, path, chars, unit) {
            var e = g.add("edittext", undefined, "");
            e.characters = chars || 5;
            if (unit) g.add("statictext", undefined, unit);
            if (path) reg.push({ path: path, ctrl: e, kind: "num" });
            return e;
        }
        function addText(g, path, chars) {
            var e = g.add("edittext", undefined, "");
            e.characters = chars || 20;
            if (path) reg.push({ path: path, ctrl: e, kind: "text" });
            return e;
        }
        function addColor(g, path) {
            var e = g.add("edittext", undefined, "");
            e.characters = 14;
            e.helpTip = "RGB は #RRGGBB、CMYK は cmyk(C,M,Y,K) または C,M,Y,K。なしにする場合は none";
            var b = g.add("button", undefined, "…");
            b.preferredSize = [26, 22];
            b.helpTip = "カラーピッカーで選択";
            b.onClick = function () { pickInto(e); };
            if (path) reg.push({ path: path, ctrl: e, kind: "text" });
            return e;
        }
        function addCheck(g, label, path) {
            var c = g.add("checkbox", undefined, label);
            if (path) reg.push({ path: path, ctrl: c, kind: "bool" });
            return c;
        }
        function addList(g, path, labels, values) {
            var dd = g.add("dropdownlist", undefined, labels);
            reg.push({ path: path, ctrl: dd, kind: "list", values: values });
            return dd;
        }
        // 線のスタイル 1 行: [✓ ラベル]  色 [#xxxxxx][…]  幅 [ ]pt  破線 [ ]
        function lineRow(parent, label, base, keys) {
            var g = row(parent, keys.show ? null : label);
            if (keys.show) {
                var c = addCheck(g, label, base + keys.show);
                c.preferredSize.width = LABEL_W;
            }
            g.add("statictext", undefined, "色");
            addColor(g, base + keys.color);
            g.add("statictext", undefined, "幅");
            addNum(g, base + keys.width, 4, "pt");
            if (keys.dash) {
                g.add("statictext", undefined, "破線");
                addText(g, base + keys.dash, 5).helpTip = "例: 4,2（空欄で実線）";
            }
            return g;
        }

        var tabs = dlg.add("tabbedpanel");
        tabs.alignChildren = "fill";
        tabs.preferredSize = [560, 430];
        function tab(title) {
            var t = tabs.add("tab", undefined, title);
            t.orientation = "column";
            t.alignChildren = "fill";
            t.margins = [12, 12, 12, 12];
            t.spacing = 8;
            return t;
        }

        // ================= 1. 基本 =================
        var tBasic = tab("基本");
        var r;
        r = row(tBasic, "グラフの種類");
        var TYPES = ["bar", "stacked", "hbar", "hstacked", "line", "area", "pie"];
        var typeDD = addList(r, "type", ["棒グラフ", "積み上げ棒グラフ", "横棒グラフ", "横積み上げ棒グラフ", "折れ線グラフ", "面グラフ", "円グラフ"], TYPES);

        var pData = panel(tBasic, "データ");
        hint(pData, "1 行目＝系列名、1 列目＝項目名。カンマ区切り、または Excel からそのまま貼り付け");
        var dataEt = pData.add("edittext", [0, 0, 520, 150], "", { multiline: true, scrolling: true, wantReturn: true });
        reg.push({ path: "data", ctrl: dataEt, kind: "text" });

        r = row(tBasic, "サイズ");
        reg.push({ path: "width", ctrl: addNum(r, null, 5, "×"), kind: "mm" });
        reg.push({ path: "height", ctrl: addNum(r, null, 5, "mm（グラフ本体の幅×高さ）"), kind: "mm" });
        r = row(tBasic, "タイトル");
        addText(r, "title.text", 36);
        r = row(tBasic, "凡例");
        addCheck(r, "表示", "legend.show");
        addList(r, "legend.position", ["右", "上", "下"], ["right", "top", "bottom"]);

        // ================= 2. 色・系列 =================
        var tSeries = tab("色・系列");
        r = row(tSeries, "系列");
        var seriesDD = r.add("dropdownlist", undefined, []);
        seriesDD.preferredSize.width = 260;
        var seriesHint = hint(tSeries, "");
        seriesHint.preferredSize.width = 520;

        var pFill = panel(tSeries, "色");
        r = row(pFill, "色");
        var sColor = addColor(r, null);
        r.add("statictext", undefined, "   不透明度");
        var sOpacity = addNum(r, null, 4, "%");
        r = row(pFill, "縁取り");
        r.add("statictext", undefined, "色");
        var sBorder = addColor(r, null);
        r.add("statictext", undefined, "幅");
        var sBorderW = addNum(r, null, 4, "pt");

        var pLine = panel(tSeries, "線とマーカー（折れ線・面）");
        r = row(pLine, "線");
        r.add("statictext", undefined, "幅");
        var sLineW = addNum(r, null, 4, "pt");
        r.add("statictext", undefined, "破線");
        var sDash = addText(r, null, 5);
        sDash.helpTip = "例: 4,2（空欄で実線）";
        r = row(pLine, "開始位置");
        addCheck(r, "Y 軸から始める（全系列共通）", "axis.lineFromAxis").helpTip = "最初の点を Y 軸上、最後の点を右端に置きます";
        r = row(pLine, "重ね順");
        addList(r, "axis.lineOrder", ["昇順（系列1が一番下）", "降順（系列1が一番上）"], ["asc", "desc"]);
        hint(r, "全系列共通");
        r = row(pLine, "マーカー");
        var MARKERS = ["none", "circle", "square", "diamond"];
        var sMarker = r.add("dropdownlist", undefined, ["なし", "円", "四角", "ひし形"]);
        r.add("statictext", undefined, "サイズ");
        var sMarkerSize = addNum(r, null, 4, "pt");

        var pBar = panel(tSeries, "棒（全系列共通）");
        r = row(pBar, "棒の太さ");
        addNum(r, "barRatio", 4, "%（項目の幅に対して）");
        r = row(pBar, "棒の間隔");
        addNum(r, "barGap", 4, "pt");

        var applyAll = tSeries.add("button", undefined, "この系列の不透明度・縁取り・線・マーカーを全系列にコピー");
        applyAll.alignment = "left";

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
        function curType() { return TYPES[typeDD.selection ? typeDD.selection.index : 0]; }
        function refreshSeriesList() {
            storeSeries();
            var names, isPie = curType() === "pie";
            try { var pd0 = parseData(dataEt.text); names = isPie ? pd0.labels : pd0.names; } catch (e) { names = []; }
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

        // ================= 3. 軸・目盛り =================
        var tAxis = tab("軸・目盛り");
        var pRange = panel(tAxis, "数値の目盛り");
        r = row(pRange, "範囲");
        r.add("statictext", undefined, "最小");
        addText(r, "axis.yMin", 5);
        r.add("statictext", undefined, "最大");
        addText(r, "axis.yMax", 5);
        r.add("statictext", undefined, "間隔");
        addText(r, "axis.yStep", 5);
        hint(r, "空欄＝自動");
        r = row(pRange, "表示形式");
        r.add("statictext", undefined, "小数");
        addNum(r, "axis.decimals", 2, "桁");
        addCheck(r, "3桁区切り", "axis.thousands");
        r.add("statictext", undefined, "  前に");
        addText(r, "axis.prefix", 3);
        r.add("statictext", undefined, "後に");
        addText(r, "axis.suffix", 3);
        r = row(pRange, "値ラベル");
        addCheck(r, "棒・点に値を表示", "valueLabels.show");
        r.add("statictext", undefined, "  小数");
        addNum(r, "valueLabels.decimals", 2, "桁");

        var pLines = panel(tAxis, "軸線と目盛り線");
        r = row(pLines, "X 軸（下）");
        addCheck(r, "軸線", "axis.xAxisLine");
        addCheck(r, "目盛り線", "axis.xTicks");
        r = row(pLines, "Y 軸（左）");
        addCheck(r, "軸線", "axis.yAxisLine");
        addCheck(r, "目盛り線", "axis.yTicks");
        r = lineRow(pLines, "線の見た目", "axis.", { color: "color", width: "width" });
        r.add("statictext", undefined, "目盛りの長さ");
        addNum(r, "axis.tickLen", 3, "pt");

        var pGrid = panel(tAxis, "グリッド線");
        lineRow(pGrid, "縦線", "grid.", { show: "xShow", color: "xColor", width: "xWidth", dash: "xDash" });
        lineRow(pGrid, "横線", "grid.", { show: "yShow", color: "yColor", width: "yWidth", dash: "yDash" });

        var pAxLabel = panel(tAxis, "ラベル");
        r = row(pAxLabel, "軸タイトル");
        r.add("statictext", undefined, "X");
        addText(r, "axis.xTitle", 14);
        r.add("statictext", undefined, "Y");
        addText(r, "axis.yTitle", 14);
        r = row(pAxLabel, "X ラベル");
        addNum(r, "axis.xRotate", 3, "°回転");
        r.add("statictext", undefined, "   横棒の項目名");
        addList(r, "axis.catAlign", ["左揃え", "中央揃え", "右揃え"], ["left", "center", "right"]);

        // ================= 4. 円グラフ =================
        var tPie = tab("円グラフ");
        hint(tPie, "データの 1 列目の値を使います。扇ごとの色は「色・系列」タブで設定します。");
        var pPieShape = panel(tPie, "形");
        r = row(pPieShape, "ドーナツの穴");
        addNum(r, "pie.hole", 3, "%（0 で普通の円）");
        r = row(pPieShape, "開始位置");
        addNum(r, "pie.startAngle", 3, "°（12 時＝0）");
        addCheck(r, "時計回り", "pie.clockwise");
        lineRow(pPieShape, "扇の境界線", "pie.", { color: "borderColor", width: "borderWidth" });
        var pPieLabel = panel(tPie, "ラベル");
        r = row(pPieLabel, "位置");
        addList(r, "pie.labelPos", ["外側", "内側", "表示しない"], ["outside", "inside", "none"]);
        r = row(pPieLabel, "内容");
        addCheck(r, "項目名", "pie.showName");
        addCheck(r, "割合(%)", "pie.showPercent");
        addCheck(r, "値", "pie.showValue");
        r.add("statictext", undefined, "  % の小数");
        addNum(r, "pie.pctDecimals", 2, "桁");
        lineRow(pPieLabel, "引き出し線", "pie.", { show: "leader", color: "leaderColor", width: "leaderWidth" });

        // ================= 5. 文字 =================
        var tText = tab("文字");
        var STYLES = [
            ["タイトル", "title.style"], ["X 軸の目盛り", "axis.xStyle"], ["Y 軸の目盛り", "axis.yStyle"],
            ["軸タイトル", "axis.titleStyle"], ["凡例", "legend.style"], ["値ラベル", "valueLabels.style"],
            ["円グラフのラベル", "pie.labelStyle"]
        ];
        var styleNames = [];
        for (var si = 0; si < STYLES.length; si++) styleNames.push(STYLES[si][0]);
        r = row(tText, "対象");
        var styleDD = r.add("dropdownlist", undefined, styleNames);
        styleDD.preferredSize.width = 200;
        var pStyle = panel(tText, "文字のスタイル");
        r = row(pStyle, "フォント");
        var fFont = addText(r, null, 26);
        fFont.helpTip = "PostScript 名。空欄で Illustrator の既定フォント";
        r.add("button", undefined, "選択…").onClick = function () { fFont.text = pickFont(fFont.text); };
        r = row(pStyle, "サイズ");
        var fSize = addNum(r, null, 4, "pt");
        r = row(pStyle, "色");
        var fColor = addColor(r, null);
        var fontAll = tText.add("button", undefined, "このフォントをすべての文字に適用");
        fontAll.alignment = "left";

        var curStyle = -1;
        function storeStyle() {
            if (curStyle < 0) return;
            var st = getPath(s, STYLES[curStyle][1]);
            st.font = trim(fFont.text);
            st.size = Math.max(0.1, num(fSize.text, st.size));
            st.color = trim(fColor.text) || st.color;
        }
        function loadStyle(i) {
            curStyle = i;
            var st = getPath(s, STYLES[i][1]);
            fFont.text = st.font; fSize.text = st.size; fColor.text = st.color;
        }
        styleDD.onChange = function () {
            if (!styleDD.selection) return;
            storeStyle();
            loadStyle(styleDD.selection.index);
        };
        fontAll.onClick = function () {
            storeStyle();
            for (var i = 0; i < STYLES.length; i++) getPath(s, STYLES[i][1]).font = trim(fFont.text);
        };

        // ================= 6. 枠・背景 =================
        var tFrame = tab("枠・背景");
        var pPlot = panel(tFrame, "グラフ本体（プロット領域）");
        r = row(pPlot, "背景色");
        addColor(r, "plotBg");
        lineRow(pPlot, "枠線", "plotFrame.", { show: "show", color: "color", width: "width", dash: "dash" });
        var pOuter = panel(tFrame, "グラフ全体（タイトル・凡例を含む）");
        lineRow(pOuter, "枠線", "outerFrame.", { show: "show", color: "color", width: "width", dash: "dash" });
        r = row(pOuter, "塗り");
        addColor(r, "outerFrame.fill");
        r = row(pOuter, "余白");
        addNum(r, "outerFrame.padding", 4, "pt");
        r.add("statictext", undefined, "   角丸");
        addNum(r, "outerFrame.radius", 4, "pt");

        // ---------- ボタン ----------
        var btns = dlg.add("group");
        btns.alignment = "right";
        var prevBtn = btns.add("button", undefined, "プレビュー");
        btns.add("button", undefined, "キャンセル", { name: "cancel" });
        var okBtn = btns.add("button", undefined, isEdit ? "更新" : "作成", { name: "ok" });

        // 種類に関係ない項目はグレーアウト
        function updateEnabled() {
            var t = curType();
            var pie = t === "pie", bar = t === "bar" || t === "stacked" || t === "hbar" || t === "hstacked";
            var line = t === "line" || t === "area";
            pBar.enabled = bar;
            pLine.enabled = line;
            pRange.enabled = pLines.enabled = pGrid.enabled = pAxLabel.enabled = !pie;
            pPieShape.enabled = pPieLabel.enabled = pie;
            seriesHint.text = pie ? "円グラフでは「系列」は各項目（扇）になります。"
                                  : "データの 2 列目以降が系列です。系列を選んで色などを設定します。";
        }

        // UI ⇔ 設定
        function toUI() {
            for (var i = 0; i < reg.length; i++) {
                var rr = reg[i], v = getPath(s, rr.path);
                if (rr.kind === "bool") rr.ctrl.value = !!v;
                else if (rr.kind === "list") {
                    for (var j = 0; j < rr.values.length; j++) if (rr.values[j] === v) rr.ctrl.selection = j;
                    if (!rr.ctrl.selection) rr.ctrl.selection = 0;
                } else if (rr.kind === "mm") rr.ctrl.text = String(Math.round(v / MM * 10) / 10);
                else rr.ctrl.text = String(v);
            }
            refreshSeriesList();
            styleDD.selection = 0;
            loadStyle(0);
            updateEnabled();
        }
        function fromUI() {
            for (var i = 0; i < reg.length; i++) {
                var rr = reg[i];
                if (rr.kind === "bool") setPath(s, rr.path, rr.ctrl.value);
                else if (rr.kind === "list") setPath(s, rr.path, rr.values[rr.ctrl.selection ? rr.ctrl.selection.index : 0]);
                else if (rr.kind === "num") setPath(s, rr.path, num(rr.ctrl.text, getPath(s, rr.path)));
                else if (rr.kind === "mm") {
                    // 表示値から変わっていなければ元の値を保つ（丸め誤差を溜めない）
                    if (rr.ctrl.text !== String(Math.round(getPath(s, rr.path) / MM * 10) / 10))
                        setPath(s, rr.path, num(rr.ctrl.text, getPath(s, rr.path) / MM) * MM);
                }
                else setPath(s, rr.path, rr.ctrl.text);
            }
            storeSeries();
            storeStyle();
            if (s.width <= 0) s.width = 100;
            if (s.height <= 0) s.height = 100;
            s.barRatio = Math.max(1, Math.min(100, s.barRatio));
        }

        tabs.onChange = function () { if (tabs.selection === tSeries) refreshSeriesList(); };
        dataEt.onChange = refreshSeriesList;
        typeDD.onChange = function () { refreshSeriesList(); updateEnabled(); };

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
        okBtn.onClick = function () { if (validate()) dlg.close(1); };

        toUI();
        tabs.selection = tBasic;
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
