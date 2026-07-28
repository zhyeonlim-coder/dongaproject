/* ==========================================================================
   DoE & R&D Intelligence Hub

   Three sub-tabs:
     1. DoE 조건 설계 & 분석  — real design generation, OLS fit, RSM surface,
                                ANOVA with computed p-values
     2. AI 자연어 검색        — mock RAG + similar-batch recommendation
     3. 학술 문헌 & 특허      — 케이론(K-Ron) 화면. 구현은 kron.js.

   The DoE maths lives in doe.js and is genuinely computed. The AI tab is a
   mock (see ai-hub section below) and says so on screen.
   ========================================================================== */

(function () {
  "use strict";

  const user = window.Shell.mount({ page: "hub" });
  if (!user) return;

  /* LAB 은 문헌 목록에만 쓰였고 그 화면이 kron.js 로 옮겨가면서 필요 없어졌습니다.
     Store 는 DoE 예측값과 기존 배치 실적을 비교할 때 씁니다. */
  const S = window.Store, D = window.DOE;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  let tab = (location.hash || "").replace("#", "") || "doe";
  if (["doe", "ai", "lit"].indexOf(tab) === -1) tab = "doe";

  /* ── Sub-menu ───────────────────────────────────────────────────────── */
  function paintSubnav() {
    window.Shell.subnav([
      { label: "Intelligence Hub", items: [
        { key: "doe", ko: "DoE 조건 설계 & 분석", active: tab === "doe", color: "var(--c-accent-mid)" },
        { key: "ai",  ko: "AI 자연어 검색",       active: tab === "ai",  color: "#6D28D9" },
        { key: "lit", ko: "학술 문헌 & 특허 (K-Ron)", active: tab === "lit", color: "#0F766E" }
      ]},
      { label: "바로가기", items: [
        { ko: "대시보드", href: "dashboard.html" },
        { ko: "EBR 입력", href: "ebr.html" }
      ]}
    ], k => { tab = k; location.hash = k; paint(); });
  }

  /* ══════════════════════════════════════════════════════════════════════
     1. DoE
     ══════════════════════════════════════════════════════════════════════ */
  const DS = {
    factors: [
      { name: "pH",        unit: "—",       low: 6.8, high: 7.2 },
      { name: "Temp",      unit: "°C",      low: 34,  high: 37 },
      { name: "Feed rate", unit: "% v/v/d", low: 2.0, high: 5.0 }
    ],
    response: { name: "Titer", unit: "g/L" },
    designId: "bb", centers: 3,
    plan: null, responses: [], model: null,
    view: "contour", ax: 0, ay: 1, goal: "max"
  };

  function doeView() {
    return '<section class="card" style="margin-bottom:var(--s-4)">' +
        '<div class="card-head"><div>' +
          '<h2 class="card-title">① 요인 및 수준 정의 · Factors &amp; levels</h2>' +
          '<p class="card-sub">하한이 코드값 −1, 상한이 +1에 대응합니다 (요인 2~4개)</p>' +
        '</div><button class="btn btn-ghost btn-sm" id="add-factor">+ 요인 추가</button></div>' +
        '<div class="card-body"><div id="factors"></div>' +
          '<div class="rule-hair" style="margin:var(--s-5) 0"></div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:var(--s-4);align-items:end">' +
            '<div class="ebr-cell" style="max-width:140px"><label for="centers">중심점 반복</label>' +
              '<select class="ebr-input" id="centers">' +
                [0, 2, 3, 5].map(n => '<option value="' + n + '"' + (n === DS.centers ? " selected" : "") + '>' +
                  n + '회</option>').join("") + '</select></div>' +
            '<div class="ebr-cell" style="max-width:170px"><label for="resp-name">반응치</label>' +
              '<input class="ebr-input" id="resp-name" value="' + esc(DS.response.name) + '"></div>' +
            '<div class="ebr-cell" style="max-width:110px"><label for="resp-unit">단위</label>' +
              '<input class="ebr-input" id="resp-unit" value="' + esc(DS.response.unit) + '"></div>' +
            '<button class="btn btn-ghost btn-sm" id="demo-fill">예시 반응치로 시연</button>' +
          '</div>' +
        '</div></section>' +

      '<section class="card" style="margin-bottom:var(--s-4)">' +
        '<div class="card-head"><div>' +
          '<h2 class="card-title">② 실험 설계 선택 · Design selection</h2>' +
          '<p class="card-sub">요인 수에 따라 실험 횟수와 α가 자동 계산됩니다</p></div></div>' +
        '<div class="card-body"><div id="designs" ' +
          'style="display:grid;grid-template-columns:repeat(auto-fit,minmax(228px,1fr));gap:var(--s-3)"></div></div>' +
      '</section>' +

      '<section class="card" style="margin-bottom:var(--s-4)">' +
        '<div class="card-head"><div>' +
          '<h2 class="card-title">③ Run Table · 실험 배치표</h2>' +
          '<p class="card-sub" id="run-meta"></p></div></div>' +
        '<div class="tbl-scroll" id="runs"></div>' +
      '</section>' +

      '<section class="card">' +
        '<div class="card-head"><div>' +
          '<h2 class="card-title">④ 반응표면 분석 · Response Surface (RSM)</h2>' +
          '<p class="card-sub">최소제곱법으로 적합한 실제 모델 — 값을 바꾸면 곡면이 다시 계산됩니다</p></div></div>' +
        '<div id="analysis" aria-live="polite"></div>' +
      '</section>';
  }

  function paintFactors() {
    $("#factors").innerHTML =
      '<div class="factor-row" style="border:0;padding:0;margin-bottom:6px">' +
        ['요인', '단위', '하한 (−1)', '상한 (+1)', ''].map(h => '<span class="eyebrow">' + esc(h) + '</span>').join("") +
      '</div>' +
      DS.factors.map((f, i) =>
        '<div class="factor-row">' +
          '<input class="ebr-input" data-f="' + i + '" data-k="name" value="' + esc(f.name) + '" aria-label="요인 ' + (i + 1) + ' 이름">' +
          '<input class="ebr-input" data-f="' + i + '" data-k="unit" value="' + esc(f.unit) + '" aria-label="요인 ' + (i + 1) + ' 단위">' +
          '<input class="ebr-input mono" data-f="' + i + '" data-k="low" type="number" step="any" value="' + f.low + '" aria-label="요인 ' + (i + 1) + ' 하한">' +
          '<input class="ebr-input mono" data-f="' + i + '" data-k="high" type="number" step="any" value="' + f.high + '" aria-label="요인 ' + (i + 1) + ' 상한">' +
          '<button class="btn-icon" data-del="' + i + '" aria-label="' + esc(f.name) + ' 삭제"' +
            (DS.factors.length <= 2 ? " disabled" : "") + ' style="width:38px;height:38px">' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
            'aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg></button>' +
        '</div>').join("");

    $$("#factors input").forEach(inp => inp.addEventListener("change", function () {
      const f = DS.factors[+inp.dataset.f], k = inp.dataset.k;
      f[k] = (k === "low" || k === "high") ? +inp.value : inp.value;
      rebuild();
    }));
    $$("#factors [data-del]").forEach(b => b.addEventListener("click", function () {
      if (DS.factors.length <= 2) return;
      DS.factors.splice(+b.dataset.del, 1);
      DS.ax = 0; DS.ay = Math.min(1, DS.factors.length - 1);
      paintFactors(); rebuild();
    }));
  }

  function paintDesigns() {
    const k = DS.factors.length;
    $("#designs").innerHTML = Object.keys(D.DESIGNS).map(id => {
      const d = D.DESIGNS[id];
      const ok = k >= d.minK;
      const p = ok ? D.generate(id, DS.factors, DS.centers) : null;
      const need = 1 + 2 * k + k * (k - 1) / 2;
      return '<button class="design-opt" data-design="' + id + '" aria-pressed="' + (DS.designId === id) + '"' +
        (ok ? "" : ' disabled style="opacity:.45;cursor:not-allowed"') + '>' +
        '<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline">' +
          '<span class="design-opt-name">' + esc(d.ko) + '</span>' +
          '<span class="design-opt-meta">' + (p ? p.runs.length + " runs" : "요인 " + d.minK + "개 이상") + '</span></div>' +
        '<div class="design-opt-meta" style="margin-bottom:5px">' + esc(d.en) + '</div>' +
        '<div style="font-size:11.5px;color:var(--c-text-mute);line-height:1.6">' + esc(d.note) + '</div>' +
        (ok && !d.quadratic
          ? '<div style="font-size:11px;color:#8A4308;margin-top:6px">※ 2수준 설계 — 곡률(2차항) 추정 불가</div>'
          : ok ? '<div style="font-size:11px;color:var(--c-text-mute);margin-top:6px">2차 모델 계수 ' + need +
                 '개 · 최소 ' + need + ' runs</div>' : "") +
      '</button>';
    }).join("");
    $$("[data-design]").forEach(b => { if (!b.disabled) b.addEventListener("click", () => { DS.designId = b.dataset.design; rebuild(); }); });
  }

  function paintRuns() {
    const p = DS.plan;
    if (!p) { $("#runs").innerHTML = ""; return; }
    $("#run-meta").textContent = p.design.ko + " · 요인 " + p.k + "개 · " + p.runs.length +
      " runs · 중심점 " + DS.centers + "회" + (p.alpha !== 1 ? " · α = " + p.alpha : "");

    $("#runs").innerHTML = '<table class="tbl"><thead><tr><th scope="col">Run</th>' +
      DS.factors.map(f => '<th scope="col">' + esc(f.name) + '<br><span style="font-weight:400;text-transform:none">' +
        esc(f.unit) + '</span></th>').join("") +
      '<th scope="col" style="min-width:110px">' + esc(DS.response.name) + ' (' + esc(DS.response.unit) + ')</th>' +
      '</tr></thead><tbody>' +
      p.runs.map((r, i) => '<tr><td class="mono" style="font-weight:600">' + r.n + '</td>' +
        r.actual.map((a, f) => '<td class="mono">' + a + '<span style="color:var(--c-text-soft);font-size:10.5px"> (' +
          (r.coded[f] > 0 ? "+" : "") + r.coded[f] + ')</span></td>').join("") +
        '<td><input class="run-input' + (DS.responses[i] !== "" && DS.responses[i] != null ? " is-filled" : "") +
          '" type="number" step="any" data-run="' + i + '" value="' +
          (DS.responses[i] == null ? "" : DS.responses[i]) + '" aria-label="Run ' + r.n + ' 반응치"></td></tr>').join("") +
      '</tbody></table>';

    $$("[data-run]").forEach(inp => inp.addEventListener("input", function () {
      DS.responses[+inp.dataset.run] = inp.value === "" ? "" : +inp.value;
      inp.classList.toggle("is-filled", inp.value !== "");
      refit();
    }));
  }

  function refit() { DS.model = D.fit(DS.plan, DS.responses); paintAnalysis(); }

  function paintAnalysis() {
    const host = $("#analysis"), m = DS.model;
    if (!m || !m.ok) {
      const filled = DS.responses.filter(v => v !== "" && v != null).length;
      host.innerHTML = '<div class="empty">' +
        '<div class="empty-title">반응치를 입력하면 반응표면이 계산됩니다</div>' +
        '<div class="empty-body">' + (m && m.reason === "부족"
          ? '현재 ' + m.have + '개 입력됨. 이 설계의 2차 모델은 계수가 ' + m.need + '개이므로 최소 ' + m.need + '개가 필요합니다.'
          : 'Run Table에 실험 결과를 입력하세요. 현재 ' + filled + '개 입력됨.') + '</div>' +
        '<button class="btn btn-ghost btn-sm" id="fill2">예시 반응치 채우기</button></div>';
      const f = $("#fill2"); if (f) f.addEventListener("click", fillDemo);
      return;
    }

    const surf = D.grid(m, DS.plan.k, DS.ax, DS.ay, 56, DS.plan.alpha);
    const opt = D.optimise(m, DS.plan.k, DS.goal, DS.plan.alpha);
    const fx = DS.factors[DS.ax], fy = DS.factors[DS.ay];
    const fmt = f => c => D.codedToActual(c, f).toFixed(2);

    const chart = DS.view === "contour"
      ? D.contourSVG(surf, { xLabel: fx.name + " (" + fx.unit + ")", yLabel: fy.name + " (" + fy.unit + ")",
          fmtX: fmt(fx), fmtY: fmt(fy), marker: [opt.x[DS.ax], opt.x[DS.ay]],
          aria: fx.name + "과 " + fy.name + "에 대한 " + DS.response.name + " 반응표면 등고선" })
      : D.surface3D(surf, { xLabel: fx.name, yLabel: fy.name,
          aria: fx.name + "과 " + fy.name + "에 대한 3D 반응표면" });

    host.innerHTML = '<div class="card-body">' +
      '<div style="display:flex;flex-wrap:wrap;gap:var(--s-3);align-items:center;margin-bottom:var(--s-5)">' +
        '<div style="display:flex;gap:4px;padding:3px;background:var(--c-paper-2);border-radius:var(--r-md)">' +
          '<button class="track-tab" data-view="contour" aria-selected="' + (DS.view === "contour") +
            '" style="min-height:32px;padding:0 12px">등고선</button>' +
          '<button class="track-tab" data-view="3d" aria-selected="' + (DS.view === "3d") +
            '" style="min-height:32px;padding:0 12px">3D 곡면</button></div>' +
        axisSelect("ax-x", "X축", DS.ax) + axisSelect("ax-y", "Y축", DS.ay) +
        '<label style="font-size:12px;color:var(--c-text-mute)">목표' +
          '<select class="ebr-input" id="goal" style="min-height:34px;width:auto;display:inline-block;margin-left:6px">' +
            '<option value="max"' + (DS.goal === "max" ? " selected" : "") + '>최대화</option>' +
            '<option value="min"' + (DS.goal === "min" ? " selected" : "") + '>최소화</option></select></label>' +
      '</div>' +

      '<div class="contour-wrap">' +
        '<div>' + chart + '<p style="font-size:11px;color:var(--c-text-mute);margin:var(--s-2) 0 0">' +
          '나머지 요인은 중심값(0)에 고정. 흰 원은 예측 최적점입니다.</p></div>' +
        '<div>' +
          '<div class="eyebrow" style="margin-bottom:6px">' + esc(DS.response.name) + ' (' + esc(DS.response.unit) + ')</div>' +
          '<div class="legend-scale"></div>' +
          '<div style="display:flex;justify-content:space-between;font-family:var(--font-data);font-size:10px;' +
            'color:var(--c-text-mute);margin-top:3px"><span>' + surf.min.toFixed(2) + '</span>' +
            '<span>' + surf.max.toFixed(2) + '</span></div>' +
          '<div class="opt-box" style="margin-top:var(--s-5)">' +
            '<div class="ai-tag" style="margin-bottom:8px">AI 제안 최적 조건</div>' +
            '<div class="mono" style="font-size:22px;font-weight:600;letter-spacing:-.02em">' + opt.y.toFixed(3) +
              '<span style="font-size:12px;font-weight:400;color:var(--c-text-mute)"> ' + esc(DS.response.unit) + '</span></div>' +
            '<div style="font-size:11px;color:var(--c-text-mute);margin-bottom:10px">예측값 (' +
              (DS.goal === "max" ? "최대" : "최소") + ')</div>' +
            '<dl style="display:grid;grid-template-columns:auto 1fr;gap:6px 10px;font-size:12px;margin:0">' +
              DS.factors.map((f, i) => '<dt style="color:var(--c-text-mute)">' + esc(f.name) + '</dt>' +
                '<dd class="mono" style="margin:0;font-weight:600">' + D.codedToActual(opt.x[i], f).toFixed(2) +
                ' <span style="font-weight:400;color:var(--c-text-soft)">' + esc(f.unit) + '</span></dd>').join("") +
            '</dl></div>' +
          '<div style="margin-top:var(--s-4);font-size:12px">' +
            stat("R²", m.r2.toFixed(4)) + stat("수정 R²", isFinite(m.r2adj) ? m.r2adj.toFixed(4) : "—") +
            stat("RMSE", m.rmse.toFixed(4)) + stat("관측 / 계수", m.n + " / " + m.p) +
          '</div></div></div>' +

      '<div class="rule-hair" style="margin:var(--s-6) 0 var(--s-5)"></div>' +
      '<div class="eyebrow" style="margin-bottom:var(--s-3)">회귀계수 · Model coefficients</div>' +
      '<div class="tbl-scroll">' + coefTable(m) + '</div>' +

      '<div style="margin-top:var(--s-4)">' + anovaBlock(m) + '</div>' +

      '<div class="rule-hair" style="margin:var(--s-6) 0 var(--s-5)"></div>' +
      '<div class="eyebrow" style="margin-bottom:var(--s-3)">기존 Batch 실적과 비교</div>' + compare(opt.y) +
      '</div>';

    $$("[data-view]").forEach(b => b.addEventListener("click", () => { DS.view = b.dataset.view; paintAnalysis(); }));
    $("#ax-x").addEventListener("change", function () {
      DS.ax = +this.value; if (DS.ax === DS.ay) DS.ay = (DS.ax + 1) % DS.factors.length; paintAnalysis();
    });
    $("#ax-y").addEventListener("change", function () {
      DS.ay = +this.value; if (DS.ax === DS.ay) DS.ax = (DS.ay + 1) % DS.factors.length; paintAnalysis();
    });
    $("#goal").addEventListener("change", function () { DS.goal = this.value; paintAnalysis(); });
  }

  function axisSelect(id, label, val) {
    return '<label style="font-size:12px;color:var(--c-text-mute)">' + label +
      '<select class="ebr-input" id="' + id + '" style="min-height:34px;width:auto;display:inline-block;margin-left:6px">' +
      DS.factors.map((f, i) => '<option value="' + i + '"' + (i === val ? " selected" : "") + '>' +
        esc(f.name) + '</option>').join("") + '</select></label>';
  }
  function stat(k, v) {
    return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--c-paper-2)">' +
      '<span style="color:var(--c-text-mute)">' + esc(k) + '</span><span class="mono" style="font-weight:600">' +
      esc(v) + '</span></div>';
  }
  /* p-value 표기 — 0.0000 으로 반올림해 버리면 "정확히 0" 처럼 읽히므로
     아주 작은 값은 부등호로 씁니다. */
  function pText(p) {
    if (p === null || p === undefined || !isFinite(p)) return "—";
    if (p < 0.0001) return "&lt;0.0001";
    return p.toFixed(4);
  }
  /* 유의성 — 색만으로 구분하지 않도록 기호를 함께 표시합니다 */
  function sigMark(p) {
    if (p === null || p === undefined || !isFinite(p))
      return '<span class="sig sig-no">—</span>';
    if (p < 0.001) return '<span class="sig sig-yes">***</span>';
    if (p < 0.01)  return '<span class="sig sig-yes">**</span>';
    if (p < 0.05)  return '<span class="sig sig-yes">*</span>';
    return '<span class="sig sig-no">n.s.</span>';
  }

  function coefTable(m) {
    const max = Math.max.apply(null, m.beta.slice(1).map(Math.abs)) || 1;
    const hasP = !!m.pval;
    return '<table class="tbl stat-tbl"><thead><tr>' +
      '<th scope="col">항</th><th scope="col">계수</th>' +
      (hasP ? '<th scope="col">표준오차</th><th scope="col">t</th>' +
              '<th scope="col">p-value</th><th scope="col">유의성</th>' : "") +
      '<th scope="col">영향도</th></tr></thead><tbody>' +
      m.ts.map((t, i) => {
        const b = m.beta[i], w = i === 0 ? 0 : (Math.abs(b) / max) * 100;
        const p = hasP ? m.pval[i] : null;
        return '<tr><td class="mono" style="font-weight:600">' + esc(t.label) + '</td>' +
          '<td class="mono">' + (b >= 0 ? "+" : "") + b.toFixed(4) + '</td>' +
          (hasP
            ? '<td class="mono">' + m.se[i].toFixed(4) + '</td>' +
              '<td class="mono">' + (isFinite(m.tval[i]) ? m.tval[i].toFixed(3) : "—") + '</td>' +
              '<td class="mono"' + (isFinite(p) && p < 0.05 ? ' style="font-weight:700"' : "") + '>' +
                pText(p) + '</td>' +
              '<td>' + sigMark(p) + '</td>'
            : "") +
          '<td><div style="height:6px;background:var(--c-paper-2);border-radius:3px;overflow:hidden;min-width:70px">' +
          '<div style="height:100%;width:' + w.toFixed(1) + '%;background:' +
          (b >= 0 ? "var(--c-accent-mid)" : "#B45309") + ';border-radius:3px"></div></div></td></tr>';
      }).join("") + '</tbody></table>' +
      '<p style="font-size:11px;color:var(--c-text-mute);margin:var(--s-3) 0 0;line-height:1.7">' +
      '계수는 코드화 변수(−1~+1) 기준이라 서로 직접 비교할 수 있습니다. 파란색 양의 효과, 주황색 음의 효과.<br>' +
      (hasP
        ? '유의성 <b>***</b> p&lt;0.001 · <b>**</b> p&lt;0.01 · <b>*</b> p&lt;0.05 · <b>n.s.</b> 유의하지 않음 ' +
          '(잔차 자유도 ' + m.dfRes + ', 두쪽 t 검정)'
        : '잔차 자유도가 0이라 오차를 추정할 수 없어 p-value를 계산하지 않았습니다 — ' +
          '중심점 반복을 늘리거나 run을 추가하세요.') +
      '</p>';
  }

  /* ── ANOVA 분석표 (접기/펼치기) ─────────────────────────────────────────
     회의·보고 자리에서 "이 모델을 믿어도 되나"를 판단하는 근거입니다.
     기본은 접어 두고, 필요할 때만 펼칩니다. 인쇄 시에는 항상 펼쳐집니다. */
  function anovaBlock(m) {
    const A = m.anova;
    if (!A || !A.rows || !A.rows.length) return "";

    const num = (v, dp) => (v === null || v === undefined || !isFinite(v)) ? "—" : v.toFixed(dp);
    const modelP = A.rows[0] ? A.rows[0].p : NaN;
    const lof = A.rows.find(r => r.lof);

    const verdict = isFinite(modelP) && modelP < 0.05
      ? "모형 유의 (p " + (modelP < 0.0001 ? "< 0.0001" : "= " + modelP.toFixed(4)) + ")"
      : isFinite(modelP) ? "모형 유의하지 않음 (p = " + modelP.toFixed(4) + ")" : "판정 불가";

    return '<details class="disclose">' +
      '<summary>ANOVA 분석표 · Analysis of Variance' +
        '<span class="disclose-note">' + esc(verdict) + '</span></summary>' +

      '<div style="padding:0 var(--s-4) var(--s-4)">' +
        '<div class="tbl-scroll"><table class="tbl stat-tbl">' +
        '<thead><tr>' +
          '<th scope="col">Source</th><th scope="col">DF</th><th scope="col">SS</th>' +
          '<th scope="col">MS</th><th scope="col">F-value</th>' +
          '<th scope="col">p-value</th><th scope="col">유의성</th>' +
        '</tr></thead><tbody>' +
        A.rows.map(r =>
          '<tr class="' + (r.head ? "row-head" : r.sub ? "row-sub" : r.total ? "row-total" : "") + '">' +
            '<td>' + esc(r.source.trim()) + '</td>' +
            '<td class="mono">' + r.df + '</td>' +
            '<td class="mono">' + num(r.ss, 5) + '</td>' +
            '<td class="mono">' + num(r.ms, 5) + '</td>' +
            '<td class="mono">' + num(r.f, 3) + '</td>' +
            '<td class="mono"' + (isFinite(r.p) && r.p < 0.05 ? ' style="font-weight:700"' : "") + '>' +
              pText(r.p) + '</td>' +
            '<td>' + (isFinite(r.p) ? sigMark(r.p) : '<span class="sig sig-no">—</span>') + '</td>' +
          '</tr>').join("") +
        '</tbody></table></div>' +

        '<p style="font-size:11.5px;color:var(--c-text-mute);margin:var(--s-4) 0 0;line-height:1.8">' +
          '제곱합은 <b>순차 제곱합(Type I SS)</b>입니다 — ' +
          (A.seqOrder.length ? esc(A.seqOrder.join(" → ")) : "모형") +
          ' 순서로 항을 넣으며 잔차가 줄어드는 양을 나눈 값이라, 순서를 바꾸면 값도 달라집니다.<br>' +
          (A.hasLOF
            ? '중심점처럼 같은 조건을 반복한 run이 있어 잔차를 <b>적합결여</b>와 <b>순수오차</b>로 나눴습니다. ' +
              '적합결여가 유의하면(p&lt;0.05) R²가 높아도 모형 항이 부족하다는 뜻입니다' +
              (lof && isFinite(lof.p)
                ? ' — 현재 p = ' + (lof.p < 0.0001 ? "< 0.0001" : lof.p.toFixed(4)) +
                  (lof.p < 0.05 ? ' 로 <b>모형 재검토가 필요합니다</b>.' : ' 로 부적합 근거는 없습니다.')
                : '.')
            : '반복 run이 없어 적합결여와 순수오차를 분리할 수 없습니다 — 중심점 반복을 2회 이상 두면 분리됩니다.') +
        '</p>' +
      '</div></details>';
  }
  function compare(pred) {
    const bs = S.batches().filter(b => b.prj === window.Shell.project());
    const max = Math.max.apply(null, bs.map(b => b.titer).concat([pred])) * 1.12;
    return '<div style="display:grid;gap:var(--s-3)">' +
      bs.map(b => bar(b.id + " · " + b.scale, b.titer, max, "var(--c-navy-600)")).join("") +
      bar("DoE 예측 최적값", pred, max, "var(--c-accent-bright)", true) + '</div>';
  }
  function bar(label, v, max, color, hi) {
    return '<div><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">' +
      '<span' + (hi ? ' style="font-weight:600;color:var(--c-accent)"' : ' class="mono"') + '>' + esc(label) + '</span>' +
      '<span class="mono" style="font-weight:600' + (hi ? ";color:var(--c-accent)" : "") + '">' + v.toFixed(2) + ' g/L</span></div>' +
      '<div style="height:9px;background:var(--c-paper-2);border-radius:4px;overflow:hidden">' +
      '<div style="height:100%;width:' + ((v / max) * 100).toFixed(1) + '%;background:' + color + ';border-radius:4px"></div></div></div>';
  }

  function fillDemo() { DS.responses = D.demoResponses(DS.plan, 11); paintRuns(); refit(); }

  function rebuild() {
    const k = DS.factors.length;
    if (DS.ax >= k) DS.ax = 0;
    if (DS.ay >= k) DS.ay = Math.min(1, k - 1);
    if (DS.ax === DS.ay) DS.ay = (DS.ax + 1) % k;
    if (D.DESIGNS[DS.designId].minK > k) DS.designId = "ccd";
    DS.plan = D.generate(DS.designId, DS.factors, DS.centers);
    DS.responses = new Array(DS.plan ? DS.plan.runs.length : 0).fill("");
    DS.model = null;
    paintDesigns(); paintRuns(); paintAnalysis();
  }

  function wireDoe() {
    $("#add-factor").addEventListener("click", () => {
      if (DS.factors.length >= 4) return;
      DS.factors.push({ name: "Factor " + (DS.factors.length + 1), unit: "—", low: 0, high: 1 });
      paintFactors(); rebuild();
    });
    $("#centers").addEventListener("change", function () { DS.centers = +this.value; rebuild(); });
    $("#resp-name").addEventListener("change", function () { DS.response.name = this.value; paintRuns(); paintAnalysis(); });
    $("#resp-unit").addEventListener("change", function () { DS.response.unit = this.value; paintRuns(); paintAnalysis(); });
    $("#demo-fill").addEventListener("click", fillDemo);
    paintFactors(); rebuild();
  }

  /* ══════════════════════════════════════════════════════════════════════
     2. AI natural-language search
     ⚠ NOT AN LLM — keyword overlap against pre-written answers. Says so on screen.
     ══════════════════════════════════════════════════════════════════════ */
  const ANSWERS = [
    { match: ["titer", "3.5", "ph", "do", "배양", "조건"],
      answer: "조건을 만족하는 배치는 <b>2건</b>입니다 — B2402 (4.05 g/L), B2401 (3.62 g/L).\n\n" +
        "두 배치의 공통 조건은 <b>pH 7.00±0.02, DO 40±3%, 36.5°C</b>이며, 모두 Day 6–7에 피크 VCD에 도달했습니다. " +
        "역가가 가장 높았던 B2402는 피크 VCD 18.1×10⁶ cells/mL로 가장 높았고, 생존율 80% 도달 시점이 B2401보다 1.5일 늦었습니다.\n\n" +
        "진행 중인 B2403은 Day 7 기준 1.84 g/L로 동일 시점 B2402 대비 약 8% 낮습니다.",
      cites: ["B2401", "B2402", "B2403"] },
    { match: ["hcp", "정제", "resin", "수지", "회수율", "recovery"],
      answer: "정제 런 3건 중 <b>MabSelect PrismA</b>가 회수율 95.1%로 가장 높았습니다 (SuRe 92.4% 대비 +2.7%p).\n\n" +
        "HCP는 <b>Capto S ImpAct(CEX) 단계에서 가장 크게 감소</b>했습니다 — 611 → 38 ng/mg (93.8% 제거). " +
        "다만 해당 런의 회수율은 88.6%로 세 건 중 가장 낮아, 순도와 수율 간 트레이드오프가 확인됩니다.",
      cites: ["P2401-A", "P2402-A", "P2402-B"] },
    { match: ["oos", "규격", "이탈", "부적합", "cex"],
      answer: "현재 규격을 벗어난 항목은 <b>1건</b>입니다.\n\n" +
        "<b>P2402-B · CEX Main Peak 53.8%</b> (규격 55.0–70.0%). 같은 시료의 산성 변이체가 31.4%로 " +
        "규격 상한 30%를 함께 초과했습니다. 두 값은 같은 현상의 양면이며, CEX 용출 pH 조정으로 개선된 과거 사례가 있습니다.",
      cites: ["P2402-B"] }
  ];

  const RECS = [
    { score: 94, ko: "B2308 배치와 공정 조건 유사",
      detail: "pH·DO·Feed 프로파일이 진행 중인 B2403과 94% 일치. 해당 배치는 Day 14 Titer 3.78 g/L 달성.", to: "B2403" },
    { score: 88, ko: "P2402-B CEX 이탈과 유사한 과거 사례",
      detail: "2025년 동일 항목이 54.1%로 이탈했으며, CEX 용출 pH를 5.6 → 5.8로 조정해 해소됨.", to: "P2402-B" },
    { score: 81, ko: "재사용 가능한 DoE 설계",
      detail: "Box-Behnken(pH·Temp·Feed) 설계가 현재 요인과 동일. Run Table 재사용 가능.", to: "doe" }
  ];

  function aiView() {
    return '<section class="card" style="margin-bottom:var(--s-4)">' +
      '<div class="card-body">' +
        '<div class="ai-bar">' +
          '<span class="ai-bar-icon" aria-hidden="true"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" ' +
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15v4M17 17h4"/></svg></span>' +
          '<label class="sr-only" for="ai-q">연구 데이터 자연어 검색</label>' +
          '<input class="ai-bar-input" id="ai-q" type="search" autocomplete="off" ' +
            'placeholder="예: DA-3880 배양 중 Titer 3.5 g/L 이상 나온 pH/DO 조건 조회">' +
          '<button class="btn btn-accent ai-bar-go" id="ai-go" type="button">검색</button>' +
        '</div>' +
        '<div class="ai-suggest">' +
          ["DA-3880 배양 중 Titer 3.5 g/L 이상 나온 pH/DO 조건 조회",
           "Resin별 회수율과 HCP 제거 성능 비교",
           "현재 규격 이탈(OOS) 항목 알려줘"].map(s =>
            '<button class="ai-chip" data-q="' + esc(s) + '">' + esc(s) + '</button>').join("") +
        '</div>' +
        '<div id="ai-out" style="margin-top:var(--s-4)" aria-live="polite"></div>' +
      '</div></section>' +

      '<section class="card">' +
        '<div class="card-head"><div>' +
          '<h2 class="card-title">AI 추천 · 유사 실험</h2>' +
          '<p class="card-sub">진행 중인 배치·시료와 과거 데이터를 비교해 자동 추천</p></div>' +
          '<span class="badge badge-accent"><span class="badge-dot"></span>데모 응답</span></div>' +
        '<div class="card-body" style="display:grid;gap:var(--s-3)">' +
          RECS.map(r => '<button class="ai-rec" data-to="' + esc(r.to) + '">' +
            '<span class="ai-score">' + r.score + '%</span>' +
            '<span style="min-width:0"><span style="display:block;font-size:13px;font-weight:600;margin-bottom:3px">' +
              '💡 ' + esc(r.ko) + '</span>' +
            '<span style="display:block;font-size:12px;color:var(--c-text-mute);line-height:1.6">' +
              esc(r.detail) + '</span></span></button>').join("") +
        '</div></section>';
  }

  function wireAI() {
    const input = $("#ai-q"), out = $("#ai-out");
    function run() {
      const q = input.value.trim();
      if (!q) { out.innerHTML = ""; return; }
      out.innerHTML = '<div class="ai-panel"><span class="ai-tag">' +
        '<span class="badge-dot" style="background:currentColor"></span>AI 검색 중…</span>' +
        '<div style="margin-top:var(--s-3);display:grid;gap:8px">' +
        '<div style="height:9px;width:82%;background:var(--c-paper-2);border-radius:4px"></div>' +
        '<div style="height:9px;width:64%;background:var(--c-paper-2);border-radius:4px"></div></div></div>';

      setTimeout(() => {
        const ql = q.toLowerCase();
        let best = null, score = 0;
        ANSWERS.forEach(a => {
          const s = a.match.reduce((n, k) => n + (ql.indexOf(k.toLowerCase()) > -1 ? 1 : 0), 0);
          if (s > score) { score = s; best = a; }
        });
        if (!best) {
          out.innerHTML = '<div class="ai-panel"><span class="ai-tag">AI 응답</span>' +
            '<p style="font-size:13.5px;margin:var(--s-3) 0 0;line-height:1.75">' +
            '이 데모는 미리 작성된 3개 질의에만 응답합니다. 위 예시 질문을 눌러 보세요.</p>' +
            '<p style="font-size:12px;color:var(--c-text-mute);margin:var(--s-2) 0 0">' +
            '실제 배포 시 사내 RAG 검색 엔진에 연결됩니다.</p></div>';
          return;
        }
        out.innerHTML = '<div class="ai-panel rise"><span class="ai-tag">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
          'aria-hidden="true"><path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/></svg>AI 응답</span>' +
          '<p style="font-size:13.5px;line-height:1.8;margin:var(--s-3) 0 0;white-space:pre-line">' + best.answer + '</p>' +
          '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:var(--s-4);' +
            'padding-top:var(--s-3);border-top:1px solid var(--c-accent-bg-2)">' +
            '<span style="font-size:11.5px;color:var(--c-text-mute)">근거 데이터</span>' +
            best.cites.map(c => '<span class="badge badge-accent mono">' + esc(c) + '</span>').join("") + '</div>' +
          '<p style="font-size:11px;color:var(--c-text-mute);margin:var(--s-3) 0 0">' +
          '⚠ 데모 응답입니다 — 실제 생성형 모델이 아니라 사전 작성된 답변입니다.</p></div>';
      }, 620);
    }
    $("#ai-go").addEventListener("click", run);
    input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); run(); } });
    $$(".ai-chip").forEach(c => c.addEventListener("click", () => { input.value = c.dataset.q; run(); }));
    $$("[data-to]").forEach(b => b.addEventListener("click", () => {
      const t = b.dataset.to;
      if (t === "doe") { tab = "doe"; location.hash = "doe"; paint(); }
      else window.location.href = "explorer.html#" + t;
    }));
  }

  /* ══════════════════════════════════════════════════════════════════════
     3. 학술 문헌 & 특허 — 케이론(K-Ron) 화면
     화면 구성은 kron.js 가 전부 담당합니다. 상태(질의 결과 · 업로드 문서 ·
     대화 기록)를 그 모듈이 들고 있어야 탭을 옮겼다 돌아와도 살아남습니다.
     ══════════════════════════════════════════════════════════════════════ */
  function kronView() { return window.KRon.view(); }
  function wireKron() { window.KRon.wire(); }

  /* ── Paint ──────────────────────────────────────────────────────────── */
  function paint() {
    paintSubnav();
    const titles = { doe: "DoE 조건 설계 & 분석", ai: "AI 자연어 검색 & 유사실험 추천",
                     lit: "학술 문헌 & 특허 · 케이론(K-Ron)" };
    $("#page-title").textContent = titles[tab];
    $("#hub-tabs").innerHTML = [["doe", "DoE 설계 & 분석"], ["ai", "AI 검색"], ["lit", "K-Ron · 문헌 & 특허"]]
      .map(([k, ko]) => '<button class="track-tab" data-tab="' + k + '" aria-selected="' + (tab === k) + '" ' +
        'style="min-height:38px;padding:0 var(--s-5)">' + esc(ko) + '</button>').join("");
    $$("[data-tab]").forEach(b => b.addEventListener("click", () => { tab = b.dataset.tab; location.hash = tab; paint(); }));

    const host = $("#hub-body");
    host.innerHTML = tab === "doe" ? doeView() : tab === "ai" ? aiView() : kronView();
    if (tab === "doe") wireDoe(); else if (tab === "ai") wireAI(); else wireKron();
  }

  window.Shell.on("project", paint);
  paint();
})();
