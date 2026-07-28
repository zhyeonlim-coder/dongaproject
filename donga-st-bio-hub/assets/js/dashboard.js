/* ==========================================================================
   Bio Knowledge Hub — dashboard rendering
   Charts are hand-rolled SVG: no charting library, no CDN dependency.
   ========================================================================== */

(function () {
  "use strict";

  const H = window.HUB;
  // Sidebar, topbar, logo, session and nav wiring all live in Shell now.
  const user = window.Shell.mount({ page: "dashboard", title: "대시보드 · Dashboard" });
  if (!user) return;                    // redirecting to login

  const $  = function (s, r) { return (r || document).querySelector(s); };
  const $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  const esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  };

  /* ── Identity ───────────────────────────────────────────────────────── */
  function paintUser() {
    const r = window.Auth.role();
    $("#greet-name").textContent = user.name;
    $("#greet-role").textContent = r ? (r.ko + " · " + r.en) : "";

    const hour = new Date().getHours();
    $("#greet-time").textContent =
      hour < 12 ? "좋은 아침입니다" : hour < 18 ? "안녕하세요" : "늦은 시간까지 수고 많으십니다";
  }

  /* ── KPI tiles ──────────────────────────────────────────────────────── */
  function paintKpis() {
    $("#kpi-row").innerHTML = H.KPIS.map(function (k) {
      const cls = k.dir === "up" ? "stat-delta-up" : k.dir === "down" ? "stat-delta-down" : "stat-delta-flat";
      const arrow = k.dir === "up" ? "M6 2.5 10 7H2z" : k.dir === "down" ? "M6 9.5 2 5h8z" : "M2 6h8";
      return '' +
        '<div class="card stat">' +
          '<div class="stat-label">' + esc(k.label_ko) + ' · <span style="color:var(--c-text-soft)">' + esc(k.label_en) + '</span></div>' +
          '<div class="stat-value">' + esc(k.value) + '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
            '<span class="stat-delta ' + cls + '">' +
              '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="' + arrow + '"/></svg>' +
              esc(k.delta) +
            '</span>' +
            '<span style="font-size:11.5px;color:var(--c-text-soft)">' + esc(k.note) + '</span>' +
          '</div>' +
        '</div>';
    }).join("");
  }

  /* ── Signature: pipeline gate rail ──────────────────────────────────── */
  let activeArea = "all";

  function paintRail() {
    const track = $("#rail-track");

    track.innerHTML = H.GATES.map(function (g) {
      const items = H.COMPOUNDS.filter(function (c) {
        return c.gate === g.id && (activeArea === "all" || c.area === activeArea);
      });

      const chips = items.length
        ? items.map(function (c) {
            return '' +
              '<button class="rail-chip" style="--gate:' + g.color + '" ' +
                      'data-code="' + esc(c.code) + '" aria-pressed="false" ' +
                      'aria-label="' + esc(c.code + ' — ' + c.ko + ', ' + g.ko) + '">' +
                '<span class="rail-chip-code">' + esc(c.code) + '</span>' +
                '<span class="rail-chip-name">' + esc(c.ko) + '</span>' +
              '</button>';
          }).join("")
        : '<div class="rail-empty">해당 없음</div>';

      return '' +
        '<div class="rail-gate" style="--gate:' + g.color + '">' +
          '<div class="rail-gate-label">' + esc(g.ko) + '</div>' +
          '<div class="rail-gate-meta">' + esc(g.abbr) + ' · ' + items.length + '</div>' +
          chips +
        '</div>';
    }).join("");

    // Chip selection drives the detail panel
    $$(".rail-chip", track).forEach(function (chip) {
      chip.addEventListener("click", function () {
        const on = chip.getAttribute("aria-pressed") === "true";
        $$(".rail-chip", track).forEach(function (c) { c.setAttribute("aria-pressed", "false"); });
        chip.setAttribute("aria-pressed", String(!on));
        paintDetail(on ? null : chip.dataset.code);
      });
    });

    $("#rail-count").textContent = H.COMPOUNDS.filter(function (c) {
      return activeArea === "all" || c.area === activeArea;
    }).length;
  }

  function paintDetail(code) {
    const panel = $("#detail-panel");
    if (!code) {
      panel.innerHTML =
        '<div class="empty">' +
          '<div class="empty-title">물질을 선택하세요</div>' +
          '<div class="empty-body">파이프라인에서 물질을 선택하면 담당자, 최근 갱신일, 연결된 근거 문서를 확인할 수 있습니다.</div>' +
          '<div class="empty-body" style="font-size:12px">Select a compound in the pipeline to see its owner, last update, and linked evidence.</div>' +
        '</div>';
      return;
    }

    const c = H.COMPOUNDS.find(function (x) { return x.code === code; });
    const g = H.GATES.find(function (x) { return x.id === c.gate; });

    panel.innerHTML = '' +
      '<div class="card-body">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:var(--s-5)">' +
          '<div>' +
            '<div class="mono" style="font-size:17px;font-weight:600">' + esc(c.code) + '</div>' +
            '<div style="font-size:13px;color:var(--c-text-mute);margin-top:2px">' + esc(c.ko) + '</div>' +
            '<div style="font-size:12px;color:var(--c-text-soft)">' + esc(c.en) + '</div>' +
          '</div>' +
          '<span class="badge" style="background:' + g.color + '1a;color:' + g.color + '">' +
            '<span class="badge-dot"></span>' + esc(g.ko) +
          '</span>' +
        '</div>' +
        '<dl style="display:grid;grid-template-columns:auto 1fr;gap:10px 16px;font-size:13px;margin:0">' +
          '<dt style="color:var(--c-text-soft)">치료영역</dt><dd style="margin:0;font-weight:500">' + esc(c.area) + '</dd>' +
          '<dt style="color:var(--c-text-soft)">담당</dt><dd style="margin:0;font-weight:500">' + esc(c.lead) + '</dd>' +
          '<dt style="color:var(--c-text-soft)">최근 갱신</dt><dd style="margin:0" class="mono">' + esc(c.updated) + '</dd>' +
        '</dl>' +
        '<div class="rule-hair" style="margin:var(--s-5) 0"></div>' +
        '<div class="eyebrow" style="margin-bottom:var(--s-3)">연결된 근거 · Linked evidence</div>' +
        '<div style="display:grid;gap:8px">' +
          evidenceRow("실험 리포트", "Assay reports", 12) +
          evidenceRow("임상 문서", "Clinical documents", 5) +
          evidenceRow("외부 문헌", "External literature", 34) +
        '</div>' +
        '<button class="btn btn-ghost btn-sm" style="width:100%;margin-top:var(--s-5)">' +
          '물질 상세 열기 · Open compound record' +
        '</button>' +
      '</div>';
  }

  function evidenceRow(ko, en, n) {
    return '' +
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;' +
                  'background:var(--c-paper);border-radius:var(--r-sm)">' +
        '<div><div style="font-size:12.5px;font-weight:500">' + esc(ko) + '</div>' +
        '<div style="font-size:11px;color:var(--c-text-soft)">' + esc(en) + '</div></div>' +
        '<span class="mono" style="font-size:13px;font-weight:600">' + n + '</span>' +
      '</div>';
  }

  /* ── Area filter ────────────────────────────────────────────────────── */
  function paintFilter() {
    const areas = ["all"].concat(H.AREAS.map(function (a) { return a.en; }));
    $("#area-filter").innerHTML = areas.map(function (a) {
      const on = a === activeArea;
      const label = a === "all" ? "전체" : a;
      return '<button class="btn btn-ghost btn-sm" data-area="' + esc(a) + '" aria-pressed="' + on + '" ' +
             'style="' + (on ? "background:var(--c-navy-700);color:#fff;border-color:var(--c-navy-700)" : "") + '">' +
             esc(label) + '</button>';
    }).join("");

    $$("[data-area]").forEach(function (b) {
      b.addEventListener("click", function () {
        activeArea = b.dataset.area;
        paintFilter();
        paintRail();
        paintDetail(null);
      });
    });
  }

  /* ── Enrolment chart (SVG line, target vs actual) ───────────────────── */
  function paintEnrolment() {
    const d = H.ENROLMENT;
    const W = 640, Ht = 230, pad = { t: 16, r: 16, b: 30, l: 42 };
    const iw = W - pad.l - pad.r, ih = Ht - pad.t - pad.b;
    const max = Math.max.apply(null, d.target) * 1.05;

    const x = function (i) { return pad.l + (i / (d.months.length - 1)) * iw; };
    const y = function (v) { return pad.t + ih - (v / max) * ih; };
    const line = function (arr) {
      return arr.map(function (v, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); }).join(" ");
    };

    // Gridlines + y labels
    let grid = "";
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i, yy = y(v);
      grid += '<line x1="' + pad.l + '" y1="' + yy.toFixed(1) + '" x2="' + (W - pad.r) + '" y2="' + yy.toFixed(1) +
              '" stroke="var(--c-paper-2)" stroke-width="1"/>' +
              '<text x="' + (pad.l - 8) + '" y="' + (yy + 3.5).toFixed(1) + '" text-anchor="end" ' +
              'font-size="10" font-family="var(--font-data)" fill="var(--c-text-soft)">' + Math.round(v) + '</text>';
    }

    // X labels — every other month, so they never collide
    let xlab = "";
    d.months.forEach(function (m, i) {
      if (i % 2) return;
      xlab += '<text x="' + x(i).toFixed(1) + '" y="' + (Ht - 8) + '" text-anchor="middle" ' +
              'font-size="10" font-family="var(--font-data)" fill="var(--c-text-soft)">' + esc(m) + '</text>';
    });

    const last = d.actual.length - 1;

    $("#chart-enrolment").innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + Ht + '" width="100%" height="230" role="img" ' +
           'aria-label="12개월 임상 등록 추이. 목표 620명 대비 실제 601명." ' +
           'preserveAspectRatio="xMidYMid meet">' +
        grid + xlab +
        // Target: dashed — distinguishable without colour
        '<path d="' + line(d.target) + '" fill="none" stroke="var(--c-text-soft)" stroke-width="1.5" ' +
              'stroke-dasharray="5 4" stroke-linecap="round"/>' +
        // Actual: solid accent
        '<path d="' + line(d.actual) + '" fill="none" stroke="var(--c-accent-bright)" stroke-width="2.5" ' +
              'stroke-linecap="round" stroke-linejoin="round"/>' +
        '<circle cx="' + x(last).toFixed(1) + '" cy="' + y(d.actual[last]).toFixed(1) + '" r="4.5" ' +
                'fill="var(--c-accent-bright)" stroke="#fff" stroke-width="2"/>' +
      '</svg>';

    // Accessible non-visual equivalent
    $("#chart-enrolment-table").innerHTML =
      '<caption class="sr-only">월별 임상 등록 목표 대비 실적</caption><thead><tr>' +
      '<th scope="col">월</th><th scope="col">목표</th><th scope="col">실제</th></tr></thead><tbody>' +
      d.months.map(function (m, i) {
        return '<tr><th scope="row">' + esc(m) + '</th><td>' + d.target[i] + '</td><td>' + d.actual[i] + '</td></tr>';
      }).join("") + '</tbody>';
  }

  /* ── Therapeutic areas (horizontal bars) ────────────────────────────── */
  function paintAreas() {
    const total = H.AREAS.reduce(function (s, a) { return s + a.n; }, 0);
    $("#area-bars").innerHTML = H.AREAS.map(function (a) {
      const pct = Math.round((a.n / total) * 100);
      return '' +
        '<div style="margin-bottom:var(--s-4)">' +
          '<div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:5px">' +
            '<span style="font-weight:500">' + esc(a.ko) + ' <span style="color:var(--c-text-soft)">' + esc(a.en) + '</span></span>' +
            '<span class="mono" style="color:var(--c-text-mute)">' + a.n + ' · ' + pct + '%</span>' +
          '</div>' +
          '<div style="height:7px;background:var(--c-paper-2);border-radius:4px;overflow:hidden">' +
            '<div style="height:100%;width:' + pct + '%;background:' + a.color + ';border-radius:4px"></div>' +
          '</div>' +
        '</div>';
    }).join("");
  }

  /* ── Literature feed ────────────────────────────────────────────────── */
  function paintLiterature() {
    $("#lit-feed").innerHTML = H.LITERATURE.map(function (l) {
      return '' +
        '<a class="feed-item" href="#" onclick="event.preventDefault()">' +
          '<div class="feed-title">' + esc(l.title_ko) + '</div>' +
          '<div style="font-size:11.5px;color:var(--c-text-soft);margin-bottom:6px">' + esc(l.title_en) + '</div>' +
          '<div class="feed-meta">' +
            '<span class="badge badge-' + esc(l.tagType) + '">' + esc(l.tag) + '</span>' +
            '<span class="feed-src">' + esc(l.src) + '</span>' +
            '<span aria-hidden="true">·</span>' +
            '<span class="mono">' + esc(l.date) + '</span>' +
            (l.saved ? '<span class="badge badge-warn" style="margin-left:auto">저장됨</span>' : '') +
          '</div>' +
        '</a>';
    }).join("");
  }

  /* ── Submissions table ──────────────────────────────────────────────── */
  function paintSubmissions() {
    $("#sub-rows").innerHTML = H.SUBMISSIONS.map(function (s) {
      return '' +
        '<tr>' +
          '<td class="mono" style="font-weight:600">' + esc(s.code) + '</td>' +
          '<td>' + esc(s.region_ko) + ' <span style="color:var(--c-text-soft)" class="mono">' + esc(s.region_en) + '</span></td>' +
          '<td>' + esc(s.type) + '</td>' +
          '<td><span class="badge badge-' + esc(s.badge) + '"><span class="badge-dot"></span>' + esc(s.status) + '</span></td>' +
          '<td>' +
            '<div style="display:flex;align-items:center;gap:8px">' +
              '<div style="flex:1;min-width:56px;height:6px;background:var(--c-paper-2);border-radius:3px;overflow:hidden">' +
                '<div style="height:100%;width:' + s.pct + '%;background:var(--c-navy-600);border-radius:3px"></div>' +
              '</div>' +
              '<span class="mono" style="font-size:11.5px;color:var(--c-text-mute)">' + s.pct + '%</span>' +
            '</div>' +
          '</td>' +
          '<td class="mono">' + esc(s.due) + '</td>' +
          '<td>' + esc(s.owner) + '</td>' +
        '</tr>';
    }).join("");
  }

  /* ── AI layer ───────────────────────────────────────────────────────── */
  function mountAI() {
    window.AI.renderBar($("#ai-search"));
    window.AI.renderRecs($("#ai-recs"), 3);
  }

  /* ── Go ─────────────────────────────────────────────────────────────── */
  paintUser();
  paintKpis();
  paintFilter();
  paintRail();
  paintDetail(null);
  paintEnrolment();
  paintAreas();
  paintLiterature();
  paintSubmissions();
  mountAI();
})();
