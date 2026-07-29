/* ==========================================================================
   데이터 조회  [지시서 §3 §4]

   · '배치별(가로)' / '측정값별(세로)' 탭 분리 제거 — 단일 테이블
   · 선택한 Study 중심
   · 다중 컬럼 정렬 (Shift+클릭으로 2·3차 정렬 추가)
   · 컬럼 필터 + 조건 칩
   · Sample Name 자유 추가 (creatable) + 샘플별 모아보기
   · CSV 내보내기
   ========================================================================== */

(function () {
  "use strict";

  const user = window.Shell.mount({ page: "data" });
  if (!user) return;

  const L = window.LABELS;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  /* 다중 정렬 — [{key, dir}] 순서대로 우선순위.
     비어 있으면 조회 조건의 정렬(최신 날짜순 등)을 그대로 씁니다.
     컬럼을 눌러 직접 정렬한 순간부터 이쪽이 우선합니다. */
  let sorts = [];
  let groupBy = "batch";        // "batch" | "sample"
  let colFilters = {};          // { colKey: "부분일치 문자열" }

  window.Shell.subnav([
    { label: "조회 단위", items: [
      { key: "batch",   ko: "배치별", active: true },
      { key: "sample",  ko: "시료별", active: false },
      { key: "compare", ko: "배치 비교", active: false }
    ]},
    { label: "바로가기", items: [
      { ko: "대시보드", href: "dashboard.html" },
      { ko: "EBR 입력", href: "ebr.html" },
      { ko: "연구 지식", href: "knowledge.html" }
    ]}
  ], k => { groupBy = k; render(); });

  /* ══════════════════════════════════════════════════════════════════════
     배치 비교 — "이 배치만 왜 달랐나"

     여러 배치를 나란히 놓는 것까지는 표로도 됩니다. 사람이 못 하는 건
     **어느 항목이 실제로 다른지** 를 골라내는 일입니다. 그래서 값이 서로
     비슷한 행은 접고, 편차가 큰 행만 위로 올려 표시합니다.
     ══════════════════════════════════════════════════════════════════════ */
  let cmpPicked = [];
  const CMP_MAX = 4;

  /* 상대 편차 — 값의 크기가 제각각이라(ppm vs %) 절대 차이로는 비교가 안 됩니다.
     중앙값 대비 폭으로 재야 항목끼리 견줄 수 있습니다. */
  function spreadOf(vals) {
    const v = vals.filter(x => x !== null && x !== undefined && isFinite(x));
    if (v.length < 2) return null;
    const lo = Math.min.apply(null, v), hi = Math.max.apply(null, v);
    const mid = (lo + hi) / 2;
    if (!mid) return hi - lo === 0 ? 0 : 1;
    return Math.abs(hi - lo) / Math.abs(mid);
  }

  function compareView(batches) {
    if (batches.length < 2) {
      return '<div class="empty"><div class="empty-title">비교할 배치가 부족합니다</div>' +
        '<div class="empty-body">이 범위에 배치가 2건 이상이어야 비교할 수 있습니다.</div></div>';
    }

    const cols = cmpPicked.map(id => batches.find(b => b.id === id)).filter(Boolean);
    const picked = cmpPicked;

    /* 비교 대상 항목 — 배양 지표, 정제, 그리고 배치 메타 */
    const rows = [];
    rows.push({ group: "기간", label: "배양 일수", unit: "일", dp: 0,
                get: b => b.cultureDays });
    window.DATA_ANALYTE_GROUPS.forEach(function (g) {
      if (g.empty || g.team === "analytics") return;      // 분석은 시료 축이라 제외
      g.items.forEach(it => rows.push({
        group: g.label, label: it.label, unit: it.unit, dp: it.dp,
        get: b => window.Repo.valueOf(b, g.id, it.key)
      }));
    });

    const scored = rows.map(function (r) {
      const vals = cols.map(r.get);
      return { r: r, vals: vals, spread: spreadOf(vals) };
    });
    const diff = scored.filter(x => x.spread !== null && x.spread >= 0.1)
                       .sort((a, b) => b.spread - a.spread);
    const same = scored.filter(x => diff.indexOf(x) === -1);

    const cell = (v, dp) => (v === null || v === undefined || !isFinite(v))
      ? '<td class="na">' + L.empty + '</td>'
      : '<td class="mono">' + Number(v).toFixed(dp) + '</td>';

    const table = (list, mark) => list.map(function (x) {
      const nums = x.vals.filter(v => v !== null && isFinite(v));
      const hi = nums.length ? Math.max.apply(null, nums) : null;
      const lo = nums.length ? Math.min.apply(null, nums) : null;
      return '<tr' + (mark ? ' class="cmp-diff"' : "") + '>' +
        '<th scope="row"><span style="font-size:10px;color:var(--c-text-mute);display:block">' +
          esc(x.r.group) + '</span>' + esc(x.r.label) +
          '<span style="font-weight:400;color:var(--c-text-soft)"> ' + esc(x.r.unit) + '</span></th>' +
        x.vals.map(function (v) {
          if (v === null || v === undefined || !isFinite(v)) return cell(v, x.r.dp);
          const tag = (nums.length > 1 && v === hi) ? " is-hi" : (nums.length > 1 && v === lo) ? " is-lo" : "";
          return '<td class="mono' + tag + '">' + Number(v).toFixed(x.r.dp) + '</td>';
        }).join("") +
        '<td class="mono" style="color:var(--c-text-mute)">' +
          (x.spread === null ? "—" : Math.round(x.spread * 100) + "%") + '</td>' +
      '</tr>';
    }).join("");

    return '<div class="card-body" style="border-bottom:1px solid var(--c-border)">' +
        '<div class="eyebrow" style="margin-bottom:var(--s-2)">비교할 배치 (최대 ' + CMP_MAX + '개)</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
          batches.map(b => '<button class="mm-chip" data-cmp="' + esc(b.id) + '" ' +
            'aria-pressed="' + (picked.indexOf(b.id) > -1) + '">' + esc(b.id) + '</button>').join("") +
        '</div></div>' +

      '<div class="tbl-scroll"><table class="tbl cmp-tbl"><thead><tr>' +
        '<th scope="col">항목</th>' +
        cols.map(b => '<th scope="col"><span class="mono">' + esc(b.id) + '</span>' +
          '<br><span style="font-weight:400;text-transform:none;font-size:10px">' +
          esc(b.initialDate || "") + '</span></th>').join("") +
        '<th scope="col">편차</th>' +
      '</tr></thead><tbody>' +
        (diff.length
          ? '<tr class="cmp-sep"><th scope="row" colspan="' + (cols.length + 2) + '">' +
            '차이가 큰 항목 ' + diff.length + '건 (중앙값 대비 10% 이상)</th></tr>' + table(diff, true)
          : '<tr class="cmp-sep"><th scope="row" colspan="' + (cols.length + 2) + '">' +
            '뚜렷한 차이가 없습니다</th></tr>') +
        '<tr class="cmp-sep"><th scope="row" colspan="' + (cols.length + 2) + '">' +
          '비슷한 항목 ' + same.length + '건</th></tr>' + table(same, false) +
      '</tbody></table></div>' +

      '<div class="card-body">' +
        '<p style="font-size:11.5px;color:var(--c-text-mute);margin:0;line-height:1.7">' +
        '편차는 <b>(최댓값 − 최솟값) ÷ 중앙값</b> 입니다. 단위가 다른 항목끼리 견주려면 ' +
        '절대 차이가 아니라 상대 폭으로 재야 합니다. 각 행에서 가장 큰 값은 파랑, 가장 작은 값은 주황입니다.<br>' +
        '분석 항목은 시료마다 값이 달라 이 표에 넣지 않았습니다 — <b>시료별</b> 보기에서 확인하세요.</p>' +
      '</div>';
  }

  /* ── 컬럼 정의 ──────────────────────────────────────────────────────────
     식별 컬럼(과제 · Study · Exp. No. …)은 항상 남기고, 측정 컬럼만
     팀 · Data 분류 · 검색어로 좁힙니다. 식별 컬럼까지 사라지면 어느 배치의
     값인지 알 수 없게 되기 때문입니다. */
  function columns(titerDays) {
    const sel = window.Scope.get();
    const team = sel.team;

    const base = [
      { key: "projectLabel", label: "과제",      type: "s", w: 120 },
      { key: "studyName",    label: "Study",     type: "s", w: 140 },
      { key: "teamLabel",    label: "팀",        type: "s", w: 80 },
      { key: "id",           label: "Exp. No.",  type: "s", w: 90 }
    ];
    if (groupBy === "sample") {
      base.push({ key: "sampleName", label: L.ui.sampleName, type: "s", w: 150 });
    }
    base.push({ key: "initialDate", label: "Initial Date", type: "s", w: 100 });
    base.push({ key: "endDate",     label: "End Date",     type: "s", w: 100 });

    const measure = [];

    if (!team || team === "upstream") {
      measure.push({ key: "cultureDays", label: "Days", type: "n", dp: 0, w: 60 });
      [["ivcd","IVCD",1],["maxVCD","Max VCD",2],["finalVCD","Final VCD",2],
       ["finalViability","Viability (%)",1]].forEach(x =>
        measure.push({ key: x[0], label: x[1], type: "n", dp: x[2], w: 92 }));
      titerDays.forEach(d => measure.push({ key: "titer." + d, label: "Titer " + d, type: "n", dp: 0, w: 88 }));
      measure.push({ key: "titerHCCF", label: "Titer HCCF", type: "n", dp: 1, w: 96 });
      measure.push({ key: "qP",        label: "qP",         type: "n", dp: 2, w: 80 });
    }

    /* 정제 · 분석 그룹 (배양 그룹은 위에서 일자별 Titer까지 함께 처리했습니다) */
    window.DATA_ANALYTE_GROUPS.forEach(g => {
      if (g.empty || g.team === "upstream") return;
      if (team && g.team !== team) return;
      g.items.forEach(it => measure.push({
        key: g.id + "." + it.key, label: g.label + " " + it.label,
        type: "n", dp: it.dp, w: 108
      }));
    });

    return base.concat(narrowMeasures(measure, sel));
  }

  /* Data 분류 선택 → 그 분류의 컬럼만.
     검색어 → 컬럼 라벨이나 Data 분류 별칭에 걸리는 컬럼만.
     둘 다 걸리는 게 없으면 좁히지 않습니다 — 검색 한 글자에 표가 빈
     껍데기가 되는 것보다 전부 보여주는 편이 낫습니다. */
  function narrowMeasures(measure, sel) {
    let out = measure;

    if (sel.dataClass) {
      out = out.filter(c => window.Repo.colInClass(c.key, sel.dataClass));
    }

    const term = (sel.q || "").trim().toLowerCase();
    if (term) {
      const classHits = window.Repo.getDataClasses()
        .filter(dc => window.Repo.classMatchesTerm(dc, term));
      const hit = out.filter(c =>
        c.label.toLowerCase().indexOf(term) > -1 ||
        classHits.some(dc => window.Repo.colInClass(c.key, dc.id)));
      if (hit.length) out = hit;
    }
    return out;
  }

  function cellValue(row, key) {
    if (["projectLabel","studyName","teamLabel","sampleName","id","initialDate","endDate","cultureDays"].indexOf(key) > -1)
      return row[key];
    if (key.indexOf("titer.") === 0) return row.upstream ? row.upstream.titer[key.slice(6)] : null;
    /* 정제 값은 batch.downstream 에 있습니다 (downstream.js 가 채움) */
    if (key.indexOf("downstream.") === 0)
      return row.downstream ? row.downstream[key.slice(11)] : null;
    if (key.indexOf(".") > -1) {
      /* 분석값은 시료에 붙습니다. 배치별 보기에서는 그 배치의 대표 시료 값을
         보여주고, 샘플별 보기에서는 그 행의 시료 값을 보여줍니다. */
      const p = key.split(".");
      return row._sample ? window.Repo.valueOfSample(row._sample, p[0], p[1]) : null;
    }
    if (row.upstream && row.upstream[key] !== undefined) return row.upstream[key];
    return row[key] === undefined ? null : row[key];
  }

  /* ── 행 구성 ──────────────────────────────────────────────────────────
     배치별 보기: 한 배치 = 한 행. 분석 컬럼은 그 배치의 대표 시료 값.
     샘플별 보기: 한 시료 = 한 행. 분석 컬럼은 그 시료의 값.

     배치별 보기에서 분석값이 대표 시료 것이라는 사실은 화면에 밝힙니다 —
     한 배치에 시료가 여럿일 때 어느 값인지 모르면 잘못 읽습니다. */
  function buildRows(batches, studies) {
    const teamById = {};
    window.DATA_TEAMS.forEach(t => { teamById[t.id] = t; });

    const decorate = (b) => {
      const st = studies.find(s => s.id === b.studyId) || null;
      return Object.assign({}, b, {
        studyName: st ? st.name : b.studyId,
        projectLabel: window.Repo.projectLabel(st),
        teamLabel: teamById[b.team] ? teamById[b.team].short : b.team
      });
    };

    if (groupBy === "batch") {
      return batches.map(b => Object.assign(decorate(b), {
        _sample: window.Repo.primarySample(b.id)
      }));
    }

    const out = [];
    batches.forEach(function (b) {
      const d = decorate(b);
      const samples = window.Repo.samplesOfBatch(b.id);
      if (!samples.length) {
        out.push(Object.assign({}, d, { sampleName: null, sampleId: null, _sample: null }));
        return;
      }
      samples.forEach(s => out.push(Object.assign({}, d, {
        sampleName: s.name, sampleId: s.id, sampleStage: s.stage, _sample: s
      })));
    });
    return out;
  }

  /* ── 정렬 ───────────────────────────────────────────────────────────── */
  function applySort(rows) {
    if (!sorts.length) return rows;
    return rows.slice().sort(function (a, b) {
      for (let i = 0; i < sorts.length; i++) {
        const s = sorts[i];
        const va = cellValue(a, s.key), vb = cellValue(b, s.key);
        // 미입력은 정렬 방향과 무관하게 항상 뒤로
        if (va === null && vb === null) continue;
        if (va === null) return 1;
        if (vb === null) return -1;
        let c;
        if (typeof va === "number" && typeof vb === "number") c = va - vb;
        else c = String(va).localeCompare(String(vb));
        if (c !== 0) return c * s.dir;
      }
      return 0;
    });
  }

  function toggleSort(key, additive) {
    const i = sorts.findIndex(s => s.key === key);
    if (additive) {
      if (i > -1) sorts[i].dir *= -1;
      else sorts.push({ key, dir: 1 });
    } else {
      if (i === 0 && sorts.length === 1) sorts[0].dir *= -1;
      else sorts = [{ key, dir: 1 }];
    }
    render();
  }

  function applyColFilters(rows) {
    const keys = Object.keys(colFilters).filter(k => colFilters[k]);
    if (!keys.length) return rows;
    return rows.filter(r => keys.every(k => {
      const v = cellValue(r, k);
      if (v === null) return false;
      return String(v).toLowerCase().indexOf(colFilters[k].toLowerCase()) > -1;
    }));
  }

  /* ── 렌더 ───────────────────────────────────────────────────────────── */
  function render() {
    const sel = window.Scope.get();

    if (!sel.scopeId) {
      $("#count").textContent = "과제 미선택";
      $("#table-host").innerHTML =
        '<div class="empty"><div class="empty-title">과제를 선택하세요</div>' +
        '<div class="empty-body">상단 우측 셀렉터에서 선택하면 해당 범위의 데이터만 표시됩니다.</div></div>';
      $("#sample-bar").innerHTML = "";
      return;
    }

    Promise.all([window.Scope.batches(), window.Repo.getStudies()]).then(function (res) {
      const batches = res[0], studies = res[1];

      /* 배치 비교는 표 구조가 완전히 달라(항목이 행, 배치가 열) 따로 그립니다 */
      if (groupBy === "compare") {
        /* 선택을 여기서 확정해 둡니다. 그리는 쪽에서 임시로 채우면 그 값이
           남지 않아, 사용자가 네 번째 배치를 눌러도 다시 기본값으로 돌아갑니다. */
        cmpPicked = cmpPicked.filter(id => batches.some(b => b.id === id));
        if (cmpPicked.length < 2) {
          cmpPicked = batches.slice(0, Math.min(3, batches.length)).map(b => b.id);
        }
        $("#count").textContent = batches.length + "개 배치 중 " +
          cmpPicked.length + "개 비교 (최대 " + CMP_MAX + ")";
        $("#sample-bar").innerHTML = "";
        $("#sort-chips").innerHTML = "";
        $("#table-host").innerHTML = compareView(batches);
        $$("[data-cmp]").forEach(b => b.addEventListener("click", function () {
          const id = b.dataset.cmp;
          const i = cmpPicked.indexOf(id);
          if (i > -1) cmpPicked.splice(i, 1);
          else if (cmpPicked.length < CMP_MAX) cmpPicked.push(id);
          render();
        }));
        return;
      }

      const titerDays = window.DATA_TITER_DAYS.filter(d =>
        batches.some(b => b.upstream.titer[d] !== null));

      let rows = buildRows(batches, studies);
      rows = applyColFilters(rows);
      rows = applySort(rows);

      const cols = columns(titerDays);
      const sortLabel = window.Repo.SORTS[sel.sort] || window.Repo.SORTS[window.Repo.DEFAULT_SORT];
      const undated = window.Repo.undatedExcluded(sel);
      $("#count").textContent = rows.length + (groupBy === "sample" ? "행 (시료별)" : "개 배치") +
        " · " + sortLabel +
        (window.Scope.periodLabel() ? " · " + window.Scope.periodLabel() : "") +
        (undated ? " · 날짜 미기재 " + undated + "건 제외" : "") +
        " · " + (titerDays.length ? "Titer " + titerDays[0] + "~" + titerDays[titerDays.length - 1] : "Titer 미입력");

      paintSampleBar(batches);
      paintSortChips(cols);

      $("#table-host").innerHTML = rows.length
        ? '<div class="tbl-scroll"><table class="tbl" style="min-width:' +
            cols.reduce((n, c) => n + c.w, 0) + 'px">' +
            '<thead><tr>' + cols.map(function (c) {
              const si = sorts.findIndex(s => s.key === c.key);
              const ind = si > -1
                ? '<span class="sort-ind">' + (sorts[si].dir === 1 ? "▲" : "▼") +
                  (sorts.length > 1 ? '<sub>' + (si + 1) + '</sub>' : "") + '</span>'
                : '<span class="sort-ind sort-ind-off">↕</span>';
              return '<th scope="col" style="min-width:' + c.w + 'px">' +
                '<button class="sort-btn" data-sort="' + esc(c.key) + '" ' +
                  'title="클릭: 정렬 · Shift+클릭: 정렬 추가" ' +
                  'aria-label="' + esc(c.label) + ' 기준 정렬">' + esc(c.label) + ind + '</button>' +
                '<input class="col-filter" data-cf="' + esc(c.key) + '" value="' +
                  esc(colFilters[c.key] || "") + '" placeholder="필터" ' +
                  'aria-label="' + esc(c.label) + ' 필터">' +
              '</th>';
            }).join("") + '</tr></thead>' +
            '<tbody>' + rows.map(r =>
              '<tr>' + cols.map(function (c) {
                const v = cellValue(r, c.key);
                if (v === null || v === undefined)
                  return '<td class="na">' + (c.key === "sampleName" ? "(샘플 미생성)" : L.empty) + '</td>';
                return '<td' + (c.type === "n" ? ' class="mono"' : "") + '>' +
                  esc(c.type === "n" ? Number(v).toFixed(c.dp) : v) + '</td>';
              }).join("") + '</tr>').join("") +
            '</tbody></table></div>'
        : '<div class="empty"><div class="empty-title">' + esc(L.noResult) + '</div>' +
          '<div class="empty-body">' + esc(L.noResultHint) +
          ' 표 안의 컬럼 필터도 함께 확인하세요.</div></div>';

      $$("[data-sort]").forEach(b => b.addEventListener("click", e => toggleSort(b.dataset.sort, e.shiftKey)));
      $$("[data-cf]").forEach(function (inp) {
        inp.addEventListener("click", e => e.stopPropagation());
        let t = null;
        inp.addEventListener("input", function () {
          clearTimeout(t);
          const k = inp.dataset.cf, val = inp.value, pos = inp.selectionStart;
          t = setTimeout(function () {
            colFilters[k] = val;
            render();
            const n = document.querySelector('[data-cf="' + k + '"]');
            if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} }
          }, 250);
        });
      });
    });
  }

  function paintSortChips(cols) {
    const host = $("#sort-chips");
    const labelOf = k => (cols.find(c => c.key === k) || {}).label || k;
    const filterKeys = Object.keys(colFilters).filter(k => colFilters[k]);
    if (!sorts.length && !filterKeys.length) { host.innerHTML = ""; return; }

    host.innerHTML =
      sorts.map((s, i) =>
        '<span class="chip"><span class="chip-k">정렬 ' + (i + 1) + '</span>' +
          esc(labelOf(s.key)) + (s.dir === 1 ? " ▲" : " ▼") +
          '<button class="chip-x" data-unsort="' + esc(s.key) + '" aria-label="정렬 해제">' +
          '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
          'stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></span>').join("") +
      filterKeys.map(k =>
        '<span class="chip"><span class="chip-k">필터</span>' + esc(labelOf(k)) + ': ' + esc(colFilters[k]) +
          '<button class="chip-x" data-unfilter="' + esc(k) + '" aria-label="필터 해제">' +
          '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
          'stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></span>').join("");

    /* 정렬을 모두 풀면 조회 조건의 정렬로 되돌아갑니다 */
    $$("[data-unsort]").forEach(b => b.addEventListener("click", () => {
      sorts = sorts.filter(s => s.key !== b.dataset.unsort);
      render();
    }));
    $$("[data-unfilter]").forEach(b => b.addEventListener("click", () => {
      delete colFilters[b.dataset.unfilter]; render();
    }));
  }

  /* ── Sample Name 생성 (creatable) ───────────────────────────────────── */
  function paintSampleBar(batches) {
    const host = $("#sample-bar");
    if (groupBy !== "sample") { host.innerHTML = ""; return; }

    const total = batches.reduce((n, b) => n + window.Repo.samplesOfBatch(b.id).length, 0);
    host.innerHTML =
      '<div class="card"><div class="card-body" style="display:flex;gap:var(--s-3);align-items:end;flex-wrap:wrap">' +
        '<label class="ebr-cell" style="min-width:150px"><span>' + esc(L.ui.sampleName) + ' 추가 대상 Batch</span>' +
          '<select class="ebr-input" id="smp-batch">' +
            batches.map(b => '<option value="' + esc(b.id) + '">' + esc(b.id) + '</option>').join("") +
          '</select></label>' +
        '<label class="ebr-cell" style="flex:1;min-width:180px"><span>새 ' + esc(L.ui.sampleName) + '</span>' +
          '<input class="ebr-input" id="smp-name" placeholder="예: B123-1-S1, pH 6.0 조건군"></label>' +
        '<button class="btn btn-accent" id="smp-add">' + esc(L.ui.addSample) + '</button>' +
        '<span style="font-size:12px;color:var(--c-text-mute)">현재 ' + total + '개</span>' +
        '<p class="field-error" id="smp-err" role="alert" style="flex-basis:100%;margin:0"></p>' +
      '</div></div>';

    $("#smp-add").addEventListener("click", function () {
      const name = $("#smp-name").value;
      const batchId = $("#smp-batch").value;
      const b = batches.find(x => x.id === batchId);
      const r = window.Entries.addSample({ batchId, studyId: b ? b.studyId : null, name });
      const err = $("#smp-err");
      if (!r.ok) { err.textContent = r.reason; err.classList.add("is-shown"); return; }
      err.classList.remove("is-shown");
      $("#smp-name").value = "";
      render();
    });
    $("#smp-name").addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); $("#smp-add").click(); }
    });
  }

  /* ── Data 분류 빠른 선택 ────────────────────────────────────────────────
     상단 셀렉터의 "Data 분류" 드롭다운과 **같은 상태**를 씁니다.
     한쪽에서 고르면 다른 쪽도 함께 바뀝니다 — 필터가 두 개로 보이면
     어느 쪽이 적용된 건지 알 수 없게 됩니다. */
  function paintClassFilter() {
    const sel = window.Scope.get();
    const list = [{ id: null, label: "전체 항목" }]
      .concat(window.Repo.getDataClasses(sel.team).map(c => ({ id: c.id, label: c.label })));
    $("#group-filter").innerHTML = list.map(c =>
      '<button class="btn btn-ghost btn-sm" data-g="' + esc(c.id || "") + '"' +
        (sel.dataClass === c.id
          ? ' style="background:var(--c-navy-700);color:#fff;border-color:var(--c-navy-700)"' : "") +
        '>' + esc(c.label) + '</button>').join("");
    $$("[data-g]").forEach(b => b.addEventListener("click", () => {
      window.Scope.setFilter({ dataClass: b.dataset.g || null });
    }));
  }

  /* ── CSV ────────────────────────────────────────────────────────────── */
  function exportCSV() {
    Promise.all([window.Scope.batches(), window.Repo.getStudies()]).then(function (res) {
      const batches = res[0], studies = res[1];
      const titerDays = window.DATA_TITER_DAYS.filter(d => batches.some(b => b.upstream.titer[d] !== null));
      const cols = columns(titerDays);
      let rows = applySort(applyColFilters(buildRows(batches, studies)));
      const q = v => {
        if (v === null || v === undefined) return "";
        const s = String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const lines = [cols.map(c => q(c.label)).join(",")];
      rows.forEach(r => lines.push(cols.map(c => q(cellValue(r, c.key))).join(",")));

      const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "batch_data_" + window.Entries.stamp().slice(0, 10) + ".csv";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      toast(rows.length + "행을 CSV로 내보냈습니다.");
    });
  }

  function toast(msg) {
    const t = $("#toast");
    t.innerHTML = '<div class="card" style="border-left:3px solid var(--c-ok);padding:var(--s-3) var(--s-4);' +
      'font-size:13px">' + esc(msg) + '</div>';
    t.style.display = "block";
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.style.display = "none"; }, 3000);
  }

  window.StudySelector.mount($("#selector"));
  window.Scope.subscribe(function (sel, reason) {
    paintClassFilter();
    /* [조회]·[초기화]·과제 전환으로 조건이 새로 적용되면 직접 건 컬럼 정렬을
       풀고 조회 정렬(기본 최신 날짜순)로 되돌립니다. */
    if (reason === "apply" || reason === "reset-filters" || reason === "scope") sorts = [];
    render();
  });
  window.Entries.subscribe(render);
  $("#export").addEventListener("click", exportCSV);
  paintClassFilter();
  render();
})();
