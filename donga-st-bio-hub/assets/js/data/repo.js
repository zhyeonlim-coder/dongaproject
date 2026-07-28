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
      const c = completeness(batches, groups);
      return {
        studyId, team: t.id, ko: t.ko, short: t.short, color: t.color,
        groupCount: groups.length, filled: c.filled, total: c.total,
        hasData: c.filled > 0,
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

  /* ── 완성도 집계 ────────────────────────────────────────────────────────
     "몇 칸이 채워졌나"를 셀 때는 EBR 입력을 반영해야 합니다. 특히
     **해당 없음(NA)** 은 분모에서 빼야 맞습니다 — 존재하지 않는 항목을
     미입력으로 세면 완성도가 영원히 100%가 되지 않습니다.
     불검출(ND)은 시험을 수행한 결과이므로 채워진 것으로 셉니다.

     그래프는 이 경로를 쓰지 않고 원본(Excel)만 씁니다. 원본과 입력값이
     한 선에 섞이면 화면에서 어느 쪽인지 구분할 수 없기 때문입니다. */

  /* 스키마 좌표(groupId, key) → EBR 필드 키. ebr-page 의 명명과 같아야 합니다. */
  function fieldKey(groupId, key) {
    return (groupId === "upstream" || groupId === "titer") ? key : groupId + "_" + key;
  }

  function stateOfRecord(rec, fallback) {
    if (rec && window.VAL) {
      if (!window.VAL.countsTowardCompleteness(rec.value)) return "excluded";
      return window.VAL.isFilled(rec.value) ? "filled" : "empty";
    }
    return fallback !== null && fallback !== undefined ? "filled" : "empty";
  }

  /* "filled" | "empty" | "excluded" — 배치 단위 (분석은 대표 시료 기준) */
  function cellState(batch, groupId, key) {
    const isAnalytics = groupId !== "upstream" && groupId !== "titer" && groupId !== "downstream";
    if (isAnalytics) {
      const s = primarySample(batch.id);
      return s ? cellStateSample(s, groupId, key) : "empty";
    }
    const rec = window.Entries
      ? window.Entries.getValue("batch:" + batch.id, fieldKey(groupId, key)) : null;
    return stateOfRecord(rec, valueOf(batch, groupId, key));
  }

  /* 시료 단위 */
  function cellStateSample(sample, groupId, key) {
    const rec = window.Entries
      ? window.Entries.getValue("sample:" + sample.id, fieldKey(groupId, key)) : null;
    const g = sample.analytics ? sample.analytics[groupId] : null;
    const raw = g ? g[key] : null;
    return stateOfRecord(rec, raw === undefined ? null : raw);
  }

  /* 완성도 — 배양·정제는 배치 칸을, 분석은 **시료 칸**을 셉니다.
     시료를 채취해 놓고 분석하지 않았으면 그만큼 덜 찬 것이 맞습니다. */
  function completeness(batches, groups) {
    let filled = 0, total = 0;
    const tally = function (state) {
      if (state === "excluded") return;            // 해당 없음 — 분모에서 제외
      total++;
      if (state === "filled") filled++;
    };
    (batches || []).forEach(function (b) {
      const samples = samplesOfBatch(b.id);
      (groups || []).forEach(function (g) {
        if (g.empty) return;
        if (g.team === "analytics") {
          samples.forEach(s => g.items.forEach(it => tally(cellStateSample(s, g.id, it.key))));
        } else {
          g.items.forEach(it => tally(cellState(b, g.id, it.key)));
        }
      });
    });
    return { filled, total };
  }

  /* ── 값 읽기 ────────────────────────────────────────────────────────────
     배양·정제는 배치 속성이고, 분석은 시료 속성입니다.
     배치로 분석값을 물으면 그 배치의 **대표 시료** 값을 돌려줍니다 —
     배치 한 줄짜리 화면(KPI·요약)이 계속 동작해야 하기 때문입니다.
     시료별로 봐야 하는 화면은 valueOfSample 을 씁니다. */
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
    const s = primarySample(batch.id);
    return s ? valueOfSample(s, groupId, key) : null;
  }

  /* ── 시료(Sample) ───────────────────────────────────────────────────────
     Excel 유래 시료(DATA_SAMPLES) + 사용자가 EBR 에서 추가한 시료(Entries)를
     한 목록으로 합칩니다. 화면이 두 출처를 따로 알 필요가 없도록. */
  function samplesOfBatch(batchId) {
    const base = (window.DATA_SAMPLES || [])
      .filter(s => s.active !== false && s.batchId === batchId);
    const user = (window.Entries ? window.Entries.getSamples(batchId) : []).map(s => ({
      id: s.id, batchId: s.batchId, studyId: s.studyId, name: s.name,
      stage: null, collectedAt: s.createdAt ? String(s.createdAt).slice(0, 10) : null,
      source: "user", primary: false, active: true,
      note: s.note || null, analytics: null
    }));
    return base.concat(user);
  }

  /* 대표 시료 — 배치 단위로 분석값을 하나만 보여야 할 때 씁니다 */
  function primarySample(batchId) {
    const list = samplesOfBatch(batchId);
    return list.find(s => s.primary) || list[0] || null;
  }

  /* 시료의 분석값. EBR 입력이 있으면 그쪽이 원본보다 우선합니다. */
  function valueOfSample(sample, groupId, key) {
    if (!sample) return null;
    if (window.Entries && window.VAL) {
      const rec = window.Entries.getValue("sample:" + sample.id, fieldKey(groupId, key));
      if (rec) return window.VAL.numeric(rec.value);
    }
    const g = sample.analytics ? sample.analytics[groupId] : null;
    const v = g ? g[key] : null;
    return v === undefined ? null : v;
  }

  /* 선택 범위의 시료 목록 — 배치를 먼저 좁힌 뒤 그 하위 시료를 폅니다 */
  function resolveSamples(sel) {
    return resolveBatches(sel).then(function (batches) {
      const out = [];
      batches.forEach(function (b) {
        samplesOfBatch(b.id).forEach(function (s) {
          out.push(Object.assign({}, s, {
            batchInitialDate: b.initialDate,
            batchEndDate: b.endDate
          }));
        });
      });
      return sortRows(out, (sel || {}).sort, "sample");
    });
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
  /* ── 기간 필터 ──────────────────────────────────────────────────────────
     배치는 시작~종료로 기간을 갖습니다. "겹치면 포함" 규칙을 씁니다 —
     기간 안에 시작하거나 끝나기만 해도 그 기간의 일이기 때문입니다.

     날짜가 아예 없는 배치는 기간을 걸면 **제외**합니다. 남겨 두면 어느
     기간으로 걸러도 계속 나타나, 2030년으로 걸러도 한 건이 남는 식이 됩니다.
     대신 몇 건이 그렇게 빠졌는지 화면에 알립니다 (undatedExcluded) —
     조용히 사라지면 데이터가 없어진 것처럼 보이기 때문입니다. */
  function inRange(b, from, to) {
    if (!from && !to) return true;
    const s = b.initialDate || b.endDate;
    const e = b.endDate || b.initialDate;
    if (!s && !e) return false;                 // 날짜 미기재 — 기간 판단 불가
    if (from && e && e < from) return false;
    if (to && s && s > to) return false;
    return true;
  }

  /* 기간 조건 때문에 빠진 "날짜 미기재" 배치 수 */
  function undatedExcluded(sel) {
    const s = sel || {};
    if (!s.from && !s.to) return 0;
    const ids = studiesInScope(s).map(x => x.id);
    return window.DATA_BATCHES.filter(b =>
      ids.indexOf(b.studyId) > -1 && !b.initialDate && !b.endDate).length;
  }

  /* ── 정렬 ───────────────────────────────────────────────────────────────
     조회 결과는 항상 정해진 순서로 나와야 합니다. 기본은 최신 날짜순이고,
     날짜가 같으면 ID 로 갈라 매번 같은 순서가 나오게 합니다. */
  const SORTS = {
    "date-desc": "최신 날짜순",
    "date-asc":  "오래된 날짜순",
    "id-asc":    "ID 오름차순",
    "id-desc":   "ID 내림차순"
  };
  const DEFAULT_SORT = "date-desc";

  /* "B123-2" 와 "B123-12" 를 사람이 읽는 순서로 — 사전순으로 하면 12 가 2 앞에 옵니다 */
  function natCmp(a, b) {
    const ax = String(a).match(/(\d+|\D+)/g) || [];
    const bx = String(b).match(/(\d+|\D+)/g) || [];
    for (let i = 0; i < Math.max(ax.length, bx.length); i++) {
      const x = ax[i], y = bx[i];
      if (x === undefined) return -1;
      if (y === undefined) return 1;
      const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
      if (nx && ny) { const d = +x - +y; if (d) return d; }
      else if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }

  function sortRows(rows, sort, kind) {
    const mode = SORTS[sort] ? sort : DEFAULT_SORT;
    const dateOf = r => (kind === "sample")
      ? (r.collectedAt || r.batchEndDate || r.batchInitialDate || "")
      : (r.initialDate || r.endDate || "");
    return rows.slice().sort(function (a, b) {
      if (mode === "id-asc")  return natCmp(a.id, b.id);
      if (mode === "id-desc") return natCmp(b.id, a.id);
      const da = dateOf(a), db = dateOf(b);
      /* 날짜 없는 행은 방향과 무관하게 뒤로 — 위에 올라오면 목록이 이상해집니다 */
      if (!da && !db) return natCmp(a.id, b.id);
      if (!da) return 1;
      if (!db) return -1;
      const d = mode === "date-asc" ? da.localeCompare(db) : db.localeCompare(da);
      return d || natCmp(a.id, b.id);
    });
  }

  function resolveBatches(sel) {
    const s = sel || {};
    const ids = studiesInScope(s).map(x => x.id);
    const batches = window.DATA_BATCHES
      .filter(b => ids.indexOf(b.studyId) > -1)
      .filter(b => inRange(b, s.from, s.to));

    /* 팀으로 배치를 걸러내지 않습니다.
       배치는 배양 산물이고(team "upstream"), 분석팀은 그 배치를 측정할 뿐이라
       팀으로 배치를 필터링하면 분석팀 선택 시 결과가 0건이 됩니다.
       팀 선택은 "어떤 측정 항목을 볼지"를 정하는 축이며,
       컬럼 필터링은 getAnalyteGroups(team) 이 담당합니다. */
    return ok(sortRows(clone(batches), s.sort, "batch"));
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

    const c = completeness(bs, window.DATA_ANALYTE_GROUPS);
    const filled = c.filled, total = c.total;

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
    samplesOfBatch, primarySample, valueOfSample, resolveSamples,
    SORTS, DEFAULT_SORT, sortRows, natCmp, inRange, undatedExcluded,
    getAnalyteGroups, getActiveTiterDays, getDaySeries,
    fieldKey, cellState, cellStateSample, completeness,
    getFilterOptions, searchStudies,
    dataClass, colInClass, classMatchesTerm, getDataClasses,
    projectLabel, studyOf, valueOf,
    getMeasurementRows, getStudySummary
  };
})();
