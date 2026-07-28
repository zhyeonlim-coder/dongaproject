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

  /* 다중 정렬 — [{key, dir}] 순서대로 우선순위 */
  let sorts = [{ key: "id", dir: 1 }];
  let groupBy = "batch";        // "batch" | "sample"
  let groupFilter = "all";
  let colFilters = {};          // { colKey: "부분일치 문자열" }

  window.Shell.subnav([
    { label: "조회 단위", items: [
      { key: "batch",  ko: "배치별",           active: true },
      { key: "sample", ko: "샘플별 모아보기",  active: false }
    ]},
    { label: "바로가기", items: [
      { ko: "대시보드", href: "dashboard.html" },
      { ko: "EBR 입력", href: "ebr.html" }
    ]}
  ], k => { groupBy = k; render(); });

  /* ── 컬럼 정의 ──────────────────────────────────────────────────────── */
  function columns(titerDays) {
    const team = window.Scope.get().team;
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

    const cols = base.slice();
    const wantUpstream = !team || team === "upstream";
    const wantAnalytics = !team || team === "analytics";

    if (wantUpstream) {
      cols.push({ key: "cultureDays", label: "Days", type: "n", dp: 0, w: 60 });
      [["ivcd","IVCD",1],["maxVCD","Max VCD",2],["finalVCD","Final VCD",2],
       ["finalViability","Viability (%)",1]].forEach(x =>
        cols.push({ key: x[0], label: x[1], type: "n", dp: x[2], w: 92 }));
      titerDays.forEach(d => cols.push({ key: "titer." + d, label: "Titer " + d, type: "n", dp: 0, w: 88 }));
      cols.push({ key: "titerHCCF", label: "Titer HCCF", type: "n", dp: 1, w: 96 });
      cols.push({ key: "qP",        label: "qP",         type: "n", dp: 2, w: 80 });
    }

    window.DATA_ANALYTE_GROUPS.forEach(g => {
      if (g.empty || g.team !== "analytics") return;
      if (!wantAnalytics) return;
      if (groupFilter !== "all" && groupFilter !== g.id) return;
      g.items.forEach(it => cols.push({
        key: g.id + "." + it.key, label: g.label + " " + it.label,
        type: "n", dp: it.dp, w: 108
      }));
    });
    return cols;
  }

  function cellValue(row, key) {
    if (["projectLabel","studyName","teamLabel","sampleName","id","initialDate","endDate","cultureDays"].indexOf(key) > -1)
      return row[key];
    if (key.indexOf("titer.") === 0) return row.upstream ? row.upstream.titer[key.slice(6)] : null;
    if (key.indexOf(".") > -1) {
      const p = key.split(".");
      return row.analytics && row.analytics[p[0]] ? row.analytics[p[0]][p[1]] : null;
    }
    if (row.upstream && row.upstream[key] !== undefined) return row.upstream[key];
    return row[key] === undefined ? null : row[key];
  }

  /* ── 행 구성 ────────────────────────────────────────────────────────── */
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

    if (groupBy === "batch") return batches.map(decorate);

    /* 샘플별 모아보기 — Batch 하위 Sample 을 행으로 펼칩니다.
       Sample 이 없는 Batch 는 "(샘플 미생성)" 한 줄로 남겨 존재를 숨기지 않습니다. */
    const out = [];
    batches.forEach(b => {
      const d = decorate(b);
      const samples = window.Entries.getSamples(b.id);
      if (!samples.length) {
        out.push(Object.assign({}, d, { sampleName: null, sampleId: null }));
        return;
      }
      samples.forEach(s => out.push(Object.assign({}, d, { sampleName: s.name, sampleId: s.id })));
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
        '<div class="empty"><div class="empty-title">과제 또는 기반 Study를 선택하세요</div>' +
        '<div class="empty-body">상단 우측 셀렉터에서 선택하면 해당 범위의 데이터만 표시됩니다.</div></div>';
      $("#sample-bar").innerHTML = "";
      return;
    }

    Promise.all([window.Scope.batches(), window.Repo.getStudies()]).then(function (res) {
      const batches = res[0], studies = res[1];
      const titerDays = window.DATA_TITER_DAYS.filter(d =>
        batches.some(b => b.upstream.titer[d] !== null));

      let rows = buildRows(batches, studies);
      rows = applyColFilters(rows);
      rows = applySort(rows);

      const cols = columns(titerDays);
      $("#count").textContent = rows.length + (groupBy === "sample" ? "행 (샘플별)" : "개 배치") +
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
        : '<div class="empty"><div class="empty-title">조건에 맞는 데이터가 없습니다</div>' +
          '<div class="empty-body">컬럼 필터나 조건 칩을 해제해 보세요.</div></div>';

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
    if (sorts.length <= 1 && !filterKeys.length) { host.innerHTML = ""; return; }

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

    $$("[data-unsort]").forEach(b => b.addEventListener("click", () => {
      sorts = sorts.filter(s => s.key !== b.dataset.unsort);
      if (!sorts.length) sorts = [{ key: "id", dir: 1 }];
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

    const total = batches.reduce((n, b) => n + window.Entries.getSamples(b.id).length, 0);
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

  /* ── 분석 그룹 필터 ─────────────────────────────────────────────────── */
  function paintGroupFilter() {
    const groups = [{ id: "all", label: "전체 항목" }].concat(
      window.DATA_ANALYTE_GROUPS.filter(g => !g.empty && g.team === "analytics")
        .map(g => ({ id: g.id, label: g.label })));
    $("#group-filter").innerHTML = groups.map(g =>
      '<button class="btn btn-ghost btn-sm" data-g="' + g.id + '"' +
        (groupFilter === g.id ? ' style="background:var(--c-navy-700);color:#fff;border-color:var(--c-navy-700)"' : "") +
        '>' + esc(g.label) + '</button>').join("");
    $$("[data-g]").forEach(b => b.addEventListener("click", () => {
      groupFilter = b.dataset.g; paintGroupFilter(); render();
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
  window.Scope.subscribe(render);
  window.Entries.subscribe(render);
  $("#export").addEventListener("click", exportCSV);
  paintGroupFilter();
  render();
})();
