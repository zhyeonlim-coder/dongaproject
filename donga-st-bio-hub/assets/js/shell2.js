/* ==========================================================================
   Application shell v2 — Top nav · Left sub-menu · Center · Right rail

   Page markup only needs:
     <header id="topnav">  <nav id="subnav">  <main id="main">  <aside id="rail">

   The selected project is shell-level state (persisted), because every module
   is scoped to one project. Pages read Shell.project() and re-render on the
   `project` event rather than each keeping their own copy.
   ========================================================================== */

window.Shell = (function () {
  "use strict";

  const LOGO_SRC = "assets/img/logo.svg";
  const PRJ_KEY = "hub.project";

  const NAV = [
    /* 오늘 할 일 · 분석 의뢰 · 연구 지식은 독립 메뉴에서 내렸습니다.
         오늘 할 일  → 대시보드의 Smart To-Do Card
         분석 의뢰   → EBR 입력 > 분석 및 시료 관리 (+ 대시보드 요약 카드)
         연구 지식   → DoE & Intelligence > Troubleshooting & Wiki
       입력은 EBR 하나로 모으고, 조회·요약은 대시보드로 모으는 방향입니다. */
    { id: "dashboard", href: "dashboard.html", ko: "대시보드",
      icon: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>' },
    { id: "ebr", href: "ebr.html", ko: "EBR 입력",
      icon: '<path d="M5 3h11l3 3v15H5z"/><path d="M9 9h7M9 13h7M9 17h4"/>' },
    { id: "data", href: "data.html", ko: "데이터 조회",
      icon: '<path d="M3 5h18v4H3zM3 11h18v4H3zM3 17h18v4H3z"/>' },
    /* 회의 모드는 별도 메뉴가 아니라 대시보드 안의 버튼으로 진입합니다.
       (내비게이션에서 의도적으로 제외 — 대시보드에서 선택한 스터디를 그대로
        들고 들어가야 해서 별도 페이지로 두면 동선이 끊깁니다) */
    { id: "schedule", href: "schedule.html", ko: "일정 관리",
      icon: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>' },
    { id: "hub", href: "hub.html", ko: "DoE & Intelligence",
      icon: '<path d="M4 19h16M7 19V9M12 19V5M17 19v-7"/>' },
    { id: "booking", href: "booking.html", ko: "장비 예약",
      icon: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>' },
    { id: "explorer", href: "explorer.html", ko: "데이터 탐색",
      icon: '<path d="M3 5h7l2 2h9v12H3z"/>' }
  ];

  let currentProject = null;
  const listeners = {};

  function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
  function fire(evt, payload) { (listeners[evt] || []).forEach(fn => { try { fn(payload); } catch (e) {} }); }

  const esc = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function project() { return currentProject; }
  function setProject(id) {
    currentProject = id;
    try { localStorage.setItem(PRJ_KEY, id); } catch (e) {}
    fire("project", id);
  }

  /* LOGO SLOT — see assets/img/README.txt */
  function logo(size) {
    const id = "lg" + Math.random().toString(36).slice(2, 7);
    return '<img class="brand-logo" src="' + LOGO_SRC + '" width="' + size + '" height="' + size + '" alt="동아에스티" ' +
      'onload="var f=document.getElementById(\'' + id + '\');if(f)f.remove();" onerror="this.remove();">' +
      '<svg id="' + id + '" class="brand-logo" viewBox="0 0 48 48" width="' + size + '" height="' + size +
        '" role="img" aria-label="동아에스티">' +
        '<circle cx="24" cy="24" r="21" fill="none" stroke="#E58F95" stroke-width="2.4"/>' +
        '<circle cx="24" cy="24" r="16.5" fill="none" stroke="#E58F95" stroke-width="1.4"/>' +
        '<path d="M24 9.5 32 24l-8 14.5L16 24z" fill="none" stroke="#E58F95" stroke-width="2.1" stroke-linejoin="round"/>' +
        '<path d="M24 9.5V38.5" stroke="#E58F95" stroke-width="1.2"/></svg>';
  }

  /* Excel 계층(Scope · DATA_PROJECTS)을 싣지 않는 화면 —
     DoE · 장비 예약 · 데이터 탐색 — 도 이 셸을 씁니다.
     그 화면들에서는 이 함수가 조용히 레거시 셀렉터를 돌려주어야 합니다.
     (예전에는 여기서 예외가 나 상단 내비게이션부터 렌더링이 멈췄습니다.) */
  function hasScopeLayer() {
    return !!(window.Scope && typeof window.Scope.get === "function" && window.DATA_PROJECTS);
  }

  /* 최상위 범위는 개발 과제 두 개뿐입니다.
     (기반 Study · 미지정 그룹은 구조 개편 때 폐지했습니다) */
  function scopeOptionsMarkup() {
    if (!hasScopeLayer()) {
      /* 레거시 화면: 기존 LAB 과제 목록을 그대로 보여줍니다. */
      const LP = (window.LAB && window.LAB.PROJECTS) ? window.LAB.PROJECTS : [];
      if (!LP.length) return '<option value="">—</option>';
      return LP.map(p => '<option value="legacy:' + esc(p.id) + '"' +
        (p.id === currentProject ? " selected" : "") + '>' + esc(p.id) + '</option>').join("");
    }
    const sel = window.Scope.get();
    const cur = sel.scopeId || "";
    return '<option value=""' + (cur ? "" : " selected") + '>— 과제 선택 —</option>' +
      window.DATA_PROJECTS.map(p =>
        '<option value="project:' + esc(p.id) + '"' + (cur === p.id ? " selected" : "") + '>' +
        esc(p.code || p.name) + '</option>').join("");
  }

  /* ── Mount ──────────────────────────────────────────────────────────── */
  function mount(opts) {
    const o = opts || {};
    const user = window.Auth.requireSession();
    if (!user) return null;

    /* 레거시 화면(DoE·장비예약·데이터 탐색)만 lab.js / store.js 를 싣습니다.
       Excel 기반으로 재구축한 화면에는 없으므로 있을 때만 씁니다. */
    if (window.Store && window.Store.init) window.Store.init(user);

    const L = window.LAB;
    if (L && L.PROJECTS && L.PROJECTS.length) {
      try { currentProject = localStorage.getItem(PRJ_KEY); } catch (e) {}
      if (!currentProject || !L.PROJECTS.some(p => p.id === currentProject)) currentProject = L.PROJECTS[0].id;
    }

    /* Top nav */
    document.getElementById("topnav").innerHTML =
      '<a class="topnav-brand" href="dashboard.html">' + logo(28) +
        '<span style="min-width:0">' +
          '<span style="display:block;font-size:12.5px;font-weight:700;color:#fff;line-height:1.2">동아에스티</span>' +
          '<span class="eyebrow" style="color:#8FA2BB;font-size:9px">Bio Knowledge Hub</span>' +
        '</span></a>' +
      '<nav class="topnav-links" aria-label="주요 메뉴">' +
        NAV.map(n =>
          '<a class="topnav-link" href="' + n.href + '"' + (n.id === o.page ? ' aria-current="page"' : "") + '>' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
              'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + n.icon + '</svg>' +
            '<span class="tn-label">' + n.ko + '</span></a>').join("") +
      '</nav>' +
      '<div class="topnav-right">' +
        '<label class="sr-only" for="scope-select">과제 선택</label>' +
        '<select class="prj-select" id="scope-select">' + scopeOptionsMarkup() + '</select>' +
        '<span class="badge badge-warn" style="flex:none" title="이 화면의 모든 수치는 예시입니다">' +
          '<span class="badge-dot"></span>샘플<span class="badge-sample-en"> 데이터</span></span>' +
        '<span class="avatar" style="background:var(--c-accent-hi);color:#0A192F" title="' + esc(user.name) + '">' +
          esc(user.initials) + '</span>' +
        '<button class="btn-icon" id="signout" aria-label="로그아웃" style="color:#8FA2BB">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
          '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>' +
        '</button>' +
      '</div>';

    /* 과제 선택. 값은 "project:PRJ-1234" / "legacy:DA-3880" 처럼
       종류를 앞에 붙여 인코딩합니다 — 레거시 화면과 ID 네임스페이스가
       달라서, 종류를 함께 실어야 어느 쪽 ID 인지 모호하지 않습니다. */
    document.getElementById("scope-select").addEventListener("change", function () {
      const v = this.value;
      if (!hasScopeLayer()) {
        /* 레거시 화면은 예전 동작 그대로 — LAB 과제 전환 */
        if (v.indexOf("legacy:") === 0) setProject(v.slice(7));
        return;
      }
      if (!v) { window.Scope.setScope(null, null); return; }
      const i = v.indexOf(":");
      window.Scope.setScope(v.slice(0, i), v.slice(i + 1));
    });
    document.getElementById("signout").addEventListener("click", () => window.Auth.signOut());

    /* 선택이 다른 경로로 바뀌어도 상단 셀렉터가 항상 실제 상태를 보여주도록
       동기화합니다. 화면마다 따로 갱신하면 반드시 어긋납니다. */
    if (hasScopeLayer()) {
      window.Scope.subscribe(function () {
        const el = document.getElementById("scope-select");
        if (el) el.innerHTML = scopeOptionsMarkup();
        paintRail();
      });
    }

    paintRail();
    if (window.Store && window.Store.subscribe) window.Store.subscribe(() => paintRail());
    on("project", () => paintRail());

    return user;
  }

  /* ── Sub-menu ───────────────────────────────────────────────────────── */
  function subnav(groups, onPick) {
    const host = document.getElementById("subnav");
    if (!host) return;
    host.innerHTML = groups.map(g =>
      '<div style="margin-bottom:var(--s-5)">' +
        (g.label ? '<div class="subnav-label">' + esc(g.label) + '</div>' : "") +
        g.items.map(it =>
          (it.href
            ? '<a class="subnav-item" href="' + it.href + '"' + (it.active ? ' aria-current="true"' : "") + '>'
            : '<button class="subnav-item" data-key="' + esc(it.key) + '" aria-selected="' + (!!it.active) + '">') +
          (it.color ? '<span class="subnav-dot" style="background:' + it.color + '"></span>' : "") +
          '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(it.ko) + '</span>' +
          (it.count != null ? '<span style="margin-left:auto;font-family:var(--font-data);font-size:10.5px;' +
            'color:var(--c-text-mute)">' + it.count + '</span>' : "") +
          (it.href ? '</a>' : '</button>')).join("") +
      '</div>').join("");

    Array.prototype.forEach.call(host.querySelectorAll("[data-key]"), b => {
      b.addEventListener("click", () => {
        Array.prototype.forEach.call(host.querySelectorAll("[data-key]"),
          x => x.setAttribute("aria-selected", String(x === b)));
        if (onPick) onPick(b.dataset.key);
      });
    });
  }

  /* ── Right rail: mini calendar + events + notifications ─────────────── */
  let calMonth = null, calSelected = null;

  /* 캘린더 소스 우선순위
       1. HubCalendar  — Excel 파생 + 생성 일정 + 직접 등록 + 레거시를 합친 단일 소스.
                         대시보드 · 데이터 조회 · 일정 관리 · 데이터 탐색이 모두 이걸 씁니다.
       2. Store        — HubCalendar 를 싣지 않는 레거시 화면(장비 예약 · DoE)용.
     이 순서 덕분에 화면을 옮겨도 우측 캘린더에 같은 일정이 찍힙니다. */
  function calendarSource() {
    if (window.HubCalendar && window.HubCalendar.railSource) return window.HubCalendar.railSource();
    if (window.Store && window.Store.eventsOn) return window.Store;
    const pad = n => String(n).padStart(2, "0");
    const d = new Date();
    const t = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    return { today: () => t, eventsOn: () => [], oosItems: () => [] };
  }

  function paintRail() {
    const host = document.getElementById("rail");
    if (!host) return;
    const S = calendarSource();
    const today = S.today();
    if (!calMonth) calMonth = today.slice(0, 7);
    if (!calSelected) calSelected = today;

    const [Y, M] = calMonth.split("-").map(Number);
    const first = new Date(Y, M - 1, 1);
    const startDow = first.getDay();
    const daysInMonth = new Date(Y, M, 0).getDate();
    const prevDays = new Date(Y, M - 1, 0).getDate();

    const cells = [];
    for (let i = startDow - 1; i >= 0; i--) cells.push({ d: prevDays - i, out: true });
    for (let d = 1; d <= daysInMonth; d++) cells.push({ d, out: false });
    while (cells.length % 7) cells.push({ d: cells.length, out: true });

    const iso = (d) => Y + "-" + String(M).padStart(2, "0") + "-" + String(d).padStart(2, "0");

    /* 색은 HubCalendar 가 정의한 값을 그대로 씁니다 — 캘린더 점과 일정 관리
       화면의 범례가 어긋나지 않도록 한 곳에서만 정합니다.
       purif 는 레거시 Store 만 쓰는 종류라 여기서 보완합니다. */
    const KIND_COLOR = Object.assign(
      { culture: "var(--c-accent)", purif: "#6D28D9", analysis: "#0F766E",
        booking: "#B45309", milestone: "var(--c-risk)" },
      Object.keys((window.HubCalendar || {}).KIND || {}).reduce(function (acc, k) {
        acc[k] = window.HubCalendar.KIND[k].color; return acc;
      }, {})
    );

    const dayCells = cells.map(c => {
      if (c.out) return '<span class="cal-day" data-out="1" aria-hidden="true">' + c.d + '</span>';
      const date = iso(c.d);
      const evs = S.eventsOn(date);
      const kinds = [];
      evs.forEach(e => { if (kinds.indexOf(e.kind) === -1) kinds.push(e.kind); });
      return '<button class="cal-day" data-date="' + date + '"' +
        (date === today ? ' data-today="1"' : "") +
        ' aria-pressed="' + (date === calSelected) + '"' +
        ' aria-label="' + date + (evs.length ? ", 일정 " + evs.length + "건" : "") + '">' + c.d +
        (kinds.length ? '<span class="cal-dots">' + kinds.slice(0, 3).map(k =>
          '<span class="cal-dot" style="background:' + (KIND_COLOR[k] || "var(--c-text-soft)") + '"></span>').join("") +
          '</span>' : "") + '</button>';
    }).join("");

    const selEvents = S.eventsOn(calSelected);
    const oos = S.oosItems(currentProject);

    /* 다가오는 일정 — HubCalendar 를 쓰는 화면에서만 채웁니다.
       레거시 화면(장비 예약 · DoE)에는 이 목록의 근거가 없어 비웁니다. */
    const soon = (window.HubCalendar && window.HubCalendar.upcoming)
      ? window.HubCalendar.upcoming(4) : [];

    host.innerHTML =
      '<div class="cal-head">' +
        '<button class="btn-icon" id="cal-prev" aria-label="이전 달" style="width:30px;height:30px">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
          'stroke-linecap="round"><path d="m15 5-7 7 7 7"/></svg></button>' +
        '<strong style="font-size:13px">' + Y + '년 ' + M + '월</strong>' +
        '<button class="btn-icon" id="cal-next" aria-label="다음 달" style="width:30px;height:30px">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
          'stroke-linecap="round"><path d="m9 5 7 7-7 7"/></svg></button>' +
      '</div>' +
      '<div class="cal-grid">' +
        ["일","월","화","수","목","금","토"].map(d => '<span class="cal-dow">' + d + '</span>').join("") +
        dayCells +
      '</div>' +

      '<div class="rule-hair" style="margin:var(--s-4) 0 var(--s-3)"></div>' +
      '<div class="eyebrow" style="margin-bottom:var(--s-2)">' + calSelected.slice(5) + ' 일정</div>' +
      (selEvents.length
        ? selEvents.map(e =>
            '<div class="rail-event">' +
              '<span class="rail-event-bar" style="background:' + (KIND_COLOR[e.kind] || "var(--c-text-soft)") + '"></span>' +
              '<span style="min-width:0;flex:1">' +
                '<span style="display:block;font-size:12px;font-weight:500">' + esc(e.ko) + '</span>' +
                '<span class="badge" style="margin-top:4px;font-size:10px">' + esc(e.status) + '</span>' +
              '</span></div>').join("")
        : '<p style="font-size:12px;color:var(--c-text-mute);margin:0">등록된 일정이 없습니다.</p>') +

      (soon.length
        ? '<div class="rule-hair" style="margin:var(--s-4) 0 var(--s-3)"></div>' +
          '<div class="eyebrow" style="margin-bottom:var(--s-2)">다가오는 일정</div>' +
          soon.map(e =>
            '<a class="rail-event" href="schedule.html" style="text-decoration:none;color:inherit">' +
              '<span class="rail-event-bar" style="background:' +
                (KIND_COLOR[e.kind] || "var(--c-text-soft)") + '"></span>' +
              '<span style="min-width:0;flex:1">' +
                '<span style="display:block;font-size:12px;font-weight:500">' + esc(e.ko) + '</span>' +
                '<span class="mono" style="display:block;font-size:10.5px;color:var(--c-text-mute);margin-top:3px">' +
                  esc(e.date) + '</span>' +
              '</span></a>').join("")
        : "") +

      '<div class="rule-hair" style="margin:var(--s-4) 0 var(--s-3)"></div>' +
      '<div class="eyebrow" style="margin-bottom:var(--s-2)">알림</div>' +
      (oos.length
        ? oos.slice(0, 3).map(x =>
            '<a class="rail-event" href="ebr.html#analysis" style="text-decoration:none;color:inherit">' +
              '<span class="rail-event-bar" style="background:var(--c-risk)"></span>' +
              '<span style="min-width:0"><span style="display:block;font-size:12px;font-weight:600;color:#9B1C1C">' +
                'Fail · ' + esc(x.ko) + '</span>' +
              '<span style="display:block;font-size:11px;color:var(--c-text-mute)">' + esc(x.sample) + ' · ' +
                x.value + ' (규격 ' + esc(x.spec) + ')</span></span></a>').join("")
        : '<p style="font-size:12px;color:var(--c-text-mute);margin:0">규격 이탈 항목이 없습니다.</p>') +

      '<div class="rule-hair" style="margin:var(--s-4) 0 var(--s-3)"></div>' +
      '<a class="btn btn-ghost btn-sm" href="schedule.html" style="width:100%">전체 일정 보기</a>';

    document.getElementById("cal-prev").addEventListener("click", () => { calMonth = shiftMonth(calMonth, -1); paintRail(); });
    document.getElementById("cal-next").addEventListener("click", () => { calMonth = shiftMonth(calMonth, 1); paintRail(); });
    Array.prototype.forEach.call(host.querySelectorAll("[data-date]"), b =>
      b.addEventListener("click", () => { calSelected = b.dataset.date; paintRail(); fire("date", calSelected); }));
  }

  function shiftMonth(ym, delta) {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  return { mount, subnav, project, setProject, on, paintRail, logo };
})();
