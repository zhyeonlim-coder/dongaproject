/* ==========================================================================
   대시보드

   · 선택한 과제의 데이터만 집계
   · 과제만 선택 → 소속 Study별 요약 카드
   · Study까지 선택 → 배양 / 정제 / 분석 팀별 요약 카드
   · 팀 카드 클릭 → 선택 상태를 그대로 들고 Data 입력으로 이동

   ── 그래프는 팀마다 다릅니다 ────────────────────────────────────────────
   세 팀이 보는 지표(CQA/CPP)가 서로 달라서, 같은 그래프를 나란히 놓으면
   어느 팀에게도 맞지 않는 화면이 됩니다. 좌측 "팀별 보기" 로 팀을 고르면
   그 팀 지표만, 고르지 않으면 세 팀 구획을 차례로 보여줍니다.

     배양공정팀  Titer 일자별 추이 · 배치별 Titer HCCF · VCD / Viability
     정제공정팀  단계별 수율 · 순도 · 불순물 · 정제 데이터 테이블
     바이오분석팀 N-glycan 프로파일 · Main peak 순도 · IE-HPLC 전하 변이
   ========================================================================== */

(function () {
  "use strict";

  const user = window.Shell.mount({ page: "dashboard" });
  if (!user) return;

  const L = window.LABELS, E = window.Entries, C = window.Charts;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const fmt = (v, dp) => (v === null || v === undefined || !isFinite(v)) ? L.empty : Number(v).toFixed(dp);
  const nums = (batches, f) => batches.map(f).filter(v => v !== null && v !== undefined && isFinite(v));
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const teamColor = id => (window.DATA_TEAMS.find(t => t.id === id) || {}).color || "var(--c-accent)";

  /* 2단에 맞춘 그래프 높이. 예전 260/300 은 한 줄에 하나일 때의 값이라,
     나란히 놓으면 두 번째 카드가 화면 아래로 밀립니다. 비교가 목적이므로
     한 화면에 들어오는 높이를 먼저 정하고 그 안에서 그립니다. */
  const CH_H = 190;

  const PALETTE = ["#0369A1","#6D28D9","#0F766E","#B45309","#B91C1C","#1D4ED8",
                   "#0284C7","#7C3AED","#15803D","#C2410C","#9333EA","#0891B2"];

  /* ══════════════════════════════════════════════════════════════════════
     화면 상태 — 전체 요약 ↔ 팀 상세

     이 화면에는 두 가지 보기가 있습니다.

       view = null      전체 요약. 세 팀 현황 카드만. 그래프는 펼치지 않습니다.
       view = "팀id"    그 팀 상세. 그 팀 그래프만. 카드는 감춥니다.

     ★ 전역 Scope.team 과는 별개입니다.

       예전에는 이 둘이 같은 값이었습니다. 그래서 대시보드에서 전체로
       되돌리면 Scope.team 이 풀리고, 그 상태로 Data 입력에 가면 "팀을
       선택하세요" 게이트가 다시 닫혔습니다. 대시보드를 잠깐 둘러본 것이
       다른 화면의 작업 상태를 건드리는 셈입니다.

       대시보드에서 무엇을 보고 있는가는 대시보드의 일입니다. 팀 카드의
       [Data 입력 →] 만 전역 팀을 바꿉니다 — 그 버튼은 "이 팀으로 작업하러
       간다" 는 뜻이라 바꾸는 것이 맞습니다.

     ★ 들어올 때마다 전체 요약에서 시작합니다. 기억해 두면 어제 보던 팀이
       먼저 떠서, 대시보드를 열 때마다 화면이 달라집니다.
     ══════════════════════════════════════════════════════════════════════ */
  let view = null;

  const ALL_KEY = "__all";

  function paintSubnav() {
    window.Shell.subnav([
      { label: "보기", items: [
        /* 되돌아갈 길을 메뉴에도 둡니다 — 상세 화면의 뒤로 가기 버튼
           하나뿐이면, 스크롤을 내린 상태에서는 그 버튼이 화면 밖입니다. */
        { key: ALL_KEY, ko: "전체 요약", active: !view }
      ]},
      { label: "팀별 보기", items: window.DATA_TEAMS.map(t => ({
        key: t.id, ko: t.ko, active: view === t.id, color: t.color })) },
      { label: "바로가기", items: [
        { ko: "Data 입력", href: "ebr.html" },
        { ko: "데이터 조회", href: "data.html" },
        { ko: "일정 관리", href: "schedule.html" }
      ]}
    ], function (k) {
      view = (k === ALL_KEY) ? null : k;
      render();
    });
  }

  function setView(next) { view = next || null; render(); }

  /* ── KPI — 팀을 고르면 그 팀 지표로 바뀝니다 ────────────────────────── */
  function kpiRow(batches, team, samples) {
    let cards;

    if (team === "downstream") {
      const ty = nums(batches, b => b.downstream && b.downstream.totalYield);
      const mp = nums(batches, b => b.downstream && b.downstream.monomerPurity);
      const hcp = nums(batches, b => b.downstream && b.downstream.hcp);
      cards = [
        { k: "시료", v: batches.length, u: "건" },
        { k: "평균 Total Yield", v: fmt(avg(ty), 1), u: "%" },
        { k: "평균 Monomer", v: fmt(avg(mp), 2), u: "%" },
        { k: "최대 HCP", v: hcp.length ? fmt(Math.max.apply(null, hcp), 1) : L.empty, u: "ppm" }
      ];
    } else if (team === "analytics") {
      /* 분석 KPI 는 시료 기준입니다 — 배치로 세면 한 배치의 두 시료가 하나로 묻힙니다 */
      const ss = samples || [];
      const mono = nums(ss, s => window.Repo.valueOfSample(s, "ceSdsNR", "monomer"));
      const sia = nums(ss, s => window.Repo.valueOfSample(s, "nGlycan", "sialicAcid"));
      const se = nums(ss, s => window.Repo.valueOfSample(s, "seHPLC", "main"));
      cards = [
        { k: "시료", v: ss.length, u: "건" },
        { k: "평균 SE-HPLC Main", v: fmt(avg(se), 1), u: "%" },
        { k: "평균 CE-SDS Monomer", v: fmt(avg(mono), 1), u: "%" },
        { k: "평균 Sialic acid", v: fmt(avg(sia), 1), u: "%" }
      ];
    } else {
      const titers = nums(batches, b => b.upstream.titerHCCF);
      const viab = nums(batches, b => b.upstream.finalViability);
      /* "해당 없음"으로 표시한 칸은 분모에서 빠집니다 (repo.completeness) */
      const c = window.Repo.completeness(batches, window.DATA_ANALYTE_GROUPS);
      const filled = c.filled, total = c.total;
      cards = [
        { k: "시료", v: batches.length, u: "건" },
        { k: "최고 Titer HCCF", v: titers.length ? fmt(Math.max.apply(null, titers), 1) : L.empty, u: "mg/L" },
        { k: "평균 Viability", v: fmt(avg(viab), 1), u: "%" },
        { k: "데이터 완성도", v: total ? Math.round(filled / total * 100) : 0, u: "%" }
      ];
    }

    return cards.map(c =>
      '<div class="card stat"><div class="stat-label">' + esc(c.k) + '</div>' +
      '<div class="stat-value">' + esc(c.v) +
        '<span style="font-size:13px;font-weight:400;color:var(--c-text-soft)"> ' + esc(c.u) + '</span></div></div>'
    ).join("");
  }

  /* ── 과제만 선택 → Study 카드 ───────────────────────────────────────── */
  /* ── Study 선택 ───────────────────────────────────────────────────────
     카드 목록이 아니라 드롭다운입니다. 카드는 자리를 많이 쓰면서 정작
     "전체로 되돌리는" 길이 없었습니다 — 한 번 Study 를 고르면 카드가
     사라져, 다시 전체를 보려면 과제를 바꿨다 돌아와야 했습니다.

     고르는 즉시 적용합니다. 이 화면에는 조회 버튼이 없고, 여기서 고르는
     것은 "조건을 짜는 중" 이 아니라 "이걸 보겠다" 는 확정 동작입니다. */
  function studyPicker(studies, sel) {
    const n = studies.length;
    return '<div class="dash-studybar">' +
      '<label class="dash-studylab" for="dash-study">Study</label>' +
      '<select class="input dash-studysel" id="dash-study">' +
        '<option value="">전체 · Study ' + n + '개</option>' +
        studies.map(s => '<option value="' + esc(s.id) + '"' +
          (sel.studyId === s.id ? " selected" : "") + '>' + esc(s.name) +
          (s.status ? " · " + esc(s.status) : "") + '</option>').join("") +
      '</select>' +
      '<span class="dash-studyhint">' +
        (sel.studyId
          ? "이 Study 의 배치만 집계합니다."
          : "과제 전체를 집계합니다. Study 를 고르면 그 범위로 좁혀집니다.") +
      '</span></div>';
  }

  function studyCards(studies) {
    if (!studies.length) return '<div class="empty"><div class="empty-title">소속 Study가 없습니다</div></div>';
    return '<div class="study-grid">' + studies.map(function (s) {
      const bs = window.DATA_BATCHES.filter(b => b.studyId === s.id);
      const titers = bs.map(b => b.upstream.titerHCCF).filter(v => v !== null);
      return '<button class="study-card" data-study="' + esc(s.id) + '" ' +
          'style="--lead:var(--c-accent)">' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">' +
          '<span class="study-no">' + esc(s.type || "STUDY") + '</span>' +
          '<span class="badge badge-' + (s.status === "완료" ? "ok" : "info") +
            '" style="font-size:10px">' + esc(s.status) + '</span></div>' +
        '<div class="study-title">' + esc(s.name) + '</div>' +
        '<div class="study-en">' + bs.length + '개 시료 · ' + esc(s.startDate || L.empty) + '</div>' +
        '<div style="display:flex;gap:10px;font-size:11.5px;color:var(--c-text-mute)">' +
          '<span>최고 Titer <b class="mono">' +
            (titers.length ? fmt(Math.max.apply(null, titers), 0) : L.empty) + '</b> mg/L</span>' +
          '<span style="margin-left:auto;color:var(--c-accent);font-weight:600">팀별 보기 →</span>' +
        '</div></button>';
    }).join("") + '</div>';
  }

  /* ── Study 선택 → 팀 카드 ───────────────────────────────────────────── */
  function teamCards(teamSets, batches) {
    return '<div class="team-grid">' + teamSets.map(function (t) {
      const metrics = teamMetrics(t.team, batches);
      const state = !t.defined ? "none" : t.hasData ? (t.filled >= t.total ? "full" : "part") : "none";
      return '<section class="card team-card" style="--team:' + t.color + '">' +
        '<div class="team-head">' +
          '<div><div class="team-name">' + esc(t.ko) + '</div>' +
          '<div style="font-size:11px;color:var(--c-text-mute)">' +
            (!t.defined ? "원본 데이터 없음" : t.filled + "/" + t.total + " 입력") + '</div></div>' +
          '<span class="team-chip" data-state="' + state + '"><span class="team-chip-dot"></span>' +
            (!t.defined ? "없음" : t.hasData ? Math.round(t.filled / t.total * 100) + "%" : "미입력") + '</span>' +
        '</div>' +
        '<div class="team-metrics">' + metrics.map(m =>
          '<div class="team-metric"><span class="team-metric-k">' + esc(m.k) + '</span>' +
          '<span class="team-metric-v">' + esc(m.v) +
            (m.u ? '<span class="team-metric-u">' + esc(m.u) + '</span>' : "") + '</span></div>').join("") +
        '</div>' +
        '<div class="card-body" style="padding-top:0;display:flex;gap:var(--s-2)">' +
          '<button class="btn btn-ghost btn-sm" data-viewteam="' + t.team + '" style="flex:1">그래프 보기</button>' +
          '<button class="btn btn-ghost btn-sm" data-goteam="' + t.team + '" style="flex:1">Data 입력 →</button>' +
        '</div></section>';
    }).join("") + '</div>';
  }

  /* ── 팀 카드의 요약 지표 ──────────────────────────────────────────────
     ★ 항목을 여기 적어 두지 않습니다. **스키마에서 읽습니다.**

     예전에는 팀마다 세 줄이 코드에 박혀 있었습니다. 그래서 지표를 재설정해
     HCP · Monomer · CE-SDS · IE-HPLC · N-glycan 이 없어진 뒤에도 카드에는
     그대로 남아 "미입력" 으로 떴습니다. 정제공정팀 카드가 그랬습니다 —
     사용자가 적는 것은 Yield 인데, 적을 곳조차 없는 HCP 가 빈칸으로
     나란히 서 있었습니다. 빠진 값처럼 보이지만 애초에 없는 항목입니다.

     이제 Data 입력 표와 **같은 목록**(DATA_ANALYTE_GROUPS)을 지납니다.
     표에 있는 항목만 카드에 뜨고, 항목을 더하거나 빼면 카드가 따라옵니다.

     값은 Repo.valueOf 로 읽습니다 — 배치 객체를 직접 뒤지면 Data 입력이
     적은 값을 건너뛰고 원본만 보게 됩니다.

     집계도 스키마가 정합니다: peak 또는 cumulative 인 항목은 **최고**,
     나머지는 **평균**. 올라가는 값의 평균은 중간 시점이 섞여 뜻이 흐려집니다.
     어느 쪽인지는 항목 정의에 적혀 있지, 여기서 이름으로 짐작하지 않습니다. */
  function teamMetrics(team, batches) {
    const out = [];
    (window.DATA_ANALYTE_GROUPS || []).forEach(function (g) {
      if (g.team !== team || g.empty) return;
      (g.items || []).forEach(function (it) {
        const vals = nums(batches, b => window.Repo.valueOf(b, g.id, it.key));
        const peak = !!(it.peak || it.cumulative);
        const n = peak
          ? (vals.length ? Math.max.apply(null, vals) : null)
          : avg(vals);
        out.push({
          k: (peak ? "최고 " : "평균 ") + it.label,
          v: (n === null || n === undefined || !isFinite(n)) ? L.empty : fmt(n, it.dp),
          u: it.unit || ""
        });
      });
    });
    return out;
  }

  /* ── 그래프 구획 공통 ───────────────────────────────────────────────── */

  function card(title, sub, inner, accent) {
    return '<section class="card" style="margin-bottom:var(--s-4)' +
        (accent ? ';border-top:3px solid ' + accent : "") + '">' +
      '<div class="card-head"><div><h2 class="card-title">' + esc(title) + '</h2>' +
      (sub ? '<p class="card-sub">' + esc(sub) + '</p>' : "") + '</div></div>' +
      '<div class="card-body">' + inner + '</div></section>';
  }

  /* 여러 시리즈를 행(배치 또는 시료) 축에 세우는 막대 그래프 + 범례 + 대체 표 */
  function barBlock(batches, cfg) {
    /* 가로축 이름은 부르는 쪽이 정합니다. 기본값(b.id)은 그릇의 내부
       식별자라, 사용자가 본 적 없는 글자입니다 — B-9RCDXB6 처럼. */
    const labelOf = cfg.labelOf || (b => b.name || b.id);
    const cats = batches.map(labelOf);
    const series = cfg.series.map((s, i) => ({
      name: s.name, color: s.color || PALETTE[i % PALETTE.length],
      data: batches.map(s.get)
    }));
    const has = series.some(s => s.data.some(v => v !== null && isFinite(v)));
    if (!has) {
      return '<div class="empty"><div class="empty-title">' + esc(cfg.emptyTitle || "미입력") + '</div>' +
        '<div class="empty-body">이 범위의 배치에 해당 항목 값이 없습니다.</div></div>';
    }
    return C.swatches(series) +
      '<div class="chart-wrap" style="margin-top:var(--s-3)">' +
        C.bars({ cats, series, min: cfg.min, max: cfg.max, h: cfg.h || CH_H, w: 820,
                 aria: cfg.aria || cfg.title }) + '</div>' +
      (cfg.min != null
        ? '<p style="font-size:11px;color:var(--c-text-mute);margin:var(--s-2) 0 0">' +
          '세로축은 ' + cfg.min + ' 부터 시작합니다 — 값이 좁은 구간에 몰려 있어 0부터 그리면 차이가 보이지 않습니다.</p>'
        : "") +
      C.dataTable(cfg.title, ["시료"].concat(series.map(s => s.name)),
        cats.map((c, i) => [c].concat(series.map(s =>
          s.data[i] === null || !isFinite(s.data[i]) ? L.empty : String(s.data[i])))));
  }

  /* 화면에 실제로 보이는 표 (대체 표가 아니라 데이터 자체를 보여줄 때).
     nameOf / subOf 를 주면 첫 열을 그 값으로 그립니다 (시료 표에서 사용). */
  function visibleTable(rows, cols, caption, nameOf, subOf) {
    const head = "시료";
    return '<div class="tbl-scroll"><table class="tbl">' +
      (caption ? '<caption class="sr-only">' + esc(caption) + '</caption>' : "") +
      '<thead><tr><th scope="col">' + head + '</th>' +
        cols.map(c => '<th scope="col">' + esc(c.label) +
          '<br><span style="font-weight:400;text-transform:none">' + esc(c.unit) + '</span></th>').join("") +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        const sub = subOf ? subOf(r) : null;
        return '<tr><td class="mono" style="font-weight:600">' +
          esc(nameOf ? nameOf(r) : r.id) +
          (sub ? '<br><span style="font-weight:400;font-size:10.5px;color:var(--c-text-mute)">' +
                 esc(sub) + '</span>' : "") + '</td>' +
          cols.map(function (c) {
            const v = c.get(r);
            return (v === null || v === undefined || !isFinite(v))
              ? '<td class="na">' + L.empty + '</td>'
              : '<td class="mono">' + Number(v).toFixed(c.dp) + '</td>';
          }).join("") + '</tr>';
      }).join("") +
      '</tbody></table></div>';
  }

  /* ══════════════════════════════════════════════════════════════════════
     팀별 상세 — Data 입력 서식에서 그대로 읽습니다

     ★ 팀마다 그래프와 표가 코드에 박혀 있었습니다. 그래서 지표를 재설정해
       HCP · Residual DNA · SEC Monomer · CE-SDS · IE-HPLC · N-glycan 이
       없어진 뒤에도 카드와 컬럼이 남아, 정제공정팀 화면에 "SEC-HPLC 단량체
       순도 — 미입력" "잔류 불순물 — 미입력" 두 장이 빈 채로 서 있었습니다.
       표에도 적을 곳 없는 열 셋이 늘 "미입력" 이었습니다.

       빠진 값처럼 보이지만 **애초에 그 팀 서식에 없는 항목**입니다.

     이제 DATA_ANALYTE_GROUPS 를 지납니다. Data 입력 표에 있는 항목만 그리고,
     항목을 더하거나 빼면 여기가 따라옵니다 — 고칠 곳이 없습니다.

     ── 한 그래프에 한 단위 ────────────────────────────────────────────────
     그룹을 그대로 한 장에 담지 않고 **단위별로 나눕니다.** 배양 그룹에는
     10⁶ cells/mL · mg/L · % 가 섞여 있어, 한 축에 올리면 Titer(1400)가
     Viability(60)를 깔아뭉개 막대가 보이지 않습니다.
     ══════════════════════════════════════════════════════════════════════ */

  /* 가로축 이름 — 그릇의 내부 id(B-9RCDXB6)가 아니라 시료 이름입니다.
     내부 id 는 사용자가 지은 것도, 본 적도 없는 글자입니다. */
  function rowLabel(b) {
    if (!b) return "";
    if (b.name) return b.name;
    const s = (window.Repo.samplesOfBatch ? window.Repo.samplesOfBatch(b.id) : [])[0];
    return (s && s.name) || b.expNo || b.id;
  }

  /* 값이 좁고 높은 구간에 몰려 있으면 축을 0 부터 그리지 않습니다 —
     그러면 막대 끝이 다 붙어 보여 차이를 읽을 수 없습니다.
     ★ 기준을 코드에 박지 않고 값에서 정합니다. 서식이 바뀌어도 맞습니다. */
  function axisFloor(values) {
    const v = values.filter(x => x !== null && x !== undefined && isFinite(x));
    if (v.length < 2) return null;
    const lo = Math.min.apply(null, v), hi = Math.max.apply(null, v);
    if (lo <= 0) return null;
    if (hi - lo > lo * 0.5) return null;            /* 폭이 넓으면 0 부터가 정직합니다 */
    const floor = Math.floor((lo - (hi - lo) * 0.6) / 10) * 10;
    return floor > 0 ? floor : null;
  }

  function teamSection(team, batches) {
    const groups = (window.DATA_ANALYTE_GROUPS || [])
      .filter(g => g.team === team && !g.empty && (g.items || []).length);
    const teamKo = (window.DATA_TEAMS.find(t => t.id === team) || {}).ko || team;
    const cards = [];
    let first = true;

    /* 배양의 일자별 Titer 는 스키마 항목이 아니라 따로 그립니다
       (DATA_TITER_DAYS 를 쓸 때만 — 기본은 비어 있어 나오지 않습니다) */
    if (team === "upstream") {
      const days = (window.DATA_TITER_DAYS || [])
        .filter(d => batches.some(b => window.Repo.valueOf(b, "titer", d) !== null));
      if (days.length) {
        const shown = batches.slice(0, 12);
        cards.push(card("Titer 일자별 추이", "Day 축에 시료를 겹쳐 비교 (1,000 mg/L = 1 g/L)",
          C.swatches(shown.map((b, i) => ({ name: rowLabel(b), color: PALETTE[i % PALETTE.length] }))) +
          '<div class="chart-wrap" style="margin-top:var(--s-3)">' +
            C.line({ x: days,
                     series: shown.map((b, i) => ({
                       name: rowLabel(b), color: PALETTE[i % PALETTE.length],
                       data: days.map(d => window.Repo.valueOf(b, "titer", d)) })),
                     h: CH_H, w: 820, aria: "Titer 일자별 추이" }) + '</div>',
          teamColor(team)));
        first = false;
      }
    }

    groups.forEach(function (g) {
      /* 단위별로 묶습니다 — 한 축에 한 단위 */
      const byUnit = [];
      (g.items || []).forEach(function (it) {
        const u = it.unit || "";
        let bucket = byUnit.find(x => x.unit === u);
        if (!bucket) { bucket = { unit: u, items: [] }; byUnit.push(bucket); }
        bucket.items.push(it);
      });

      byUnit.forEach(function (bucket) {
        const series = bucket.items.map(function (it, j) {
          return {
            name: it.label + (it.unit ? " (" + it.unit + ")" : ""),
            color: PALETTE[j % PALETTE.length],
            get: b => window.Repo.valueOf(b, g.id, it.key)
          };
        });
        const all = [];
        batches.forEach(b => series.forEach(s => all.push(s.get(b))));
        /* 그룹 이름만 쓰면 "정제" 처럼 한 단어 제목이 되어 무엇을 그린
           것인지 읽히지 않습니다. 단위가 갈린 경우에만 단위를 덧붙입니다. */
        const title = g.label +
          (byUnit.length > 1 && bucket.unit ? " · " + bucket.unit : " 측정값");
        cards.push(card(title,
          g.note || bucket.items.map(it => it.label).join(" · "),
          barBlock(batches, { title: title, min: axisFloor(all), series: series,
                              labelOf: rowLabel }),
          first ? teamColor(team) : null));
        first = false;
      });
    });

    /* 표는 그 팀의 모든 항목을 한 줄에 — 여러 그룹이면 그룹 이름을 붙입니다 */
    const cols = [];
    groups.forEach(function (g) {
      (g.items || []).forEach(function (it) {
        cols.push({
          /* 그룹 이름과 항목 이름이 같으면 한 번만 적습니다 ("Potency Potency") */
          label: (groups.length > 1 && g.label !== it.label ? g.label + " " : "") + it.label,
          unit: it.unit || "", dp: it.dp,
          get: b => window.Repo.valueOf(b, g.id, it.key)
        });
      });
    });

    if (!cards.length) return "";
    return grid2(cards) +
      (cols.length
        ? card(teamKo + " 데이터", "시료별 전체 항목",
            visibleTable(batches, cols, teamKo + " 데이터", rowLabel, null))
        : "");
  }

  /* 팀을 고르지 않았으면 세 팀을 순서대로. 골랐으면 그 팀만.
     배양·정제는 배치 축, 분석은 시료 축입니다. */
  /* ── 팀별 그래프 ──────────────────────────────────────────────────────
     좌측 "팀별 보기" 에서 고른 팀만 그립니다. 고르지 않으면 세 팀을
     차례로 다 그립니다 — 공정 간 비교가 이 화면의 목적이라, 전체 상태를
     "아무것도 없음" 으로 두면 그 목적을 막게 됩니다.

     ★ 그래프는 2단으로 깝니다. 한 줄에 하나씩이면 두 번째 그래프를 보려고
       스크롤하는 사이에 첫 번째가 화면에서 사라져, 비교가 기억에 의존하게
       됩니다. 나란히 놓으면 눈만 옮기면 됩니다.
       표가 든 카드는 2단에 넣지 않습니다 — 열이 잘려 오히려 못 읽습니다. */
  /* ── 고른 팀에 데이터가 없을 때 ──────────────────────────────────────
     다른 팀으로 옮겨 주지 않습니다. 사용자가 고른 것은 팀이고, 바꾼 것은
     Study 입니다 — 고른 적 없는 팀의 그래프를 대신 보여 주면 그게 어느
     팀 값인지 확인하지 않은 채 읽게 됩니다.

     팀은 그대로 두고, 이 Study 에 그 팀 데이터가 없다는 사실만 말합니다.
     다른 Study 로 옮기거나 그 팀 데이터를 넣으러 가는 길을 함께 둡니다. */
  /* 그릴 것이 하나라도 있는가.

     ★ 완성도(completeness)로 판단하면 안 됩니다. 완성도는 **스키마 항목이
       몇 칸 찼나** 를 세는데, 일자별 Titer(D10~D20)는 그 분모에 들어 있지
       않습니다. 그래서 일자별 Titer 만 적은 배치는 "0/6 입력" 이 되고,
       화면에는 그릴 선이 멀쩡히 있는데도 "데이터가 없습니다" 가 떴습니다.

     여기서 묻는 것은 "서식이 다 찼나" 가 아니라 "그릴 값이 있나" 입니다.
     그래서 그래프가 실제로 읽는 경로(Repo.valueOf)로 직접 확인합니다. */
  function teamHasAnyValue(team, batches, samples) {
    const some = (list, fn) => (list || []).some(fn);

    /* ★ 분석팀도 같은 길입니다. 예전에는 시료 범위(valueOfSample)를 따로
       봤는데, 값은 이제 그릇 범위에 들어갑니다 — 시료 범위로 물으면 적어
       놓은 값이 있는데도 "데이터 없음" 이 떴습니다. */
    const rows = byTeam(batches, team);
    const groups = (window.DATA_ANALYTE_GROUPS || [])
      .filter(g => g.team === team && !g.empty);
    const hit = some(rows, b => groups.some(g =>
      (g.items || []).some(it => window.Repo.valueOf(b, g.id, it.key) !== null)));
    if (hit) return true;

    /* 배양은 일자별 Titer 도 봅니다 — 그래프의 주인공인데 위 그룹에 없습니다 */
    if (team !== "upstream") return false;
    const days = window.DATA_TITER_DAYS || [];
    return some(batches, b => days.some(d => window.Repo.valueOf(b, "titer", d) !== null));
  }

  function teamEmptyState(teamKo, studyKo, set) {
    const why = (set && !set.defined)
      ? "이 팀의 측정 항목이 원본에 정의되어 있지 않습니다."
      : "이 Study 범위에 " + esc(teamKo) + " 측정값이 아직 없습니다.";
    return '<div class="empty" style="border-left:3px solid ' + teamColor(currentTeam()) + '">' +
      '<div class="empty-title">해당 Study에 대한 ' + esc(teamKo) + ' 데이터가 존재하지 않습니다.</div>' +
      '<div class="empty-body">' +
        (studyKo ? '<b>' + esc(studyKo) + '</b> · ' : "") + why +
        '<br>팀 선택은 그대로 두었습니다 — 위 Study 를 다른 것으로 바꾸거나, ' +
        '<a href="ebr.html">Data 입력</a>에서 이 팀의 값을 먼저 기록하세요.' +
      '</div></div>';
  }
  /* 테두리 색은 지금 보고 있는 팀의 것입니다 — 전역 Scope.team 이 아니라
     이 화면의 view 를 따릅니다. */
  function currentTeam() { return view; }

  /* ══════════════════════════════════════════════════════════════════════
     직접 추가한 항목 — Data 입력에서 만든 행 · 열

     스키마에 없는 항목이라 고정 그래프에 자리가 없습니다. 그렇다고 입력
     화면에만 두면 적어 놓고도 비교할 수 없는 숫자가 됩니다.

     그래서 드롭다운 하나와 그래프 하나를 둡니다. 고를 거리는 **실제로
     값이 있는 항목** 뿐입니다 — 없는 조합까지 늘어놓으면 목록이 조합 수만큼
     길어지고, 고르면 빈 그래프가 나옵니다.
     ══════════════════════════════════════════════════════════════════════ */
  let customPick = null;

  function customMetrics(batches) {
    if (!window.Entries || !window.Entries.getScopeValues) return [];
    const seen = {};
    (batches || []).forEach(function (b) {
      const vals = window.Entries.getScopeValues("batch:" + b.id) || {};
      Object.keys(vals).forEach(function (k) {
        if (k.indexOf("ws_") !== 0 || k.indexOf("@") < 0) return;
        if (!seen[k]) seen[k] = { key: k, label: customLabel(k) };
      });
    });
    return Object.keys(seen).sort().map(k => seen[k]);
  }
  function customLabel(storeKey) {
    const at = storeKey.indexOf("@");
    const rowKey = storeKey.slice(3, at), col = storeKey.slice(at + 1);
    let name = rowKey;
    (window.DATA_ANALYTE_GROUPS || []).some(function (g) {
      const it = (g.items || []).find(x => window.Repo.fieldKey(g.id, x.key) === rowKey);
      if (it) { name = it.label; return true; }
      return false;
    });
    if (rowKey === "titer") name = (window.DATA_TITER_ITEM || {}).label || "Titer";
    return name + " · " + col;
  }

  function customSection(batches) {
    const list = customMetrics(batches);
    if (!list.length) return "";
    if (!customPick || !list.some(m => m.key === customPick)) customPick = list[0].key;

    const rows = (batches || []).map(function (b) {
      const rec = window.Entries.getValue("batch:" + b.id, customPick);
      const n = rec ? window.VAL.numeric(window.VAL.coerce(rec.value)) : null;
      return { id: b.id, v: (n === null || n === undefined) ? NaN : n };
    }).filter(r => isFinite(r.v));

    const picker =
      '<div class="dash-custpick">' +
        '<label for="dash-cust"><b>항목</b></label>' +
        '<select class="input" id="dash-cust">' +
          list.map(m => '<option value="' + esc(m.key) + '"' +
            (m.key === customPick ? " selected" : "") + '>' + esc(m.label) + '</option>').join("") +
        '</select>' +
        '<span>Data 입력에서 직접 추가한 항목입니다</span>' +
      '</div>';

    const inner = rows.length
      ? C.bars({ cats: rows.map(r => r.id),
                 series: [{ name: "값", data: rows.map(r => r.v), color: "#6D28D9" }],
                 h: CH_H, w: 820 })
      : '<div class="empty"><div class="empty-title">이 항목에 적힌 값이 없습니다</div></div>';

    return '<div class="dash-teamhead" style="border-left-color:#6D28D9">직접 추가한 항목</div>' +
      picker +
      card("배치별 비교", "원본 서식에 없는 항목이라 따로 모았습니다 · 값이 있는 배치만",
        inner, "#6D28D9");
  }

  function chartSections(team, batches, samples) {
    if (!batches.length) {
      return '<div class="empty"><div class="empty-title">' + esc(L.noResult) + '</div>' +
        '<div class="empty-body">' + esc(L.noResultHint) + '</div></div>';
    }
    const head = (ko, color) =>
      '<div class="dash-teamhead" style="border-left-color:' + (color || "var(--c-accent)") + '">' +
      esc(ko) + '</div>';
    const colorOf = id => (window.DATA_TEAMS.find(t => t.id === id) || {}).color;

    /* ★ 세 팀이 같은 함수를 지납니다 — 팀마다 따로 쓰면 또 갈립니다.

       분석팀도 배치(=시료 그릇) 축입니다. 예전에는 시료 축을 따로 썼습니다:
       배치 하나에 시료가 여럿이던 시절, 그래프에 시료마다 한 칸이 서야
       어느 시료의 값인지 남았기 때문입니다. 이제 시료 하나에 그릇 하나가
       1:1 이라 두 축이 같은 것이고, 값도 그릇 범위에 들어갑니다 —
       시료 축으로 읽으면 Data 입력이 적은 값을 통째로 건너뜁니다. */
    if (team === "upstream" || team === "downstream" || team === "analytics") {
      return teamSection(team, byTeam(batches, team));
    }
    return window.DATA_TEAMS.map(function (t) {
      const rows = byTeam(batches, t.id);
      if (!rows.length) return "";
      return head(t.ko + " · 시료 " + rows.length + "건", colorOf(t.id)) + teamSection(t.id, rows);
    }).join("");
  }

  /* 그 팀의 시료만 — 시료마다 그릇이 하나이고 그릇에 팀이 적혀 있습니다.
     거르지 않으면 정제팀 화면에 배양팀 시료가 전 항목 "미입력" 으로 섭니다. */
  function byTeam(batches, team) {
    return (batches || []).filter(b => !team || b.team === team);
  }

  /* 그래프 카드들을 2단으로 묶습니다. 표 카드는 아래에 전체 너비로 둡니다. */
  function grid2(cards) { return '<div class="dash-grid2">' + cards.join("") + '</div>'; }

  /* ── 렌더 ───────────────────────────────────────────────────────────── */
  /* 팀 상세 머리 — 돌아갈 길과 지금 어느 팀을 보는지 */
  function detailHead(teamSet, studyKo) {
    const color = teamSet ? teamSet.color : "var(--c-accent)";
    return '<div class="dash-back">' +
      '<button class="btn btn-ghost btn-sm" id="dash-toall">← 전체 요약으로</button>' +
      '<span class="dash-back-crumb">' +
        (studyKo ? esc(studyKo) + ' <span class="crumb-sep">›</span> ' : "") +
        '<b style="color:' + color + '">' + esc(teamSet ? teamSet.ko : "") + '</b>' +
      '</span></div>';
  }

  function render() {
    const sel = window.Scope.get();
    const desc = window.Scope.describe();
    paintSubnav();

    /* ★ 팀 마디는 Scope 가 아니라 이 화면의 view 에서 옵니다.

       Scope.team 은 다른 화면(Data 입력 · 데이터 조회)이 쓰는 값이라, 전체
       요약을 보는 중에도 값이 들어 있습니다. 그걸 그대로 찍으면 화면에는
       세 팀 카드가 떠 있는데 경로에는 "정제공정팀" 이 적혀, 지금 무엇을
       보고 있는지가 두 군데에서 서로 다른 말을 합니다. */
    const crumbPath = desc.path.filter(p => p.key !== "team");
    if (view) {
      const t = (window.DATA_TEAMS || []).find(x => x.id === view);
      crumbPath.push({ key: "team", label: t ? t.ko : view });
    }
    $("#crumb").innerHTML = crumbPath.length
      ? crumbPath.map((p, i) => (i ? '<span class="crumb-sep">›</span>' : "") +
          '<span>' + esc(p.label) + '</span>').join("")
      : '<span style="color:var(--c-text-mute)">과제를 선택하세요</span>';

    /* 과제를 고르지 않아도 위젯은 보여야 합니다 — 출근하고 처음 여는 화면에서
       "과제를 선택하세요" 만 뜨면 오늘 할 일을 확인할 수 없습니다. */
    if (!sel.scopeId) {
      $("#page-title").textContent = "대시보드";
      $("#kpi").innerHTML = "";
      $("#body").innerHTML =
        '<div class="empty"><div class="empty-title">과제를 선택하면 그래프가 열립니다</div>' +
        '<div class="empty-body">상단 우측 셀렉터에서 DA-1234 또는 DA-4321을 고르면 ' +
        'KPI · 팀별 그래프가 그 과제 범위로 표시됩니다.</div></div>';
      return;
    }

    Promise.all([
      window.Scope.batches(),
      window.Repo.searchStudies(sel.q, sel),
      window.Repo.getTeamDataSetsForSelection(sel),
      window.Scope.samples()
    ]).then(function (r) {
      const batches = r[0], studies = r[1], teamSets = r[2], samples = r[3];

      /* 고른 팀이 이 범위에 없어졌으면(Study 를 바꿔 팀 데이터가 사라진
         경우가 아니라, 팀 목록 자체가 달라진 경우) 전체 요약으로 둡니다 */
      if (view && !(window.DATA_TEAMS || []).some(t => t.id === view)) view = null;

      const teamSet = view ? (teamSets || []).find(t => t.team === view) : null;
      const teamKo = teamSet ? teamSet.ko : "";

      $("#page-title").textContent = desc.scope + (desc.study ? " · " + desc.study : "") +
        (teamKo ? " · " + teamKo : "");

      /* ── 전체 요약 ───────────────────────────────────────────────────
         세 팀 현황 카드만 둡니다. 여기서 그래프까지 펼치면 열 몇 개가
         세로로 쌓여, 현황을 보러 들어온 사람이 스크롤부터 하게 됩니다.
         KPI 도 두지 않습니다 — 팀을 고르지 않은 상태에서 "최고 Titer" 를
         한 줄로 보여 주면 그게 어느 팀 숫자인지 알 수 없습니다. */
      if (!view) {
        $("#kpi").innerHTML = "";
        $("#body").innerHTML =
          studyPicker(studies, sel) +
          '<section><div class="card-head" style="padding:0 0 var(--s-3)">' +
            '<div><h2 class="card-title">팀별 요약</h2>' +
            '<p class="card-sub">' +
              (sel.studyId
                ? '[그래프 보기] 를 누르면 그 팀 그래프만 펼칩니다 · ' +
                  '[Data 입력 →] 은 그 팀을 들고 입력 화면으로 갑니다'
                : '과제 전체 기준입니다 — 위에서 Study 를 고르면 그 범위로 좁혀집니다') +
            '</p></div></div>' +
            teamCards(teamSets, batches) + '</section>';
        wireCommon();
        return;
      }

      /* ── 팀 상세 ─────────────────────────────────────────────────────
         그 팀 그래프만. 다른 팀 그래프도, 요약 카드도 두지 않습니다. */
      const teamEmpty = !teamHasAnyValue(view, batches, samples);
      $("#kpi").innerHTML = teamEmpty ? "" : kpiRow(batches, view, samples);

      $("#body").innerHTML =
        detailHead(teamSet, desc.study) +
        studyPicker(studies, sel) +
        (teamEmpty
          ? teamEmptyState(teamKo, desc.study, teamSet)
          : chartSections(view, batches, samples) + customSection(batches));

      wireCommon();
      const cp = document.getElementById("dash-cust");
      if (cp) cp.addEventListener("change", function () { customPick = this.value; render(); });
      const back = document.getElementById("dash-toall");
      if (back) back.addEventListener("click", () => setView(null));
    });

    /* 두 보기가 함께 쓰는 연결 */
    function wireCommon() {
      const sp = document.getElementById("dash-study");
      if (sp) sp.addEventListener("change", function () {
        /* Study 를 바꿔도 보던 팀은 그대로 둡니다 — 고른 것은 Study 이지
           팀이 아닙니다 (selection.js 의 setStudy 설명과 같은 이유). */
        window.Scope.setStudy(this.value || null);
      });
      $$("[data-viewteam]").forEach(b => b.addEventListener("click", function () {
        setView(b.dataset.viewteam);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }));
      /* ★ 이 버튼만 전역 팀을 바꿉니다 — "이 팀으로 작업하러 간다" 이므로 */
      $$("[data-goteam]").forEach(b => b.addEventListener("click", function () {
        window.Scope.setTeam(b.dataset.goteam);
        window.location.href = "ebr.html";
      }));
    }
  }

  /* 회의 모드는 페이지 이동이 아니라 대시보드 안에서 오버레이로 열립니다 —
     여기서 고른 과제·Study·팀을 그대로 들고 들어가야 하기 때문입니다. */
  window.MeetingView.install();
  $("#meeting-btn").addEventListener("click", function () {
    if (!window.Scope.get().scopeId) { window.alert("먼저 과제를 선택하세요."); return; }
    window.MeetingView.open();
  });

  /* 조회 바를 두지 않습니다 — 이 화면은 조건을 짜는 곳이 아니라 그래프를
     보는 곳입니다. Study 는 Study 카드에서, 팀은 좌측 "팀별 보기" 에서
     고릅니다. 둘 다 이미 화면 안에 있습니다.

     할 일 · 분석 의뢰 구독도 뗐습니다 — 그 위젯이 없으니 다시 그릴 이유가
     없고, 남겨 두면 값이 바뀔 때마다 그래프를 통째로 다시 그립니다. */
  window.Scope.subscribe(render);
  window.Entries.subscribe(render);

  /* 다른 탭에서 바뀐 것 · 레코드가 늘어난 것도 받습니다 —
     값 변경은 Entries 가, Study·Batch 추가는 Repo 가 알려 줍니다. */
  if (window.Repo && window.Repo.subscribe) {
    window.Repo.subscribe(function (what) {
      if (what === "remote" || what === "dataset") render();
    });
  }
  render();
})();
