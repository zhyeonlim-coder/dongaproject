/* ==========================================================================
   ask-verify.js — 서술 문장의 수치 검증  ·  window.AskVerify

   왜 필요한가
     조회는 정확했는데 문장에서 숫자가 바뀔 수 있습니다. narrate 단계도
     LLM 이고, "981.4" 가 "981" 이 되는 정도면 무해하지만 "2494" 가
     "2949" 가 되면 규제 문서에 잘못된 값이 실립니다.

   무엇을 하는가
     서술된 문장에서 숫자를 전부 뽑아, 조회 결과 객체에 실제로 있는 값인지
     대조합니다. 하나라도 근거가 없으면 그 문장을 쓰지 않고 엔진이 만든
     결정론적 문장으로 되돌립니다. 의심스러우면 안 쓰는 쪽입니다.

   허용 범위
     반올림은 허용합니다 — 엔진이 "981.4" 로 계산했는데 문장이 "981" 이면
     같은 값으로 봅니다. 원값에서 유효숫자를 줄인 것만 허용하고, 없는
     숫자를 새로 만든 것은 허용하지 않습니다.
   ========================================================================== */

window.AskVerify = (function () {
  "use strict";

  /* 문장에서 숫자를 뽑습니다. 날짜(2024-08-16)는 통째로 따로 다루고,
     천 단위 콤마는 붙여서 하나의 수로 읽습니다. */
  function numbersIn(text) {
    let t = String(text == null ? "" : text);
    const dates = t.match(/\d{4}-\d{2}-\d{2}/g) || [];
    t = t.replace(/\d{4}-\d{2}-\d{2}/g, " ");
    t = t.replace(/(\d),(?=\d{3}\b)/g, "$1");          /* 1,234 → 1234 */
    const nums = (t.match(/-?\d+(?:\.\d+)?/g) || []).map(Number).filter(n => isFinite(n));
    return { nums: nums, dates: dates };
  }

  /* 결과 객체에서 "근거가 되는 값" 을 전부 모읍니다.
     여기 없는 숫자가 문장에 있으면 그것은 지어낸 값입니다. */
  function knownFrom(r) {
    const nums = [];
    const dates = [];
    const push = v => {
      if (v === null || v === undefined) return;
      const g = numbersIn(v);
      g.nums.forEach(n => nums.push(n));
      g.dates.forEach(d => dates.push(d));
    };

    push(r.headline);
    push(r.note);
    (r.facts || []).forEach(f => { push(f.k); push(f.v); });
    (r.context || []).forEach(f => { push(f.k); push(f.v); });
    (r.hints || []).forEach(push);
    (r.applied || []).forEach(push);
    (r.unhandled || []).forEach(push);
    (r.warnings || []).forEach(push);
    (r.rows || []).forEach(row => Object.keys(row).forEach(k => push(row[k])));
    (r.compare || []).forEach(c => { push(c.group); push(c.n); push(c.mean); push(c.min); push(c.max); });
    (r.series || []).forEach(s => (s.points || []).forEach(p => { push(p.day); push(p.value); }));
    (r.choices || []).forEach(c => { push(c.label); push(c.hint); });

    if (r.stats) ["n", "mean", "median", "sd", "min", "max", "cv"].forEach(k => push(r.stats[k]));
    if (typeof r.scopeRows === "number") nums.push(r.scopeRows);
    if (r.metric) push(r.metric.label);

    return { nums: nums, dates: dates };
  }

  /* 반올림 허용 — 원값의 유효숫자를 줄인 형태만 같은 값으로 봅니다 */
  function matches(n, known) {
    for (let i = 0; i < known.length; i++) {
      const v = known[i];
      if (n === v) return true;
      /* 소수 자리를 줄여 쓴 경우: 0~3 자리로 반올림해 비교 */
      for (let dp = 0; dp <= 3; dp++) {
        if (Number(v.toFixed(dp)) === n) return true;
      }
      /* 정수로 내림·올림한 경우 */
      if (Math.floor(v) === n || Math.ceil(v) === n) return true;
    }
    return false;
  }

  /* 검증. 반환 { ok, unknownNums[], unknownDates[] } */
  function checkNarration(text, r) {
    const said = numbersIn(text);
    const known = knownFrom(r);
    const unknownNums = said.nums.filter(n => !matches(n, known.nums));
    const unknownDates = said.dates.filter(d => known.dates.indexOf(d) === -1);
    return {
      ok: !unknownNums.length && !unknownDates.length,
      unknownNums: unknownNums,
      unknownDates: unknownDates,
      checked: said.nums.length + said.dates.length
    };
  }

  return { checkNarration: checkNarration, _numbersIn: numbersIn, _knownFrom: knownFrom };
})();
