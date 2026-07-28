/* ==========================================================================
   회의 모드  [지시서 §6]

   개요 + 상세 2단 구조
     개요 : 배양 / 정제 / 분석 핵심 지표를 한 화면에 · 이상 항목 강조
     상세 : 팀 카드 클릭 → 해당 팀 전체 파라미터 · Day 추이 · 원본 테이블
            브레드크럼으로 언제든 개요 복귀, 선택·필터는 유지

   인터랙티브 필터
     · 표시할 팀 (체크박스)
     · 표시할 파라미터 (그룹 선택)
     · 정렬 기준 (배치번호 / 값 / 날짜)
     · 조합을 프리셋으로 저장해 다음 회의에서 재사용
   ========================================================================== */

window.MeetingView = (function () {
  "use strict";

  const L = window.LABELS, E = window.Entries, C = window.Charts;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmt = (v, dp) => (v === null || v === undefined || !isFinite(v)) ? L.empty : Number(v).toFixed(dp);

  const PRESET_KEY = "hub.presets.v1";

  /* 보기 상태 — 프리셋으로 저장되는 대상 */
  let view = {
    detail: null,                                   // null = 개요, "upstream" 등 = 상세
    teams: { upstream: true, downstream: true, analytics: true },
    groups: "all",
    sortKey: "id",
    sortDir: 1
  };

  function presets() {
    try { return JSON.parse(localStorage.getItem(PRESET_KEY) || "[]"); } catch (e) { return []; }
  }
  function savePresets(list) {
    try { localStorage.setItem(PRESET_KEY, JSON.stringify(list)); } catch (e) {}
  }

  /* 오버레이 안에서는 좌측 서브메뉴를 쓸 수 없으므로 상단 탭으로 대체합니다. */
  function viewTabs() {
    const tabs = [{ key: "overview", ko: "개요" }]
      .concat(window.DATA_TEAMS.map(t => ({ key: t.id, ko: t.ko + " 상세" })));
    return '<div class="mm-pills" style="flex:1">' + tabs.map(t =>
      '<button class="mm-pill" data-view="' + t.key + '"' +
        ((t.key === "overview" ? !view.detail : view.detail === t.key) ? ' aria-current="true"' : "") +
        '>' + esc(t.ko) + '</button>').join("") + '</div>';
  }

  /* ── 이상 항목 판정 ─────────────────────────────────────────────────────
     원본 Excel에 규격(spec) 한계값이 없어 Pass/Fail 을 계산할 근거가 없습니다.
     따라서 "미입력"만 이상 항목으로 강조하고, Fail 판정은 규격표가 들어온 뒤
     활성화합니다. 근거 없이 Pass 로 칠하지 않습니다. */
  function issues(batches) {
    const out = [];
    batches.forEach(b => window.DATA_ANALYTE_GROUPS.forEach(g => {
      if (g.empty) return;
      g.items.forEach(it => {
        if (window.Repo.valueOf(b, g.id, it.key) === null)
          out.push({ batch: b.id, group: g.label, item: it.label, team: g.team });
      });
    }));
    return out;
  }

  /* ── 개요 ───────────────────────────────────────────────────────────── */
  function overview(batches, teamSets) {
    const iss = issues(batches);
    const byTeam = {};
    iss.forEach(i => { byTeam[i.team] = (byTeam[i.team] || 0) + 1; });

    const cards = teamSets.filter(t => view.teams[t.team]).map(function (t) {
      const m = metricsOf(t.team, batches);
      const missing = byTeam[t.team] || 0;
      return '<section class="card team-card" style="--team:' + t.color + '">' +
        '<div class="team-head"><div>' +
          '<div class="team-name">' + esc(t.ko) + '</div>' +
          '<div style="font-size:11px;color:var(--c-text-mute)">' +
            (!t.defined ? "원본 데이터 없음" : t.filled + "/" + t.total + " 입력") + '</div></div>' +
          (missing
            ? '<span class="spec spec-oos">미입력 ' + missing + '</span>'
            : t.defined ? '<span class="spec spec-pass">완전</span>'
                        : '<span class="spec spec-none">없음</span>') +
        '</div>' +
        '<div class="team-metrics">' + m.map(x =>
          '<div class="team-metric"><span class="team-metric-k">' + esc(x.k) + '</span>' +
          '<span class="team-metric-v"' + (x.v === L.empty ? ' style="color:var(--c-text-soft)"' : "") + '>' +
            esc(x.v) + (x.u ? '<span class="team-metric-u">' + esc(x.u) + '</span>' : "") +
          '</span></div>').join("") + '</div>' +
        '<div class="card-body" style="padding-top:0">' +
          '<button class="btn btn-ghost btn-sm" data-detail="' + t.team + '" style="width:100%">' +
            '상세 보기 →</button></div>' +
      '</section>';
    }).join("");

    return '<div class="team-grid" style="margin-bottom:var(--s-4)">' + cards + '</div>' +

      '<section class="card" style="margin-bottom:var(--s-4)">' +
        '<div class="card-head"><div><h2 class="card-title">3팀 통합 뷰</h2>' +
        '<p class="card-sub">한 화면에서 배양 · 정제 · 분석을 나란히 비교</p></div></div>' +
        integratedTable(batches) + '</section>' +

      (iss.length
        ? '<section class="card" style="border-left:3px solid var(--c-warn)">' +
          '<div class="card-head"><div><h2 class="card-title">확인 필요 항목</h2>' +
          '<p class="card-sub">미입력 ' + iss.length + '건 · 규격표가 없어 Fail 판정은 계산하지 않습니다</p></div></div>' +
          '<div class="card-body" style="display:flex;gap:6px;flex-wrap:wrap">' +
            Object.keys(byTeam).map(k => {
              const t = window.DATA_TEAMS.find(x => x.id === k) || {};
              return '<span class="badge badge-warn">' + esc(t.short || k) + ' 미입력 ' + byTeam[k] + '</span>';
            }).join("") + '</div></section>'
        : "");
  }

  function metricsOf(team, batches) {
    const num = f => batches.map(f).filter(v => v !== null && isFinite(v));
    const avg = a => a.length ? fmt(a.reduce((x, y) => x + y, 0) / a.length, 1) : L.empty;
    if (team === "upstream") {
      const t = num(b => b.upstream.titerHCCF), v = num(b => b.upstream.finalViability);
      return [
        { k: "최고 Titer", v: t.length ? fmt(Math.max.apply(null, t), 0) : L.empty, u: "mg/L" },
        { k: "평균 Titer", v: avg(t), u: "mg/L" },
        { k: "평균 Viability", v: avg(v), u: "%" }
      ];
    }
    if (team === "downstream") {
      const d = k => num(b => b.downstream ? b.downstream[k] : null);
      return [
        { k: "평균 Total Yield", v: avg(d("totalYield")), u: "%" },
        { k: "평균 HCP",         v: avg(d("hcp")),        u: "ppm" },
        { k: "평균 Monomer",     v: avg(d("monomerPurity")), u: "%" }
      ];
    }
    return [
      { k: "CE-SDS Monomer", v: avg(num(b => b.analytics.ceSdsNR.monomer)), u: "%" },
      { k: "IE-HPLC Main", v: avg(num(b => b.analytics.ieHPLC.main)), u: "%" },
      { k: "SE-HPLC Main", v: avg(num(b => b.analytics.seHPLC.main)), u: "%" }
    ];
  }

  /* 팀을 가로로 늘어놓은 통합 테이블 */
  function integratedTable(batches) {
    const cols = [{ k: "id", label: "Exp. No.", team: null, dp: null }];
    if (view.teams.upstream) {
      cols.push({ k: "u.titerHCCF", label: "Titer HCCF", team: "upstream", dp: 0 });
      cols.push({ k: "u.maxVCD",    label: "Max VCD",    team: "upstream", dp: 2 });
      cols.push({ k: "u.finalViability", label: "Viability", team: "upstream", dp: 1 });
    }
    if (view.teams.downstream) {
      cols.push({ k: "d.totalYield",    label: "Total Yield", team: "downstream", dp: 1 });
      cols.push({ k: "d.monomerPurity", label: "SEC Monomer", team: "downstream", dp: 2 });
      cols.push({ k: "d.hcp",           label: "HCP",         team: "downstream", dp: 1 });
    }
    if (view.teams.analytics) {
      cols.push({ k: "a.seHPLC.main", label: "SE Main", team: "analytics", dp: 1 });
      cols.push({ k: "a.ieHPLC.main", label: "IE Main", team: "analytics", dp: 1 });
      cols.push({ k: "a.ceSdsNR.monomer", label: "Monomer", team: "analytics", dp: 1 });
    }

    const val = (b, k) => {
      if (k === "id") return b.id;
      if (k.indexOf("u.") === 0) return b.upstream[k.slice(2)];
      if (k.indexOf("d.") === 0) return b.downstream ? b.downstream[k.slice(2)] : null;
      const p = k.slice(2).split(".");
      return b.analytics[p[0]] ? b.analytics[p[0]][p[1]] : null;
    };

    const rows = batches.slice().sort(function (a, a2) {
      const va = val(a, view.sortKey), vb = val(a2, view.sortKey);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * view.sortDir;
      return String(va).localeCompare(String(vb)) * view.sortDir;
    });

    const teamColor = id => (window.DATA_TEAMS.find(t => t.id === id) || {}).color || "var(--c-border)";

    return '<div class="tbl-scroll"><table class="tbl"><thead><tr>' +
      cols.map(c => '<th scope="col"' +
        (c.team ? ' style="border-top:2px solid ' + teamColor(c.team) + '"' : "") + '>' +
        '<button class="sort-btn" data-sort="' + esc(c.k) + '">' + esc(c.label) +
        (view.sortKey === c.k ? '<span class="sort-ind">' + (view.sortDir === 1 ? "▲" : "▼") + '</span>'
                              : '<span class="sort-ind sort-ind-off">↕</span>') +
        '</button></th>').join("") + '</tr></thead><tbody>' +
      rows.map(b => '<tr>' + cols.map(c => {
        const v = val(b, c.k);
        if (v === null) return '<td class="na">' + L.empty + '</td>';
        return '<td class="mono">' + esc(c.dp === null ? v : Number(v).toFixed(c.dp)) + '</td>';
      }).join("") + '</tr>').join("") + '</tbody></table></div>';
  }

  /* ── 팀 상세 ────────────────────────────────────────────────────────── */
  function detail(teamId, batches) {
    const t = window.DATA_TEAMS.find(x => x.id === teamId) || {};
    const groups = window.DATA_ANALYTE_GROUPS.filter(g => g.team === teamId && !g.empty);

    const head = '<div class="crumb" style="margin-bottom:var(--s-4)">' +
      '<button class="btn btn-ghost btn-sm" id="back-overview">← 개요로</button>' +
      '<span class="crumb-sep">›</span><span>' + esc(t.ko) + ' 상세</span></div>';

    if (!groups.length) {
      return head + '<div class="empty"><div class="empty-title">' + esc(t.ko) +
        ' 원본 데이터가 없습니다</div><div class="empty-body">' +
        'Excel에 해당 팀 컬럼이 없어 표시할 항목이 없습니다. EBR에서 입력하면 이 화면에 나타납니다.</div>' +
        '<a class="btn btn-accent btn-sm" href="ebr.html">EBR 입력으로 이동</a></div>';
    }

    const trendBlock = teamId === "upstream" ? trend(batches) : "";

    return head +
      (trendBlock ? '<section class="card" style="margin-bottom:var(--s-4)">' +
        '<div class="card-head"><div><h2 class="card-title">Titer 일자별 추이</h2>' +
        '<p class="card-sub">Day 축 · 배치 겹쳐 보기</p></div></div>' + trendBlock + '</section>' : "") +

      groups.map(g =>
        '<section class="card" style="margin-bottom:var(--s-4)">' +
          '<div class="card-head"><div><h2 class="card-title">' + esc(g.label) + '</h2>' +
          (g.note ? '<p class="card-sub">' + esc(g.note) + '</p>' : "") + '</div></div>' +
          '<div class="tbl-scroll"><table class="tbl"><thead><tr>' +
            '<th scope="col">Exp. No.</th>' +
            g.items.map(it => '<th scope="col">' + esc(it.label) +
              '<br><span style="font-weight:400;text-transform:none">' + esc(it.unit) + '</span></th>').join("") +
          '</tr></thead><tbody>' +
          batches.map(b => '<tr><td class="mono" style="font-weight:600">' + esc(b.id) + '</td>' +
            g.items.map(it => {
              const v = window.Repo.valueOf(b, g.id, it.key);
              return v === null ? '<td class="na">' + L.empty + '</td>'
                                : '<td class="mono">' + Number(v).toFixed(it.dp) + '</td>';
            }).join("") + '</tr>').join("") +
          '</tbody></table></div></section>').join("");
  }

  function trend(batches) {
    const days = window.DATA_TITER_DAYS.filter(d => batches.some(b => b.upstream.titer[d] !== null));
    if (!days.length) return "";
    const palette = ["#0369A1","#6D28D9","#0F766E","#B45309","#B91C1C","#1D4ED8",
                     "#0284C7","#7C3AED","#15803D","#C2410C","#9333EA","#0891B2"];
    const shown = batches.slice(0, 12);
    const series = shown.map((b, i) => ({ name: b.id, color: palette[i % palette.length],
      data: days.map(d => b.upstream.titer[d]) }));
    return '<div class="card-body">' + C.legend(series) +
      '<div class="chart-wrap" style="margin-top:var(--s-3)">' +
        C.line({ x: days, series, h: 300, w: 820, aria: "배치별 Titer 추이" }) + '</div></div>';
  }

  /* ── 필터 바 ────────────────────────────────────────────────────────── */
  function filterBar() {
    const list = presets();
    return '<div class="card" style="margin-bottom:var(--s-4)"><div class="card-body" ' +
      'style="display:flex;gap:var(--s-4);align-items:flex-end;flex-wrap:wrap">' +

      '<div><div class="eyebrow" style="margin-bottom:6px">표시할 팀</div>' +
        '<div style="display:flex;gap:var(--s-3);flex-wrap:wrap">' +
        window.DATA_TEAMS.map(t =>
          '<label style="display:flex;align-items:center;gap:6px;font-size:12.5px;cursor:pointer">' +
            '<input type="checkbox" data-team="' + t.id + '"' + (view.teams[t.id] ? " checked" : "") +
            ' style="width:15px;height:15px;accent-color:var(--c-accent)">' + esc(t.short) + '</label>').join("") +
        '</div></div>' +

      '<label class="ebr-cell" style="min-width:150px"><span>정렬 기준</span>' +
        '<select class="ebr-input" id="mm-sort">' +
          [["id","배치 번호"],["u.titerHCCF","Titer HCCF"],["u.maxVCD","Max VCD"],
           ["u.finalViability","Viability"],["a.ceSdsNR.monomer","Monomer"]].map(o =>
            '<option value="' + o[0] + '"' + (view.sortKey === o[0] ? " selected" : "") + '>' +
            o[1] + '</option>').join("") + '</select></label>' +

      '<label class="ebr-cell" style="min-width:110px"><span>정렬 방향</span>' +
        '<select class="ebr-input" id="mm-dir">' +
          '<option value="1"' + (view.sortDir === 1 ? " selected" : "") + '>오름차순</option>' +
          '<option value="-1"' + (view.sortDir === -1 ? " selected" : "") + '>내림차순</option>' +
        '</select></label>' +

      '<div style="margin-left:auto;display:flex;gap:var(--s-2);align-items:end;flex-wrap:wrap">' +
        (list.length
          ? '<label class="ebr-cell" style="min-width:150px"><span>프리셋</span>' +
            '<select class="ebr-input" id="mm-preset"><option value="">— 불러오기 —</option>' +
            list.map((p, i) => '<option value="' + i + '">' + esc(p.name) + '</option>').join("") +
            '</select></label>' : "") +
        '<button class="btn btn-ghost btn-sm" id="mm-save">현재 조합 저장</button>' +
      '</div>' +
    '</div></div>';
  }

  /* ── 렌더 ───────────────────────────────────────────────────────────── */
  function render() {
    if (!on) return;
    const sel = window.Scope.get();
    const desc = window.Scope.describe();

    $("#mv-title").textContent = "회의 모드";
    $("#mv-sub").textContent = desc.scope
      ? desc.scope + (desc.study ? " · " + desc.study : "") : "과제 미선택";
    $("#mv-tabs").innerHTML = viewTabs();

    if (!sel.scopeId) {
      $("#mv-body").innerHTML = '<div class="empty"><div class="empty-title">과제를 선택하세요</div>' +
        '<div class="empty-body">대시보드 상단에서 선택한 뒤 다시 열어주세요.</div></div>';
      wireTabs();
      return;
    }

    Promise.all([
      window.Scope.batches(),
      window.Repo.getTeamDataSetsForSelection(sel)
    ]).then(function (r) {
      const batches = r[0], teamSets = r[1];
      $("#mv-body").innerHTML = filterBar() +
        (view.detail ? detail(view.detail, batches) : overview(batches, teamSets));
      wire(batches);
      wireTabs();
    });
  }

  function wireTabs() {
    $$("[data-view]").forEach(b => b.addEventListener("click", function () {
      view.detail = b.dataset.view === "overview" ? null : b.dataset.view;
      render();
    }));
  }

  function wire(batches) {
    $$("[data-team]").forEach(c => c.addEventListener("change", function () {
      view.teams[c.dataset.team] = c.checked; render();
    }));
    const s = $("#mm-sort"); if (s) s.addEventListener("change", function () { view.sortKey = this.value; render(); });
    const d = $("#mm-dir");  if (d) d.addEventListener("change", function () { view.sortDir = +this.value; render(); });

    $$("[data-detail]").forEach(b => b.addEventListener("click", function () {
      view.detail = b.dataset.detail; render();
    }));
    const back = $("#back-overview");
    if (back) back.addEventListener("click", function () { view.detail = null; render(); });

    $$("[data-sort]").forEach(b => b.addEventListener("click", function () {
      if (view.sortKey === b.dataset.sort) view.sortDir *= -1;
      else { view.sortKey = b.dataset.sort; view.sortDir = 1; }
      render();
    }));

    $("#mm-save").addEventListener("click", function () {
      const name = window.prompt("프리셋 이름을 입력하세요 (예: 주간회의 기본)");
      if (!name) return;
      const list = presets();
      list.push({ name: name.trim(), view: JSON.parse(JSON.stringify(view)) });
      savePresets(list);
      render();
    });

    const p = $("#mm-preset");
    if (p) p.addEventListener("change", function () {
      if (this.value === "") return;
      const item = presets()[+this.value];
      if (item) { view = Object.assign({}, view, item.view); render(); }
    });
  }

  /* ── 오버레이 생명주기 ─────────────────────────────────────────────────
     대시보드 안에서 열리는 전체화면 오버레이입니다. 별도 페이지가 아니므로
     대시보드에서 고른 과제·Study·팀이 그대로 유지됩니다. */
  let on = false, unsub = [], lastFocus = null;

  function install() {
    if (document.getElementById("mv")) return;
    const d = document.createElement("div");
    d.className = "mm";
    d.id = "mv";
    d.setAttribute("role", "dialog");
    d.setAttribute("aria-modal", "true");
    d.setAttribute("aria-label", "회의 모드");
    d.innerHTML =
      '<div class="mm-head">' +
        '<div style="min-width:0">' +
          '<div class="mm-title" id="mv-title">회의 모드</div>' +
          '<div class="mm-sub" id="mv-sub"></div>' +
        '</div>' +
        '<button class="btn btn-ghost btn-sm" id="mv-exit" style="margin-left:auto">종료 (Esc)</button>' +
      '</div>' +
      '<div class="mm-foot" style="border-top:0;border-bottom:1px solid var(--c-border)" id="mv-tabs"></div>' +
      '<div style="flex:1;overflow-y:auto;padding:var(--s-6)" id="mv-body"></div>';
    document.body.appendChild(d);
    d.querySelector("#mv-exit").addEventListener("click", close);
  }

  function onKey(e) {
    if (!on) return;
    if (e.key === "Escape") {
      const t = (e.target.tagName || "");
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(t)) { e.target.blur(); e.preventDefault(); return; }
      close(); e.preventDefault();
    }
  }

  function open() {
    install();
    on = true;
    lastFocus = document.activeElement;
    document.body.classList.add("mm-open");
    document.getElementById("mv").classList.add("is-on");
    unsub = [window.Scope.subscribe(render), window.Entries.subscribe(render)];
    document.addEventListener("keydown", onKey, true);
    render();
    setTimeout(() => { const b = document.getElementById("mv-exit"); if (b) b.focus(); }, 40);
  }

  function close() {
    on = false;
    document.body.classList.remove("mm-open");
    const el = document.getElementById("mv");
    if (el) el.classList.remove("is-on");
    unsub.forEach(f => { try { f(); } catch (e) {} });
    unsub = [];
    document.removeEventListener("keydown", onKey, true);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  return { install, open, close };
})();
