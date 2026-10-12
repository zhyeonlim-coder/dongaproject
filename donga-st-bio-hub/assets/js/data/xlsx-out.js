/* ==========================================================================
   XlsxOut — 엑셀 파일을 만드는 **한 곳**

   조회 표 · 그래프 화면 · DoE 분석이 각자 워크북을 만들면, 숫자 타입이나
   고지 시트, CSV 폴백이 한쪽에만 붙는 날이 옵니다. 받는 사람은 어느
   파일이 온전한지 알 수 없습니다 — 그래서 만드는 자리를 하나로 둡니다.

   엑셀 라이브러리(SheetJS)는 AskTables.loadXLSX 가 필요할 때 CDN 에서
   한 번만 받아 옵니다. 사내망에서 그 CDN 이 막히면 **내보내기 자체가
   실패하는 대신** CSV 로 내려갑니다 — 파일을 못 받는 것이 가장 나쁩니다.

   write(sheets, base, opts)
     sheets : [{ name, aoa, cols? }]  — 첫 시트에 머리글 고정
     base   : 확장자 없는 파일 이름
     opts   : { onDone(kind), onFallback(why), csv }
              csv 를 주면 폴백 때 그 글자를 그대로 씁니다 (고지 줄이 붙은
              CSV 처럼, 첫 시트를 그대로 옮기면 안 되는 경우).
   ========================================================================== */

window.XlsxOut = (function () {
  "use strict";

  function saveBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* 엑셀이 여는 CSV — BOM 을 붙여야 한글이 깨지지 않습니다 */
  function csvOf(aoa) {
    const q = v => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return (aoa || []).map(r => r.map(q).join(",")).join("\r\n");
  }

  /* 컬럼 너비 — 글자 수에 맞춥니다. 기본값이면 머리글이 "####" 로 잘려
     나와, 받는 사람이 매번 폭을 늘려야 합니다. */
  function widthsOf(aoa) {
    const head = aoa[0] || [];
    return head.map(function (h, ci) {
      let w = String(h === null || h === undefined ? "" : h).length;
      for (let r = 1; r < aoa.length; r++) {
        const v = (aoa[r] || [])[ci];
        const n = String(v === null || v === undefined ? "" : v).length;
        if (n > w) w = n;
      }
      return { wch: Math.min(Math.max(w + 2, 8), 46) };
    });
  }

  function write(sheets, base, opts) {
    const o = opts || {};
    /* 파일을 내려보내는 자리를 바꿔 끼울 수 있게 둡니다 — 검사에서 실제
       다운로드를 일으키지 않고 무엇이 나갈지 확인하기 위해서입니다. */
    const save = typeof o.save === "function" ? o.save : saveBlob;
    const list = (sheets || []).filter(s => s && s.aoa && s.aoa.length);
    if (!list.length) { if (o.onFallback) o.onFallback("내보낼 내용 없음"); return; }

    function fallback(why) {
      const text = o.csv !== undefined && o.csv !== null ? o.csv : csvOf(list[0].aoa);
      save(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8;" }), base + ".csv");
      if (o.onFallback) o.onFallback(why);
    }

    if (!window.AskTables || !window.AskTables.loadXLSX) { fallback("엑셀 모듈 없음"); return; }

    window.AskTables.loadXLSX().then(function (XLSX) {
      const wb = XLSX.utils.book_new();
      list.forEach(function (s, i) {
        const ws = XLSX.utils.aoa_to_sheet(s.aoa);
        ws["!cols"] = s.cols || widthsOf(s.aoa);
        /* 머리글 고정 — 수백 행을 내려도 무엇의 값인지 보입니다 */
        if (i === 0) ws["!freeze"] = { xSplit: 0, ySplit: 1 };
        /* 시트 이름은 31자까지입니다. 넘치면 엑셀이 파일을 열지 못합니다. */
        XLSX.utils.book_append_sheet(wb, ws, String(s.name || ("시트" + (i + 1))).slice(0, 31));
      });
      const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      save(new Blob([out], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      }), base + ".xlsx");
      if (o.onDone) o.onDone("엑셀");
    }).catch(function (e) { fallback((e && e.message) ? "네트워크" : ""); });
  }

  return { write: write, saveBlob: saveBlob, csvOf: csvOf };
})();
