/* ==========================================================================
   specs.js — 규격(Spec) 한계값과 Pass/Fail 판정  ·  window.Specs

   왜 비어 있는 채로 시작하는가
     규격 한계값은 규제 문서의 내용입니다. 그럴듯한 숫자를 코드에 심어 두면
     화면에는 판정이 뜨지만 그 판정에는 근거가 없습니다. 값을 지어내지
     않는다는 이 시스템의 원칙이 가장 강하게 적용돼야 하는 자리입니다.
     그래서 등록된 규격이 하나도 없으면 "판정할 수 없다" 고 답합니다.

   부분 등록이 가장 위험합니다
     12개 항목 중 5개만 규격이 있는데 "이 배치는 적합" 이라고 답하면,
     읽는 사람은 12개가 다 통과한 것으로 받아들입니다. 그래서 판정 결과에는
     항상 "몇 개 중 몇 개를 판정했는지" 가 따라붙습니다.

   Audit Trail
     수정해도 기존 값을 덮어쓰지 않습니다. 이전 값을 history 에 쌓고,
     누가 · 언제(초 단위) · 왜 바꿨는지를 함께 남깁니다. 삭제도 하지 않고
     비활성화합니다 (ALCOA+ 원칙 · 다른 기록과 같은 규칙).
   ========================================================================== */

window.Specs = (function () {
  "use strict";

  const KEY = "hub.specs.v1";
  const subs = [];
  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      const o = raw ? JSON.parse(raw) : null;
      if (o && Array.isArray(o.list)) return o;
    } catch (e) { /* 손상된 값은 새로 시작합니다 */ }
    return { list: [] };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 저장 실패가 조회를 막지 않습니다 */ }
    subs.forEach(f => f(state));
  }
  function on(f) { subs.push(f); return function () { const i = subs.indexOf(f); if (i > -1) subs.splice(i, 1); }; }

  /* 초 단위까지 남깁니다 — 규제 기록은 분 단위로는 부족합니다 */
  function stamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" +
      p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }
  function uid() { return "SP-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6); }

  function who() {
    const u = window.Auth && window.Auth.current ? window.Auth.current() : null;
    return u ? u.name : "(알 수 없음)";
  }

  /* ── 등록 ────────────────────────────────────────────────────────────
     scope: { type: "all" } | { type: "project", value: "DA-1234" }
                            | { type: "study", value: "DoE test" } */
  function add(e) {
    if (!e || !e.columnKey) return { ok: false, why: "항목(columnKey)이 필요합니다." };
    const lo = numOrNull(e.lo), hi = numOrNull(e.hi);
    if (lo === null && hi === null) return { ok: false, why: "하한과 상한 중 최소 하나는 있어야 합니다." };
    if (lo !== null && hi !== null && lo > hi) return { ok: false, why: "하한이 상한보다 큽니다." };
    if (!e.doc) return { ok: false, why: "근거 문서를 적어야 합니다. 근거 없는 규격은 판정에 쓸 수 없습니다." };

    const rec = {
      id: uid(), columnKey: e.columnKey, lo: lo, hi: hi,
      unit: e.unit || null,
      scope: e.scope && e.scope.type ? e.scope : { type: "all" },
      doc: String(e.doc),
      demo: !!e.demo,                    /* 예시로 넣은 값임을 표시 */
      by: e.by || who(), at: stamp(),
      active: true, history: []
    };
    state.list.unshift(rec);
    save();
    return { ok: true, spec: rec };
  }

  /* ── 수정 — 덮어쓰지 않고 이전 값을 이력으로 쌓습니다 ─────────────── */
  function update(id, patch, reason) {
    const s = state.list.find(x => x.id === id);
    if (!s) return { ok: false, why: "해당 규격을 찾지 못했습니다." };
    if (!reason) return { ok: false, why: "변경 사유를 적어야 합니다." };
    const lo = patch.lo === undefined ? s.lo : numOrNull(patch.lo);
    const hi = patch.hi === undefined ? s.hi : numOrNull(patch.hi);
    if (lo === null && hi === null) return { ok: false, why: "하한과 상한 중 최소 하나는 있어야 합니다." };
    if (lo !== null && hi !== null && lo > hi) return { ok: false, why: "하한이 상한보다 큽니다." };

    s.history.push({
      lo: s.lo, hi: s.hi, unit: s.unit, scope: s.scope, doc: s.doc,
      by: s.by, at: s.at, replacedBy: who(), replacedAt: stamp(), reason: String(reason)
    });
    s.lo = lo; s.hi = hi;
    if (patch.unit !== undefined) s.unit = patch.unit;
    if (patch.scope !== undefined) s.scope = patch.scope;
    if (patch.doc !== undefined) s.doc = String(patch.doc);
    s.by = who(); s.at = stamp();
    save();
    return { ok: true, spec: s };
  }

  /* ── 비활성화 — 지우지 않습니다 ──────────────────────────────────── */
  function deactivate(id, reason) {
    const s = state.list.find(x => x.id === id);
    if (!s) return { ok: false, why: "해당 규격을 찾지 못했습니다." };
    if (!reason) return { ok: false, why: "사유를 적어야 합니다." };
    s.history.push({ lo: s.lo, hi: s.hi, unit: s.unit, scope: s.scope, doc: s.doc,
      by: s.by, at: s.at, replacedBy: who(), replacedAt: stamp(),
      reason: "비활성화 — " + reason });
    s.active = false;
    s.deactivatedBy = who(); s.deactivatedAt = stamp(); s.deactivateReason = String(reason);
    save();
    return { ok: true };
  }
  function reactivate(id) {
    const s = state.list.find(x => x.id === id);
    if (!s) return { ok: false };
    s.active = true; s.reactivatedBy = who(); s.reactivatedAt = stamp();
    save();
    return { ok: true };
  }

  function numOrNull(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }

  function active() { return state.list.filter(s => s.active !== false); }
  function count() { return active().length; }

  /* 이 행에 적용되는 규격인가 */
  function applies(spec, row) {
    const sc = spec.scope || { type: "all" };
    if (sc.type === "all") return true;
    if (sc.type === "project") return row.project === sc.value;
    if (sc.type === "study") return row.study === sc.value;
    return false;
  }

  /* 한 행에 적용 가능한 규격 목록 (항목당 가장 좁은 범위 하나) */
  function forRow(row) {
    const byCol = {};
    active().forEach(function (s) {
      if (!applies(s, row)) return;
      const cur = byCol[s.columnKey];
      const rank = t => (t === "study" ? 3 : t === "project" ? 2 : 1);
      if (!cur || rank(s.scope.type) > rank(cur.scope.type)) byCol[s.columnKey] = s;
    });
    return byCol;
  }

  /* ── 판정 ────────────────────────────────────────────────────────────
     반환 {
       judged: [{ key, label, value, spec, verdict: "pass"|"fail" }],
       unregistered: [{ key, label }],     규격이 없어 판정하지 않은 항목
       noValue: [{ key, label }],          값이 없어 판정할 수 없는 항목
       verdict: "pass"|"fail"|"unknown",
       coverage: { judged, total }
     }
     ★ 규격이 없는 항목을 "통과" 로 세지 않습니다. 판정하지 않은 것과
       통과한 것은 다릅니다. */
  function judgeRow(row, table) {
    const cols = table.columns.filter(c => c.type === "num");
    const specs = forRow(row);
    const judged = [], unregistered = [], noValue = [];

    cols.forEach(function (c) {
      const s = specs[c.key];
      const v = row[c.key];
      if (!s) { unregistered.push({ key: c.key, label: c.label }); return; }
      if (typeof v !== "number" || !isFinite(v)) { noValue.push({ key: c.key, label: c.label }); return; }
      const okLo = s.lo === null || v >= s.lo;
      const okHi = s.hi === null || v <= s.hi;
      judged.push({ key: c.key, label: c.label, value: v, spec: s,
                    verdict: (okLo && okHi) ? "pass" : "fail" });
    });

    return {
      row: row, judged: judged, unregistered: unregistered, noValue: noValue,
      verdict: judged.length ? (judged.some(j => j.verdict === "fail") ? "fail" : "pass") : "unknown",
      coverage: { judged: judged.length, total: cols.length }
    };
  }

  function judgeRows(rows, table) {
    return (rows || []).map(r => judgeRow(r, table));
  }

  /* 규격 범위를 사람이 읽는 문자열로 */
  function rangeText(s) {
    const u = s.unit ? " " + s.unit : "";
    if (s.lo !== null && s.hi !== null) return s.lo + u + " ~ " + s.hi + u;
    if (s.lo !== null) return "≥ " + s.lo + u;
    return "≤ " + s.hi + u;
  }
  function scopeText(s) {
    const sc = s.scope || { type: "all" };
    return sc.type === "all" ? "전체" :
           sc.type === "project" ? "과제 " + sc.value : "Study " + sc.value;
  }

  function clear() { state = { list: [] }; save(); }

  return {
    on: on, state: () => state, active: active, count: count,
    add: add, update: update, deactivate: deactivate, reactivate: reactivate,
    forRow: forRow, judgeRow: judgeRow, judgeRows: judgeRows, clear: clear,
    rangeText: rangeText, scopeText: scopeText, applies: applies,
    KEY: KEY, _stamp: stamp
  };
})();
