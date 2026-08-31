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
  function numbersIn(text, mask) {
    let t = String(text == null ? "" : text);
    const dates = t.match(/\d{4}-\d{2}-\d{2}/g) || [];
    t = t.replace(/\d{4}-\d{2}-\d{2}/g, " ");

    /* 식별자를 먼저 걷어냅니다. "B123-10" 을 그냥 두면 123 과 -10 이라는
       측정값이 문장에 있는 것처럼 읽혀, 멀쩡한 답이 전부 차단됩니다. */
    (mask || []).forEach(function (m) {
      if (!m || String(m).length < 2) return;
      t = t.split(m).join(" ");
    });
    /* 남은 식별자 꼴(B045-2 · DA-1234 · UNSPEC-01 · D10) 도 제거 */
    t = t.replace(/[A-Za-z]+[-_]?\d+(?:-\d+)*/g, " ");

    t = t.replace(/(\d),(?=\d{3}\b)/g, "$1");          /* 1,234 → 1234 */
    /* 음수는 앞이 비었거나 공백·괄호일 때만 — "89.5-70" 의 -70 은 구간 표기입니다 */
    const nums = [];
    const re = /(^|[\s(\[])(-?\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)/g;
    let m;
    while ((m = re.exec(t)) !== null) {
      const v = Number(m[2] !== undefined ? m[2] : m[3]);
      if (isFinite(v)) nums.push(v);
    }
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

  /* ══════════════════════════════════════════════════════════════════════
     엔진이 만든 문장의 검증

     checkNarration 은 LLM 문장을 "조회 결과 객체" 와 대조합니다. 그건
     엔진 문장에는 쓸 수 없습니다 — 자기 자신과 대조하는 셈이라 무엇이든
     통과합니다. 그래서 여기서는 허용집합을 문자열이 아니라 데이터에서
     직접 만듭니다.

     허용하는 것
       · 표의 모든 셀 값과 날짜
       · 조회 범위(그리고 전체)에 대해 다시 계산한 통계 n·평균·중앙값·
         표준편차·최소·최대·CV, 그룹별 평균과 그 차이(절대·%)
       · 구조적인 수 — 행 수 · 컬럼 수 · 과제 수 · 배열 길이 · 기록 건수
       · 질문에 사용자가 쓴 숫자와 조건값(임계값 · 상위N · 기간)
       · 배양 경과일 라벨(D10 → 10)

     이건 "LLM 이 지어냈나" 를 보는 것이 아니라 "엔진 코드에 버그가 있어
     엉뚱한 값이 문장에 실렸나" 를 보는 것입니다. 성격이 다른 검사이므로
     결과도 따로 표시합니다.
     ══════════════════════════════════════════════════════════════════════ */

  function statsOf(vals) {
    const n = vals.length;
    if (!n) return [];
    const s = vals.slice().sort((a, b) => a - b);
    const sum = vals.reduce((a, b) => a + b, 0);
    const mean = sum / n;
    const mid = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
    const sd = n > 1 ? Math.sqrt(vals.reduce((a, v) => a + (v - mean) * (v - mean), 0) / (n - 1)) : 0;
    const out = [n, mean, mid, sd, s[0], s[n - 1], sum];
    if (mean) out.push((sd / mean) * 100);
    return out;
  }

  function numsOfRows(rows, keys) {
    const out = [];
    rows.forEach(function (r) {
      keys.forEach(function (k) {
        const v = r[k];
        if (typeof v === "number" && isFinite(v)) out.push(v);
      });
    });
    return out;
  }

  /* 데이터에서 유도한 허용집합 */
  function allowedFrom(r, table) {
    const nums = [];
    const dates = [];
    const push = v => { if (typeof v === "number" && isFinite(v)) nums.push(v); };
    const pushAll = a => a.forEach(push);

    const numKeys = table.columns.filter(c => c.type === "num").map(c => c.key);
    const allRows = table.rows;
    const scoped = (r.carry && r.carry.rowIds && r.carry.rowIds.length)
      ? allRows.filter(x => r.carry.rowIds.indexOf(x.__id) > -1)
      : allRows;

    /* 1) 모든 셀 값 · 날짜 */
    pushAll(numsOfRows(allRows, numKeys));
    allRows.forEach(function (x) {
      [x.date, x.endDate].forEach(function (d) {
        if (!d) return;
        dates.push(d);
        /* 연 · 월 · 일도 따로 허용합니다 — "2025년 1월 배치" 같은 문구가
           날짜 문자열이 아니라 숫자로 나오기 때문입니다 */
        push(Number(d.slice(0, 4))); push(Number(d.slice(5, 7))); push(Number(d.slice(8, 10)));
      });
      if (typeof x.cultureDays === "number") push(x.cultureDays);
    });

    /* 2) 범위별 · 전체 통계 (모든 수치 컬럼) */
    numKeys.forEach(function (k) {
      pushAll(statsOf(scoped.map(x => x[k]).filter(v => typeof v === "number" && isFinite(v))));
      pushAll(statsOf(allRows.map(x => x[k]).filter(v => typeof v === "number" && isFinite(v))));
      /* 기록 건수 · 미입력 건수 */
      const f = scoped.filter(x => typeof x[k] === "number").length;
      push(f); push(scoped.length - f);
      const fa = allRows.filter(x => typeof x[k] === "number").length;
      push(fa); push(allRows.length - fa);
    });

    /* 3) 그룹별 평균과 그 차이 — compare 응답이 쓰는 값 */
    ["project", "study", "team"].forEach(function (axis) {
      const g = {};
      scoped.forEach(function (x) { const key = x[axis] || "미지정"; (g[key] = g[key] || []).push(x); });
      numKeys.forEach(function (k) {
        const means = [];
        Object.keys(g).forEach(function (name) {
          const vals = g[name].map(x => x[k]).filter(v => typeof v === "number" && isFinite(v));
          if (!vals.length) return;
          const st = statsOf(vals);
          pushAll(st);
          means.push(st[1]);
        });
        means.forEach(function (a) {
          means.forEach(function (b) {
            push(a - b);
            if (b) push(((a - b) / Math.abs(b)) * 100);
          });
        });
      });
    });

    /* 4) 구조적인 수 */
    push(allRows.length); push(scoped.length); push(table.columns.length);
    push(numKeys.length); push(r.scopeRows);
    ["rows", "facts", "context", "hints", "warnings", "applied", "unhandled",
     "choices", "compare", "series", "suggestions"].forEach(function (k) {
      if (Array.isArray(r[k])) push(r[k].length);
    });
    const projects = {}, studies = {};
    allRows.forEach(function (x) { if (x.project) projects[x.project] = 1; if (x.study) studies[x.study] = 1; });
    push(Object.keys(projects).length); push(Object.keys(studies).length);
    (window.DATA_TEAMS || []).forEach(function (tm) {
      const cols = table.columns.filter(c => c.team === tm.id && c.type === "num");
      push(cols.length);
      push(cols.filter(c => allRows.some(x => typeof x[c.key] === "number")).length);
    });
    /* 그룹(지표군)별 컬럼 수 */
    const byGroup = {};
    table.columns.forEach(function (c) { if (c.type === "num" && c.group) byGroup[c.group] = (byGroup[c.group] || 0) + 1; });
    Object.keys(byGroup).forEach(g => push(byGroup[g]));

    /* 5) 배양 경과일 라벨 (D10 → 10) 과 일자별 값 */
    (window.DATA_TITER_DAYS || []).forEach(function (d) {
      const n = Number(String(d).replace(/[^0-9]/g, ""));
      if (isFinite(n)) push(n);
    });
    (window.DATA_BATCHES || []).forEach(function (b) {
      const tt = b.upstream && b.upstream.titer;
      if (tt) Object.keys(tt).forEach(k => push(tt[k]));
    });

    /* 6) 사용자가 질문에 쓴 숫자와, 파서가 읽어 낸 조건값 */
    const q = numbersIn(r.question);
    pushAll(q.nums); q.dates.forEach(d => dates.push(d));
    const c = r.conditions;
    if (c) {
      (c.thresholds || []).forEach(function (th) { push(th.min); push(th.max); });
      if (c.topN) push(c.topN.n);
      if (c.period) {
        [c.period.from, c.period.to].forEach(function (d) {
          if (!d) return;
          dates.push(d);
          push(Number(d.slice(0, 4))); push(Number(d.slice(5, 7))); push(Number(d.slice(8, 10)));
        });
      }
    }
    (r.choices || []).forEach(function (ch) { push(ch.value); push(ch.kept); push(ch.total); });

    /* 7) 배포·설정 상수 — 화면에 그대로 나오는 값들 */
    push(0); push(1); push(2); push(3);            /* 서수 · "2개 이상" 같은 문구 */
    push(window.AskLLM ? window.AskLLM.TIMEOUT_MS / 1000 : 3);
    push(6);                                       /* "질문 유형 6가지" */
    push(0.6);                                     /* confidence 문턱 */

    return { nums: nums, dates: dates };
  }

  /* 결과 객체에서 사용자에게 보이는 문자열을 전부 모읍니다 */
  function visibleStrings(r) {
    const out = [];
    const add = v => { if (v !== null && v !== undefined && String(v).length) out.push(String(v)); };
    add(r.headline); add(r.note);
    (r.hints || []).forEach(add);
    (r.warnings || []).forEach(add);
    (r.applied || []).forEach(add);
    (r.unhandled || []).forEach(add);
    (r.facts || []).forEach(f => { add(f.k); add(f.v); });
    (r.context || []).forEach(f => { add(f.k); add(f.v); });
    (r.choices || []).forEach(c => { add(c.label); add(c.hint); });
    (r.compare || []).forEach(c => { add(c.group); add(c.n); add(c.mean); add(c.min); add(c.max); });
    (r.rows || []).forEach(row => Object.keys(row).forEach(k => add(row[k])));
    return out;
  }

  /* 엔진 응답 전체 검증 */
  /* 숫자로 읽으면 안 되는 이름들 — 배치 · 과제 · Study · 팀 · 경과일 라벨 */
  function maskOf(table) {
    const m = [];
    table.rows.forEach(function (x) { if (x.__label) m.push(String(x.__label)); });
    (window.DATA_PROJECTS || []).forEach(p => { if (p.code) m.push(String(p.code)); });
    (window.DATA_STUDIES || []).forEach(s => { if (s.name) m.push(String(s.name)); });
    (window.DATA_TITER_DAYS || []).forEach(d => m.push(String(d)));
    table.columns.forEach(c => { if (c.label) m.push(String(c.label)); });
    /* 긴 것부터 지워야 부분 문자열이 남지 않습니다 */
    return m.sort((a, b) => b.length - a.length);
  }

  /* 세 부품을 간접 참조로 둡니다.

     이유는 검사 때문입니다. 안쪽 함수를 직접 부르면, 회귀 테스트가 부품을
     하나씩 무력화해 "이게 정말 보호하고 있나" 를 확인할 수 없습니다.
     내부에서 직접 호출하면 밖에서 바꿔치기해도 아무 일이 일어나지 않아,
     변이 검사가 조용히 통과합니다 — 실제로 그런 상태였습니다. */
  const PARTS = {
    numbersIn: numbersIn,
    visibleStrings: visibleStrings,
    allowedFrom: allowedFrom
  };

  function checkResult(r, table) {
    const t = table || (window.AskTables && window.AskTables.internal());
    if (!t || !r) return { ok: true, violations: [], checked: 0 };
    const allow = PARTS.allowedFrom(r, t);
    const mask = maskOf(t);
    const violations = [];
    let checked = 0;
    PARTS.visibleStrings(r).forEach(function (s) {
      const g = PARTS.numbersIn(s, mask);
      checked += g.nums.length + g.dates.length;
      g.nums.forEach(function (n) {
        if (!matches(n, allow.nums)) violations.push({ value: n, where: s.slice(0, 70) });
      });
      g.dates.forEach(function (d) {
        if (allow.dates.indexOf(d) === -1) violations.push({ value: d, where: s.slice(0, 70) });
      });
    });
    return { ok: !violations.length, violations: violations, checked: checked };
  }

  /* 검증에 걸리면 서술을 데이터 기반 템플릿으로 바꿉니다.
     표(facts · rows)는 값을 그대로 옮긴 것이라 남기고, 문장만 교체합니다. */
  function enforce(r, table) {
    const res = checkResult(r, table);
    if (res.ok) { r.verified = { ok: true, checked: res.checked }; return r; }
    const bad = res.violations.map(v => v.value).join(", ");
    r.verified = { ok: false, checked: res.checked, violations: res.violations };
    r.blockedHeadline = r.headline;
    r.headline = (r.scopeLabel || "전체") + " 범위 " + (r.scopeRows == null ? "" : r.scopeRows + "건을 ") +
      "조회했습니다. 설명 문장에서 근거를 확인하지 못한 수치가 있어 문장을 쓰지 않고 표만 보여 드립니다.";
    r.warnings = (r.warnings || []).concat(
      ["설명 문장에 조회 결과로 설명되지 않는 수치(" + bad + ")가 있어 문장을 대체했습니다. 표의 값은 원본 그대로입니다."]);
    r.hints = [];
    return r;
  }

  return {
    checkNarration: checkNarration, checkResult: checkResult, enforce: enforce,
    _knownFrom: knownFrom,
    /* 검사용 — PARTS 를 바꿔 끼우면 실제로 동작이 바뀝니다 */
    _parts: PARTS,
    _numbersIn: numbersIn, _allowedFrom: allowedFrom, _visibleStrings: visibleStrings
  };
})();
