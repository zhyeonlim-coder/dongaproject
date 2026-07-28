/* ==========================================================================
   Selection — 전역 선택 상태  [P0-2]

   과제(또는 기반 Study) → Study → 팀 선택을 앱 전체가 공유합니다.
   대시보드 · EBR · 데이터 조회 · DoE · 일정이 모두 여기만 읽고 씁니다.
   localStorage 에 저장되어 메뉴를 이동해도 유지됩니다.

   ── 과제 전환 시 이전 데이터가 남는 버그를 구조적으로 막는 방식 ──────────
   scopeId 가 바뀌면 studyId · team 을 **무조건** 비웁니다. 화면이 알아서
   지우기를 기대하지 않습니다. 이전 과제의 studyId 가 남아 있으면
   resolveBatches() 가 빈 배열을 돌려주고 화면에는 "데이터 없음"이 뜨는데,
   이게 실제로는 "이전 선택이 남아 있음" 이라 원인을 찾기 어렵기 때문입니다.

     Selection.get() / .setScope(kind,id) / .setStudy(id) / .setTeam(id)
     Selection.reset() / .subscribe(fn) / .batches()
   ========================================================================== */

window.Scope = (function () {
  "use strict";

  const KEY = "hub.selection.v2";
  const EMPTY = {
    scopeKind: null,   // "project" | "platform" | "unassigned"
    scopeId: null,
    studyId: null,
    team: null,
    q: "",
    type: null,
    status: null
  };

  const subs = [];
  let state;

  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? Object.assign({}, EMPTY, JSON.parse(raw)) : Object.assign({}, EMPTY);
  } catch (e) { state = Object.assign({}, EMPTY); }

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
    state.type = null;
    state.status = null;
    emit("scope");
    return get();
  }

  /* 기반 Study는 Study 단계를 건너뜁니다 — 스스로가 Study이므로
     scope 선택만으로 곧바로 팀별 데이터에 도달합니다. */
  function skipsStudyStep() {
    return state.scopeKind === "platform" || state.scopeKind === "unassigned";
  }

  function setStudy(id) {
    if (skipsStudyStep()) return get();     // 무시 — 단계가 없음
    if (state.studyId === id) return get();
    state.studyId = id || null;
    state.team = null;
    emit("study");
    return get();
  }

  function setTeam(id) {
    if (state.team === id) return get();
    state.team = id || null;
    emit("team");
    return get();
  }

  function setFilter(patch) {
    let changed = false;
    ["q", "type", "status"].forEach(k => {
      if (patch.hasOwnProperty(k) && state[k] !== patch[k]) { state[k] = patch[k]; changed = true; }
    });
    if (changed) emit("filter");
    return get();
  }

  function clearOne(key) {
    if (key === "scope") return setScope(null, null);
    if (key === "studyId") return setStudy(null);
    if (key === "team") return setTeam(null);
    if (key === "q") return setFilter({ q: "" });
    if (key === "type" || key === "status") { const p = {}; p[key] = null; return setFilter(p); }
    return get();
  }

  function reset() { state = Object.assign({}, EMPTY); emit("reset"); return get(); }

  function activeCount() {
    let n = 0;
    if (state.scopeId) n++;
    if (state.studyId) n++;
    if (state.team) n++;
    if (state.q && state.q.trim()) n++;
    if (state.type) n++;
    if (state.status) n++;
    return n;
  }

  /* 현재 선택에 해당하는 배치 — 화면들이 반복 구현하지 않도록 여기 한 곳에 */
  function batches() { return window.Repo.resolveBatches(get()); }

  /* 선택 요약 라벨 (브레드크럼용) */
  function describe() {
    const s = get();
    if (!s.scopeId) return { scope: null, study: null, team: null, path: [] };
    const path = [];
    let scopeLabel = null;

    if (s.scopeKind === "project") {
      const p = window.DATA_PROJECTS.find(x => x.id === s.scopeId);
      scopeLabel = p ? (p.code || p.name) : s.scopeId;
    } else {
      const st = window.DATA_STUDIES.find(x => x.id === s.scopeId);
      scopeLabel = st ? st.name : s.scopeId;
    }
    path.push({ key: "scope", label: scopeLabel });

    let studyLabel = null;
    if (s.studyId) {
      const st = window.DATA_STUDIES.find(x => x.id === s.studyId);
      studyLabel = st ? st.name : s.studyId;
      path.push({ key: "studyId", label: studyLabel });
    }
    let teamLabel = null;
    if (s.team) {
      const t = window.DATA_TEAMS.find(x => x.id === s.team);
      teamLabel = t ? t.ko : s.team;
      path.push({ key: "team", label: teamLabel });
    }
    return { scope: scopeLabel, study: studyLabel, team: teamLabel, path, skipsStudyStep: skipsStudyStep() };
  }

  function subscribe(fn) {
    subs.push(fn);
    return () => { const i = subs.indexOf(fn); if (i > -1) subs.splice(i, 1); };
  }

  return {
    get, setScope, setStudy, setTeam, setFilter, clearOne, reset,
    activeCount, batches, describe, subscribe, skipsStudyStep
  };
})();
