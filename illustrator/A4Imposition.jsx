/**
 * A4Imposition.jsx — 選択オブジェクトを A4 用紙の中央に面付けする Illustrator スクリプト
 *
 * 使い方:
 *   1. 面付けしたいオブジェクトを選択する（複数可。まとめて 1 単位として扱う）
 *   2. ファイル > スクリプト > その他のスクリプト… からこのファイルを実行
 *      （Scripts フォルダに置くとメニューに常駐します）
 *   3. ダイアログで配置数・間隔・用紙の向きなどを指定して OK
 *
 * 出力先は「新規 A4 ドキュメント」か「現在のドキュメントに A4 アートボードを追加」を選べます。
 * 元のオブジェクトは変更せず、複製を「面付け」レイヤーに配置します。
 */
#target illustrator

(function () {
    var MM = 72 / 25.4;
    var A4 = { w: 210 * MM, h: 297 * MM };

    if (app.documents.length === 0) {
        alert("ドキュメントを開いてください。");
        return;
    }
    var srcDoc = app.activeDocument;
    var sel = srcDoc.selection;
    // テキスト編集中は selection が TextRange になる
    if (!sel || sel.typename || sel.length === 0) {
        alert("面付けするオブジェクトを選択してください。");
        return;
    }

    var step = "準備";
    var prevCS = app.coordinateSystem;
    app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
    try {
        var items = [];
        for (var i = 0; i < sel.length; i++) items.push(sel[i]);

        var sizeVisible = itemsSize(items, true);
        var sizeGeometric = itemsSize(items, false);

        var opt = showDialog(sizeVisible, sizeGeometric);
        if (!opt) return;

        var size = opt.useVisible ? sizeVisible : sizeGeometric;
        var plan = bestLayout(size, opt);
        if (!plan) {
            alert(opt.auto
                ? "オブジェクトが大きすぎて A4 に 1 つも入りません。"
                : "指定した列数・行数では A4 に収まりません。\n間隔・余白・配置数を見直してください。");
            return;
        }

        try {
            impose(srcDoc, items, plan, opt);
        } catch (e) {
            // 途中で失敗したら元ドキュメントに残った作業用レイヤーを片付ける
            try { srcDoc.layers.getByName("面付け_tmp").remove(); } catch (ignore) {}
            throw e;
        }
        alert(plan.cols + " 列 × " + plan.rows + " 行 = " + (plan.cols * plan.rows) + " 個を面付けしました。"
            + (plan.rotate ? "\n（オブジェクトを 90° 回転）" : "")
            + "\n用紙: A4 " + (plan.landscape ? "横" : "縦"));
    } catch (e) {
        alert("エラーが発生しました（" + step + "）:\n" + e + (e.line ? "\n行: " + e.line : ""));
    } finally {
        app.coordinateSystem = prevCS;
    }

    // ---------------------------------------------------------------

    function rawBounds(item, useVisible) {
        return useVisible ? item.visibleBounds : item.geometricBounds;
    }

    // 見た目どおりの外接矩形 [左, 上, 右, 下]。
    // クリップグループはマスクパスの範囲だけ、通常グループは中身を再帰的に合算する
    // （Illustrator の bounds はマスクで隠れた部分まで含んでしまうため）。
    function bounds(item, useVisible) {
        if (item.typename !== "GroupItem") return rawBounds(item, useVisible);
        var kids = item.pageItems;
        if (item.clipped) {
            for (var i = 0; i < kids.length; i++) {
                if (isClippingPath(kids[i])) return rawBounds(kids[i], useVisible);
            }
        }
        var u = null;
        for (var k = 0; k < kids.length; k++) {
            var it = kids[k];
            if (it.hidden) continue; // ガイドはサイズ・中央揃えの基準に含める
            var b = bounds(it, useVisible);
            u = u ? [Math.min(u[0], b[0]), Math.max(u[1], b[1]), Math.max(u[2], b[2]), Math.min(u[3], b[3])] : b;
        }
        return u || rawBounds(item, useVisible);
    }

    function isClippingPath(it) {
        if (it.typename === "PathItem") return it.clipping;
        if (it.typename === "CompoundPathItem") return it.pathItems.length > 0 && it.pathItems[0].clipping;
        return false;
    }

    // 選択全体の外接矩形サイズ（pt）
    function itemsSize(list, useVisible) {
        var b = bounds(list[0], useVisible);
        var l = b[0], t = b[1], r = b[2], btm = b[3];
        for (var i = 1; i < list.length; i++) {
            b = bounds(list[i], useVisible);
            l = Math.min(l, b[0]);
            t = Math.max(t, b[1]);
            r = Math.max(r, b[2]);
            btm = Math.min(btm, b[3]);
        }
        return { w: r - l, h: t - btm };
    }

    function fitCount(avail, size, gap) {
        if (size <= 0 || avail < size) return 0;
        return Math.floor((avail + gap + 0.001) / (size + gap));
    }

    // 向き・回転の組み合わせから最適な配置を選ぶ。収まらなければ null
    function bestLayout(size, o) {
        var orients = o.orientation === "auto" ? [false, true] : [o.orientation === "landscape"];
        var rots = o.allowRotate ? [false, true] : [false];
        var best = null;
        for (var a = 0; a < orients.length; a++) {
            for (var b = 0; b < rots.length; b++) {
                var landscape = orients[a], rotate = rots[b];
                var pw = landscape ? A4.h : A4.w;
                var ph = landscape ? A4.w : A4.h;
                var w = rotate ? size.h : size.w;
                var h = rotate ? size.w : size.h;
                var availW = pw - o.margin * 2;
                var availH = ph - o.margin * 2;
                var cols, rows;
                if (o.auto) {
                    cols = fitCount(availW, w, o.gapX);
                    rows = fitCount(availH, h, o.gapY);
                } else {
                    cols = o.cols;
                    rows = o.rows;
                    var needW = cols * w + (cols - 1) * o.gapX;
                    var needH = rows * h + (rows - 1) * o.gapY;
                    if (needW > availW + 0.001 || needH > availH + 0.001) continue;
                }
                var count = cols * rows;
                if (count > 0 && (!best || count > best.cols * best.rows)) {
                    best = { cols: cols, rows: rows, rotate: rotate, landscape: landscape,
                             pw: pw, ph: ph, w: w, h: h };
                }
            }
        }
        return best;
    }

    function impose(srcDoc, items, plan, o) {
        // 1. 元ドキュメント内で選択オブジェクトを 1 つのグループに複製・回転しておく
        //    （別ドキュメントのグループへ直接複製すると PARM エラーになるため）
        step = "オブジェクトの複製";
        var tmpLayer = srcDoc.layers.add();
        tmpLayer.name = "面付け_tmp";
        var master = tmpLayer.groupItems.add();
        // 重なり順を維持するため背面側から先頭に積む
        for (var j = items.length - 1; j >= 0; j--) {
            items[j].duplicate(master, ElementPlacement.PLACEATBEGINNING);
        }
        if (plan.rotate) master.rotate(90);

        // 2. 出力先の A4 アートボードを用意
        var doc, abRect;
        if (o.output === "newDoc") {
            step = "新規ドキュメントの作成";
            doc = createA4Document(srcDoc, plan);
            abRect = doc.artboards[0].artboardRect;
        } else {
            step = "アートボードの追加";
            doc = srcDoc;
            var maxRight = -Infinity, top = doc.artboards[0].artboardRect[1];
            for (var i = 0; i < doc.artboards.length; i++) {
                maxRight = Math.max(maxRight, doc.artboards[i].artboardRect[2]);
            }
            var left = maxRight + 20 * MM;
            abRect = [left, top, left + plan.pw, top - plan.ph];
            var ab = doc.artboards.add(abRect);
            ab.name = "A4面付け";
            doc.artboards.setActiveArtboardIndex(doc.artboards.length - 1);
        }

        // 3. 出力先レイヤーへ移す
        step = "面付けレイヤーへの配置";
        var layer;
        if (doc === srcDoc) {
            layer = tmpLayer;
            layer.name = "面付け";
        } else {
            layer = doc.layers[0];
            layer.name = "面付け";
            var moved = master.duplicate(layer, ElementPlacement.PLACEATBEGINNING);
            tmpLayer.remove();
            master = moved;
        }

        // 4. 間隔どおりに並べる
        step = "面付け配置";
        var dups = [];
        for (var r = 0; r < plan.rows; r++) {
            for (var c = 0; c < plan.cols; c++) {
                var dup = master.duplicate(layer, ElementPlacement.PLACEATEND);
                dup.translate(c * (plan.w + o.gapX), -r * (plan.h + o.gapY));
                dups.push(dup);
            }
        }

        // 5. 並べた全体の中心をアートボードの中心に合わせる
        //    （新規ドキュメント作成で座標系設定がリセットされることがあるため、ここで改めて揃えて測る）
        step = "中央揃え";
        app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
        var abIndex = o.output === "newDoc" ? 0 : doc.artboards.length - 1;
        abRect = doc.artboards[abIndex].artboardRect;
        // 各コピーは master を平行移動しただけなので、全体の範囲は master の範囲から求まる
        var mb = bounds(master, o.useVisible);
        var gb = [mb[0], mb[1],
                  mb[2] + (plan.cols - 1) * (plan.w + o.gapX),
                  mb[3] - (plan.rows - 1) * (plan.h + o.gapY)];
        var dx = (abRect[0] + abRect[2]) / 2 - (gb[0] + gb[2]) / 2;
        var dy = (abRect[1] + abRect[3]) / 2 - (gb[1] + gb[3]) / 2;
        for (var m = 0; m < dups.length; m++) dups[m].translate(dx, dy);
        master.remove();
        doc.selection = null;
    }

    function createA4Document(srcDoc, plan) {
        var cmyk = srcDoc.documentColorSpace === DocumentColorSpace.CMYK;
        try {
            var preset = new DocumentPreset();
            preset.width = plan.pw;
            preset.height = plan.ph;
            preset.colorMode = cmyk ? DocumentColorSpace.CMYK : DocumentColorSpace.RGB;
            preset.units = RulerUnits.Millimeters;
            preset.numArtboards = 1;
            return app.documents.addDocument(cmyk ? "Print" : "Web", preset, false);
        } catch (e) {
            return app.documents.add(cmyk ? DocumentColorSpace.CMYK : DocumentColorSpace.RGB, plan.pw, plan.ph);
        }
    }

    // ---------------------------------------------------------------

    function showDialog(sizeVisible, sizeGeometric) {
        var dlg = new Window("dialog", "A4 面付け");
        dlg.orientation = "column";
        dlg.alignChildren = "fill";

        var info = dlg.add("statictext", undefined, "");
        info.characters = 40;

        // 配置数
        var pCount = dlg.add("panel", undefined, "配置数");
        pCount.alignChildren = "left";
        var rbAuto = pCount.add("radiobutton", undefined, "自動（入るだけ最大）");
        var gManual = pCount.add("group");
        var rbManual = gManual.add("radiobutton", undefined, "指定:");
        var etCols = gManual.add("edittext", undefined, "2");
        etCols.characters = 4;
        gManual.add("statictext", undefined, "列 ×");
        var etRows = gManual.add("edittext", undefined, "5");
        etRows.characters = 4;
        gManual.add("statictext", undefined, "行");
        rbAuto.value = true;

        // 間隔・余白
        var pGap = dlg.add("panel", undefined, "間隔・余白（mm）");
        pGap.orientation = "row";
        pGap.add("statictext", undefined, "横間隔");
        var etGapX = pGap.add("edittext", undefined, "0");
        etGapX.characters = 5;
        pGap.add("statictext", undefined, "縦間隔");
        var etGapY = pGap.add("edittext", undefined, "0");
        etGapY.characters = 5;
        pGap.add("statictext", undefined, "用紙余白");
        var etMargin = pGap.add("edittext", undefined, "10");
        etMargin.characters = 5;

        // 用紙・オブジェクト
        var pPaper = dlg.add("panel", undefined, "用紙・オブジェクト");
        pPaper.alignChildren = "left";
        var gOrient = pPaper.add("group");
        gOrient.add("statictext", undefined, "用紙の向き:");
        var ddOrient = gOrient.add("dropdownlist", undefined, ["縦", "横", "自動（多く入る方）"]);
        ddOrient.selection = 2;
        var cbRotate = pPaper.add("checkbox", undefined, "90° 回転した方が多く入る場合は回転する");
        cbRotate.value = true;
        var cbVisible = pPaper.add("checkbox", undefined, "線幅を含めたサイズで計算する");
        cbVisible.value = false;

        // 出力先
        var pOut = dlg.add("panel", undefined, "出力先");
        pOut.alignChildren = "left";
        var rbNewDoc = pOut.add("radiobutton", undefined, "新規 A4 ドキュメント");
        var rbAddAb = pOut.add("radiobutton", undefined, "現在のドキュメントに A4 アートボードを追加");
        rbNewDoc.value = true;

        var preview = dlg.add("statictext", undefined, "");
        preview.characters = 40;

        var gBtn = dlg.add("group");
        gBtn.alignment = "right";
        gBtn.add("button", undefined, "キャンセル", { name: "cancel" });
        var btnOk = gBtn.add("button", undefined, "OK", { name: "ok" });

        function num(et) {
            var v = parseFloat(String(et.text).replace(/[０-９．]/g, function (ch) {
                return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
            }));
            return isNaN(v) ? null : v;
        }

        function collect() {
            var cols = num(etCols), rows = num(etRows);
            var gapX = num(etGapX), gapY = num(etGapY), margin = num(etMargin);
            if (gapX === null || gapY === null || margin === null || gapX < 0 || gapY < 0 || margin < 0) return null;
            if (rbManual.value && (cols === null || rows === null || cols < 1 || rows < 1)) return null;
            return {
                auto: rbAuto.value,
                cols: Math.floor(cols || 0),
                rows: Math.floor(rows || 0),
                gapX: gapX * MM,
                gapY: gapY * MM,
                margin: margin * MM,
                orientation: ["portrait", "landscape", "auto"][ddOrient.selection.index],
                allowRotate: cbRotate.value,
                useVisible: cbVisible.value,
                output: rbNewDoc.value ? "newDoc" : "addArtboard"
            };
        }

        function update() {
            etCols.enabled = etRows.enabled = rbManual.value;
            var s = cbVisible.value ? sizeVisible : sizeGeometric;
            info.text = "選択オブジェクト: " + (s.w / MM).toFixed(1) + " × " + (s.h / MM).toFixed(1) + " mm";
            var o = collect();
            if (!o) {
                preview.text = "→ 数値を正しく入力してください";
                btnOk.enabled = false;
                return;
            }
            var plan = bestLayout(s, o);
            btnOk.enabled = !!plan;
            preview.text = plan
                ? "→ " + plan.cols + " 列 × " + plan.rows + " 行 = " + (plan.cols * plan.rows) + " 個"
                  + "（A4 " + (plan.landscape ? "横" : "縦") + (plan.rotate ? "・90°回転" : "") + "）"
                : "→ A4 に収まりません";
        }

        // 別グループのラジオボタンは自動で排他にならないので手動で切り替える
        rbAuto.onClick = function () { rbManual.value = false; update(); };
        rbManual.onClick = function () { rbAuto.value = false; update(); };
        etCols.onChanging = etRows.onChanging = etGapX.onChanging =
            etGapY.onChanging = etMargin.onChanging = update;
        ddOrient.onChange = cbRotate.onClick = cbVisible.onClick = update;
        update();

        if (dlg.show() !== 1) return null;
        return collect();
    }
})();
