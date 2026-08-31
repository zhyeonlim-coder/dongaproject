/* ==========================================================================
   rulelex.js — 런타임 규칙 사전 오버레이  ·  window.RuleLex

   왜 필요한가
     규칙 사전(ALIAS · 의도 트리거)은 ask-engine.js 안에 하드코딩돼 있습니다.
     그래서 "승격" 이라는 말은 있어도 실제로 반영할 자리가 없었습니다.
     제안만 하고 아무 일도 일어나지 않으면 루프는 이름뿐입니다.

     이 파일이 그 자리입니다. 관리자가 승인한 어휘를 여기에 쌓고,
     ask-engine 이 조회할 때마다 함께 봅니다. 다음 질문부터는 LLM 없이
     규칙으로 처리됩니다.

   원칙
     · 하드코딩 사전을 덮어쓰지 않습니다. 기존 규칙이 먼저 판정하고,
       기본값(list)으로 떨어졌을 때만 이 오버레이를 봅니다.
       그래야 승격이 기존 해석을 바꾸지 않습니다.
     · 모든 승격은 이력으로 남고 되돌릴 수 있습니다 (규제 대응과 같은 이유).
     · 삭제하지 않고 비활성화합니다.
   ========================================================================== */

window.RuleLex = (function () {
  "use strict";

  const KEY = "hub.rulelex.v1";
  const subs = [];
  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      const o = raw ? JSON.parse(raw) : null;
      if (o && Array.isArray(o.entries)) return o;
    } catch (e) { /* 손상된 값은 무시하고 새로 시작합니다 */ }
    return { entries: [], snapshots: [] };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 저장 실패가 조회를 막지는 않습니다 */ }
    subs.forEach(f => f(state));
  }
  function on(f) { subs.push(f); return function () { const i = subs.indexOf(f); if (i > -1) subs.splice(i, 1); }; }

  function uid() { return "LX-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6); }

  /* 활성 항목만 */
  function active() { return state.entries.filter(e => e.active !== false); }

  /* 의도 트리거 — detectIntent 가 기본값으로 떨어졌을 때만 참조합니다 */
  function intentOf(text) {
    const t = String(text == null ? "" : text);
    let best = null;
    active().forEach(function (e) {
      if (e.kind !== "intent") return;
      if (t.indexOf(e.phrase) === -1) return;
      if (!best || e.phrase.length > best.phrase.length) best = e;
    });
    return best ? best.intent : null;
  }

  /* 항목 별칭 — ALIAS 에 얹습니다 (컬럼 key → 추가 표현들) */
  function metricAliases() {
    const map = {};
    active().forEach(function (e) {
      if (e.kind !== "metric") return;
      (map[e.key] = map[e.key] || []).push(e.phrase);
    });
    return map;
  }

  /* 추가 — 같은 표현이 이미 있으면 빈도만 올립니다 */
  function add(entry) {
    const dup = state.entries.find(e =>
      e.kind === entry.kind && e.phrase === entry.phrase &&
      (e.intent || null) === (entry.intent || null) && (e.key || null) === (entry.key || null));
    if (dup) {
      dup.active = true;
      dup.count = (dup.count || 1) + 1;
      dup.at = new Date().toISOString();
      save();
      return dup;
    }
    const e = {
      id: uid(), kind: entry.kind, phrase: entry.phrase,
      intent: entry.intent || null, key: entry.key || null,
      source: entry.source || null,            /* 어느 질문에서 왔는지 */
      by: entry.by || null, at: new Date().toISOString(),
      count: 1, active: true,
      /* 후보를 시험해 보려고 잠깐 넣는 항목입니다. 이력에 남으면 안 됩니다. */
      temp: !!entry.temp
    };
    state.entries.unshift(e);
    save();
    return e;
  }

  /* 되돌리기 — 지우지 않고 비활성화합니다 */
  function revert(id, why) {
    const i = state.entries.findIndex(x => x.id === id);
    if (i === -1) return false;
    const e = state.entries[i];
    /* 시험용 항목은 흔적을 남기지 않고 걷어냅니다 */
    if (e.temp) { state.entries.splice(i, 1); save(); return true; }
    e.active = false;
    e.revertedAt = new Date().toISOString();
    e.revertReason = why || null;
    save();
    return true;
  }
  function restore(id) {
    const e = state.entries.find(x => x.id === id);
    if (!e) return false;
    e.active = true; delete e.revertedAt; delete e.revertReason;
    save();
    return true;
  }

  /* 효과 측정용 스냅샷 — 승격 직전의 지표를 남겨 전후를 비교합니다 */
  function snapshot(label, metrics) {
    state.snapshots.unshift({
      at: new Date().toISOString(), label: label || null, metrics: metrics || null,
      activeCount: active().length
    });
    if (state.snapshots.length > 50) state.snapshots.length = 50;
    save();
  }

  function clear() { state = { entries: [], snapshots: [] }; save(); }

  return {
    on: on, state: () => state, active: active,
    intentOf: intentOf, metricAliases: metricAliases,
    add: add, revert: revert, restore: restore,
    snapshot: snapshot, clear: clear, KEY: KEY
  };
})();
