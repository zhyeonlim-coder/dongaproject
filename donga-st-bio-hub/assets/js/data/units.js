/* ==========================================================================
   units.js — 임계값 파싱 + 단위 해석 (공통)  ·  window.Units

   왜 공통 모듈인가
     AI 검색(ask-engine.js)과 회의 모드 봇(meeting-ask.js)이 각자 임계값을
     읽고 있었습니다. 한쪽만 고치면 같은 질문이 화면마다 다르게 동작합니다.
     숫자를 조건으로 바꾸는 일은 여기 한 곳에서만 합니다.

   왜 단위를 따지는가
     "Titer 3 이상" 은 [Titer HCCF ≥ 3 mg/L] 로 읽혀 28건 전부를 통과시켰고,
     조건 없는 질문과 완전히 같은 결과를 냈습니다. 라벨은 붙어 있었지만
     연구원은 걸러진 결과로 봅니다 — 실질적인 오답입니다.
     Titer 실측이 18~2494 mg/L 이므로 "3" 은 g/L 를 뜻했을 가능성이 큽니다.
     여기서는 값을 마음대로 바꾸지 않고, 어느 쪽으로 읽을지 되묻습니다.

   판단 규칙 (실측 범위 대조)
     value < min/2  또는  value > max*2   →  단위 불일치 의심
     의심되면 환산 후보 중 [min/2, max*2] 안에 들어오는 것을 함께 제시합니다.
     질문에 단위가 명시되어 있으면("3 g/L 이상") 되묻지 않고 그대로 따릅니다.
   ========================================================================== */

window.Units = (function () {
  "use strict";

  /* 컬럼의 표준 단위 → 받아 줄 다른 단위와 환산 계수(표준 단위로 가는 배수) */
  const CONVERT = {
    "mg/l": { "g/L": 1000, "μg/L": 0.001, "ug/L": 0.001, "㎍/L": 0.001 },
    "ppm":  { "ppb": 0.001, "%": 10000 },
    "ppb":  { "ppm": 1000 },
    "pg/mg": { "ng/mg": 1000 },
    "%":    { "소수 비율(0~1)": 100 },
    "10⁶ cells/ml": { "10⁷ cells/mL": 10, "10⁵ cells/mL": 0.1 }
  };

  /* 질문에 직접 적힌 단위 */
  const UNIT_RE = /(g\/l|mg\/l|μg\/l|µg\/l|ug\/l|ppm|ppb|pg\/mg|ng\/mg|%)/i;

  function norm(u) {
    return String(u || "").toLowerCase().replace(/\s+/g, "")
      .replace(/µ/g, "μ").replace(/㎍/g, "μg");
  }

  /* ══════════════════════════════════════════════════════════════════════
     1. 임계값 파싱 — 두 화면이 같은 문법을 씁니다
     ══════════════════════════════════════════════════════════════════════ */

  /* 반환: [{ op, min, max, raw, unit }]
       op = between | gte | gt | lte | lt
       unit = 질문에 명시된 단위 (없으면 null) */
  function parseThresholds(text) {
    let t = " " + String(text || "").toLowerCase().replace(/,(\d)/g, "$1") + " ";
    const out = [];
    const N = "(-?\\d+(?:\\.\\d+)?)";
    const U = "\\s*(g\\/l|mg\\/l|μg\\/l|µg\\/l|ug\\/l|ppm|ppb|pg\\/mg|ng\\/mg|%)?\\s*";

    const eat = function (re, make) {
      let m;
      while ((m = re.exec(t)) !== null) {
        const got = make(m);
        if (got) out.push(got);
        t = t.slice(0, m.index) + " ".repeat(m[0].length) + t.slice(m.index + m[0].length);
        re.lastIndex = 0;
      }
    };

    /* 구간이 먼저입니다 — "1000~2000" 을 두 개의 단독 값으로 읽으면 안 됩니다 */
    eat(new RegExp(N + U + "(?:~|—|에서|부터)\\s*" + N + U + "(?:사이|이내)?", "g"), function (m) {
      const a = Number(m[1]), b = Number(m[3]);
      return { op: "between", min: Math.min(a, b), max: Math.max(a, b),
               raw: m[0].trim(), unit: m[2] || m[4] || null };
    });
    eat(new RegExp(N + U + "보다\\s*(?:더\\s*)?(?:크|큰|높|많)", "g"),
      m => ({ op: "gt", min: Number(m[1]), max: null, raw: m[0].trim(), unit: m[2] || null }));
    eat(new RegExp(N + U + "보다\\s*(?:더\\s*)?(?:작|적|낮)", "g"),
      m => ({ op: "lt", min: null, max: Number(m[1]), raw: m[0].trim(), unit: m[2] || null }));
    eat(new RegExp(N + U + "(?:초과|넘는|넘게)", "g"),
      m => ({ op: "gt", min: Number(m[1]), max: null, raw: m[0].trim(), unit: m[2] || null }));
    eat(new RegExp(N + U + "미만", "g"),
      m => ({ op: "lt", min: null, max: Number(m[1]), raw: m[0].trim(), unit: m[2] || null }));
    eat(new RegExp(N + U + "(?:이상|over|above|>=?)", "g"),
      m => ({ op: "gte", min: Number(m[1]), max: null, raw: m[0].trim(), unit: m[2] || null }));
    eat(new RegExp(N + U + "(?:이하|below|under|<=?)", "g"),
      m => ({ op: "lte", min: null, max: Number(m[1]), raw: m[0].trim(), unit: m[2] || null }));
    eat(new RegExp("최소\\s*" + N + U, "g"),
      m => ({ op: "gte", min: Number(m[1]), max: null, raw: m[0].trim(), unit: m[2] || null }));
    eat(new RegExp("최대\\s*" + N + U, "g"),
      m => ({ op: "lte", min: null, max: Number(m[1]), raw: m[0].trim(), unit: m[2] || null }));
    return out;
  }

  /* ══════════════════════════════════════════════════════════════════════
     2. 단위 해석 — 실측 범위와 대조합니다
     ══════════════════════════════════════════════════════════════════════ */

  function observedRange(rows, key) {
    let lo = null, hi = null;
    (rows || []).forEach(function (r) {
      const v = r[key];
      if (typeof v !== "number" || !isFinite(v)) return;
      if (lo === null || v < lo) lo = v;
      if (hi === null || v > hi) hi = v;
    });
    return lo === null ? null : { min: lo, max: hi };
  }

  function short(v) {
    const n = Number(v);
    return Math.abs(n) >= 100 ? String(Math.round(n)) : String(+n.toFixed(3));
  }

  /* value 하나를 읽는 방법을 판단합니다.
     반환: { value, factor, note, suspect, options[] }
       value   — 컬럼 단위로 환산된 값 (명시 단위가 있으면 환산 후)
       suspect — 단위가 안 맞아 보여 되물어야 하는가
       options — 되물을 후보 [{ label, unit, value, factor }] */
  function interpret(rawValue, explicitUnit, col, rows) {
    const unit = col && col.unit ? col.unit : "";
    const key = norm(unit);
    const table = CONVERT[key] || {};
    const out = { value: rawValue, factor: 1, note: "", suspect: false, options: [] };

    /* 단위를 직접 적었으면 그대로 따릅니다 — 되묻지 않습니다 */
    if (explicitUnit) {
      const e = norm(explicitUnit);
      if (e === key) return out;
      let f = null, canon = explicitUnit;
      /* 표기는 표준형으로 되돌립니다 — 사용자가 "g/l" 로 적어도 "g/L" 로 보입니다 */
      Object.keys(table).forEach(function (alt) { if (norm(alt) === e) { f = table[alt]; canon = alt; } });
      if (f !== null) {
        out.value = rawValue * f;
        out.factor = f;
        out.note = short(rawValue) + " " + canon + " = " + short(out.value) + " " + unit +
          " 로 해석했습니다.";
        return out;
      }
      out.note = "\"" + explicitUnit + "\" 는 이 항목의 단위(" + (unit || "무단위") +
        ")로 환산할 수 없어 숫자를 그대로 적용했습니다.";
      return out;
    }

    const rg = observedRange(rows, col && col.key);
    if (!rg) return out;

    /* 실측 범위에서 현저히 벗어나면 단위가 다른 것으로 봅니다 */
    const lo = rg.min / 2, hi = rg.max * 2;
    if (rawValue >= lo && rawValue <= hi) return out;

    const cands = [];
    Object.keys(table).forEach(function (alt) {
      const v = rawValue * table[alt];
      if (v >= lo && v <= hi) cands.push({ label: short(rawValue) + " " + alt, unit: alt, value: v, factor: table[alt] });
    });
    if (!cands.length) return out;          /* 환산해도 안 맞으면 그대로 둡니다 */

    out.suspect = true;
    out.options = [{ label: short(rawValue) + " " + (unit || "(단위 없음)"), unit: unit, value: rawValue, factor: 1 }]
      .concat(cands);
    out.note = col.label + " 의 실측 범위는 " + short(rg.min) + " ~ " + short(rg.max) + " " + unit +
      " 입니다. \"" + short(rawValue) + "\" 이(가) 그 범위 밖이라 단위를 확인해야 합니다.";
    return out;
  }

  /* 임계값 하나(op·min·max)를 컬럼 단위로 해석 */
  function interpretThreshold(th, col, rows) {
    const res = { th: { op: th.op, min: th.min, max: th.max }, notes: [], suspect: false, options: null };
    ["min", "max"].forEach(function (side) {
      if (th[side] === null || th[side] === undefined) return;
      const r = interpret(th[side], th.unit, col, rows);
      res.th[side] = r.value;
      if (r.note) res.notes.push(r.note);
      if (r.suspect) { res.suspect = true; res.options = r.options; res.side = side; }
    });
    return res;
  }

  /* 조건이 실제로 행을 걸러 내는가 — 아무것도 못 거르면 알려 줘야 합니다 */
  function isNoOp(rows, key, th) {
    const total = rows.filter(r => typeof r[key] === "number" && isFinite(r[key])).length;
    const kept = rows.filter(function (r) {
      const v = r[key];
      if (typeof v !== "number" || !isFinite(v)) return false;
      if (th.op === "between") return v >= th.min && v <= th.max;
      if (th.op === "gte") return v >= th.min;
      if (th.op === "gt") return v > th.min;
      if (th.op === "lte") return v <= th.max;
      return v < th.max;
    }).length;
    return { total: total, kept: kept, noop: total > 0 && kept === total };
  }

  return {
    CONVERT: CONVERT, UNIT_RE: UNIT_RE,
    parseThresholds: parseThresholds,
    interpret: interpret, interpretThreshold: interpretThreshold,
    observedRange: observedRange, isNoOp: isNoOp, _norm: norm
  };
})();
