// 配置画像サイズをリセット
// 選択した配置画像（リンク／埋め込み）の変形をリセットする。
// 縦横比は元画像どおり、回転0、拡大縮小率は72dpi相当（1ピクセル=1ポイント）。中心位置は保つ。
#target illustrator
#include "mapping_core.jsxinc"

(function () {
    if (app.documents.length === 0) return;
    PXM.report("配置画像サイズをリセット", PXM.resetImages());
})();
