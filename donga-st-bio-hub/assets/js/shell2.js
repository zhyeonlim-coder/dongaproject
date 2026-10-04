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
         분석 의뢰   → Data 입력 > 분석 및 시료 관리 (+ 대시보드 요약 카드)
         연구 지식   → DoE & Intelligence > Troubleshooting & Wiki
       입력은 EBR 하나로 모으고, 조회·요약은 대시보드로 모으는 방향입니다. */
    { id: "dashboard", href: "dashboard.html", ko: "대시보드",
      icon: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>' },
    { id: "ebr", href: "ebr.html", ko: "Data 입력",
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
      icon: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>' }
    /* 데이터 탐색(explorer.html)은 메뉴에서 내렸습니다.
       그 화면만 이전 단계의 아카이브 데이터셋을 쓰고 selection.js 를 싣지 않아,
       상단에서 과제를 바꿔도 따라오지 않았습니다. 사용자 눈에는 화면마다
       규칙이 다른 것으로 — 즉 고장으로 — 보입니다.
       파일은 남겨 두었으므로 주소를 직접 열면 그대로 동작합니다. 새 데이터
       계층으로 이관하면 그때 메뉴로 되돌립니다. */
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
  /* ── 데이터가 어디 있는지 ────────────────────────────────────────────────
     세 가지뿐입니다.

       서버      중앙 DB 를 읽고 씁니다. 다른 PC 와 같은 데이터입니다.
       이 브라우저  서버가 꺼져 있습니다. 나만 보는 데이터입니다.
       끊김      서버는 켜져 있는데 이 브라우저가 닿지 못했습니다. ← 위험

     세 번째를 말해 주는 것이 이 표시의 목적입니다. 화면은 멀쩡해 보이는데
     보고 있는 값이 남들과 다른 상태이고, 말해 주지 않으면 알 수 없습니다. */
  function paintStore() {
    const el = document.getElementById("storemode");
    if (!el || !window.HubBoot) return;

    function draw() {
      const n = window.HubBoot.note();
      let cls, txt, tip;

      if (n.mode === "server" && n.serverReady) {
        cls = "badge badge-ok"; txt = "서버";
        tip = "중앙 데이터베이스를 읽고 씁니다. 다른 PC 와 같은 데이터입니다.";
      } else if (n.mode === "server") {
        cls = "badge badge-risk"; txt = "서버 끊김";
        tip = "서버에서 데이터를 읽지 못했습니다 (" + (n.reason || "") + "). " +
              "지금 보이는 값은 최신이 아닐 수 있습니다. 새로 고쳐 보세요.";
      } else if (n.reason === "로그인 필요") {
        cls = "badge badge-risk"; txt = "서버 미연결";
        tip = "서버는 켜져 있지만 이 브라우저는 연결되지 않았습니다. " +
              "다시 로그인해 '서버 접속 비밀값' 을 입력하세요.";
      } else {
        cls = "badge"; txt = "이 브라우저";
        tip = "중앙 서버가 설정되지 않았습니다 (" + (n.reason || "") + "). " +
              "데이터는 이 브라우저에만 저장되며 다른 PC 에서는 보이지 않습니다.";
      }

      el.className = cls;
      el.setAttribute("title", tip);
      el.textContent = txt;
    }

    draw();
    /* 부팅이 끝나면 다시 그립니다 — 처음 그릴 때는 아직 "init" 입니다 */
    if (window.HubBoot.ready && window.HubBoot.ready.then) {
      window.HubBoot.ready.then(draw).catch(function () {});
    }
    if (window.HubServer && window.HubServer.subscribe) window.HubServer.subscribe(draw);
  }

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
        /* 데이터가 어디 있는지 — 아래 paintStore() 가 채웁니다.
           이것이 없으면, 서버가 켜져 있는데 이 브라우저만 떨어져 나와도
           아무 표시 없이 다른 데이터를 보게 됩니다. */
        '<span id="storemode" style="flex:none"></span>' +
        '<span class="avatar" style="background:var(--c-accent-hi);color:#0A192F" title="' + esc(user.name) + '">' +
          esc(user.initials) + '</span>' +
        '<button class="btn-icon" id="topbackup" aria-label="데이터 내보내기 및 가져오기" ' +
          'title="데이터 내보내기 · 가져오기" style="color:#8FA2BB">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
          'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
          '<path d="M7 10l5 5 5-5M12 15V3"/></svg></button>' +
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
    paintStore();

    const bk = document.getElementById("topbackup");
    if (bk && window.Backup) bk.addEventListener("click", () => window.Backup.open());
    document.getElementById("signout").addEventListener("click", () => window.Auth.signOut());

    /* 선택이 다른 경로로 바뀌어도 상단 셀렉터가 항상 실제 상태를 보여주도록
       동기화합니다. 화면마다 따로 갱신하면 반드시 어긋납니다. */
    if (hasScopeLayer()) {
      window.Scope.subscribe(function () {
        const el = document.getElementById("scope-select");
        if (el) el.innerHTML = scopeOptionsMarkup();
      });
    }

    /* ── Global AI ───────────────────────────────────────────────────────
       모든 화면이 이 함수를 거치므로, 여기 한 번만 붙이면 8개 페이지에
       같은 패널이 생깁니다. 화면마다 복사해 붙이면 언젠가 한 곳이
       뒤처지고, 그 화면만 다르게 동작합니다.

       ★ AI 가 없어도 화면은 그대로 동작해야 합니다. 모듈이 로드되지 않은
         페이지에서는 조용히 넘어갑니다 — 여기서 예외가 나면 그 화면 전체가
         멈춥니다. */
    try {
      if (window.AIContext) {
        window.AIContext.setPage(o.page || null);
        /* 필터가 바뀌면 AI 가 보는 화면 상태도 따라 바뀝니다 */
        if (window.Scope && window.Scope.subscribe) {
          window.Scope.subscribe(function () {
            if (window.Scope.batches) {
              window.Scope.batches().then(function (list) {
                window.AIContext.setVisibleBatches((list || []).map(b => b.id));
              }).catch(function () { window.AIContext.setVisibleBatches(null); });
            }
          });
        }
      }
      /* 회의 모드에는 붙이지 않습니다 — 여러 명이 한 화면을 보는 자리라
         개인 질의 이력이 노출되면 안 되고, 회의 전용 검색이 따로 있습니다. */
      const meeting = /meeting/i.test(String(o.page || "")) ||
                      document.body.classList.contains("meeting-mode");
      if (window.GlobalAIUI && !meeting) window.GlobalAIUI.mount();
    } catch (e) {
      /* AI 초기화 실패가 화면을 막지 않습니다 */
      if (window.console && console.warn) console.warn("Global AI 초기화 실패:", e);
    }

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

  /* ── 우측 레일은 없앴습니다 ───────────────────────────────────────────
     예전에는 여기서 모든 화면 오른쪽에 300px 짜리 미니 캘린더 · 다가오는
     일정 · 알림을 그렸습니다. 두 가지가 문제였습니다.

       · 일정을 보는 일은 일정 관리 화면의 일인데, Data 입력 · 데이터 조회
         처럼 표가 넓어야 하는 화면에서 그 300px 이 본문을 좁혔습니다.
         43개 컬럼짜리 표에서는 컬럼 두세 개가 화면 밖으로 밀려나는 폭입니다.
       · "알림(규격 이탈)" 블록은 판정 근거가 원본에 없어 oosItems() 가 늘
         빈 배열을 돌려주고 있었습니다. 자리만 차지하고 늘 같은 문장을
         띄우는 칸이었습니다.

     월 달력은 필요한 한 곳 — 일정 관리 본문 — 으로 옮겼습니다
     (schedule-page.js 의 monthCalendar). 레일의 날짜 선택 이벤트를 듣던
     화면은 없었습니다. */

  return { mount, subnav, project, setProject, on, logo };
})();
