/* ==========================================================================
   Explorer — 2-Track tree + Split-View detail

   Track A : 과제 → 계획서 → 보고서
   Track B : 과제 → Batch → 물질 (DS/DP)

   Sub-tabs: 공정 개요 · 배양 데이터 · 정제 데이터 · 분석 결과
   Charts are hand-rolled SVG — no charting library.
   ========================================================================== */

(function () {
  "use strict";

  const R = window.RND;
  const user = window.Shell.mount({ page: "explorer", title: "데이터 탐색 · Explorer" });
  if (!user) return;

  window.Shell.subnav([
    { label: "탐색", items: [
      { ko: "2-Track 트리", href: "explorer.html", active: true },
      { ko: "전체 일정", href: "schedule.html" }
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

  let track = "A";
  let selected = null;          // { kind, id }
  let filter = "";

  /* ── Tree building ──────────────────────────────────────────────────── */

  function treeData() {
    return R.PROJECTS.map(p => {
      const kids = track === "A"
        ? [
            { kind: "group", id: "pln:" + p.id, label: "계획서", tag: "PLN",
              children: R.PLANS.filter(x => x.prj === p.id).map(x => ({ kind: "plan", id: x.id, label: x.ko, tag: "PLN", meta: x.ver })) },
            { kind: "group", id: "rpt:" + p.id, label: "보고서", tag: "RPT",
              children: R.REPORTS.filter(x => x.prj === p.id).map(x => ({ kind: "report", id: x.id, label: x.ko, tag: "RPT", meta: x.status })) }
          ]
        : R.BATCHES.filter(b => b.prj === p.id).map(b => ({
            kind: "batch", id: b.id, label: b.id + " · " + b.scale, tag: "BAT", meta: b.titer + " g/L",
            children: R.MATERIALS.filter(m => m.batch === b.id).map(m => ({
              kind: "material", id: m.id, label: m.id + " · " + m.type, tag: "MAT", meta: m.type
            }))
          }));
      return { kind: "project", id: p.id, label: p.ko, tag: "PRJ", meta: p.stage, children: kids };
    });
  }

  const KIND_CLASS = { PRJ: "tree-kind-prj", PLN: "tree-kind-pln", RPT: "tree-kind-rpt", BAT: "tree-kind-bat", MAT: "tree-kind-mat" };

  function matches(node) {
    if (!filter) return true;
    const f = filter.toLowerCase();
    if ((node.id + " " + node.label).toLowerCase().indexOf(f) > -1) return true;
    return (node.children || []).some(matches);
  }

  const expanded = {};

  function renderNode(node, depth) {
    if (!matches(node)) return "";
    const hasKids = node.children && node.children.length;
    const isOpen = expanded[node.id] !== false && (depth < 1 || !!filter || expanded[node.id]);
    const sel = selected && selected.id === node.id;

    let html =
      '<div class="tree-node">' +
        '<button class="tree-row" data-id="' + esc(node.id) + '" data-kind="' + node.kind + '"' +
          (hasKids ? ' aria-expanded="' + (isOpen ? "true" : "false") + '"' : "") +
          ' aria-selected="' + (sel ? "true" : "false") + '">' +
          (hasKids
            ? '<span class="tree-caret" aria-hidden="true"><svg width="11" height="11" viewBox="0 0 24 24" ' +
              'fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
              '<path d="m9 5 7 7-7 7"/></svg></span>'
            : '<span class="tree-caret-spacer"></span>') +
          (node.tag ? '<span class="tree-kind ' + (KIND_CLASS[node.tag] || "") + '">' + node.tag + '</span>' : "") +
          '<span class="tree-label">' + esc(node.label) + '</span>' +
          (node.meta ? '<span class="tree-badge">' + esc(node.meta) + '</span>' : "") +
        '</button>';

    if (hasKids) {
      html += '<div class="tree-children"' + (isOpen ? "" : " hidden") + '>' +
        node.children.map(c => renderNode(c, depth + 1)).join("") + '</div>';
    }
    return html + '</div>';
  }

  function paintTree() {
    const data = treeData();
    const host = $("#tree");
    const html = data.map(n => renderNode(n, 0)).join("");
    host.innerHTML = html || '<div class="empty"><div class="empty-title">결과 없음</div>' +
      '<div class="empty-body">다른 검색어를 입력하거나 트랙을 전환해 보세요.</div></div>';

    $$(".tree-row", host).forEach(row => {
      row.addEventListener("click", function () {
        const id = row.dataset.id, kind = row.dataset.kind;
        if (row.hasAttribute("aria-expanded")) {
          const open = row.getAttribute("aria-expanded") === "true";
          expanded[id] = !open;
          row.setAttribute("aria-expanded", String(!open));
          const kids = row.parentElement.querySelector(".tree-children");
          if (kids) kids.hidden = open;
        }
        if (kind !== "group") { selected = { kind, id }; paintDetail(); paintSelection(); }
      });
    });
  }

  function paintSelection() {
    $$(".tree-row").forEach(r =>
      r.setAttribute("aria-selected", String(!!selected && r.dataset.id === selected.id)));
  }

  /* ── Charts ─────────────────────────────────────────────────────────── */

  function lineChart(cfg) {
    const W = 620, H = cfg.h || 250;
    const pad = { t: 14, r: cfg.right ? 48 : 16, b: 34, l: 46 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const xs = cfg.x;
    const xAt = i => pad.l + (i / (xs.length - 1)) * iw;

    const lMax = Math.max.apply(null, cfg.series.filter(s => !s.right).reduce((a, s) => a.concat(s.data), [1])) * 1.1;
    const rMax = cfg.right ? Math.max.apply(null, cfg.series.filter(s => s.right).reduce((a, s) => a.concat(s.data), [1])) * 1.1 : 1;
    const yAt = (v, right) => pad.t + ih - (v / (right ? rMax : lMax)) * ih;

    let grid = "";
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + ih - (i / 4) * ih;
      grid += '<line x1="' + pad.l + '" y1="' + y.toFixed(1) + '" x2="' + (W - pad.r) + '" y2="' + y.toFixed(1) +
              '" stroke="var(--c-paper-2)"/>' +
              '<text x="' + (pad.l - 7) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" ' +
              'font-family="var(--font-data)" fill="var(--c-text-mute)">' + (lMax * i / 4).toFixed(lMax < 10 ? 1 : 0) + '</text>';
      if (cfg.right) {
        grid += '<text x="' + (W - pad.r + 7) + '" y="' + (y + 3.5).toFixed(1) + '" font-size="10" ' +
                'font-family="var(--font-data)" fill="var(--c-text-mute)">' + (rMax * i / 4).toFixed(1) + '</text>';
      }
    }

    let xlab = "";
    xs.forEach((v, i) => {
      if (i % Math.ceil(xs.length / 8) && i !== xs.length - 1) return;
      xlab += '<text x="' + xAt(i).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle" font-size="10" ' +
              'font-family="var(--font-data)" fill="var(--c-text-mute)">' + esc(v) + '</text>';
    });

    const paths = cfg.series.map(s => {
      const d = s.data.map((v, i) => (i ? "L" : "M") + xAt(i).toFixed(1) + " " + yAt(v, s.right).toFixed(1)).join(" ");
      return '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2.2" ' +
             (s.dash ? 'stroke-dasharray="5 4" ' : "") + 'stroke-linecap="round" stroke-linejoin="round"/>' +
             s.data.map((v, i) => i === s.data.length - 1
               ? '<circle cx="' + xAt(i).toFixed(1) + '" cy="' + yAt(v, s.right).toFixed(1) +
                 '" r="3.6" fill="' + s.color + '" stroke="#fff" stroke-width="1.6"/>' : "").join("");
    }).join("");

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" aria-label="' +
      esc(cfg.aria || "추이 그래프") + '" preserveAspectRatio="xMidYMid meet">' + grid + xlab + paths + '</svg>';
  }

  function legend(series) {
    return '<div style="display:flex;flex-wrap:wrap;gap:var(--s-4);font-size:11.5px">' +
      series.map(s =>
        '<span style="display:flex;align-items:center;gap:6px;color:var(--c-text-mute)">' +
          '<svg width="16" height="3" aria-hidden="true"><line x1="0" y1="1.5" x2="16" y2="1.5" stroke="' + s.color +
          '" stroke-width="3"' + (s.dash ? ' stroke-dasharray="4 3"' : "") + '/></svg>' + esc(s.name) + '</span>'
      ).join("") + '</div>';
  }

  /* Log-scale bar chart for impurity clearance */
  function logBars(rows, key, unit) {
    const vals = rows.map(r => Math.max(r[key], 0.1));
    const maxL = Math.log10(Math.max.apply(null, vals));
    const minL = Math.log10(Math.min.apply(null, vals));
    const span = (maxL - minL) || 1;
    return '<div style="display:grid;gap:var(--s-3)">' + rows.map((r, i) => {
      const pct = ((Math.log10(Math.max(r[key], 0.1)) - minL) / span) * 100;
      return '<div>' +
        '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">' +
          '<span>' + (i + 1) + '. ' + esc(r.step) + '</span>' +
          '<span class="mono" style="font-weight:600">' + r[key] + ' <span style="color:var(--c-text-mute);font-weight:400">' + unit + '</span></span>' +
        '</div>' +
        '<div style="height:8px;background:var(--c-paper-2);border-radius:4px;overflow:hidden">' +
          '<div style="height:100%;width:' + Math.max(3, pct).toFixed(1) + '%;background:var(--c-accent-mid);border-radius:4px"></div>' +
        '</div></div>';
    }).join("") +
    '<p style="font-size:11px;color:var(--c-text-mute);margin:0">막대 길이는 로그 스케일입니다 (값의 범위가 3자릿수 이상).</p></div>';
  }

  /* ── Detail panel ───────────────────────────────────────────────────── */

  function paintDetail() {
    const host = $("#detail");
    if (!selected) {
      host.innerHTML =
        '<div class="card"><div class="empty">' +
          '<div class="empty-title">항목을 선택하세요</div>' +
          '<div class="empty-body">좌측 트리에서 과제·Batch·물질·보고서를 선택하면 배양공정팀, 정제공정팀, ' +
            '바이오분석팀이 수집한 데이터를 한 화면에서 확인할 수 있습니다.</div>' +
          '<div class="empty-body" style="font-size:12px">Select an item on the left to see culture, ' +
            'purification and analysis data side by side.</div>' +
        '</div></div>';
      return;
    }

    const ctx = resolve(selected);
    host.innerHTML =
      '<div class="card">' +
        '<div class="card-head" style="align-items:flex-start">' +
          '<div style="min-width:0">' +
            '<div class="crumb">' + ctx.crumb.map((c, i) =>
              (i ? '<span class="crumb-sep">›</span>' : "") + '<span>' + esc(c) + '</span>').join("") + '</div>' +
            '<h2 class="card-title mono" style="font-size:16px;margin-top:6px">' + esc(ctx.title) + '</h2>' +
            '<p class="card-sub">' + esc(ctx.sub) + '</p>' +
          '</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">' + ctx.badges + '</div>' +
        '</div>' +
        '<div class="subtabs" role="tablist">' +
          ctx.tabs.map((t, i) =>
            '<button class="subtab" role="tab" id="st-' + i + '" aria-controls="pn-' + i + '" ' +
              'aria-selected="' + (i === 0) + '"' + (t.disabled ? ' disabled style="opacity:.4;cursor:not-allowed"' : "") + '>' +
              esc(t.ko) + '</button>').join("") +
        '</div>' +
        ctx.tabs.map((t, i) =>
          '<div class="panel" role="tabpanel" id="pn-' + i + '" aria-labelledby="st-' + i + '"' +
            (i === 0 ? "" : " hidden") + '>' + t.body + '</div>').join("") +
      '</div>';

    const tabs = $$(".subtab", host);
    tabs.forEach((b, i) => {
      if (b.disabled) return;
      b.addEventListener("click", function () {
        tabs.forEach((x, j) => {
          x.setAttribute("aria-selected", String(i === j));
          const p = $("#pn-" + j, host);
          if (p) p.hidden = i !== j;
        });
      });
      b.addEventListener("keydown", function (e) {
        const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        const usable = tabs.filter(t => !t.disabled);
        const cur = usable.indexOf(b);
        const next = usable[(cur + dir + usable.length) % usable.length];
        next.focus(); next.click();
      });
    });
  }

  /* Build the four panels for whatever is selected. */
  function resolve(sel) {
    const badge = (t, cls) => '<span class="badge badge-' + cls + '"><span class="badge-dot"></span>' + esc(t) + '</span>';
    const nodata = (msg) => '<div class="empty"><div class="empty-title">' + esc(msg) + '</div>' +
      '<div class="empty-body">이 항목에는 해당 공정 데이터가 없습니다.</div></div>';

    let batch = null, mat = null, prj = null;

    if (sel.kind === "material") {
      mat = R.MATERIALS.find(m => m.id === sel.id);
      batch = R.BATCHES.find(b => b.id === mat.batch);
      prj = R.PROJECTS.find(p => p.id === batch.prj);
    } else if (sel.kind === "batch") {
      batch = R.BATCHES.find(b => b.id === sel.id);
      prj = R.PROJECTS.find(p => p.id === batch.prj);
    } else if (sel.kind === "project") {
      prj = R.PROJECTS.find(p => p.id === sel.id);
    } else if (sel.kind === "plan") {
      const pl = R.PLANS.find(x => x.id === sel.id);
      prj = R.PROJECTS.find(p => p.id === pl.prj);
      return {
        crumb: [prj.ko], title: pl.id, sub: pl.ko + " · " + pl.ver,
        badges: badge(pl.status, pl.status === "승인" ? "ok" : "warn"),
        tabs: [
          { ko: "공정 개요", body: '<div class="card-body">' + dl([
              ["문서 번호", pl.id], ["버전", pl.ver], ["작성자", pl.author],
              ["작성일", pl.date], ["상태", pl.status], ["소속 과제", prj.id + " · " + prj.ko]
            ]) + '</div>' },
          { ko: "배양 데이터", body: nodata("계획서 문서") },
          { ko: "정제 데이터", body: nodata("계획서 문서") },
          { ko: "분석 결과", body: nodata("계획서 문서") }
        ]
      };
    } else if (sel.kind === "report") {
      const rp = R.REPORTS.find(x => x.id === sel.id);
      prj = R.PROJECTS.find(p => p.id === rp.prj);
      return {
        crumb: [prj.ko], title: rp.id, sub: rp.ko,
        badges: badge(rp.status, rp.status === "EDMS 등록" ? "ok" : rp.status === "작성중" ? "warn" : "info"),
        tabs: [
          { ko: "공정 개요", body: '<div class="card-body">' + dl([
              ["보고서 번호", rp.id], ["작성자", rp.author], ["완료일", rp.date],
              ["상태", rp.status], ["EDMS 번호", rp.edms], ["소속 과제", prj.id + " · " + prj.ko]
            ]) + '</div>' },
          { ko: "배양 데이터", body: nodata("보고서 문서") },
          { ko: "정제 데이터", body: nodata("보고서 문서") },
          { ko: "분석 결과", body: nodata("보고서 문서") }
        ]
      };
    }

    /* -- Project-level -- */
    if (sel.kind === "project") {
      const bs = R.BATCHES.filter(b => b.prj === prj.id);
      return {
        crumb: ["과제"], title: prj.id, sub: prj.ko + " · " + prj.en,
        badges: badge(prj.stage, "info"),
        tabs: [
          { ko: "공정 개요", body: '<div class="card-body">' + dl([
              ["치료영역", prj.area], ["책임자", prj.lead], ["단계", prj.stage],
              ["기간", prj.start + " ~ " + prj.end],
              ["배양 배치", bs.length + "건"],
              ["계획서 / 보고서", R.PLANS.filter(x => x.prj === prj.id).length + " / " + R.REPORTS.filter(x => x.prj === prj.id).length]
            ]) +
            (bs.length ? '<div class="rule-hair" style="margin:var(--s-5) 0"></div>' +
              '<div class="eyebrow" style="margin-bottom:var(--s-3)">배치별 최종 Titer 비교</div>' +
              '<div class="chart-wrap">' + lineChart({
                x: bs.map(b => b.id), h: 200,
                series: [{ name: "Titer", color: "var(--c-accent-bright)", data: bs.map(b => b.titer) }],
                aria: "배치별 최종 Titer"
              }) + '</div>' : "") + '</div>' },
          { ko: "배양 데이터", body: bs.length
              ? '<div class="card-body">' + batchTable(bs) + '</div>' : nodata("배양 데이터 없음") },
          { ko: "정제 데이터", body: nodata("과제 단위에서는 물질을 선택하세요") },
          { ko: "분석 결과", body: nodata("과제 단위에서는 물질을 선택하세요") }
        ]
      };
    }

    /* -- Batch / material -- */
    const cult = R.CULTURE[batch.id] || [];
    const mats = R.MATERIALS.filter(m => m.batch === batch.id);
    const purif = mat ? R.PURIF[mat.id] : null;
    const anal = mat ? R.ANALYSIS[mat.id] : null;

    const cultSeries = [
      { name: "VCD (×10⁶ cells/mL)", color: "var(--c-accent-bright)", data: cult.map(r => r.vcd) },
      { name: "Titer (g/L, 우축)", color: "#6D28D9", right: true, data: cult.map(r => r.titer) }
    ];

    const overview = '<div class="card-body">' +
      '<div class="metrics" style="margin-bottom:var(--s-5)">' +
        metric("최종 Titer", batch.titer, "g/L") +
        metric("Peak VCD", batch.peakVCD, "×10⁶/mL") +
        metric("배양 기간", batch.days, "일") +
        (mat ? metric("정제 수율", mat.yield, "%") : metric("스케일", batch.scale, "")) +
      '</div>' +
      dl([
        ["Batch 번호", batch.id], ["소속 과제", prj.id + " · " + prj.ko],
        ["세포주", batch.cell], ["배양 방식", batch.mode], ["스케일", batch.scale],
        ["착수일", batch.start], ["담당팀", batch.team]
      ].concat(mat ? [
        ["물질 번호", mat.id], ["구분", mat.type + " (" + mat.ko + ")"],
        ["정제 단계", mat.steps + "단계"], ["HCP", mat.hcp + " ng/mg"],
        ["Monomer", mat.monomer + " %"], ["완료일", mat.date]
      ] : [["생산 물질", mats.map(m => m.id).join(", ") || "—"]])) +
      '<div class="rule-hair" style="margin:var(--s-5) 0"></div>' +
      '<div class="eyebrow" style="margin-bottom:var(--s-2)">워크플로우 위치</div>' +
      workflow(mat ? (anal ? 4 : 3) : 2) +
      '</div>';

    const culturePanel = cult.length ? '<div class="card-body">' +
      legend(cultSeries) +
      '<div class="chart-wrap" style="margin-top:var(--s-3)">' +
        lineChart({ x: cult.map(r => "D" + r.day), series: cultSeries, right: true, h: 260,
                    aria: batch.id + " 일별 VCD 및 Titer 추이" }) + '</div>' +
      '<div class="rule-hair" style="margin:var(--s-5) 0"></div>' +
      '<div class="eyebrow" style="margin-bottom:var(--s-3)">생존율 · Viability (%)</div>' +
      '<div class="chart-wrap">' + lineChart({ x: cult.map(r => "D" + r.day), h: 170,
        series: [{ name: "Viability", color: "#0F766E", data: cult.map(r => r.via) }],
        aria: "생존율 추이" }) + '</div>' +
      '<div class="rule-hair" style="margin:var(--s-5) 0"></div>' +
      '<div class="tbl-scroll">' + cultureTable(cult) + '</div>' +
      '</div>' : nodata("배양 데이터 없음");

    const purifPanel = purif ? '<div class="card-body">' +
      '<div class="metrics" style="margin-bottom:var(--s-5)">' +
        metric("전체 수율", mat.yield, "%") +
        metric("최종 HCP", mat.hcp, "ng/mg") +
        metric("잔류 DNA", mat.hcd, "pg/mg") +
        metric("Monomer", mat.monomer, "%") +
      '</div>' +
      '<div class="tbl-scroll" style="margin-bottom:var(--s-5)">' + purifTable(purif) + '</div>' +
      '<div class="eyebrow" style="margin-bottom:var(--s-3)">HCP 제거 추이 · HCP clearance</div>' +
      logBars(purif, "hcp", "ng/mg") +
      '</div>' : nodata(mat ? "정제 데이터 없음" : "물질(DS/DP)을 선택하세요");

    const analPanel = anal ? '<div class="card-body">' +
      '<div class="tbl-scroll">' + analysisTable(anal) + '</div>' +
      (anal.some(a => !a.pass)
        ? '<div class="demo-note" style="margin-top:var(--s-4);background:var(--c-warn-bg);border-color:#F0DCC0;color:#7A3D08">' +
          '<b>규격 이탈 항목이 있습니다.</b> 해당 항목은 재분석 또는 일탈 조사가 필요합니다.</div>'
        : "") +
      '</div>' : nodata(mat ? "분석 결과 없음" : "물질(DS/DP)을 선택하세요");

    return {
      crumb: [prj.ko, batch.id].concat(mat ? [mat.id] : []),
      title: mat ? mat.id : batch.id,
      sub: mat ? (mat.ko + " · " + mat.type + " · " + batch.id + " 유래")
               : (batch.scale + " " + batch.mode + " · " + batch.cell),
      badges: badge(batch.status, batch.status === "완료" ? "ok" : "warn") +
              (mat ? badge(mat.status, mat.status === "분석완료" ? "ok" : "info") : ""),
      tabs: [
        { ko: "공정 개요", body: overview },
        { ko: "배양 데이터", body: culturePanel },
        { ko: "정제 데이터", body: purifPanel },
        { ko: "분석 결과", body: analPanel }
      ]
    };
  }

  /* ── Small builders ─────────────────────────────────────────────────── */

  function dl(pairs) {
    return '<dl style="display:grid;grid-template-columns:auto 1fr;gap:9px 18px;font-size:13px;margin:0">' +
      pairs.map(([k, v]) =>
        '<dt style="color:var(--c-text-mute)">' + esc(k) + '</dt>' +
        '<dd style="margin:0;font-weight:500">' + esc(v) + '</dd>').join("") + '</dl>';
  }

  function metric(k, v, u) {
    return '<div class="metric"><div class="metric-k">' + esc(k) + '</div>' +
      '<div class="metric-v">' + esc(v) + (u ? '<span class="metric-u">' + esc(u) + '</span>' : "") + '</div></div>';
  }

  function workflow(stage) {
    const steps = ["계획서", "배양", "정제", "DS/DP", "분석", "보고서"];
    return '<div style="display:flex;flex-wrap:wrap;gap:5px">' + steps.map((s, i) =>
      '<span class="badge" style="' +
        (i <= stage ? "background:var(--c-accent-bg);color:#0C4A6E" : "") + '">' +
        (i <= stage ? "✓ " : "") + esc(s) + '</span>').join('<span style="color:var(--c-text-soft)">›</span>') +
      '</div>';
  }

  function batchTable(bs) {
    return '<div class="tbl-scroll"><table class="tbl"><thead><tr>' +
      ['Batch', '스케일', '세포주', '착수일', 'Peak VCD', 'Titer', '상태'].map(h => '<th scope="col">' + h + '</th>').join("") +
      '</tr></thead><tbody>' + bs.map(b =>
        '<tr><td class="mono" style="font-weight:600">' + esc(b.id) + '</td><td>' + esc(b.scale) + '</td>' +
        '<td>' + esc(b.cell) + '</td><td class="mono">' + esc(b.start) + '</td>' +
        '<td class="mono">' + b.peakVCD + '</td><td class="mono" style="font-weight:600">' + b.titer + '</td>' +
        '<td><span class="badge badge-' + (b.status === "완료" ? "ok" : "warn") + '">' + esc(b.status) + '</span></td></tr>'
      ).join("") + '</tbody></table></div>';
  }

  function cultureTable(rows) {
    return '<table class="tbl"><caption class="sr-only">일별 배양 데이터</caption><thead><tr>' +
      ['Day', 'VCD', 'Viability', 'Titer', 'Glucose', 'Lactate', 'pH', 'DO'].map(h => '<th scope="col">' + h + '</th>').join("") +
      '</tr></thead><tbody>' + rows.map(r =>
        '<tr><th scope="row" class="mono">D' + r.day + '</th><td class="mono">' + r.vcd + '</td>' +
        '<td class="mono">' + r.via + '</td><td class="mono" style="font-weight:600">' + r.titer + '</td>' +
        '<td class="mono">' + r.glc + '</td><td class="mono">' + r.lac + '</td>' +
        '<td class="mono">' + r.ph + '</td><td class="mono">' + r.do2 + '</td></tr>').join("") +
      '</tbody></table>';
  }

  function purifTable(rows) {
    return '<table class="tbl"><thead><tr>' +
      ['#', '공정 단계', '수율 (%)', 'HCP (ng/mg)', 'DNA (pg/mg)', 'Monomer (%)'].map(h => '<th scope="col">' + h + '</th>').join("") +
      '</tr></thead><tbody>' + rows.map((r, i) =>
        '<tr><td class="mono">' + (i + 1) + '</td>' +
        '<td><div style="font-weight:500">' + esc(r.step) + '</div>' +
        '<div style="font-size:11px;color:var(--c-text-mute)">' + esc(r.ko) + '</div></td>' +
        '<td class="mono">' + r.yieldPct + '</td><td class="mono">' + r.hcp + '</td>' +
        '<td class="mono">' + r.hcd + '</td><td class="mono">' + r.monomer + '</td></tr>').join("") +
      '</tbody></table>';
  }

  function analysisTable(rows) {
    return '<table class="tbl"><thead><tr>' +
      ['분석 항목', '결과', '단위', '규격', '판정'].map(h => '<th scope="col">' + h + '</th>').join("") +
      '</tr></thead><tbody>' + rows.map(r =>
        '<tr><td style="font-weight:500">' + esc(r.item) + '</td>' +
        '<td class="mono" style="font-weight:600">' + esc(r.val) + '</td>' +
        '<td class="mono" style="color:var(--c-text-mute)">' + esc(r.unit) + '</td>' +
        '<td class="mono" style="color:var(--c-text-mute)">' + esc(r.spec) + '</td>' +
        '<td><span class="badge badge-' + (r.pass ? "ok" : "risk") + '"><span class="badge-dot"></span>' +
          (r.pass ? "적합" : "부적합") + '</span></td></tr>').join("") +
      '</tbody></table>';
  }

  /* ── Wire ───────────────────────────────────────────────────────────── */

  $$(".track-tab").forEach(function (t) {
    t.addEventListener("click", function () {
      track = t.dataset.track;
      $$(".track-tab").forEach(x => x.setAttribute("aria-selected", String(x === t)));
      selected = null;
      paintTree(); paintDetail();
    });
  });

  $("#tree-search").addEventListener("input", function () {
    filter = this.value.trim();
    paintTree(); paintSelection();
  });

  // Deep link: explorer.html#P2508-01A
  function fromHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return false;
    const m = R.MATERIALS.find(x => x.id === id);
    if (m) { track = "B"; selected = { kind: "material", id }; expanded[m.batch] = true; }
    else if (R.BATCHES.some(x => x.id === id)) { track = "B"; selected = { kind: "batch", id }; }
    else if (R.PROJECTS.some(x => x.id === id)) { selected = { kind: "project", id }; }
    else return false;
    $$(".track-tab").forEach(x => x.setAttribute("aria-selected", String(x.dataset.track === track)));
    return true;
  }

  fromHash();
  paintTree();
  paintDetail();
  paintSelection();
  window.addEventListener("hashchange", function () { if (fromHash()) { paintTree(); paintDetail(); paintSelection(); } });
})();
