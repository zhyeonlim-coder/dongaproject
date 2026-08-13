/* ==========================================================================
   회의 모드 — 배양 · 정제 · 바이오분석이 한 화면에서 데이터를 검토하고
   그 자리에서 결정을 남기는 인터랙티브 리뷰 허브.

   구조
     좌측(본문)   필터 바(고정) → 조건 요약 → 동기화 뷰 / 팀별 뷰
     우측(패널)   지난 회의 미완료 조치 · 이번 회의 핀 · 결정/조치 입력 · 회의록

   ── 조건에서 벗어난 데이터를 지우지 않는 이유 ────────────────────────────
   수치 범위 필터는 **강조만** 합니다. 행을 숨기지 않습니다.
   리뷰 회의에서 조건 밖 데이터를 화면에서 치우면, 정작 문제인 배치가 같이
   사라집니다. 그래서 모든 행을 그대로 두고 세 가지 상태로만 구분합니다.
       ● 조건 만족   ○ 조건 벗어남   — 해당 항목 미입력
   "미입력"을 "벗어남"과 따로 두는 이유는, 값이 없는 것과 값이 나쁜 것이
   전혀 다른 문제이기 때문입니다.

   ── 선택이 한 방향으로만 흐르게 만든 이유 ────────────────────────────────
   회의 중에는 "무엇을 보고 있는지"가 흔들리면 안 됩니다. 선택 상태는 view
   하나에만 두고, 표와 그래프는 그 상태를 읽어 그리기만 합니다.

   ── 일자별 데이터에 대한 사실 ────────────────────────────────────────────
   원본에서 Day 축이 있는 것은 Titer(D10~D14)뿐입니다. 정제 수율 · Charge
   Variant · Glycan 은 배치당 값이 1개입니다. 그래서 Day 는 축으로만 쓰고,
   점을 누르면 **그 배치**의 3팀 데이터가 연동됩니다. 없는 일자별 값을
   만들어 채우지 않습니다.
   ========================================================================== */

window.MeetingView = (function () {
  "use strict";

  const L = window.LABELS, C = window.Charts, MC = window.MeetingChart;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmt = (v, dp) => (v === null || v === undefined || !isFinite(v)) ? L.empty : Number(v).toFixed(dp);
  const num = (v) => typeof v === "number" && isFinite(v);

  const PRESET_KEY = "hub.presets.v2";
  const PALETTE = ["#0369A1", "#6D28D9", "#0F766E", "#B45309", "#B91C1C", "#1D4ED8"];

  let view = {
    tab: "all",
    q: "",
    picked: [],
    metric: null,
    sortKey: "id",
    sortDir: 1,
    focus: null,          // 동기화 대상 배치 id
    focusDay: null,
    ranges: {},           // 아래 RANGE_DEFS 로 초기화
    pinTarget: null,      // 핀 작성 대상
    noteKind: "decision",
    panel: true
  };

  let batches = [], samples = [];

  function isSampleGrain() { return view.tab === "analytics"; }
  function rows() { return isSampleGrain() ? samples : batches; }
  function rowLabel(r) { return r.name || r.id; }
  /* 시료 행이라도 핀 · 동기화는 배치 기준입니다 */
  function batchIdOf(r) { return r.batchId || r.id; }

  /* ══════════════════════════════════════════════════════════════════════
     측정 항목
     ══════════════════════════════════════════════════════════════════════ */
  function groupsOf(team) {
    return window.DATA_ANALYTE_GROUPS.filter(g => g.team === team && !g.empty && g.items.length);
  }

  function metricsFor(tab) {
    const out = [];
    const push = (g, it) => out.push({
      key: g.id + "." + it.key,
      groupId: g.id, itemKey: it.key,
      label: it.label, group: g.label, unit: it.unit, dp: it.dp, team: g.team,
      get: r => (isSampleGrain() && g.team === "analytics")
        ? window.Repo.valueOfSample(r, g.id, it.key)
        : window.Repo.valueOf(r, g.id, it.key)
    });

    if (tab === "all") {
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

    const seen = {};
    out.forEach(m => { seen[m.label] = (seen[m.label] || 0) + 1; });
    out.forEach(m => { if (seen[m.label] > 1) m.label = m.group + " " + m.label; });
    return out;
  }

  /* 항목 키("그룹.항목")로 어디서든 찾기 — 범위 필터가 탭과 무관하게 걸립니다 */
  function metricByKey(key) {
    const parts = String(key || "").split(".");
    const g = window.DATA_ANALYTE_GROUPS.find(x => x.id === parts[0]);
    if (!g) return null;
    const it = g.items.find(x => x.key === parts[1]);
    if (!it) return null;
    return {
      key: key, groupId: g.id, itemKey: it.key, label: it.label, group: g.label,
      unit: it.unit, dp: it.dp, team: g.team,
      get: r => window.Repo.valueOf(r.batchId ? batchOf(r) : r, g.id, it.key)
    };
  }
  function batchOf(sampleRow) {
    return batches.find(b => b.id === sampleRow.batchId) || sampleRow;
  }

  function defaultMetrics(tab) {
    const all = metricsFor(tab);
    if (tab === "upstream")   return all.filter(m => ["upstream.maxVCD", "upstream.finalVCD", "titer.titerHCCF"].indexOf(m.key) > -1);
    if (tab === "downstream") return all.filter(m => m.key.indexOf("downstream.") === 0 && m.key.indexOf("Yield") > -1);
    if (tab === "analytics")  return all.filter(m => ["seHPLC.main", "ieHPLC.main", "ceSdsNR.monomer"].indexOf(m.key) > -1);
    return all.filter(m => ["titer.titerHCCF", "downstream.totalYield", "ceSdsNR.monomer"].indexOf(m.key) > -1);
  }

  function visibleMetrics() {
    const all = metricsFor(view.tab);
    const term = view.q.trim().toLowerCase();
    if (!term) return all;
    const hit = all.filter(m => (m.label + " " + m.group + " " + m.unit).toLowerCase().indexOf(term) > -1);
    return hit.length ? hit : all;
  }
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
  function sameUnit(ms) { return ms.every(m => m.unit === ms[0].unit); }

  /* ══════════════════════════════════════════════════════════════════════
     수치 범위 필터 — 강조 전용
     ══════════════════════════════════════════════════════════════════════ */
  const RANGE_DEFS = [
    { id: "titer",  ko: "Titer",          fixed: "titer.titerHCCF" },
    { id: "yield",  ko: "Step 수율",      picks: [
        ["downstream.proteinAYield", "Protein A"], ["downstream.cexYield", "CEX"],
        ["downstream.aexYield", "AEX"], ["downstream.totalYield", "Total"]] },
    { id: "purity", ko: "순도",           picks: [
        ["downstream.monomerPurity", "SEC Monomer"], ["seHPLC.main", "SE-HPLC Main"],
        ["ieHPLC.main", "IE-HPLC Main"], ["ceSdsNR.monomer", "CE-SDS Monomer"]] },
    { id: "trace",  ko: "당쇄 · 불순물",  picks: [
        ["nGlycan.highMannose", "High mannose"], ["nGlycan.sialicAcid", "Sialic acid"],
        ["nGlycan.afucosylated", "Afucosylated"], ["seHPLC.hmw", "HMW"],
        ["ieHPLC.acidic", "Acidic"], ["downstream.hcp", "HCP"],
        ["downstream.residualDNA", "Residual DNA"]] }
  ];

  function initRanges() {
    RANGE_DEFS.forEach(function (d) {
      if (!view.ranges[d.id]) {
        view.ranges[d.id] = { on: false, key: d.fixed || d.picks[0][0], min: null, max: null };
      }
    });
  }

  /* 슬라이더 경계는 현재 범위의 실제 값에서 뽑습니다 — 임의의 0~100 을 쓰면
     데이터가 몰린 구간에서 슬라이더가 거의 안 움직입니다. */
  function boundsOf(key) {
    const m = metricByKey(key);
    if (!m) return null;
    const vals = batches.map(b => m.get(b)).filter(num);
    if (vals.length < 2) return null;
    let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi === lo) { hi = lo + 1; }
    const span = hi - lo;
    const stepRaw = span / 100;
    const step = MC.niceStep(stepRaw) / 10 || 0.01;
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    return { lo: lo, hi: hi, step: step, unit: m.unit, dp: m.dp, label: m.label, team: m.team };
  }

  function activeRanges() {
    return RANGE_DEFS.map(d => Object.assign({ def: d }, view.ranges[d.id]))
      .filter(r => r.on && r.min !== null && r.max !== null);
  }

  /* "hit" | "miss" | "nodata" | "none" */
  function stateOf(row) {
    const act = activeRanges();
    if (!act.length) return "none";
    const b = row.batchId ? batchOf(row) : row;
    let sawNoData = false;
    for (let i = 0; i < act.length; i++) {
      const m = metricByKey(act[i].key);
      if (!m) continue;
      const v = window.Repo.valueOf(b, m.groupId, m.itemKey);
      if (!num(v)) { sawNoData = true; continue; }
      if (v < act[i].min || v > act[i].max) return "miss";
    }
    return sawNoData ? "nodata" : "hit";
  }

  function stateCounts(list) {
    const c = { hit: 0, miss: 0, nodata: 0 };
    list.forEach(r => { const s = stateOf(r); if (c[s] !== undefined) c[s]++; });
    return c;
  }

  /* ══════════════════════════════════════════════════════════════════════
     핀
     ══════════════════════════════════════════════════════════════════════ */
  function pinsOfCell(batchId, groupId, itemKey) {
    return window.Pins ? window.Pins.forCell(batchId, groupId, itemKey) : [];
  }
  function pinnedBatchLabels(list) {
    if (!window.Pins) return [];
    const ids = {};
    window.Pins.all().forEach(p => { ids[p.batchId] = true; });
    return list.filter(r => ids[batchIdOf(r)]).map(rowLabel);
  }
  function meetingContext() {
    const sel = window.Scope.get();
    const d = window.Scope.describe();
    const st = view.focus ? (batches.find(b => b.id === view.focus) || {}) : {};
    return {
      projectId: sel.scopeId || null,
      projectCode: d.scope || null,
      studyId: sel.studyId || st.studyId || null,
      studyName: d.study || null
    };
  }

  /* ══════════════════════════════════════════════════════════════════════
     필터 바
     ══════════════════════════════════════════════════════════════════════ */
  function presets() {
    try { return JSON.parse(localStorage.getItem(PRESET_KEY) || "[]"); } catch (e) { return []; }
  }
  function savePresets(list) {
    try { localStorage.setItem(PRESET_KEY, JSON.stringify(list)); } catch (e) {}
  }

  function filterBar() {
    const list = presets();
    const mv = visibleMetrics();
    const tabs = [{ key: "all", ko: "전체" }].concat(
      window.DATA_TEAMS.map(t => ({ key: t.id, ko: t.short + "(" + (t.en || "") + ")" })));

    return '<div class="mm-filter" id="mm-filter">' +
      '<div class="card"><div class="card-body">' +

      /* 1) 공정 · 팀 */
      '<div class="mm-frow">' +
        '<span class="mm-flabel">공정 · 팀</span>' +
        '<div class="mm-pills">' + tabs.map(t =>
          '<button class="mm-pill" data-view="' + t.key + '"' +
          (view.tab === t.key ? ' aria-current="true"' : "") + '>' + esc(t.ko) + '</button>').join("") +
        '</div>' +
        '<div class="mm-fspacer"></div>' +
        '<label class="ebr-cell" style="min-width:190px"><span>배치 · 항목 검색</span>' +
          '<input class="ebr-input" id="mm-q" type="search" value="' + esc(view.q) + '" ' +
            'placeholder="예: B123-4, Titer"></label>' +
        '<label class="ebr-cell" style="min-width:150px"><span>정렬</span>' +
          '<select class="ebr-input" id="mm-sort">' +
            '<option value="id"' + (view.sortKey === "id" ? " selected" : "") + '>배치 번호</option>' +
            mv.map(m => '<option value="' + esc(m.key) + '"' +
              (view.sortKey === m.key ? " selected" : "") + '>' + esc(m.label) + '</option>').join("") +
          '</select></label>' +
        '<label class="ebr-cell" style="min-width:96px"><span>방향</span>' +
          '<select class="ebr-input" id="mm-dir">' +
            '<option value="1"' + (view.sortDir === 1 ? " selected" : "") + '>오름</option>' +
            '<option value="-1"' + (view.sortDir === -1 ? " selected" : "") + '>내림</option>' +
          '</select></label>' +
      '</div>' +

      /* 2) 수치 범위 */
      '<div class="mm-ranges">' + RANGE_DEFS.map(rangeControl).join("") + '</div>' +

      '<div class="mm-frow" style="margin-top:var(--s-3)">' +
        '<div id="mm-summary" class="mm-summary"></div>' +
        '<div class="mm-fspacer"></div>' +
        (list.length
          ? '<select class="ebr-input" id="mm-preset" style="max-width:170px">' +
            '<option value="">— 프리셋 불러오기 —</option>' +
            list.map((p, i) => '<option value="' + i + '">' + esc(p.name) + '</option>').join("") +
            '</select>' : "") +
        '<button class="btn btn-ghost btn-sm" id="mm-save">조합 저장</button>' +
        '<button class="btn btn-ghost btn-sm" id="mm-reset">조건 초기화</button>' +
      '</div>' +

      '</div></div></div>';
  }

  function rangeControl(def) {
    const r = view.ranges[def.id];
    const b = boundsOf(r.key);
    if (!b) {
      return '<div class="mm-range is-off"><div class="mm-range-head">' +
        '<span class="mm-range-ko">' + esc(def.ko) + '</span>' +
        '<span class="mm-range-na">값이 부족해 범위를 만들 수 없습니다</span></div></div>';
    }
    if (r.min === null) { r.min = b.lo; r.max = b.hi; }
    /* 항목을 바꾸면 이전 항목의 눈금이 남아 있을 수 있어 경계로 다시 맞춥니다 */
    r.min = Math.max(b.lo, Math.min(r.min, b.hi));
    r.max = Math.max(b.lo, Math.min(r.max, b.hi));
    if (r.min > r.max) { const t = r.min; r.min = r.max; r.max = t; }

    const pct = v => ((v - b.lo) / (b.hi - b.lo)) * 100;
    const dp = b.dp === undefined ? 1 : b.dp;

    return '<div class="mm-range' + (r.on ? " is-on" : "") + '" data-range="' + def.id + '">' +
      '<div class="mm-range-head">' +
        '<label class="mm-range-toggle"><input type="checkbox" data-ron="' + def.id + '"' +
          (r.on ? " checked" : "") + '><span class="mm-range-ko">' + esc(def.ko) + '</span></label>' +
        (def.picks
          ? '<select class="mm-range-pick" data-rkey="' + def.id + '">' +
            def.picks.map(p => '<option value="' + p[0] + '"' +
              (r.key === p[0] ? " selected" : "") + '>' + esc(p[1]) + '</option>').join("") +
            '</select>'
          : '<span class="mm-range-pick is-static">' + esc(b.label) + '</span>') +
        '<span class="mm-range-val mono" data-rval="' + def.id + '">' +
          r.min.toFixed(dp) + " ~ " + r.max.toFixed(dp) + (b.unit ? " " + esc(b.unit) : "") + '</span>' +
      '</div>' +
      '<div class="mm-dual">' +
        '<div class="mm-dual-track"></div>' +
        '<div class="mm-dual-fill" data-rfill="' + def.id + '" style="left:' + pct(r.min).toFixed(2) +
          '%;right:' + (100 - pct(r.max)).toFixed(2) + '%"></div>' +
        '<input type="range" data-rmin="' + def.id + '" min="' + b.lo + '" max="' + b.hi +
          '" step="' + b.step + '" value="' + r.min + '" aria-label="' + esc(def.ko) + ' 최소">' +
        '<input type="range" data-rmax="' + def.id + '" min="' + b.lo + '" max="' + b.hi +
          '" step="' + b.step + '" value="' + r.max + '" aria-label="' + esc(def.ko) + ' 최대">' +
      '</div></div>';
  }

  function paintSummary() {
    const host = $("#mm-summary");
    if (!host) return;
    const act = activeRanges();
    const list = visibleBatches();
    if (!act.length) {
      host.innerHTML = '<span class="mm-sum-none">수치 범위 조건이 없습니다 — ' +
        '왼쪽 체크박스를 켜면 조건에 맞는 데이터가 강조됩니다.</span>';
      return;
    }
    const c = stateCounts(list);
    host.innerHTML =
      '<span class="mm-sum-chip is-hit">● 조건 만족 ' + c.hit + '</span>' +
      '<span class="mm-sum-chip is-miss">○ 벗어남 ' + c.miss + '</span>' +
      '<span class="mm-sum-chip is-nodata">— 해당 항목 미입력 ' + c.nodata + '</span>' +
      '<span class="mm-sum-note">전체 ' + list.length + '건은 모두 화면에 남아 있습니다 (숨기지 않습니다)</span>';
  }

  /* ══════════════════════════════════════════════════════════════════════
     동기화 뷰 (전체 탭)
     ══════════════════════════════════════════════════════════════════════ */
  function focusBatch() {
    if (view.focus) {
      const b = batches.find(x => x.id === view.focus);
      if (b) return b;
    }
    return null;
  }

  function syncView() {
    return '<section class="card" style="margin-bottom:var(--s-4)"><div id="mm-day"></div></section>' +
           '<div id="mm-sync" style="margin-bottom:var(--s-4)"></div>' +
           '<section class="card" style="margin-bottom:var(--s-4)"><div id="mm-table"></div></section>' +
           '<section class="card"><div id="mm-chart"></div></section>';
  }

  function paintDay() {
    const host = $("#mm-day");
    if (!host) return;
    const days = (window.DATA_TITER_DAYS || []).filter(d =>
      batches.some(b => b.upstream && b.upstream.titer && num(b.upstream.titer[d])));
    const vis = visibleBatches();
    const series = vis.map(function (r, i) {
      const b = r.batchId ? batchOf(r) : r;
      const pts = days.map(d => ({ day: d, value: (b.upstream && b.upstream.titer) ? b.upstream.titer[d] : null }))
        .filter(p => num(p.value));
      return { batchId: b.id, label: rowLabel(r), color: PALETTE[i % PALETTE.length],
               points: pts, state: stateOf(r) };
    }).filter(s => s.points.length);

    host.innerHTML =
      '<div class="card-head" style="padding-bottom:var(--s-3)"><div>' +
        '<h2 class="card-title">일자별 Titer 추이 · 배양</h2>' +
        '<p class="card-sub">점을 누르면 그 배치의 정제 · 바이오분석 데이터가 아래에 연동됩니다 · ' +
        '원본에 Day 축이 있는 항목은 Titer뿐입니다 (D10~D14)</p></div>' +
        (view.focus ? '<button class="btn btn-ghost btn-sm" id="mm-unfocus">연동 해제</button>' : "") +
      '</div>' +
      '<div class="card-body">' + MC.dayLines({
        days: days, series: series, unit: "mg/L",
        focusBatch: view.focus, focusDay: view.focusDay,
        aria: "배치별 일자별 Titer 추이"
      }) + '</div>';

    $$(".mmc-pt", host).forEach(function (el) {
      const go = function () {
        view.focus = el.dataset.b;
        view.focusDay = el.dataset.day;
        syncAll();
      };
      el.addEventListener("click", go);
      el.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
      });
    });
    const un = $("#mm-unfocus");
    if (un) un.addEventListener("click", function () {
      view.focus = null; view.focusDay = null; syncAll();
    });
  }

  /* 3팀 카드 — 선택된 배치 하나를 세 팀 관점에서 나란히 */
  const SYNC_SETS = [
    { team: "upstream", items: [
      ["upstream", "maxVCD"], ["upstream", "finalVCD"], ["upstream", "finalViability"],
      ["upstream", "ivcd"], ["titer", "titerHCCF"], ["titer", "qP"]] },
    { team: "downstream", items: [
      ["downstream", "proteinAYield"], ["downstream", "cexYield"], ["downstream", "aexYield"],
      ["downstream", "totalYield"], ["downstream", "monomerPurity"],
      ["downstream", "hcp"], ["downstream", "residualDNA"]] },
    { team: "analytics", items: [
      ["seHPLC", "main"], ["seHPLC", "hmw"], ["ieHPLC", "acidic"], ["ieHPLC", "main"],
      ["ceSdsNR", "monomer"], ["nGlycan", "highMannose"], ["nGlycan", "sialicAcid"]] }
  ];

  function paintSync() {
    const host = $("#mm-sync");
    if (!host) return;
    const b = focusBatch();
    if (!b) {
      host.innerHTML = '<section class="card"><div class="empty">' +
        '<div class="empty-title">배치를 하나 선택하면 3개 팀 데이터가 동기화됩니다</div>' +
        '<div class="empty-body">위 그래프의 점이나 아래 표의 행을 누르세요.</div></div></section>';
      return;
    }
    const study = window.Repo.studyOf(b);
    const st = stateOf(b);

    host.innerHTML =
      '<section class="card"><div class="card-head"><div>' +
        '<h2 class="card-title">' + esc(b.expNo || b.id) + ' — 3개 팀 동기화</h2>' +
        '<p class="card-sub">' + esc(study ? study.name : "") +
          (b.initialDate ? " · " + esc(b.initialDate) : "") +
          (view.focusDay ? " · 선택한 시점 " + esc(view.focusDay) : "") +
          " · 정제 · 분석 값은 배치 단위로 1건씩 기록됩니다 (일자별 아님)</p></div>" +
        '<span class="mm-state is-' + st + '">' +
          (st === "hit" ? "● 조건 만족" : st === "miss" ? "○ 조건 벗어남" :
           st === "nodata" ? "— 조건 항목 미입력" : "조건 없음") + '</span>' +
      '</div><div class="card-body"><div class="mm-sync-grid">' +
      SYNC_SETS.map(function (set) {
        const t = window.DATA_TEAMS.find(x => x.id === set.team) || {};
        return '<div class="mm-sync-col" style="--team:' + (t.color || "var(--c-border)") + '">' +
          '<div class="mm-sync-head">' + esc(t.ko || set.team) + '</div>' +
          set.items.map(function (p) {
            const g = window.DATA_ANALYTE_GROUPS.find(x => x.id === p[0]);
            if (!g) return "";
            const it = g.items.find(x => x.key === p[1]);
            if (!it) return "";
            const v = window.Repo.valueOf(b, g.id, it.key);
            const pins = pinsOfCell(b.id, g.id, it.key);
            return '<div class="mm-sync-row' + (num(v) ? "" : " is-na") + '">' +
              '<span class="mm-sync-k">' + esc(it.label) + '</span>' +
              '<span class="mm-sync-v mono">' + (num(v) ? fmt(v, it.dp) : L.empty) +
                (num(v) && it.unit ? '<span class="mm-sync-u">' + esc(it.unit) + '</span>' : "") + '</span>' +
              (pins.length ? '<span class="mm-pinmark" title="' + esc(pins.map(x => x.text).join(" / ")) +
                '">◆' + (pins.length > 1 ? pins.length : "") + '</span>' : "") +
              '<button class="mm-pinb" data-pin="' + esc(b.id + "|" + g.id + "|" + it.key) +
                '" aria-label="' + esc(it.label) + ' 값에 핀 남기기" title="이 값에 핀 남기기">＋핀</button>' +
            '</div>';
          }).join("") + '</div>';
      }).join("") + '</div></div></section>';

    wirePinButtons(host);
  }

  /* ══════════════════════════════════════════════════════════════════════
     표
     ══════════════════════════════════════════════════════════════════════ */
  function sortedRows() {
    const mv = visibleMetrics();
    const m = mv.find(x => x.key === view.sortKey);
    const val = b => (view.sortKey === "id" ? rowLabel(b) : (m ? m.get(b) : null));
    return visibleBatches().slice().sort(function (a, b) {
      const va = val(a), vb = val(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * view.sortDir;
      return String(va).localeCompare(String(vb)) * view.sortDir;
    });
  }

  function paintTable() {
    const host = $("#mm-table");
    if (!host) return;
    const mv = visibleMetrics();
    const list = sortedRows();
    const teamColor = id => (window.DATA_TEAMS.find(t => t.id === id) || {}).color || "var(--c-border)";
    const syncMode = view.tab === "all";

    if (!list.length || !mv.length) {
      host.innerHTML = '<div class="empty"><div class="empty-title">표시할 데이터가 없습니다</div>' +
        '<div class="empty-body">검색어를 지우거나 다른 팀을 선택해 보세요.</div></div>';
      return;
    }

    host.innerHTML =
      '<div class="card-head" style="padding-bottom:var(--s-3)"><div>' +
        '<h2 class="card-title">' + (syncMode ? "통합 데이터 테이블" : "데이터 테이블") + '</h2>' +
        '<p class="card-sub">' +
          (syncMode ? "행을 누르면 위 3개 팀 카드가 그 배치로 연동됩니다"
                    : "행을 누르면 그 " + (isSampleGrain() ? "시료" : "배치") + "만 그래프에 남습니다 (여러 개 선택 가능)") +
          ' · 값 위에 마우스를 올리면 핀을 남길 수 있습니다 · ' +
          list.length + (isSampleGrain() ? "개 시료 · " : "개 배치 · ") + mv.length + "개 항목</p></div>" +
        (!syncMode && view.picked.length
          ? '<span class="badge badge-accent">' + view.picked.length + '건 선택</span>' : "") +
      '</div>' +
      '<div class="tbl-scroll"><table class="tbl mm-tbl"><thead><tr>' +
        '<th scope="col">' + (isSampleGrain() ? "시료" : "Exp. No.") + '</th>' +
        '<th scope="col" style="width:64px">조건</th>' +
        mv.map(m => '<th scope="col" style="border-top:2px solid ' + teamColor(m.team) + '">' +
          esc(m.label) + '<br><span style="font-weight:400;text-transform:none">' +
          esc(m.unit) + '</span></th>').join("") +
      '</tr></thead><tbody>' +
      list.map(function (r) {
        const bid = batchIdOf(r);
        const st = stateOf(r);
        const on = view.picked.indexOf(r.id) > -1;
        const focused = syncMode && view.focus === bid;
        return '<tr class="is-pickable st-' + st + (on ? " is-picked" : "") + (focused ? " is-focus" : "") +
          '" data-pick="' + esc(r.id) + '" data-batch="' + esc(bid) + '" tabindex="0" role="button" ' +
          'aria-pressed="' + (syncMode ? focused : on) + '" aria-label="' + esc(rowLabel(r)) + '">' +
          '<td class="mono" style="font-weight:600">' + esc(rowLabel(r)) +
            (isSampleGrain() && r.stage
              ? '<br><span style="font-weight:400;font-size:10px;color:var(--c-text-mute)">' +
                esc(r.stage) + '</span>' : "") + '</td>' +
          '<td class="mm-st"><span class="mm-state is-' + st + '">' +
            (st === "hit" ? "●" : st === "miss" ? "○" : st === "nodata" ? "—" : "·") + '</span></td>' +
          mv.map(function (m) {
            const v = m.get(r);
            const pins = pinsOfCell(bid, m.groupId, m.itemKey);
            const cell = num(v) ? Number(v).toFixed(m.dp) : L.empty;
            return '<td class="' + (num(v) ? "mono" : "na") + ' mm-cell">' +
              '<span>' + cell + '</span>' +
              (pins.length ? '<span class="mm-pinmark" title="' +
                esc(pins.map(x => x.text).join(" / ")) + '">◆</span>' : "") +
              '<button class="mm-pinb" data-pin="' + esc(bid + "|" + m.groupId + "|" + m.itemKey) +
                '" tabindex="-1" aria-label="' + esc(rowLabel(r) + " " + m.label) + ' 값에 핀 남기기">＋</button>' +
              '</td>';
          }).join("") + '</tr>';
      }).join("") + '</tbody></table></div>';

    $$("[data-pick]", host).forEach(function (tr) {
      const act = function () {
        if (syncMode) {
          view.focus = (view.focus === tr.dataset.batch) ? null : tr.dataset.batch;
          view.focusDay = null;
        } else {
          const id = tr.dataset.pick;
          const i = view.picked.indexOf(id);
          if (i > -1) view.picked.splice(i, 1); else view.picked.push(id);
        }
        syncAll();
      };
      tr.addEventListener("click", function (e) {
        if (e.target.closest(".mm-pinb")) return;      // 핀 버튼은 행 선택과 별개입니다
        act();
      });
      tr.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); }
      });
    });
    wirePinButtons(host);
  }

  function wirePinButtons(host) {
    $$("[data-pin]", host).forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        const parts = b.dataset.pin.split("|");
        openPinComposer(parts[0], parts[1], parts[2]);
      });
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     그래프
     ══════════════════════════════════════════════════════════════════════ */
  function axisMin(vals) {
    const v = vals.filter(num);
    if (v.length < 2) return null;
    const lo = Math.min.apply(null, v), hi = Math.max.apply(null, v);
    if (lo <= 0 || hi <= 0) return null;
    if ((hi - lo) / hi > 0.45) return null;
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
    const min = (ms.length === 1 || sameUnit(ms)) ? axisMin(allVals) : null;
    const states = bs.map(stateOf);
    const act = activeRanges();

    host.innerHTML =
      '<div class="card-head" style="padding-bottom:var(--s-3)"><div>' +
        '<h2 class="card-title">' + (view.metric ? esc(ms[0].label) : "대표 지표 비교") + '</h2>' +
        '<p class="card-sub">' +
          (view.picked.length ? "선택한 " + bs.length + "건" : "전체 " + bs.length + "건") + " · " +
          (view.metric ? esc(ms[0].label) : "대표 지표 " + ms.length + "개") +
          (sameUnit(ms) ? "" : " · 단위가 서로 달라 같은 축에 겹쳐 보입니다") +
          (act.length ? " · 조건에서 벗어난 막대는 흐리게 그렸습니다 (지우지 않습니다)" : "") +
        '</p></div></div>' +
      '<div class="card-body chart-swap">' +
        C.swatches(series) +
        '<div class="chart-wrap" style="margin-top:var(--s-3)">' +
          MC.bars({ cats: cats, series: series, states: states, min: min,
                    focus: view.focus ? (bs.find(r => batchIdOf(r) === view.focus) || {}) && rowLabel(bs.find(r => batchIdOf(r) === view.focus) || {}) : null,
                    pinned: pinnedBatchLabels(bs), h: 320, w: 940,
                    aria: (view.metric ? ms[0].label : "대표 지표") + " 배치별 비교" }) +
        '</div>' +
        (min != null
          ? '<p style="font-size:11px;color:var(--c-text-mute);margin:var(--s-2) 0 0">' +
            '세로축은 ' + min + ' 부터 시작합니다 — 값이 좁은 구간에 몰려 있어 0부터 그리면 차이가 보이지 않습니다.</p>' : "") +
        C.dataTable((view.metric ? ms[0].label : "대표 지표") + " 배치별 값",
          ["배치"].concat(series.map(s => s.name)),
          cats.map((c, i) => [c].concat(series.map(s => num(s.data[i]) ? String(s.data[i]) : L.empty)))) +
      '</div>';

    /* 막대를 눌러도 동기화 대상이 바뀝니다 */
    $$(".mmc-hit", host).forEach(function (el) {
      const go = function () {
        const r = bs[+el.dataset.cat];
        if (!r) return;
        view.focus = batchIdOf(r); view.focusDay = null;
        syncAll();
      };
      el.addEventListener("click", go);
      el.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
      });
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     항목 칩 (팀 탭)
     ══════════════════════════════════════════════════════════════════════ */
  function paintChips() {
    const host = $("#mm-chips");
    if (!host) return;
    const mv = visibleMetrics();
    const filled = m => rows().filter(b => num(m.get(b))).length;
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
     팀 요약 (전체 탭 상단)
     ══════════════════════════════════════════════════════════════════════ */
  function issues() {
    const out = [];
    batches.forEach(b => window.DATA_ANALYTE_GROUPS.forEach(g => {
      if (g.empty) return;
      g.items.forEach(function (it) {
        if (window.Repo.cellState(b, g.id, it.key) === "empty")
          out.push({ batch: b.id, group: g.label, item: it.label, team: g.team });
      });
    }));
    return out;
  }

  function headlineMetrics(team) {
    const n = f => batches.map(f).filter(num);
    const avg = a => a.length ? fmt(a.reduce((x, y) => x + y, 0) / a.length, 1) : L.empty;
    if (team === "upstream") {
      const t = n(b => b.upstream.titerHCCF);
      return [
        { k: "최고 Titer", v: t.length ? fmt(Math.max.apply(null, t), 0) : L.empty, u: "mg/L" },
        { k: "평균 Titer", v: avg(t), u: "mg/L" },
        { k: "평균 Viability", v: avg(n(b => b.upstream.finalViability)), u: "%" }
      ];
    }
    if (team === "downstream") {
      const d = k => n(b => (b.downstream ? b.downstream[k] : null));
      return [
        { k: "평균 Total Yield", v: avg(d("totalYield")), u: "%" },
        { k: "평균 HCP", v: avg(d("hcp")), u: "ppm" },
        { k: "평균 Monomer", v: avg(d("monomerPurity")), u: "%" }
      ];
    }
    return [
      { k: "CE-SDS Monomer", v: avg(n(b => window.Repo.valueOf(b, "ceSdsNR", "monomer"))), u: "%" },
      { k: "IE-HPLC Main", v: avg(n(b => window.Repo.valueOf(b, "ieHPLC", "main"))), u: "%" },
      { k: "SE-HPLC Main", v: avg(n(b => window.Repo.valueOf(b, "seHPLC", "main"))), u: "%" }
    ];
  }

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
              esc(t.ko) + ' 상세 →</button></div>' +
        '</section>';
      }).join("") + '</div>';
  }

  /* ══════════════════════════════════════════════════════════════════════
     우측 패널 — 핀 · 결정 · 조치 · 회의록
     ══════════════════════════════════════════════════════════════════════ */
  function openPinComposer(batchId, groupId, itemKey) {
    const b = batches.find(x => x.id === batchId);
    const g = window.DATA_ANALYTE_GROUPS.find(x => x.id === groupId);
    const it = g ? g.items.find(x => x.key === itemKey) : null;
    if (!b || !g || !it) return;
    view.pinTarget = {
      batchId: b.id, batchLabel: b.expNo || b.id,
      groupId: g.id, itemKey: it.key, metricLabel: it.label,
      unit: it.unit, dp: it.dp, team: g.team,
      value: window.Repo.valueOf(b, g.id, it.key),
      day: (g.id === "titer" || g.id === "upstream") ? view.focusDay : null
    };
    view.panel = true;
    paintPanel();
    setTimeout(() => { const t = $("#mm-pin-text"); if (t) t.focus(); }, 30);
  }

  function paintPanel() {
    const host = $("#mv-side");
    if (!host) return;
    if (!view.panel) { host.innerHTML = ""; host.classList.add("is-off"); return; }
    host.classList.remove("is-off");

    const P = window.Pins;
    const cur = P ? P.currentMeeting() : null;
    const mine = cur ? { pins: P.all().filter(p => p.meetingId === cur.id), notes: P.notesOf(cur.id) }
                     : { pins: [], notes: [] };
    const past = P ? P.openActions(cur ? cur.id : null) : [];
    const decisions = mine.notes.filter(n => n.kind === "decision");
    const actions = mine.notes.filter(n => n.kind === "action");

    host.innerHTML =
      '<div class="mm-side-head">' +
        '<span>회의 기록</span>' +
        '<button class="btn-icon" id="mm-panel-hide" aria-label="패널 닫기" title="패널 닫기">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round"><path d="m9 18 6-6-6-6"/></svg></button>' +
      '</div>' +
      '<div class="mm-side-body">' +

      /* 1) 핀 작성 */
      (view.pinTarget ? pinComposer() : "") +

      /* 2) 결정 · 조치 입력 */
      '<section class="mm-sec"><div class="mm-sec-h">결정 · 조치 기록</div>' +
        '<div class="mm-note-kinds">' +
          '<button class="mm-kind" data-nk="decision" aria-pressed="' + (view.noteKind === "decision") + '">의사결정</button>' +
          '<button class="mm-kind" data-nk="action" aria-pressed="' + (view.noteKind === "action") + '">조치 (To-Do)</button>' +
        '</div>' +
        '<textarea class="ebr-input mm-ta" id="mm-note-text" rows="2" placeholder="' +
          (view.noteKind === "action" ? "예: B123-7 조건으로 확인 배양 1회 추가" : "예: 다음 DoE 시 2번 배지 조건 채택") +
          '"></textarea>' +
        (view.noteKind === "action"
          ? '<div class="mm-note-row">' +
              '<label class="ebr-cell" style="flex:1"><span>담당자 @</span>' +
                '<select class="ebr-input" id="mm-note-who">' +
                  '<option value="">— 선택 —</option>' +
                  (window.People ? window.People.grouped().map(gr =>
                    '<optgroup label="' + esc(gr.ko) + '">' + gr.people.map(p =>
                      '<option value="' + esc(p.name) + '" data-team="' + esc(p.team) + '">' +
                      esc(p.name) + " · " + esc(p.role) + '</option>').join("") + '</optgroup>').join("") : "") +
                '</select></label>' +
              '<label class="ebr-cell" style="width:132px"><span>기한</span>' +
                '<input class="ebr-input" id="mm-note-due" type="date" value="' + esc(defaultDue()) + '"></label>' +
            '</div>'
          : "") +
        '<div class="mm-note-row">' +
          '<button class="btn btn-accent btn-sm" id="mm-note-go" style="flex:1">' +
            (view.noteKind === "action" ? "기록하고 To-Do 등록" : "결정 기록") + '</button>' +
        '</div>' +
        '<p class="mm-msg" id="mm-note-msg"></p>' +
      '</section>' +

      /* 3) 이번 회의 */
      '<section class="mm-sec"><div class="mm-sec-h">이번 회의 ' +
        '<span class="mm-sec-n">핀 ' + mine.pins.length + ' · 결정 ' + decisions.length +
        ' · 조치 ' + actions.length + '</span></div>' +
        (mine.pins.length || mine.notes.length ? "" :
          '<p class="mm-empty">아직 기록이 없습니다. 값 옆의 ＋핀 을 눌러 지적하거나 위에 결정을 적으세요.</p>') +
        mine.pins.map(pinRow).join("") +
        decisions.map(n => noteRow(n, "결정")).join("") +
        actions.map(n => noteRow(n, "조치")).join("") +
      '</section>' +

      /* 4) 지난 회의 미완료 조치 */
      '<section class="mm-sec"><div class="mm-sec-h">지난 회의 미완료 조치 ' +
        '<span class="mm-sec-n">' + past.length + '건</span></div>' +
        (past.length
          ? past.map(n => '<div class="mm-item is-past">' +
              '<div class="mm-item-t">' + esc(n.text) + '</div>' +
              '<div class="mm-item-m">@' + esc(n.assignee || "미지정") +
                (n.due ? " · 기한 " + esc(n.due) : "") + '</div></div>').join("")
          : '<p class="mm-empty">미완료 조치가 없습니다.</p>') +
      '</section>' +

      /* 5) 회의록 */
      '<section class="mm-sec">' +
        '<button class="btn btn-ghost btn-sm" id="mm-minutes" style="width:100%">회의록 만들기</button>' +
        '<div id="mm-minutes-out"></div>' +
      '</section>' +
      '</div>';

    wirePanel();
  }

  function defaultDue() {
    const t = window.HubCalendar ? window.HubCalendar.today() : new Date().toISOString().slice(0, 10);
    const d = new Date(t + "T00:00:00");
    d.setDate(d.getDate() + 7);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function pinComposer() {
    const t = view.pinTarget;
    return '<section class="mm-sec is-compose"><div class="mm-sec-h">이 값에 핀 남기기</div>' +
      '<div class="mm-pin-target">' +
        '<span class="mono">' + esc(t.batchLabel) + '</span> · ' + esc(t.metricLabel) +
        (t.day ? " · " + esc(t.day) : "") + ' — <b class="mono">' +
        (num(t.value) ? fmt(t.value, t.dp) + (t.unit ? " " + esc(t.unit) : "") : L.empty) + '</b>' +
      '</div>' +
      '<div class="mm-note-kinds">' +
        Object.keys(window.Pins.KIND).map(k =>
          '<button class="mm-kind" data-pk="' + k + '" aria-pressed="' + (pinKind === k) + '">' +
          window.Pins.KIND[k].mark + " " + esc(window.Pins.KIND[k].ko) + '</button>').join("") +
      '</div>' +
      '<textarea class="ebr-input mm-ta" id="mm-pin-text" rows="2" ' +
        'placeholder="예: 동일 조건 재현 필요 · 원인 확인 후 재논의"></textarea>' +
      '<div class="mm-note-row">' +
        '<button class="btn btn-accent btn-sm" id="mm-pin-go" style="flex:1">핀 남기기</button>' +
        '<button class="btn btn-ghost btn-sm" id="mm-pin-cancel">취소</button>' +
      '</div>' +
      '<p class="mm-msg" id="mm-pin-msg"></p></section>';
  }
  let pinKind = "decision";

  function pinRow(p) {
    const K = window.Pins.KIND[p.kind] || window.Pins.KIND.decision;
    return '<div class="mm-item is-pin" data-jump="' + esc(p.batchId) + '">' +
      '<div class="mm-item-t"><span class="mm-item-mark">' + K.mark + '</span>' + esc(p.text) + '</div>' +
      '<div class="mm-item-m"><span class="mono">' + esc(p.batchLabel) + '</span> · ' +
        esc(p.metricLabel) + (p.value !== null ? " " + p.value + (p.unit ? " " + esc(p.unit) : "") : " (미입력)") +
        (p.day ? " · " + esc(p.day) : "") + ' · ' + esc(p.createdBy) + '</div>' +
      '<button class="mm-item-x" data-delpin="' + esc(p.id) + '" aria-label="핀 삭제">×</button></div>';
  }
  function noteRow(n, ko) {
    return '<div class="mm-item">' +
      '<div class="mm-item-t"><span class="mm-item-mark">' + (n.kind === "action" ? "▶" : "◆") + '</span>' +
        esc(n.text) + '</div>' +
      '<div class="mm-item-m">' + ko +
        (n.assignee ? " · @" + esc(n.assignee) : "") + (n.due ? " · " + esc(n.due) : "") +
        (n.todoId ? " · To-Do 등록됨" : "") + '</div>' +
      '<button class="mm-item-x" data-delnote="' + esc(n.id) + '" aria-label="기록 삭제">×</button></div>';
  }

  function wirePanel() {
    const host = $("#mv-side");
    if (!host) return;

    const hide = $("#mm-panel-hide", host);
    if (hide) hide.addEventListener("click", function () { view.panel = false; paintPanel(); paintPanelToggle(); });

    $$("[data-nk]", host).forEach(b => b.addEventListener("click", function () {
      view.noteKind = b.dataset.nk; paintPanel();
    }));
    $$("[data-pk]", host).forEach(b => b.addEventListener("click", function () {
      pinKind = b.dataset.pk; paintPanel();
      setTimeout(() => { const t = $("#mm-pin-text"); if (t) t.focus(); }, 20);
    }));

    const pinGo = $("#mm-pin-go", host);
    if (pinGo) pinGo.addEventListener("click", function () {
      const t = view.pinTarget;
      const txt = ($("#mm-pin-text") || {}).value || "";
      const r = window.Pins.add({
        batchId: t.batchId, batchLabel: t.batchLabel,
        groupId: t.groupId, itemKey: t.itemKey, metricLabel: t.metricLabel,
        unit: t.unit, value: t.value, day: t.day, team: t.team,
        kind: pinKind, text: txt, context: meetingContext()
      });
      const msg = $("#mm-pin-msg");
      if (!r.ok) { if (msg) msg.textContent = r.reason; return; }
      view.pinTarget = null;
      syncAll();
    });
    const pinCancel = $("#mm-pin-cancel", host);
    if (pinCancel) pinCancel.addEventListener("click", function () { view.pinTarget = null; paintPanel(); });

    const noteGo = $("#mm-note-go", host);
    if (noteGo) noteGo.addEventListener("click", function () {
      const txt = ($("#mm-note-text") || {}).value || "";
      const sel = $("#mm-note-who");
      const opt = sel && sel.selectedIndex > 0 ? sel.options[sel.selectedIndex] : null;
      const r = window.Pins.addNote({
        kind: view.noteKind, text: txt,
        assignee: opt ? opt.value : null,
        team: opt ? opt.dataset.team : null,
        due: ($("#mm-note-due") || {}).value || null,
        context: meetingContext()
      });
      const msg = $("#mm-note-msg");
      if (!r.ok) { if (msg) msg.textContent = r.reason; return; }
      paintPanel();
    });

    $$("[data-delpin]", host).forEach(b => b.addEventListener("click", function (e) {
      e.stopPropagation(); window.Pins.remove(b.dataset.delpin); syncAll();
    }));
    $$("[data-delnote]", host).forEach(b => b.addEventListener("click", function (e) {
      e.stopPropagation(); window.Pins.removeNote(b.dataset.delnote); paintPanel();
    }));
    $$("[data-jump]", host).forEach(el => el.addEventListener("click", function (e) {
      if (e.target.closest(".mm-item-x")) return;
      view.tab = "all"; view.focus = el.dataset.jump; render();
    }));

    const mn = $("#mm-minutes", host);
    if (mn) mn.addEventListener("click", function () {
      const cur = window.Pins.currentMeeting();
      const out = $("#mm-minutes-out");
      if (!cur) { out.innerHTML = '<p class="mm-empty">아직 기록이 없어 회의록을 만들 수 없습니다.</p>'; return; }
      const text = window.Pins.minutesText(cur.id);
      out.innerHTML = '<textarea class="ebr-input mm-ta" id="mm-min-text" rows="10" readonly>' +
        esc(text) + '</textarea>' +
        '<button class="btn btn-ghost btn-sm" id="mm-min-copy" style="width:100%;margin-top:6px">복사</button>' +
        '<p class="mm-msg" id="mm-min-msg"></p>';
      $("#mm-min-copy").addEventListener("click", function () {
        const ta = $("#mm-min-text");
        const done = m => { const el = $("#mm-min-msg"); if (el) el.textContent = m; };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(() => done("복사했습니다."),
            () => { ta.select(); done("직접 복사해 주세요 (Ctrl+C)."); });
        } else { ta.select(); done("직접 복사해 주세요 (Ctrl+C)."); }
      });
    });
  }

  function paintPanelToggle() {
    const b = $("#mv-panel-show");
    if (b) b.style.display = view.panel ? "none" : "";
  }

  /* ══════════════════════════════════════════════════════════════════════
     그리기
     ══════════════════════════════════════════════════════════════════════ */
  function syncAll() {
    paintSummary();
    if (view.tab === "all") { paintDay(); paintSync(); }
    else paintChips();
    paintTable();
    paintChart();
    paintPanel();
    paintPanelToggle();
  }

  function render() {
    if (!on) return;
    const sel = window.Scope.get();
    const desc = window.Scope.describe();

    $("#mv-sub").textContent = desc.scope
      ? desc.scope + (desc.study ? " · " + desc.study : "") : "과제 미선택";

    if (!sel.scopeId) {
      $("#mv-body").innerHTML = '<div class="empty"><div class="empty-title">과제를 선택하세요</div>' +
        '<div class="empty-body">대시보드 상단에서 선택한 뒤 다시 열어주세요.</div></div>';
      paintPanel();
      return;
    }

    Promise.all([
      window.Scope.batches(),
      window.Repo.getTeamDataSetsForSelection(sel),
      window.Scope.samples()
    ]).then(function (r) {
      if (!on) return;
      batches = r[0];
      const teamSets = r[1];
      samples = r[2];

      if (!batches.length) {
        $("#mv-body").innerHTML = '<div class="empty"><div class="empty-title">' + esc(L.noResult) +
          '</div><div class="empty-body">' + esc(L.noResultHint) + '</div></div>';
        paintPanel();
        return;
      }

      initRanges();
      const ids = rows().map(x => x.id);
      view.picked = view.picked.filter(id => ids.indexOf(id) > -1);
      if (view.focus && !batches.some(b => b.id === view.focus)) { view.focus = null; view.focusDay = null; }
      if (!view.focus && view.tab === "all") {
        const first = batches.find(b => b.upstream && b.upstream.titer && num(b.upstream.titer.D14));
        if (first) view.focus = first.id;
      }

      $("#mv-body").innerHTML =
        filterBar() +
        (view.tab === "all"
          ? teamSummary(teamSets) + syncView()
          : '<div id="mm-chips" style="margin-bottom:var(--s-4)"></div>' +
            '<section class="card" style="margin-bottom:var(--s-4)"><div id="mm-table"></div></section>' +
            '<section class="card"><div id="mm-chart"></div></section>');

      wireFilters();
      syncAll();
    });
  }

  function wireFilters() {
    $$("[data-view]").forEach(b => b.addEventListener("click", function () {
      if (view.tab === b.dataset.view) return;
      view.tab = b.dataset.view;
      view.metric = null;
      view.sortKey = "id";
      render();
    }));

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

    /* 범위 슬라이더 — 움직이는 동안 표·그래프가 즉시 따라옵니다 */
    $$("[data-ron]").forEach(el => el.addEventListener("change", function () {
      view.ranges[el.dataset.ron].on = el.checked;
      const box = el.closest(".mm-range");
      if (box) box.classList.toggle("is-on", el.checked);
      syncAll();
    }));
    $$("[data-rkey]").forEach(el => el.addEventListener("change", function () {
      const r = view.ranges[el.dataset.rkey];
      r.key = this.value; r.min = null; r.max = null;
      repaintFilterBar();
    }));
    $$("[data-rmin],[data-rmax]").forEach(function (el) {
      const id = el.dataset.rmin || el.dataset.rmax;
      const isMin = !!el.dataset.rmin;
      el.addEventListener("input", function () {
        const r = view.ranges[id];
        const b = boundsOf(r.key);
        if (!b) return;
        let v = Number(this.value);
        if (isMin) r.min = Math.min(v, r.max); else r.max = Math.max(v, r.min);
        if (isMin && v > r.max) { this.value = r.max; }
        if (!isMin && v < r.min) { this.value = r.min; }
        /* 조건을 켜지 않은 채 움직이면 자동으로 켭니다 — 움직였는데
           아무 일도 안 일어나면 고장으로 보입니다. */
        if (!r.on) {
          r.on = true;
          const cb = $('[data-ron="' + id + '"]');
          if (cb) cb.checked = true;
          const box = el.closest(".mm-range");
          if (box) box.classList.add("is-on");
        }
        updateRangeLabel(id, b);
        syncAll();
      });
    });

    $$("[data-goto]").forEach(b => b.addEventListener("click", function () {
      view.tab = b.dataset.goto; view.metric = null; render();
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
      if (item) { view = Object.assign({}, view, item.view); view.pinTarget = null; render(); }
    });
    const reset = $("#mm-reset");
    if (reset) reset.addEventListener("click", function () {
      view.q = ""; view.picked = []; view.metric = null;
      RANGE_DEFS.forEach(d2 => { view.ranges[d2.id] = { on: false, key: view.ranges[d2.id].key, min: null, max: null }; });
      render();
    });
  }

  function updateRangeLabel(id, b) {
    const r = view.ranges[id];
    const dp = b.dp === undefined ? 1 : b.dp;
    const lab = $('[data-rval="' + id + '"]');
    if (lab) lab.textContent = r.min.toFixed(dp) + " ~ " + r.max.toFixed(dp) + (b.unit ? " " + b.unit : "");
    const fill = $('[data-rfill="' + id + '"]');
    if (fill) {
      const pct = v => ((v - b.lo) / (b.hi - b.lo)) * 100;
      fill.style.left = pct(r.min).toFixed(2) + "%";
      fill.style.right = (100 - pct(r.max)).toFixed(2) + "%";
    }
  }

  /* 슬라이더 항목이 바뀌면 경계가 통째로 달라져 필터 바만 다시 그립니다 */
  function repaintFilterBar() {
    const host = $("#mm-filter");
    if (!host) { render(); return; }
    const wrap = document.createElement("div");
    wrap.innerHTML = filterBar();
    host.replaceWith(wrap.firstChild);
    wireFilters();
    syncAll();
  }

  /* ══════════════════════════════════════════════════════════════════════
     오버레이 생명주기
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
        '<button class="btn btn-ghost btn-sm" id="mv-panel-show" style="margin-left:auto;display:none">' +
          '회의 기록 열기</button>' +
        '<button class="btn btn-ghost btn-sm" id="mv-exit">종료 (Esc)</button>' +
      '</div>' +
      '<div class="mm-main">' +
        '<div class="mm-scroll" id="mv-body"></div>' +
        '<aside class="mm-side" id="mv-side" aria-label="회의 기록"></aside>' +
      '</div>';
    document.body.appendChild(d);
    d.querySelector("#mv-exit").addEventListener("click", close);
    d.querySelector("#mv-panel-show").addEventListener("click", function () {
      view.panel = true; paintPanel(); paintPanelToggle();
    });
  }

  function onKey(e) {
    if (!on) return;
    if (e.key === "Escape") {
      const t = (e.target.tagName || "");
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(t)) { e.target.blur(); e.preventDefault(); return; }
      if (view.pinTarget) { view.pinTarget = null; paintPanel(); e.preventDefault(); return; }
      close(); e.preventDefault();
    }
  }

  function open() {
    install();
    on = true;
    lastFocus = document.activeElement;
    document.body.classList.add("mm-open");
    document.getElementById("mv").classList.add("is-on");

    const sel = window.Scope.get();
    if (sel.team) view.tab = sel.team;
    if (window.Pins) window.Pins.resumeRecent();

    unsub = [
      window.Scope.subscribe(render),
      window.Entries.subscribe(render),
      window.Pins ? window.Pins.subscribe(function () { paintPanel(); paintTable(); }) : function () {}
    ];
    document.addEventListener("keydown", onKey, true);
    render();
    setTimeout(() => { const b = document.getElementById("mv-exit"); if (b) b.focus(); }, 40);
  }

  function close() {
    on = false;
    document.body.classList.remove("mm-open");
    const el = document.getElementById("mv");
    if (el) el.classList.remove("is-on");
    if (window.Pins) window.Pins.endMeeting();
    unsub.forEach(f => { try { f(); } catch (e) {} });
    unsub = [];
    document.removeEventListener("keydown", onKey, true);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  return { install, open, close };
})();
