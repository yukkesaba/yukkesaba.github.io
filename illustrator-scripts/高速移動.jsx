// 高速移動
// 2点だけのオープンパスを描いて、それだけを選択して実行する。
// 1点目→2点目（描画方向）の分だけ、表示中かつロックされていないレイヤーの
// オブジェクトをすべて移動する。移動するオブジェクトを選択する必要はない。
#target illustrator
#include "lib/mapping_core.jsxinc"

(function () {
    var title = "高速移動";
    if (app.documents.length === 0) return;
    var v = PXM.moveVector();
    if (!v) {
        alert("移動先を示す2点のパス（オープンパス）を1つだけ選択してから実行してください。\n1点目→2点目の方向に移動します。", title);
        return;
    }
    if (Math.abs(v.dx) < 1e-9 && Math.abs(v.dy) < 1e-9) return;

    var dlg = new Window("dialog", title);
    dlg.alignChildren = "left";
    var mm = 25.4 / 72;
    dlg.add("statictext", undefined,
        "移動量: 横 " + (v.dx * mm).toFixed(2) + " mm / 縦 " + (-v.dy * mm).toFixed(2) + " mm");
    dlg.add("statictext", undefined, "表示中かつロックされていないレイヤーのオブジェクトをすべて移動します。");
    var delChk = dlg.add("checkbox", undefined, "移動後に指示パスを削除する");
    delChk.value = true;
    var btns = dlg.add("group");
    btns.alignment = "right";
    btns.add("button", undefined, "キャンセル", { name: "cancel" });
    btns.add("button", undefined, "移動", { name: "ok" });
    if (dlg.show() !== 1) return;

    var guide = v.path;
    var deleteGuide = delChk.value;
    if (deleteGuide) {
        guide.remove();
        guide = null;
    }
    app.activeDocument.selection = null;
    var r = PXM.fastMove(v.dx, v.dy);
    // 指示パスを残す場合は、一緒に動いた分を元に戻す
    if (guide) {
        try { guide.translate(-v.dx, -v.dy); } catch (e) { }
    }
    PXM.report(title, r);
})();
