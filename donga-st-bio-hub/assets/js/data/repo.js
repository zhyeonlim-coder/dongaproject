/* ==========================================================================
   repo.js — 데이터 접근 계층

   계층: 과제(Project) → Study → 팀(Team) → Batch → 측정값
   모든 Study 는 반드시 하나의 과제에 속합니다 (기반 Study · 미지정 개념 폐지).

   모든 함수는 Promise 를 반환합니다 — 나중에 본문만 fetch 로 바꾸면
   호출부는 손대지 않아도 됩니다.
   ========================================================================== */

window.Repo = (function () {
  "use strict";

  const ok = (v) => Promise.resolve(v);
  const clone = (v) => JSON.parse(JSON.stringify(v));

  /* ── 과제 ───────────────────────────────────────────────────────────── */
  function getProjects() { return ok(clone(window.DATA_PROJECTS)); }
  function getProject(id) {
    return ok(clone(window.DATA_PROJECTS.find(p => p.id === id) || null));
  }

  /* ── Study ──────────────────────────────────────────────────────────── */
  function getStudies() { return ok(clone(window.DATA_STUDIES)); }
  function getStudy(id) { return ok(clone(window.DATA_STUDIES.find(s => s.id === id) || null)); }

  function getStudiesByProject(projectId) {
    return ok(clone(window.DATA_STUDIES.filter(s => s.projectId === projectId)));
  }

  /* 최상위 셀렉터용 목록 — 과제 두 개가 전부입니다. */
  function getScopeOptions() {
    const projects = window.DATA_PROJECTS.map(p => ({
      kind: "project", id: p.id, code: p.code, label: p.code || p.name,
      studyCount: window.DATA_STUDIES.filter(s => s.projectId === p.id).length
    }));
    return ok({ projects });
  }

  /* ── 팀 ─────────────────────────────────────────────────────────────── */

  /* TeamDataSet — 이 Study에서 각 팀이 실제로 데이터를 냈는지.
     빈 팀을 "해당 없음"이 아니라 "미입력"으로 구분해 보여주기 위한 근거. */
  /* studyId 하나 또는 studyId 배열을 받습니다.
     과제만 선택하고 Study 를 고르지 않은 상태에서 과제 ID 를 넘기면
     배치가 0건이 되어 "데이터 있음"이 "미입력"으로 오표시됩니다. */
  function getTeamDataSets(studyIdOrIds) {
    const ids = Array.isArray(studyIdOrIds) ? studyIdOrIds : [studyIdOrIds];
    const batches = window.DATA_BATCHES.filter(b => ids.indexOf(b.studyId) > -1);
    const studyId = ids.length === 1 ? ids[0] : null;
    return ok(window.DATA_TEAMS.map(t => {
      const groups = window.DATA_ANALYTE_GROUPS.filter(g => g.team === t.id && !g.empty);
      let filled = 0, total = 0;
      batches.forEach(b => groups.forEach(g => g.items.forEach(it => {
        total++;
        if (valueOf(b, g.id, it.key) !== null) filled++;
      })));
      return {
        studyId, team: t.id, ko: t.ko, short: t.short, color: t.color,
        groupCount: groups.length, filled, total,
        hasData: filled > 0,
        defined: groups.length > 0
      };
    }));
  }

  /* 현재 선택 범위(과제 전체 또는 특정 Study)에 대한 팀별 제출 현황 */
  function getTeamDataSetsForSelection(sel) {
    return getTeamDataSets(studiesInScope(sel).map(x => x.id));
  }

  /* 선택 범위에 해당하는 Study 목록 — 범위 해석은 이 함수 하나만 합니다.
     화면마다 같은 조건문을 복사하면 반드시 한 군데가 어긋납니다. */
  function studiesInScope(sel) {
    const s = sel || {};
    if (!s.scopeId) return [];
    let studies = window.DATA_STUDIES.filter(x => x.projectId === s.scopeId);
    if (s.studyId) studies = studies.filter(x => x.id === s.studyId);
    return studies;
  }

  function valueOf(batch, groupId, key) {
    if (groupId === "upstream" || groupId === "titer") {
      const v = batch.upstream ? batch.upstream[key] : null;
      return v === undefined ? null : v;
    }
    /* 정제 값은 downstream.js 가 채웁니다 (원본 Excel 에는 없는 컬럼) */
    if (groupId === "downstream") {
      const v = batch.downstream ? batch.downstream[key] : null;
      return v === undefined ? null : v;
    }
    const g = batch.analytics ? batch.analytics[groupId] : null;
    const v = g ? g[key] : null;
    return v === undefined ? null : v;
  }

  /* ── Batch ──────────────────────────────────────────────────────────── */
  function getBatches() { return ok(clone(window.DATA_BATCHES)); }
  function getBatch(id) { return ok(clone(window.DATA_BATCHES.find(b => b.id === id) || null)); }
  function getBatchesByStudy(studyId) {
    if (!studyId) return ok([]);
    return ok(clone(window.DATA_BATCHES.filter(b => b.studyId === studyId)));
  }

  /* 전역 선택(selection)을 배치 목록으로 해석합니다.
     이 함수가 "과제를 바꾸면 모든 화면이 함께 바뀐다"의 단일 진입점입니다.

     sel = { scopeKind, scopeId, studyId, team } */
  function resolveBatches(sel) {
    const ids = studiesInScope(sel).map(x => x.id);
    const batches = window.DATA_BATCHES.filter(b => ids.indexOf(b.studyId) > -1);

    /* 팀으로 배치를 걸러내지 않습니다.
       배치는 배양 산물이고(team "upstream"), 분석팀은 그 배치를 측정할 뿐이라
       팀으로 배치를 필터링하면 분석팀 선택 시 결과가 0건이 됩니다.
       팀 선택은 "어떤 측정 항목을 볼지"를 정하는 축이며,
       컬럼 필터링은 getAnalyteGroups(team) 이 담당합니다. */
    return ok(clone(batches));
  }

  /* ── 측정 항목 ──────────────────────────────────────────────────────── */
  function getAnalyteGroups(team) {
    const gs = window.DATA_ANALYTE_GROUPS.filter(g => !team || g.team === team);
    return ok(clone(gs));
  }

  function getActiveTiterDays(batches) {
    const src = batches && batches.length ? batches : window.DATA_BATCHES;
    return window.DATA_TITER_DAYS.filter(d =>
      src.some(b => b.upstream && b.upstream.titer && b.upstream.titer[d] !== null));
  }

  /* Day축 시리즈 (P1-1) — 배치별 Day 곡선.
     metric: "titer" | "vcd"... 현재 Excel은 Titer만 일자별로 존재합니다. */
  function getDaySeries(batches, metric) {
    const days = getActiveTiterDays(batches);
    const series = batches.map(b => ({
      batchId: b.id,
      studyId: b.studyId,
      points: days.map(d => ({
        day: d,
        dayNum: parseInt(d.slice(1), 10),
        value: metric === "titer" ? b.upstream.titer[d] : null
      }))
    }));
    return ok({ days, metric: metric || "titer", series });
  }

  /* ── Data 분류 ──────────────────────────────────────────────────────────
     "무엇을 측정한 값인가" 축입니다. 예전의 Study 유형 필터를 대체합니다.
     정의는 studies.js 의 DATA_CLASSES 에 있고, 여기서는 매칭만 합니다. */

  function dataClass(id) {
    return (window.DATA_CLASSES || []).find(c => c.id === id) || null;
  }

  /* 컬럼 키(data-page 가 쓰는 표기)가 이 분류에 속하는지 */
  function colInClass(colKey, classId) {
    const c = dataClass(classId);
    if (!c) return true;                       // 분류 미선택 = 전부 통과
    if ((c.keys || []).indexOf(colKey) > -1) return true;
    return (c.prefixes || []).some(p => colKey.indexOf(p) === 0);
  }

  /* 검색어가 이 분류를 가리키는지 — 라벨 · 별칭 · id 를 모두 봅니다 */
  function classMatchesTerm(c, term) {
    if (!term) return false;
    return [c.label, c.id].concat(c.alias || [])
      .some(v => v && String(v).toLowerCase().indexOf(term) > -1);
  }

  function getDataClasses(team) {
    return (window.DATA_CLASSES || []).filter(c => !team || c.team === team);
  }

  /* ── 검색 / 필터 ────────────────────────────────────────────────────── */
  function getFilterOptions(sel) {
    const s = sel || {};
    let studies = studiesInScope({ scopeId: s.scopeId });
    if (s.status) studies = studies.filter(x => x.status === s.status);

    const uniq = a => a.filter((v, i) => v !== null && v !== undefined && a.indexOf(v) === i);
    // 팀 옵션은 선택된 Study들이 실제로 데이터를 가진 팀만
    const ids = studies.map(x => x.id);
    const teamsWithData = window.DATA_TEAMS.filter(t =>
      window.DATA_ANALYTE_GROUPS.some(g => g.team === t.id && !g.empty &&
        window.DATA_BATCHES.some(b => ids.indexOf(b.studyId) > -1 &&
          g.items.some(it => valueOf(b, g.id, it.key) !== null))));

    /* Data 분류 옵션 — 팀을 골랐으면 그 팀 항목만 남겨 목록을 짧게 유지 */
    const classes = getDataClasses(s.team).map(c => ({ id: c.id, label: c.label, team: c.team }));

    return ok({
      status:    uniq(studies.map(x => x.status)),
      team:      teamsWithData.map(t => ({ id: t.id, ko: t.ko })),
      dataClass: classes,
      studies:   clone(studies)
    });
  }

  /* 검색어는 Study 명뿐 아니라 Data 분류(예: "Titer", "Step Yield")에도
     걸립니다. 측정 항목으로 검색했을 때는 Study 목록을 좁히지 않습니다 —
     "Titer" 는 모든 Study 에 있는 항목이라 0건으로 만들면 오히려 혼란스럽습니다.
     대신 데이터 조회 화면이 같은 검색어로 컬럼을 좁힙니다. */
  function searchStudies(q, sel) {
    const s = sel || {};
    const term = (q || "").trim().toLowerCase();
    const projById = {};
    window.DATA_PROJECTS.forEach(p => { projById[p.id] = p; });

    const termIsDataClass = term &&
      (window.DATA_CLASSES || []).some(c => classMatchesTerm(c, term));

    /* studyId 로는 좁히지 않습니다 — 이 목록은 "고를 수 있는 Study" 이므로
       이미 고른 하나만 남기면 다른 Study 로 전환할 방법이 사라집니다. */
    const out = studiesInScope({ scopeId: s.scopeId })
      .filter(x => {
        if (s.status && x.status !== s.status) return false;
        if (!term || termIsDataClass) return true;
        const proj = x.projectId ? projById[x.projectId] : null;
        return [x.name, x.id, x.type, proj && proj.code].some(v =>
          v && String(v).toLowerCase().indexOf(term) > -1);
      });
    return ok(clone(out));
  }

  /* ── 표시용 라벨 ────────────────────────────────────────────────────── */

  function projectLabel(study) {
    if (!study) return "—";
    const p = window.DATA_PROJECTS.find(x => x.id === study.projectId);
    return p ? (p.code || p.name) : "—";
  }

  function studyOf(batch) {
    return window.DATA_STUDIES.find(s => s.id === batch.studyId) || null;
  }

  /* ── 평탄화 (조회 테이블 / CSV) ─────────────────────────────────────── */
  function getMeasurementRows(batches) {
    const src = batches || window.DATA_BATCHES;
    const rows = [];
    src.forEach(b => {
      const st = studyOf(b);
      const base = {
        projectLabel: projectLabel(st),
        studyId: b.studyId, studyName: st ? st.name : b.studyId,
        batchId: b.id, expNo: b.expNo, team: b.team,
        initialDate: b.initialDate, endDate: b.endDate
      };
      window.DATA_ANALYTE_GROUPS.forEach(g => {
        if (g.empty) return;
        g.items.forEach(it => {
          rows.push(Object.assign({}, base, {
            groupId: g.id, groupLabel: g.label, groupTeam: g.team,
            key: it.key, label: it.label, unit: it.unit, dp: it.dp,
            value: valueOf(b, g.id, it.key)
          }));
        });
      });
    });
    return ok(rows);
  }

  /* ── 요약 ───────────────────────────────────────────────────────────── */
  function getStudySummary(studyId) {
    const bs = window.DATA_BATCHES.filter(b => b.studyId === studyId);
    const nums = f => bs.map(f).filter(v => v !== null && v !== undefined && isFinite(v));
    const titers = nums(b => b.upstream.titerHCCF);
    const viab = nums(b => b.upstream.finalViability);

    let filled = 0, total = 0;
    bs.forEach(b => window.DATA_ANALYTE_GROUPS.forEach(g => {
      if (g.empty) return;
      g.items.forEach(it => { total++; if (valueOf(b, g.id, it.key) !== null) filled++; });
    }));

    return ok({
      studyId, batchCount: bs.length,
      titerMax: titers.length ? Math.max.apply(null, titers) : null,
      titerMean: titers.length ? titers.reduce((a, c) => a + c, 0) / titers.length : null,
      viabilityMean: viab.length ? viab.reduce((a, c) => a + c, 0) / viab.length : null,
      completeness: total ? filled / total : 0, filled, total
    });
  }

  return {
    getProjects, getProject,
    getStudies, getStudy, getStudiesByProject, studiesInScope,
    getScopeOptions, getTeamDataSets, getTeamDataSetsForSelection,
    getBatches, getBatch, getBatchesByStudy, resolveBatches,
    getAnalyteGroups, getActiveTiterDays, getDaySeries,
    getFilterOptions, searchStudies,
    dataClass, colInClass, classMatchesTerm, getDataClasses,
    projectLabel, studyOf, valueOf,
    getMeasurementRows, getStudySummary
  };
})();
