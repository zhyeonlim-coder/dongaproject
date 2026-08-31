/* ==========================================================================
   catalog.js — 스키마 카탈로그  ·  window.Catalog

   LLM 슬롯 추출기에 매번 주입하는 "이 데이터셋이 무엇인지" 설명서입니다.
   전부 데이터에서 계산합니다. 목록을 코드에 적어 두면 원본이 바뀔 때
   모델만 옛날 이야기를 하게 됩니다.

   값 자체는 넣지 않습니다. 넣는 것은 컬럼 이름 · 단위 · 값의 범위 ·
   기록 건수뿐입니다. 모델이 실제 측정값을 볼 수 없으므로 수치를 지어낼
   수도 없습니다. 범위(min/max)는 단위 대조에 반드시 필요해서 넣습니다 —
   "Titer 3" 이 mg/L 인지 g/L 인지는 실측 범위를 봐야 판단됩니다.
   ========================================================================== */

window.Catalog = (function () {
  "use strict";

  /* 지금 못 하는 것들. 모델이 이걸 알아야 "못 한다"고 정직하게 분류합니다. */
  const UNSUPPORTED = [
    { id: "spec-judgement", ko: "규격 판정(Pass/Fail)",
      why: "항목별 규격 한계값 테이블이 아직 등록되지 않았습니다",
      instead: "해당 항목의 값 분포(평균 · 범위 · 최고 · 최저)는 보여 드릴 수 있습니다" },
    { id: "root-cause", ko: "원인 분석(\"왜 낮았지?\")",
      why: "값 조회만 하며 인과를 추론하지 않습니다",
      instead: "해당 배치의 기록된 값 전체와 같은 범위의 다른 배치를 나란히 보여 드릴 수 있습니다" },
    { id: "correlation", ko: "상관분석 · 회귀",
      why: "AI 검색에는 상관계수 계산이 없습니다",
      instead: "DoE & Intelligence 탭의 회귀 · ANOVA 를 쓰시거나, 두 항목의 값을 각각 조회하실 수 있습니다" },
    { id: "time-trend", ko: "달력 시간에 따른 추세(\"요즘 올라가고 있어?\")",
      why: "추이는 배양 경과일(D10~D20) 축으로만 계산하며, 날짜축 회귀는 하지 않습니다",
      instead: "기간을 나눠 각각의 평균을 조회해 비교하실 수 있습니다 (예: \"12월 수율 평균\", \"11월 수율 평균\")" },
    { id: "prediction", ko: "예측 · 추천(\"다음엔 어떻게 할까\")",
      why: "기록된 값만 다루며 미래 조건을 제안하지 않습니다",
      instead: "지금까지 값이 가장 높았던 조건의 기록을 보여 드릴 수 있습니다" }
  ];

  const INTENTS = [
    { id: "max",     ko: "최고값" },
    { id: "min",     ko: "최저값" },
    { id: "stat",    ko: "평균 · 중앙값 · 표준편차 · 분포" },
    { id: "trend",   ko: "일자별 추이 (배양 경과일 D10~D20)" },
    { id: "compare", ko: "과제별 · Study별 비교" },
    { id: "count",   ko: "건수" },
    { id: "missing", ko: "미입력(결측) 현황" },
    { id: "list",    ko: "조건에 맞는 목록" },
    { id: "meta",    ko: "데이터셋 요약(기간 · 건수 · 과제 목록)" },
    { id: "help",    ko: "사용법 · 물어볼 수 있는 것" }
  ];

  function build(table) {
    const t = table || window.AskTables.internal();
    const U = window.Units;

    const columns = t.columns
      .filter(c => c.type === "num")
      .map(function (c) {
        const rg = U ? U.observedRange(t.rows, c.key) : null;
        const recorded = t.rows.filter(r => typeof r[c.key] === "number" && isFinite(r[c.key])).length;
        return {
          key: c.key,
          labels: labelsFor(c),
          unit: c.unit || null,
          team: c.team || null,
          group: c.groupLabel || c.group || null,
          min: rg ? rg.min : null,
          max: rg ? rg.max : null,
          recordedCount: recorded,
          nullCount: t.rows.length - recorded
        };
      });

    const dateCols = t.columns.filter(c => c.type === "date")
      .map(c => ({ key: c.key, labels: [c.label], type: "date" }));

    const ds = t.rows.map(r => r.date).filter(Boolean).sort();
    const projects = {}, studies = {};
    t.rows.forEach(function (r) {
      if (r.project) projects[r.project] = (projects[r.project] || 0) + 1;
      if (r.study) studies[r.study] = (studies[r.study] || 0) + 1;
    });

    return {
      rowCount: t.rows.length,
      dateRange: ds.length ? { from: ds[0], to: ds[ds.length - 1] } : { from: null, to: null },
      dateFields: dateCols,
      columns: columns,
      /* 미기록 항목도 알려 줍니다 — 모델이 "있는 척" 하지 않도록 */
      notRecorded: (window.AskEngine && window.AskEngine.NOT_RECORDED
        ? window.AskEngine.NOT_RECORDED.map(x => x.ko) : []),
      projects: Object.keys(projects).map(p => ({ code: p, batchCount: projects[p] })),
      studies: Object.keys(studies).map(function (s) {
        const row = t.rows.find(r => r.study === s);
        return { name: s, project: row ? row.project : null, batchCount: studies[s] };
      }),
      batchIds: t.rows.map(r => r.__label),
      teams: (window.DATA_TEAMS || []).map(x => ({ id: x.id, ko: x.ko })),
      supportedIntents: INTENTS,
      unsupportedFeatures: UNSUPPORTED
    };
  }

  /* 컬럼을 부르는 여러 이름 — 규칙 사전(ALIAS)에 있는 표현을 그대로 넘겨
     모델이 "역가 = titerHCCF" 같은 대응을 알 수 있게 합니다. */
  function labelsFor(col) {
    const out = [col.label];
    const A = window.AskEngine && window.AskEngine.ALIAS;
    if (A && A[col.key]) A[col.key].forEach(x => { if (out.indexOf(x) === -1) out.push(x); });
    return out;
  }

  /* 카탈로그가 바뀌면 캐시를 버려야 합니다 */
  function hash(cat) {
    const s = JSON.stringify(cat);
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return String(h);
  }

  let cache = null, cacheFor = null;
  function get(table) {
    const t = table || window.AskTables.internal();
    if (cache && cacheFor === t) return cache;
    cache = build(t); cacheFor = t;
    return cache;
  }
  function invalidate() { cache = null; cacheFor = null; }

  return { build: build, get: get, hash: hash, invalidate: invalidate,
           UNSUPPORTED: UNSUPPORTED, INTENTS: INTENTS };
})();
