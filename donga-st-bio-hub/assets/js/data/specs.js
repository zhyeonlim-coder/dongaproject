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

   어디에 저장되는가
     원본은 저장소 파일(specs-baseline.js)입니다. 브라우저에는 아직 파일에
     반영하지 않은 변경분만 임시로 쌓입니다. 규제 기록이 사용자 브라우저에만
     사는 구조를 없애기 위한 것입니다 — 캐시 한 번 지우면 판정 기준이
     사라지는데 화면은 아무 말도 하지 않는 상황이 가장 위험합니다.

     · 파일 로드 성공 + 0건  → "등록된 규격이 없습니다"   (판정 안 함)
     · 파일 로드 실패        → "규격 원본을 읽지 못했습니다" (판정 보류)
     두 경우를 같은 문장으로 답하면 그것이 조용한 오답입니다.
   ========================================================================== */

window.Specs = (function () {
  "use strict";

  const KEY = "hub.specs.v1";      /* 브라우저에 남는 것은 "미반영 변경분" 뿐입니다 */
  const subs = [];

  /* ── 원본(저장소 파일) 상태 ──────────────────────────────────────────
     script 태그로 싣습니다. fetch 가 아니라 script 인 이유는 file:// 로
     열어도 동작해야 하기 때문입니다 — 다른 데이터 파일과 같은 방식입니다. */
  function baseline() {
    const b = window.SPECS_BASELINE;
    if (!b || !Array.isArray(b.list)) return null;
    return b;
  }
  /* { ok, reason, revision, updatedAt } — ok 가 false 면 판정하지 않습니다 */
  function source() {
    const b = baseline();
    if (!b) {
      return { ok: false, reason: "missing",
        why: "규격 원본 파일(specs-baseline.js)을 읽지 못했습니다. " +
             "규격이 없는 것인지 파일이 빠진 것인지 구분할 수 없어 판정을 보류합니다." };
    }
    return { ok: true, reason: "file", revision: b.revision || 0,
             updatedAt: b.updatedAt || null, updatedBy: b.updatedBy || null,
             count: b.list.length };
  }

  /* ── 브라우저에 남는 미반영 변경분 ───────────────────────────────── */
  let overlay = loadOverlay();
  let storageOk = true;

  function loadOverlay() {
    try {
      const raw = localStorage.getItem(KEY);
      const o = raw ? JSON.parse(raw) : null;
      if (o && Array.isArray(o.list)) return o;
    } catch (e) { /* 손상된 값은 새로 시작합니다 */ }
    return { list: [], baseRevision: (baseline() || {}).revision || 0, exportedAt: null };
  }

  /* 화면이 읽는 통합 상태 — 원본 + 미반영 변경분 */
  let state = merge();
  function merge() {
    const b = baseline();
    const fromFile = (b ? b.list : []).map(s => Object.assign({}, s, { pending: false }));
    const pending = overlay.list.map(s => Object.assign({}, s, { pending: true }));
    /* 같은 id 가 양쪽에 있으면 미반영본이 최신입니다 */
    const ids = {};
    pending.forEach(s => { ids[s.id] = true; });
    return { list: pending.concat(fromFile.filter(s => !ids[s.id])) };
  }

  function save() {
    overlay.baseRevision = (baseline() || {}).revision || 0;
    try {
      localStorage.setItem(KEY, JSON.stringify(overlay));
      storageOk = true;
    } catch (e) {
      /* 저장조차 안 되면 새로고침 한 번에 사라집니다. 조회를 막지는 않되
         그 사실을 숨기지 않습니다 — 화면이 이 값을 보고 경고합니다. */
      storageOk = false;
    }
    state = merge();
    subs.forEach(f => f(state));
  }

  /* 미반영 건수 · 저장 가능 여부 — 화면 경고가 이것을 읽습니다 */
  function pendingInfo() {
    return {
      count: overlay.list.length,
      storageOk: storageOk,
      exportedAt: overlay.exportedAt || null,
      baseRevision: (baseline() || {}).revision || 0
    };
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

  /* ── 권한 ────────────────────────────────────────────────────────────
     화면에서 버튼을 숨기는 것만으로는 부족합니다. 저장소가 직접 거절해야
     다른 경로(콘솔 · 다른 화면 · 나중에 붙는 코드)로 들어와도 막힙니다.

     거절도 기록합니다. 규제 감사에서 "누가 무엇을 시도했는가" 는
     "누가 무엇을 바꿨는가" 만큼 중요합니다. */
  const denials = [];
  function guard(what) {
    if (!window.Auth || !window.Auth.can) return null;   /* Auth 가 없는 환경은 통과 */
    if (window.Auth.can("spec:write")) return null;
    const why = window.Auth.denial("spec:write") || "권한이 없습니다.";
    denials.push({ what: what, by: who(), at: stamp(), why: why });
    if (denials.length > 200) denials.shift();
    return { ok: false, why: why, denied: true };
  }
  function denialLog() { return denials.slice(); }

  /* ── 등록 ────────────────────────────────────────────────────────────
     scope: { type: "all" } | { type: "project", value: "DA-1234" }
                            | { type: "study", value: "DoE test" } */
  function add(e) {
    const g = guard("등록"); if (g) return g;
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
    overlay.list.unshift(rec);
    save();
    return { ok: true, spec: rec };
  }

  /* 파일에 있는 규격을 고치려면 먼저 미반영 변경분으로 복사해 옵니다.
     파일 자체는 브라우저가 고칠 수 없습니다 — 원본을 바꾸려면 내보내기
     한 결과로 파일을 교체하고 커밋해야 합니다. 그게 이 구조의 요점입니다. */
  function mutable(id) {
    const own = overlay.list.find(x => x.id === id);
    if (own) return own;
    const b = baseline();
    const src = b ? b.list.find(x => x.id === id) : null;
    if (!src) return null;
    const copy = JSON.parse(JSON.stringify(src));
    copy.history = copy.history || [];
    overlay.list.unshift(copy);
    return copy;
  }

  /* ── 수정 — 덮어쓰지 않고 이전 값을 이력으로 쌓습니다 ─────────────── */
  function update(id, patch, reason) {
    const g = guard("수정"); if (g) return g;
    const s = mutable(id);
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
    const g = guard("비활성화"); if (g) return g;
    const s = mutable(id);
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
    const g = guard("재적용"); if (g) return g;
    const s = mutable(id);
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

  /* ── 저장소 파일로 내보내기 ──────────────────────────────────────────
     specs-baseline.js 를 통째로 대체할 내용을 만듭니다. 이 결과로 파일을
     바꾸고 커밋하면 그때부터 원본이 됩니다 — 그 시점에 브라우저의 미반영
     변경분은 의미가 없어지므로 비웁니다.

     revision 을 올려 둡니다. 나중에 "이 화면이 보고 있는 규격이 커밋된
     것과 같은 판인가" 를 확인할 수 있어야 합니다. */
  function exportFile() {
    const b = baseline();
    const list = active().concat(state.list.filter(s => s.active === false))
      .map(function (s) { const c = JSON.parse(JSON.stringify(s)); delete c.pending; return c; });
    const head =
      "/* specs-baseline.js — 규격(Spec) 원본\n" +
      "   화면(규격 관리 탭)에서 내보낸 파일입니다. 손으로 고치지 말고\n" +
      "   화면에서 바꾼 뒤 다시 내보내세요 — 이력(history)이 끊깁니다.\n" +
      "   내보낸 사람: " + who() + " · " + stamp() + " */\n\n";
    const body = "window.SPECS_BASELINE = " + JSON.stringify({
      revision: ((b && b.revision) || 0) + 1,
      updatedAt: stamp(),
      updatedBy: who(),
      note: list.length + "건 (활성 " + active().length + "건)",
      list: list
    }, null, 2) + ";\n";
    return head + body;
  }
  /* 내보낸 뒤에만 부릅니다 — 파일을 실제로 교체했다는 사용자의 확인입니다 */
  function markExported() {
    overlay.exportedAt = stamp();
    save();
    return { ok: true, at: overlay.exportedAt };
  }

  /* ── 가져오기 ────────────────────────────────────────────────────────
     내보낸 파일이나 백업에서 되돌립니다. 미반영 변경분으로 들어오므로,
     확인한 뒤 다시 내보내 파일로 확정해야 합니다. */
  function importList(payload, reason) {
    const g = guard("가져오기"); if (g) return g;
    if (!reason) return { ok: false, why: "가져오기 사유를 적어야 합니다." };
    let obj = payload;
    if (typeof payload === "string") {
      /* 파일 그대로 붙여넣어도 되게 — window.SPECS_BASELINE = {...}; 에서 객체만 뽑습니다 */
      const m = payload.match(/window\.SPECS_BASELINE\s*=\s*([\s\S]*?);\s*$/);
      const text = m ? m[1] : payload;
      try { obj = JSON.parse(text); }
      catch (e) { return { ok: false, why: "읽을 수 없는 형식입니다. 내보낸 파일 내용을 그대로 넣어 주세요." }; }
    }
    const list = obj && Array.isArray(obj.list) ? obj.list : Array.isArray(obj) ? obj : null;
    if (!list) return { ok: false, why: "규격 목록(list)을 찾지 못했습니다." };

    const bad = list.filter(s => !s || !s.columnKey || (numOrNull(s.lo) === null && numOrNull(s.hi) === null));
    if (bad.length) return { ok: false, why: bad.length + "건이 항목 또는 한계값을 갖고 있지 않습니다." };

    const at = stamp(), by = who();
    overlay.list = list.map(function (s) {
      const c = JSON.parse(JSON.stringify(s));
      c.id = c.id || uid();
      c.history = (c.history || []).concat([{
        lo: c.lo, hi: c.hi, unit: c.unit, scope: c.scope, doc: c.doc,
        by: c.by, at: c.at, replacedBy: by, replacedAt: at,
        reason: "가져오기 — " + reason
      }]);
      return c;
    });
    overlay.exportedAt = null;
    save();
    return { ok: true, count: overlay.list.length };
  }

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
    /* 원본을 못 읽었으면 판정하지 않습니다. 이때 "규격이 등록되어 있지
       않습니다" 라고 답하면, 규격이 있는데 파일이 빠진 상황을 규격이 없는
       상황처럼 말하는 것이 됩니다 — 정확히 조용한 오답입니다. */
    const src = source();
    if (!src.ok) {
      return { row: row, judged: [], unregistered: [], noValue: [],
        generatedSkipped: [], unverifiedSkipped: [],
        verdict: "unavailable", sourceError: src.why,
        coverage: { judged: 0, total: 0 } };
    }
    const cols = table.columns.filter(c => c.type === "num");
    const specs = forRow(row);
    const judged = [], unregistered = [], noValue = [];
    const generatedSkipped = [], unverifiedSkipped = [];

    cols.forEach(function (c) {
      const s = specs[c.key];
      const v = row[c.key];
      /* 생성값은 판정하지 않습니다. 실측이 아닌 수치로 Pass/Fail 을 내면
         그 판정이 규제 문서에 실립니다 — 가장 하면 안 되는 일입니다. */
      if (c.generated) { generatedSkipped.push({ key: c.key, label: c.label }); return; }
      /* 검증 필요로 표시된 값도 판정하지 않습니다 */
      if (row.__unverified && row.__unverified[c.key]) {
        unverifiedSkipped.push({ key: c.key, label: c.label }); return;
      }
      if (!s) { unregistered.push({ key: c.key, label: c.label }); return; }
      if (typeof v !== "number" || !isFinite(v)) { noValue.push({ key: c.key, label: c.label }); return; }
      const okLo = s.lo === null || v >= s.lo;
      const okHi = s.hi === null || v <= s.hi;
      judged.push({ key: c.key, label: c.label, value: v, spec: s,
                    verdict: (okLo && okHi) ? "pass" : "fail" });
    });

    return {
      row: row, judged: judged, unregistered: unregistered, noValue: noValue,
      generatedSkipped: generatedSkipped, unverifiedSkipped: unverifiedSkipped,
      verdict: judged.length ? (judged.some(j => j.verdict === "fail") ? "fail" : "pass") : "unknown",
      /* 분모에서 생성값을 뺍니다 — 판정 대상이 아닌 것을 "판정 못 한 항목"
         으로 세면 규격 등록률이 실제보다 나빠 보입니다 */
      coverage: { judged: judged.length, total: cols.length - generatedSkipped.length }
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

  /* 검사·초기화용 — 미반영 변경분만 비웁니다. 파일 원본은 건드리지 않습니다
     (브라우저에서 지울 수 있는 것이 아닙니다). */
  function clear() { overlay = { list: [], baseRevision: (baseline() || {}).revision || 0, exportedAt: null }; save(); }

  return {
    on: on, state: () => state, active: active, count: count,
    add: add, update: update, deactivate: deactivate, reactivate: reactivate,
    forRow: forRow, judgeRow: judgeRow, judgeRows: judgeRows, clear: clear,
    rangeText: rangeText, scopeText: scopeText, applies: applies,
    /* 저장 위치 · 권한 */
    source: source, pending: pendingInfo, denials: denialLog,
    exportFile: exportFile, markExported: markExported, importList: importList,
    KEY: KEY, _stamp: stamp
  };
})();
