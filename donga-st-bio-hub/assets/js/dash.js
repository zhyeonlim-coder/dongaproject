/* ==========================================================================
   Dashboard — project-scoped integration view for the three teams
   ========================================================================== */

(function () {
  "use strict";

  const user = window.Shell.mount({ page: "dashboard" });
  if (!user) return;

  const L = window.LAB, S = window.Store, C = window.Charts;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  let study = "all";

  window.Meeting.install();
  window.StudyModal.install();

  /* ── Study cards — click opens the integrated 3-department view ──────── */
  function studyCards(c) {
    if (!c.studies.length) {
      return '<div class="empty"><div class="empty-title">등록된 스터디가 없습니다</div>' +
        '<div class="empty-body">이 과제에 스터디를 정의하면 부서별 데이터가 자동으로 묶입니다.</div></div>';
    }
    return '<div class="study-grid">' + c.studies.map(s => {
      const ds = S.studyDataset(s.id);
      const lead = s.lead === "배양공정팀" ? L.DEPTS.culture.color
                 : s.lead === "정제공정팀" ? L.DEPTS.purif.color : L.DEPTS.analysis.color;

      const chip = (dept) => {
        const d = L.DEPTS[dept];
        if (s.teams.indexOf(dept) === -1) return "";
        const e = ds.expect[dept] || 0, h = ds.have[dept] || 0;
        const state = h === 0 ? "none" : h >= e ? "full" : "part";
        return '<span class="team-chip" data-state="' + state + '">' +
          '<span class="team-chip-dot"></span>' + esc(d.short) + ' ' + h + '/' + e + '</span>';
      };

      const notes = S.notesForStudy(s.id).length;
      return '<button class="study-card" data-study-open="' + esc(s.id) + '" style="--lead:' + lead + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">' +
          '<span class="study-no">STUDY #' + s.no + '</span>' +
          '<span class="badge badge-' + (s.status === "진행중" ? "info" : s.status === "완료" ? "ok" : "warn") +
            '" style="font-size:10px">' + esc(s.status) + '</span>' +
        '</div>' +
        '<div class="study-title">' + esc(s.ko) + '</div>' +
        '<div class="study-en">' + esc(s.en) + '</div>' +
        '<div class="team-chips" style="margin-bottom:var(--s-3)">' +
          chip("culture") + chip("purif") + chip("analysis") + '</div>' +
        '<div style="display:flex;gap:8px;align-items:center;font-size:11px;color:var(--c-text-mute)">' +
          (ds.oos.length ? '<span class="spec spec-oos" style="font-size:10px">OOS ' + ds.oos.length + '</span>'
                         : '<span class="spec spec-pass" style="font-size:10px">적합</span>') +
          '<span>조건 ' + ds.arms.length + '개</span>' +
          (notes ? '<span>· 피드백 ' + notes + '</span>' : "") +
          '<span style="margin-left:auto;color:var(--c-accent);font-weight:600">통합 보기 →</span>' +
        '</div>' +
      '</button>';
    }).join("") + '</div>';
  }

  function ctx() {
    const prj = window.Shell.project();
    const p = L.PROJECTS.find(x => x.id === prj) || L.PROJECTS[0];
    const studies = L.STUDIES.filter(s => s.prj === p.id);
    let batches = S.batches().filter(b => b.prj === p.id);
    let purif = S.purifRuns().filter(r => batches.some(b => b.id === r.batch));
    let analyses = S.analyses().filter(a => purif.some(r => r.id === a.sample));

    if (study !== "all") {
      batches = batches.filter(b => b.study === study);
      const ids = batches.map(b => b.id);
      purif = purif.filter(r => r.study === study || ids.indexOf(r.batch) > -1);
      analyses = analyses.filter(a => a.study === study || purif.some(r => r.id === a.sample));
    }
    return { p, studies, batches, purif, analyses, oos: S.oosItems(p.id) };
  }

  /* ── Sub-menu: studies ──────────────────────────────────────────────── */
  function paintSubnav() {
    const c = ctx();
    window.Shell.subnav([
      { label: "스터디", items: [{ key: "all", ko: "전체 보기", active: study === "all", count: c.studies.length }]
          .concat(c.studies.map(s => ({
            key: s.id, ko: "Study #" + s.no + " " + s.ko, active: study === s.id,
            color: s.owner === "배양공정팀" ? L.DEPTS.culture.color
                 : s.owner === "정제공정팀" ? L.DEPTS.purif.color : L.DEPTS.analysis.color
          }))) },
      { label: "바로가기", items: [
          { ko: "EBR 데이터 입력", href: "ebr.html" },
          { ko: "DoE & Intelligence", href: "hub.html" },
          { ko: "장비 예약", href: "booking.html" }
        ] }
    ], key => { study = key; paintAll(); });
  }

  /* ── Team KPI cards ─────────────────────────────────────────────────── */
  function teamCards(c) {
    const best = c.batches.slice().sort((a, b) => b.titer - a.titer)[0];
    const bestP = c.purif.slice().sort((a, b) => b.recovery - a.recovery)[0];
    const lowHcp = c.purif.slice().sort((a, b) => a.hcp - b.hcp)[0];

    const flat = [];
    c.analyses.forEach(a => Object.keys(a.results || {}).forEach(k =>
      flat.push({ k, v: a.results[k], j: L.judge(k, a.results[k]), sample: a.sample })));
    const sec = flat.filter(f => f.k === "SEC_monomer").sort((x, y) => y.v - x.v)[0];
    const cex = flat.filter(f => f.k === "CEX_main")[0];

    const card = (dept, metrics, foot) => {
      const d = L.DEPTS[dept];
      return '<section class="card team-card" style="--team:' + d.color + '">' +
        '<div class="team-head">' +
          '<div><div class="team-name">' + esc(d.ko) + '</div>' +
          '<div style="font-size:11px;color:var(--c-text-mute)">' + esc(d.en) + '</div></div>' +
          foot +
        '</div>' +
        '<div class="team-metrics">' + metrics.map(m =>
          '<div class="team-metric">' +
            '<span class="team-metric-k">' + esc(m.k) + '</span>' +
            '<span class="team-metric-v">' + esc(m.v) +
              (m.u ? '<span class="team-metric-u">' + esc(m.u) + '</span>' : "") + '</span>' +
          '</div>').join("") + '</div>' +
      '</section>';
    };

    return card("culture", [
      { k: "Titer", v: best ? best.titer : "—", u: "g/L" },
      { k: "Peak VCD", v: best ? best.peakVCD : "—", u: "×10⁶/mL" },
      { k: "Viability", v: best ? best.viability : "—", u: "%" }
    ], '<span class="badge">' + c.batches.length + ' 배치</span>') +

    card("purif", [
      { k: "Step Yield", v: bestP ? bestP.recovery : "—", u: "%" },
      { k: "HCP", v: lowHcp ? lowHcp.hcp : "—", u: "ng/mg" },
      { k: "잔류 DNA", v: lowHcp ? lowHcp.hcd : "—", u: "pg/mg" }
    ], '<span class="badge">' + c.purif.length + ' 런</span>') +

    card("analysis", [
      { k: "SEC Monomer", v: sec ? sec.v : "—", u: "%" },
      { k: "CEX Main Peak", v: cex ? cex.v : "—", u: "%" },
      { k: "N-glycan G0F", v: L.GLYCAN[0].sample, u: "%" }
    ], c.oos.length
        ? '<span class="spec spec-oos">OOS ' + c.oos.length + '</span>'
        : '<span class="spec spec-pass">PASS</span>');
  }

  /* ── Overlay trend ──────────────────────────────────────────────────── */
  function overlaySection(c) {
    const latest = c.batches[c.batches.length - 1];
    if (!latest) return '<div class="empty"><div class="empty-title">배치 데이터가 없습니다</div>' +
      '<div class="empty-body">EBR 입력에서 배양 배치를 생성하세요.</div>' +
      '<a class="btn btn-accent btn-sm" href="ebr.html">EBR 입력으로 이동</a></div>';

    const rows = S.cultureRows(latest.id);
    const dates = rows.map(r => S.addDays(latest.inoc, r.day));
    const series = [
      { name: "VCD (×10⁶/mL)", color: L.DEPTS.culture.color, data: rows.map(r => r.vcd) },
      { name: "Titer (g/L, 우축)", color: "#6D28D9", right: true, data: rows.map(r => r.titer) },
      { name: "생존율 (%)", color: L.DEPTS.analysis.color, dash: true, data: rows.map(r => r.via) }
    ];
    const marks = []
      .concat(c.purif.map(r => ({ date: r.date, color: L.DEPTS.purif.color, short: "정" })))
      .concat(c.analyses.map(a => ({ date: a.date, color: L.DEPTS.analysis.color, short: "분" })))
      .filter(m => dates.indexOf(m.date) > -1);

    return '<div class="card-body">' +
      '<div style="display:flex;flex-wrap:wrap;gap:var(--s-4);justify-content:space-between;' +
                  'align-items:center;margin-bottom:var(--s-4)">' +
        C.legend(series) +
        '<div style="display:flex;gap:var(--s-3);font-size:11.5px;color:var(--c-text-mute)">' +
          '<span style="display:flex;align-items:center;gap:5px"><span style="width:14px;height:14px;' +
            'border-radius:50%;background:' + L.DEPTS.purif.color + ';color:#fff;font-size:8px;font-weight:700;' +
            'display:inline-flex;align-items:center;justify-content:center">정</span>정제 수행</span>' +
          '<span style="display:flex;align-items:center;gap:5px"><span style="width:14px;height:14px;' +
            'border-radius:50%;background:' + L.DEPTS.analysis.color + ';color:#fff;font-size:8px;font-weight:700;' +
            'display:inline-flex;align-items:center;justify-content:center">분</span>분석 수행</span>' +
        '</div>' +
      '</div>' +
      '<div class="chart-wrap">' +
        C.overlay({ dates, series, marks, h: 300, w: 780,
                    aria: latest.id + " 배양 추이와 정제·분석 시점 오버레이" }) +
      '</div>' +
      C.dataTable(latest.id + " 일자별 데이터", ["일자", "VCD", "Titer", "생존율"],
        rows.map((r, i) => [dates[i], r.vcd, r.titer, r.via])) +
      '<p style="font-size:11.5px;color:var(--c-text-mute);margin:var(--s-3) 0 0">' +
        '배양은 연속 데이터, 정제·분석은 수행 시점 표식으로 겹쳐 표시합니다 — 세 팀의 작업 주기가 다르기 때문입니다.</p>' +
    '</div>';
  }

  /* ── Activity feed ──────────────────────────────────────────────────── */
  function activity(c) {
    const items = []
      .concat(c.batches.map(b => ({ d: b.inoc, ko: b.id + " 접종 (" + b.scale + ")", dept: "culture", st: b.status })))
      .concat(c.purif.map(r => ({ d: r.date, ko: r.id + " 정제 · " + r.resin, dept: "purif", st: r.status || "완료" })))
      .concat(c.analyses.map(a => ({ d: a.date, ko: a.id + " " + a.method + " 분석", dept: "analysis", st: "완료" })))
      .sort((a, b) => b.d.localeCompare(a.d)).slice(0, 8);

    return items.map(i =>
      '<div class="rail-event">' +
        '<span class="rail-event-bar" style="background:' + L.DEPTS[i.dept].color + '"></span>' +
        '<span style="min-width:0;flex:1">' +
          '<span style="display:block;font-size:12.5px;font-weight:500">' + esc(i.ko) + '</span>' +
          '<span style="display:flex;gap:6px;align-items:center;margin-top:3px">' +
            '<span class="badge" style="font-size:10px">' + esc(L.DEPTS[i.dept].short) + '</span>' +
            '<span class="mono" style="font-size:10.5px;color:var(--c-text-mute)">' + esc(i.d) + '</span>' +
          '</span>' +
        '</span>' +
        '<span class="badge badge-' + (i.st === "완료" ? "ok" : "info") + '" style="font-size:10px">' +
          esc(i.st) + '</span>' +
      '</div>').join("") || '<p style="font-size:12.5px;color:var(--c-text-mute)">활동 내역이 없습니다.</p>';
  }

  /* ── Paint ──────────────────────────────────────────────────────────── */
  function paintAll() {
    const c = ctx();
    paintSubnav();

    $("#page-title").textContent = c.p.id + " · " + c.p.ko;
    $("#page-sub").textContent = c.p.molecule + " · 책임 " + c.p.lead + " · " + c.p.stage;

    $("#study-tabs").innerHTML =
      '<button class="track-tab" data-st="all" aria-selected="' + (study === "all") + '" ' +
        'style="min-height:38px;padding:0 var(--s-4)">전체</button>' +
      c.studies.map(s =>
        '<button class="track-tab" data-st="' + s.id + '" aria-selected="' + (study === s.id) + '" ' +
          'style="min-height:38px;padding:0 var(--s-4)">Study #' + s.no +
          '<span style="font-weight:400"> · ' + esc(s.ko) + '</span></button>').join("");
    $$("[data-st]").forEach(b => b.addEventListener("click", () => { study = b.dataset.st; paintAll(); }));

    $("#studies").innerHTML = studyCards(c);
    $$("[data-study-open]").forEach(b =>
      b.addEventListener("click", () => window.StudyModal.open(b.dataset.studyOpen)));

    $("#teams").innerHTML = teamCards(c);
    $("#overlay").innerHTML = overlaySection(c);
    $("#activity").innerHTML = activity(c);

    $("#oos-banner").innerHTML = c.oos.length
      ? '<div class="card" style="border-left:3px solid var(--c-risk);background:#FEF6F6">' +
          '<div class="card-body" style="display:flex;gap:var(--s-4);align-items:center;flex-wrap:wrap">' +
            '<span class="spec spec-oos" style="font-size:13px">OOS ' + c.oos.length + '건</span>' +
            '<span style="font-size:13px;flex:1;min-width:200px">' +
              c.oos.map(x => esc(x.sample) + " " + esc(x.ko) + " " + x.value + esc(x.unit)).join(" · ") +
            '</span>' +
            '<a class="btn btn-ghost btn-sm" href="ebr.html#analysis">분석 데이터 확인</a>' +
          '</div></div>'
      : "";
  }

  $("#meeting-btn").addEventListener("click", () => window.Meeting.open(window.Shell.project()));
  window.Shell.on("project", () => { study = "all"; paintAll(); });
  window.Store.subscribe(() => paintAll());

  paintAll();
})();
