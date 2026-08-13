/* ==========================================================================
   calc.js — 현장 계산 도구

   지금 이 계산들은 엑셀에서 이뤄지고, 결과 숫자만 시스템에 옮겨 적힙니다.
   그러면 나중에 값이 이상해 보여도 **어떤 수로 그 값이 나왔는지** 되짚을
   수 없습니다. 계산을 화면 안으로 들이는 이유는 편해서가 아니라,
   근거를 값과 함께 남기기 위해서입니다.

   그래서 모든 계산 함수는 결과와 함께 **식(basis)** 문자열을 돌려줍니다.
   그 문자열이 값의 변경 사유로 그대로 들어갑니다.

     정제 물질수지    부피 x 농도 -> 단계 수율
     배양 피드량      배양 부피 x 피드율
     접종 부피 역산   목표 밀도 x 목표 부피 / 종배양 밀도
     희석            C1V1 = C2V2
   ========================================================================== */

window.Calc = (function () {
  "use strict";

  const esc = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const num = (v) => {
    const n = parseFloat(v);
    return isFinite(n) ? n : null;
  };
  const r = (v, dp) => (v === null ? null : +v.toFixed(dp === undefined ? 2 : dp));

  /* ── 정제 물질수지 ──────────────────────────────────────────────────────
     단계 수율 = (용출 부피 x 용출 농도) / (로드 부피 x 로드 농도) x 100 */
  function massBalance(i) {
    const lv = num(i.loadVol), lc = num(i.loadConc);
    const ev = num(i.eluVol), ec = num(i.eluConc);
    if (lv === null || lc === null || ev === null || ec === null)
      return { ok: false, reason: "네 칸을 모두 채우세요" };
    if (lv <= 0 || lc <= 0) return { ok: false, reason: "로드 부피와 농도는 0보다 커야 합니다" };

    const loadMass = lv * lc;                 // mg
    const eluMass = ev * ec;                  // mg
    const yieldPct = (eluMass / loadMass) * 100;

    return {
      ok: true,
      loadMass: r(loadMass, 1), eluMass: r(eluMass, 1), yieldPct: r(yieldPct, 1),
      concFactor: r((ec / lc), 2),
      basis: "물질수지: 로드 " + r(lv, 1) + " mL x " + r(lc, 2) + " mg/mL = " + r(loadMass, 1) +
             " mg → 용출 " + r(ev, 1) + " mL x " + r(ec, 2) + " mg/mL = " + r(eluMass, 1) +
             " mg (수율 " + r(yieldPct, 1) + "%)",
      warn: yieldPct > 100
        ? "수율이 100%를 넘습니다 — 부피나 농도 단위를 확인하세요."
        : (yieldPct < 50 ? "수율이 50% 미만입니다 — 값과 단계를 확인하세요." : null)
    };
  }

  /* ── 배양 피드량 ────────────────────────────────────────────────────────
     피드량 = 현재 배양 부피 x 피드율(% v/v) */
  function feedVolume(i) {
    const cv = num(i.cultureVol), rate = num(i.feedRate);
    if (cv === null || rate === null) return { ok: false, reason: "배양 부피와 피드율을 입력하세요" };
    if (cv <= 0) return { ok: false, reason: "배양 부피는 0보다 커야 합니다" };
    const vol = cv * (rate / 100);
    return {
      ok: true,
      feedVol: r(vol, 1), newVol: r(cv + vol, 1),
      basis: "피드량: 배양 " + r(cv, 1) + " mL x " + r(rate, 2) + "% = " + r(vol, 1) +
             " mL (공급 후 " + r(cv + vol, 1) + " mL)",
      warn: rate > 10 ? "피드율 10%를 넘습니다 — 통상 범위(2~5%)를 벗어납니다." : null
    };
  }

  /* ── 접종 부피 역산 ─────────────────────────────────────────────────────
     필요 부피 = 목표 밀도 x 목표 부피 / 종배양 밀도 */
  function seedVolume(i) {
    const target = num(i.targetVCD), tv = num(i.targetVol), seed = num(i.seedVCD);
    if (target === null || tv === null || seed === null)
      return { ok: false, reason: "세 칸을 모두 채우세요" };
    if (seed <= 0) return { ok: false, reason: "종배양 밀도는 0보다 커야 합니다" };
    if (seed <= target)
      return { ok: false, reason: "종배양 밀도가 목표 밀도보다 낮아 접종할 수 없습니다" };

    const need = (target * tv) / seed;
    return {
      ok: true,
      seedVol: r(need, 1), mediaVol: r(tv - need, 1), ratio: r(seed / target, 1),
      basis: "접종: 목표 " + r(target, 2) + " x10⁶/mL x " + r(tv, 1) + " mL ÷ 종배양 " +
             r(seed, 2) + " x10⁶/mL = 종배양 " + r(need, 1) + " mL + 배지 " + r(tv - need, 1) + " mL",
      warn: need > tv ? "필요 부피가 목표 부피를 넘습니다 — 종배양을 더 키워야 합니다." : null
    };
  }

  /* ── 희석 (C1V1 = C2V2) ────────────────────────────────────────────────
     비운 칸 하나를 나머지 셋으로 채웁니다. */
  function dilution(i) {
    const c1 = num(i.c1), v1 = num(i.v1), c2 = num(i.c2), v2 = num(i.v2);
    const given = [c1, v1, c2, v2].filter(x => x !== null).length;
    if (given !== 3) return { ok: false, reason: "네 칸 중 세 칸을 채우면 나머지를 계산합니다" };

    let out, label;
    if (c1 === null)      { out = (c2 * v2) / v1; label = "원액 농도 C1"; }
    else if (v1 === null) { out = (c2 * v2) / c1; label = "필요한 원액 부피 V1"; }
    else if (c2 === null) { out = (c1 * v1) / v2; label = "희석 후 농도 C2"; }
    else                  { out = (c1 * v1) / c2; label = "최종 부피 V2"; }

    if (!isFinite(out)) return { ok: false, reason: "0으로 나눌 수 없습니다" };

    const fold = (c1 !== null && c2 !== null) ? c1 / c2
               : (v2 !== null && v1 !== null) ? v2 / v1 : null;

    return {
      ok: true, value: r(out, 3), label: label,
      fold: fold !== null ? r(fold, 1) : null,
      basis: "희석 (C1V1 = C2V2): " + label + " = " + r(out, 3) +
             (fold !== null ? " · " + r(fold, 1) + "배 희석" : "")
    };
  }

  /* ══════════════════════════════════════════════════════════════════════
     화면 — EBR 안에 접어 두고 필요할 때 펼칩니다
     ══════════════════════════════════════════════════════════════════════ */

  const TOOLS = {
    mass: {
      ko: "정제 물질수지", team: "downstream",
      sub: "부피 x 농도로 단계 수율을 산출합니다",
      fields: [
        { k: "loadVol",  label: "로드 부피", unit: "mL" },
        { k: "loadConc", label: "로드 농도", unit: "mg/mL" },
        { k: "eluVol",   label: "용출 부피", unit: "mL" },
        { k: "eluConc",  label: "용출 농도", unit: "mg/mL" }
      ],
      run: massBalance,
      out: (o) => [
        ["로드 질량", o.loadMass + " mg"],
        ["용출 질량", o.eluMass + " mg"],
        ["단계 수율", o.yieldPct + " %"],
        ["농축 배수", o.concFactor + " 배"]
      ],
      /* 계산 결과를 어느 입력 필드에 넣을 수 있는지 */
      applyTo: [{ field: "downstream_proteinAYield", label: "Protein A Step Yield", pick: o => o.yieldPct },
                { field: "downstream_cexYield",      label: "CEX Step Yield",       pick: o => o.yieldPct },
                { field: "downstream_aexYield",      label: "AEX Step Yield",       pick: o => o.yieldPct }]
    },
    feed: {
      ko: "배양 피드량", team: "upstream",
      sub: "현재 배양 부피와 피드율로 오늘 공급량을 구합니다",
      fields: [
        { k: "cultureVol", label: "현재 배양 부피", unit: "mL" },
        { k: "feedRate",   label: "피드율", unit: "% v/v" }
      ],
      run: feedVolume,
      out: (o) => [["공급량", o.feedVol + " mL"], ["공급 후 부피", o.newVol + " mL"]],
      applyTo: []
    },
    seed: {
      ko: "접종 부피 역산", team: "upstream",
      sub: "목표 밀도에 맞춰 종배양을 얼마나 넣을지 계산합니다",
      fields: [
        { k: "targetVCD", label: "목표 접종 밀도", unit: "x10⁶/mL" },
        { k: "targetVol", label: "목표 배양 부피", unit: "mL" },
        { k: "seedVCD",   label: "종배양 밀도", unit: "x10⁶/mL" }
      ],
      run: seedVolume,
      out: (o) => [["종배양", o.seedVol + " mL"], ["배지", o.mediaVol + " mL"],
                   ["희석 배수", o.ratio + " 배"]],
      applyTo: []
    },
    dilute: {
      ko: "희석 · 농도 환산", team: null,
      sub: "C1V1 = C2V2 — 세 칸을 채우면 나머지를 채웁니다",
      fields: [
        { k: "c1", label: "원액 농도 C1", unit: "" },
        { k: "v1", label: "원액 부피 V1", unit: "mL" },
        { k: "c2", label: "희석 후 농도 C2", unit: "" },
        { k: "v2", label: "최종 부피 V2", unit: "mL" }
      ],
      run: dilution,
      out: (o) => [[o.label, String(o.value)]].concat(o.fold !== null ? [["희석 배수", o.fold + " 배"]] : []),
      applyTo: []
    }
  };

  /* team 을 주면 그 팀에 해당하는 도구만 (희석은 어느 팀이든 씁니다) */
  function toolsFor(team) {
    return Object.keys(TOOLS).filter(k => !TOOLS[k].team || !team || TOOLS[k].team === team);
  }

  function panel(team) {
    const keys = toolsFor(team);
    if (!keys.length) return "";
    return '<details class="disclose" style="margin:0 var(--s-5) var(--s-4)">' +
      '<summary>계산 도구' +
        '<span class="disclose-note">계산에 쓴 식이 변경 사유로 함께 기록됩니다</span></summary>' +
      '<div style="padding:0 var(--s-4) var(--s-4)">' +
        '<div class="calc-tabs" role="tablist">' +
          keys.map((k, i) => '<button class="mm-chip" data-calc="' + k + '" ' +
            'aria-pressed="' + (i === 0) + '">' + esc(TOOLS[k].ko) + '</button>').join("") +
        '</div>' +
        '<div id="calc-body" style="margin-top:var(--s-3)"></div>' +
      '</div></details>';
  }

  /* onApply(fieldKey, value, basis) — 계산 결과를 입력 필드에 넣을 때 */
  function wire(root, onApply) {
    const host = root.querySelector("#calc-body");
    if (!host) return;
    const tabs = Array.prototype.slice.call(root.querySelectorAll("[data-calc]"));
    if (!tabs.length) return;
    let cur = tabs[0].dataset.calc;

    function paint() {
      const t = TOOLS[cur];
      host.innerHTML =
        '<p style="font-size:12px;color:var(--c-text-mute);margin:0 0 var(--s-3)">' + esc(t.sub) + '</p>' +
        '<div class="ebr-grid">' + t.fields.map(f =>
          '<label class="ebr-cell"><span>' + esc(f.label) +
            (f.unit ? ' <span style="font-weight:400;color:var(--c-text-soft)">(' + esc(f.unit) + ')</span>' : "") +
          '</span>' +
          '<input class="ebr-input mono" type="number" step="any" data-ci="' + f.k + '"></label>').join("") +
        '</div>' +
        '<div style="display:flex;gap:var(--s-2);align-items:center;margin-top:var(--s-3);flex-wrap:wrap">' +
          '<button class="btn btn-accent btn-sm" data-crun="1">계산</button>' +
          '<button class="btn btn-ghost btn-sm" data-cclear="1">지우기</button>' +
        '</div>' +
        '<div id="calc-out" style="margin-top:var(--s-3)" aria-live="polite"></div>';

      tabs.forEach(b => b.setAttribute("aria-pressed", String(b.dataset.calc === cur)));

      host.querySelector("[data-crun]").addEventListener("click", run);
      host.querySelector("[data-cclear]").addEventListener("click", function () {
        Array.prototype.forEach.call(host.querySelectorAll("[data-ci]"), i => { i.value = ""; });
        host.querySelector("#calc-out").innerHTML = "";
      });
      Array.prototype.forEach.call(host.querySelectorAll("[data-ci]"), function (inp) {
        inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); run(); } });
      });
    }

    function run() {
      const t = TOOLS[cur];
      const input = {};
      Array.prototype.forEach.call(host.querySelectorAll("[data-ci]"), i => {
        input[i.dataset.ci] = i.value === "" ? null : i.value;
      });
      const res = t.run(input);
      const out = host.querySelector("#calc-out");

      if (!res.ok) {
        out.innerHTML = '<p class="field-msg is-error" style="display:block">' + esc(res.reason) + '</p>';
        return;
      }

      out.innerHTML =
        '<div class="calc-note" style="border-left-color:var(--c-accent)">' +
          '<div style="display:flex;gap:var(--s-4);flex-wrap:wrap">' +
            t.out(res).map(p =>
              '<div><div class="eyebrow" style="margin-bottom:2px">' + esc(p[0]) + '</div>' +
              '<div class="mono" style="font-size:17px;font-weight:600">' + esc(p[1]) + '</div></div>').join("") +
          '</div>' +
          (res.warn ? '<p class="field-msg is-warn" style="display:block;margin-top:var(--s-3)">' +
            esc(res.warn) + '</p>' : "") +
          '<p style="font-size:11.5px;color:var(--c-text-mute);margin:var(--s-3) 0 0;line-height:1.7">' +
            esc(res.basis) + '</p>' +
          ((t.applyTo || []).length && onApply
            ? '<div style="display:flex;gap:var(--s-2);flex-wrap:wrap;margin-top:var(--s-3)">' +
              t.applyTo.map((a, i) => '<button class="btn btn-ghost btn-sm" data-capply="' + i + '">' +
                esc(a.label) + '에 넣기</button>').join("") + '</div>'
            : "") +
        '</div>';

      Array.prototype.forEach.call(out.querySelectorAll("[data-capply]"), function (b) {
        b.addEventListener("click", function () {
          const a = t.applyTo[+b.dataset.capply];
          onApply(a.field, a.pick(res), res.basis);
        });
      });
    }

    tabs.forEach(b => b.addEventListener("click", function () { cur = b.dataset.calc; paint(); }));
    paint();
  }

  return { massBalance, feedVolume, seedVolume, dilution, TOOLS, toolsFor, panel, wire };
})();
