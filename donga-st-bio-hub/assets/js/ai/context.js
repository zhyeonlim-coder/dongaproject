/* ==========================================================================
   ai/context.js — 지금 사용자가 무엇을 보고 있는가  ·  window.AIContext

   왜 필요한가
     "여기서 가장 높은 값 알려줘" 의 "여기" 를 풀려면, 질문만으로는 부족하고
     지금 화면 상태를 알아야 합니다. 그 상태를 여기 한 곳에 모읍니다.

   왜 window 여기저기에 두지 않는가
     화면마다 자기 변수를 window 에 얹으면, 나중에 무엇이 최신인지 알 수
     없게 됩니다. 페이지가 바뀌어도 옛 값이 남아 있고, 그걸 물려받은 답은
     조용히 틀립니다. 그래서 등록·해제와 변경 통지를 가진 한 곳을 둡니다.

   ★ 여기 모인 정보는 "해석의 힌트" 일 뿐 데이터가 아닙니다.
     수치는 언제나 Repo · AskTables 에서 다시 읽습니다. 화면이 들고 있는
     값을 그대로 답에 실으면, 화면이 낡았을 때 답도 함께 낡습니다.
   ========================================================================== */

window.AIContext = (function () {
  "use strict";

  /* 페이지 식별 — shell2 의 page 값과 같은 이름을 씁니다 */
  const PAGES = {
    dashboard: { ko: "대시보드", what: "과제 현황과 요약" },
    data:      { ko: "데이터 조회", what: "실험 데이터 표와 필터" },
    ebr:       { ko: "EBR 입력", what: "실험 기록 입력" },
    hub:       { ko: "DoE & Intelligence", what: "실험 설계 · AI 검색 · Wiki" },
    schedule:  { ko: "일정 관리", what: "실험 일정" },
    booking:   { ko: "장비 예약", what: "장비 예약 현황" },
    explorer:  { ko: "데이터 탐색", what: "탐색 뷰" }
  };

  let page = null;          /* "data" … */
  let section = null;       /* 페이지 안의 위치 — hub 의 탭 등 */
  const providers = {};     /* 화면이 등록한 상태 공급자 */
  const subs = [];

  function emit() { subs.slice().forEach(f => { try { f(get()); } catch (e) { /* 구독자 오류가 화면을 막지 않습니다 */ } }); }
  function on(f) { subs.push(f); return function () { const i = subs.indexOf(f); if (i > -1) subs.splice(i, 1); }; }

  function setPage(p, sec) {
    page = p || null;
    if (sec !== undefined) section = sec;
    emit();
  }
  function setSection(sec) { section = sec || null; emit(); }

  /* 화면이 자기 상태를 알려 주는 방법.

     값을 넘기지 않고 함수를 넘깁니다 — 값을 넘기면 그 순간의 사본이 되어,
     사용자가 필터를 바꿔도 옛 값이 남습니다. 물어볼 때마다 지금을 읽습니다. */
  function provide(key, fn) {
    providers[key] = fn;
    emit();
    return function () { delete providers[key]; emit(); };
  }

  /* ── 공통 상태 — 어느 화면에서나 같은 방식으로 읽습니다 ─────────────── */

  function scopeState() {
    if (!window.Scope || !window.Scope.get) return null;
    const s = window.Scope.get();
    const active = [];
    if (s.scopeId) active.push({ k: "범위", v: s.scopeKind + " " + s.scopeId });
    if (s.studyId) active.push({ k: "Study", v: s.studyId });
    if (s.team) active.push({ k: "팀", v: s.team });
    if (s.dataClass) active.push({ k: "Data 분류", v: s.dataClass });
    if (s.q) active.push({ k: "검색어", v: s.q });
    if (s.from || s.to) active.push({ k: "기간", v: (s.from || "") + "~" + (s.to || "") });
    if (s.status) active.push({ k: "상태", v: s.status });
    return { raw: s, active: active, count: active.length };
  }

  /* 화면에 지금 보이는 배치 목록. Scope 가 비동기라 마지막으로 확인된
     것을 들고 있다가 돌려줍니다 — 없으면 null 이고, 그때는 "화면 기준" 이
     아니라 "전체 기준" 이라고 답해야 합니다. */
  let visibleBatches = null;
  function setVisibleBatches(list) {
    visibleBatches = Array.isArray(list) ? list.slice() : null;
    emit();
  }

  function get() {
    const out = {
      page: page,
      pageKo: page && PAGES[page] ? PAGES[page].ko : null,
      pageWhat: page && PAGES[page] ? PAGES[page].what : null,
      section: section,
      scope: scopeState(),
      visibleBatchIds: visibleBatches,
      visibleCount: visibleBatches ? visibleBatches.length : null
    };
    Object.keys(providers).forEach(function (k) {
      try { out[k] = providers[k](); }
      catch (e) { out[k] = null; }
    });
    return out;
  }

  /* ── 사람이 읽는 요약 — 답변 머리말과 Drawer 상단에 그대로 씁니다 ──── */
  function describe() {
    const c = get();
    const bits = [];
    if (c.pageKo) bits.push(c.pageKo);
    if (c.section) bits.push(c.section);
    if (c.scope && c.scope.active.length) {
      bits.push(c.scope.active.map(a => a.k + " " + a.v).join(" · "));
    }
    if (c.visibleCount != null) bits.push("화면에 " + c.visibleCount + "건");
    return bits.join(" · ");
  }

  /* 승계할 수 있는 조건이 실제로 있는가 — 없으면 "화면 기준" 이라고
     말하면 안 됩니다. 전체를 조회하고 전체라고 말해야 합니다. */
  function hasScope() {
    const c = get();
    return !!(c.scope && c.scope.active.length) ||
           (Array.isArray(c.visibleBatchIds) && c.visibleBatchIds.length > 0);
  }

  /* ── 이 화면에서 쓸 수 있는 Tool ────────────────────────────────────
     DoE 분석은 hub 화면의 설계와 응답값에 대해서만 돕니다. 다른 화면에는
     분석할 대상이 없으므로, 있는 척하지 않고 없다고 답합니다. */
  function allows(tool) {
    if (tool === "runDoE" || tool === "runANOVA" ||
        tool === "runRegression" || tool === "optimizeExperiment") {
      const d = get().doe;
      return !!(page === "hub" && d && d.hasPlan);
    }
    return true;
  }
  function whyNot(tool) {
    if (allows(tool)) return null;
    const d = get().doe;
    if (page !== "hub") {
      return "현재 화면에는 분석할 DoE 설계와 응답 데이터가 없습니다. " +
             "DoE 화면(DoE & Intelligence → DoE 조건 설계 & 분석)에서 설계를 먼저 만들고 " +
             "응답값을 입력해 주세요.";
    }
    if (!d || !d.hasPlan) {
      return "아직 설계가 만들어지지 않았습니다. 인자와 설계 종류를 고르면 분석할 수 있습니다.";
    }
    return null;
  }

  return {
    PAGES: PAGES,
    setPage: setPage, setSection: setSection,
    provide: provide, setVisibleBatches: setVisibleBatches,
    get: get, describe: describe, hasScope: hasScope,
    allows: allows, whyNot: whyNot,
    on: on
  };
})();
