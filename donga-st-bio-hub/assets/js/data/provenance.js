/* ==========================================================================
   provenance.js — 데이터 출처와 품질 표시  ·  window.Provenance

   왜 필요한가
     원본 Batch_Data_example.xlsx 의 "비고(Notes)" 시트에 작성자가 이렇게
     적어 두었습니다.

       "스캔 화질로 인한 판독 오차 가능성이 있으므로 중요한 수치는
        원본과 한 번 대조 확인 권장"

     이 데이터는 스캔 이미지 5장을 사람이 전사한 것입니다. 그런데 그 사실이
     검색 응답 어디에도 나타나지 않았습니다. 규제 문서에 수치를 인용하기
     전에 반드시 알아야 하는 정보라, 수치가 들어가는 모든 응답에 한 줄로
     붙입니다.

     아래 내용은 전부 원본 Notes 시트에서 그대로 옮긴 것입니다. 지어낸
     문장이 없습니다.
   ========================================================================== */

window.Provenance = (function () {
  "use strict";

  const SOURCE = {
    file: "Batch_Data_example.xlsx",
    sheet: "Batch Data",
    rows: 28,
    origin: "사용자가 제공한 스캔 이미지 5장 (스캔 문서 2026.7.27 19:34:59, 1/6~6/6)",
    method: "스캔 이미지 → 사람이 전사 → TSV → 스크립트 자동 변환 (수기 재입력 없음)",
    loadedAs: "정적 변환본 (assets/js/data/batches.js)"
  };

  /* 원본 Notes 시트 그대로 */
  const NOTES = [
    { k: "출처", v: SOURCE.origin },
    { k: "총 행 수", v: "28행 (Study 1 + B045 5 + B123 12 + B321 10)" },
    { k: "행 정렬 검증", v: "qP ≈ Titer HCCF ÷ IVCD, 그리고 Titer HCCF = Titer D14 값으로 이미지 간 행 매칭을 교차 검증함" },
    { k: "빈 칸", v: "원본에서 값이 비어 있던 셀은 그대로 비워 둠 (예: B123-1의 날짜/VCD/Titer D10~D14)" },
    { k: "N/A", v: "원본에 N/A로 표기된 셀은 텍스트 'N/A' 그대로 입력" },
    { k: "'-' 표기", v: "Titer D15~D20 열은 원본 전체 행이 '-' 로 표기되어 있어 그대로 입력" },
    { k: "Final Viability", v: "원본은 % 표기(예: 59.7%). 엑셀에는 0.597 로 저장되어 있어 ×100 하여 % 로 씀" },
    { k: "첫 행 'Study'", v: "원본 첫 행의 좌측 셀에 'Study'라고만 적혀 있고 Exp. No.가 비어 있어 그대로 옮김 (UNSPEC-01)" },
    { k: "N-glycan / CE-SDS", v: "원본(6/6 페이지)에서 Study 및 B045-1~5 행은 비어 있어 공란 처리, B123-1부터 값이 시작됨" },
    { k: "⚠ 주의", v: "스캔 화질로 인한 판독 오차 가능성이 있으므로 중요한 수치는 원본과 한 번 대조 확인 권장" }
  ];

  /* 수치가 들어가는 모든 응답에 붙는 한 줄 */
  const LINE = "출처: " + SOURCE.file + " — 스캔 이미지 전사본입니다. " +
    "원본 비고에 \"스캔 화질로 인한 판독 오차 가능성\"이 명시되어 있어, " +
    "중요한 수치는 원본과 대조 확인이 필요합니다.";

  /* ── 생성값 컬럼 ──────────────────────────────────────────────────────
     원본에 컬럼 자체가 없어 downstream.js 가 만들어 넣는 항목입니다.
     실측이 아니므로 통계에서 빼거나, 넣는다면 반드시 그렇다고 말해야 합니다. */
  const GENERATED_GROUP = "downstream";
  const GENERATED_WHY =
    "원본 Excel 에 정제 공정 컬럼이 전혀 없어, 정제공정팀 화면을 구성하려고 " +
    "배치 ID 해시를 시드로 생성한 값입니다 (결정론적이라 새로고침해도 같습니다). " +
    "실측이 아닙니다.";

  function isGeneratedColumn(col) {
    return !!col && col.group === GENERATED_GROUP;
  }

  /* ── 검증 필요 블록 탐지 ──────────────────────────────────────────────
     여러 배치가 여러 항목에서 한꺼번에 완전히 같은 값을 가지면, 서로 다른
     시료를 각각 측정한 결과로 보기 어렵습니다. 원본이 스캔 전사본이라
     전사 과정에서 한 행이 복제됐을 가능성을 배제할 수 없습니다.

     지우지 않습니다. "검증 필요"로 표시하고 통계에서만 빼며, 몇 건을 뺐는지
     항상 밝힙니다. 원본 스캔과 대조하기 전까지의 잠정 조치입니다. */
  const MIN_ROWS = 3;      /* 3개 배치 이상이 */
  const MIN_COLS = 3;      /* 한 지표군의 3개 항목 이상에서 동시에 같으면 */

  /* 지표군(N-glycan · CE-SDS R …) 단위로 봅니다.

     행 전체를 한 서명으로 묶으면 안 됩니다 — 문제의 7개 배치는 Titer · VCD
     같은 다른 항목에서는 값이 서로 달라서, 행 전체로는 묶이지 않고 탐지에
     걸리지 않습니다. 실제로 겹치는 것은 "한 지표군 전체가 통째로 같은" 형태라
     그 단위로 찾습니다. */
  function detectUnverified(rows, columns) {
    const byGroup = {};
    columns.forEach(function (c) {
      if (c.type !== "num" || isGeneratedColumn(c) || !c.group || c.group === "base") return;
      (byGroup[c.group] = byGroup[c.group] || []).push(c.key);
    });

    const flagged = [];
    Object.keys(byGroup).forEach(function (gid) {
      const keys = byGroup[gid];
      if (keys.length < MIN_COLS) return;
      const sigs = {};
      rows.forEach(function (r) {
        const present = keys.filter(k => typeof r[k] === "number" && isFinite(r[k]));
        if (present.length < MIN_COLS) return;
        const sig = present.map(k => k + "=" + r[k]).join("|");
        (sigs[sig] = sigs[sig] || []).push(r);
      });
      Object.keys(sigs).forEach(function (sig) {
        const g = sigs[sig];
        if (g.length < MIN_ROWS) return;
        const hit = sig.split("|").map(x => x.split("=")[0]);
        g.forEach(function (r) {
          r.__unverified = r.__unverified || {};
          hit.forEach(k => { r.__unverified[k] = true; });
        });
        flagged.push({ group: gid, rows: g.map(r => r.__label), keys: hit, count: g.length });
      });
    });
    /* 한 배치가 두 개 이상의 지표군에서 통째로 겹치면, 항목 수가 적어
       단독으로는 걸리지 않은 작은 지표군(예: CE-SDS NR 2항목)도 같은 원인일
       가능성이 큽니다. 같은 배치인데 어떤 항목은 표시되고 어떤 항목은 안
       되면 읽는 사람이 더 헷갈립니다 — 범위를 맞춰 줍니다. */
    const hitCount = {};
    flagged.forEach(f => f.rows.forEach(l => { hitCount[l] = (hitCount[l] || 0) + 1; }));
    const spread = Object.keys(hitCount).filter(l => hitCount[l] >= 2);
    if (spread.length) {
      const smallGroups = Object.keys(byGroup).filter(g => byGroup[g].length < MIN_COLS);
      smallGroups.forEach(function (gid) {
        const keys = byGroup[gid];
        const targets = rows.filter(function (r) {
          if (spread.indexOf(r.__label) === -1) return false;
          return keys.some(k => typeof r[k] === "number" && isFinite(r[k]));
        });
        /* 그 작은 지표군에서도 값이 실제로 서로 같을 때만 */
        const sigs = {};
        targets.forEach(function (r) {
          const sig = keys.map(k => r[k]).join("|");
          (sigs[sig] = sigs[sig] || []).push(r);
        });
        Object.keys(sigs).forEach(function (sig) {
          const g = sigs[sig];
          if (g.length < MIN_ROWS) return;
          g.forEach(function (r) {
            r.__unverified = r.__unverified || {};
            keys.forEach(k => { if (typeof r[k] === "number") r.__unverified[k] = true; });
          });
          flagged.push({ group: gid, rows: g.map(r => r.__label), keys: keys,
                         count: g.length, viaSpread: true });
        });
      });
    }
    return flagged;
  }

  /* 이 컬럼에서 검증 필요로 표시된 행 수 */
  function unverifiedCount(rows, key) {
    return rows.filter(r => r.__unverified && r.__unverified[key] &&
      typeof r[key] === "number" && isFinite(r[key])).length;
  }
  function isUnverified(row, key) {
    return !!(row && row.__unverified && row.__unverified[key]);
  }

  return {
    SOURCE: SOURCE, NOTES: NOTES, LINE: LINE,
    GENERATED_WHY: GENERATED_WHY, GENERATED_GROUP: GENERATED_GROUP,
    isGeneratedColumn: isGeneratedColumn,
    detectUnverified: detectUnverified,
    unverifiedCount: unverifiedCount, isUnverified: isUnverified,
    MIN_ROWS: MIN_ROWS, MIN_COLS: MIN_COLS
  };
})();
