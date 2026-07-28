/* ==========================================================================
   Schedule module

   Long-term  (PL 관점)  : project Gantt, deadlines, today's tasks
   Short-term (연구원)   : self-entered culture / purification / analysis dates

   Short-term entries persist to localStorage so an added item survives a
   refresh. INTEGRATION: swap the store for the real scheduling API.
   ========================================================================== */

(function () {
  "use strict";

  const R = window.RND;
  const user = window.Shell.mount({ page: "schedule", title: "일정 관리 · Schedule" });
  if (!user) return;

  window.Shell.subnav([
    { label: "일정", items: [
      { ko: "전체 일정", href: "schedule.html", active: true },
      { ko: "장비 예약", href: "booking.html" }
    ]},
    { label: "바로가기", items: [
      { ko: "대시보드", href: "dashboard.html" },
      { ko: "EBR 입력", href: "ebr.html" },
      { ko: "DoE & Intelligence", href: "hub.html" }
    ]}
  ]);

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const STORE = "hub.schedule." + user.email;

  function load() {
    try {
      const raw = localStorage.getItem(STORE);
      return raw ? JSON.parse(raw) : R.TASKS_SHORT.slice();
    } catch (e) { return R.TASKS_SHORT.slice(); }
  }
  function save(items) {
    try { localStorage.setItem(STORE, JSON.stringify(items)); } catch (e) { /* private mode */ }
  }

  let shortItems = load();

  /* ── Long-term Gantt ────────────────────────────────────────────────── */
  function paintGantt() {
    const rows = R.GANTT;
    const byPrj = {};
    rows.forEach(r => { (byPrj[r.prj] = byPrj[r.prj] || []).push(r); });

    $("#gantt").innerHTML =
      '<div class="gantt-head">' +
        '<div class="eyebrow">과제 · 활동</div>' +
        '<div class="gantt-months">' +
          R.GANTT_MONTHS.map(m => '<span class="gantt-month">' + esc(m) + '</span>').join("") +
        '</div>' +
      '</div>' +
      Object.keys(byPrj).map(prj => {
        const p = R.PROJECTS.find(x => x.id === prj);
        return '<div class="gantt-row" style="min-height:30px">' +
            '<div class="gantt-name" style="font-weight:600;font-size:12px">' + esc(p ? p.ko : prj) + '</div>' +
            '<div></div>' +
          '</div>' +
          byPrj[prj].map(r => {
            const left = (r.start / 12) * 100, width = ((r.end - r.start) / 12) * 100;
            return '<div class="gantt-row">' +
              '<div class="gantt-name" style="padding-left:10px;color:var(--c-text-mute)">' + esc(r.ko) + '</div>' +
              '<div class="gantt-track">' +
                '<div class="gantt-grid" aria-hidden="true">' + R.GANTT_MONTHS.map(() => '<span></span>').join("") + '</div>' +
                '<div class="gantt-bar" style="left:' + left.toFixed(2) + '%;width:' + width.toFixed(2) + '%;background:' + r.color + '"' +
                  ' title="' + esc(r.ko) + '">' + esc(r.ko) + '</div>' +
                '<div class="gantt-today" style="left:' + ((R.GANTT_TODAY / 12) * 100).toFixed(2) + '%" ' +
                  'title="오늘"></div>' +
              '</div>' +
            '</div>';
          }).join("");
      }).join("");

    // Text equivalent for the chart
    $("#gantt-table").innerHTML =
      '<caption class="sr-only">과제별 일정</caption><thead><tr><th scope="col">과제</th><th scope="col">활동</th>' +
      '<th scope="col">시작(월)</th><th scope="col">종료(월)</th></tr></thead><tbody>' +
      rows.map(r => '<tr><th scope="row">' + esc(r.prj) + '</th><td>' + esc(r.ko) + '</td>' +
        '<td>' + r.start.toFixed(1) + '</td><td>' + r.end.toFixed(1) + '</td></tr>').join("") + '</tbody>';
  }

  /* ── Today's tasks ──────────────────────────────────────────────────── */
  let today = R.TASKS_TODAY.map(t => Object.assign({}, t));

  function paintToday() {
    const left = today.filter(t => !t.done).length;
    $("#today-count").textContent = left + "건 남음";
    $("#today").innerHTML = today.map((t, i) =>
      '<div class="task' + (t.done ? " is-done" : "") + '">' +
        '<input class="task-check" type="checkbox" id="tk-' + i + '"' + (t.done ? " checked" : "") + '>' +
        '<label for="tk-' + i + '" style="flex:1;min-width:0;cursor:pointer">' +
          '<span class="task-title" style="display:block">' + esc(t.ko) + '</span>' +
          '<span style="display:flex;gap:8px;align-items:center;margin-top:3px">' +
            '<span class="badge">' + esc(t.kind) + '</span>' +
            '<span style="font-size:11.5px;color:var(--c-text-mute)">' + esc(t.due) + '</span>' +
          '</span>' +
        '</label>' +
      '</div>').join("");

    $$("#today .task-check").forEach((c, i) =>
      c.addEventListener("change", function () { today[i].done = c.checked; paintToday(); }));
  }

  /* ── Short-term list ────────────────────────────────────────────────── */
  function paintShort() {
    if (!shortItems.length) {
      $("#short").innerHTML =
        '<div class="empty">' +
          '<div class="empty-title">등록된 일정이 없습니다</div>' +
          '<div class="empty-body">배양 착수·종료, 정제, 분석, 회의 일정을 직접 추가해 관리하세요.</div>' +
        '</div>';
      return;
    }
    const sorted = shortItems.slice().sort((a, b) => a.date.localeCompare(b.date));
    $("#short").innerHTML = sorted.map((t) =>
      '<div class="task" style="align-items:center">' +
        '<span style="width:4px;align-self:stretch;border-radius:2px;background:' + (t.color || "var(--c-accent-mid)") + '"></span>' +
        '<div style="flex:1;min-width:0">' +
          '<div class="task-title">' + esc(t.ko) + '</div>' +
          '<div style="display:flex;gap:8px;align-items:center;margin-top:3px">' +
            '<span class="badge">' + esc(t.kind) + '</span>' +
            '<span class="mono" style="font-size:11.5px;color:var(--c-text-mute)">' + esc(t.date) + '</span>' +
          '</div>' +
        '</div>' +
        '<button class="btn-icon" data-rm="' + esc(t.ko) + '" aria-label="' + esc(t.ko) + ' 일정 삭제" ' +
          'style="width:34px;height:34px">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
          '<path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
      '</div>').join("");

    $$("#short [data-rm]").forEach(b => b.addEventListener("click", function () {
      shortItems = shortItems.filter(x => x.ko !== b.dataset.rm);
      save(shortItems); paintShort();
    }));
  }

  /* ── Add form ───────────────────────────────────────────────────────── */
  const KINDS = {
    "배양": "var(--c-accent-mid)", "정제": "#6D28D9", "분석": "#0F766E",
    "회의": "var(--c-text-mute)", "계획": "#B45309"
  };

  $("#add-form").addEventListener("submit", function (e) {
    e.preventDefault();
    const ko = $("#s-title").value.trim();
    const date = $("#s-date").value;
    const kind = $("#s-kind").value;
    const err = $("#s-err");

    if (!ko || !date) {
      err.textContent = !ko ? "일정 내용을 입력하세요" : "날짜를 선택하세요";
      err.classList.add("is-shown");
      (!ko ? $("#s-title") : $("#s-date")).focus();
      return;
    }
    err.classList.remove("is-shown");
    shortItems.push({ ko, date, kind, color: KINDS[kind] || "var(--c-accent-mid)" });
    save(shortItems);
    $("#s-title").value = "";
    paintShort();
    $("#s-title").focus();
  });

  $("#s-title").addEventListener("input", () => $("#s-err").classList.remove("is-shown"));

  $("#reset-short").addEventListener("click", function () {
    shortItems = R.TASKS_SHORT.slice();
    save(shortItems);
    paintShort();
  });

  paintGantt();
  paintToday();
  paintShort();
})();
