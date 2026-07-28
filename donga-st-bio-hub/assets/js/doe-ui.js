/* ==========================================================================
   DoE module UI — wizard, run table, response surface

   All numbers on screen come from doe.js. Changing a factor range, a design,
   or any response value re-runs the real fit and redraws the surface.
   ========================================================================== */

(function () {
  "use strict";

  const D = window.DOE;
  const user = window.Shell.mount({ page: "doe", title: "DoE 공정개발 · Design of Experiments" });
  if (!user) return;

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  /* ── State ──────────────────────────────────────────────────────────── */
  const S = {
    factors: [
      { name: "pH",        unit: "—",      low: 6.8,  high: 7.2 },
      { name: "Temp",      unit: "°C",     low: 34,   high: 37 },
      { name: "Feed rate", unit: "% v/v/d", low: 2.0, high: 5.0 }
    ],
    response: { name: "Titer", unit: "g/L" },
    designId: "bb",
    centers: 3,
    plan: null,
    responses: [],
    model: null,
    view: "contour",
    ax: 0, ay: 1,
    goal: "max"
  };

  /* ── Step indicator ─────────────────────────────────────────────────── */
  function paintSteps() {
    const done = {
      1: S.factors.length >= 2,
      2: !!S.plan,
      3: !!S.plan,
      4: S.responses.filter(v => v !== "" && v != null).length > 0,
      5: !!(S.model && S.model.ok)
    };
    const active = !S.plan ? 2 : (!done[4] ? 4 : 5);
    const labels = ["요인 정의", "설계 선택", "Run Table", "결과 입력", "반응표면 분석"];
    $("#steps").innerHTML = labels.map((l, i) => {
      const n = i + 1;
      const state = n === active ? "active" : (done[n] ? "done" : "todo");
      return '<div class="doe-step" data-state="' + state + '">' +
        '<span class="doe-step-n">' + (state === "done" && n !== active ? "✓" : n) + '</span>' + esc(l) + '</div>';
    }).join("");
  }

  /* ── 1. Factors ─────────────────────────────────────────────────────── */
  function paintFactors() {
    $("#factors").innerHTML =
      '<div class="factor-row" style="border:0;padding:0;margin-bottom:6px">' +
        ['요인 (Factor)', '단위', '하한 (−1)', '상한 (+1)', ''].map(h =>
          '<span class="eyebrow">' + esc(h) + '</span>').join("") +
      '</div>' +
      S.factors.map((f, i) =>
        '<div class="factor-row">' +
          '<input class="input" data-f="' + i + '" data-k="name" value="' + esc(f.name) + '" aria-label="요인 ' + (i + 1) + ' 이름">' +
          '<input class="input" data-f="' + i + '" data-k="unit" value="' + esc(f.unit) + '" aria-label="요인 ' + (i + 1) + ' 단위">' +
          '<input class="input mono" data-f="' + i + '" data-k="low" type="number" step="any" value="' + f.low + '" aria-label="요인 ' + (i + 1) + ' 하한">' +
          '<input class="input mono" data-f="' + i + '" data-k="high" type="number" step="any" value="' + f.high + '" aria-label="요인 ' + (i + 1) + ' 상한">' +
          '<button class="btn-icon" data-del="' + i + '" aria-label="' + esc(f.name) + ' 요인 삭제"' +
            (S.factors.length <= 2 ? " disabled" : "") + ' style="width:38px;height:38px">' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
            '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg></button>' +
        '</div>').join("");

    $$("#factors input").forEach(inp => {
      inp.addEventListener("change", function () {
        const f = S.factors[+inp.dataset.f], k = inp.dataset.k;
        f[k] = (k === "low" || k === "high") ? +inp.value : inp.value;
        rebuild();
      });
    });
    $$("#factors [data-del]").forEach(b => {
      b.addEventListener("click", function () {
        if (S.factors.length <= 2) return;
        S.factors.splice(+b.dataset.del, 1);
        S.ax = 0; S.ay = Math.min(1, S.factors.length - 1);
        rebuild(); paintFactors();
      });
    });
  }

  /* ── 2. Design choice ───────────────────────────────────────────────── */
  function paintDesigns() {
    const k = S.factors.length;
    $("#designs").innerHTML = Object.keys(D.DESIGNS).map(id => {
      const d = D.DESIGNS[id];
      const ok = k >= d.minK;
      const p = ok ? D.generate(id, S.factors, S.centers) : null;
      const need = 1 + 2 * k + k * (k - 1) / 2;
      return '<button class="design-opt" data-design="' + id + '" aria-pressed="' + (S.designId === id) + '"' +
        (ok ? "" : ' disabled style="opacity:.45;cursor:not-allowed"') + '>' +
        '<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline">' +
          '<span class="design-opt-name">' + esc(d.ko) + '</span>' +
          '<span class="design-opt-meta">' + (p ? p.runs.length + " runs" : "요인 " + d.minK + "개 이상") + '</span>' +
        '</div>' +
        '<div class="design-opt-meta" style="margin-bottom:5px">' + esc(d.en) + '</div>' +
        '<div style="font-size:11.5px;color:var(--c-text-mute);line-height:1.6">' + esc(d.note) + '</div>' +
        (ok && !d.quadratic
          ? '<div style="font-size:11px;color:#8A4308;margin-top:6px">※ 2수준 설계 — 곡률(2차항) 추정 불가, 선형+교호작용 모델로 적합</div>'
          : ok ? '<div style="font-size:11px;color:var(--c-text-mute);margin-top:6px">2차 모델 계수 ' + need + '개 · 최소 ' + need + ' runs 필요</div>' : "") +
        '</button>';
    }).join("");

    $$("[data-design]").forEach(b => {
      if (b.disabled) return;
      b.addEventListener("click", function () { S.designId = b.dataset.design; rebuild(); });
    });
  }

  /* ── 3. Run table ───────────────────────────────────────────────────── */
  function paintRuns() {
    const p = S.plan;
    if (!p) { $("#runs").innerHTML = ""; return; }

    $("#run-meta").textContent =
      p.design.ko + " · 요인 " + p.k + "개 · " + p.runs.length + " runs · 중심점 " + S.centers + "회" +
      (p.alpha !== 1 ? " · α = " + p.alpha : "");

    $("#runs").innerHTML =
      '<table class="tbl"><thead><tr>' +
        '<th scope="col">Run</th>' +
        S.factors.map(f => '<th scope="col">' + esc(f.name) + '<br><span style="font-weight:400;text-transform:none">' +
          esc(f.unit) + '</span></th>').join("") +
        '<th scope="col" style="min-width:112px">' + esc(S.response.name) + ' (' + esc(S.response.unit) + ')</th>' +
      '</tr></thead><tbody>' +
      p.runs.map((r, i) =>
        '<tr>' +
          '<td class="mono" style="font-weight:600">' + r.n + '</td>' +
          r.actual.map((a, f) =>
            '<td class="mono">' + a +
            '<span style="color:var(--c-text-soft);font-size:10.5px"> (' + (r.coded[f] > 0 ? "+" : "") + r.coded[f] + ')</span></td>').join("") +
          '<td><input class="run-input' + (S.responses[i] !== "" && S.responses[i] != null ? " is-filled" : "") +
            '" type="number" step="any" data-run="' + i + '" value="' + (S.responses[i] == null ? "" : S.responses[i]) +
            '" aria-label="Run ' + r.n + ' 반응치"></td>' +
        '</tr>').join("") +
      '</tbody></table>';

    $$("[data-run]").forEach(inp => {
      inp.addEventListener("input", function () {
        S.responses[+inp.dataset.run] = inp.value === "" ? "" : +inp.value;
        inp.classList.toggle("is-filled", inp.value !== "");
        refit();
      });
    });
  }

  /* ── 4/5. Fit + surface ─────────────────────────────────────────────── */
  function refit() {
    if (!S.plan) return;
    S.model = D.fit(S.plan, S.responses);
    paintSteps();
    paintAnalysis();
  }

  function paintAnalysis() {
    const host = $("#analysis");
    const m = S.model;

    if (!m || !m.ok) {
      const filled = S.responses.filter(v => v !== "" && v != null).length;
      host.innerHTML =
        '<div class="empty">' +
          '<div class="empty-title">반응치를 입력하면 반응표면이 계산됩니다</div>' +
          '<div class="empty-body">' +
            (m && m.reason === "부족"
              ? '현재 ' + m.have + '개 입력됨. 이 설계의 2차 모델은 계수가 ' + m.need + '개이므로 최소 ' +
                m.need + '개의 반응치가 필요합니다.'
              : '위 Run Table에 실험 결과를 입력하세요. 현재 ' + filled + '개 입력됨.') +
          '</div>' +
          '<button class="btn btn-ghost btn-sm" id="fill-demo">예시 반응치 채우기</button>' +
        '</div>';
      const fd = $("#fill-demo");
      if (fd) fd.addEventListener("click", fillDemo);
      return;
    }

    const surf = D.grid(m, S.plan.k, S.ax, S.ay, 56, S.plan.alpha);
    const opt = D.optimise(m, S.plan.k, S.goal, S.plan.alpha);
    const fx = S.factors[S.ax], fy = S.factors[S.ay];
    const fmt = (f) => (c) => D.codedToActual(c, f).toFixed(2);

    const chart = S.view === "contour"
      ? D.contourSVG(surf, {
          xLabel: fx.name + " (" + fx.unit + ")", yLabel: fy.name + " (" + fy.unit + ")",
          fmtX: fmt(fx), fmtY: fmt(fy),
          marker: [opt.x[S.ax], opt.x[S.ay]],
          aria: fx.name + "과 " + fy.name + "에 대한 " + S.response.name + " 반응표면 등고선"
        })
      : D.surface3D(surf, {
          xLabel: fx.name, yLabel: fy.name,
          aria: fx.name + "과 " + fy.name + "에 대한 " + S.response.name + " 3D 반응표면"
        });

    host.innerHTML =
      '<div class="card-body">' +

        '<div style="display:flex;flex-wrap:wrap;gap:var(--s-3);align-items:center;margin-bottom:var(--s-5)">' +
          '<div style="display:flex;gap:4px;padding:3px;background:var(--c-paper-2);border-radius:var(--r-md)">' +
            '<button class="track-tab" data-view="contour" aria-selected="' + (S.view === "contour") + '" style="min-height:32px;padding:0 12px">등고선</button>' +
            '<button class="track-tab" data-view="3d" aria-selected="' + (S.view === "3d") + '" style="min-height:32px;padding:0 12px">3D 곡면</button>' +
          '</div>' +
          '<label style="font-size:12px;color:var(--c-text-mute)">X축' +
            '<select class="input" id="ax-x" style="min-height:34px;font-size:12.5px;margin-left:6px;width:auto;display:inline-block">' +
              S.factors.map((f, i) => '<option value="' + i + '"' + (i === S.ax ? " selected" : "") + '>' + esc(f.name) + '</option>').join("") +
            '</select></label>' +
          '<label style="font-size:12px;color:var(--c-text-mute)">Y축' +
            '<select class="input" id="ax-y" style="min-height:34px;font-size:12.5px;margin-left:6px;width:auto;display:inline-block">' +
              S.factors.map((f, i) => '<option value="' + i + '"' + (i === S.ay ? " selected" : "") + '>' + esc(f.name) + '</option>').join("") +
            '</select></label>' +
          '<label style="font-size:12px;color:var(--c-text-mute)">목표' +
            '<select class="input" id="goal" style="min-height:34px;font-size:12.5px;margin-left:6px;width:auto;display:inline-block">' +
              '<option value="max"' + (S.goal === "max" ? " selected" : "") + '>최대화</option>' +
              '<option value="min"' + (S.goal === "min" ? " selected" : "") + '>최소화</option>' +
            '</select></label>' +
        '</div>' +

        '<div class="contour-wrap">' +
          '<div>' + chart +
            '<p style="font-size:11px;color:var(--c-text-mute);margin:var(--s-2) 0 0">' +
              '나머지 요인은 중심값(0)에 고정. 흰 원은 예측 최적점입니다.</p>' +
          '</div>' +

          '<div>' +
            '<div class="eyebrow" style="margin-bottom:6px">' + esc(S.response.name) + ' (' + esc(S.response.unit) + ')</div>' +
            '<div class="legend-scale"></div>' +
            '<div style="display:flex;justify-content:space-between;font-family:var(--font-data);font-size:10px;' +
                        'color:var(--c-text-mute);margin-top:3px">' +
              '<span>' + surf.min.toFixed(2) + '</span><span>' + surf.max.toFixed(2) + '</span></div>' +

            '<div class="opt-box" style="margin-top:var(--s-5)">' +
              '<div class="ai-tag" style="margin-bottom:8px">AI 제안 최적 조건</div>' +
              '<div class="mono" style="font-size:22px;font-weight:600;letter-spacing:-.02em">' +
                opt.y.toFixed(3) + '<span style="font-size:12px;font-weight:400;color:var(--c-text-mute)"> ' +
                esc(S.response.unit) + '</span></div>' +
              '<div style="font-size:11px;color:var(--c-text-mute);margin-bottom:10px">예측값 (' +
                (S.goal === "max" ? "최대" : "최소") + ')</div>' +
              '<dl style="display:grid;grid-template-columns:auto 1fr;gap:6px 10px;font-size:12px;margin:0">' +
                S.factors.map((f, i) =>
                  '<dt style="color:var(--c-text-mute)">' + esc(f.name) + '</dt>' +
                  '<dd class="mono" style="margin:0;font-weight:600">' + D.codedToActual(opt.x[i], f).toFixed(2) +
                  ' <span style="font-weight:400;color:var(--c-text-soft)">' + esc(f.unit) + '</span></dd>').join("") +
              '</dl>' +
            '</div>' +

            '<div style="margin-top:var(--s-4);font-size:12px">' +
              '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--c-paper-2)">' +
                '<span style="color:var(--c-text-mute)">R²</span><span class="mono" style="font-weight:600">' + m.r2.toFixed(4) + '</span></div>' +
              '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--c-paper-2)">' +
                '<span style="color:var(--c-text-mute)">수정 R²</span><span class="mono">' +
                  (isFinite(m.r2adj) ? m.r2adj.toFixed(4) : "—") + '</span></div>' +
              '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--c-paper-2)">' +
                '<span style="color:var(--c-text-mute)">RMSE</span><span class="mono">' + m.rmse.toFixed(4) + '</span></div>' +
              '<div style="display:flex;justify-content:space-between;padding:5px 0">' +
                '<span style="color:var(--c-text-mute)">관측 / 계수</span><span class="mono">' + m.n + ' / ' + m.p + '</span></div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="rule-hair" style="margin:var(--s-6) 0 var(--s-5)"></div>' +
        '<div class="eyebrow" style="margin-bottom:var(--s-3)">회귀계수 · Model coefficients</div>' +
        '<div class="tbl-scroll">' + coefTable(m) + '</div>' +

        '<div class="rule-hair" style="margin:var(--s-6) 0 var(--s-5)"></div>' +
        '<div class="eyebrow" style="margin-bottom:var(--s-3)">기존 Batch 데이터와 비교</div>' +
        compareBatches(opt.y) +
      '</div>';

    $$("[data-view]").forEach(b => b.addEventListener("click", function () { S.view = b.dataset.view; paintAnalysis(); }));
    $("#ax-x").addEventListener("change", function () {
      S.ax = +this.value; if (S.ax === S.ay) S.ay = (S.ax + 1) % S.factors.length; paintAnalysis();
    });
    $("#ax-y").addEventListener("change", function () {
      S.ay = +this.value; if (S.ax === S.ay) S.ax = (S.ay + 1) % S.factors.length; paintAnalysis();
    });
    $("#goal").addEventListener("change", function () { S.goal = this.value; paintAnalysis(); });
  }

  function coefTable(m) {
    const max = Math.max.apply(null, m.beta.slice(1).map(Math.abs)) || 1;
    return '<table class="tbl"><thead><tr>' +
      ['항', '계수', '영향도'].map(h => '<th scope="col">' + h + '</th>').join("") +
      '</tr></thead><tbody>' +
      m.ts.map((t, i) => {
        const b = m.beta[i];
        const w = i === 0 ? 0 : (Math.abs(b) / max) * 100;
        return '<tr><td class="mono" style="font-weight:600">' + esc(t.label) + '</td>' +
          '<td class="mono">' + (b >= 0 ? "+" : "") + b.toFixed(4) + '</td>' +
          '<td><div style="height:6px;background:var(--c-paper-2);border-radius:3px;overflow:hidden;min-width:70px">' +
            '<div style="height:100%;width:' + w.toFixed(1) + '%;background:' +
            (b >= 0 ? "var(--c-accent-mid)" : "#B45309") + ';border-radius:3px"></div></div></td></tr>';
      }).join("") + '</tbody></table>' +
      '<p style="font-size:11px;color:var(--c-text-mute);margin:var(--s-3) 0 0">' +
      '계수는 코드화 변수(−1 ~ +1) 기준이므로 서로 직접 비교할 수 있습니다. ' +
      '파란색은 양의 효과, 주황색은 음의 효과입니다.</p>';
  }

  function compareBatches(predicted) {
    const bs = window.RND.BATCHES;
    const all = bs.map(b => b.titer).concat([predicted]);
    const max = Math.max.apply(null, all) * 1.12;
    return '<div style="display:grid;gap:var(--s-3)">' +
      bs.map(b =>
        '<div><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">' +
          '<span class="mono">' + esc(b.id) + ' <span style="color:var(--c-text-mute)">' + esc(b.scale) + '</span></span>' +
          '<span class="mono" style="font-weight:600">' + b.titer + ' g/L</span></div>' +
          '<div style="height:9px;background:var(--c-paper-2);border-radius:4px;overflow:hidden">' +
            '<div style="height:100%;width:' + ((b.titer / max) * 100).toFixed(1) +
            '%;background:var(--c-navy-600);border-radius:4px"></div></div></div>').join("") +
      '<div><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">' +
        '<span style="font-weight:600;color:var(--c-accent)">DoE 예측 최적값</span>' +
        '<span class="mono" style="font-weight:600;color:var(--c-accent)">' + predicted.toFixed(2) + ' g/L</span></div>' +
        '<div style="height:9px;background:var(--c-paper-2);border-radius:4px;overflow:hidden">' +
          '<div style="height:100%;width:' + ((predicted / max) * 100).toFixed(1) +
          '%;background:var(--c-accent-bright);border-radius:4px"></div></div></div>' +
      '</div>';
  }

  function fillDemo() {
    S.responses = D.demoResponses(S.plan, 11);
    paintRuns();
    refit();
  }

  /* ── Rebuild ────────────────────────────────────────────────────────── */
  function rebuild() {
    const k = S.factors.length;
    if (S.ax >= k) S.ax = 0;
    if (S.ay >= k) S.ay = Math.min(1, k - 1);
    if (S.ax === S.ay) S.ay = (S.ax + 1) % k;

    if (D.DESIGNS[S.designId].minK > k) S.designId = "ccd";
    S.plan = D.generate(S.designId, S.factors, S.centers);
    S.responses = new Array(S.plan ? S.plan.runs.length : 0).fill("");
    S.model = null;
    paintDesigns(); paintRuns(); paintSteps(); paintAnalysis();
  }

  /* ── Wire ───────────────────────────────────────────────────────────── */
  $("#add-factor").addEventListener("click", function () {
    if (S.factors.length >= 4) return;
    S.factors.push({ name: "Factor " + (S.factors.length + 1), unit: "—", low: 0, high: 1 });
    paintFactors(); rebuild();
  });
  $("#centers").addEventListener("change", function () { S.centers = +this.value; rebuild(); });
  $("#resp-name").addEventListener("change", function () { S.response.name = this.value; paintRuns(); paintAnalysis(); });
  $("#resp-unit").addEventListener("change", function () { S.response.unit = this.value; paintRuns(); paintAnalysis(); });
  $("#demo-fill-top").addEventListener("click", fillDemo);

  paintFactors();
  rebuild();
})();
