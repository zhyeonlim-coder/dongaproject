/* ==========================================================================
   slot-fixtures.js — 홀드아웃 30문항의 슬롯 고정본  ·  window.SlotFixtures

   ⚠ 이 파일이 무엇인지 정확히 알고 쓰십시오.

   여기 담긴 슬롯은 배포된 /api/extract 를 호출해 받은 것이 아닙니다.
   개발 환경에 ANTHROPIC_API_KEY 가 없어 실제 호출을 할 수 없었기 때문에,
   api/extract.js 와 같은 프롬프트 규칙 · 같은 카탈로그를 놓고 손으로 뽑아
   고정한 것입니다.

   그래서 이 픽스처로 측정되는 것은:
     ✅ 가드 · 실행 · 응답 계층이 슬롯을 제대로 처리하는가 (결정론적)
     ❌ 모델이 이 질문들에서 이런 슬롯을 실제로 뽑아 주는가 (측정 불가)

   두 번째는 키를 넣고 배포한 뒤 다시 재야 합니다. 그 전까지 이 파일의
   점수를 "LLM 경로의 정확도"로 인용하면 안 됩니다.

   쓸모가 남는 이유: 키가 생긴 뒤에도 이 픽스처는 골든 세트로 남습니다.
   실제 모델 출력과 나란히 놓고 어디가 어긋나는지 볼 수 있습니다.
   ========================================================================== */

window.SlotFixtures = (function () {
  "use strict";

  function slot(o) {
    return Object.assign({
      intent: "list",
      target: { type: "metric", keys: [] },
      filters: {
        dateRange: { field: null, from: null, to: null },
        projectIds: [], studyIds: [], batchIds: [], team: null,
        conditions: [], exclude: []
      },
      sortBy: { field: null, order: "desc" },
      limit: null,
      qualitativeBasis: null,
      refersToPrevious: false,
      confidence: 0.8,
      unhandled: []
    }, o);
  }
  function f(o) { return { dateRange: { field: null, from: null, to: null },
    projectIds: [], studyIds: [], batchIds: [], team: null, conditions: [], exclude: [] , ...o }; }

  const B123 = ["B123-1","B123-2","B123-3","B123-4","B123-5","B123-6",
                "B123-7","B123-8","B123-9","B123-10","B123-11","B123-12"];

  /* 질문 → 슬롯. 카탈로그의 key 만 씁니다. */
  const FIX = {
    /* ── 구어체 · 간접 표현 ───────────────────────────────────────────── */
    "이번에 제일 잘 나온 배치가 뭐야": slot({
      intent: "max", qualitativeBasis: "제일 잘 나온", confidence: 0.72,
      unhandled: ["이번에 — 어느 기간인지 특정되지 않았습니다"] }),

    "타이터 젤 높은 게 얼마였지": slot({
      intent: "max", target: { type: "metric", keys: ["titerHCCF"] }, confidence: 0.92 }),

    "B123 애들 수율 어땠어": slot({
      intent: "stat", target: { type: "metric", keys: ["downstream_totalYield"] },
      filters: f({ batchIds: B123 }), confidence: 0.74 }),

    "제일 안 좋았던 배치는": slot({
      intent: "min", qualitativeBasis: "제일 안 좋았던", confidence: 0.7 }),

    "요즘 수율 올라가고 있어?": slot({
      intent: "unsupported", target: { type: "metric", keys: ["downstream_totalYield"] },
      confidence: 0.8,
      unhandled: ["요즘 수율 올라가고 있어? — 달력 시간에 따른 추세"] }),

    "DA-4321 상황 좀 알려줘": slot({
      intent: "list", target: { type: "entity", keys: [] },
      filters: f({ projectIds: ["DA-4321"] }), confidence: 0.68,
      unhandled: ["\"상황\" 이 어떤 항목을 뜻하는지 특정하지 못했습니다"] }),

    "제일 최근에 한 실험이 뭐야": slot({
      intent: "list", target: { type: "entity", keys: [] },
      sortBy: { field: "date", order: "desc" }, limit: 1, confidence: 0.82 }),

    /* ── 조건 · 필터 ─────────────────────────────────────────────────── */
    "생존율 90 밑으로 떨어진 배치 있나": slot({
      intent: "list", target: { type: "metric", keys: ["finalViability"] },
      filters: f({ conditions: [{ field: "finalViability", op: "lt", value: 90, unit: null }] }),
      confidence: 0.9 }),

    "Total yield 80 넘는 거만": slot({
      intent: "list", target: { type: "metric", keys: ["downstream_totalYield"] },
      filters: f({ conditions: [{ field: "downstream_totalYield", op: "gt", value: 80, unit: null }] }),
      confidence: 0.92 }),

    "viability 87 이상인 것만 골라줘": slot({
      intent: "list", target: { type: "metric", keys: ["finalViability"] },
      filters: f({ conditions: [{ field: "finalViability", op: "gte", value: 87, unit: null }] }),
      confidence: 0.92 }),

    "LMW 값 있는 배치 알려줘": slot({
      intent: "list", target: { type: "metric", keys: ["seHPLC_lmw"] },
      filters: f({ exclude: ["미입력"] }), confidence: 0.85 }),

    "배양 며칠 걸렸어": slot({
      intent: "stat", target: { type: "metric", keys: ["cultureDays"] }, confidence: 0.86 }),

    /* ── 집계 · 비교 ─────────────────────────────────────────────────── */
    "정제 수율 평균이 얼마나 돼": slot({
      intent: "stat", target: { type: "metric", keys: ["downstream_totalYield"] }, confidence: 0.9 }),

    "HCP 제일 낮은 조건이 뭐였지": slot({
      intent: "min", target: { type: "metric", keys: ["downstream_hcp"] }, confidence: 0.88 }),

    "배치 몇 개나 돌렸어": slot({
      intent: "count", target: { type: "entity", keys: [] }, confidence: 0.9 }),

    "미디어 스크리닝이랑 DOE 중에 뭐가 더 잘 나왔어": slot({
      intent: "compare", target: { type: "metric", keys: ["titerHCCF"] },
      filters: f({ studyIds: ["Media screening test", "DoE test"] }),
      qualitativeBasis: "더 잘 나왔어", confidence: 0.72 }),

    "12월 데이터랑 11월 데이터 비교해줘": slot({
      intent: "compare", target: { type: "metric", keys: [] },
      filters: f({ dateRange: { field: "date", from: "2024-11-01", to: "2024-12-31" } }),
      confidence: 0.62,
      unhandled: ["두 기간을 각각 나눠 비교하는 형태는 아직 지원하지 않아 11~12월을 한 구간으로 묶었습니다"] }),

    "세포 농도 최고치가 어디야": slot({
      intent: "max", target: { type: "metric", keys: ["maxVCD"] }, confidence: 0.84 }),

    /* ── 기간 ────────────────────────────────────────────────────────── */
    "8월에 돌린 거 결과 어때": slot({
      intent: "list", target: { type: "entity", keys: [] },
      filters: f({ dateRange: { field: "date", from: "2024-08-01", to: "2024-08-31" } }),
      confidence: 0.8 }),

    "작년 하반기 titer 어땠어": slot({
      intent: "stat", target: { type: "metric", keys: ["titerHCCF"] },
      filters: f({ dateRange: { field: "date", from: "2024-07-01", to: "2024-12-31" } }),
      confidence: 0.66,
      unhandled: ["\"작년\" 은 오늘 날짜 기준이라 데이터 보유 구간(2024-08-16~2025-01-09)의 2024년 하반기로 읽었습니다"] }),

    "언제 harvest 했지": slot({
      intent: "list", target: { type: "date", keys: ["endDate"] }, confidence: 0.85 }),

    /* ── 메타 ────────────────────────────────────────────────────────── */
    "데이터 빠진 데 많아?": slot({
      intent: "missing", target: { type: "metric", keys: [] }, confidence: 0.88 }),

    "스터디 몇 개 있어": slot({
      intent: "meta", target: { type: "meta", keys: [] }, confidence: 0.86 }),

    "어떤 과제들이 있어": slot({
      intent: "meta", target: { type: "meta", keys: [] }, confidence: 0.9 }),

    "Media screening 결과 요약해줘": slot({
      intent: "list", target: { type: "entity", keys: [] },
      filters: f({ studyIds: ["Media screening test"] }), confidence: 0.82 }),

    /* ── 맥락 ────────────────────────────────────────────────────────── */
    "아까 그 배치 수율은?": slot({
      intent: "list", target: { type: "metric", keys: ["downstream_totalYield"] },
      refersToPrevious: true, confidence: 0.85 }),

    "그 중에 제일 높은 건?": slot({
      intent: "max", target: { type: "metric", keys: [] },
      refersToPrevious: true, confidence: 0.7,
      unhandled: ["어느 항목 기준으로 가장 높은지는 앞 질문에서 이어받았습니다"] }),

    /* ── 미지원 ──────────────────────────────────────────────────────── */
    "titer랑 yield 상관관계 있어?": slot({
      intent: "unsupported", confidence: 0.9,
      unhandled: ["titer 와 yield 의 상관관계 분석"] }),

    "다음 배치는 어떻게 하는 게 좋을까": slot({
      intent: "unsupported", confidence: 0.9,
      unhandled: ["다음 배치 조건 추천 · 예측"] }),

    "이 배치 왜 실패했어?": slot({
      intent: "unsupported", refersToPrevious: true, confidence: 0.88,
      unhandled: ["왜 실패했는지 — 원인 분석"] })
  };

  function get(q) { return FIX[String(q || "").trim()] || null; }
  function questions() { return Object.keys(FIX); }

  return { get: get, questions: questions, FIX: FIX };
})();
