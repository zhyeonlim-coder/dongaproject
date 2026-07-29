/* ==========================================================================
   오늘 할 일 — 아침에 여는 화면

   EBR 은 "배치 하나를 골라 자세히 적는" 화면입니다. 그런데 현업의 아침은
   반대입니다. 배치 열두 개의 Day 7 값을 한 번에 넣어야 합니다. 배치를
   열두 번 갈아끼우게 하면 아무도 매일 쓰지 않습니다.

   그래서 이 화면은 **배치 x 항목 그리드** 입니다. 한 화면에서 빈 칸만
   채우면 됩니다.

   ── 여기서는 새 값만 넣습니다 ───────────────────────────────────────────
   빈 칸은 최초 입력이라 사유가 필요 없어 바로 저장합니다. 이미 값이 있는
   칸은 회색으로 두고 EBR 로 보냅니다 — 값을 고치려면 사유가 필요하고,
   사유를 좁은 격자 칸에서 쓰게 하면 "수정" 두 글자만 남기 때문입니다.

   ── 과제를 안 골라도 열립니다 ───────────────────────────────────────────
   아침에 여는 화면인데 과제부터 고르라고 하면 한 단계가 더 생깁니다.
   기본은 전 과제이고, 상단에서 과제를 고르면 그 범위로 좁혀집니다.
   ========================================================================== */

(function () {
  "use strict";

  const user = window.Shell.mount({ page: "worklist" });
  if (!user) return;

  const L = window.LABELS, E = window.Entries, V = window.VAL, R = window.Repo;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  let team = "upstream";
  let onlyEmpty = true;          // 기본은 "빈 칸만" — 오늘 할 일이니까

  /* ── 대상 행 ────────────────────────────────────────────────────────────
     배양·정제는 배치, 분석은 시료가 행입니다 (분석값은 시료에 붙습니다).
     과제를 고르지 않았으면 전 과제를 봅니다 — 아침에 여는 화면이라
     과제부터 고르게 하면 한 단계가 더 생깁니다. */
  function rowsFor(t) {
    const sel = window.Scope.get();
    let batches;
    if (sel.scopeId) {
      const ids = R.studiesInScope(sel).map(x => x.id);
      batches = window.DATA_BATCHES.filter(b => ids.indexOf(b.studyId) > -1);
    } else {
      batches = window.DATA_BATCHES.slice();
    }
    batches = batches.filter(b => R.inRange(b, sel.from, sel.to));
    batches = R.sortRows(batches, sel.sort, "batch");

    if (t !== "analytics") {
      return batches.map(b => ({ id: b.id, label: b.id, scope: "batch:" + b.id,
                                 batch: b, sample: null,
                                 sub: (b.initialDate || "") + (b.endDate ? " ~ " + b.endDate : "") }));
    }
    const out = [];
    batches.forEach(function (b) {
      R.samplesOfBatch(b.id).forEach(function (s) {
        out.push({ id: s.id, label: s.name, scope: "sample:" + s.id,
                   batch: b, sample: s, sub: s.stage || b.id });
      });
    });
    return out;
  }

  /* 팀별 입력 항목 — 격자에 올릴 만큼만 추립니다.
     전 항목(분석 18개)을 다 늘어놓으면 가로로 못 읽습니다. */
  function itemsFor(t) {
    const out = [];
    window.DATA_ANALYTE_GROUPS.forEach(function (g) {
      if (g.empty || g.team !== t) return;
      g.items.forEach(it => out.push({
        key: R.fieldKey(g.id, it.key), gid: g.id, ik: it.key,
        label: it.label, unit: it.unit, dp: it.dp, item: it,
        group: g.label
      }));
    });
    return out;
  }

  /* 한 칸의 현재 상태 */
  function cellOf(row, m) {
    const rec = E.getValue(row.scope, m.key);
    if (rec) return { state: V.isFilled(rec.value) ? "filled" : "missing", rec: rec, value: rec.value };
    const raw = row.sample
      ? R.valueOfSample(row.sample, m.gid, m.ik)
      : R.valueOf(row.batch, m.gid, m.ik);
    if (raw !== null && raw !== undefined) return { state: "origin", rec: null, value: raw };
    return { state: "empty", rec: null, value: null };
  }

  /* ── 요약 ───────────────────────────────────────────────────────────── */
  function summary() {
    const s = window.Scope.get();
    const counts = window.DATA_TEAMS.map(function (t) {
      const rows = rowsFor(t.id), items = itemsFor(t.id);
      let empty = 0;
      rows.forEach(r => items.forEach(m => { if (cellOf(r, m).state === "empty") empty++; }));
      return { team: t, empty: empty, cells: rows.length * items.length };
    });

    const reqs = window.Requests.forSelection(s).filter(window.Requests.isOpen);
    const overdue = reqs.filter(r => { const d = window.Requests.due(r); return d && d.state === "over"; });
    const lotWarn = window.Lots.current().map(l => window.Lots.expiry(l))
      .filter(x => x && x.state !== "ok").length;

    const cards = counts.map(c =>
      '<button class="card stat" data-goteam="' + c.team.id + '" style="text-align:left;cursor:pointer;' +
        'border-left:3px solid ' + c.team.color + '">' +
        '<div class="stat-label">' + esc(c.team.ko) + ' 미입력</div>' +
        '<div class="stat-value">' + c.empty +
          '<span style="font-size:13px;font-weight:400;color:var(--c-text-soft)"> / ' + c.cells + ' 칸</span>' +
        '</div></button>').join("");

    return cards +
      '<a class="card stat" href="requests.html" style="text-decoration:none;color:inherit;' +
        'border-left:3px solid ' + (overdue.length ? "var(--c-risk)" : "var(--c-accent)") + '">' +
        '<div class="stat-label">진행 중 분석 의뢰</div>' +
        '<div class="stat-value">' + reqs.length +
          '<span style="font-size:13px;font-weight:400;color:' +
            (overdue.length ? "var(--c-risk)" : "var(--c-text-soft)") + '"> 건' +
            (overdue.length ? " · 기한 초과 " + overdue.length : "") + '</span></div></a>' +
      '<div class="card stat" style="border-left:3px solid ' +
        (lotWarn ? "var(--c-warn)" : "var(--c-border)") + '">' +
        '<div class="stat-label">자재 유효기간 확인</div>' +
        '<div class="stat-value">' + lotWarn +
          '<span style="font-size:13px;font-weight:400;color:var(--c-text-soft)"> 건</span></div></div>';
  }

  /* ── 격자 ───────────────────────────────────────────────────────────── */
  function grid() {
    const rows = rowsFor(team);
    const items = itemsFor(team);
    if (!rows.length || !items.length) {
      return '<div class="empty"><div class="empty-title">' + esc(L.noResult) + '</div>' +
        '<div class="empty-body">' + esc(L.noResultHint) + '</div></div>';
    }

    const shown = onlyEmpty
      ? rows.filter(r => items.some(m => cellOf(r, m).state === "empty"))
      : rows;

    if (!shown.length) {
      return '<div class="empty"><div class="empty-title">빈 칸이 없습니다</div>' +
        '<div class="empty-body">이 팀의 입력이 모두 채워져 있습니다. ' +
        '"전체 보기"로 바꾸면 기존 값도 함께 볼 수 있습니다.</div></div>';
    }

    return '<div class="tbl-scroll"><table class="tbl wl-grid">' +
      '<thead><tr><th scope="col" class="wl-head">' +
        (team === "analytics" ? "시료" : "Exp. No.") + '</th>' +
        items.map(m => '<th scope="col">' + esc(m.label) +
          '<br><span style="font-weight:400;text-transform:none">' + esc(m.unit) + '</span></th>').join("") +
      '</tr></thead><tbody>' +
      shown.map(function (r) {
        return '<tr><th scope="row" class="wl-head">' +
            '<span class="mono" style="font-weight:600">' + esc(r.label) + '</span>' +
            '<span style="display:block;font-size:10px;font-weight:400;color:var(--c-text-mute)">' +
              esc(r.sub || "") + '</span></th>' +
          items.map(function (m) {
            const c = cellOf(r, m);
            if (c.state === "empty") {
              return '<td class="wl-cell"><input class="ebr-input wl-input" type="text" ' +
                'inputmode="decimal" autocomplete="off" placeholder="—" ' +
                'data-row="' + esc(r.id) + '" data-key="' + esc(m.key) + '" ' +
                'aria-label="' + esc(r.label + " " + m.label) + '"></td>';
            }
            const txt = c.rec ? V.format(c.value, m.dp) : Number(c.value).toFixed(m.dp);
            return '<td class="wl-cell is-done"><span class="mono">' + esc(txt) + '</span>' +
              '<a class="wl-edit" href="ebr.html" title="값을 고치려면 EBR에서 사유와 함께">고치기</a></td>';
          }).join("") + '</tr>';
      }).join("") +
      '</tbody></table></div>' +
      '<p style="font-size:11.5px;color:var(--c-text-mute);margin:var(--s-3) 0 0;line-height:1.7">' +
        '빈 칸에 값을 넣고 <b>Enter</b> 또는 칸을 벗어나면 바로 저장됩니다 (최초 입력이라 사유 없이 저장). ' +
        '이미 값이 있는 칸을 고치려면 EBR 에서 변경 사유와 함께 저장해야 합니다.<br>' +
        '숫자 외에 <span class="mono">&lt;1</span> · <span class="mono">ND</span> · ' +
        '<span class="mono">NA</span> 도 넣을 수 있습니다.</p>';
  }

  function wireGrid() {
    const rows = rowsFor(team);
    const items = itemsFor(team);

    $$(".wl-input").forEach(function (inp) {
      function save() {
        const row = rows.find(r => r.id === inp.dataset.row);
        const m = items.find(x => x.key === inp.dataset.key);
        if (!row || !m) return;
        const raw = inp.value.trim();
        if (!raw) return;

        const p = V.parse(raw);
        if (!p.ok) { flag(inp, p.error); return; }
        const rangeErr = V.checkRange(p.val, m.item);
        if (rangeErr) { flag(inp, rangeErr); return; }

        /* 빈 칸이라 baseValue 가 없습니다 — 최초 입력이므로 사유 불필요 */
        const res = E.setValue(row.scope, m.key, p.val, null, { baseValue: null });
        if (!res.ok) { flag(inp, res.reason || "저장하지 못했습니다"); return; }

        inp.classList.remove("is-invalid");
        inp.classList.add("is-saved");
        const msg = $("#wl-msg");
        msg.textContent = row.label + " · " + m.label + " 저장됨";
        clearTimeout(wireGrid._t);
        wireGrid._t = setTimeout(() => { msg.textContent = ""; }, 2200);
      }

      inp.addEventListener("change", save);
      inp.addEventListener("keydown", function (e) {
        if (e.key !== "Enter") return;
        e.preventDefault();
        save();
        /* 같은 열의 다음 행으로 — 세로로 훑으며 넣는 게 자연스럽습니다 */
        const same = $$('.wl-input[data-key="' + inp.dataset.key + '"]');
        const i = same.indexOf(inp);
        if (i > -1 && same[i + 1]) same[i + 1].focus();
      });
    });

    function flag(inp, msg) {
      inp.classList.add("is-invalid");
      inp.classList.remove("is-saved");
      const m = $("#wl-msg");
      m.textContent = msg;
      m.style.color = "var(--c-risk)";
      clearTimeout(flag._t);
      flag._t = setTimeout(() => { m.textContent = ""; m.style.color = ""; }, 4000);
    }
  }

  /* ── 우측: 오늘 챙길 것 ─────────────────────────────────────────────── */
  function sidePanels() {
    const sel = window.Scope.get();
    const reqs = window.Requests.forSelection(sel).filter(window.Requests.isOpen).slice(0, 5);
    const lots = window.Lots.current().map(l => ({ lot: l, ex: window.Lots.expiry(l) }))
      .filter(x => x.ex && x.ex.state !== "ok");
    const heavy = window.Lots.current().map(function (l) {
      const u = window.Lots.usage(l);
      return u && u.limit && u.used / u.limit >= 0.5 ? { lot: l, u: u } : null;
    }).filter(Boolean);

    return '<section class="card" style="margin-bottom:var(--s-4)">' +
        '<div class="card-head"><div><h2 class="card-title">진행 중 분석 의뢰</h2>' +
        '<p class="card-sub">기한이 급한 순</p></div>' +
        '<a class="btn btn-ghost btn-sm" href="requests.html">전체</a></div>' +
        '<div class="card-body">' +
          (reqs.length ? reqs.map(function (r) {
            const d = window.Requests.due(r);
            const st = window.Requests.STATUS[r.status];
            return '<a class="rail-event" href="requests.html" style="text-decoration:none;color:inherit">' +
              '<span class="rail-event-bar" style="background:' +
                (d && d.state === "over" ? "var(--c-risk)" : "var(--c-accent)") + '"></span>' +
              '<span style="min-width:0;flex:1">' +
                '<span style="display:block;font-size:12.5px;font-weight:500">' +
                  esc(r.id) + ' · ' + esc(r.purpose) + '</span>' +
                '<span style="display:flex;gap:6px;align-items:center;margin-top:3px;flex-wrap:wrap">' +
                  '<span class="badge badge-' + st.tone + '" style="font-size:10px">' + esc(st.ko) + '</span>' +
                  (d ? '<span class="mono" style="font-size:10.5px;color:' +
                    (d.state === "over" ? "var(--c-risk)" : "var(--c-text-mute)") + '">' +
                    (d.state === "over" ? "기한 " + (-d.days) + "일 초과"
                      : d.days === 0 ? "오늘 마감" : "D-" + d.days) + '</span>' : "") +
                '</span></span></a>';
          }).join("")
          : '<p style="font-size:12.5px;color:var(--c-text-mute);margin:0">진행 중인 의뢰가 없습니다.</p>') +
        '</div></section>' +

      '<section class="card">' +
        '<div class="card-head"><div><h2 class="card-title">자재 확인</h2>' +
        '<p class="card-sub">유효기간과 사용 한도</p></div></div>' +
        '<div class="card-body">' +
          (lots.length || heavy.length
            ? lots.map(x =>
                '<div class="rail-event"><span class="rail-event-bar" style="background:' +
                  (x.ex.state === "expired" ? "var(--c-risk)" : "var(--c-warn)") + '"></span>' +
                '<span style="min-width:0;flex:1">' +
                  '<span style="display:block;font-size:12.5px;font-weight:500">' +
                    esc(x.lot.name) + ' <span class="mono">' + esc(x.lot.lotNo) + '</span></span>' +
                  '<span style="display:block;font-size:10.5px;color:var(--c-text-mute)">' +
                    (x.ex.state === "expired" ? "유효기간 " + (-x.ex.days) + "일 지남"
                      : "유효기간 D-" + x.ex.days) + ' · ' + esc(x.ex.expiryAt) + '</span>' +
                '</span></div>').join("") +
              heavy.map(x =>
                '<div class="rail-event"><span class="rail-event-bar" style="background:var(--c-warn)"></span>' +
                '<span style="min-width:0;flex:1">' +
                  '<span style="display:block;font-size:12.5px;font-weight:500">' +
                    esc(x.lot.name) + ' <span class="mono">' + esc(x.lot.lotNo) + '</span></span>' +
                  '<span style="display:block;font-size:10.5px;color:var(--c-text-mute)">' +
                    x.u.used + " / " + x.u.limit + " " + x.u.unit +
                    ' (' + Math.round(x.u.used / x.u.limit * 100) + '%)</span>' +
                '</span></div>').join("")
            : '<p style="font-size:12.5px;color:var(--c-text-mute);margin:0">확인할 자재가 없습니다.</p>') +
        '</div></section>';
  }

  /* ── 렌더 ───────────────────────────────────────────────────────────── */
  function paintSubnav() {
    window.Shell.subnav([
      { label: "입력할 팀", items: window.DATA_TEAMS.map(t => ({
        key: t.id, ko: t.ko, active: team === t.id, color: t.color })) },
      { label: "보기", items: [
        { key: "__empty", ko: onlyEmpty ? "빈 칸만 보는 중" : "전체 보는 중" }
      ]},
      { label: "바로가기", items: [
        { ko: "EBR 입력", href: "ebr.html" },
        { ko: "분석 의뢰", href: "requests.html" },
        { ko: "대시보드", href: "dashboard.html" }
      ]}
    ], function (k) {
      if (k === "__empty") onlyEmpty = !onlyEmpty;
      else team = k;
      render();
    });
  }

  function render() {
    paintSubnav();
    const desc = window.Scope.describe();
    const teamKo = (window.DATA_TEAMS.find(t => t.id === team) || {}).ko || team;

    $("#page-title").textContent = "오늘 할 일 · " + teamKo;
    $("#crumb").innerHTML = desc.scope
      ? '<span>' + esc(desc.scope) + '</span>'
      : '<span style="color:var(--c-text-mute)">전 과제</span>';

    $("#kpi").innerHTML = summary();

    $("#body").innerHTML =
      '<section class="card" style="margin-bottom:var(--s-4)">' +
        '<div class="card-head" style="flex-wrap:wrap;gap:var(--s-3)"><div>' +
          '<h2 class="card-title">' + esc(teamKo) + ' 입력 격자</h2>' +
          '<p class="card-sub">배치와 항목을 한 화면에 펼쳐 빈 칸만 채웁니다</p></div>' +
          '<span id="wl-msg" style="font-size:12px;color:var(--c-ok);font-weight:600"></span>' +
        '</div>' +
        '<div class="card-body">' + grid() + '</div>' +
      '</section>' +
      sidePanels();

    wireGrid();
    $$("[data-goteam]").forEach(b => b.addEventListener("click", function () {
      team = b.dataset.goteam; render();
    }));
  }

  window.StudySelector.mount($("#selector"), { showResults: false });
  window.Scope.subscribe(render);
  window.Entries.subscribe(render);
  window.Requests.subscribe(render);
  render();
})();
