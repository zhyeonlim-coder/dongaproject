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
      return p && Array.isArray(p.list) ? p : { list: [], approved: [] };
    } catch (e) { return { list: [], approved: [] }; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 저장 실패는 조회를 막지 않습니다 */ }
    subs.forEach(f => f(state));
  }
  function on(f) { subs.push(f); return () => { const i = subs.indexOf(f); if (i > -1) subs.splice(i, 1); }; }

  /* 한 번의 조회를 기록합니다. 기록할 이유가 없으면 아무것도 하지 않습니다. */
  function record(entry) {
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
    if (!reasons.length) return null;

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
  function clear() { state = { list: [], approved: [] }; save(); }

  return {
    record: record, suggestions: suggestions, approve: approve, clear: clear,
    on: on, state: () => state, KEY: KEY
  };
})();
