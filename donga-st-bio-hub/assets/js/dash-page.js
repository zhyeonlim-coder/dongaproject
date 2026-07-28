/* ==========================================================================
   대시보드  [지시서 §1 §3 §8]

   · 선택한 과제(또는 기반 Study)의 데이터만 집계
   · 과제만 선택 → 소속 Study별 요약 카드
   · Study까지 선택 → 배양 / 정제 / 분석 팀별 요약 카드
   · 팀 카드 클릭 → 선택 상태를 그대로 들고 EBR 입력으로 이동
   · Day축 Titer 추이 (배치 겹쳐 보기)
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

  /* ── KPI ────────────────────────────────────────────────────────────── */
  function kpiRow(batches) {
    const num = f => batches.map(f).filter(v => v !== null && isFinite(v));
    const titers = num(b => b.upstream.titerHCCF);
    const viab = num(b => b.upstream.finalViability);

    let filled = 0, total = 0;
    batches.forEach(b => window.DATA_ANALYTE_GROUPS.forEach(g => {
      if (g.empty) return;
      g.items.forEach(it => { total++; if (window.Repo.valueOf(b, g.id, it.key) !== null) filled++; });
    }));

    const cards = [
      { k: "배치", v: batches.length, u: "건" },
      { k: "최고 Titer HCCF", v: titers.length ? fmt(Math.max.apply(null, titers), 1) : L.empty, u: "mg/L" },
      { k: "평균 Viability", v: viab.length ? fmt(viab.reduce((a, c) => a + c, 0) / viab.length, 1) : L.empty, u: "%" },
      { k: "데이터 완성도", v: total ? Math.round(filled / total * 100) : 0, u: "%" }
    ];
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
        '<div class="card-body" style="padding-top:0">' +
          '<button class="btn btn-ghost btn-sm" data-goteam="' + t.team + '" style="width:100%">' +
            esc(t.ko) + ' EBR 입력 →</button>' +
        '</div></section>';
    }).join("") + '</div>';
  }

  function teamMetrics(team, batches) {
    const num = f => batches.map(f).filter(v => v !== null && isFinite(v));
    if (team === "upstream") {
      const t = num(b => b.upstream.titerHCCF), v = num(b => b.upstream.finalViability),
            p = num(b => b.upstream.maxVCD);
      return [
        { k: "최고 Titer", v: t.length ? fmt(Math.max.apply(null, t), 0) : L.empty, u: "mg/L" },
        { k: "최고 Max VCD", v: p.length ? fmt(Math.max.apply(null, p), 2) : L.empty, u: "10⁶/mL" },
        { k: "평균 Viability", v: v.length ? fmt(v.reduce((a, c) => a + c, 0) / v.length, 1) : L.empty, u: "%" }
      ];
    }
    if (team === "downstream") {
      return [
        { k: "수율", v: L.empty, u: "%" },
        { k: "HCP", v: L.empty, u: "ng/mg" },
        { k: "순도", v: L.empty, u: "%" }
      ];
    }
    const mono = num(b => b.analytics.ceSdsNR.monomer);
    const main = num(b => b.analytics.ieHPLC.main);
    const g0f = num(b => b.analytics.nGlycan.g0f);
    const avg = a => a.length ? fmt(a.reduce((x, y) => x + y, 0) / a.length, 1) : L.empty;
    return [
      { k: "CE-SDS Monomer", v: avg(mono), u: "%" },
      { k: "IE-HPLC Main", v: avg(main), u: "%" },
      { k: "N-glycan G0F", v: avg(g0f), u: "%" }
    ];
  }

  /* ── Day축 Titer 추이 ───────────────────────────────────────────────── */
  function trend(batches) {
    const days = window.DATA_TITER_DAYS.filter(d => batches.some(b => b.upstream.titer[d] !== null));
    if (!days.length) return '<div class="empty"><div class="empty-title">Titer 일자별 데이터가 없습니다</div></div>';

    const palette = ["#0369A1","#6D28D9","#0F766E","#B45309","#B91C1C","#1D4ED8",
                     "#0284C7","#7C3AED","#15803D","#C2410C","#9333EA","#0891B2"];
    const shown = batches.slice(0, 12);
    const series = shown.map((b, i) => ({
      name: b.id, color: palette[i % palette.length],
      data: days.map(d => b.upstream.titer[d])
    }));

    return '<div class="card-body">' +
      C.legend(series) +
      '<div class="chart-wrap" style="margin-top:var(--s-3)">' +
        C.line({ x: days, series, h: 300, w: 820, aria: "배치별 Titer 일자 추이" }) + '</div>' +
      C.dataTable("배치 × Day Titer", ["배치"].concat(days),
        shown.map(b => [b.id].concat(days.map(d => b.upstream.titer[d] === null ? L.empty : b.upstream.titer[d])))) +
      (batches.length > 12
        ? '<p style="font-size:11.5px;color:var(--c-text-mute);margin:var(--s-3) 0 0">' +
          '배치 ' + batches.length + '개 중 12개만 표시합니다 — 필터로 범위를 좁히세요.</p>' : "") +
    '</div>';
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
      $("#body").innerHTML = '<div class="empty"><div class="empty-title">과제 또는 기반 Study를 선택하세요</div>' +
        '<div class="empty-body">상단 우측 셀렉터에서 선택하면 해당 범위만 집계됩니다.</div></div>';
      $("#kpi").innerHTML = "";
      return;
    }

    Promise.all([
      window.Scope.batches(),
      window.Repo.searchStudies(sel.q, sel),
      window.Repo.getTeamDataSetsForSelection(sel)
    ]).then(function (r) {
      const batches = r[0], studies = r[1], teamSets = r[2];
      $("#page-title").textContent = desc.scope + (desc.study ? " · " + desc.study : "");
      $("#kpi").innerHTML = kpiRow(batches);

      const showTeams = !!sel.studyId || window.Scope.skipsStudyStep();

      $("#body").innerHTML =
        (showTeams
          ? '<section style="margin-bottom:var(--s-4)"><div class="card-head" style="padding:0 0 var(--s-3)">' +
              '<div><h2 class="card-title">팀별 요약</h2>' +
              '<p class="card-sub">카드의 버튼을 누르면 이 선택 그대로 EBR 입력으로 이동합니다</p></div></div>' +
              teamCards(teamSets, batches) + '</section>'
          : '<section style="margin-bottom:var(--s-4)"><div class="card-head" style="padding:0 0 var(--s-3)">' +
              '<div><h2 class="card-title">Study 목록</h2>' +
              '<p class="card-sub">Study를 선택하면 팀별 요약으로 전환됩니다</p></div></div>' +
              studyCards(studies) + '</section>') +

        '<section class="card" style="margin-bottom:var(--s-4)">' +
          '<div class="card-head"><div><h2 class="card-title">Titer 일자별 추이</h2>' +
          '<p class="card-sub">배치를 겹쳐 비교합니다 (Day 축)</p></div></div>' + trend(batches) + '</section>' +

        '<section class="card"><div class="card-head"><div>' +
          '<h2 class="card-title">최근 EBR 입력</h2>' +
          '<p class="card-sub">작성자 · 시각 (초 단위)</p></div>' +
          '<a class="btn btn-ghost btn-sm" href="ebr.html">EBR 입력</a></div>' +
          '<div class="card-body">' + auditFeed() + '</div></section>';

      $$("[data-study]").forEach(b => b.addEventListener("click", () =>
        window.Scope.setStudy(b.dataset.study)));
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
