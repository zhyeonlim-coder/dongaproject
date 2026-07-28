/* ==========================================================================
   일정 관리

   화면 구성
     1. 전체 과제 타임라인 (간트)  — 모든 과제를 한 차트에. 항상 맨 위에 둡니다.
     2. 선택 과제 상세 간트          — Study · Batch 단위
     3. 일정 추가                    — 선택한 과제에만 등록
     4. 타임라인 목록                — 월별로 접어서

   일정은 전부 HubCalendar 한 곳에서 옵니다. 우측 미니 캘린더 · 대시보드 ·
   데이터 탐색이 같은 소스를 보므로 화면 간 일정이 어긋나지 않습니다.
   과제별 분리는 유지합니다 — 다른 과제의 일정이 섞이면 안 됩니다.
   ========================================================================== */

(function () {
  "use strict";

  const user = window.Shell.mount({ page: "schedule" });
  if (!user) return;

  const E = window.Entries, C = window.Charts, H = window.HubCalendar;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const KIND = H.KIND;
  const SRC_LABEL = { excel: "Excel 파생", plan: "생성 일정", user: "직접 등록", legacy: "장비 예약" };

  let mode = "project";           // "project" = 과제별 분리(기본) | "all" = 전체 보기

  function paintSubnav() {
    window.Shell.subnav([
      { label: "보기", items: [
        { key: "project", ko: "과제별 분리", active: mode === "project" },
        { key: "all",     ko: "전체 보기",   active: mode === "all" }
      ]},
      { label: "바로가기", items: [
        { ko: "대시보드", href: "dashboard.html" },
        { ko: "EBR 입력", href: "ebr.html" },
        { ko: "데이터 탐색", href: "explorer.html" }
      ]}
    ], k => { mode = k; render(); });
  }

  /* ── 일정 수집 ──────────────────────────────────────────────────────── */

  /* 과제 단위로 일정을 만듭니다. projectId 가 다르면 절대 섞이지 않습니다.
     (전사 공통 일정 — 월간 운영위 등 — 은 projectId 가 없어 항상 포함됩니다) */
  function eventsForScope(scope) {
    return H.filterBy(H.all(), { projectId: scope.id });
  }

  function allScopes() {
    return window.DATA_PROJECTS.map(p => ({ id: p.id, label: p.code || p.name }));
  }

  /* ── 간트 공통 ──────────────────────────────────────────────────────── */

  function monthsBetween(minISO, maxISO) {
    const out = [];
    let y = +minISO.slice(0, 4), m = +minISO.slice(5, 7);
    const ey = +maxISO.slice(0, 4), em = +maxISO.slice(5, 7);
    while (y < ey || (y === ey && m <= em)) {
      out.push({ y, m, key: y + "-" + String(m).padStart(2, "0") });
      m++; if (m > 12) { m = 1; y++; }
      if (out.length > 60) break;             // 안전장치
    }
    return out;
  }

  /* rows: [{ label, start, end, color, isHead, indent }] */
  function ganttChart(rows, opt) {
    const o = opt || {};
    const clean = rows.filter(r => r.start && r.end);
    if (!clean.length) {
      return '<div class="empty"><div class="empty-title">표시할 일정이 없습니다</div></div>';
    }

    const allDates = clean.reduce((a, r) => a.concat([r.start, r.end]), []).sort();
    const min = allDates[0], max = allDates[allDates.length - 1];
    const months = monthsBetween(min, max);

    const t0 = H.parse(min).getTime();
    const t1 = H.parse(max).getTime();
    const span = Math.max(1, t1 - t0);
    const pct = d => ((H.parse(d).getTime() - t0) / span) * 100;

    const today = H.today();
    const showToday = today >= min && today <= max;

    return '<div class="tbl-scroll"><div class="gantt">' +
        '<div class="gantt-head">' +
          '<div class="eyebrow">' + esc(o.nameHead || "항목") + '</div>' +
          '<div class="gantt-months" style="grid-template-columns:repeat(' + months.length + ',1fr)">' +
            months.map(mo => '<span class="gantt-month">' +
              (mo.m === 1 ? mo.y + "년 " : "") + mo.m + '월</span>').join("") +
          '</div></div>' +

        clean.map(r => {
          const left = pct(r.start);
          const width = Math.max(1.2, pct(r.end) - left);
          return '<div class="gantt-row">' +
            '<div class="gantt-name"' +
              (r.isHead ? ' style="font-weight:700"'
                        : ' style="padding-left:' + (r.indent || 12) + 'px;color:var(--c-text-mute)"') + '>' +
              esc(r.label) + '</div>' +
            '<div class="gantt-track">' +
              '<div class="gantt-grid" aria-hidden="true">' +
                months.map(() => '<span></span>').join("") + '</div>' +
              '<div class="gantt-bar" style="left:' + left.toFixed(2) + '%;width:' + width.toFixed(2) +
                '%;background:' + r.color + (r.dashed ? ';opacity:.72' : "") +
                '" title="' + esc(r.label + " " + r.start + " ~ " + r.end) + '">' +
                esc(r.label) + '</div>' +
              (showToday ? '<div class="gantt-today" style="left:' + pct(today).toFixed(2) + '%"></div>' : "") +
            '</div></div>';
        }).join("") +
      '</div></div>' +
      C.dataTable((o.caption || "간트"), ["항목", "시작", "종료"],
        clean.map(r => [r.label, r.start, r.end]));
  }

  /* ── 1. 전체 과제 타임라인 ──────────────────────────────────────────────
     실적(Excel)과 계획(생성 일정)을 한 축에 놓아 "지금 어디까지 왔는지"를
     한눈에 보게 합니다. 과제 막대는 그 과제의 전 일정을 감싸는 범위입니다. */
  function overviewGantt() {
    const events = H.all();
    const rows = [];

    window.DATA_PROJECTS.forEach(function (p) {
      const studies = window.DATA_STUDIES.filter(s => s.projectId === p.id);
      const mine = events.filter(e => e.projectId === p.id).map(e => e.date);
      const spanDates = mine.concat(
        studies.map(s => s.startDate), studies.map(s => s.endDate)).filter(Boolean).sort();
      if (!spanDates.length) return;

      rows.push({ label: p.code || p.name, isHead: true,
                  start: spanDates[0], end: spanDates[spanDates.length - 1],
                  color: "var(--c-navy-700)" });

      studies.forEach(function (s) {
        rows.push({ label: s.name, start: s.startDate, end: s.endDate,
                    color: KIND.culture.color, indent: 14 });

        /* 계획 구간 — 중간 점검 회의부터 결과보고 마감까지.
           실적 종료일부터 마감까지 통으로 칠하면 그 사이 1년 넘는 공백까지
           "계획된 작업"처럼 보입니다. 실제로 계획이 잡힌 구간만 그립니다. */
        const due = events.find(e => e.studyId === s.id && e.kind === "deadline");
        const mid = events.find(e => e.studyId === s.id && e.kind === "meeting");
        if (due) {
          rows.push({ label: "계획 · " + s.name + " 결과보고", indent: 26,
                      start: (mid && mid.date) || H.addDays(due.date, -14), end: due.date,
                      color: KIND.deadline.color, dashed: true });
        }
      });
    });

    return '<section class="card" style="margin-bottom:var(--s-4)">' +
      '<div class="card-head"><div><h2 class="card-title">전체 과제 타임라인</h2>' +
      '<p class="card-sub">전 과제를 한 축에서 비교합니다 · 빨간 세로선은 오늘 · ' +
        '점선 계열 막대는 원본 공정 주기로 산출한 계획 구간</p></div>' +
      '<div style="display:flex;gap:var(--s-3);flex-wrap:wrap;font-size:11px;color:var(--c-text-mute)">' +
        [["과제", "var(--c-navy-700)"], ["Study 실적", KIND.culture.color], ["계획", KIND.deadline.color]]
          .map(x => '<span style="display:flex;align-items:center;gap:5px">' +
            '<span style="width:10px;height:10px;border-radius:2px;background:' + x[1] + '"></span>' +
            esc(x[0]) + '</span>').join("") +
      '</div></div>' +
      '<div class="card-body">' +
        ganttChart(rows, { nameHead: "과제 · Study", caption: "전체 과제 타임라인" }) +
      '</div></section>';
  }

  /* ── 2. 선택 과제 상세 간트 ─────────────────────────────────────────── */
  function scopeGantt(scope) {
    const studies = window.DATA_STUDIES.filter(s => s.projectId === scope.id);
    const rows = [];
    studies.forEach(s => {
      rows.push({ label: s.name, start: s.startDate, end: s.endDate,
                  color: "var(--c-navy-600)", isHead: true });
      window.DATA_BATCHES.filter(b => b.studyId === s.id).forEach(b => {
        if (!b.initialDate && !b.endDate) return;
        rows.push({ label: b.id,
                    start: b.initialDate || b.endDate, end: b.endDate || b.initialDate,
                    color: KIND.culture.color });
      });
    });

    return '<section class="card" style="margin-bottom:var(--s-4)">' +
      '<div class="card-head"><div><h2 class="card-title">' + esc(scope.label) + ' 상세 간트</h2>' +
      '<p class="card-sub">Study 기간과 그 안의 배치별 배양 ~ Harvest 구간</p></div>' +
      '<div style="display:flex;gap:var(--s-3);font-size:11px;color:var(--c-text-mute)">' +
        '<span style="display:flex;align-items:center;gap:5px">' +
          '<span style="width:10px;height:10px;border-radius:2px;background:var(--c-navy-600)"></span>Study</span>' +
        '<span style="display:flex;align-items:center;gap:5px">' +
          '<span style="width:10px;height:10px;border-radius:2px;background:' + KIND.culture.color +
          '"></span>Batch</span></div></div>' +
      '<div class="card-body">' +
        ganttChart(rows, { nameHead: "Study · Batch", caption: scope.label + " 상세 간트" }) +
      '</div></section>';
  }

  /* ── 4. 타임라인 목록 ───────────────────────────────────────────────── */
  function timeline(events, title) {
    if (!events.length) {
      return '<section class="card" style="margin-bottom:var(--s-4)">' +
        '<div class="card-head"><div><h2 class="card-title">' + esc(title) + '</h2></div></div>' +
        '<div class="empty"><div class="empty-title">등록된 일정이 없습니다</div></div></section>';
    }

    const dates = events.map(e => e.date);
    const min = dates[0], max = dates[dates.length - 1];
    const t0 = H.parse(min).getTime();
    const t1 = H.parse(max).getTime();
    const span = Math.max(1, t1 - t0);
    const pos = d => ((H.parse(d).getTime() - t0) / span) * 100;
    const today = H.today();

    /* 월별 그룹 — 목록은 월 단위로 접어서 보여줍니다.
       이번 달이 기본으로 펼쳐지도록 <details open> 을 붙입니다. */
    const byMonth = {};
    events.forEach(e => { const m = e.date.slice(0, 7); (byMonth[m] = byMonth[m] || []).push(e); });
    const thisMonth = today.slice(0, 7);

    return '<section class="card" style="margin-bottom:var(--s-4)">' +
      '<div class="card-head"><div><h2 class="card-title">' + esc(title) + '</h2>' +
      '<p class="card-sub">' + events.length + '건 · ' + esc(min) + ' ~ ' + esc(max) + '</p></div>' +
      '<div style="display:flex;gap:var(--s-3);flex-wrap:wrap;font-size:11px;color:var(--c-text-mute)">' +
        Object.keys(KIND).map(k => '<span style="display:flex;align-items:center;gap:5px">' +
          '<span style="width:9px;height:9px;border-radius:50%;background:' + KIND[k].color + '"></span>' +
          esc(KIND[k].ko) + '</span>').join("") + '</div></div>' +

      '<div class="card-body">' +
        '<div style="position:relative;height:44px;background:var(--c-paper);border-radius:var(--r-md);' +
          'margin-bottom:var(--s-5)">' +
          events.map(e => '<span title="' + esc(e.date + " · " + e.ko) + '" style="position:absolute;' +
            'left:' + pos(e.date).toFixed(2) + '%;top:12px;width:10px;height:10px;margin-left:-5px;' +
            'border-radius:50%;background:' + (KIND[e.kind] || KIND.meeting).color +
            (e.src === "user" ? ";outline:2px solid var(--c-surface)" : "") + '"></span>').join("") +
          (today >= min && today <= max
            ? '<span style="position:absolute;left:' + pos(today).toFixed(2) + '%;top:0;bottom:0;width:2px;' +
              'margin-left:-1px;background:var(--c-risk)" title="오늘"></span>' : "") +
          '<span style="position:absolute;left:0;bottom:4px;font-size:10px;font-family:var(--font-data);' +
            'color:var(--c-text-mute)">' + esc(min) + '</span>' +
          '<span style="position:absolute;right:0;bottom:4px;font-size:10px;font-family:var(--font-data);' +
            'color:var(--c-text-mute)">' + esc(max) + '</span>' +
        '</div>' +

        Object.keys(byMonth).sort().map(m =>
          '<details' + (m >= thisMonth ? " open" : "") + ' style="margin-bottom:var(--s-4)">' +
            '<summary class="eyebrow" style="margin-bottom:var(--s-2);cursor:pointer">' +
              esc(m.replace("-", "년 ") + "월") + ' · ' + byMonth[m].length + '건</summary>' +
            byMonth[m].map(e =>
              '<div class="rail-event">' +
                '<span class="rail-event-bar" style="background:' + (KIND[e.kind] || KIND.meeting).color + '"></span>' +
                '<span style="min-width:0;flex:1">' +
                  '<span style="display:block;font-size:12.5px;font-weight:500">' + esc(e.ko) + '</span>' +
                  '<span style="display:flex;gap:6px;align-items:center;margin-top:3px;flex-wrap:wrap">' +
                    '<span class="mono" style="font-size:10.5px;color:var(--c-text-mute)">' + esc(e.date) + '</span>' +
                    '<span class="badge" style="font-size:10px">' + esc((KIND[e.kind] || {}).ko || e.kind) + '</span>' +
                    '<span class="badge' + (e.src === "user" ? " badge-accent" : "") + '" style="font-size:10px">' +
                      esc(SRC_LABEL[e.src] || e.src) + '</span>' +
                  '</span></span>' +
                (e.src === "user"
                  ? '<button class="btn-icon" data-del="' + esc(e.id) + '" aria-label="일정 삭제" ' +
                    'style="width:28px;height:28px"><svg width="12" height="12" viewBox="0 0 24 24" ' +
                    'fill="none" stroke="currentColor" stroke-width="2.4"><path d="M18 6 6 18M6 6l12 12"/>' +
                    '</svg></button>' : "") +
              '</div>').join("") +
          '</details>').join("") +
      '</div></section>';
  }

  /* ── 3. 일정 추가 폼 ────────────────────────────────────────────────── */
  function addForm(scope) {
    const kinds = ["meeting", "deadline", "culture", "harvest", "analysis", "milestone"];
    return '<section class="card" style="margin-bottom:var(--s-4)">' +
      '<div class="card-head"><div><h2 class="card-title">일정 추가</h2>' +
      '<p class="card-sub">' + esc(scope.label) + ' 에만 등록됩니다 · ' +
        '등록 즉시 우측 캘린더와 대시보드에도 반영됩니다</p></div></div>' +
      '<div class="card-body"><form id="ev-form">' +
        '<div style="display:grid;grid-template-columns:1fr 140px 120px auto;gap:var(--s-2);align-items:end">' +
          '<label class="ebr-cell"><span>일정 내용</span>' +
            '<input class="ebr-input" id="ev-title" placeholder="예: 주간 공정개발 회의"></label>' +
          '<label class="ebr-cell"><span>날짜</span>' +
            '<input class="ebr-input mono" id="ev-date" type="date" value="' + H.today() + '"></label>' +
          '<label class="ebr-cell"><span>구분</span>' +
            '<select class="ebr-input" id="ev-kind">' +
              kinds.map(k => '<option value="' + k + '">' + esc(KIND[k].ko) + '</option>').join("") +
            '</select></label>' +
          '<button class="btn btn-accent" type="submit">추가</button>' +
        '</div>' +
        '<p class="field-error" id="ev-err" role="alert" style="margin-top:var(--s-3)"></p>' +
      '</form></div></section>';
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

    if (mode === "all") {
      $("#page-title").textContent = "일정 관리 · 전체 보기";
      $("#body").innerHTML = overviewGantt() +
        allScopes().map(s => timeline(eventsForScope(s), s.label + " 일정")).join("");
      wire(null);
      return;
    }

    if (!sel.scopeId) {
      $("#page-title").textContent = "일정 관리";
      /* 과제를 안 골랐어도 전체 타임라인은 보여줍니다 —
         "무엇을 골라야 할지" 를 이 화면이 알려주는 게 맞습니다. */
      $("#body").innerHTML = overviewGantt() +
        '<div class="empty"><div class="empty-title">과제를 선택하면 상세 일정이 열립니다</div>' +
        '<div class="empty-body">상단 우측 셀렉터에서 과제를 고르면 그 과제의 간트 · 일정 등록 · ' +
        '타임라인이 표시됩니다. 과제별로 일정은 완전히 분리됩니다.</div></div>';
      wire(null);
      return;
    }

    const scope = { id: sel.scopeId, label: desc.scope };
    $("#page-title").textContent = "일정 관리 · " + desc.scope;
    $("#body").innerHTML = overviewGantt() + scopeGantt(scope) + addForm(scope) +
      timeline(eventsForScope(scope), desc.scope + " 일정");
    wire(scope);
  }

  function wire(scope) {
    const f = $("#ev-form");
    if (f && scope) {
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        const title = $("#ev-title").value.trim();
        const date = $("#ev-date").value;
        const err = $("#ev-err");
        if (!title) { err.textContent = "일정 내용을 입력하세요"; err.classList.add("is-shown"); return; }
        if (!date)  { err.textContent = "날짜를 선택하세요"; err.classList.add("is-shown"); return; }
        err.classList.remove("is-shown");
        H.addUserEvent({
          id: "EV-" + Date.now().toString(36),
          scopeKey: "project:" + scope.id,      // 기존 저장 형식 유지
          date: date, ko: title, kind: $("#ev-kind").value,
          createdBy: E.who(), createdAt: E.stamp()
        });
        $("#ev-title").value = "";
        refresh();
      });
    }
    $$("[data-del]").forEach(b => b.addEventListener("click", function () {
      H.removeUserEvent(b.dataset.del);
      refresh();
    }));
  }

  /* 일정이 바뀌면 본문뿐 아니라 우측 미니 캘린더도 같이 갱신합니다 —
     한쪽만 갱신되면 같은 화면 안에서 일정이 서로 달라 보입니다. */
  function refresh() {
    render();
    if (window.Shell.paintRail) window.Shell.paintRail();
  }

  window.StudySelector.mount($("#selector"), { showResults: false });
  window.Scope.subscribe(render);
  render();
})();
