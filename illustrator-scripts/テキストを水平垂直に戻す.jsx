// テキストを水平垂直に戻す
// 回転したテキストを、横組みは水平に、縦組みは垂直に、アンカーポイントを中心に回転して戻す。
#target illustrator
#include "lib/mapping_core.jsxinc"

(function () {
    if (app.documents.length === 0) return;
    PXM.report("テキストを水平垂直に戻す", PXM.straightenTexts());
})();
