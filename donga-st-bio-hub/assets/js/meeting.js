/* ==========================================================================
   Meeting Mode — presentation view for the weekly cross-team review

   Design intent: a projected meeting is a different medium from a desktop
   dashboard. Chrome disappears, type scales up, one topic occupies the screen,
   and the only interactions are ones a presenter can perform while talking —
   arrow keys, a click to spotlight a number, a two-field note.

   What it does beyond "hide the sidebar":
     · Agenda-driven sections with progress and per-section budgets
     · A timer that warns when a section runs over its allotted minutes
     · Feedback memos anchored to the exact metric under discussion
     · One-click promotion of a memo into an action item with owner and due date
     · A closing slide that compiles the memos and actions into minutes you can
       copy straight into an email

   Notes and actions persist through Store, so they survive the meeting.
   ========================================================================== */

window.Meeting = (function () {
  "use strict";

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  let L, S, C;
  let prj = null, idx = 0, on = false;
  let drawerTab = "notes", drawerOpen = true;
  let anchor = null;                 // spotlighted metric, attaches to the next note
  let tStart = 0, tSection = 0, spent = {}, tick = null;
  let lastFocus = null;

  /* ── Open / close ───────────────────────────────────────────────────── */

  function open(projectId) {
    L = window.LAB; S = window.Store; C = window.Charts;
    prj = projectId;
    idx = 0; anchor = null; spent = {};
    tStart = Date.now(); tSection = Date.now();
    on = true;
    lastFocus = document.activeElement;

    document.body.classList.add("mm-open");
    $("#mm").classList.add("is-on");
    render();
    tick = setInterval(paintTimer, 1000);
    document.addEventListener("keydown", onKey, true);
    setTimeout(() => { const b = $("#mm-next"); if (b) b.focus(); }, 40);
  }

  function close() {
    on = false;
    clearInterval(tick);
    document.body.classList.remove("mm-open");
    $("#mm").classList.remove("is-on");
    document.removeEventListener("keydown", onKey, true);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    if (window.Shell) window.Shell.paintRail();
  }

  /* ── Keyboard ───────────────────────────────────────────────────────── */

  function onKey(e) {
    if (!on) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ""));
    if (e.key === "Escape") {
      if ($("#mm-help").classList.contains("is-on")) { toggleHelp(false); e.preventDefault(); return; }
      if (typing) { e.target.blur(); e.preventDefault(); return; }
      close(); e.preventDefault(); return;
    }
    if (typing) return;

    if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { go(idx + 1); e.preventDefault(); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { go(idx - 1); e.preventDefault(); }
    else if (e.key === "Home") { go(0); e.preventDefault(); }
    else if (e.key === "End") { go(L.AGENDA.length); e.preventDefault(); }
    else if (/^[1-9]$/.test(e.key)) { go(+e.key - 1); e.preventDefault(); }
    else if (e.key === "n" || e.key === "ㅜ") { focusNote(); e.preventDefault(); }
    else if (e.key === "d" || e.key === "ㅇ") { toggleDrawer(); e.preventDefault(); }
    else if (e.key === "?" || e.key === "/") { toggleHelp(); e.preventDefault(); }
  }

  function go(n) {
    const max = L.AGENDA.length;           // last index = summary slide
    const next = Math.max(0, Math.min(max, n));
    if (next === idx) return;
    spent[idx] = (spent[idx] || 0) + (Date.now() - tSection);
    tSection = Date.now();
    idx = next;
    anchor = null;
    render();
    const stage = $("#mm-stage");
    if (stage) stage.scrollTop = 0;
  }

  /* ── Timer ──────────────────────────────────────────────────────────── */

  function mmss(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  }

  function paintTimer() {
    if (!on) return;
    const el = $("#mm-timer"), tot = $("#mm-total");
    if (!el) return;
    const sec = L.AGENDA[idx];
    const elapsed = (spent[idx] || 0) + (Date.now() - tSection);
    el.textContent = mmss(elapsed);
    if (sec) {
      const budget = sec.mins * 60000;
      el.setAttribute("data-warn", elapsed > budget ? "over" : elapsed > budget * 0.8 ? "soon" : "ok");
      el.title = sec.ko + " 배정 " + sec.mins + "분";
    } else {
      el.removeAttribute("data-warn");
    }
    if (tot) tot.textContent = "전체 " + mmss(Date.now() - tStart);
  }

  /* ── Data for the current project ───────────────────────────────────── */

  function ctx() {
    const p = L.PROJECTS.find(x => x.id === prj) || L.PROJECTS[0];
    const studies = L.STUDIES.filter(s => s.prj === p.id);
    const studyIds = studies.map(s => s.id);
    const batches = S.batches().filter(b => b.prj === p.id);
    const purif = S.purifRuns().filter(r => studyIds.indexOf(r.study) > -1 ||
      batches.some(b => b.id === r.batch));
    const analyses = S.analyses().filter(a => studyIds.indexOf(a.study) > -1 ||
      purif.some(r => r.id === a.sample));
    return { p, studies, batches, purif, analyses, oos: S.oosItems(p.id) };
  }

  /* ── Render ─────────────────────────────────────────────────────────── */

  function render() {
    if (!on) return;
    const c = ctx();
    const sec = L.AGENDA[idx];
    const total = L.AGENDA.length + 1;

    $("#mm-title").textContent = c.p.id + " · " + c.p.ko;
    $("#mm-sub").textContent = sec
      ? (idx + 1) + " / " + total + " · " + sec.ko + " (배정 " + sec.mins + "분)"
      : total + " / " + total + " · 회의록 정리";
    $("#mm-progress-fill").style.width = (((idx + 1) / total) * 100) + "%";

    $("#mm-stage").innerHTML = sec ? slide(sec.id, c) : summary(c);
    $("#mm-pills").innerHTML = L.AGENDA.map((a, i) =>
      '<button class="mm-pill' + (i < idx ? " mm-pill-done" : "") + '" data-go="' + i + '"' +
        (i === idx ? ' aria-current="true"' : "") + '>' + esc(a.ko) + '</button>').join("") +
      '<button class="mm-pill" data-go="' + L.AGENDA.length + '"' +
        (idx === L.AGENDA.length ? ' aria-current="true"' : "") + '>회의록</button>';

    $("#mm-prev").disabled = idx === 0;
    $("#mm-next").textContent = idx >= L.AGENDA.length ? "종료" : "다음 →";

    $$("[data-go]").forEach(b => b.addEventListener("click", () => go(+b.dataset.go)));
    $$("[data-anchor]").forEach(b => b.addEventListener("click", () => {
      const a = b.dataset.anchor;
      anchor = (anchor === a) ? null : a;
      $$("[data-anchor]").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.anchor === anchor)));
      paintDrawer();
    }));

    paintDrawer();
    paintTimer();
  }

  /* ── Slides ─────────────────────────────────────────────────────────── */

  function slide(id, c) {
    if (id === "overview") return sOverview(c);
    if (id === "culture")  return sCulture(c);
    if (id === "purif")    return sPurif(c);
    if (id === "analysis") return sAnalysis(c);
    if (id === "issues")   return sIssues(c);
    return "";
  }

  function kpi(k, v, u, delta, anchorKey) {
    return '<button class="mm-kpi" data-anchor="' + esc(anchorKey) + '" aria-pressed="' +
      (anchor === anchorKey) + '" title="클릭하면 이 지표에 메모를 연결합니다">' +
      '<div class="mm-kpi-k">' + esc(k) + '</div>' +
      '<div class="mm-kpi-v">' + esc(v) + (u ? '<span class="mm-kpi-u">' + esc(u) + '</span>' : "") + '</div>' +
      (delta ? '<div class="mm-kpi-d" style="color:' + delta.color + '">' + esc(delta.text) + '</div>' : "") +
      '</button>';
  }

  function sOverview(c) {
    const done = c.studies.filter(s => s.status === "완료").length;
    return '<p class="mm-eyebrow">Overview</p>' +
      '<h2>' + esc(c.p.ko) + '</h2>' +
      '<p style="font-size:16px;color:var(--c-text-mute);margin:0 0 var(--s-8)">' +
        esc(c.p.molecule) + ' · 책임 ' + esc(c.p.lead) + ' · ' + esc(c.p.stage) + '</p>' +

      '<div class="mm-kpis" style="margin-bottom:var(--s-8)">' +
        kpi("진행 스터디", c.studies.length - done, "건", null, "ov-study") +
        kpi("배양 배치", c.batches.length, "건", null, "ov-batch") +
        kpi("정제 런", c.purif.length, "건", null, "ov-purif") +
        kpi("규격 이탈", c.oos.length, "건",
            c.oos.length ? { text: "검토 필요", color: "var(--c-risk)" } : { text: "이상 없음", color: "var(--c-ok)" },
            "ov-oos") +
      '</div>' +

      '<h3>스터디 현황</h3>' +
      '<table class="mm-table"><thead><tr><th>스터디</th><th>담당</th><th>기간</th><th>상태</th></tr></thead><tbody>' +
      c.studies.map(s =>
        '<tr><td><strong>Study #' + s.no + '</strong> · ' + esc(s.ko) + '<br>' +
          '<span style="font-size:13px;color:var(--c-text-mute)">' + esc(s.en) + '</span></td>' +
          '<td>' + esc(s.owner) + '</td>' +
          '<td class="mono" style="font-size:13px">' + esc(s.start) + ' ~ ' + esc(s.end) + '</td>' +
          '<td><span class="badge badge-' + (s.status === "진행중" ? "info" : s.status === "완료" ? "ok" : "warn") +
          '"><span class="badge-dot"></span>' + esc(s.status) + '</span></td></tr>').join("") +
      '</tbody></table>';
  }

  function sCulture(c) {
    const bs = c.batches;
    const latest = bs[bs.length - 1];
    const best = bs.slice().sort((a, b) => b.titer - a.titer)[0];
    const rows = latest ? S.cultureRows(latest.id) : [];
    const series = [
      { name: "VCD (×10⁶/mL)", color: "var(--c-accent-bright)", data: rows.map(r => r.vcd) },
      { name: "Titer (g/L, 우축)", color: "#6D28D9", right: true, data: rows.map(r => r.titer) },
      { name: "생존율 (%)", color: "#0F766E", dash: true, data: rows.map(r => r.via) }
    ];

    return '<p class="mm-eyebrow">Cultivation · 배양공정팀</p>' +
      '<h2>배양 공정 결과</h2>' +
      '<div class="mm-kpis" style="margin:var(--s-6) 0 var(--s-8)">' +
        kpi("최고 Titer", best ? best.titer : "—", "g/L",
            best ? { text: best.id, color: "var(--c-text-mute)" } : null, "cu-titer") +
        kpi("Peak VCD", best ? best.peakVCD : "—", "×10⁶/mL", null, "cu-vcd") +
        kpi("최종 생존율", best ? best.viability : "—", "%", null, "cu-via") +
      '</div>' +

      '<h3>' + (latest ? esc(latest.id) + " 일자별 추이" : "추이") + '</h3>' +
      C.legend(series, true) +
      '<div style="margin-top:var(--s-4)">' +
        C.line({ x: rows.map(r => "D" + r.day), series, right: true, h: 300, w: 900, big: true,
                 aria: "일자별 VCD, Titer, 생존율 추이" }) +
      '</div>' +
      C.dataTable("일자별 배양 데이터", ["Day", "VCD", "Titer", "생존율"],
        rows.map(r => ["D" + r.day, r.vcd, r.titer, r.via])) +

      '<h3 style="margin-top:var(--s-8)">배치 비교</h3>' +
      '<table class="mm-table"><thead><tr><th>Batch</th><th>스케일</th><th>접종일</th>' +
        '<th>Peak VCD</th><th>Titer</th><th>상태</th></tr></thead><tbody>' +
      bs.map(b =>
        '<tr><td class="mono"><strong>' + esc(b.id) + '</strong></td><td>' + esc(b.scale) + '</td>' +
        '<td class="mono">' + esc(b.inoc) + '</td><td class="mono">' + b.peakVCD + '</td>' +
        '<td class="mono"><strong>' + b.titer + '</strong> g/L</td>' +
        '<td><span class="badge badge-' + (b.status === "완료" ? "ok" : "info") + '">' + esc(b.status) + '</span></td></tr>').join("") +
      '</tbody></table>';
  }

  function sPurif(c) {
    const rs = c.purif;
    const best = rs.slice().sort((a, b) => b.recovery - a.recovery)[0];
    const lowestHcp = rs.slice().sort((a, b) => a.hcp - b.hcp)[0];

    return '<p class="mm-eyebrow">Purification · 정제공정팀</p>' +
      '<h2>정제 공정 결과</h2>' +
      '<div class="mm-kpis" style="margin:var(--s-6) 0 var(--s-8)">' +
        kpi("최고 회수율", best ? best.recovery : "—", "%",
            best ? { text: best.resin, color: "var(--c-text-mute)" } : null, "pu-rec") +
        kpi("최저 HCP", lowestHcp ? lowestHcp.hcp : "—", "ng/mg",
            lowestHcp ? { text: lowestHcp.id, color: "var(--c-text-mute)" } : null, "pu-hcp") +
        kpi("정제 런", rs.length, "건", null, "pu-n") +
      '</div>' +

      '<h3>Resin 스크리닝 결과</h3>' +
      '<table class="mm-table"><thead><tr><th>Run</th><th>Resin</th><th>CV</th><th>Flow</th>' +
        '<th>회수율</th><th>HCP</th><th>잔류 DNA</th></tr></thead><tbody>' +
      rs.map(r =>
        '<tr><td class="mono"><strong>' + esc(r.id) + '</strong></td><td>' + esc(r.resin) + '</td>' +
        '<td class="mono">' + r.cv + ' CV</td><td class="mono">' + r.flow + ' cm/h</td>' +
        '<td class="mono"><strong>' + r.recovery + '</strong> %</td>' +
        '<td class="mono">' + r.hcp + '</td><td class="mono">' + r.hcd + '</td></tr>').join("") +
      '</tbody></table>' +

      '<h3 style="margin-top:var(--s-8)">회수율 비교</h3>' +
      '<div style="display:grid;gap:var(--s-4);max-width:760px">' +
      rs.map(r =>
        '<div><div style="display:flex;justify-content:space-between;font-size:15px;margin-bottom:6px">' +
          '<span><strong class="mono">' + esc(r.id) + '</strong> <span style="color:var(--c-text-mute)">' +
          esc(r.resin) + '</span></span>' +
          '<span class="mono"><strong>' + r.recovery + '</strong> %</span></div>' +
        '<div style="height:14px;background:var(--c-paper-2);border-radius:7px;overflow:hidden">' +
          '<div style="height:100%;width:' + r.recovery + '%;background:#6D28D9;border-radius:7px"></div>' +
        '</div></div>').join("") + '</div>';
  }

  function sAnalysis(c) {
    const flat = [];
    c.analyses.forEach(a => {
      Object.keys(a.results || {}).forEach(k => {
        const j = L.judge(k, a.results[k]);
        flat.push({ a, k, v: a.results[k], j });
      });
    });
    const monomer = flat.filter(f => f.k === "SEC_monomer").sort((x, y) => y.v - x.v)[0];
    const cex = flat.filter(f => f.k === "CEX_main")[0];

    return '<p class="mm-eyebrow">Bioanalysis · 바이오분석팀</p>' +
      '<h2>분석 결과</h2>' +
      '<div class="mm-kpis" style="margin:var(--s-6) 0 var(--s-8)">' +
        kpi("SEC Monomer", monomer ? monomer.v : "—", "%",
            monomer ? { text: monomer.j.pass ? "규격 적합" : "규격 이탈",
                        color: monomer.j.pass ? "var(--c-ok)" : "var(--c-risk)" } : null, "an-sec") +
        kpi("CEX Main Peak", cex ? cex.v : "—", "%",
            cex ? { text: cex.j.pass ? "규격 적합" : "규격 이탈 (55–70)",
                    color: cex.j.pass ? "var(--c-ok)" : "var(--c-risk)" } : null, "an-cex") +
        kpi("규격 이탈", c.oos.length, "건", null, "an-oos") +
      '</div>' +

      '<h3>항목별 결과 vs 규격</h3>' +
      '<table class="mm-table"><thead><tr><th>시료</th><th>분석 항목</th><th>결과</th>' +
        '<th>규격</th><th>판정</th></tr></thead><tbody>' +
      flat.map(f =>
        '<tr' + (f.j && !f.j.pass ? ' data-oos="1"' : "") + '>' +
        '<td class="mono">' + esc(f.a.sample) + '</td>' +
        '<td>' + esc(L.SPECS[f.k] ? L.SPECS[f.k].ko : f.k) + '</td>' +
        '<td class="mono"><strong>' + f.v + '</strong> ' + (f.j ? esc(f.j.unit) : "") + '</td>' +
        '<td class="mono" style="color:var(--c-text-mute)">' + (f.j ? esc(f.j.spec) : "—") + '</td>' +
        '<td>' + (f.j ? '<span class="spec ' + (f.j.pass ? "spec-pass" : "spec-oos") + '">' +
          (f.j.pass ? "PASS" : "OOS") + '</span>' : '<span class="spec spec-none">—</span>') + '</td></tr>').join("") +
      '</tbody></table>' +

      '<h3 style="margin-top:var(--s-8)">N-glycan 프로파일 · 대조약 비교</h3>' +
      '<div style="display:flex;gap:var(--s-5);font-size:14px;margin-bottom:var(--s-3)">' +
        '<span style="display:flex;align-items:center;gap:6px"><span style="width:14px;height:14px;' +
          'border-radius:3px;background:var(--c-accent-bright)"></span>DA-3880</span>' +
        '<span style="display:flex;align-items:center;gap:6px"><span style="width:14px;height:14px;' +
          'border-radius:3px;background:var(--c-navy-400)"></span>대조약 (Reference)</span>' +
      '</div>' +
      C.pairedBars(L.GLYCAN, { h: 250, w: 820, big: true, aria: "N-glycan 프로파일 시료 대 대조약 비교" }) +
      C.dataTable("N-glycan 프로파일", ["항목", "시료 (%)", "대조약 (%)"],
        L.GLYCAN.map(g => [g.ko, g.sample, g.ref]));
  }

  function sIssues(c) {
    const notes = S.notesFor(prj);
    const actions = S.actionsFor(prj);
    return '<p class="mm-eyebrow">Issues &amp; Actions</p>' +
      '<h2>이슈 및 후속 조치</h2>' +

      '<h3 style="margin-top:var(--s-6)">규격 이탈 (OOS) ' +
        (c.oos.length ? '<span class="spec spec-oos" style="font-size:13px">' + c.oos.length + '건</span>' :
                        '<span class="spec spec-pass" style="font-size:13px">없음</span>') + '</h3>' +
      (c.oos.length
        ? '<table class="mm-table"><thead><tr><th>시료</th><th>항목</th><th>결과</th><th>규격</th><th>일자</th></tr></thead><tbody>' +
          c.oos.map(x =>
            '<tr data-oos="1"><td class="mono">' + esc(x.sample) + '</td><td>' + esc(x.ko) + '</td>' +
            '<td class="mono"><strong>' + x.value + '</strong> ' + esc(x.unit) + '</td>' +
            '<td class="mono">' + esc(x.spec) + '</td><td class="mono">' + esc(x.date) + '</td></tr>').join("") +
          '</tbody></table>'
        : '<p style="font-size:16px;color:var(--c-text-mute)">이번 주 규격을 벗어난 항목은 없습니다.</p>') +

      '<h3 style="margin-top:var(--s-8)">회의 중 기록된 메모 (' + notes.length + ')</h3>' +
      (notes.length
        ? '<div style="display:grid;gap:var(--s-3);max-width:820px">' + notes.map(n =>
            '<div style="padding:var(--s-4);background:var(--c-paper);border-left:3px solid var(--c-accent-mid);' +
              'border-radius:var(--r-md)">' +
              '<div style="font-size:15px">' + esc(n.text) + '</div>' +
              '<div style="font-size:12px;color:var(--c-text-mute);margin-top:6px">' +
                esc(sectionName(n.section)) + (n.anchor ? " · " + esc(anchorName(n.anchor)) : "") +
                ' · ' + esc(n.author) + '</div>' +
            '</div>').join("") + '</div>'
        : '<p style="font-size:15px;color:var(--c-text-mute)">아직 메모가 없습니다. ' +
          '우측 패널이나 <span class="kbd">N</span> 키로 추가할 수 있습니다.</p>') +

      '<h3 style="margin-top:var(--s-8)">액션 아이템 (' + actions.length + ')</h3>' +
      (actions.length
        ? '<table class="mm-table"><thead><tr><th>내용</th><th>담당</th><th>기한</th><th>상태</th></tr></thead><tbody>' +
          actions.map(a =>
            '<tr><td>' + esc(a.text) + '</td><td>' + esc(a.owner) + '</td>' +
            '<td class="mono">' + esc(a.due || "—") + '</td>' +
            '<td><span class="badge badge-' + (a.done ? "ok" : "warn") + '">' +
              (a.done ? "완료" : "진행") + '</span></td></tr>').join("") +
          '</tbody></table>'
        : '<p style="font-size:15px;color:var(--c-text-mute)">액션 아이템이 없습니다.</p>');
  }

  /* ── Closing slide: minutes ─────────────────────────────────────────── */

  function summary(c) {
    const notes = S.notesFor(prj);
    const actions = S.actionsFor(prj);
    const totalMs = Date.now() - tStart;
    const perSection = L.AGENDA.map((a, i) => {
      const ms = (spent[i] || 0) + (i === idx ? Date.now() - tSection : 0);
      return { ko: a.ko, ms, budget: a.mins * 60000 };
    });

    return '<p class="mm-eyebrow">Minutes</p>' +
      '<h2>회의록</h2>' +
      '<p style="font-size:16px;color:var(--c-text-mute);margin:0 0 var(--s-6)">' +
        esc(c.p.id) + ' · ' + S.today() + ' · 총 ' + mmss(totalMs) + '</p>' +

      '<div class="mm-kpis" style="margin-bottom:var(--s-8)">' +
        kpi("논의 시간", mmss(totalMs), "", null, "su-time") +
        kpi("기록된 메모", notes.length, "건", null, "su-notes") +
        kpi("액션 아이템", actions.length, "건", null, "su-actions") +
        kpi("미해결 OOS", c.oos.length, "건", null, "su-oos") +
      '</div>' +

      '<h3>섹션별 소요 시간</h3>' +
      '<div style="display:grid;gap:var(--s-3);max-width:700px;margin-bottom:var(--s-8)">' +
      perSection.map(s => {
        const over = s.ms > s.budget;
        const pct = Math.min(100, (s.ms / Math.max(s.budget, 1)) * 100);
        return '<div><div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:5px">' +
          '<span>' + esc(s.ko) + '</span>' +
          '<span class="mono" style="color:' + (over ? "var(--c-risk)" : "var(--c-text-mute)") + '">' +
            mmss(s.ms) + ' / ' + mmss(s.budget) + '</span></div>' +
          '<div style="height:10px;background:var(--c-paper-2);border-radius:5px;overflow:hidden">' +
            '<div style="height:100%;width:' + pct.toFixed(1) + '%;background:' +
            (over ? "var(--c-risk)" : "var(--c-accent-mid)") + ';border-radius:5px"></div></div></div>';
      }).join("") + '</div>' +

      '<h3>공유용 회의록</h3>' +
      '<p style="font-size:14px;color:var(--c-text-mute);margin:0 0 var(--s-3)">' +
        '아래 내용을 그대로 복사해 메일이나 EDMS에 붙여넣을 수 있습니다.</p>' +
      '<pre id="mm-minutes" style="white-space:pre-wrap;font-family:var(--font-data);font-size:13px;' +
        'line-height:1.75;background:var(--c-paper);border:1px solid var(--c-border);border-radius:var(--r-lg);' +
        'padding:var(--s-5);max-width:900px;margin:0">' + esc(minutesText(c, notes, actions, totalMs)) + '</pre>' +
      '<div style="display:flex;gap:var(--s-3);margin-top:var(--s-4)">' +
        '<button class="btn btn-accent" id="mm-copy">회의록 복사</button>' +
        '<button class="btn btn-ghost" id="mm-end">회의 종료</button>' +
      '</div>';
  }

  function minutesText(c, notes, actions, totalMs) {
    const lines = [];
    lines.push("[" + c.p.id + " 주간 공정개발 회의]");
    lines.push("일시: " + S.today() + " · 소요 " + mmss(totalMs));
    lines.push("과제: " + c.p.ko + " (" + c.p.molecule + ")");
    lines.push("");
    lines.push("■ 요약");
    const best = c.batches.slice().sort((a, b) => b.titer - a.titer)[0];
    if (best) lines.push("- 배양: 최고 Titer " + best.titer + " g/L (" + best.id + "), 배치 " + c.batches.length + "건");
    const bp = c.purif.slice().sort((a, b) => b.recovery - a.recovery)[0];
    if (bp) lines.push("- 정제: 최고 회수율 " + bp.recovery + "% (" + bp.resin + "), 런 " + c.purif.length + "건");
    lines.push("- 분석: 규격 이탈 " + c.oos.length + "건");
    lines.push("");
    if (c.oos.length) {
      lines.push("■ 규격 이탈 (OOS)");
      c.oos.forEach(x => lines.push("- " + x.sample + " " + x.ko + " " + x.value + x.unit +
        " (규격 " + x.spec + ", " + x.date + ")"));
      lines.push("");
    }
    if (notes.length) {
      lines.push("■ 논의 메모");
      notes.forEach(n => {
        const where = noteAnchorName(n);
        lines.push("- [" + sectionName(n.section) + (where ? " / " + where : "") +
          (n.armLabel ? " · " + n.armLabel : "") + "] " + n.text + " (" + n.author + ")");
      });
      lines.push("");
    }
    if (actions.length) {
      lines.push("■ 액션 아이템");
      actions.forEach(a => lines.push("- [ " + (a.done ? "완료" : "진행") + " ] " + a.text +
        " / 담당 " + a.owner + " / 기한 " + (a.due || "미정")));
    }
    return lines.join("\n");
  }

  function sectionName(id) {
    const a = L.AGENDA.find(x => x.id === id);
    if (a) return a.ko;
    if (id === "study") return "스터디 태그";      // notes tagged from the study modal
    if (id === "summary") return "회의록";
    return id || "일반";
  }

  /* Anchors are stored as stable keys but must never be shown as keys — a memo
     saying "an-cex" is useless in minutes a week later. */
  const ANCHOR_LABEL = {
    "ov-study": "진행 스터디", "ov-batch": "배양 배치", "ov-purif": "정제 런", "ov-oos": "규격 이탈",
    "cu-titer": "최고 Titer", "cu-vcd": "Peak VCD", "cu-via": "최종 생존율",
    "pu-rec": "최고 회수율", "pu-hcp": "최저 HCP", "pu-n": "정제 런 수",
    "an-sec": "SEC Monomer", "an-cex": "CEX Main Peak", "an-oos": "규격 이탈 건수",
    "su-time": "논의 시간", "su-notes": "메모 수", "su-actions": "액션 수", "su-oos": "미해결 OOS"
  };
  /* Study-modal notes carry a human metricLabel already; fall back to the
     agenda anchor map for notes created inside meeting mode. */
  function anchorName(a) { return a ? (ANCHOR_LABEL[a] || a) : ""; }
  function noteAnchorName(n) { return n.metricLabel || anchorName(n.anchor); }

  /* ── Drawer: notes + actions ────────────────────────────────────────── */

  function toggleDrawer(force) {
    drawerOpen = force == null ? !drawerOpen : force;
    $("#mm-body").setAttribute("data-drawer", drawerOpen ? "1" : "0");
    $("#mm-drawer-btn").setAttribute("aria-pressed", String(drawerOpen));
  }

  function focusNote() {
    toggleDrawer(true);
    drawerTab = "notes";
    paintDrawer();
    const t = $("#mm-note-text");
    if (t) t.focus();
  }

  function paintDrawer() {
    const notes = S.notesFor(prj);
    const actions = S.actionsFor(prj);
    const sec = L.AGENDA[idx];

    $("#mm-drawer-tabs").innerHTML =
      '<button class="mm-drawer-tab" data-tab="notes" aria-selected="' + (drawerTab === "notes") + '">' +
        '메모 (' + notes.length + ')</button>' +
      '<button class="mm-drawer-tab" data-tab="actions" aria-selected="' + (drawerTab === "actions") + '">' +
        '액션 (' + actions.length + ')</button>';

    if (drawerTab === "notes") {
      $("#mm-drawer-body").innerHTML = notes.length
        ? notes.slice().reverse().map(n =>
            '<div class="mm-note">' +
              '<div>' + esc(n.text) + '</div>' +
              '<div class="mm-note-meta">' +
                (noteAnchorName(n) ? '<span class="mm-note-anchor">' + esc(noteAnchorName(n)) + '</span>' : "") +
                '<span>' + esc(sectionName(n.section)) + ' · ' + esc(n.author) + '</span>' +
                '<button class="btn-icon" data-toact="' + n.id + '" aria-label="액션 아이템으로 전환" ' +
                  'title="액션으로 전환" style="width:26px;height:26px;margin-left:auto">' +
                  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                  'stroke-width="2.4" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>' +
                '<button class="btn-icon" data-delnote="' + n.id + '" aria-label="메모 삭제" ' +
                  'style="width:26px;height:26px">' +
                  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                  'stroke-width="2.4" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
              '</div></div>').join("")
        : '<p style="font-size:12.5px;color:var(--c-text-mute)">아직 메모가 없습니다. ' +
          '지표를 클릭해 선택한 뒤 메모를 남기면 해당 수치에 연결됩니다.</p>';

      $("#mm-drawer-foot").innerHTML =
        (anchor ? '<div style="font-size:11px;color:var(--c-accent);margin-bottom:6px">' +
          '연결 대상: <strong>' + esc(anchorName(anchor)) + '</strong> ' +
          '<button id="mm-clear-anchor" style="background:none;border:0;color:var(--c-text-mute);' +
          'cursor:pointer;text-decoration:underline;font-size:11px">해제</button></div>' : "") +
        '<label class="sr-only" for="mm-note-text">메모 내용</label>' +
        '<textarea id="mm-note-text" class="input" rows="2" style="min-height:60px;padding:8px 10px;' +
          'font-size:12.5px;resize:vertical" placeholder="' +
          esc((sec ? sec.ko : "회의") + " 관련 메모… (N)") + '"></textarea>' +
        '<button class="btn btn-accent btn-sm" id="mm-note-add" style="width:100%;margin-top:6px">메모 추가</button>';

      const add = () => {
        const t = $("#mm-note-text");
        const v = t.value.trim();
        if (!v) { t.focus(); return; }
        S.addNote({ prj, section: sec ? sec.id : "summary", text: v,
                    author: (window.Auth.current() || {}).name || "—", anchor });
        t.value = "";
        anchor = null;
        $$("[data-anchor]").forEach(x => x.setAttribute("aria-pressed", "false"));
        paintDrawer();
        if (idx >= L.AGENDA.length) render();
        $("#mm-note-text").focus();
      };
      $("#mm-note-add").addEventListener("click", add);
      $("#mm-note-text").addEventListener("keydown", e => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); add(); }
      });
      const ca = $("#mm-clear-anchor");
      if (ca) ca.addEventListener("click", () => {
        anchor = null;
        $$("[data-anchor]").forEach(x => x.setAttribute("aria-pressed", "false"));
        paintDrawer();
      });

      $$("[data-delnote]").forEach(b => b.addEventListener("click", () => {
        S.removeNote(b.dataset.delnote); paintDrawer(); if (idx >= L.AGENDA.length - 1) render();
      }));
      $$("[data-toact]").forEach(b => b.addEventListener("click", () => {
        const n = notes.find(x => x.id === b.dataset.toact);
        if (!n) return;
        drawerTab = "actions";
        paintDrawer();
        const ta = $("#mm-act-text");
        if (ta) { ta.value = n.text; ta.focus(); }
      }));

    } else {
      $("#mm-drawer-body").innerHTML = actions.length
        ? actions.slice().reverse().map(a =>
            '<div class="mm-action' + (a.done ? " is-done" : "") + '">' +
              '<input type="checkbox" data-act="' + a.id + '"' + (a.done ? " checked" : "") +
                '" style="width:16px;height:16px;margin-top:2px;accent-color:var(--c-accent)" ' +
                'aria-label="' + esc(a.text) + ' 완료 표시">' +
              '<span style="min-width:0;flex:1">' +
                '<span class="mm-action-text" style="display:block">' + esc(a.text) + '</span>' +
                '<span style="display:block;font-size:10.5px;color:var(--c-text-mute);margin-top:4px">' +
                  esc(a.owner) + ' · ' + esc(a.due || "기한 미정") + '</span>' +
              '</span>' +
              '<button class="btn-icon" data-delact="' + a.id + '" aria-label="액션 삭제" style="width:26px;height:26px">' +
                '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                'stroke-width="2.4" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
            '</div>').join("")
        : '<p style="font-size:12.5px;color:var(--c-text-mute)">액션 아이템이 없습니다. ' +
          '메모의 → 버튼으로 전환하거나 아래에서 직접 추가하세요.</p>';

      $("#mm-drawer-foot").innerHTML =
        '<label class="sr-only" for="mm-act-text">액션 내용</label>' +
        '<input class="input" id="mm-act-text" placeholder="액션 내용" style="min-height:36px;font-size:12.5px">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px">' +
          '<label class="sr-only" for="mm-act-owner">담당자</label>' +
          '<select class="input" id="mm-act-owner" style="min-height:36px;font-size:12.5px">' +
            L.TEAM.map(t => '<option>' + esc(t) + '</option>').join("") + '</select>' +
          '<label class="sr-only" for="mm-act-due">기한</label>' +
          '<input class="input mono" id="mm-act-due" type="date" style="min-height:36px;font-size:12px">' +
        '</div>' +
        '<button class="btn btn-accent btn-sm" id="mm-act-add" style="width:100%;margin-top:6px">액션 추가</button>';

      $("#mm-act-add").addEventListener("click", () => {
        const t = $("#mm-act-text"), v = t.value.trim();
        if (!v) { t.focus(); return; }
        S.addAction({ prj, text: v, owner: $("#mm-act-owner").value, due: $("#mm-act-due").value,
                      from: sec ? sec.id : "summary" });
        t.value = "";
        paintDrawer();
        if (idx >= L.AGENDA.length - 1) render();
      });

      $$("[data-act]").forEach(c => c.addEventListener("change", () => {
        S.toggleAction(c.dataset.act); paintDrawer(); if (idx >= L.AGENDA.length - 1) render();
      }));
      $$("[data-delact]").forEach(b => b.addEventListener("click", () => {
        S.removeAction(b.dataset.delact); paintDrawer(); if (idx >= L.AGENDA.length - 1) render();
      }));
    }

    $$("[data-tab]").forEach(b => b.addEventListener("click", () => {
      drawerTab = b.dataset.tab; paintDrawer();
    }));

    // Summary slide buttons live in the stage, wired here so they survive re-render
    const copy = $("#mm-copy");
    if (copy) copy.addEventListener("click", () => {
      const txt = $("#mm-minutes").textContent;
      const done = () => { copy.textContent = "복사됨 ✓"; setTimeout(() => { copy.textContent = "회의록 복사"; }, 1600); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done, () => fallbackCopy(txt, done));
      } else fallbackCopy(txt, done);
    });
    const end = $("#mm-end");
    if (end) end.addEventListener("click", close);
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { /* clipboard unavailable */ }
    document.body.removeChild(ta);
  }

  function toggleHelp(force) {
    const h = $("#mm-help");
    const want = force == null ? !h.classList.contains("is-on") : force;
    h.classList.toggle("is-on", want);
  }

  /* ── Static markup, injected once ───────────────────────────────────── */
  function markup() {
    return '<div class="mm" id="mm" role="dialog" aria-modal="true" aria-label="회의 모드">' +
      '<div class="mm-head">' +
        '<div style="min-width:0;flex:1">' +
          '<div class="mm-title" id="mm-title"></div>' +
          '<div class="mm-sub" id="mm-sub"></div>' +
        '</div>' +
        '<span class="mm-timer" id="mm-timer">00:00</span>' +
        '<span style="font-family:var(--font-data);font-size:12px;color:var(--c-text-mute)" id="mm-total"></span>' +
        '<button class="btn btn-ghost btn-sm" id="mm-drawer-btn" aria-pressed="true">메모 패널</button>' +
        '<button class="btn-icon" id="mm-help-btn" aria-label="단축키 도움말">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
          'aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.2 2.4c-.7.2-1.2.9-1.2 1.6v.5"/>' +
          '<path d="M12 17h.01"/></svg></button>' +
        '<button class="btn btn-ghost btn-sm" id="mm-exit">종료 (Esc)</button>' +
      '</div>' +
      '<div class="mm-progress"><div class="mm-progress-fill" id="mm-progress-fill"></div></div>' +

      '<div class="mm-body" id="mm-body" data-drawer="1">' +
        '<div class="mm-stage" id="mm-stage"></div>' +
        '<aside class="mm-drawer">' +
          '<div class="mm-drawer-tabs" id="mm-drawer-tabs"></div>' +
          '<div class="mm-drawer-body" id="mm-drawer-body"></div>' +
          '<div class="mm-drawer-foot" id="mm-drawer-foot"></div>' +
        '</aside>' +
      '</div>' +

      '<div class="mm-foot">' +
        '<button class="btn btn-ghost" id="mm-prev">← 이전</button>' +
        '<div class="mm-pills" id="mm-pills"></div>' +
        '<button class="btn btn-primary" id="mm-next" style="margin-left:auto">다음 →</button>' +
      '</div>' +

      '<div class="mm-help" id="mm-help">' +
        '<div class="mm-help-card">' +
          '<h3 style="font-size:17px;margin-bottom:var(--s-5)">단축키</h3>' +
          '<div style="display:grid;gap:10px;font-size:13.5px">' +
            [["→ / Space", "다음 섹션"], ["←", "이전 섹션"], ["1 – 6", "섹션 바로가기"],
             ["N", "메모 입력으로 이동"], ["D", "메모 패널 열기/닫기"],
             ["Ctrl + Enter", "메모 저장"], ["?", "이 도움말"], ["Esc", "회의 모드 종료"]].map(r =>
              '<div style="display:flex;justify-content:space-between;gap:var(--s-4);align-items:center">' +
                '<span class="kbd">' + r[0] + '</span><span style="color:var(--c-text-mute)">' + r[1] + '</span></div>').join("") +
          '</div>' +
          '<button class="btn btn-ghost btn-sm" id="mm-help-close" style="width:100%;margin-top:var(--s-6)">닫기</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function install() {
    if (document.getElementById("mm")) return;
    const d = document.createElement("div");
    d.innerHTML = markup();
    document.body.appendChild(d.firstChild);
    $("#mm-exit").addEventListener("click", close);
    $("#mm-prev").addEventListener("click", () => go(idx - 1));
    $("#mm-next").addEventListener("click", () => {
      if (idx >= L.AGENDA.length) close(); else go(idx + 1);
    });
    $("#mm-drawer-btn").addEventListener("click", () => toggleDrawer());
    $("#mm-help-btn").addEventListener("click", () => toggleHelp());
    $("#mm-help-close").addEventListener("click", () => toggleHelp(false));
    $("#mm-help").addEventListener("click", e => { if (e.target.id === "mm-help") toggleHelp(false); });
  }

  return { install, open, close };
})();
