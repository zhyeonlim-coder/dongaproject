/* ==========================================================================
   Resource booking — equipment time-slot reservation

   Day view is a slot grid (equipment × hour); week view shows occupancy per
   day. Double-booking is blocked by Store.conflict(), which does a real
   interval-overlap test (start < other.end && end > other.start) rather than
   comparing slot labels — so a 2-hour booking cannot straddle an existing one.
   ========================================================================== */

(function () {
  "use strict";

  const user = window.Shell.mount({ page: "booking" });
  if (!user) return;

  const L = window.LAB, S = window.Store;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const OPEN = 8, CLOSE = 20;                       // lab hours
  const HOURS = [];
  for (let h = OPEN; h < CLOSE; h++) HOURS.push(String(h).padStart(2, "0") + ":00");

  let dept = "all";
  let date = S.today();
  let view = "day";
  let pending = null;                               // {equip, start}

  function equipment() {
    return L.EQUIPMENT.filter(e => dept === "all" || e.dept === dept);
  }

  /* ── Sub-menu ───────────────────────────────────────────────────────── */
  function paintSubnav() {
    const counts = {};
    L.EQUIPMENT.forEach(e => { counts[e.dept] = (counts[e.dept] || 0) + 1; });
    window.Shell.subnav([
      { label: "부서 필터", items: [
        { key: "all", ko: "전체 장비", active: dept === "all", count: L.EQUIPMENT.length },
        { key: "culture",  ko: L.DEPTS.culture.ko,  active: dept === "culture",  color: L.DEPTS.culture.color,  count: counts.culture },
        { key: "purif",    ko: L.DEPTS.purif.ko,    active: dept === "purif",    color: L.DEPTS.purif.color,    count: counts.purif },
        { key: "analysis", ko: L.DEPTS.analysis.ko, active: dept === "analysis", color: L.DEPTS.analysis.color, count: counts.analysis }
      ]},
      { label: "바로가기", items: [
        { ko: "대시보드", href: "dashboard.html" },
        { ko: "EBR 입력", href: "ebr.html" }
      ]}
    ], k => { dept = k; pending = null; paint(); });
  }

  function toast(msg, kind) {
    const t = $("#toast");
    t.innerHTML = '<div class="card" style="border-left:3px solid ' +
      (kind === "err" ? "var(--c-risk)" : "var(--c-ok)") + ';padding:var(--s-3) var(--s-4);font-size:13px">' +
      esc(msg) + '</div>';
    t.style.display = "block";
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.style.display = "none"; }, 3600);
  }

  /* ── Day grid ───────────────────────────────────────────────────────── */
  function dayGrid() {
    const eq = equipment();
    const now = new Date();
    const isToday = date === S.today();

    return '<div class="tbl-scroll"><div class="slot-grid" style="min-width:760px">' +
      '<div class="slot-row" style="margin-bottom:2px">' +
        '<span class="eyebrow">장비</span>' +
        '<div class="slot-hours" style="grid-template-columns:repeat(' + HOURS.length + ',1fr)">' +
          HOURS.map(h => '<span style="text-align:center">' + h + '</span>').join("") +
        '</div></div>' +

      eq.map(e => {
        const d = L.DEPTS[e.dept];
        return '<div class="slot-row">' +
          '<div style="min-width:0">' +
            '<div style="display:flex;align-items:center;gap:6px">' +
              '<span class="subnav-dot" style="background:' + d.color + '"></span>' +
              '<strong class="mono" style="font-size:12.5px">' + esc(e.id) + '</strong></div>' +
            '<div style="font-size:10.5px;color:var(--c-text-mute);padding-left:13px;overflow:hidden;' +
              'text-overflow:ellipsis;white-space:nowrap">' + esc(e.ko) + '</div>' +
          '</div>' +
          '<div class="slot-track" style="grid-template-columns:repeat(' + HOURS.length + ',1fr)">' +
            HOURS.map(h => {
              const end = nextHour(h);
              const bk = S.bookings(e.id, date).find(b => h >= b.start && h < b.end);
              const past = isToday && +h.slice(0, 2) < now.getHours();
              if (bk) {
                const mine = bk.who === user.name;
                return '<button class="slot" data-state="' + (mine ? "mine" : "booked") + '" ' +
                  'data-cancel="' + (mine ? bk.id : "") + '" ' +
                  'title="' + esc(bk.who + " · " + bk.purpose) + '" ' +
                  'aria-label="' + esc(e.id + " " + h + " " + bk.who + " 예약" + (mine ? ", 클릭하면 취소" : "")) + '"' +
                  (mine ? "" : " disabled") + '>' + esc(mine ? "내 예약" : bk.who) + '</button>';
              }
              if (past) return '<span class="slot" data-state="past" aria-label="' + h + ' 지난 시간"></span>';
              const sel = pending && pending.equip === e.id && pending.start === h;
              return '<button class="slot" data-book="' + esc(e.id) + '" data-start="' + h + '" ' +
                (sel ? 'style="background:var(--c-accent-bg);border-color:var(--c-accent);color:var(--c-accent)" ' : "") +
                'aria-label="' + esc(e.id + " " + h + "–" + end + " 예약 가능") + '">' +
                (sel ? "선택됨" : "") + '</button>';
            }).join("") +
          '</div></div>';
      }).join("") +
    '</div></div>';
  }

  /* ── Week grid ──────────────────────────────────────────────────────── */
  function weekGrid() {
    const eq = equipment();
    const start = weekStart(date);
    const days = [];
    for (let i = 0; i < 7; i++) days.push(S.addDays(start, i));
    const dow = ["일", "월", "화", "수", "목", "금", "토"];

    return '<div class="tbl-scroll"><div class="slot-grid" style="min-width:680px">' +
      '<div class="slot-row" style="margin-bottom:2px">' +
        '<span class="eyebrow">장비</span>' +
        '<div class="slot-hours" style="grid-template-columns:repeat(7,1fr)">' +
          days.map((d, i) => '<span style="text-align:center">' + dow[i] + ' ' + d.slice(8) + '</span>').join("") +
        '</div></div>' +
      eq.map(e => {
        const dp = L.DEPTS[e.dept];
        return '<div class="slot-row">' +
          '<div style="min-width:0"><div style="display:flex;align-items:center;gap:6px">' +
            '<span class="subnav-dot" style="background:' + dp.color + '"></span>' +
            '<strong class="mono" style="font-size:12.5px">' + esc(e.id) + '</strong></div>' +
            '<div style="font-size:10.5px;color:var(--c-text-mute);padding-left:13px">' + esc(e.ko) + '</div></div>' +
          '<div class="slot-track" style="grid-template-columns:repeat(7,1fr)">' +
            days.map(d => {
              const n = S.bookings(e.id, d).length;
              const pct = Math.min(100, (n / HOURS.length) * 100);
              return '<button class="slot" data-day="' + d + '" ' +
                'aria-label="' + esc(e.id + " " + d + " 예약 " + n + "건") + '" ' +
                'style="' + (n ? "background:linear-gradient(to top,var(--c-accent) " + pct +
                  "%,var(--c-paper) " + pct + "%);color:" + (pct > 40 ? "#fff" : "var(--c-text-mute)") : "") + '">' +
                (n ? n + "건" : "") + '</button>';
            }).join("") +
          '</div></div>';
      }).join("") +
    '</div></div>';
  }

  /* ── Booking form ───────────────────────────────────────────────────── */
  function bookingForm() {
    if (!pending) {
      return '<div class="empty" style="padding:var(--s-6) var(--s-4)">' +
        '<div class="empty-title">빈 슬롯을 선택하세요</div>' +
        '<div class="empty-body">좌측 격자에서 예약 가능한 시간을 클릭하면 예약 정보를 입력할 수 있습니다.</div></div>';
    }
    const e = L.EQUIPMENT.find(x => x.id === pending.equip);
    const studies = L.STUDIES.filter(s => s.prj === window.Shell.project());
    const durations = e.slotMin === 120 ? [2, 4] : [1, 2, 3, 4];

    return '<div class="card-body">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:var(--s-4)">' +
        '<span class="subnav-dot" style="background:' + L.DEPTS[e.dept].color + '"></span>' +
        '<strong class="mono">' + esc(e.id) + '</strong>' +
        '<span style="font-size:12px;color:var(--c-text-mute)">' + esc(e.ko) + ' · ' + esc(e.loc) + '</span>' +
      '</div>' +
      '<form id="bk-form">' +
        '<div class="ebr-grid" style="margin-bottom:var(--s-4)">' +
          cell("날짜", '<input class="ebr-input mono" value="' + esc(date) + '" readonly>') +
          cell("시작", '<input class="ebr-input mono" value="' + esc(pending.start) + '" readonly>') +
          cell("사용 시간", '<select class="ebr-input" id="bk-dur">' +
            durations.map(h => '<option value="' + h + '">' + h + '시간</option>').join("") + '</select>') +
          cell("사용자", '<input class="ebr-input" value="' + esc(user.name) + '" readonly>') +
          cell("연계 스터디", '<select class="ebr-input" id="bk-study">' +
            (studies.length ? studies.map(s => '<option value="' + s.id + '">Study #' + s.no + ' ' + esc(s.ko) + '</option>').join("")
                            : '<option value="">—</option>') + '</select>') +
          cell("사용 목적", '<input class="ebr-input" id="bk-purpose" placeholder="예: P2402-B SEC 분석">') +
        '</div>' +
        '<div style="display:flex;gap:var(--s-2)">' +
          '<button class="btn btn-accent" type="submit">예약</button>' +
          '<button class="btn btn-ghost" type="button" id="bk-cancel">취소</button>' +
        '</div>' +
        '<p class="field-error" id="bk-err" role="alert" style="margin-top:var(--s-3)"></p>' +
      '</form></div>';
  }

  /* Same implicit-association pattern as ebr.js — a bare <label> without `for`
     leaves the control with no accessible name. */
  function cell(label, control) {
    return '<label class="ebr-cell"><span>' + esc(label) + '</span>' + control + '</label>';
  }

  /* ── My bookings ────────────────────────────────────────────────────── */
  function myBookings() {
    const mine = S.state().bookings.filter(b => b.who === user.name).sort((a, b) =>
      (a.date + a.start).localeCompare(b.date + b.start));
    if (!mine.length) return '<p style="font-size:12.5px;color:var(--c-text-mute);margin:0">예약 내역이 없습니다.</p>';
    return mine.map(b => {
      const e = L.EQUIPMENT.find(x => x.id === b.equip);
      return '<div class="rail-event">' +
        '<span class="rail-event-bar" style="background:' + (e ? L.DEPTS[e.dept].color : "var(--c-accent)") + '"></span>' +
        '<span style="min-width:0;flex:1">' +
          '<span style="display:block;font-size:12.5px;font-weight:600" class="mono">' + esc(b.equip) + '</span>' +
          '<span style="display:block;font-size:11px;color:var(--c-text-mute)">' +
            esc(b.date) + ' ' + esc(b.start) + '–' + esc(b.end) + '</span>' +
          (b.purpose ? '<span style="display:block;font-size:11px;color:var(--c-text-soft)">' +
            esc(b.purpose) + '</span>' : "") +
        '</span>' +
        '<button class="btn-icon" data-drop="' + b.id + '" aria-label="예약 취소" style="width:30px;height:30px">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
          'aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
      '</div>';
    }).join("");
  }

  /* ── Helpers ────────────────────────────────────────────────────────── */
  function nextHour(h) { return String(+h.slice(0, 2) + 1).padStart(2, "0") + ":00"; }
  function addHours(h, n) { return String(Math.min(CLOSE, +h.slice(0, 2) + n)).padStart(2, "0") + ":00"; }
  function weekStart(iso) {
    const d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() - d.getDay());
    return S.localISO(d);          // local, not UTC — see Store.localISO
  }

  /* ── Paint ──────────────────────────────────────────────────────────── */
  function paint() {
    paintSubnav();
    $("#page-title").textContent = "장비 예약 · " + (dept === "all" ? "전체 장비" : L.DEPTS[dept].ko);

    $("#controls").innerHTML =
      '<div style="display:flex;gap:4px;padding:3px;background:var(--c-paper-2);border-radius:var(--r-md)">' +
        '<button class="track-tab" data-view="day" aria-selected="' + (view === "day") +
          '" style="min-height:34px;padding:0 14px">일간</button>' +
        '<button class="track-tab" data-view="week" aria-selected="' + (view === "week") +
          '" style="min-height:34px;padding:0 14px">주간</button>' +
      '</div>' +
      '<button class="btn btn-ghost btn-sm" id="d-prev" aria-label="이전 날짜">←</button>' +
      '<label class="sr-only" for="d-date">날짜</label>' +
      '<input class="input mono" id="d-date" type="date" value="' + esc(date) + '" ' +
        'style="min-height:34px;width:auto;font-size:12.5px">' +
      '<button class="btn btn-ghost btn-sm" id="d-next" aria-label="다음 날짜">→</button>' +
      '<button class="btn btn-ghost btn-sm" id="d-today">오늘</button>' +
      '<div style="margin-left:auto;display:flex;gap:var(--s-3);font-size:11.5px;color:var(--c-text-mute);flex-wrap:wrap">' +
        legendDot("var(--c-paper)", "예약 가능", true) +
        legendDot("var(--c-accent)", "예약됨") +
        legendDot("#6D28D9", "내 예약") +
        legendDot("var(--c-paper-2)", "지난 시간", true) +
      '</div>';

    $("#grid").innerHTML = view === "day" ? dayGrid() : weekGrid();
    $("#form").innerHTML = bookingForm();
    $("#mine").innerHTML = myBookings();

    wire();
  }

  function legendDot(bg, label, border) {
    return '<span style="display:flex;align-items:center;gap:5px"><span style="width:13px;height:13px;' +
      'border-radius:3px;background:' + bg + (border ? ";border:1px solid var(--c-border)" : "") +
      '"></span>' + esc(label) + '</span>';
  }

  function wire() {
    $$("[data-view]").forEach(b => b.addEventListener("click", () => { view = b.dataset.view; pending = null; paint(); }));
    $("#d-prev").addEventListener("click", () => { date = S.addDays(date, view === "week" ? -7 : -1); pending = null; paint(); });
    $("#d-next").addEventListener("click", () => { date = S.addDays(date, view === "week" ? 7 : 1); pending = null; paint(); });
    $("#d-today").addEventListener("click", () => { date = S.today(); pending = null; paint(); });
    $("#d-date").addEventListener("change", function () { date = this.value; pending = null; paint(); });

    $$("[data-book]").forEach(b => b.addEventListener("click", () => {
      pending = { equip: b.dataset.book, start: b.dataset.start };
      paint();
      const p = $("#bk-purpose"); if (p) p.focus();
    }));

    $$("[data-day]").forEach(b => b.addEventListener("click", () => {
      date = b.dataset.day; view = "day"; pending = null; paint();
    }));

    $$("[data-cancel]").forEach(b => {
      if (!b.dataset.cancel) return;
      b.addEventListener("click", () => {
        S.cancelBooking(b.dataset.cancel);
        toast("예약을 취소했습니다.");
        paint();
      });
    });

    $$("[data-drop]").forEach(b => b.addEventListener("click", () => {
      S.cancelBooking(b.dataset.drop);
      toast("예약을 취소했습니다.");
      paint();
    }));

    const f = $("#bk-form");
    if (f) {
      f.addEventListener("submit", e => {
        e.preventDefault();
        const err = $("#bk-err");
        const dur = +$("#bk-dur").value;
        const end = addHours(pending.start, dur);
        if (end <= pending.start) {
          err.textContent = "종료 시간이 시작보다 빨라 예약할 수 없습니다";
          err.classList.add("is-shown"); return;
        }
        const res = S.book({ equip: pending.equip, date, start: pending.start, end,
          who: user.name, purpose: $("#bk-purpose").value.trim() || "—", study: $("#bk-study").value });

        if (!res.ok) {
          const c = res.conflict;
          err.textContent = "중복 예약입니다 — " + c.who + "님이 " + c.start + "–" + c.end + " 사용 중입니다.";
          err.classList.add("is-shown");
          toast("중복 예약이 차단되었습니다.", "err");
          return;
        }
        err.classList.remove("is-shown");
        toast(pending.equip + " " + pending.start + "–" + end + " 예약이 등록되었습니다.");
        pending = null;
        paint();
      });
      $("#bk-cancel").addEventListener("click", () => { pending = null; paint(); });
    }
  }

  window.Shell.on("project", paint);
  paint();
})();
