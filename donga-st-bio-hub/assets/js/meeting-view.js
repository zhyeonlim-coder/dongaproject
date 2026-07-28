/* ==========================================================================
   회의 모드 — 대시보드 안에서 열리는 전체화면 오버레이

   구조
     상단 탭   종합 / 배양공정팀 / 정제공정팀 / 바이오분석팀
     필터 바   배치·항목 검색 · 정렬 · 프리셋
     항목 칩   측정 항목을 고르면 아래 그래프가 그 항목으로 바뀝니다
     테이블    행을 누르면 그 배치만 남습니다 (여러 개 선택 가능)
     그래프    위에서 고른 배치 × 항목으로 즉시 다시 그려집니다

   ── 클릭 → 필터 → 그래프가 한 방향으로만 흐르게 만든 이유 ────────────────
   회의 중에는 "무엇을 보고 있는지"가 흔들리면 안 됩니다. 그래서 선택 상태는
   view 하나에만 두고, 표와 그래프는 그 상태를 읽어 그리기만 합니다.
   표에서 고르면 그래프가 따라오지만 그래프는 상태를 바꾸지 않습니다 —
   양방향으로 만들면 어디서 시작된 변경인지 추적할 수 없습니다.

   그리기는 부분 갱신입니다. 매번 전체를 다시 그리면 스크롤 위치와 포커스가
   튀어서, 발표 중에 화면이 덜컥거립니다.
   ========================================================================== */

window.MeetingView = (function () {
  "use strict";

  const L = window.LABELS, E = window.Entries, C = window.Charts;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmt = (v, dp) => (v === null || v === undefined || !isFinite(v)) ? L.empty : Number(v).toFixed(dp);

  const PRESET_KEY = "hub.presets.v2";
  const PALETTE = ["#0369A1", "#6D28D9", "#0F766E", "#B45309", "#B91C1C", "#1D4ED8"];

  /* 보기 상태 — 프리셋으로 저장되는 대상 */
  let view = {
    tab: "all",          // "all" | "upstream" | "downstream" | "analytics"
    q: "",
    picked: [],          // 선택한 배치 id. 빈 배열 = 전체
    metric: null,        // 선택한 측정 항목 키. null = 탭 대표 지표 묶음
    sortKey: "id",
    sortDir: 1
  };

  let batches = [];      // 현재 범위의 배치 (render 시 채움)
  let samples = [];      // 현재 범위의 시료 — 분석 탭의 행 단위

  /* 분석값은 시료에 붙으므로 분석 탭만 행 단위가 다릅니다.
     종합·배양·정제 탭은 배치 행이고, 분석 항목은 대표 시료 값을 보여줍니다. */
  function isSampleGrain() { return view.tab === "analytics"; }
  function rows() { return isSampleGrain() ? samples : batches; }
  function rowLabel(r) { return r.name || r.id; }

  /* ══════════════════════════════════════════════════════════════════════
     측정 항목 정의 — 탭마다 다릅니다
     ══════════════════════════════════════════════════════════════════════ */

  function groupsOf(team) {
    return window.DATA_ANALYTE_GROUPS.filter(g => g.team === team && !g.empty && g.items.length);
  }

  /* key 는 "그룹id.항목key" 로 통일합니다 — 그룹이 달라도 항목명이 겹칠 수
     있어서(main, monomer …) 그룹을 빼면 서로 덮어씁니다. */
  function metricsFor(tab) {
    const out = [];
    const push = (g, it) => out.push({
      key: g.id + "." + it.key,
      label: it.label,
      group: g.label,
      unit: it.unit,
      dp: it.dp,
      team: g.team,
      get: r => (isSampleGrain() && g.team === "analytics")
        ? window.Repo.valueOfSample(r, g.id, it.key)
        : window.Repo.valueOf(r, g.id, it.key)
    });

    if (tab === "all") {
      /* 종합 탭은 세 팀의 대표 지표만 — 전 항목을 늘어놓으면 회의에서 못 읽습니다 */
      const pick = [
        ["titer", "titerHCCF"], ["upstream", "maxVCD"], ["upstream", "finalViability"],
        ["downstream", "totalYield"], ["downstream", "monomerPurity"], ["downstream", "hcp"],
        ["seHPLC", "main"], ["ieHPLC", "main"], ["ceSdsNR", "monomer"], ["nGlycan", "sialicAcid"]
      ];
      pick.forEach(function (p) {
        const g = window.DATA_ANALYTE_GROUPS.find(x => x.id === p[0]);
        if (!g || g.empty) return;
        const it = g.items.find(x => x.key === p[1]);
        if (it) push(g, it);
      });
    } else {
      groupsOf(tab).forEach(g => g.items.forEach(it => push(g, it)));
    }

    /* 항목명이 겹치면(SE-HPLC Main vs IE-HPLC Main) 어느 쪽인지 알 수 없으므로
       겹치는 것만 그룹명을 앞에 붙입니다. 전부 붙이면 칩이 길어져 읽기 나빠집니다. */
    const seen = {};
    out.forEach(m => { seen[m.label] = (seen[m.label] || 0) + 1; });
    out.forEach(m => { if (seen[m.label] > 1) m.label = m.group + " " + m.label; });

    return out;
  }

  /* 항목을 고르지 않았을 때 그래프에 올릴 대표 지표 (최대 4개) */
  function defaultMetrics(tab) {
    const all = metricsFor(tab);
    if (tab === "upstream")   return all.filter(m => ["upstream.maxVCD", "upstream.finalVCD", "titer.titerHCCF"].indexOf(m.key) > -1);
    if (tab === "downstream") return all.filter(m => m.key.indexOf("downstream.") === 0 && m.key.indexOf("Yield") > -1);
    if (tab === "analytics")  return all.filter(m => ["seHPLC.main", "ieHPLC.main", "ceSdsNR.monomer"].indexOf(m.key) > -1);
    return all.filter(m => ["titer.titerHCCF", "downstream.totalYield", "ceSdsNR.monomer"].indexOf(m.key) > -1);
  }

  /* 검색어로 항목 좁히기. 걸리는 게 없으면 좁히지 않습니다 —
     한 글자 쳤다고 표가 비면 회의가 멈춥니다. */
  function visibleMetrics() {
    const all = metricsFor(view.tab);
    const term = view.q.trim().toLowerCase();
    if (!term) return all;
    const hit = all.filter(m =>
      (m.label + " " + m.group + " " + m.unit).toLowerCase().indexOf(term) > -1);
    return hit.length ? hit : all;
  }

  /* 검색어로 행 좁히기 (항목명으로 검색한 경우에는 행을 줄이지 않습니다) */
  function visibleBatches() {
    const term = view.q.trim().toLowerCase();
    let list = rows();
    if (term) {
      const hit = list.filter(r =>
        (rowLabel(r) + " " + (r.batchId || "") + " " + (r.stage || "")).toLowerCase().indexOf(term) > -1);
      if (hit.length) list = hit;
    }
    return list;
  }

  /* 그래프 대상 — 고른 행이 있으면 그것만 */
  function chartBatches() {
    const vis = visibleBatches();
    if (!view.picked.length) return vis;
    const sel = vis.filter(r => view.picked.indexOf(r.id) > -1);
    return sel.length ? sel : vis;
  }

  function chartMetrics() {
    if (view.metric) {
      const m = metricsFor(view.tab).find(x => x.key === view.metric);
      if (m) return [m];
    }
    const d = defaultMetrics(view.tab);
    return d.length ? d : visibleMetrics().slice(0, 3);
  }

  /* ══════════════════════════════════════════════════════════════════════
     프리셋
     ══════════════════════════════════════════════════════════════════════ */
  function presets() {
    try { return JSON.parse(localStorage.getItem(PRESET_KEY) || "[]"); } catch (e) { return []; }
  }
  function savePresets(list) {
    try { localStorage.setItem(PRESET_KEY, JSON.stringify(list)); } catch (e) {}
  }

  /* ══════════════════════════════════════════════════════════════════════
     상단 탭
     ══════════════════════════════════════════════════════════════════════ */
  function tabsMarkup() {
    const tabs = [{ key: "all", ko: "종합" }].concat(
      window.DATA_TEAMS.map(t => ({ key: t.id, ko: t.ko })));
    return '<div class="mm-pills" style="flex:1">' + tabs.map(t =>
      '<button class="mm-pill" data-view="' + t.key + '"' +
        (view.tab === t.key ? ' aria-current="true"' : "") + '>' + esc(t.ko) + '</button>').join("") +
      '</div>';
  }

  /* ══════════════════════════════════════════════════════════════════════
     필터 바
     ══════════════════════════════════════════════════════════════════════ */
  function filterBar() {
    const list = presets();
    const mv = visibleMetrics();
    return '<div class="card" style="margin-bottom:var(--s-4)"><div class="card-body">' +
      '<div class="mm-toolbar">' +

        '<label class="ebr-cell" style="flex:1;min-width:220px"><span>배치 · 항목 검색</span>' +
          '<input class="ebr-input" id="mm-q" type="search" value="' + esc(view.q) + '" ' +
            'placeholder="예: B123-4, Titer, Step Yield"></label>' +

        '<label class="ebr-cell" style="min-width:170px"><span>정렬 기준</span>' +
          '<select class="ebr-input" id="mm-sort">' +
            '<option value="id"' + (view.sortKey === "id" ? " selected" : "") + '>배치 번호</option>' +
            mv.map(m => '<option value="' + esc(m.key) + '"' +
              (view.sortKey === m.key ? " selected" : "") + '>' + esc(m.label) + '</option>').join("") +
          '</select></label>' +

        '<label class="ebr-cell" style="min-width:110px"><span>정렬 방향</span>' +
          '<select class="ebr-input" id="mm-dir">' +
            '<option value="1"' + (view.sortDir === 1 ? " selected" : "") + '>오름차순</option>' +
            '<option value="-1"' + (view.sortDir === -1 ? " selected" : "") + '>내림차순</option>' +
          '</select></label>' +

        '<div style="margin-left:auto;display:flex;gap:var(--s-2);align-items:end;flex-wrap:wrap">' +
          (list.length
            ? '<label class="ebr-cell" style="min-width:150px"><span>프리셋</span>' +
              '<select class="ebr-input" id="mm-preset"><option value="">— 불러오기 —</option>' +
              list.map((p, i) => '<option value="' + i + '">' + esc(p.name) + '</option>').join("") +
              '</select></label>' : "") +
          '<button class="btn btn-ghost btn-sm" id="mm-save">현재 조합 저장</button>' +
        '</div>' +
      '</div>' +

      '<div id="mm-applied" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;' +
        'margin-top:var(--s-3)"></div>' +
    '</div></div>';
  }

  function paintApplied() {
    const host = $("#mm-applied");
    if (!host) return;
    const chips = [];
    if (view.q.trim()) chips.push(["검색", view.q.trim(), "q"]);
    if (view.picked.length) chips.push(["배치", view.picked.length + "건 선택", "picked"]);
    if (view.metric) {
      const m = metricsFor(view.tab).find(x => x.key === view.metric);
      chips.push(["항목", m ? m.label : view.metric, "metric"]);
    }
    if (!chips.length) {
      host.innerHTML = '<span style="font-size:11.5px;color:var(--c-text-mute)">' +
        '표의 행을 누르면 그 배치만, 아래 항목 칩을 누르면 그 항목만 그래프에 남습니다.</span>';
      return;
    }
    host.innerHTML =
      '<span style="font-size:11.5px;color:var(--c-text-mute)">적용된 조건</span>' +
      chips.map(c => '<span class="chip"><span class="chip-k">' + esc(c[0]) + '</span>' + esc(c[1]) +
        '<button class="chip-x" data-clear="' + c[2] + '" aria-label="' + esc(c[0]) + ' 해제">' +
        '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></span>').join("") +
      '<button class="btn btn-ghost btn-sm" id="mm-reset" style="margin-left:4px">전체 해제</button>';

    $$("[data-clear]", host).forEach(b => b.addEventListener("click", function () {
      const k = b.dataset.clear;
      if (k === "q") { view.q = ""; const i = $("#mm-q"); if (i) i.value = ""; }
      if (k === "picked") view.picked = [];
      if (k === "metric") view.metric = null;
      syncAll();
    }));
    const r = $("#mm-reset", host);
    if (r) r.addEventListener("click", function () {
      view.q = ""; view.picked = []; view.metric = null;
      const i = $("#mm-q"); if (i) i.value = "";
      syncAll();
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     항목 칩 — 누르면 그래프가 그 항목으로 전환됩니다
     ══════════════════════════════════════════════════════════════════════ */
  function paintChips() {
    const host = $("#mm-chips");
    if (!host) return;
    const mv = visibleMetrics();
    const filled = m => rows().filter(b => {
      const v = m.get(b);
      return v !== null && v !== undefined && isFinite(v);
    }).length;

    host.innerHTML =
      '<div class="eyebrow" style="margin-bottom:var(--s-2)">표시할 항목 ' +
        '<span style="font-weight:400;text-transform:none;color:var(--c-text-mute)">' +
        '— 누르면 그래프가 그 항목으로 바뀝니다</span></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
        '<button class="mm-chip" data-metric="" aria-pressed="' + (!view.metric) + '">대표 지표</button>' +
        mv.map(m => '<button class="mm-chip" data-metric="' + esc(m.key) + '" ' +
          'aria-pressed="' + (view.metric === m.key) + '" title="' + esc(m.group + " · " + m.unit) + '">' +
          esc(m.label) + '<span class="mm-chip-count">' + filled(m) + '</span></button>').join("") +
      '</div>';

    $$("[data-metric]", host).forEach(b => b.addEventListener("click", function () {
      const k = b.dataset.metric || null;
      view.metric = (view.metric === k) ? null : k;
      syncAll();
    }));
  }

  /* ══════════════════════════════════════════════════════════════════════
     테이블 — 행 클릭으로 배치 선택
     ══════════════════════════════════════════════════════════════════════ */
  function sortedRows() {
    const mv = visibleMetrics();
    const m = mv.find(x => x.key === view.sortKey);
    const val = b => (view.sortKey === "id" ? rowLabel(b) : (m ? m.get(b) : null));
    return visibleBatches().slice().sort(function (a, b) {
      const va = val(a), vb = val(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;                  // 미입력은 항상 뒤로
      if (vb === null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * view.sortDir;
      return String(va).localeCompare(String(vb)) * view.sortDir;
    });
  }

  function paintTable() {
    const host = $("#mm-table");
    if (!host) return;
    const mv = visibleMetrics();
    const rows = sortedRows();
    const teamColor = id => (window.DATA_TEAMS.find(t => t.id === id) || {}).color || "var(--c-border)";

    if (!rows.length || !mv.length) {
      host.innerHTML = '<div class="empty"><div class="empty-title">표시할 데이터가 없습니다</div>' +
        '<div class="empty-body">검색어를 지우거나 다른 탭을 선택해 보세요.</div></div>';
      return;
    }

    host.innerHTML =
      '<div class="card-head" style="padding-bottom:var(--s-3)"><div>' +
        '<h2 class="card-title">데이터 테이블</h2>' +
        '<p class="card-sub">행을 누르면 그 ' + (isSampleGrain() ? "시료" : "배치") +
          '만 그래프에 남습니다 (여러 개 선택 가능) · ' +
          rows.length + (isSampleGrain() ? '개 시료 · ' : '개 배치 · ') +
          mv.length + '개 항목' +
          (isSampleGrain() ? ' · 분석값은 시료에 기록됩니다' : "") + '</p></div>' +
        (view.picked.length
          ? '<span class="badge badge-accent">' + view.picked.length + '건 선택</span>' : "") +
      '</div>' +
      '<div class="tbl-scroll"><table class="tbl"><thead><tr>' +
        '<th scope="col">' + (isSampleGrain() ? "시료" : "Exp. No.") + '</th>' +
        mv.map(m => '<th scope="col" style="border-top:2px solid ' + teamColor(m.team) + '">' +
          esc(m.label) + '<br><span style="font-weight:400;text-transform:none">' +
          esc(m.unit) + '</span></th>').join("") +
      '</tr></thead><tbody>' +
      rows.map(function (b) {
        const on = view.picked.indexOf(b.id) > -1;
        return '<tr class="is-pickable' + (on ? " is-picked" : "") + '" data-pick="' + esc(b.id) + '" ' +
          'tabindex="0" role="button" aria-pressed="' + on + '" ' +
          'aria-label="' + esc(rowLabel(b)) + (on ? " 선택됨" : "") + '">' +
          '<td class="mono" style="font-weight:600">' + esc(rowLabel(b)) +
            (isSampleGrain() && b.stage
              ? '<br><span style="font-weight:400;font-size:10px;color:var(--c-text-mute)">' +
                esc(b.stage) + '</span>' : "") + '</td>' +
          mv.map(function (m) {
            const v = m.get(b);
            return (v === null || v === undefined || !isFinite(v))
              ? '<td class="na">' + L.empty + '</td>'
              : '<td class="mono">' + Number(v).toFixed(m.dp) + '</td>';
          }).join("") + '</tr>';
      }).join("") + '</tbody></table></div>';

    function toggle(id) {
      const i = view.picked.indexOf(id);
      if (i > -1) view.picked.splice(i, 1); else view.picked.push(id);
      syncAll();
    }
    $$("[data-pick]", host).forEach(function (tr) {
      tr.addEventListener("click", () => toggle(tr.dataset.pick));
      tr.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(tr.dataset.pick); }
      });
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     그래프 — 선택에 따라 즉시 다시 그립니다
     ══════════════════════════════════════════════════════════════════════ */

  /* 값이 좁은 구간에 몰려 있으면 축을 0이 아니라 그 아래에서 시작합니다.
     수율·순도를 0부터 그리면 막대가 전부 같은 높이로 보입니다. */
  function axisMin(vals) {
    const v = vals.filter(x => x !== null && x !== undefined && isFinite(x));
    if (v.length < 2) return null;
    const lo = Math.min.apply(null, v), hi = Math.max.apply(null, v);
    if (lo <= 0 || hi <= 0) return null;
    if ((hi - lo) / hi > 0.45) return null;          // 폭이 넓으면 0 기준이 정직합니다
    const pad = (hi - lo) * 0.3 || hi * 0.02;
    const mag = Math.pow(10, Math.floor(Math.log10(hi)) - 1);
    return Math.max(0, Math.floor((lo - pad) / mag) * mag);
  }

  function paintChart() {
    const host = $("#mm-chart");
    if (!host) return;
    const bs = chartBatches();
    const ms = chartMetrics();

    if (!bs.length || !ms.length) {
      host.innerHTML = '<div class="empty"><div class="empty-title">그래프에 올릴 데이터가 없습니다</div></div>';
      return;
    }

    const cats = bs.map(rowLabel);
    const series = ms.map((m, i) => ({
      name: m.label + (m.unit ? " (" + m.unit + ")" : ""),
      color: PALETTE[i % PALETTE.length],
      data: bs.map(m.get)
    }));
    const allVals = series.reduce((a, s) => a.concat(s.data), []);
    const min = ms.length === 1 || sameUnit(ms) ? axisMin(allVals) : null;

    const subtitle = (view.picked.length ? "선택한 배치 " + bs.length + "건" : "전체 " + bs.length + "건") +
      " · " + (view.metric ? ms[0].label : "대표 지표 " + ms.length + "개") +
      (sameUnit(ms) ? "" : " · 단위가 서로 달라 같은 축에 겹쳐 보입니다");

    host.innerHTML =
      '<div class="card-head" style="padding-bottom:var(--s-3)"><div>' +
        '<h2 class="card-title">' + (view.metric ? esc(ms[0].label) : "대표 지표 비교") + '</h2>' +
        '<p class="card-sub">' + esc(subtitle) + '</p></div></div>' +
      '<div class="card-body chart-swap">' +
        C.swatches(series) +
        '<div class="chart-wrap" style="margin-top:var(--s-3)">' +
          C.bars({ cats, series, min: min, h: 300, w: 900,
                   aria: (view.metric ? ms[0].label : "대표 지표") + " 배치별 비교" }) + '</div>' +
        (min != null
          ? '<p style="font-size:11px;color:var(--c-text-mute);margin:var(--s-2) 0 0">' +
            '세로축은 ' + min + ' 부터 시작합니다 — 값이 좁은 구간에 몰려 있어 0부터 그리면 차이가 보이지 않습니다.</p>'
          : "") +
        C.dataTable((view.metric ? ms[0].label : "대표 지표") + " 배치별 값",
          ["배치"].concat(series.map(s => s.name)),
          cats.map((c, i) => [c].concat(series.map(s =>
            s.data[i] === null || !isFinite(s.data[i]) ? L.empty : String(s.data[i]))))) +
      '</div>';
  }

  function sameUnit(ms) {
    return ms.every(m => m.unit === ms[0].unit);
  }

  /* ══════════════════════════════════════════════════════════════════════
     종합 탭의 팀 요약 카드
     ══════════════════════════════════════════════════════════════════════ */
  function teamSummary(teamSets) {
    const iss = issues();
    const byTeam = {};
    iss.forEach(i => { byTeam[i.team] = (byTeam[i.team] || 0) + 1; });

    return '<div class="team-grid" style="margin-bottom:var(--s-4)">' +
      teamSets.map(function (t) {
        const missing = byTeam[t.team] || 0;
        return '<section class="card team-card" style="--team:' + t.color + '">' +
          '<div class="team-head"><div>' +
            '<div class="team-name">' + esc(t.ko) + '</div>' +
            '<div style="font-size:11px;color:var(--c-text-mute)">' +
              (!t.defined ? "원본 데이터 없음" : t.filled + "/" + t.total + " 입력") + '</div></div>' +
            (missing ? '<span class="spec spec-fail">미입력 ' + missing + '</span>'
                     : t.defined ? '<span class="spec spec-pass">완전</span>'
                                 : '<span class="spec spec-none">없음</span>') +
          '</div>' +
          '<div class="team-metrics">' + headlineMetrics(t.team).map(x =>
            '<div class="team-metric"><span class="team-metric-k">' + esc(x.k) + '</span>' +
            '<span class="team-metric-v"' + (x.v === L.empty ? ' style="color:var(--c-text-soft)"' : "") + '>' +
              esc(x.v) + (x.u ? '<span class="team-metric-u">' + esc(x.u) + '</span>' : "") +
            '</span></div>').join("") + '</div>' +
          '<div class="card-body" style="padding-top:0">' +
            '<button class="btn btn-ghost btn-sm" data-goto="' + t.team + '" style="width:100%">' +
              esc(t.ko) + ' 탭으로 →</button></div>' +
        '</section>';
      }).join("") + '</div>' +

      (iss.length
        ? '<div class="card" style="border-left:3px solid var(--c-warn);margin-bottom:var(--s-4)">' +
          '<div class="card-head"><div><h2 class="card-title">확인 필요 항목</h2>' +
          '<p class="card-sub">미입력 ' + iss.length + '건 · 규격표가 없어 Fail 판정은 계산하지 않습니다</p></div></div>' +
          '<div class="card-body" style="display:flex;gap:6px;flex-wrap:wrap">' +
            Object.keys(byTeam).map(function (k) {
              const t = window.DATA_TEAMS.find(x => x.id === k) || {};
              return '<button class="badge badge-warn" data-goto="' + esc(k) + '" style="cursor:pointer">' +
                esc(t.short || k) + ' 미입력 ' + byTeam[k] + '</button>';
            }).join("") + '</div></div>'
        : "");
  }

  function headlineMetrics(team) {
    const num = f => batches.map(f).filter(v => v !== null && v !== undefined && isFinite(v));
    const avg = a => a.length ? fmt(a.reduce((x, y) => x + y, 0) / a.length, 1) : L.empty;
    if (team === "upstream") {
      const t = num(b => b.upstream.titerHCCF);
      return [
        { k: "최고 Titer", v: t.length ? fmt(Math.max.apply(null, t), 0) : L.empty, u: "mg/L" },
        { k: "평균 Titer", v: avg(t), u: "mg/L" },
        { k: "평균 Viability", v: avg(num(b => b.upstream.finalViability)), u: "%" }
      ];
    }
    if (team === "downstream") {
      const d = k => num(b => (b.downstream ? b.downstream[k] : null));
      return [
        { k: "평균 Total Yield", v: avg(d("totalYield")), u: "%" },
        { k: "평균 HCP", v: avg(d("hcp")), u: "ppm" },
        { k: "평균 Monomer", v: avg(d("monomerPurity")), u: "%" }
      ];
    }
    return [
      { k: "CE-SDS Monomer", v: avg(num(b => window.Repo.valueOf(b, "ceSdsNR", "monomer"))), u: "%" },
      { k: "IE-HPLC Main", v: avg(num(b => window.Repo.valueOf(b, "ieHPLC", "main"))), u: "%" },
      { k: "SE-HPLC Main", v: avg(num(b => window.Repo.valueOf(b, "seHPLC", "main"))), u: "%" }
    ];
  }

  /* 원본 Excel에 규격(spec) 한계값이 없어 Pass/Fail 을 계산할 근거가 없습니다.
     "미입력"만 이상 항목으로 강조하고, Fail 판정은 규격표가 들어온 뒤
     활성화합니다. 근거 없이 Pass 로 칠하지 않습니다. */
  function issues() {
    const out = [];
    batches.forEach(b => window.DATA_ANALYTE_GROUPS.forEach(g => {
      if (g.empty) return;
      g.items.forEach(function (it) {
        /* "해당 없음"으로 표시한 칸은 확인 대상이 아닙니다 —
           없는 항목을 회의 때마다 짚으면 진짜 미측정이 묻힙니다. */
        if (window.Repo.cellState(b, g.id, it.key) === "empty")
          out.push({ batch: b.id, group: g.label, item: it.label, team: g.team });
      });
    }));
    return out;
  }

  /* ══════════════════════════════════════════════════════════════════════
     그리기
     ══════════════════════════════════════════════════════════════════════ */

  /* 선택이 바뀌었을 때 — 표 · 그래프 · 칩 · 조건 칩만 갈아 끼웁니다.
     필터 바를 다시 그리면 입력 중이던 검색어 포커스가 날아갑니다. */
  function syncAll() {
    paintChips();
    paintTable();
    paintChart();
    paintApplied();
  }

  function render() {
    if (!on) return;
    const sel = window.Scope.get();
    const desc = window.Scope.describe();

    $("#mv-title").textContent = "회의 모드";
    $("#mv-sub").textContent = desc.scope
      ? desc.scope + (desc.study ? " · " + desc.study : "") : "과제 미선택";
    $("#mv-tabs").innerHTML = tabsMarkup();
    wireTabs();

    if (!sel.scopeId) {
      $("#mv-body").innerHTML = '<div class="empty"><div class="empty-title">과제를 선택하세요</div>' +
        '<div class="empty-body">대시보드 상단에서 선택한 뒤 다시 열어주세요.</div></div>';
      return;
    }

    Promise.all([
      window.Scope.batches(),
      window.Repo.getTeamDataSetsForSelection(sel),
      window.Scope.samples()
    ]).then(function (r) {
      batches = r[0];
      const teamSets = r[1];
      samples = r[2];

      if (!batches.length) {
        $("#mv-body").innerHTML = '<div class="empty"><div class="empty-title">' + esc(L.noResult) +
          '</div><div class="empty-body">' + esc(L.noResultHint) + '</div></div>';
        return;
      }

      /* 범위가 바뀌면 사라진 행의 선택은 버립니다 */
      const ids = rows().map(x => x.id);
      view.picked = view.picked.filter(id => ids.indexOf(id) > -1);

      $("#mv-body").innerHTML =
        filterBar() +
        (view.tab === "all" ? teamSummary(teamSets) : "") +
        '<div id="mm-chips" style="margin-bottom:var(--s-4)"></div>' +
        '<section class="card" style="margin-bottom:var(--s-4)"><div id="mm-table"></div></section>' +
        '<section class="card"><div id="mm-chart"></div></section>';

      wireFilters();
      syncAll();
    });
  }

  function wireTabs() {
    $$("[data-view]").forEach(b => b.addEventListener("click", function () {
      if (view.tab === b.dataset.view) return;
      view.tab = b.dataset.view;
      view.metric = null;                  // 탭마다 항목이 달라 이월하면 어긋납니다
      view.sortKey = "id";
      render();
    }));
  }

  function wireFilters() {
    const q = $("#mm-q");
    if (q) {
      let t = null;
      q.addEventListener("input", function () {
        clearTimeout(t);
        const v = this.value;
        t = setTimeout(function () { view.q = v; syncAll(); }, 200);
      });
    }
    const s = $("#mm-sort");
    if (s) s.addEventListener("change", function () { view.sortKey = this.value; paintTable(); });
    const d = $("#mm-dir");
    if (d) d.addEventListener("change", function () { view.sortDir = +this.value; paintTable(); });

    $$("[data-goto]").forEach(b => b.addEventListener("click", function () {
      view.tab = b.dataset.goto;
      view.metric = null;
      render();
    }));

    const save = $("#mm-save");
    if (save) save.addEventListener("click", function () {
      const name = window.prompt("프리셋 이름을 입력하세요 (예: 주간회의 기본)");
      if (!name || !name.trim()) return;
      const list = presets();
      list.push({ name: name.trim(), view: JSON.parse(JSON.stringify(view)) });
      savePresets(list);
      render();
    });

    const p = $("#mm-preset");
    if (p) p.addEventListener("change", function () {
      if (this.value === "") return;
      const item = presets()[+this.value];
      if (item) { view = Object.assign({}, view, item.view); render(); }
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     오버레이 생명주기
     대시보드 안에서 열리는 전체화면 오버레이입니다. 별도 페이지가 아니므로
     대시보드에서 고른 과제·Study·팀이 그대로 유지됩니다.
     ══════════════════════════════════════════════════════════════════════ */
  let on = false, unsub = [], lastFocus = null;

  function install() {
    if (document.getElementById("mv")) return;
    const d = document.createElement("div");
    d.className = "mm";
    d.id = "mv";
    d.setAttribute("role", "dialog");
    d.setAttribute("aria-modal", "true");
    d.setAttribute("aria-label", "회의 모드");
    d.innerHTML =
      '<div class="mm-head">' +
        '<div style="min-width:0">' +
          '<div class="mm-title" id="mv-title">회의 모드</div>' +
          '<div class="mm-sub" id="mv-sub"></div>' +
        '</div>' +
        '<button class="btn btn-ghost btn-sm" id="mv-exit" style="margin-left:auto">종료 (Esc)</button>' +
      '</div>' +
      '<div class="mm-foot" style="border-top:0;border-bottom:1px solid var(--c-border)" id="mv-tabs"></div>' +
      '<div style="flex:1;overflow-y:auto;padding:var(--s-6)" id="mv-body"></div>';
    document.body.appendChild(d);
    d.querySelector("#mv-exit").addEventListener("click", close);
  }

  function onKey(e) {
    if (!on) return;
    if (e.key === "Escape") {
      const t = (e.target.tagName || "");
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(t)) { e.target.blur(); e.preventDefault(); return; }
      close(); e.preventDefault();
    }
  }

  function open() {
    install();
    on = true;
    lastFocus = document.activeElement;
    document.body.classList.add("mm-open");
    document.getElementById("mv").classList.add("is-on");

    /* 대시보드에서 팀을 고르고 들어왔다면 그 팀 탭으로 엽니다 */
    const sel = window.Scope.get();
    if (sel.team) view.tab = sel.team;

    unsub = [window.Scope.subscribe(render), window.Entries.subscribe(render)];
    document.addEventListener("keydown", onKey, true);
    render();
    setTimeout(() => { const b = document.getElementById("mv-exit"); if (b) b.focus(); }, 40);
  }

  function close() {
    on = false;
    document.body.classList.remove("mm-open");
    const el = document.getElementById("mv");
    if (el) el.classList.remove("is-on");
    unsub.forEach(f => { try { f(); } catch (e) {} });
    unsub = [];
    document.removeEventListener("keydown", onKey, true);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  return { install, open, close };
})();
