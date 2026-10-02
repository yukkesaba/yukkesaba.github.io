// テキスト原点パネル
// 文字の位置は変えずに、アンカーポイント位置（＝行揃え）だけを変更するパネル。
// 回転したテキストでも文字位置は保たれる。横組み/縦組みの切り替えもボタンひとつで行える
// （切り替え時はアンカーポイントの位置を保つ）。対象はポイント文字。
#target illustrator
#targetengine "pxm_text_origin"

(function () {
    if ($.global.pxmTextOriginPanel) {
        try { $.global.pxmTextOriginPanel.show(); return; } catch (e) { }
    }

    var libFile = new File(new File($.fileName).parent + "/mapping_core.jsxinc");
    var libPath = libFile.fsName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

    function run(vertical, justName) {
        var bt = new BridgeTalk();
        bt.target = "illustrator";
        bt.body = '$.evalFile(new File("' + libPath + '"));' +
            'PXM.report("テキスト原点", PXM.textOrigin(' + vertical + ', "' + justName + '"));' +
            'app.redraw();';
        bt.onError = function (e) { alert(e.body, "テキスト原点"); };
        bt.send();
    }

    var w = new Window("palette", "テキスト原点");
    w.alignChildren = "left";
    w.spacing = 4;
    w.margins = 8;

    function row(label, vertical, names) {
        var g = w.add("group");
        g.spacing = 2;
        var st = g.add("statictext", undefined, label);
        st.preferredSize.width = 36;
        var justs = ["LEFT", "CENTER", "RIGHT"];
        for (var i = 0; i < 3; i++) {
            var b = g.add("button", undefined, names[i]);
            b.preferredSize = [34, 24];
            b.helpTip = label + "・" + names[i] + "揃え";
            (function (j) { b.onClick = function () { run(vertical, j); }; })(justs[i]);
        }
    }
    row("横組み", false, ["左", "中", "右"]);
    row("縦組み", true, ["上", "中", "下"]);

    w.onClose = function () { $.global.pxmTextOriginPanel = null; };
    $.global.pxmTextOriginPanel = w;
    w.show();
})();
