/* ==========================================================================
   asklog.js — 질의 로그 · 자가 개선  ·  window.AskLog

   무엇을 기록하는가
     · 규칙이 놓쳐 LLM 으로 넘어간 질문 (원문 + 뽑힌 슬롯)
     · confidence 가 낮았던 질문 · 결과 0건 · unsupported · 되묻기
     · 사용자가 되묻기에 답하지 않고 다시 던진 문장

   왜 기록하는가
     LLM 이 성공적으로 해석한 표현은 규칙 사전에 넣을 후보입니다.
     "제일 잘 나온" 이 max 트리거에 들어가면, 다음부터는 LLM 없이 즉시
     답합니다. 이 루프가 있어야 시간이 갈수록 호출이 줄고 빨라집니다.

   저장은 localStorage 입니다 (hub.asklog.v1). 다른 기록과 같은 규칙으로
   내보내기 · 가져오기에 포함됩니다.
   ========================================================================== */

window.AskLog = (function () {
  "use strict";

  const KEY = "hub.asklog.v1";
  const MAX = 500;
  let state = load();
  const subs = [];

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      const p = raw ? JSON.parse(raw) : null;
      if (p && Array.isArray(p.list)) { p.counts = p.counts || blank(); return p; }
    } catch (e) { /* 손상된 값은 새로 시작합니다 */ }
    return { list: [], approved: [], counts: blank() };
  }
  /* 지표는 문제 사례와 따로 셉니다 — 잘 처리된 조회도 세야 비율이 나옵니다 */
  function blank() {
    return { total: 0, rule: 0, llm: 0, fallback: 0, rejected: 0,
             clarify: 0, unsupported: 0, zero: 0, bothFailed: 0,
             narrateBlocked: 0, resultBlocked: 0, specNone: 0,
             requery: 0, choicePicked: 0, totalMs: 0, llmMs: 0, llmCalls: 0 };
  }
  /* 일별 집계 — 파일럿 대시보드가 추이를 그리려면 날짜별로 나눠야 합니다.
     개인정보는 담지 않습니다. 질문 원문과 사번 단위 식별자까지만입니다. */
  function today() {
    const d = new Date(), p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function dayBucket() {
    const k = today();
    state.days = state.days || {};
    if (!state.days[k]) state.days[k] = { total: 0, rule: 0, llm: 0, fallback: 0,
      clarify: 0, requery: 0, zero: 0, unsupported: 0, blocked: 0, ms: 0 };
    return state.days[k];
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 저장 실패는 조회를 막지 않습니다 */ }
    subs.forEach(f => f(state));
  }
  function on(f) { subs.push(f); return () => { const i = subs.indexOf(f); if (i > -1) subs.splice(i, 1); }; }

  /* 한 번의 조회를 기록합니다.

     두 갈래로 나눠 둡니다.
       · counts — 모든 조회를 셉니다. 규칙 경로 비율을 보려면 성공한 조회도
                  세어야 합니다. 예전에는 문제 사례만 기록해서 "루프가 도는지"
                  자체를 측정할 수 없었습니다.
       · list   — 문제 사례만. 승격 후보를 여기서 찾습니다. */
  function tally(entry) {
    const c = state.counts;
    c.total += 1;
    if (typeof entry.ms === "number") c.totalMs += entry.ms;
    if (typeof entry.llmMs === "number" && entry.llmMs > 0) { c.llmMs += entry.llmMs; c.llmCalls += 1; }

    if (entry.path === "rule") c.rule += 1;
    else if (entry.path === "llm") c.llm += 1;
    else if (entry.path === "rule-fallback") { c.fallback += 1; c.bothFailed += 1; }
    else if (entry.path === "llm-rejected") c.rejected += 1;
    else if (entry.path === "narrate-blocked") c.narrateBlocked += 1;

    if (entry.path === "result-blocked") c.resultBlocked += 1;
    if (entry.kind === "clarify") c.clarify += 1;
    if (entry.kind === "unsupported") c.unsupported += 1;
    if (entry.kind === "spec-none") c.specNone += 1;
    if (entry.rows === 0) c.zero += 1;
    if (entry.repeatedAfterClarify) c.requery += 1;
    if (entry.choicePicked) c.choicePicked += 1;

    const d = dayBucket();
    d.total += 1;
    if (typeof entry.ms === "number") d.ms += entry.ms;
    if (entry.path === "rule") d.rule += 1;
    else if (entry.path === "llm") d.llm += 1;
    else if (entry.path === "rule-fallback") d.fallback += 1;
    if (entry.kind === "clarify") d.clarify += 1;
    if (entry.kind === "unsupported" || entry.kind === "spec-none") d.unsupported += 1;
    if (entry.rows === 0) d.zero += 1;
    if (entry.path === "result-blocked" || entry.path === "narrate-blocked") d.blocked += 1;
  }

  /* 최근 N일 집계 — 파일럿 리포트가 씁니다 */
  function daily(n) {
    const days = state.days || {};
    return Object.keys(days).sort().slice(-(n || 14)).map(function (k) {
      const d = days[k];
      return Object.assign({ date: k,
        rulePct: d.total ? Math.round(d.rule / d.total * 1000) / 10 : null,
        avgMs: d.total ? Math.round(d.ms / d.total * 100) / 100 : null }, d);
    });
  }

  /* 상시 표시용 지표 */
  function metrics() {
    const c = state.counts;
    const n = c.total || 0;
    return {
      total: n,
      rule: c.rule, llm: c.llm, fallback: c.fallback, rejected: c.rejected,
      rulePct: n ? Math.round(c.rule / n * 1000) / 10 : null,
      llmPct: n ? Math.round((c.llm + c.fallback + c.rejected) / n * 1000) / 10 : null,
      llmCalls: c.llmCalls,
      avgMs: n ? Math.round(c.totalMs / n * 100) / 100 : null,
      avgLlmMs: c.llmCalls ? Math.round(c.llmMs / c.llmCalls) : null,
      clarify: c.clarify, unsupported: c.unsupported, zero: c.zero,
      bothFailed: c.bothFailed, narrateBlocked: c.narrateBlocked,
      requery: c.requery, choicePicked: c.choicePicked
    };
  }

  function resetCounts() { state.counts = blank(); save(); }

  /* ── 2주 리포트 ──────────────────────────────────────────────────────
     파일럿이 끝나면 세 가지를 봅니다.
       1) 실제 질문이 어떤 유형이었나 — 우리가 예상한 분포와 얼마나 다른가
       2) 규칙 경로 비율이 올라갔나 — 승격 루프가 도는지의 유일한 증거
       3) 실패 · 재질문이 몰린 질문 — 다음에 무엇을 고쳐야 하는가 */
  function report(days) {
    const n = days || 14;
    const d = daily(n);
    const first = d.length ? d[0] : null;
    const last = d.length ? d[d.length - 1] : null;

    /* 질문 유형 분포 — 기록된 의도 기준 */
    const byIntent = {};
    state.list.forEach(function (e) {
      const k = e.intent || e.kind || "(미분류)";
      byIntent[k] = (byIntent[k] || 0) + (e.count || 1);
    });

    /* 실패 · 재질문이 몰린 질문 */
    const trouble = state.list.slice().filter(function (e) {
      return e.reasons.some(r => /즉시 재질문|LLM 폴백|결과 0건|미지원|가드 거절|차단/.test(r));
    }).sort((a, b) => (b.count || 1) - (a.count || 1)).slice(0, 20);

    const sum = d.reduce(function (a, x) {
      a.total += x.total; a.rule += x.rule; a.clarify += x.clarify;
      a.requery += x.requery; a.zero += x.zero; a.ms += x.ms;
      return a;
    }, { total: 0, rule: 0, clarify: 0, requery: 0, zero: 0, ms: 0 });

    return {
      days: d, from: first ? first.date : null, to: last ? last.date : null,
      total: sum.total,
      rulePct: sum.total ? Math.round(sum.rule / sum.total * 1000) / 10 : null,
      rulePctFirst: first ? first.rulePct : null,
      rulePctLast: last ? last.rulePct : null,
      clarifyPct: sum.total ? Math.round(sum.clarify / sum.total * 1000) / 10 : null,
      requeryPct: sum.total ? Math.round(state.counts.requery / sum.total * 1000) / 10 : null,
      zeroPct: sum.total ? Math.round(sum.zero / sum.total * 1000) / 10 : null,
      avgMs: sum.total ? Math.round(sum.ms / sum.total * 100) / 100 : null,
      byIntent: Object.keys(byIntent).map(k => ({ intent: k, n: byIntent[k] }))
        .sort((a, b) => b.n - a.n),
      trouble: trouble,
      pendingPromotions: (window.Promote ? window.Promote.suggestions().length : 0)
    };
  }

  /* 되묻기에서 사용자가 어느 쪽을 골랐는지 */
  function recordChoice(question, label) {
    const q = String(question || "").trim();
    const found = state.list.find(x => x.question === q);
    if (found) {
      found.choice = label;
      found.reasons = Array.from(new Set(found.reasons.concat(["되묻기 선택함"])));
    }
    state.counts.choicePicked += 1;
    save();
  }

  /* 답을 받고 곧바로 다시 물었다 = 답이 만족스럽지 않았다는 신호 */
  function recordRequery(prevQuestion, gapMs) {
    const q = String(prevQuestion || "").trim();
    const found = state.list.find(x => x.question === q);
    if (found) {
      found.requeriedInMs = gapMs;
      found.reasons = Array.from(new Set(found.reasons.concat(["즉시 재질문"])));
      save();
      return;
    }
    /* 잘 처리된 것으로 분류돼 목록에 없던 질문이라면 이제 넣습니다 —
       바로 다시 물었다는 것 자체가 문제 신호입니다. */
    state.list.unshift({
      question: q, count: 1, at: new Date().toISOString(),
      reasons: ["즉시 재질문"], path: "rule", kind: null, intent: null,
      confidence: null, slots: null, rows: null, rejected: [], requeriedInMs: gapMs
    });
    if (state.list.length > MAX) state.list.length = MAX;
    save();
  }

  /* 한 번의 조회를 기록합니다. 기록할 이유가 없으면 목록에는 남기지 않습니다. */
  function record(entry) {
    tally(entry);
    const reasons = [];
    /* 규칙이 놓쳐 LLM 으로 넘어간 것은 성공하든 실패하든 기록합니다.
       폴백(키 없음 · 타임아웃)은 오히려 더 중요한 신호입니다 — 규칙이
       못 읽었는데 LLM 도 못 도운 질문이기 때문입니다. */
    if (entry.path === "llm") reasons.push("규칙 미스");
    if (entry.path === "rule-fallback") reasons.push("규칙 미스", "LLM 폴백");
    if (entry.path === "llm-rejected") reasons.push("규칙 미스", "가드 거절");
    if (entry.confidence !== null && entry.confidence !== undefined &&
        entry.confidence < 0.6) reasons.push("낮은 확신");
    if (entry.kind === "clarify") reasons.push("되묻기");
    if (entry.kind === "unsupported") reasons.push("미지원");
    if (entry.rows === 0) reasons.push("결과 0건");
    if (entry.rejected && entry.rejected.length) reasons.push("가드 거절");
    if (entry.repeatedAfterClarify) reasons.push("되묻기 무시 후 재질문");
    if (entry.path === "narrate-blocked") reasons.push("서술 수치 차단");
    if (!reasons.length) { save(); return null; }   /* 지표는 이미 세었으니 저장은 합니다 */

    const q = String(entry.question || "").trim();
    const found = state.list.find(x => x.question === q);
    if (found) {
      found.count += 1;
      found.at = new Date().toISOString();
      found.reasons = Array.from(new Set(found.reasons.concat(reasons)));
      if (entry.slots) found.slots = entry.slots;
      if (entry.path) found.path = entry.path;
      if (entry.kind) found.kind = entry.kind;
    } else {
      state.list.unshift({
        question: q, count: 1, at: new Date().toISOString(),
        reasons: reasons, path: entry.path || "rule", kind: entry.kind || null,
        intent: entry.intent || null, confidence: entry.confidence,
        slots: entry.slots || null, rows: entry.rows,
        rejected: entry.rejected || []
      });
      if (state.list.length > MAX) state.list.length = MAX;
    }
    save();
    return true;
  }

  /* ── 규칙 사전 추가 후보 ────────────────────────────────────────────
     LLM 이 확신을 갖고 해석한 표현 중, 규칙 사전에 없는 말을 찾습니다.
     제안만 합니다 — 사전을 코드가 마음대로 바꾸지는 않습니다. */
  const INTENT_KO = {
    max: "최고값(max) 트리거", min: "최저값(min) 트리거", stat: "통계(stat) 트리거",
    trend: "추이(trend) 트리거", compare: "비교(compare) 트리거",
    count: "건수(count) 트리거", missing: "결측(missing) 트리거",
    meta: "데이터 요약(meta) 표현", help: "사용법(help) 표현"
  };

  function suggestions() {
    const E = window.AskEngine;
    const out = [];
    state.list.forEach(function (e) {
      if (e.path !== "llm" || !e.slots) return;
      if (typeof e.confidence === "number" && e.confidence < 0.6) return;
      if (state.approved.indexOf(e.question) > -1) return;
      const intent = e.slots.intent;
      if (!INTENT_KO[intent]) return;
      /* 규칙이 이미 같은 의도로 읽는다면 사전에 넣을 이유가 없습니다 */
      if (E && E._detectIntent(E._norm(e.question)) === intent) return;
      const phrase = pickPhrase(e.question);
      if (!phrase) return;
      out.push({
        question: e.question, count: e.count, phrase: phrase,
        target: INTENT_KO[intent], intent: intent,
        where: "ask-engine.js · detectIntent"
      });
    });
    return out.sort((a, b) => b.count - a.count);
  }

  /* 질문에서 "사전에 넣을 만한 조각" 을 고릅니다. 항목 이름 · 숫자 · 조사는
     빼고, 의도를 나르는 표현만 남깁니다. */
  function pickPhrase(q) {
    const t = String(q || "").toLowerCase()
      .replace(/[0-9]+/g, " ")
      .replace(/[?!.,·]/g, " ");
    const CUES = ["제일 잘 나온", "잘 나온", "제일 좋", "가장 좋", "제일 안 좋", "가장 안 좋",
      "젤 높", "젤 낮", "어땠어", "어때", "얼마나 돼", "얼마였", "몇 개나", "몇 개",
      "올라가고 있", "떨어지고 있", "상황", "요약", "정리해", "골라줘", "알려줘"];
    let best = null;
    CUES.forEach(function (c) { if (t.indexOf(c) > -1 && (!best || c.length > best.length)) best = c; });
    return best;
  }

  function approve(question) {
    if (state.approved.indexOf(question) === -1) state.approved.push(question);
    save();
  }
  function clear() { state = { list: [], approved: [], counts: blank() }; save(); }

  return {
    record: record, suggestions: suggestions, approve: approve, clear: clear,
    metrics: metrics, resetCounts: resetCounts, daily: daily, report: report,
    recordChoice: recordChoice, recordRequery: recordRequery,
    on: on, state: () => state, KEY: KEY
  };
})();
