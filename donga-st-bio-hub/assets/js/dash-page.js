/* ==========================================================================
   대시보드

   · 선택한 과제의 데이터만 집계
   · 과제만 선택 → 소속 Study별 요약 카드
   · Study까지 선택 → 배양 / 정제 / 분석 팀별 요약 카드
   · 팀 카드 클릭 → 선택 상태를 그대로 들고 EBR 입력으로 이동

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

  const PALETTE = ["#0369A1","#6D28D9","#0F766E","#B45309","#B91C1C","#1D4ED8",
                   "#0284C7","#7C3AED","#15803D","#C2410C","#9333EA","#0891B2"];

  function paintSubnav() {
    const sel = window.Scope.get();
    window.Shell.subnav([
      { label: "팀별 보기", items: window.DATA_TEAMS.map(t => ({
        key: t.id, ko: t.ko, active: sel.team === t.id, color: t.color })) },
      { label: "바로가기", items: [
        { ko: "EBR 입력", href: "ebr.html" },
        { ko: "데이터 조회", href: "data.html" },
        { ko: "일정 관리", href: "schedule.html" }
      ]}
    ], k => window.Scope.setTeam(window.Scope.get().team === k ? null : k));
  }

  /* ── KPI — 팀을 고르면 그 팀 지표로 바뀝니다 ────────────────────────── */
  function kpiRow(batches, team) {
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
      const mono = nums(batches, b => b.analytics.ceSdsNR.monomer);
      const sia = nums(batches, b => b.analytics.nGlycan.sialicAcid);
      const se = nums(batches, b => b.analytics.seHPLC.main);
      cards = [
        { k: "배치", v: batches.length, u: "건" },
        { k: "평균 SE-HPLC Main", v: fmt(avg(se), 1), u: "%" },
        { k: "평균 CE-SDS Monomer", v: fmt(avg(mono), 1), u: "%" },
        { k: "평균 Sialic acid", v: fmt(avg(sia), 1), u: "%" }
      ];
    } else {
      const titers = nums(batches, b => b.upstream.titerHCCF);
      const viab = nums(batches, b => b.upstream.finalViability);
      let filled = 0, total = 0;
      batches.forEach(b => window.DATA_ANALYTE_GROUPS.forEach(g => {
        if (g.empty) return;
        g.items.forEach(it => { total++; if (window.Repo.valueOf(b, g.id, it.key) !== null) filled++; });
      }));
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
          '<button class="btn btn-ghost btn-sm" data-goteam="' + t.team + '" style="flex:1">EBR 입력 →</button>' +
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
      { k: "CE-SDS Monomer", v: fmt(avg(nums(batches, b => b.analytics.ceSdsNR.monomer)), 1), u: "%" },
      { k: "IE-HPLC Main", v: fmt(avg(nums(batches, b => b.analytics.ieHPLC.main)), 1), u: "%" },
      { k: "N-glycan G0F", v: fmt(avg(nums(batches, b => b.analytics.nGlycan.g0f)), 1), u: "%" }
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

  /* 여러 시리즈를 배치 축에 세우는 막대 그래프 + 범례 + 대체 표 */
  function barBlock(batches, cfg) {
    const cats = batches.map(b => b.id);
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
        C.bars({ cats, series, min: cfg.min, max: cfg.max, h: cfg.h || 260, w: 820,
                 aria: cfg.aria || cfg.title }) + '</div>' +
      (cfg.min != null
        ? '<p style="font-size:11px;color:var(--c-text-mute);margin:var(--s-2) 0 0">' +
          '세로축은 ' + cfg.min + ' 부터 시작합니다 — 값이 좁은 구간에 몰려 있어 0부터 그리면 차이가 보이지 않습니다.</p>'
        : "") +
      C.dataTable(cfg.title, ["배치"].concat(series.map(s => s.name)),
        cats.map((c, i) => [c].concat(series.map(s =>
          s.data[i] === null || !isFinite(s.data[i]) ? L.empty : String(s.data[i])))));
  }

  /* 화면에 실제로 보이는 표 (대체 표가 아니라 데이터 자체를 보여줄 때) */
  function visibleTable(batches, cols, caption) {
    return '<div class="tbl-scroll"><table class="tbl">' +
      (caption ? '<caption class="sr-only">' + esc(caption) + '</caption>' : "") +
      '<thead><tr><th scope="col">Exp. No.</th>' +
        cols.map(c => '<th scope="col">' + esc(c.label) +
          '<br><span style="font-weight:400;text-transform:none">' + esc(c.unit) + '</span></th>').join("") +
      '</tr></thead><tbody>' +
      batches.map(b => '<tr><td class="mono" style="font-weight:600">' + esc(b.id) + '</td>' +
        cols.map(c => {
          const v = c.get(b);
          return (v === null || v === undefined || !isFinite(v))
            ? '<td class="na">' + L.empty + '</td>'
            : '<td class="mono">' + Number(v).toFixed(c.dp) + '</td>';
        }).join("") + '</tr>').join("") +
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
              C.line({ x: days, series, h: 300, w: 820, aria: "배치별 Titer 일자 추이" }) + '</div>' +
            C.dataTable("배치 × Day Titer", ["배치"].concat(days),
              shown.map(b => [b.id].concat(days.map(d =>
                b.upstream.titer[d] === null ? L.empty : b.upstream.titer[d])))) +
            (batches.length > 12
              ? '<p style="font-size:11.5px;color:var(--c-text-mute);margin:var(--s-3) 0 0">' +
                '배치 ' + batches.length + '개 중 12개만 표시합니다 — Study나 조건으로 범위를 좁히세요.</p>' : "");
        })()
      : '<div class="empty"><div class="empty-title">Titer 일자별 데이터가 없습니다</div></div>';

    return card("Titer 일자별 추이", "Day 축에 배치를 겹쳐 비교합니다 (1,000 mg/L = 1 g/L)",
        trend, teamColor("upstream")) +

      card("배치별 Titer HCCF", "Harvest 시점 생산량 — CPP 조건 변경의 최종 결과",
        barBlock(batches, {
          title: "배치별 Titer HCCF",
          series: [{ name: "Titer HCCF (mg/L)", get: b => b.upstream.titerHCCF, color: "#0369A1" }]
        })) +

      card("VCD 및 Viability", "생세포도(Max/Final)와 Harvest 시점 생존율",
        barBlock(batches, {
          title: "배치별 VCD",
          series: [
            { name: "Max VCD (10⁶ cells/mL)",   get: b => b.upstream.maxVCD,   color: "#0369A1" },
            { name: "Final VCD (10⁶ cells/mL)", get: b => b.upstream.finalVCD, color: "#7C3AED" }
          ]
        }) +
        '<div style="margin-top:var(--s-5)">' +
          barBlock(batches, {
            title: "배치별 Final Viability",
            min: 40,
            series: [{ name: "Final Viability (%)", get: b => b.upstream.finalViability, color: "#0F766E" }]
          }) +
        '</div>');
  }

  /* ── 정제공정팀 ─────────────────────────────────────────────────────── */
  function downstreamSection(batches) {
    const d = k => (b => b.downstream ? b.downstream[k] : null);

    return card("정제 단계별 수율", "Protein A → CEX → AEX 3-step. Total Yield는 세 단계의 곱입니다",
        barBlock(batches, {
          title: "정제 단계별 수율",
          min: 60,
          series: [
            { name: "Protein A (%)", get: d("proteinAYield"), color: "#6D28D9" },
            { name: "CEX (%)",       get: d("cexYield"),      color: "#9333EA" },
            { name: "AEX (%)",       get: d("aexYield"),      color: "#0369A1" },
            { name: "Total (%)",     get: d("totalYield"),    color: "#B45309" }
          ]
        }), teamColor("downstream")) +

      card("순도 및 잔류 불순물", "SEC-HPLC 단량체 순도 · HCP · Residual DNA",
        barBlock(batches, {
          title: "SEC-HPLC Monomer Purity",
          min: 95,
          series: [{ name: "SEC-HPLC Monomer (%)", get: d("monomerPurity"), color: "#0F766E" }]
        }) +
        '<div style="margin-top:var(--s-5)">' +
          barBlock(batches, {
            title: "잔류 불순물",
            series: [
              { name: "HCP (ppm)",           get: d("hcp"),         color: "#B45309" },
              { name: "Residual DNA (pg/mg)", get: d("residualDNA"), color: "#B91C1C" }
            ]
          }) +
        '</div>') +

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

  /* ── 바이오분석팀 ───────────────────────────────────────────────────── */
  function analyticsSection(batches) {
    const g = k => (b => b.analytics.nGlycan[k]);

    return card("N-glycan 프로파일", "당쇄 조성 — 시알산(Sialic acid)과 High mannose는 품질에 직결됩니다",
        barBlock(batches, {
          title: "N-glycan 프로파일",
          series: [
            { name: "G0F (%)",          get: g("g0f"),          color: "#0F766E" },
            { name: "G1F (%)",          get: g("g1f"),          color: "#0369A1" },
            { name: "High mannose (%)", get: g("highMannose"),  color: "#B45309" },
            { name: "Sialic acid (%)",  get: g("sialicAcid"),   color: "#B91C1C" },
            { name: "Afucosylated (%)", get: g("afucosylated"), color: "#7C3AED" }
          ]
        }), teamColor("analytics")) +

      card("Main peak 순도", "SE-HPLC · CE-SDS 기준 순도 (Purity)",
        barBlock(batches, {
          title: "Main peak 순도",
          min: 80,
          series: [
            { name: "SE-HPLC Main (%)",     get: b => b.analytics.seHPLC.main,     color: "#0F766E" },
            { name: "CE-SDS NR Monomer (%)", get: b => b.analytics.ceSdsNR.monomer, color: "#0369A1" },
            { name: "CE-SDS R LC+HC (%)",   get: b => b.analytics.ceSdsR.lcHc,     color: "#7C3AED" }
          ]
        })) +

      card("IE-HPLC 전하 변이 분포", "Acidic · Main · Basic 비율",
        barBlock(batches, {
          title: "IE-HPLC 전하 변이",
          series: [
            { name: "Acidic (%)", get: b => b.analytics.ieHPLC.acidic, color: "#B45309" },
            { name: "Main (%)",   get: b => b.analytics.ieHPLC.main,   color: "#0369A1" },
            { name: "Basic (%)",  get: b => b.analytics.ieHPLC.basic,  color: "#7C3AED" }
          ]
        }));
  }

  /* 팀을 고르지 않았으면 세 팀을 순서대로. 골랐으면 그 팀만. */
  function chartSections(team, batches) {
    if (!batches.length) {
      return '<div class="empty"><div class="empty-title">이 범위에 배치가 없습니다</div></div>';
    }
    const head = ko => '<div class="eyebrow" style="margin:var(--s-6) 0 var(--s-3)">' + esc(ko) + '</div>';
    if (team === "upstream")   return upstreamSection(batches);
    if (team === "downstream") return downstreamSection(batches);
    if (team === "analytics")  return analyticsSection(batches);
    return head("배양공정팀") + upstreamSection(batches) +
           head("정제공정팀") + downstreamSection(batches) +
           head("바이오분석팀") + analyticsSection(batches);
  }

  /* ── 최근 입력 (Audit 피드) ─────────────────────────────────────────── */
  function auditFeed() {
    const st = E.state();
    const items = [];
    Object.keys(st.values).forEach(k => {
      const rec = st.values[k];
      const scope = k.split("|")[0], field = k.split("|")[1];
      items.push({ scope, field, by: rec.updatedBy || rec.createdBy,
                   at: rec.updatedAt || rec.createdAt, action: rec.action, value: rec.value });
    });
    st.samples.forEach(s => items.push({ scope: "batch:" + s.batchId, field: L.ui.sampleName + " 생성: " + s.name,
      by: s.createdBy, at: s.createdAt, action: "Create", value: null }));
    items.sort((a, b) => String(b.at).localeCompare(String(a.at)));

    if (!items.length) return '<p style="font-size:12.5px;color:var(--c-text-mute);margin:0">' +
      'EBR 입력 기록이 없습니다.</p>';
    return items.slice(0, 8).map(i =>
      '<div class="rail-event">' +
        '<span class="rail-event-bar" style="background:' +
          (i.action === "Update" ? "var(--c-warn)" : "var(--c-accent)") + '"></span>' +
        '<span style="min-width:0;flex:1">' +
          '<span style="display:block;font-size:12.5px;font-weight:500">' + esc(i.field) +
            (i.value !== null ? ' = <span class="mono">' + esc(i.value) + '</span>' : "") + '</span>' +
          '<span style="display:block;font-size:10.5px;color:var(--c-text-mute)" class="mono">' +
            esc(i.scope) + ' · ' + esc(i.by) + ' · ' + esc(E.stampHuman(i.at)) + '</span>' +
        '</span>' +
        '<span class="badge badge-' + (i.action === "Update" ? "warn" : "ok") + '" style="font-size:10px">' +
          (i.action === "Update" ? L.ui.auditUpdated : L.ui.auditCreated) + '</span>' +
      '</div>').join("");
  }

  /* ── 다가오는 일정 — 일정 관리 화면과 같은 소스(HubCalendar) ────────── */
  function scheduleStrip() {
    const H = window.HubCalendar;
    if (!H) return "";
    const soon = H.upcoming(5);
    if (!soon.length) return "";
    return '<section class="card" style="margin-bottom:var(--s-4)">' +
      '<div class="card-head"><div><h2 class="card-title">다가오는 일정</h2>' +
      '<p class="card-sub">우측 캘린더 · 일정 관리 화면과 같은 일정입니다</p></div>' +
      '<a class="btn btn-ghost btn-sm" href="schedule.html">일정 관리</a></div>' +
      '<div class="card-body">' + soon.map(e =>
        '<div class="rail-event">' +
          '<span class="rail-event-bar" style="background:' +
            ((H.KIND[e.kind] || H.KIND.meeting).color) + '"></span>' +
          '<span style="min-width:0;flex:1">' +
            '<span style="display:block;font-size:12.5px;font-weight:500">' + esc(e.ko) + '</span>' +
            '<span style="display:flex;gap:6px;align-items:center;margin-top:3px;flex-wrap:wrap">' +
              '<span class="mono" style="font-size:10.5px;color:var(--c-text-mute)">' + esc(e.date) + '</span>' +
              '<span class="badge" style="font-size:10px">' +
                esc((H.KIND[e.kind] || {}).ko || e.kind) + '</span>' +
            '</span></span>' +
        '</div>').join("") + '</div></section>';
  }

  /* ── 렌더 ───────────────────────────────────────────────────────────── */
  function render() {
    const sel = window.Scope.get();
    const desc = window.Scope.describe();
    paintSubnav();

    $("#crumb").innerHTML = desc.path.length
      ? desc.path.map((p, i) => (i ? '<span class="crumb-sep">›</span>' : "") +
          '<span>' + esc(p.label) + '</span>').join("")
      : '<span style="color:var(--c-text-mute)">과제를 선택하세요</span>';

    if (!sel.scopeId) {
      $("#page-title").textContent = "대시보드";
      $("#body").innerHTML = '<div class="empty"><div class="empty-title">과제를 선택하세요</div>' +
        '<div class="empty-body">상단 우측 셀렉터에서 DA-1234 또는 DA-4321을 고르면 ' +
        '해당 과제의 데이터만 집계됩니다.</div></div>';
      $("#kpi").innerHTML = "";
      return;
    }

    Promise.all([
      window.Scope.batches(),
      window.Repo.searchStudies(sel.q, sel),
      window.Repo.getTeamDataSetsForSelection(sel)
    ]).then(function (r) {
      const batches = r[0], studies = r[1], teamSets = r[2];
      $("#page-title").textContent = desc.scope + (desc.study ? " · " + desc.study : "") +
        (desc.team ? " · " + desc.team : "");
      $("#kpi").innerHTML = kpiRow(batches, sel.team);

      const showTeams = !!sel.studyId;

      $("#body").innerHTML =
        (showTeams
          ? '<section style="margin-bottom:var(--s-4)"><div class="card-head" style="padding:0 0 var(--s-3)">' +
              '<div><h2 class="card-title">팀별 요약</h2>' +
              '<p class="card-sub">그래프 보기를 누르면 그 팀 지표만 표시되고, EBR 입력은 선택을 그대로 들고 갑니다</p></div></div>' +
              teamCards(teamSets, batches) + '</section>'
          : '<section style="margin-bottom:var(--s-4)"><div class="card-head" style="padding:0 0 var(--s-3)">' +
              '<div><h2 class="card-title">Study 목록</h2>' +
              '<p class="card-sub">Study를 선택하면 팀별 요약으로 전환됩니다</p></div></div>' +
              studyCards(studies) + '</section>') +

        scheduleStrip() +

        chartSections(sel.team, batches) +

        '<section class="card"><div class="card-head"><div>' +
          '<h2 class="card-title">최근 EBR 입력</h2>' +
          '<p class="card-sub">작성자 · 시각 (초 단위)</p></div>' +
          '<a class="btn btn-ghost btn-sm" href="ebr.html">EBR 입력</a></div>' +
          '<div class="card-body">' + auditFeed() + '</div></section>';

      $$("[data-study]").forEach(b => b.addEventListener("click", () =>
        window.Scope.setStudy(b.dataset.study)));
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

  window.StudySelector.mount($("#selector"));
  window.Scope.subscribe(render);
  window.Entries.subscribe(render);
  render();
})();
