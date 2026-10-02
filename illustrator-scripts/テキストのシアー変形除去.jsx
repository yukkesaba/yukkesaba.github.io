// テキストのシアー変形除去
// 回転・拡大縮小と文字位置（アンカーポイント）はそのままに、シアー成分だけを取り除く。
// パス上テキストは、載っているパスの形を保ったまま文字のシアーだけを除去する。
#target illustrator
#include "mapping_core.jsxinc"

(function () {
    if (app.documents.length === 0) return;
    PXM.report("テキストのシアー変形除去", PXM.unshearTexts());
})();
