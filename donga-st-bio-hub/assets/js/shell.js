/* ==========================================================================
   Shared application shell — sidebar, topbar, logo slot, session

   Every page calls Shell.mount({ page: "<id>" }). Keeps navigation in one
   place so adding a module means touching one file, not four.

   LOGO SLOT: drop the official artwork at assets/img/logo.svg (or .png and
   change LOGO_SRC). Until that file exists the <img> fails to load and the
   inline fallback mark is shown instead — never both.
   ========================================================================== */

window.Shell = (function () {
  "use strict";

  const LOGO_SRC = "assets/img/logo.svg";

  const NAV = [
    { group: "Overview", items: [
      { id: "dashboard", href: "dashboard.html", ko: "대시보드", en: "Dashboard",
        icon: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z', box: true }
    ]},
    { group: "연구 데이터", items: [
      { id: "explorer", href: "explorer.html", ko: "데이터 탐색", en: "Explorer",
        icon: 'M3 5h7l2 2h9v12H3z' },
      { id: "doe", href: "doe.html", ko: "DoE 공정개발", en: "Design of Experiments",
        icon: 'M4 19h16M7 19V9M12 19V5M17 19v-7' },
      { id: "schedule", href: "schedule.html", ko: "일정 관리", en: "Schedule",
        icon: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 9h16M9 3v4M15 3v4' }
    ]}
  ];

  function logoMarkup(size, onDark) {
    const fallbackId = "lf" + Math.random().toString(36).slice(2, 7);
    // Fallback mark: concentric rings + pointed petal, echoing the corporate emblem.
    const fb =
      '<svg id="' + fallbackId + '" class="brand-logo" viewBox="0 0 48 48" ' +
        'width="' + size + '" height="' + size + '" role="img" aria-label="Dong-A ST">' +
        '<circle cx="24" cy="24" r="21" fill="none" stroke="' + (onDark ? '#E58F95' : '#D97B83') + '" stroke-width="2.4"/>' +
        '<circle cx="24" cy="24" r="16.5" fill="none" stroke="' + (onDark ? '#E58F95' : '#D97B83') + '" stroke-width="1.4"/>' +
        '<path d="M24 9.5 32 24l-8 14.5L16 24z" fill="none" stroke="' + (onDark ? '#E58F95' : '#D97B83') + '" stroke-width="2.1" stroke-linejoin="round"/>' +
        '<path d="M24 9.5V38.5" stroke="' + (onDark ? '#E58F95' : '#D97B83') + '" stroke-width="1.2"/>' +
      '</svg>';
    return '<img class="brand-logo" src="' + LOGO_SRC + '" width="' + size + '" height="' + size + '" ' +
             'alt="Dong-A ST" ' +
             'onload="var f=document.getElementById(\'' + fallbackId + '\');if(f)f.remove();" ' +
             'onerror="this.remove();">' + fb;
  }

  function navMarkup(page) {
    return NAV.map(g =>
      '<div class="nav-group">' +
        '<div class="nav-group-label">' + g.group + '</div>' +
        g.items.map(it =>
          '<a class="nav-item" href="' + it.href + '"' + (it.id === page ? ' aria-current="page"' : '') + '>' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
              'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              (it.box ? '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/>' +
                        '<rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>'
                      : '<path d="' + it.icon + '"/>') +
            '</svg>' + it.ko +
          '</a>'
        ).join("") +
      '</div>'
    ).join("");
  }

  function mount(opts) {
    const page = (opts && opts.page) || "";
    const user = window.Auth.requireSession();
    if (!user) return null;
    const role = window.Auth.role();

    const sidebar = document.getElementById("sidebar");
    sidebar.innerHTML =
      '<div style="padding:var(--s-5) var(--s-5) var(--s-4)">' +
        '<a class="brand" href="dashboard.html" style="text-decoration:none;color:inherit">' +
          logoMarkup(30, true) +
          '<span style="min-width:0">' +
            '<span class="brand-name" style="display:block;color:#fff">동아에스티</span>' +
            '<span class="eyebrow" style="color:#8FA2BB">Bio Knowledge Hub</span>' +
          '</span>' +
        '</a>' +
      '</div>' +
      navMarkup(page) +
      '<div class="nav-group" style="margin-top:auto">' +
        '<div class="nav-group-label">데모 · View as</div>' +
        '<div style="display:grid;gap:3px">' +
          Object.keys(window.HUB.ROLES).map(r =>
            '<button class="nav-item" data-role-opt="' + r + '" style="width:100%;border:0;background:none;' +
              'cursor:pointer;text-align:left"' + (user.role === r ? ' aria-current="page"' : '') + '>' +
              window.HUB.ROLES[r].ko + '</button>'
          ).join("") +
        '</div>' +
      '</div>' +
      '<div style="padding:var(--s-4) var(--s-5);border-top:1px solid rgba(255,255,255,.08);' +
                  'display:flex;align-items:center;gap:10px">' +
        '<span class="avatar" style="background:var(--c-accent-hi);color:#0A192F">' + user.initials + '</span>' +
        '<span style="min-width:0;flex:1">' +
          '<span style="display:block;font-size:13px;font-weight:600;color:#fff">' + user.name + '</span>' +
          '<span style="display:block;font-size:10.5px;color:#8FA2BB;overflow:hidden;' +
                'text-overflow:ellipsis;white-space:nowrap">' + user.dept + '</span>' +
        '</span>' +
        '<button class="btn-icon" id="signout" aria-label="로그아웃 · Sign out" style="width:36px;height:36px;color:#8FA2BB">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
          '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>' +
        '</button>' +
      '</div>';

    // Topbar
    const tb = document.getElementById("topbar");
    if (tb) {
      tb.innerHTML =
        '<button class="btn-icon nav-toggle" id="nav-toggle" aria-label="메뉴 열기 · Open menu" aria-expanded="false">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
          '<path d="M3 6h18M3 12h18M3 18h18"/></svg>' +
        '</button>' +
        '<div style="font-size:13.5px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          (opts.title || "") + '</div>' +
        '<span class="badge badge-warn" style="margin-left:auto;flex:none" title="이 화면의 모든 수치는 예시입니다">' +
          '<span class="badge-dot"></span>샘플 데이터<span class="badge-sample-en"> · Sample data</span></span>' +
        '<div class="topbar-user" style="display:flex;align-items:center;gap:9px;padding-left:var(--s-3);' +
                    'border-left:1px solid var(--c-border)">' +
          '<div style="text-align:right;line-height:1.3">' +
            '<div style="font-size:12.5px;font-weight:600">' + user.name + '</div>' +
            '<div style="font-size:10.5px;color:var(--c-text-mute)">' + (role ? role.ko : "") + '</div>' +
          '</div>' +
        '</div>';
    }

    wire();
    return user;
  }

  function wire() {
    const sidebar = document.getElementById("sidebar");
    const scrim = document.getElementById("scrim");
    const toggle = document.getElementById("nav-toggle");

    if (toggle) {
      toggle.addEventListener("click", function () {
        const open = sidebar.classList.toggle("is-open");
        if (scrim) scrim.classList.toggle("is-open", open);
        toggle.setAttribute("aria-expanded", String(open));
      });
    }
    if (scrim) {
      scrim.addEventListener("click", function () {
        sidebar.classList.remove("is-open");
        scrim.classList.remove("is-open");
        if (toggle) toggle.setAttribute("aria-expanded", "false");
      });
    }
    const so = document.getElementById("signout");
    if (so) so.addEventListener("click", function () { window.Auth.signOut(); });

    Array.prototype.forEach.call(document.querySelectorAll("[data-role-opt]"), function (b) {
      b.addEventListener("click", function () {
        window.Auth.switchRole(b.dataset.roleOpt);
        window.location.reload();
      });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && sidebar.classList.contains("is-open")) {
        sidebar.classList.remove("is-open");
        if (scrim) scrim.classList.remove("is-open");
        if (toggle) toggle.setAttribute("aria-expanded", "false");
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        const s = document.querySelector(".ai-bar-input, #global-search");
        if (s) { e.preventDefault(); s.focus(); }
      }
    });
  }

  return { mount, logoMarkup };
})();
