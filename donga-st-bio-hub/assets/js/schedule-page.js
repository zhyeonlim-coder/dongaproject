/* ==========================================================================
   일정 관리  [지시서 §7]

   과제별로 일정을 완전히 분리합니다. 기본값은 "선택한 과제만" 이고,
   전체 비교가 필요할 때만 "전체 보기" 로 전환합니다.

   일정 소스
     · Excel 파생 — 각 Batch 의 Initial Date(배양 시작) / End Date(Harvest)
     · 사용자 추가 — 회의·분석 등 직접 입력 (localStorage)
   두 가지를 한 타임라인에 합쳐 보여주되 출처를 구분해 표시합니다.
   ========================================================================== */

(function () {
  "use strict";

  const user = window.Shell.mount({ page: "schedule" });
  if (!user) return;

  const L = window.LABELS, E = window.Entries, C = window.Charts;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const KEY = "hub.schedule.v2";
  let mode = "project";           // "project" = 과제별 분리(기본) | "all" = 전체 보기

  const KIND = {
    culture:  { ko: "배양",   color: "var(--c-accent)" },
    harvest:  { ko: "Harvest", color: "#6D28D9" },
    analysis: { ko: "분석",   color: "#0F766E" },
    meeting:  { ko: "회의",   color: "var(--c-text-mute)" },
    milestone:{ ko: "마일스톤", color: "var(--c-risk)" }
  };

  function userEvents() {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return []; }
  }
  function saveUserEvents(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {}
  }

  function paintSubnav() {
    window.Shell.subnav([
      { label: "보기", items: [
        { key: "project", ko: "과제별 분리", active: mode === "project" },
        { key: "all",     ko: "전체 보기",   active: mode === "all" }
      ]},
      { label: "바로가기", items: [
        { ko: "대시보드", href: "dashboard.html" },
        { ko: "EBR 입력", href: "ebr.html" }
      ]}
    ], k => { mode = k; render(); });
  }

  /* ── 일정 수집 ──────────────────────────────────────────────────────── */

  /* 과제(또는 기반 Study) 단위로 일정을 만듭니다.
     scopeId 가 다르면 절대 섞이지 않습니다 — 이게 §7의 핵심입니다. */
  function eventsForScope(scope) {
    const out = [];
    const studies = scope.kind === "project"
      ? window.DATA_STUDIES.filter(s => s.projectId === scope.id)
      : window.DATA_STUDIES.filter(s => s.id === scope.id);
    const ids = studies.map(s => s.id);

    window.DATA_BATCHES.filter(b => ids.indexOf(b.studyId) > -1).forEach(b => {
      if (b.initialDate) out.push({ date: b.initialDate, ko: b.id + " 배양 시작",
        kind: "culture", src: "excel", ref: b.id });
      if (b.endDate) out.push({ date: b.endDate, ko: b.id + " " + L.process.harvest,
        kind: "harvest", src: "excel", ref: b.id });
    });

    studies.forEach(s => {
      if (s.endDate) out.push({ date: s.endDate, ko: s.name + " 종료", kind: "milestone",
        src: "excel", ref: s.id });
    });

    userEvents().filter(e => e.scopeKey === scope.kind + ":" + scope.id)
      .forEach(e => out.push(Object.assign({ src: "user" }, e)));

    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  function allScopes() {
    return window.DATA_PROJECTS.map(p => ({ kind: "project", id: p.id, label: p.code || p.name }))
      .concat(window.DATA_STUDIES.filter(s => s.scope === "platform")
        .map(s => ({ kind: "platform", id: s.id, label: s.name + " (기반 Study)" })))
      .concat(window.DATA_STUDIES.filter(s => s.scope === "unassigned")
        .map(s => ({ kind: "unassigned", id: s.id, label: s.name })));
  }

  /* ── 간트 차트 ──────────────────────────────────────────────────────────
     이전 화면의 간트를 복원하되, 표시 대상은 선택한 과제 범위로 한정합니다.
     막대 = Study(기간 전체) + 그 아래 Batch(배양 시작 ~ Harvest). */
  function ganttRows(scope) {
    const studies = scope.kind === "project"
      ? window.DATA_STUDIES.filter(s => s.projectId === scope.id)
      : window.DATA_STUDIES.filter(s => s.id === scope.id);

    const rows = [];
    studies.forEach(s => {
      rows.push({ kind: "study", label: s.name, start: s.startDate, end: s.endDate,
                  color: "var(--c-navy-600)", isHead: true });
      window.DATA_BATCHES.filter(b => b.studyId === s.id).forEach(b => {
        if (!b.initialDate && !b.endDate) return;
        rows.push({ kind: "batch", label: b.id,
                    start: b.initialDate || b.endDate, end: b.endDate || b.initialDate,
                    color: KIND.culture.color });
      });
    });
    return rows.filter(r => r.start && r.end);
  }

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

  function gantt(scope) {
    const rows = ganttRows(scope);
    if (!rows.length) {
      return '<section class="card" style="margin-bottom:var(--s-4)">' +
        '<div class="card-head"><div><h2 class="card-title">간트 차트</h2></div></div>' +
        '<div class="empty"><div class="empty-title">표시할 일정이 없습니다</div></div></section>';
    }

    const allDates = rows.reduce((a, r) => a.concat([r.start, r.end]), []).sort();
    const min = allDates[0], max = allDates[allDates.length - 1];
    const months = monthsBetween(min, max);

    const t0 = new Date(min + "T00:00:00").getTime();
    const t1 = new Date(max + "T00:00:00").getTime();
    const span = Math.max(1, t1 - t0);
    const pct = iso => ((new Date(iso + "T00:00:00").getTime() - t0) / span) * 100;

    const today = E.stamp().slice(0, 10);
    const showToday = today >= min && today <= max;

    return '<section class="card" style="margin-bottom:var(--s-4)">' +
      '<div class="card-head"><div><h2 class="card-title">간트 차트</h2>' +
      '<p class="card-sub">' + esc(scope.label) + ' · ' + esc(min) + ' ~ ' + esc(max) +
        (showToday ? ' · 빨간 세로선은 오늘' : "") + '</p></div>' +
      '<div style="display:flex;gap:var(--s-3);font-size:11px;color:var(--c-text-mute)">' +
        '<span style="display:flex;align-items:center;gap:5px">' +
          '<span style="width:10px;height:10px;border-radius:2px;background:var(--c-navy-600)"></span>Study</span>' +
        '<span style="display:flex;align-items:center;gap:5px">' +
          '<span style="width:10px;height:10px;border-radius:2px;background:' + KIND.culture.color +
          '"></span>Batch</span></div></div>' +

      '<div class="card-body"><div class="tbl-scroll"><div class="gantt">' +
        '<div class="gantt-head">' +
          '<div class="eyebrow">Study · Batch</div>' +
          '<div class="gantt-months" style="grid-template-columns:repeat(' + months.length + ',1fr)">' +
            months.map(mo => '<span class="gantt-month">' + mo.m + '월</span>').join("") +
          '</div></div>' +

        rows.map(r => {
          const left = pct(r.start);
          const width = Math.max(1.2, pct(r.end) - left);
          return '<div class="gantt-row">' +
            '<div class="gantt-name"' + (r.isHead ? ' style="font-weight:700"' : ' style="padding-left:12px;color:var(--c-text-mute)"') + '>' +
              esc(r.label) + '</div>' +
            '<div class="gantt-track">' +
              '<div class="gantt-grid" aria-hidden="true">' +
                months.map(() => '<span></span>').join("") + '</div>' +
              '<div class="gantt-bar" style="left:' + left.toFixed(2) + '%;width:' + width.toFixed(2) +
                '%;background:' + r.color + '" title="' + esc(r.label + " " + r.start + " ~ " + r.end) + '">' +
                esc(r.label) + '</div>' +
              (showToday ? '<div class="gantt-today" style="left:' + pct(today).toFixed(2) + '%"></div>' : "") +
            '</div></div>';
        }).join("") +
      '</div></div>' +
      C.dataTable(esc(scope.label) + " 간트", ["항목", "시작", "종료"],
        rows.map(r => [r.label, r.start, r.end])) +
      '</div></section>';
  }

  /* ── 타임라인 ───────────────────────────────────────────────────────── */
  function timeline(events, title) {
    if (!events.length) {
      return '<section class="card" style="margin-bottom:var(--s-4)">' +
        '<div class="card-head"><div><h2 class="card-title">' + esc(title) + '</h2></div></div>' +
        '<div class="empty"><div class="empty-title">등록된 일정이 없습니다</div></div></section>';
    }

    const dates = events.map(e => e.date);
    const min = dates[0], max = dates[dates.length - 1];
    const t0 = new Date(min + "T00:00:00").getTime();
    const t1 = new Date(max + "T00:00:00").getTime();
    const span = Math.max(1, t1 - t0);
    const pos = d => ((new Date(d + "T00:00:00").getTime() - t0) / span) * 100;

    /* 월별 그룹 — 목록은 월 단위로 접어서 보여줍니다 */
    const byMonth = {};
    events.forEach(e => { const m = e.date.slice(0, 7); (byMonth[m] = byMonth[m] || []).push(e); });

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
          '<span style="position:absolute;left:0;bottom:4px;font-size:10px;font-family:var(--font-data);' +
            'color:var(--c-text-mute)">' + esc(min) + '</span>' +
          '<span style="position:absolute;right:0;bottom:4px;font-size:10px;font-family:var(--font-data);' +
            'color:var(--c-text-mute)">' + esc(max) + '</span>' +
        '</div>' +

        Object.keys(byMonth).sort().map(m =>
          '<div style="margin-bottom:var(--s-4)">' +
            '<div class="eyebrow" style="margin-bottom:var(--s-2)">' + esc(m.replace("-", "년 ") + "월") + '</div>' +
            byMonth[m].map(e =>
              '<div class="rail-event">' +
                '<span class="rail-event-bar" style="background:' + (KIND[e.kind] || KIND.meeting).color + '"></span>' +
                '<span style="min-width:0;flex:1">' +
                  '<span style="display:block;font-size:12.5px;font-weight:500">' + esc(e.ko) + '</span>' +
                  '<span style="display:flex;gap:6px;align-items:center;margin-top:3px">' +
                    '<span class="mono" style="font-size:10.5px;color:var(--c-text-mute)">' + esc(e.date) + '</span>' +
                    '<span class="badge" style="font-size:10px">' + esc((KIND[e.kind] || {}).ko || e.kind) + '</span>' +
                    (e.src === "user"
                      ? '<span class="badge badge-accent" style="font-size:10px">직접 등록</span>'
                      : '<span class="badge" style="font-size:10px">Excel 파생</span>') +
                  '</span></span>' +
                (e.src === "user"
                  ? '<button class="btn-icon" data-del="' + esc(e.id) + '" aria-label="일정 삭제" ' +
                    'style="width:28px;height:28px"><svg width="12" height="12" viewBox="0 0 24 24" ' +
                    'fill="none" stroke="currentColor" stroke-width="2.4"><path d="M18 6 6 18M6 6l12 12"/>' +
                    '</svg></button>' : "") +
              '</div>').join("") +
          '</div>').join("") +
      '</div></section>';
  }

  /* ── 일정 추가 폼 ───────────────────────────────────────────────────── */
  function addForm(scope) {
    return '<section class="card" style="margin-bottom:var(--s-4)">' +
      '<div class="card-head"><div><h2 class="card-title">일정 추가</h2>' +
      '<p class="card-sub">' + esc(scope.label) + ' 에만 등록됩니다</p></div></div>' +
      '<div class="card-body"><form id="ev-form">' +
        '<div style="display:grid;grid-template-columns:1fr 140px 120px auto;gap:var(--s-2);align-items:end">' +
          '<label class="ebr-cell"><span>일정 내용</span>' +
            '<input class="ebr-input" id="ev-title" placeholder="예: 주간 공정개발 회의"></label>' +
          '<label class="ebr-cell"><span>날짜</span>' +
            '<input class="ebr-input mono" id="ev-date" type="date" value="' +
              E.stamp().slice(0, 10) + '"></label>' +
          '<label class="ebr-cell"><span>구분</span>' +
            '<select class="ebr-input" id="ev-kind">' +
              Object.keys(KIND).map(k => '<option value="' + k + '">' + esc(KIND[k].ko) + '</option>').join("") +
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
      $("#body").innerHTML =
        '<div class="card" style="margin-bottom:var(--s-4);border-left:3px solid var(--c-warn)">' +
          '<div class="card-body" style="font-size:12.5px;color:var(--c-text-mute);padding:var(--s-3) var(--s-4)">' +
          '전체 비교용 보기입니다. 기본값은 과제별 분리 보기이며, 좌측에서 전환할 수 있습니다.</div></div>' +
        allScopes().map(s => gantt(s) + timeline(eventsForScope(s), s.label)).join("");
      wire(null);
      return;
    }

    if (!sel.scopeId) {
      $("#page-title").textContent = "일정 관리";
      $("#body").innerHTML = '<div class="empty"><div class="empty-title">과제 또는 기반 Study를 선택하세요</div>' +
        '<div class="empty-body">과제별로 일정이 완전히 분리되어 표시됩니다.</div></div>';
      return;
    }

    const scope = { kind: sel.scopeKind, id: sel.scopeId, label: desc.scope };
    $("#page-title").textContent = "일정 관리 · " + desc.scope;
    $("#body").innerHTML = gantt(scope) + addForm(scope) +
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
        const list = userEvents();
        list.push({ id: "EV-" + Date.now().toString(36), scopeKey: scope.kind + ":" + scope.id,
          date, ko: title, kind: $("#ev-kind").value,
          createdBy: E.who(), createdAt: E.stamp() });
        saveUserEvents(list);
        $("#ev-title").value = "";
        render();
      });
    }
    $$("[data-del]").forEach(b => b.addEventListener("click", function () {
      saveUserEvents(userEvents().filter(x => x.id !== b.dataset.del));
      render();
    }));
  }

  window.StudySelector.mount($("#selector"), { showResults: false });
  window.Scope.subscribe(render);
  render();
})();
