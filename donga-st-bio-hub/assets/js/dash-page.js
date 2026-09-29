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

  function paintSubnav() {
    const sel = window.Scope.get();
    window.Shell.subnav([
      { label: "팀별 보기", items: window.DATA_TEAMS.map(t => ({
        key: t.id, ko: t.ko, active: sel.team === t.id, color: t.color })) },
      { label: "바로가기", items: [
        { ko: "Data 입력", href: "ebr.html" },
        { ko: "데이터 조회", href: "data.html" },
        { ko: "일정 관리", href: "schedule.html" }
      ]}
    /* ★ 같은 팀을 다시 눌러도 끄지 않습니다.
       끄면 세 팀 그래프가 한꺼번에 세로로 쌓여, 비교하려고 들어온 사람이
       스크롤부터 하게 됩니다. 이 화면은 "한 팀을 본다" 가 기본 상태입니다. */
    ], k => window.Scope.setTeam(k));
  }

  /* 팀이 정해져 있지 않으면 첫 팀으로 시작합니다. "아무 팀도 아님" 을
     기본값으로 두면 그게 곧 전체 나열이 됩니다. */
  function ensureTeam() {
    const sel = window.Scope.get();
    if (sel.team) return false;
    const first = (window.DATA_TEAMS && window.DATA_TEAMS[0]) ? window.DATA_TEAMS[0].id : null;
    if (!first) return false;
    window.Scope.setTeam(first);          /* subscribe 가 render 를 다시 부릅니다 */
    return true;
  }

  /* ── KPI — 팀을 고르면 그 팀 지표로 바뀝니다 ────────────────────────── */
  function kpiRow(batches, team, samples) {
    let cards;

    if (team === "downstream") {
      const ty = nums(batches, b => b.downstream && b.downstream.totalYield);
      const mp = nums(batches, b => b.downstream && b.downstream.monomerPurity);
      const hcp = nums(batches, b => b.downstream && b.downstream.hcp);
      cards = [
        { k: "배치", v: batches.length, u: "건" },
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
        { k: "배치", v: batches.length, u: "건" },
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
        '<div class="study-en">' + bs.length + '개 배치 · ' + esc(s.startDate || L.empty) + '</div>' +
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

  function teamMetrics(team, batches) {
    if (team === "upstream") {
      const t = nums(batches, b => b.upstream.titerHCCF);
      const v = nums(batches, b => b.upstream.finalViability);
      const p = nums(batches, b => b.upstream.maxVCD);
      return [
        { k: "최고 Titer", v: t.length ? fmt(Math.max.apply(null, t), 0) : L.empty, u: "mg/L" },
        { k: "최고 Max VCD", v: p.length ? fmt(Math.max.apply(null, p), 2) : L.empty, u: "10⁶/mL" },
        { k: "평균 Viability", v: fmt(avg(v), 1), u: "%" }
      ];
    }
    if (team === "downstream") {
      const ty = nums(batches, b => b.downstream && b.downstream.totalYield);
      const hcp = nums(batches, b => b.downstream && b.downstream.hcp);
      const mp = nums(batches, b => b.downstream && b.downstream.monomerPurity);
      return [
        { k: "평균 Total Yield", v: fmt(avg(ty), 1), u: "%" },
        { k: "평균 HCP", v: fmt(avg(hcp), 1), u: "ppm" },
        { k: "평균 Monomer", v: fmt(avg(mp), 2), u: "%" }
      ];
    }
    return [
      { k: "CE-SDS Monomer", v: fmt(avg(nums(batches, b => window.Repo.valueOf(b, "ceSdsNR", "monomer"))), 1), u: "%" },
      { k: "IE-HPLC Main", v: fmt(avg(nums(batches, b => window.Repo.valueOf(b, "ieHPLC", "main"))), 1), u: "%" },
      { k: "N-glycan G0F", v: fmt(avg(nums(batches, b => window.Repo.valueOf(b, "nGlycan", "g0f"))), 1), u: "%" }
    ];
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
    const cats = batches.map(b => b.name || b.id);
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
      C.dataTable(cfg.title, ["배치"].concat(series.map(s => s.name)),
        cats.map((c, i) => [c].concat(series.map(s =>
          s.data[i] === null || !isFinite(s.data[i]) ? L.empty : String(s.data[i])))));
  }

  /* 화면에 실제로 보이는 표 (대체 표가 아니라 데이터 자체를 보여줄 때).
     nameOf / subOf 를 주면 첫 열을 그 값으로 그립니다 (시료 표에서 사용). */
  function visibleTable(rows, cols, caption, nameOf, subOf) {
    const head = nameOf ? "시료" : "Exp. No.";
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

  /* ── 배양공정팀 ─────────────────────────────────────────────────────── */
  function upstreamSection(batches) {
    const days = window.DATA_TITER_DAYS.filter(d => batches.some(b => b.upstream.titer[d] !== null));
    const shown = batches.slice(0, 12);

    const trend = days.length
      ? (function () {
          const series = shown.map((b, i) => ({
            name: b.id, color: PALETTE[i % PALETTE.length],
            data: days.map(d => b.upstream.titer[d])
          }));
          return C.legend(series) +
            '<div class="chart-wrap" style="margin-top:var(--s-3)">' +
              C.line({ x: days, series, h: CH_H, w: 820, aria: "배치별 Titer 일자 추이" }) + '</div>' +
            C.dataTable("배치 × Day Titer", ["배치"].concat(days),
              shown.map(b => [b.id].concat(days.map(d =>
                b.upstream.titer[d] === null ? L.empty : b.upstream.titer[d])))) +
            (batches.length > 12
              ? '<p style="font-size:11.5px;color:var(--c-text-mute);margin:var(--s-3) 0 0">' +
                '배치 ' + batches.length + '개 중 12개만 표시합니다 — Study나 조건으로 범위를 좁히세요.</p>' : "");
        })()
      : '<div class="empty"><div class="empty-title">Titer 일자별 데이터가 없습니다</div></div>';

    /* VCD 와 Viability 를 한 카드에 겹쳐 두던 것을 나눴습니다 — 2단에서는
       카드 하나가 곧 그래프 하나여야 높이가 맞습니다. */
    return grid2([
      card("Titer 일자별 추이", "Day 축에 배치를 겹쳐 비교 (1,000 mg/L = 1 g/L)",
        trend, teamColor("upstream")),

      card("배치별 Titer HCCF", "Harvest 시점 생산량 — CPP 조건 변경의 최종 결과",
        barBlock(batches, {
          title: "배치별 Titer HCCF",
          series: [{ name: "Titer HCCF (mg/L)", get: b => b.upstream.titerHCCF, color: "#0369A1" }]
        })),

      card("배치별 VCD", "생세포도 — Max 와 Final",
        barBlock(batches, {
          title: "배치별 VCD",
          series: [
            { name: "Max VCD (10⁶ cells/mL)",   get: b => b.upstream.maxVCD,   color: "#0369A1" },
            { name: "Final VCD (10⁶ cells/mL)", get: b => b.upstream.finalVCD, color: "#7C3AED" }
          ]
        })),

      card("Final Viability", "Harvest 시점 생존율",
        barBlock(batches, {
          title: "배치별 Final Viability",
          min: 40,
          series: [{ name: "Final Viability (%)", get: b => b.upstream.finalViability, color: "#0F766E" }]
        }))
    ]);
  }

  /* ── 정제공정팀 ─────────────────────────────────────────────────────── */
  function downstreamSection(batches) {
    const d = k => (b => b.downstream ? b.downstream[k] : null);

    return grid2([
      card("정제 단계별 수율", "Protein A → CEX → AEX 3-step · Total 은 세 단계의 곱",
        barBlock(batches, {
          title: "정제 단계별 수율",
          min: 60,
          series: [
            { name: "Protein A (%)", get: d("proteinAYield"), color: "#6D28D9" },
            { name: "CEX (%)",       get: d("cexYield"),      color: "#9333EA" },
            { name: "AEX (%)",       get: d("aexYield"),      color: "#0369A1" },
            { name: "Total (%)",     get: d("totalYield"),    color: "#B45309" }
          ]
        }), teamColor("downstream")),

      card("SEC-HPLC 단량체 순도", "Monomer Purity",
        barBlock(batches, {
          title: "SEC-HPLC Monomer Purity",
          min: 95,
          series: [{ name: "SEC-HPLC Monomer (%)", get: d("monomerPurity"), color: "#0F766E" }]
        })),

      card("잔류 불순물", "HCP · Residual DNA",
        barBlock(batches, {
          title: "잔류 불순물",
          series: [
            { name: "HCP (ppm)",            get: d("hcp"),         color: "#B45309" },
            { name: "Residual DNA (pg/mg)", get: d("residualDNA"), color: "#B91C1C" }
          ]
        }))
    ]) +

      card("정제 데이터", "배치별 전체 항목",
        visibleTable(batches, [
          { label: "Protein A", unit: "%",     dp: 1, get: d("proteinAYield") },
          { label: "CEX",       unit: "%",     dp: 1, get: d("cexYield") },
          { label: "AEX",       unit: "%",     dp: 1, get: d("aexYield") },
          { label: "Total Yield", unit: "%",   dp: 1, get: d("totalYield") },
          { label: "SEC Monomer", unit: "%",   dp: 2, get: d("monomerPurity") },
          { label: "HCP",       unit: "ppm",   dp: 1, get: d("hcp") },
          { label: "Residual DNA", unit: "pg/mg", dp: 2, get: d("residualDNA") }
        ], "정제 데이터"));
  }

  /* ── 바이오분석팀 ───────────────────────────────────────────────────────
     분석값은 배치가 아니라 **시료**에 붙습니다. 한 배치에서 여러 시료를
     시험했다면 그래프에도 시료마다 한 칸씩 서야 합니다 — 배치로 묶으면
     어느 시료의 값인지 사라집니다. */
  function analyticsSection(samples) {
    const v = (gid, key) => (s => window.Repo.valueOfSample(s, gid, key));

    return grid2([
      card("N-glycan 프로파일",
        "당쇄 조성 — 시알산(Sialic acid)과 High mannose는 품질에 직결됩니다 · 가로축은 시료",
        barBlock(samples, {
          title: "N-glycan 프로파일",
          series: [
            { name: "G0F (%)",          get: v("nGlycan", "g0f"),          color: "#0F766E" },
            { name: "G1F (%)",          get: v("nGlycan", "g1f"),          color: "#0369A1" },
            { name: "High mannose (%)", get: v("nGlycan", "highMannose"),  color: "#B45309" },
            { name: "Sialic acid (%)",  get: v("nGlycan", "sialicAcid"),   color: "#B91C1C" },
            { name: "Afucosylated (%)", get: v("nGlycan", "afucosylated"), color: "#7C3AED" }
          ]
        }), teamColor("analytics")),

      card("Main peak 순도", "SE-HPLC · CE-SDS 기준 순도 (Purity)",
        barBlock(samples, {
          title: "Main peak 순도",
          min: 80,
          series: [
            { name: "SE-HPLC Main (%)",      get: v("seHPLC", "main"),     color: "#0F766E" },
            { name: "CE-SDS NR Monomer (%)", get: v("ceSdsNR", "monomer"), color: "#0369A1" },
            { name: "CE-SDS R LC+HC (%)",    get: v("ceSdsR", "lcHc"),     color: "#7C3AED" }
          ]
        })),

      card("IE-HPLC 전하 변이 분포", "Acidic · Main · Basic 비율",
        barBlock(samples, {
          title: "IE-HPLC 전하 변이",
          series: [
            { name: "Acidic (%)", get: v("ieHPLC", "acidic"), color: "#B45309" },
            { name: "Main (%)",   get: v("ieHPLC", "main"),   color: "#0369A1" },
            { name: "Basic (%)",  get: v("ieHPLC", "basic"),  color: "#7C3AED" }
          ]
        }))
    ]) +

      card("시료 목록", "배치마다 채취한 시료와 채취 시점",
        visibleTable(samples, [
          { label: "SE-HPLC Main", unit: "%", dp: 1, get: v("seHPLC", "main") },
          { label: "IE-HPLC Main", unit: "%", dp: 1, get: v("ieHPLC", "main") },
          { label: "CE-SDS Monomer", unit: "%", dp: 1, get: v("ceSdsNR", "monomer") },
          { label: "Sialic acid", unit: "%", dp: 1, get: v("nGlycan", "sialicAcid") }
        ], "시료별 분석 결과", s => s.name,
           s => (s.batchId || "") + (s.stage ? " · " + s.stage : "")));
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
  function chartSections(team, batches, samples) {
    if (!batches.length) {
      return '<div class="empty"><div class="empty-title">' + esc(L.noResult) + '</div>' +
        '<div class="empty-body">' + esc(L.noResultHint) + '</div></div>';
    }
    const head = (ko, color) =>
      '<div class="dash-teamhead" style="border-left-color:' + (color || "var(--c-accent)") + '">' +
      esc(ko) + '</div>';
    const colorOf = id => (window.DATA_TEAMS.find(t => t.id === id) || {}).color;

    if (team === "upstream")   return upstreamSection(batches);
    if (team === "downstream") return downstreamSection(batches);
    if (team === "analytics")  return analyticsSection(samples);
    return head("배양공정팀", colorOf("upstream")) + upstreamSection(batches) +
           head("정제공정팀", colorOf("downstream")) + downstreamSection(batches) +
           head("바이오분석팀 · 시료 " + samples.length + "건", colorOf("analytics")) +
             analyticsSection(samples);
  }

  /* 그래프 카드들을 2단으로 묶습니다. 표 카드는 아래에 전체 너비로 둡니다. */
  function grid2(cards) { return '<div class="dash-grid2">' + cards.join("") + '</div>'; }

  /* ── 렌더 ───────────────────────────────────────────────────────────── */
  function render() {
    if (ensureTeam()) return;        /* 팀을 정하면 통지가 다시 render 합니다 */
    const sel = window.Scope.get();
    const desc = window.Scope.describe();
    paintSubnav();

    $("#crumb").innerHTML = desc.path.length
      ? desc.path.map((p, i) => (i ? '<span class="crumb-sep">›</span>' : "") +
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
      $("#page-title").textContent = desc.scope + (desc.study ? " · " + desc.study : "") +
        (desc.team ? " · " + desc.team : "");
      $("#kpi").innerHTML = kpiRow(batches, sel.team, samples);

      const showTeams = !!sel.studyId;

      /* ★ 이 화면은 그래프 전용입니다.
         할 일 위젯 · 분석 의뢰 · 다가오는 일정 · 최근 Data 입력 · 우측
         캘린더를 모두 뺐습니다. 한 화면에 여러 가지가 섞여 있으면 정작
         공정 간 비교를 하려고 들어온 사람이 스크롤부터 해야 합니다.
         할 일과 의뢰는 각자의 화면에, 일정은 일정 관리 탭에 있습니다.

         Study 는 카드 목록 대신 드롭다운 하나로 고릅니다. 카드는 자리를
         많이 쓰면서 "전체로 되돌리는 길" 이 없었습니다. */
      $("#body").innerHTML =
        studyPicker(studies, sel) +

        (showTeams
          ? '<section style="margin-bottom:var(--s-4)"><div class="card-head" style="padding:0 0 var(--s-3)">' +
              '<div><h2 class="card-title">팀별 요약</h2>' +
              '<p class="card-sub">그래프 보기를 누르면 그 팀 지표만 표시되고, Data 입력은 선택을 그대로 들고 갑니다</p></div></div>' +
              teamCards(teamSets, batches) + '</section>'
          : "") +

        chartSections(sel.team, batches, samples);

      const sp = document.getElementById("dash-study");
      if (sp) sp.addEventListener("change", function () {
        window.Scope.setStudy(this.value || null);
      });
      $$("[data-viewteam]").forEach(b => b.addEventListener("click", () =>
        window.Scope.setTeam(b.dataset.viewteam)));
      $$("[data-goteam]").forEach(b => b.addEventListener("click", function () {
        window.Scope.setTeam(b.dataset.goteam);
        window.location.href = "ebr.html";
      }));
    });
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
  render();
})();
