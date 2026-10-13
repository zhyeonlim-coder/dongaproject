/* ==========================================================================
   회의 모드 — 배양 · 정제 · 바이오분석이 한 화면에서 데이터를 검토하고
   그 자리에서 결정을 남기는 인터랙티브 리뷰 허브.

   구조
     헤더        발표자 모드 잠금 · 화면 공유 코드 · 패널 · 종료
     좌측(본문)  브리핑 → AI 봇 → 필터 바(고정) → 조건 요약 → 동기화/팀별 뷰
     우측(패널)  안건 · 핀 · 결정/조치 입력 · 지난 회의 · 회의록

   ── 조건에서 벗어난 데이터를 지우지 않는 이유 ────────────────────────────
   수치 범위 필터는 **강조만** 합니다. 행을 숨기지 않습니다.
   리뷰 회의에서 조건 밖 데이터를 화면에서 치우면, 정작 문제인 배치가 같이
   사라집니다. 그래서 모든 행을 그대로 두고 세 가지 상태로만 구분합니다.
       ● 조건 만족   ○ 조건 벗어남   — 해당 항목 미입력

   ── 일자별 데이터에 대한 사실 ────────────────────────────────────────────
   원본에서 Day 축이 있는 것은 Titer(D10~D14)뿐입니다. 정제 수율 · Charge
   Variant · Glycan 은 배치당 값이 1개입니다. 그래서 Day 는 축으로만 쓰고,
   점을 누르면 **그 배치**의 3팀 데이터가 연동됩니다.

   ── 이탈 표시에 대한 사실 ────────────────────────────────────────────────
   규격표가 없어 Pass/Fail 은 판정하지 않습니다. 표시하는 것은 같은 Study
   안에서의 ±2SD 이탈뿐이고, 화면에도 그렇게 씁니다.
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

  const PALETTE = ["#0369A1", "#6D28D9", "#0F766E", "#B45309", "#B91C1C", "#1D4ED8"];

  let view = {
    tab: "all", metric: null, sortKey: "id", sortDir: 1,
    focus: null, focusDay: null,
    pinTarget: null, noteKind: "decision", panel: true,
    big: false,             // 글자 크게 보기 (빔프로젝터)
    minutesOpen: false, minutesMsg: "",
    shareOpen: false, shareMsg: null,
    agendaDraft: ""
  };

  let batches = [], samples = [], outMap = {};
  /* 묶기 전의 그릇 목록 — 그릇 단위로 세는 계산(이탈 통계 · 미입력 현황)은
     이쪽을 씁니다. 묶음으로 세면 한 팀의 항목이 다른 팀 줄에서도 "미입력"
     으로 잡히고, 이탈 표시는 묶음 대표 그릇에만 붙어 실제 값이 적힌
     그릇과 키가 어긋납니다. */
  let rawBatches = [];

  function isSampleGrain() { return view.tab === "analytics"; }
  function rows() { return isSampleGrain() ? samples : batches; }
  /* 이름은 시료 이름입니다. 그릇(hidden batch) id 를 띄우면 화면에 B-2MQM679
     같은 내부 식별자가 나오고, 회의에서 그 줄을 부를 말이 없어집니다. */
  function rowLabel(r) { return r.name || r.expNo || r.id; }
  function batchIdOf(r) { return r.batchId || r.id; }

  /* ══════════════════════════════════════════════════════════════════════
     같은 시료를 한 줄로 — 데이터 조회 · 챗봇과 같은 규칙

     Data 입력에서 팀마다 따로 적으면 그릇이 팀 수만큼 생깁니다. 회의 모드는
     그 그릇을 그대로 한 줄씩 폈고, 그래서 **같은 시료가 세 줄로 나뉘어 각
     줄마다 자기 팀 값만 있고 나머지는 전부 "미입력"** 이었습니다. 세 팀이
     함께 보는 화면인데 셋을 나란히 볼 수 없었던 것입니다.

     같은 Study · 같은 이름이면 한 줄로 모으고, 그 줄이 그릇들을 parts 로
     들고 있습니다. 값·핀·이탈 표시는 그 항목을 실제로 적은 그릇을 찾아
     그쪽으로 보냅니다 — 핀이 엉뚱한 그릇에 붙으면 다음 회의에서 그 핀을
     찾을 수 없습니다.
     ══════════════════════════════════════════════════════════════════════ */
  function squash(s) {
    return String(s === null || s === undefined ? "" : s)
      .toLowerCase().replace(/[\s\-_.·]/g, "");
  }

  function mergeBySample(list) {
    const order = [], at = {};
    (list || []).forEach(function (b) {
      const nm = squash(rowLabel(b));
      if (!nm) { order.push([b]); return; }
      const k = String(b.studyId || "") + "\u0000" + nm;
      if (at[k] === undefined) { at[k] = order.length; order.push([]); }
      order[at[k]].push(b);
    });
    return order.map(function (parts) {
      if (parts.length === 1) return Object.assign({}, parts[0], { parts: parts });
      /* 팀 정의 순서(배양 → 정제 → 분석)로 고정합니다 — 나온 순서를 쓰면
         정렬을 바꿀 때 대표 그릇이 달라집니다 */
      const teams = (window.DATA_TEAMS || []).map(t => t.id);
      const ordered = parts.slice().sort(function (a, b) {
        const ia = teams.indexOf(a.team), ib = teams.indexOf(b.team);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
      return Object.assign({}, ordered[0], {
        parts: ordered,
        teams: ordered.map(p => p.team).filter(Boolean)
      });
    });
  }

  /* 이 항목을 실제로 적은 그릇 — 없으면 대표 그릇 */
  function ownerOf(row, groupId, itemKey) {
    const list = (row && row.parts) || [row];
    for (let i = 0; i < list.length; i++) {
      const v = window.Repo.valueOf(list[i], groupId, itemKey);
      if (v !== null && v !== undefined) return list[i];
    }
    return list[0] || row;
  }
  /* 묶인 줄에서 값 하나 — 팀마다 자기 항목만 적으므로 처음 나오는 값이 그 값입니다 */
  function valueOfRow(row, groupId, itemKey) {
    const list = (row && row.parts) || [row];
    for (let i = 0; i < list.length; i++) {
      const v = window.Repo.valueOf(list[i], groupId, itemKey);
      if (v !== null && v !== undefined) return v;
    }
    return null;
  }

  /* ══════════════════════════════════════════════════════════════════════
     측정 항목
     ══════════════════════════════════════════════════════════════════════ */
  function groupsOf(team) {
    return window.DATA_ANALYTE_GROUPS.filter(g => g.team === team && !g.empty && g.items.length);
  }

  function metricsFor(tab) {
    const out = [];
    const push = (g, it) => out.push({
      key: g.id + "." + it.key, groupId: g.id, itemKey: it.key,
      label: it.label, group: g.label, unit: it.unit, dp: it.dp, team: g.team,
      get: r => (isSampleGrain() && g.team === "analytics")
        ? window.Repo.valueOfSample(r, g.id, it.key)
        : valueOfRow(r, g.id, it.key)
    });
    if (tab === "all") {
      /* ★ 통합 뷰의 항목도 서식에서 읽습니다.

         예전에는 열 개를 손으로 적어 두었는데, 그 중 여섯(Titer 일자축 ·
         Monomer purity · HCP · IE-HPLC · CE-SDS · N-glycan)이 스키마에서
         사라졌습니다. 남은 넷만 표에 서고, 세 팀이 함께 보는 화면인데
         배양 둘 · 정제 하나 · 분석 하나가 되었습니다.

         팀마다 **값이 들어 있는** 항목을 앞에서 둘씩 올립니다 — 한 팀이
         표를 독차지하지 않으면서 세 팀이 모두 보이게 합니다. */
      (window.DATA_TEAMS || []).forEach(function (t) {
        let n = 0;
        groupsOf(t.id).forEach(g => g.items.forEach(function (it) {
          if (n >= 2) return;
          const any = batches.some(b => num(valueOfRow(b, g.id, it.key)));
          if (!any) return;
          push(g, it); n++;
        }));
        /* 그 팀에 값이 하나도 없으면 서식의 첫 항목이라도 세웁니다 —
           열이 아예 없으면 "이 팀은 무엇을 적는 팀인가" 가 안 보입니다 */
        if (!n) {
          const g = groupsOf(t.id)[0];
          if (g && g.items[0]) push(g, g.items[0]);
        }
      });
    } else {
      groupsOf(tab).forEach(g => g.items.forEach(it => push(g, it)));
    }
    const seen = {};
    out.forEach(m => { seen[m.label] = (seen[m.label] || 0) + 1; });
    out.forEach(m => { if (seen[m.label] > 1) m.label = m.group + " " + m.label; });
    return out;
  }

  function metricByKey(key) {
    const parts = String(key || "").split(".");
    const g = window.DATA_ANALYTE_GROUPS.find(x => x.id === parts[0]);
    if (!g) return null;
    const it = g.items.find(x => x.key === parts[1]);
    if (!it) return null;
    return {
      key: key, groupId: g.id, itemKey: it.key, label: it.label, group: g.label,
      unit: it.unit, dp: it.dp, team: g.team,
      get: r => valueOfRow(r.batchId ? batchOf(r) : r, g.id, it.key)
    };
  }
  function batchOf(sampleRow) { return batches.find(b => b.id === sampleRow.batchId) || sampleRow; }

  function defaultMetrics(tab) {
    const all = metricsFor(tab);
    if (tab === "upstream")   return all.filter(m => ["upstream.maxVCD", "upstream.finalVCD", "titer.titerHCCF"].indexOf(m.key) > -1);
    if (tab === "downstream") return all.filter(m => m.key.indexOf("downstream.") === 0 && m.key.indexOf("Yield") > -1);
    if (tab === "analytics")  return all.filter(m => ["seHPLC.main", "ieHPLC.main", "ceSdsNR.monomer"].indexOf(m.key) > -1);
    return all.filter(m => ["titer.titerHCCF", "downstream.totalYield", "ceSdsNR.monomer"].indexOf(m.key) > -1);
  }
  /* 검색·범위 필터를 걷어냈습니다 — 회의 화면은 "요약 → 팀 상세" 두 걸음이고,
     좁히는 일은 데이터 조회 화면이 합니다. 여기서는 그 팀의 항목을 전부 봅니다. */
  function visibleMetrics() { return metricsFor(view.tab); }
  function visibleBatches() { return rows(); }
  function chartBatches() { return visibleBatches(); }
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
     핀 · 이탈
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
  function outlierOf(batchId, groupId, itemKey) {
    return outMap[batchId + "|" + groupId + "." + itemKey] || null;
  }
  function outlierMarkup(o) {
    if (!o) return "";
    return '<span class="mm-out' + (o.dir === "high" ? " is-high" : " is-low") + '" title="' +
      esc(o.studyName + " 안에서 평균 " + o.mean.toFixed(o.dp === undefined ? 1 : o.dp) +
          " · 표준편차 " + o.sd.toFixed(2) + " 대비 " + o.z.toFixed(1) + "SD — 규격 이탈이 아니라 분포상 이탈입니다") +
      '">' + (o.dir === "high" ? "▲" : "▼") + Math.abs(o.z).toFixed(1) + "σ</span>";
  }
  function meetingContext() {
    const sel = window.Scope.get();
    const d = window.Scope.describe();
    const st = view.focus ? (batches.find(b => b.id === view.focus) || {}) : {};
    return {
      projectId: sel.scopeId || null, projectCode: d.scope || null,
      studyId: sel.studyId || st.studyId || null, studyName: d.study || null
    };
  }

  /* ══════════════════════════════════════════════════════════════════════
     동기화 뷰
     ══════════════════════════════════════════════════════════════════════ */
  function focusBatch() {
    if (view.focus) {
      const b = batches.find(x => x.id === view.focus);
      if (b) return b;
    }
    return null;
  }
  /* 일자축이 있는 항목이 실제로 있는가 — 지금 서식에는 없습니다.
     없는데도 "일자별 Titer 추이" 카드를 띄우면 회의 화면 맨 위가 늘
     "일자별 값이 기록된 배치가 없습니다" 가 됩니다. 데이터가 빠진 것처럼
     보이지만, 그 축 자체가 이 서식에 없는 것입니다. 축이 생기면 다시
     나옵니다 — 숨기는 조건을 데이터에 두었기 때문입니다. */
  function hasDayAxis() {
    return (window.DATA_TITER_DAYS || []).some(d =>
      batches.some(b => b.upstream && b.upstream.titer && num(b.upstream.titer[d])));
  }

  /* ── 팀 상세 ───────────────────────────────────────────────────────────
     요약 카드의 [상세 →] 로 들어오는 화면입니다. 그 팀의 시료 표와 그래프를
     보되, 시료 한 줄을 누르면 **세 팀 값이 함께** 열립니다 — 회의에서 묻는
     말은 늘 "이 시료, 다른 팀은 어땠나" 이기 때문입니다. */
  function teamDetail() {
    const t = (window.DATA_TEAMS || []).find(x => x.id === view.tab) || {};
    return '<div class="card-head" style="padding:0 0 var(--s-3)"><div>' +
        '<h2 class="card-title">' + esc(t.ko || view.tab) + ' 상세</h2>' +
        '<p class="card-sub">표에서 시료를 누르면 그 시료의 배양 · 정제 · 분석 값이 ' +
          '한 줄로 함께 열립니다</p></div>' +
        '<button class="btn btn-ghost btn-sm" id="mm-back">← 팀별 요약</button>' +
      '</div>' +
      '<div id="mm-chips" style="margin-bottom:var(--s-4)"></div>' +
      (hasDayAxis()
        ? '<section class="card" style="margin-bottom:var(--s-4)"><div id="mm-day"></div></section>'
        : "") +
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
               points: pts, state: "none" };
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
        focusBatch: view.focus, focusDay: view.focusDay, aria: "배치별 일자별 Titer 추이"
      }) + '</div>';

    $$(".mmc-pt", host).forEach(function (el) {
      const go = function () {
        view.focus = el.dataset.b; view.focusDay = el.dataset.day; syncAll();
      };
      el.addEventListener("click", go);
      el.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
      });
    });
    const un = $("#mm-unfocus");
    if (un) un.addEventListener("click", function () { view.focus = null; view.focusDay = null; syncAll(); });
  }

  /* 3개 팀 동기화 칸에 세울 항목 — **서식 그대로**입니다.

     여기도 손으로 적혀 있었고, 적힌 스무 개 중 아홉이 스키마에 없는
     항목이었습니다 (qP · monomerPurity · HCP · residual DNA · IE-HPLC ·
     CE-SDS · N-glycan). 그 칸들이 영영 "미입력" 으로 서 있었습니다.
     서식에서 읽으면 지표를 바꿔도 이 화면이 따라옵니다. */
  function syncSets() {
    return (window.DATA_TEAMS || []).map(function (t) {
      const items = [];
      groupsOf(t.id).forEach(g => g.items.forEach(it => items.push([g.id, it.key])));
      return { team: t.id, items: items };
    }).filter(s => s.items.length);
  }

  function paintSync() {
    const host = $("#mm-sync");
    if (!host) return;
    const b = focusBatch();
    if (!b) {
      host.innerHTML = '<section class="card"><div class="empty">' +
        '<div class="empty-title">시료를 하나 고르면 3개 팀 데이터가 함께 열립니다</div>' +
        '<div class="empty-body">아래 표에서 시료 행을 누르세요. ' +
        '같은 이름으로 팀마다 적은 값이 한 줄로 모여 나란히 보입니다.</div></div></section>';
      return;
    }
    const study = window.Repo.studyOf(b);
    const teamsIn = (b.teams || [b.team]).filter(Boolean)
      .map(function (id) { const t = (window.DATA_TEAMS || []).find(x => x.id === id); return t ? t.short || t.ko : id; });

    host.innerHTML =
      '<section class="card"><div class="card-head"><div>' +
        '<h2 class="card-title">' + esc(rowLabel(b)) + ' — 3개 팀 동기화</h2>' +
        '<p class="card-sub">' + esc(study ? study.name : "") +
          (b.initialDate ? " · " + esc(b.initialDate) : "") +
          (teamsIn.length ? " · 입력한 팀 " + esc(teamsIn.join(" · ")) : "") +
          (view.focusDay ? " · 선택한 시점 " + esc(view.focusDay) : "") +
          " · 값은 시료 단위로 1건씩 기록됩니다</p></div>" +
      '</div><div class="card-body"><div class="mm-sync-grid">' +
      syncSets().map(function (set) {
        const t = window.DATA_TEAMS.find(x => x.id === set.team) || {};
        return '<div class="mm-sync-col" style="--team:' + (t.color || "var(--c-border)") + '">' +
          '<div class="mm-sync-head">' + esc(t.ko || set.team) + '</div>' +
          set.items.map(function (p) {
            const g = window.DATA_ANALYTE_GROUPS.find(x => x.id === p[0]);
            if (!g) return "";
            const it = g.items.find(x => x.key === p[1]);
            if (!it) return "";
            const v = valueOfRow(b, g.id, it.key);
            /* 핀과 이탈 표시는 **그 값을 실제로 적은 그릇**에 붙입니다.
               묶음의 대표 그릇에 붙이면, 정제 값에 남긴 핀이 배양 그릇에
               달려 다음 회의에서 그 핀을 찾을 수 없습니다. */
            const owner = ownerOf(b, g.id, it.key);
            const oid = owner.id;
            const pins = pinsOfCell(oid, g.id, it.key);
            const o = outlierOf(oid, g.id, it.key);
            return '<div class="mm-sync-row' + (num(v) ? "" : " is-na") + '">' +
              '<span class="mm-sync-k">' + esc(it.label) + '</span>' +
              '<span class="mm-sync-v mono">' + (num(v) ? fmt(v, it.dp) : L.empty) +
                (num(v) && it.unit ? '<span class="mm-sync-u">' + esc(it.unit) + '</span>' : "") + '</span>' +
              outlierMarkup(o) +
              (pins.length ? '<span class="mm-pinmark" title="' + esc(pins.map(x => x.text).join(" / ")) +
                '">◆' + (pins.length > 1 ? pins.length : "") + '</span>' : "") +
              '<button class="mm-pinb" data-pin="' + esc(oid + "|" + g.id + "|" + it.key) +
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

    if (!list.length || !mv.length) {
      host.innerHTML = '<div class="empty"><div class="empty-title">표시할 데이터가 없습니다</div>' +
        '<div class="empty-body">이 팀이 적은 값이 아직 없습니다. 다른 팀을 보시거나 ' +
        'Data 입력에서 값을 적으면 바로 나타납니다.</div></div>';
      return;
    }

    host.innerHTML =
      '<div class="card-head" style="padding-bottom:var(--s-3)"><div>' +
        '<h2 class="card-title">데이터 테이블</h2>' +
        '<p class="card-sub">행을 누르면 위 3개 팀 카드가 그 시료로 연동됩니다 · ' +
          '값 위에 마우스를 올리면 핀을 남길 수 있습니다 · ' +
          list.length + (isSampleGrain() ? "개 시료 · " : "개 배치 · ") + mv.length + "개 항목</p></div>" +
      '</div>' +
      '<div class="tbl-scroll"><table class="tbl mm-tbl"><thead><tr>' +
        '<th scope="col">시료</th>' +
        mv.map(m => '<th scope="col" style="border-top:2px solid ' + teamColor(m.team) + '">' +
          esc(m.label) + '<br><span style="font-weight:400;text-transform:none">' +
          esc(m.unit) + '</span></th>').join("") +
      '</tr></thead><tbody>' +
      list.map(function (r) {
        const bid = batchIdOf(r);
        const focused = view.focus === bid;
        return '<tr class="is-pickable' + (focused ? " is-focus" : "") +
          '" data-pick="' + esc(r.id) + '" data-batch="' + esc(bid) + '" tabindex="0" role="button" ' +
          'aria-pressed="' + focused + '" aria-label="' + esc(rowLabel(r)) + '">' +
          '<td class="mono" style="font-weight:600">' + esc(rowLabel(r)) +
            (isSampleGrain() && r.stage
              ? '<br><span style="font-weight:400;font-size:10px;color:var(--c-text-mute)">' +
                esc(r.stage) + '</span>' : "") + '</td>' +
          mv.map(function (m) {
            const v = m.get(r);
            const pins = pinsOfCell(bid, m.groupId, m.itemKey);
            const o = outlierOf(bid, m.groupId, m.itemKey);
            const cell = num(v) ? Number(v).toFixed(m.dp) : L.empty;
            return '<td class="' + (num(v) ? "mono" : "na") + ' mm-cell' + (o ? " is-out" : "") + '">' +
              '<span>' + cell + '</span>' + outlierMarkup(o) +
              (pins.length ? '<span class="mm-pinmark" title="' +
                esc(pins.map(x => x.text).join(" / ")) + '">◆</span>' : "") +
              '<button class="mm-pinb" data-pin="' + esc(bid + "|" + m.groupId + "|" + m.itemKey) +
                '" tabindex="-1" aria-label="' + esc(rowLabel(r) + " " + m.label) + ' 값에 핀 남기기">＋</button>' +
              '</td>';
          }).join("") + '</tr>';
      }).join("") + '</tbody></table></div>';

    $$("[data-pick]", host).forEach(function (tr) {
      /* 행을 누르면 그 시료가 **3개 팀 카드**로 올라갑니다. 예전에는 팀 탭에서
         누르면 "그래프에 남길 것 고르기" 였는데, 한 번의 누름에 뜻이 둘이라
         무엇이 일어날지 예측되지 않았습니다. 하나로 둡니다. */
      const act = function () {
        view.focus = (view.focus === tr.dataset.batch) ? null : tr.dataset.batch;
        view.focusDay = null;
        syncAll();
      };
      tr.addEventListener("click", function (e) {
        if (e.target.closest(".mm-pinb")) return;
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
      color: PALETTE[i % PALETTE.length], data: bs.map(m.get)
    }));
    const allVals = series.reduce((a, s) => a.concat(s.data), []);
    const min = (ms.length === 1 || sameUnit(ms)) ? axisMin(allVals) : null;
    const focusRow = bs.find(r => batchIdOf(r) === view.focus);

    host.innerHTML =
      '<div class="card-head" style="padding-bottom:var(--s-3)"><div>' +
        '<h2 class="card-title">' + (view.metric ? esc(ms[0].label) : "대표 지표 비교") + '</h2>' +
        '<p class="card-sub">' +
          "전체 " + bs.length + "건 · " +
          (view.metric ? esc(ms[0].label) : "대표 지표 " + ms.length + "개") +
          (sameUnit(ms) ? "" : " · 단위가 서로 달라 같은 축에 겹쳐 보입니다") +
        '</p></div></div>' +
      '<div class="card-body chart-swap">' +
        C.swatches(series) +
        '<div class="chart-wrap" style="margin-top:var(--s-3)">' +
          MC.bars({ cats: cats, series: series, min: min,
                    focus: focusRow ? rowLabel(focusRow) : null,
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

    $$(".mmc-hit", host).forEach(function (el) {
      const go = function () {
        const r = bs[+el.dataset.cat];
        if (!r) return;
        view.focus = batchIdOf(r); view.focusDay = null; syncAll();
      };
      el.addEventListener("click", go);
      el.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
      });
    });
  }

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
        '<button class="mm-chip" data-metric="" aria-pressed="' + (!view.metric) + '"' + '>대표 지표</button>' +
        mv.map(m => '<button class="mm-chip" data-metric="' + esc(m.key) + '" ' +
          'aria-pressed="' + (view.metric === m.key) + '" title="' + esc(m.group + " · " + m.unit) + '"' + '>' +
          esc(m.label) + '<span class="mm-chip-count">' + filled(m) + '</span></button>').join("") +
      '</div>';
    $$("[data-metric]", host).forEach(b => b.addEventListener("click", function () {
      const k = b.dataset.metric || null;
      view.metric = (view.metric === k) ? null : k;
      syncAll();
    }));
  }

  /* ══════════════════════════════════════════════════════════════════════
     팀 요약
     ══════════════════════════════════════════════════════════════════════ */
  function issues() {
    const out = [];
    rawBatches.forEach(b => window.DATA_ANALYTE_GROUPS.forEach(g => {
      if (g.empty) return;
      /* 그 팀이 적는 항목만 봅니다 — 배양 그릇에 정제 항목이 비어 있는 것은
         미입력이 아니라 그 팀 서식에 없는 칸입니다 */
      if (b.team && g.team && g.team !== b.team) return;
      g.items.forEach(function (it) {
        if (window.Repo.cellState(b, g.id, it.key) === "empty")
          out.push({ batch: b.id, group: g.label, item: it.label, team: g.team });
      });
    }));
    return out;
  }
  /* ★ 팀 요약 지표를 **서식에서 읽습니다.**

     예전에는 팀마다 보여 줄 항목을 여기 손으로 적어 두었습니다 (HCP ·
     Monomer purity · CE-SDS · IE-HPLC). 지표를 재설정한 뒤 그 항목들이
     스키마에서 사라졌는데 이 목록만 남아, 회의 화면의 팀 카드가 늘
     "미입력" 이었습니다 — 대시보드 · 조회 · 분류 칩에서 고쳤던 것과 같은
     어긋남입니다. 한 곳만 더 남아 있었습니다.

     값이 실제로 들어 있는 항목을 앞에서부터 셋 고릅니다. 없으면 그 팀
     서식의 앞 항목을 그대로 보여 주고 미입력이라고 적습니다 — 항목 자체를
     감추면 무엇을 적어야 하는지 알 수 없게 됩니다. */
  function headlineMetrics(team) {
    const avg = a => a.length ? fmt(a.reduce((x, y) => x + y, 0) / a.length, 1) : L.empty;
    const list = [];
    groupsOf(team).forEach(g => g.items.forEach(function (it) {
      const vals = batches.map(b => valueOfRow(b, g.id, it.key)).filter(num);
      list.push({ k: it.label, vals: vals, unit: it.unit, dp: it.dp });
    }));
    const filled = list.filter(x => x.vals.length);
    const show = (filled.length ? filled : list).slice(0, 3);
    return show.map(x => ({
      k: "평균 " + x.k,
      v: avg(x.vals),
      u: x.unit || ""
    }));
  }
  /* ── 팀별 요약 — **대시보드와 같은 카드**입니다 ───────────────────────
     회의를 열면 처음 보이는 화면이 평소 보던 대시보드와 달라야 할 이유가
     없습니다. 같은 격자 · 같은 머리 · 같은 상태 칩 · 같은 지표 줄을 씁니다
     (dash-page.js teamCards 와 같은 모양). 다른 것은 버튼 하나뿐입니다 —
     대시보드는 [그래프 보기] · [Data 입력 →], 회의 모드는 그 자리에서
     바로 들여다보는 [상세 →]. */
  function teamSummary(teamSets) {
    return '<div class="team-grid">' +
      teamSets.map(function (t) {
        const state = !t.defined ? "none" : t.hasData ? (t.filled >= t.total ? "full" : "part") : "none";
        return '<section class="card team-card" style="--team:' + t.color + '">' +
          '<div class="team-head">' +
            '<div><div class="team-name">' + esc(t.ko) + '</div>' +
            '<div style="font-size:11px;color:var(--c-text-mute)">' +
              (!t.defined ? "원본 데이터 없음" : t.filled + "/" + t.total + " 입력") + '</div></div>' +
            '<span class="team-chip" data-state="' + state + '"><span class="team-chip-dot"></span>' +
              (!t.defined ? "없음" : t.hasData ? Math.round(t.filled / t.total * 100) + "%" : "미입력") +
            '</span>' +
          '</div>' +
          '<div class="team-metrics">' + headlineMetrics(t.team).map(x =>
            '<div class="team-metric"><span class="team-metric-k">' + esc(x.k) + '</span>' +
            '<span class="team-metric-v"' + (x.v === L.empty ? ' style="color:var(--c-text-soft)"' : "") + '>' +
              esc(x.v) + (x.u ? '<span class="team-metric-u">' + esc(x.u) + '</span>' : "") +
            '</span></div>').join("") + '</div>' +
          '<div class="card-body" style="padding-top:0">' +
            '<button class="btn btn-ghost btn-sm" data-goto="' + t.team + '" style="width:100%">' +
              esc(t.ko) + ' 상세 →</button></div></section>';
      }).join("") + '</div>';
  }

  /* ══════════════════════════════════════════════════════════════════════
     우측 패널
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
      value: valueOfRow(b, g.id, it.key),
      day: (g.id === "titer" || g.id === "upstream") ? view.focusDay : null
    };
    view.panel = true;
    paintPanel();
    setTimeout(() => { const t = $("#mm-pin-text"); if (t) t.focus(); }, 30);
  }

  function defaultDue() {
    const t = window.HubCalendar ? window.HubCalendar.today() : new Date().toISOString().slice(0, 10);
    const d = new Date(t + "T00:00:00");
    d.setDate(d.getDate() + 7);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  let pinKind = "decision";

  function agendaSection() {
    const P = window.Pins;
    if (!P) return "";
    const list = P.agenda();
    const cur = P.currentAgenda();
    return '<section class="mm-sec"><div class="mm-sec-h">안건 ' +
      '<span class="mm-sec-n">' + list.filter(a => a.done).length + " / " + list.length + ' 완료</span></div>' +
      (list.length
        ? '<ol class="mm-ag">' + list.map(function (a, i) {
            return '<li class="mm-ag-i' + (a.done ? " is-done" : "") +
              (cur && cur.id === a.id ? " is-cur" : "") + '">' +
              '<input type="checkbox" data-agt="' + esc(a.id) + '"' + (a.done ? " checked" : "") +
                ' aria-label="' + esc(a.title) + ' 완료">' +
              '<button class="mm-ag-t" data-agc="' + esc(a.id) + '" title="이 안건을 진행 중으로">' +
                esc(a.title) + (a.carriedFrom ? ' <span class="mm-ag-c">이월</span>' : "") + '</button>' +
              '<span class="mm-ag-x">' +
                '<button data-agu="' + esc(a.id) + '" aria-label="위로" title="위로">↑</button>' +
                '<button data-agd="' + esc(a.id) + '" aria-label="아래로" title="아래로">↓</button>' +
                '<button data-agr="' + esc(a.id) + '" aria-label="삭제" title="삭제">×</button>' +
              '</span></li>';
          }).join("") + '</ol>'
        : '<p class="mm-empty">안건을 적어 두면 핀 · 결정이 안건별로 묶이고 회의록도 그 순서로 정리됩니다.</p>') +
      '<div class="mm-note-row">' +
        '<input class="ebr-input" id="mm-ag-new" placeholder="새 안건" value="' + esc(view.agendaDraft) + '">' +
        '<button class="btn btn-ghost btn-sm" id="mm-ag-add">추가</button>' +
      '</div>' +
      '<button class="btn btn-ghost btn-sm" id="mm-ag-carry" style="width:100%;margin-top:6px">' +
        '지난 회의 미완료 안건 가져오기</button>' +
      '<p class="mm-msg" id="mm-ag-msg"></p></section>';
  }

  function pinComposer() {
    const t = view.pinTarget;
    return '<section class="mm-sec is-compose"><div class="mm-sec-h">이 값에 핀 남기기</div>' +
      '<div class="mm-pin-target">' +
        '<span class="mono">' + esc(t.batchLabel) + '</span> · ' + esc(t.metricLabel) +
        (t.day ? " · " + esc(t.day) : "") + ' — <b class="mono">' +
        (num(t.value) ? fmt(t.value, t.dp) + (t.unit ? " " + esc(t.unit) : "") : L.empty) + '</b>' +
        outlierMarkup(outlierOf(t.batchId, t.groupId, t.itemKey)) + '</div>' +
      '<div class="mm-note-kinds">' +
        Object.keys(window.Pins.KIND).map(k =>
          '<button class="mm-kind" data-pk="' + k + '" aria-pressed="' + (pinKind === k) + '">' +
          window.Pins.KIND[k].mark + " " + esc(window.Pins.KIND[k].ko) + '</button>').join("") + '</div>' +
      '<textarea class="ebr-input mm-ta" id="mm-pin-text" rows="2" ' +
        'placeholder="예: 동일 조건 재현 필요 · 원인 확인 후 재논의"></textarea>' +
      '<div class="mm-note-row">' +
        '<button class="btn btn-accent btn-sm" id="mm-pin-go" style="flex:1">핀 남기기</button>' +
        '<button class="btn btn-ghost btn-sm" id="mm-pin-cancel">취소</button></div>' +
      '<p class="mm-msg" id="mm-pin-msg"></p></section>';
  }

  function pinRow(p) {
    const K = window.Pins.KIND[p.kind] || window.Pins.KIND.decision;
    return '<div class="mm-item is-pin" data-jump="' + esc(p.batchId) + '">' +
      '<div class="mm-item-t"><span class="mm-item-mark">' + K.mark + '</span>' + esc(p.text) + '</div>' +
      '<div class="mm-item-m"><span class="mono">' + esc(p.batchLabel) + '</span> · ' +
        esc(p.metricLabel) + (p.value !== null ? " " + p.value + (p.unit ? " " + esc(p.unit) : "") : " (미입력)") +
        (p.day ? " · " + esc(p.day) : "") + ' · ' + esc(p.createdBy) + '</div>' +
      (p.issueId
        ? '<div class="mm-item-m is-ok">트러블슈팅 사례로 등록됨</div>'
        : '<button class="mm-item-btn" data-promote="' + esc(p.id) + '">사례집에 등록</button>') +
      '<button class="mm-item-x" data-delpin="' + esc(p.id) + '" aria-label="핀 삭제">×</button></div>';
  }
  function noteRow(n, ko) {
    return '<div class="mm-item">' +
      '<div class="mm-item-t"><span class="mm-item-mark">' + (n.kind === "action" ? "▶" : "◆") + '</span>' +
        esc(n.text) + '</div>' +
      '<div class="mm-item-m">' + ko + (n.assignee ? " · @" + esc(n.assignee) : "") +
        (n.due ? " · " + esc(n.due) : "") + (n.todoId ? " · To-Do 등록됨" : "") + '</div>' +
      '<button class="mm-item-x" data-delnote="' + esc(n.id) + '" aria-label="기록 삭제">×</button></div>';
  }

  /* 만든 회의록 — 패널을 다시 그려도 **남아 있어야** 합니다.
     핀 하나만 더 찍어도 패널이 다시 그려지는데, 그때 회의록이 사라지면
     저장 버튼을 누르러 가는 길에 글자가 없어집니다. */
  function minutesBlock() {
    if (!view.minutesOpen) return "";
    const P = window.Pins;
    const cur = P ? P.currentMeeting() : null;
    if (!cur) return '<p class="mm-empty">아직 기록이 없어 회의록을 만들 수 없습니다.</p>';
    const text = P.minutesText(cur.id);
    const saved = !!cur.minutes;
    return '<textarea class="ebr-input mm-ta" id="mm-min-text" rows="10" readonly>' +
      esc(text) + '</textarea>' +
      '<div class="mm-note-row" style="margin-top:6px">' +
        '<button class="btn btn-accent btn-sm" id="mm-min-save" style="flex:1">' +
          (saved ? "다시 저장" : "저장") + '</button>' +
        '<button class="btn btn-ghost btn-sm" id="mm-min-copy" style="flex:1">복사</button>' +
      '</div>' +
      '<p class="mm-msg" id="mm-min-msg">' + esc(view.minutesMsg || "") + '</p>';
  }

  /* ── 지난 회의록 ───────────────────────────────────────────────────────
     저장해 둔 회의록을 그 자리에서 펼쳐 봅니다. 회의 중에 "지난번에 뭐라고
     정했더라" 는 말이 나오면, 그것을 찾으러 다른 화면으로 나가야 할 이유가
     없습니다. */
  function pastMinutesSection() {
    const P = window.Pins;
    if (!P || !P.savedMinutes) return "";
    const cur = P.currentMeeting();
    /* 이번 회의 것도 숨기지 않습니다 — 저장했는데 목록이 "없음" 이면
       저장이 안 된 줄 압니다. 대신 이번 회의라고 적어 둡니다. */
    const list = P.savedMinutes(8);
    return '<section class="mm-sec"><div class="mm-sec-h">지난 회의록 ' +
      '<span class="mm-sec-n">' + list.length + '건</span></div>' +
      (list.length
        ? list.map(function (m) {
            const c = m.counts || {};
            return '<details class="mm-item">' +
              '<summary style="cursor:pointer;font-size:12.5px;font-weight:500">' +
                esc(m.title || "회의") +
                (cur && m.id === cur.id ? ' <span class="badge badge-accent" ' +
                  'style="font-size:10px">이번 회의</span>' : "") +
                '<span class="mm-item-m" style="display:block;font-weight:400">' +
                  esc(String(m.minutesAt || m.startedAt).replace("T", " ").slice(0, 16)) +
                  ' · 결정 ' + (c.decisions || 0) + ' · 조치 ' + (c.actions || 0) +
                  ' · 핀 ' + (c.pins || 0) + '</span>' +
              '</summary>' +
              '<textarea class="ebr-input mm-ta" rows="8" readonly data-past="' + esc(m.id) + '">' +
                esc(m.minutes) + '</textarea>' +
              '<button class="btn btn-ghost btn-sm" data-pastcopy="' + esc(m.id) +
                '" style="width:100%;margin-top:4px">이 회의록 복사</button>' +
            '</details>';
          }).join("")
        : '<p class="mm-empty">저장된 회의록이 없습니다. 아래 [회의록 만들기] → [저장] 을 누르면 ' +
          '다음 회의와 대시보드에서 다시 열어 볼 수 있습니다.</p>') +
      '</section>';
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
    const curAg = P ? P.currentAgenda() : null;

    host.innerHTML =
      '<div class="mm-side-head"><span>회의 기록</span>' +
        '<button class="btn-icon" id="mm-panel-hide" aria-label="패널 닫기" title="패널 닫기">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round"><path d="m9 18 6-6-6-6"/></svg></button></div>' +
      '<div class="mm-side-body">' +
      (view.pinTarget ? pinComposer() : "") +
      agendaSection() +

      '<section class="mm-sec"><div class="mm-sec-h">결정 · 조치 기록' +
        (curAg ? '<span class="mm-sec-n">안건: ' + esc(curAg.title) + '</span>' : "") + '</div>' +
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
                '<select class="ebr-input" id="mm-note-who"><option value="">— 선택 —</option>' +
                  (window.People ? window.People.grouped().map(gr =>
                    '<optgroup label="' + esc(gr.ko) + '">' + gr.people.map(p =>
                      '<option value="' + esc(p.name) + '" data-team="' + esc(p.team) + '">' +
                      esc(p.name) + " · " + esc(p.role) + '</option>').join("") + '</optgroup>').join("") : "") +
                '</select></label>' +
              '<label class="ebr-cell" style="width:132px"><span>기한</span>' +
                '<input class="ebr-input" id="mm-note-due" type="date" value="' + esc(defaultDue()) + '"></label>' +
            '</div>' : "") +
        '<div class="mm-note-row">' +
          '<button class="btn btn-accent btn-sm" id="mm-note-go" style="flex:1">' +
            (view.noteKind === "action" ? "기록하고 To-Do 등록" : "결정 기록") + '</button></div>' +
        '<p class="mm-msg" id="mm-note-msg"></p></section>' +

      '<section class="mm-sec"><div class="mm-sec-h">이번 회의 ' +
        '<span class="mm-sec-n">핀 ' + mine.pins.length + ' · 결정 ' + decisions.length +
        ' · 조치 ' + actions.length + '</span></div>' +
        (mine.pins.length || mine.notes.length ? "" :
          '<p class="mm-empty">아직 기록이 없습니다. 값 옆의 ＋핀 을 눌러 지적하거나 위에 결정을 적으세요.</p>') +
        mine.pins.map(pinRow).join("") +
        decisions.map(n => noteRow(n, "결정")).join("") +
        actions.map(n => noteRow(n, "조치")).join("") + '</section>' +

      '<section class="mm-sec"><div class="mm-sec-h">지난 회의 미완료 조치 ' +
        '<span class="mm-sec-n">' + past.length + '건</span></div>' +
        (past.length
          ? past.map(n => '<div class="mm-item is-past">' +
              '<div class="mm-item-t">' + esc(n.text) + '</div>' +
              '<div class="mm-item-m">@' + esc(n.assignee || "미지정") +
                (n.due ? " · 기한 " + esc(n.due) : "") + '</div></div>').join("")
          : '<p class="mm-empty">미완료 조치가 없습니다.</p>') + '</section>' +

      '<section class="mm-sec">' +
        '<button class="btn btn-ghost btn-sm" id="mm-minutes" style="width:100%">' +
          (view.minutesOpen ? "회의록 다시 만들기" : "회의록 만들기") + '</button>' +
        '<div id="mm-minutes-out">' + minutesBlock() + '</div></section>' +

      pastMinutesSection() +
      '</div>';

    wirePanel();
  }

  function wirePanel() {
    const host = $("#mv-side");
    if (!host) return;
    const P = window.Pins;

    const hide = $("#mm-panel-hide", host);
    if (hide) hide.addEventListener("click", function () { view.panel = false; paintPanel(); paintPanelToggle(); });

    /* ── 안건 ── */
    const agNew = $("#mm-ag-new", host);
    if (agNew) agNew.addEventListener("input", function () { view.agendaDraft = this.value; });
    const agAdd = $("#mm-ag-add", host);
    const addAg = function () {
      const r = P.addAgenda({ title: view.agendaDraft, context: meetingContext() });
      const msg = $("#mm-ag-msg");
      if (!r.ok) { if (msg) msg.textContent = r.reason; return; }
      view.agendaDraft = "";
      paintPanel();
      setTimeout(() => { const i = $("#mm-ag-new"); if (i) i.focus(); }, 20);
    };
    if (agAdd) agAdd.addEventListener("click", addAg);
    if (agNew) agNew.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); addAg(); }
    });
    $$("[data-agt]", host).forEach(el => el.addEventListener("change", function () {
      P.toggleAgenda(el.dataset.agt); paintPanel();
    }));
    $$("[data-agc]", host).forEach(el => el.addEventListener("click", function () {
      P.setCurrentAgenda(el.dataset.agc); paintPanel();
    }));
    $$("[data-agu]", host).forEach(el => el.addEventListener("click", function () {
      P.moveAgenda(el.dataset.agu, -1); paintPanel();
    }));
    $$("[data-agd]", host).forEach(el => el.addEventListener("click", function () {
      P.moveAgenda(el.dataset.agd, 1); paintPanel();
    }));
    $$("[data-agr]", host).forEach(el => el.addEventListener("click", function () {
      P.removeAgenda(el.dataset.agr); paintPanel();
    }));
    const carry = $("#mm-ag-carry", host);
    if (carry) carry.addEventListener("click", function () {
      const r = P.carryOverAgenda(meetingContext());
      const msg = $("#mm-ag-msg");
      if (!r.ok) { if (msg) msg.textContent = r.reason; return; }
      paintPanel();
    });

    /* ── 핀 · 노트 ── */
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
      const r = P.add({
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
      const r = P.addNote({
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

    $$("[data-promote]", host).forEach(b => b.addEventListener("click", function (e) {
      e.stopPropagation(); promotePin(b.dataset.promote);
    }));
    $$("[data-delpin]", host).forEach(b => b.addEventListener("click", function (e) {
      e.stopPropagation(); P.remove(b.dataset.delpin); syncAll();
    }));
    $$("[data-delnote]", host).forEach(b => b.addEventListener("click", function (e) {
      e.stopPropagation(); P.removeNote(b.dataset.delnote); paintPanel();
    }));
    $$("[data-jump]", host).forEach(el => el.addEventListener("click", function (e) {
      if (e.target.closest(".mm-item-x") || e.target.closest(".mm-item-btn")) return;
      view.tab = "all"; view.focus = el.dataset.jump; render();
    }));

    const mn = $("#mm-minutes", host);
    if (mn) mn.addEventListener("click", function () {
      view.minutesOpen = true;
      view.minutesMsg = "";
      paintPanel();
    });

    /* 저장해야 다음 회의 · 대시보드에서 다시 열립니다. 만들기만 하고 닫으면
       글자는 사라집니다 — 그래서 저장을 **앞 버튼**으로 둡니다. */
    const ms = $("#mm-min-save", host);
    if (ms) ms.addEventListener("click", function () {
      const cur = P.currentMeeting();
      const r = cur ? P.saveMinutes(cur.id) : { ok: false, reason: "저장할 회의가 없습니다" };
      view.minutesMsg = r.ok
        ? "저장했습니다 — 다음 회의의 [지난 회의록] 과 대시보드에서 다시 열 수 있습니다."
        : r.reason;
      paintPanel();
    });
    const mc = $("#mm-min-copy", host);
    if (mc) mc.addEventListener("click", function () {
      const ta = $("#mm-min-text", host);
      if (!ta) return;
      const done = function (m) { view.minutesMsg = m; paintPanel(); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ta.value).then(() => done("복사했습니다."),
          () => { ta.select(); done("직접 복사해 주세요 (Ctrl+C)."); });
      } else { ta.select(); done("직접 복사해 주세요 (Ctrl+C)."); }
    });

    /* 지난 회의록 복사 */
    $$("[data-pastcopy]", host).forEach(b => b.addEventListener("click", function () {
      const ta = $('[data-past="' + b.dataset.pastcopy + '"]', host);
      if (!ta) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ta.value).then(
          () => { b.textContent = "복사했습니다"; },
          () => { ta.select(); b.textContent = "직접 복사해 주세요 (Ctrl+C)"; });
      } else { ta.select(); b.textContent = "직접 복사해 주세요 (Ctrl+C)"; }
    }));
  }

  /* 핀 → 트러블슈팅 사례.
     증상만 채우고 원인 · 조치는 비워 둡니다 — 회의 시점에 아직 모르는 것을
     지어내 채우면 사례집이 오염됩니다. 공개도 하지 않습니다(팀 내부 초안). */
  function promotePin(pinId) {
    const P = window.Pins;
    const p = P.get(pinId);
    if (!p || !window.Issues) return;
    const b = batches.find(x => x.id === p.batchId);
    const r = window.Issues.create({
      title: p.batchLabel + " " + p.metricLabel + " " + (P.KIND[p.kind] || {}).ko,
      symptom: p.text + " (회의에서 지적 · " + p.metricLabel +
        (p.value !== null ? " " + p.value + (p.unit ? " " + p.unit : "") : " 미입력") + ")",
      batchId: p.batchId,
      studyId: p.studyId || (b ? b.studyId : null),
      team: p.team,
      severity: p.kind === "issue" ? "high" : "mid",
      tags: [p.metricLabel, "회의"]
    });
    if (r.ok) { P.linkIssue(p.id, r.issue.id); paintPanel(); }
  }

  function paintPanelToggle() {
    const b = $("#mv-panel-show");
    if (b) b.style.display = view.panel ? "none" : "";
  }

  /* ══════════════════════════════════════════════════════════════════════
     화면 공유 코드 — 지금 보는 화면을 그대로 재현합니다
     ══════════════════════════════════════════════════════════════════════ */
  /* ── 같은 화면으로 부르기 ──────────────────────────────────────────────
     붙여넣을 코드 대신 **주소(링크)** 를 건넵니다. 받는 사람은 누르기만
     하면 회의 모드가 열리고 같은 자리에 섭니다.

     ★ 화소를 보내는 것이 아닙니다. 담기는 것은 "무엇을 보고 있는가"
       — 과제 · Study · 팀 · 펼친 시료 · 고른 지표 — 뿐이고, 숫자는 받는
       사람의 브라우저가 자기 데이터로 다시 계산합니다. 그래서 상대가 그
       과제를 볼 수 없으면 같은 화면이 되지 않습니다.
     ★ 과제 · Study 를 함께 담는 이유: 이것이 빠지면 상대 화면에 걸려 있던
       다른 과제 위에 조건만 얹혀, 같은 글자가 다른 데이터를 가리킵니다. */
  function shareState() {
    const sel = window.Scope.get();
    return { t: view.tab, m: view.metric, sk: view.sortKey, sd: view.sortDir,
             f: view.focus, fd: view.focusDay,
             pj: sel.scopeId || null, st: sel.studyId || null };
  }
  function shareLink() {
    try {
      const code = btoa(unescape(encodeURIComponent(JSON.stringify(shareState()))));
      const base = location.origin + location.pathname;
      return base + "#mv=" + encodeURIComponent(code);
    } catch (e) { return location.href; }
  }
  /* 링크(또는 예전 MV1: 코드)를 받아 화면을 맞춥니다 */
  function applyShare(raw) {
    let s = String(raw || "").trim();
    const at = s.indexOf("#mv=");
    if (at > -1) s = decodeURIComponent(s.slice(at + 4));
    else if (s.indexOf("MV1:") === 0) s = s.slice(4);
    if (!s) return { ok: false, reason: "링크에서 화면 정보를 찾지 못했습니다" };
    let o;
    try { o = JSON.parse(decodeURIComponent(escape(atob(s)))); }
    catch (e) { return { ok: false, reason: "링크를 읽지 못했습니다" }; }
    view.tab = o.t || "all";
    view.metric = o.m || null;
    view.sortKey = o.sk || "id";
    view.sortDir = o.sd === -1 ? -1 : 1;
    view.focus = o.f || null;
    view.focusDay = o.fd || null;
    /* 과제 · Study 는 전역 선택이라 Scope 로 넘깁니다 — 화면 전체가 따라옵니다 */
    if (o.pj && window.Scope.setScope) window.Scope.setScope("project", o.pj);
    if (o.st && window.Scope.setStudy) window.Scope.setStudy(o.st);
    return { ok: true };
  }

  function sharePanel() {
    if (!view.shareOpen) return "";
    return '<div class="card mm-share"><div class="card-body">' +
      '<div class="mm-brief-h">같은 화면으로 부르기' +
        '<button class="btn btn-ghost btn-sm" id="mm-share-x">닫기</button></div>' +
      '<p class="mm-brief-sub">이 링크를 받은 사람이 누르면 회의 모드가 열리고 ' +
        '<b>지금 보고 계신 자리</b>(과제 · Study · 팀 · 펼친 시료)에 그대로 섭니다. ' +
        '화면 영상이 아니라 "어디를 보는지"만 건네므로, 숫자는 각자 브라우저가 ' +
        '자기 데이터로 계산합니다 — 그 과제를 볼 수 없는 사람에게는 열리지 않습니다.</p>' +
      '<input class="ebr-input mono" id="mm-share-url" readonly value="' + esc(shareLink()) + '">' +
      '<div class="mm-note-row">' +
        '<button class="btn btn-accent btn-sm" id="mm-share-copy" style="flex:1">링크 복사</button>' +
      '</div>' +
      (view.shareMsg ? '<p class="mm-msg">' + esc(view.shareMsg) + '</p>' : "") +
      '</div></div>';
  }

  /* ══════════════════════════════════════════════════════════════════════
     그리기
     ══════════════════════════════════════════════════════════════════════ */
  function syncAll() {
    /* 공유 링크는 화면 상태를 담습니다 — 화면이 바뀔 때마다 다시 만듭니다.
       그러지 않으면 "지금 보는 화면" 이라고 적힌 옛 링크를 건네게 됩니다. */
    const sl = $("#mm-share-url");
    if (sl) sl.value = shareLink();
    if (view.tab !== "all") {
      paintChips();
      paintDay();
      paintSync();
      paintTable();
      paintChart();
    }
    paintPanel();
    paintPanelToggle();
  }

  function render() {
    if (!on) return;
    const sel = window.Scope.get();
    const desc = window.Scope.describe();

    $("#mv-sub").textContent = desc.scope
      ? desc.scope + (desc.study ? " · " + desc.study : "") : "과제 미선택";
    const bigBtn = $("#mv-big");
    if (bigBtn) bigBtn.setAttribute("aria-pressed", String(view.big));
    const mv = document.getElementById("mv");
    if (mv) mv.classList.toggle("is-big", view.big);

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
      /* 팀마다 따로 적은 같은 이름의 시료를 한 줄로 모읍니다 — 회의 화면은
         세 팀이 함께 보는 자리라, 셋이 나란히 있지 않으면 쓸 수 없습니다 */
      rawBatches = r[0];
      batches = mergeBySample(rawBatches);
      const teamSets = r[1];
      samples = r[2];

      if (!batches.length) {
        $("#mv-body").innerHTML = '<div class="empty"><div class="empty-title">' + esc(L.noResult) +
          '</div><div class="empty-body">' + esc(L.noResultHint) + '</div></div>';
        paintPanel();
        return;
      }

      outMap = window.MeetingStats ? window.MeetingStats.outlierMap(rawBatches) : {};

      if (view.focus && !batches.some(b => b.id === view.focus)) { view.focus = null; view.focusDay = null; }
      /* ★ 상세로 들어갔을 때 한 건을 바로 펼쳐 둡니다 — 값이 하나라도 있는
         시료로. 아무것도 펼쳐 있지 않으면 "시료를 고르세요" 만 보입니다. */
      if (!view.focus && view.tab !== "all") {
        const first = batches.find(function (b) {
          return (window.DATA_ANALYTE_GROUPS || []).some(g => !g.empty &&
            g.items.some(it => num(valueOfRow(b, g.id, it.key))));
        }) || batches[0];
        if (first) view.focus = first.id;
      }

      /* ── 첫 화면은 **요약만** ─────────────────────────────────────────
         회의를 여는 순간 보이는 것은 대시보드와 같은 팀별 요약 카드뿐입니다.
         필터 · 브리핑 · 이탈 목록 · 봇은 내렸습니다 — 회의를 시작하는 자리에
         조작할 것이 열 개 있으면, 첫 1분이 화면 맞추기로 갑니다.
         들여다보는 일은 카드의 [상세 →] 에서 합니다. */
      $("#mv-body").innerHTML =
        sharePanel() +
        (view.tab === "all"
          ? '<section><div class="card-head" style="padding:0 0 var(--s-3)"><div>' +
              '<h2 class="card-title">팀별 요약</h2>' +
              '<p class="card-sub">' + esc(window.Scope.describe().scope || "") +
                (window.Scope.describe().study ? " · " + esc(window.Scope.describe().study) : "") +
                ' 기준 · 카드의 [상세 →] 를 누르면 그 팀의 시료 표 · 3개 팀 동기화 · 그래프가 열립니다' +
              '</p></div></div>' + teamSummary(teamSets) + '</section>'
          : teamDetail());

      wireBody();
      syncAll();
    });
  }

  /* 화면에 남은 조작은 셋뿐입니다 — 팀 상세로 들어가기 · 요약으로 돌아오기 ·
     공유 링크. 조건을 만지는 손잡이는 이 화면에 없습니다. */
  function wireBody() {
    $$("[data-goto]").forEach(b => b.addEventListener("click", function () {
      view.tab = b.dataset.goto;
      view.metric = null;
      view.sortKey = "id";
      render();
    }));
    const back = $("#mm-back");
    if (back) back.addEventListener("click", function () {
      view.tab = "all"; view.metric = null; render();
    });

    const sx = $("#mm-share-x");
    if (sx) sx.addEventListener("click", function () {
      view.shareOpen = false; view.shareMsg = null; render();
    });
    const scp = $("#mm-share-copy");
    if (scp) scp.addEventListener("click", function () {
      const el = $("#mm-share-url");
      if (!el) return;
      const done = function (msg) { view.shareMsg = msg; render(); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(el.value).then(
          () => done("링크를 복사했습니다. 메신저에 붙여넣어 보내세요."),
          () => { el.select(); done("직접 복사해 주세요 (Ctrl+C)."); });
      } else { el.select(); done("직접 복사해 주세요 (Ctrl+C)."); }
    });
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
        '<button class="btn btn-ghost btn-sm" id="mv-big" style="margin-left:auto" ' +
          'aria-pressed="false" title="빔프로젝터로 볼 때 — 글자와 표를 키웁니다">글자 크게</button>' +
        '<button class="btn btn-ghost btn-sm" id="mv-share" ' +
          'title="지금 보는 자리로 바로 열리는 링크를 만듭니다">같은 화면으로 부르기</button>' +
        '<button class="btn btn-ghost btn-sm" id="mv-panel-show" style="display:none">회의 기록 열기</button>' +
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
    d.querySelector("#mv-big").addEventListener("click", function () {
      view.big = !view.big; render();
    });
    d.querySelector("#mv-share").addEventListener("click", function () {
      view.shareOpen = !view.shareOpen; view.shareMsg = null; render();
    });
  }

  function onKey(e) {
    if (!on) return;
    if (e.key === "Escape") {
      const t = (e.target.tagName || "");
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(t)) { e.target.blur(); e.preventDefault(); return; }
      if (view.pinTarget) { view.pinTarget = null; paintPanel(); e.preventDefault(); return; }
      if (view.shareOpen) { view.shareOpen = false; render(); e.preventDefault(); return; }
      close(); e.preventDefault();
    }
  }

  function open() {
    install();
    on = true;
    lastFocus = document.activeElement;
    document.body.classList.add("mm-open");
    document.getElementById("mv").classList.add("is-on");

    /* 회의는 **팀별 요약**에서 시작합니다. 위쪽에서 팀을 고른 채로 들어와도
       첫 화면은 셋이 함께 보이는 요약입니다 — 회의를 여는 자리에서 한 팀만
       펼쳐져 있으면 나머지 두 팀은 자기 차례를 기다려야 합니다. */
    view.tab = "all";
    view.focus = null;
    view.focusDay = null;
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

  /* 링크(#mv=…)로 들어온 사람을 같은 자리에 세웁니다 — 대시보드가 부릅니다 */
  function openFromLink(hash) {
    /* ★ 순서가 중요합니다. open() 은 "회의는 요약에서 시작한다" 는 규칙에
       따라 탭을 요약으로 되돌립니다. 그래서 **열고 난 뒤에** 링크의 자리를
       입힙니다 — 반대로 하면 링크를 눌러 들어온 사람이 늘 요약만 봅니다. */
    open();
    const r = applyShare(hash || location.hash || "");
    if (!r.ok) view.shareMsg = r.reason;
    render();
    return r;
  }

  return { install, open, close, openFromLink };
})();
