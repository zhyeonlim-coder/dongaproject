/* ==========================================================================
   ai/assistant.js — 질문 → 도구 선택 → 실행 → 검증 → 답변  ·  window.GlobalAI

   지금(Phase A)은 규칙이 도구를 고릅니다. 키가 붙으면(Phase B) 모델이
   고릅니다. 바뀌는 것은 route() 하나뿐이고, 실행·검증·표시는 그대로입니다.

     질문 ─→ route()  ─→ AITools.run() ─→ AskVerify ─→ 화면
             ↑ 여기만 Phase B 에서 교체

   ★ 검증되지 않은 숫자를 먼저 보여주지 않습니다.
     수치·표는 도구 실행과 검증이 끝난 뒤에 한 번에 확정 표시합니다.
     해설 문장만 나중에 흘려보냅니다(Phase B). 스트리밍 중에 틀린 숫자가
     잠깐이라도 보이면, 사용자는 그것을 이미 읽습니다.

   ★ 화면을 마음대로 바꾸지 않습니다.
     필터·정렬 같은 조작은 제안만 만들고 사용자가 버튼을 눌러야 실행합니다.
   ========================================================================== */

window.GlobalAI = (function () {
  "use strict";

  const MAX_TURNS = 3;          /* 맥락으로 넘기는 직전 대화 수 */
  const history = [];           /* [{ q, answer, carry, at }] */

  function has(text, t) { return String(text).toLowerCase().indexOf(String(t).toLowerCase()) > -1; }

  /* ── 도구 선택 (Phase A · 규칙) ──────────────────────────────────────
     엔진이 이미 15가지 의도를 읽습니다. 여기서는 "엔진 밖의 일" 만
     갈라내면 됩니다 — 문헌 · DoE · 공정계산 · 화면조작. 나머지는 전부
     엔진에게 넘깁니다. 엔진이 못 읽으면 엔진이 스스로 그렇게 답합니다. */
  const LIT_WORDS = ["논문", "문헌", "paper", "publication", "pubmed", "doi",
                     "저널", "journal", "학술", "레퍼런스", "reference"];
  const DOE_WORDS = ["anova", "분산분석", "회귀", "regression", "최적 조건", "최적조건",
                     "최적화", "optimi", "설계", "doe", "인자", "factor"];
  const CALC_WORDS = ["물질수지", "mass balance", "feed", "seed", "희석", "dilution"];
  const FILTER_WORDS = ["만 보여", "만 조회", "필터", "걸러", "정렬", "sort", "선택해"];

  function route(q, ctx) {
    const t = String(q || "");

    if (LIT_WORDS.some(w => has(t, w))) {
      return { tool: "searchLiterature", args: { query: litQuery(t) } };
    }
    if (DOE_WORDS.some(w => has(t, w))) {
      if (has(t, "anova") || has(t, "분산분석")) return { tool: "runANOVA", args: {} };
      if (has(t, "최적")) return { tool: "optimizeExperiment", args: { goal: has(t, "낮") || has(t, "최소") ? "min" : "max" } };
      if (has(t, "회귀") || has(t, "regression")) return { tool: "runRegression", args: {} };
      /* "인자" · "설계" 만 나온 경우 — DoE 화면이면 설계 요약, 아니면
         데이터 조회로 보냅니다. 엉뚱하게 막지 않기 위해서입니다. */
      if (window.AIContext.allows("runDoE")) return { tool: "runDoE", args: {} };
    }
    if (CALC_WORDS.some(w => has(t, w))) {
      const kind = has(t, "물질수지") || has(t, "mass") ? "massBalance"
        : has(t, "feed") ? "feedVolume"
        : has(t, "seed") ? "seedVolume" : "dilution";
      return { tool: "calculateProcess", args: { kind: kind, input: {} } };
    }
    if (FILTER_WORDS.some(w => has(t, w)) && window.Scope) {
      const patch = filterFromText(t);
      if (patch) return { tool: "proposeFilter", args: { filter: patch } };
    }
    return { tool: "searchExperimentData", args: { question: t } };
  }

  /* 문헌 질의어 — 한국어 조사와 요청 표현을 걷어냅니다 */
  function litQuery(t) {
    return String(t)
      .replace(/관련(된)?|에 (관한|대한)|논문|문헌|찾아\s*줘?|알려\s*줘?|검색(해)?\s*줘?|보여\s*줘?/g, " ")
      .replace(/\s+/g, " ").trim() || t;
  }

  /* "2025년 1월 데이터만 보여줘" → { from, to } */
  function filterFromText(t) {
    const m = String(t).match(/(20\d{2})\s*년\s*(\d{1,2})\s*월/);
    if (m) {
      const y = +m[1], mo = +m[2];
      if (mo < 1 || mo > 12) return null;
      const last = new Date(y, mo, 0).getDate();
      const p = n => String(n).padStart(2, "0");
      return { from: y + "-" + p(mo) + "-01", to: y + "-" + p(mo) + "-" + p(last) };
    }
    return null;
  }

  /* ── 실행 ────────────────────────────────────────────────────────────
     반환은 화면이 그대로 그릴 수 있는 모양입니다. 수치는 이 시점에 이미
     검증을 통과했습니다 — 화면은 검증 여부를 다시 따지지 않아도 됩니다. */
  function ask(q) {
    const question = String(q || "").trim();
    if (!question) {
      return Promise.resolve({ kind: "empty",
        headline: "무엇이 궁금하신지 적어 주세요.",
        suggestions: suggestions() });
    }

    const ctx = window.AIContext.get();
    const plan = route(question, ctx);
    const started = Date.now();

    return window.AITools.run(plan.tool, Object.assign({}, plan.args, {
      prev: history.length ? history[history.length - 1].carry : null
    }), ctx).then(function (res) {
      const out = shape(question, plan, res, ctx, Date.now() - started);
      remember(question, out, res);
      log(question, plan, res, Date.now() - started);
      return out;
    }).catch(function (e) {
      return { kind: "error", tool: plan.tool,
        headline: "답변을 만들지 못했습니다 — " + ((e && e.message) || "알 수 없는 오류"),
        note: "이 오류는 AI 기능에만 영향을 줍니다. 화면의 다른 기능은 그대로 쓰실 수 있습니다.",
        suggestions: suggestions() };
    });
  }

  /* 도구 결과를 화면이 쓰는 모양으로 */
  function shape(question, plan, res, ctx, ms) {
    if (!res.ok) {
      return { kind: "no-data", tool: plan.tool, question: question,
        headline: res.error, meta: res.meta, ms: ms,
        suggestions: suggestions() };
    }
    const d = res.data;

    /* 엔진 응답은 이미 완성된 답입니다 — 그대로 씁니다 */
    if (plan.tool === "searchExperimentData" || plan.tool === "getExperiment" ||
        plan.tool === "calculateStatistics" || plan.tool === "calculateCV") {
      return { kind: "engine", tool: plan.tool, question: question, answer: d,
        meta: res.meta, ms: ms, contextUsed: window.AIContext.describe() };
    }
    return { kind: d.kind || plan.tool, tool: plan.tool, question: question,
      data: d, meta: res.meta, ms: ms, contextUsed: window.AIContext.describe() };
  }

  /* ── 이어지는 질문 ───────────────────────────────────────────────────
     "그 실험의 Yield 는?" 의 "그" 를 풀려면 직전 답이 무엇을 지목했는지
     알아야 합니다. 엔진이 carry 에 그것을 담아 줍니다. */
  function remember(q, out, res) {
    const carry = out.answer && out.answer.carry ? out.answer.carry : null;
    history.push({ q: q, answer: out, carry: carry, at: Date.now() });
    while (history.length > MAX_TURNS) history.shift();
  }
  function reset() { history.length = 0; }

  function log(q, plan, res, ms) {
    if (!window.AskLog || !window.AskLog.record) return;
    try {
      window.AskLog.record({
        question: q, path: "global-ai", kind: plan.tool,
        intent: plan.tool, rows: res.meta && res.meta.rows,
        confidence: null, ms: ms,
        rejected: res.ok ? [] : [String(res.error).slice(0, 80)]
      });
    } catch (e) { /* 로그 실패가 답변을 막지 않습니다 */ }
  }

  /* ── 화면별 추천 질문 ────────────────────────────────────────────────
     문구를 손으로 적지 않습니다. 데이터가 바뀌면 없는 컬럼을 추천하게
     되기 때문입니다 — 실제 컬럼과 배치에서 만듭니다. */
  function suggestions() {
    const c = window.AIContext.get();
    const page = c.page;
    let cols = [], batch = null;
    try {
      const t = window.AskTables.internal();
      cols = t.columns.filter(x => x.type === "num" && !x.generated).map(x => x.label);
      batch = t.rows.length ? t.rows[0].__label : null;
    } catch (e) { /* 데이터 계층이 없는 화면 */ }
    const m1 = cols[0] || "Titer HCCF", m2 = cols[1] || "Max VCD";

    if (page === "hub" && c.section === "doe") {
      return ["ANOVA 결과 설명해줘", "최적 조건 찾아줘",
              "어느 인자가 가장 영향이 커?", "회귀모형 설명해줘"];
    }
    if (page === "hub" && c.section === "lit") {
      return ["EGFR 관련 최근 논문 찾아줘", "이 주제와 비슷한 논문은?",
              "2024년 이후 논문만", "DOI 정리해줘"];
    }
    if (page === "data") {
      return [m1 + " 가장 높은 배치는?", m1 + " 평균이랑 편차",
              "미입력이 가장 많은 항목은?", "과제별 " + m1 + " 비교"];
    }
    if (page === "ebr") {
      return [(batch || "B045-1") + " 알려줘", m1 + " 아직 안 들어온 배치",
              m2 + " 평균", "이 배치가 어느 과제야?"];
    }
    if (page === "schedule" || page === "booking") {
      return ["최근에 시작한 배치는?", m1 + " 평균", "배치 수 알려줘",
              "언제 harvest 했지"];
    }
    return [m1 + " 가장 높은 배치는?", m1 + " 평균이랑 편차",
            "배치 수 알려줘", "미입력이 가장 많은 항목은?"];
  }

  /* ── 제안한 화면 조작을 실제로 적용 ─────────────────────────────────
     사용자가 버튼을 눌렀을 때만 여기 들어옵니다. */
  function applyAction(proposal) {
    if (!proposal || proposal.action !== "filter") return { ok: false, why: "적용할 수 없는 제안입니다." };
    if (!window.Scope || !window.Scope.setFilter) return { ok: false, why: "이 화면에는 필터가 없습니다." };
    try {
      window.Scope.setFilter(proposal.patch);
      return { ok: true };
    } catch (e) {
      return { ok: false, why: "필터를 적용하지 못했습니다 — " + ((e && e.message) || "") };
    }
  }

  return { ask: ask, reset: reset, suggestions: suggestions,
           applyAction: applyAction, history: () => history.slice(),
           _route: route, _filterFromText: filterFromText, _litQuery: litQuery };
})();
