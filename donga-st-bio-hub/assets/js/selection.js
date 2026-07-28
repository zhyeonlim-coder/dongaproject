/* ==========================================================================
   Scope — 전역 선택 상태

   과제(Project) → Study → 팀 선택을 앱 전체가 공유합니다.
   대시보드 · EBR · 데이터 조회 · 일정이 모두 여기만 읽고 씁니다.
   localStorage 에 저장되어 메뉴를 이동해도 유지됩니다.

   ── 과제 전환 시 이전 데이터가 남는 버그를 구조적으로 막는 방식 ──────────
   scopeId 가 바뀌면 studyId · team 을 **무조건** 비웁니다. 화면이 알아서
   지우기를 기대하지 않습니다. 이전 과제의 studyId 가 남아 있으면
   resolveBatches() 가 빈 배열을 돌려주고 화면에는 "데이터 없음"이 뜨는데,
   이게 실제로는 "이전 선택이 남아 있음" 이라 원인을 찾기 어렵기 때문입니다.

     Scope.get() / .setScope(kind,id) / .setStudy(id) / .setTeam(id)
     Scope.reset() / .subscribe(fn) / .batches()

   ⚠ 이름이 Selection 이 아니라 Scope 인 이유: window.Selection 은 DOM 내장
     인터페이스라 덮어쓰면 getSelection() 계열이 깨집니다.
   ========================================================================== */

window.Scope = (function () {
  "use strict";

  /* v3 — 기반 Study / 미지정 개념을 폐지하면서 저장 형식이 바뀌었습니다.
     예전 키(v2)에 남아 있던 "platform:STD-0045" 같은 값은 더 이상 유효하지
     않으므로 키를 올려 자동으로 버립니다. */
  const KEY = "hub.selection.v4";
  const EMPTY = {
    scopeKind: null,   // 항상 "project" (과제 외 최상위 범위는 없습니다)
    scopeId: null,
    studyId: null,
    team: null,
    q: "",
    dataClass: null,   // 예전 "Study 유형(type)" 을 대체하는 측정 항목 축
    status: null,
    from: "",          // 기간 시작 (YYYY-MM-DD)
    to: "",            // 기간 종료
    sort: "date-desc"  // 조회 결과 정렬 — 기본은 최신 날짜순
  };

  /* 조회 조건으로 취급하는 필드. [조회] 버튼이 이것들을 한 번에 적용하고,
     [초기화] 는 이것들만 비웁니다 (과제 선택은 상단 셀렉터 소관이라 제외). */
  const FILTER_KEYS = ["studyId", "team", "q", "dataClass", "status", "from", "to", "sort"];

  const subs = [];
  let state;

  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? Object.assign({}, EMPTY, JSON.parse(raw)) : Object.assign({}, EMPTY);
  } catch (e) { state = Object.assign({}, EMPTY); }

  /* 저장된 선택이 현재 데이터에 실제로 존재하는지 확인합니다.
     과제 목록이 바뀐 뒤에도 옛 ID 가 남아 있으면 화면이 조용히 0건이 됩니다. */
  (function validate() {
    const projects = window.DATA_PROJECTS || [];
    const studies = window.DATA_STUDIES || [];
    if (state.scopeId && !projects.some(p => p.id === state.scopeId)) {
      state = Object.assign({}, EMPTY);
      return;
    }
    if (state.scopeId) state.scopeKind = "project";
    if (state.studyId && !studies.some(s => s.id === state.studyId && s.projectId === state.scopeId)) {
      state.studyId = null;
      state.team = null;
    }
  })();

  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function emit(reason) {
    save();
    subs.slice().forEach(fn => { try { fn(get(), reason); } catch (e) {} });
  }

  function get() { return Object.assign({}, state); }

  /* 최상위 범위 선택. 하위는 전부 초기화됩니다. */
  function setScope(kind, id) {
    if (state.scopeKind === kind && state.scopeId === id) return get();
    state.scopeKind = kind || null;
    state.scopeId = id || null;
    state.studyId = null;          // ← 과제 전환 시 잔존 방지
    state.team = null;
    state.dataClass = null;
    state.status = null;
    emit("scope");
    return get();
  }

  /* 모든 Study 가 과제 하위에 있으므로 Study 단계를 건너뛰는 경우는 없습니다.
     기반 Study(platform) 를 없앤 뒤에도 호출부가 남아 있어 false 를 돌려주는
     형태로 유지합니다 — 화면마다 조건문을 지우고 다니면 하나씩 빠뜨립니다. */
  function skipsStudyStep() { return false; }

  function setStudy(id) {
    if (state.studyId === id) return get();
    state.studyId = id || null;
    state.team = null;
    emit("study");
    return get();
  }

  function setTeam(id) {
    if (state.team === id) return get();
    state.team = id || null;
    /* 팀을 바꾸면 그 팀에 없는 Data 분류는 의미가 없으므로 함께 비웁니다. */
    if (state.dataClass) {
      const c = (window.DATA_CLASSES || []).find(x => x.id === state.dataClass);
      if (c && state.team && c.team !== state.team) state.dataClass = null;
    }
    emit("team");
    return get();
  }

  function setFilter(patch) {
    let changed = false;
    ["q", "dataClass", "status", "from", "to", "sort"].forEach(k => {
      if (patch.hasOwnProperty(k) && state[k] !== patch[k]) { state[k] = patch[k]; changed = true; }
    });
    if (changed) emit("filter");
    return get();
  }

  /* [조회] — 여러 조건을 **한 번에** 적용합니다.
     하나씩 set 하면 그때마다 화면이 다시 그려져, 중간 상태가 눈에 보이고
     계산도 조건 수만큼 반복됩니다. 조회는 한 번의 갱신이어야 합니다. */
  function apply(patch) {
    const p = patch || {};
    let changed = false;
    FILTER_KEYS.forEach(function (k) {
      if (!p.hasOwnProperty(k)) return;
      const v = (k === "q") ? (p[k] || "") : (p[k] || (k === "sort" ? EMPTY.sort : null));
      const norm = (k === "from" || k === "to") ? (p[k] || "") : v;
      if (state[k] !== norm) { state[k] = norm; changed = true; }
    });
    /* Study 가 바뀌면 그 아래 팀 선택은 의미가 없을 수 있지만, 조회 버튼은
       사용자가 고른 조합을 그대로 적용해야 하므로 여기서 지우지 않습니다. */
    emit(changed ? "apply" : "apply-nochange");
    return get();
  }

  /* [초기화] — 조회 조건만 비웁니다. 과제 선택까지 풀면 화면이 통째로
     비어 버려서, 초기화가 아니라 로그아웃처럼 느껴집니다. */
  function clearFilters() {
    FILTER_KEYS.forEach(k => { state[k] = EMPTY[k]; });
    emit("reset-filters");
    return get();
  }

  function clearOne(key) {
    if (key === "scope") return setScope(null, null);
    if (key === "studyId") return setStudy(null);
    if (key === "team") return setTeam(null);
    if (key === "q") return setFilter({ q: "" });
    if (key === "period") return setFilter({ from: "", to: "" });
    if (key === "dataClass" || key === "status") { const p = {}; p[key] = null; return setFilter(p); }
    return get();
  }

  function reset() { state = Object.assign({}, EMPTY); emit("reset"); return get(); }

  function activeCount() {
    let n = 0;
    if (state.scopeId) n++;
    if (state.studyId) n++;
    if (state.team) n++;
    if (state.q && state.q.trim()) n++;
    if (state.dataClass) n++;
    if (state.status) n++;
    if (state.from || state.to) n++;
    return n;
  }

  function periodLabel() {
    if (!state.from && !state.to) return null;
    if (state.from && state.to) return state.from + " ~ " + state.to;
    return state.from ? state.from + " 이후" : state.to + " 이전";
  }

  /* 현재 선택에 해당하는 배치 — 화면들이 반복 구현하지 않도록 여기 한 곳에 */
  function batches() { return window.Repo.resolveBatches(get()); }

  /* 선택 요약 라벨 (브레드크럼용) */
  function describe() {
    const s = get();
    if (!s.scopeId) return { scope: null, study: null, team: null, path: [] };
    const path = [];

    const p = (window.DATA_PROJECTS || []).find(x => x.id === s.scopeId);
    const scopeLabel = p ? (p.code || p.name) : s.scopeId;
    path.push({ key: "scope", label: scopeLabel });

    let studyLabel = null;
    if (s.studyId) {
      const st = (window.DATA_STUDIES || []).find(x => x.id === s.studyId);
      studyLabel = st ? st.name : s.studyId;
      path.push({ key: "studyId", label: studyLabel });
    }
    let teamLabel = null;
    if (s.team) {
      const t = (window.DATA_TEAMS || []).find(x => x.id === s.team);
      teamLabel = t ? t.ko : s.team;
      path.push({ key: "team", label: teamLabel });
    }
    return { scope: scopeLabel, study: studyLabel, team: teamLabel, path, skipsStudyStep: false };
  }

  function subscribe(fn) {
    subs.push(fn);
    return () => { const i = subs.indexOf(fn); if (i > -1) subs.splice(i, 1); };
  }

  /* 현재 선택에 해당하는 시료 — 분석값은 시료에 붙습니다 */
  function samples() { return window.Repo.resolveSamples(get()); }

  return {
    get, setScope, setStudy, setTeam, setFilter, apply, clearFilters, clearOne, reset,
    activeCount, periodLabel, batches, samples, describe, subscribe, skipsStudyStep,
    FILTER_KEYS
  };
})();
