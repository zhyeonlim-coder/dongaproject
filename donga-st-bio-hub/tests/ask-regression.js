/* ==========================================================================
   ask-regression.js — AI 검색 엔진 회귀 테스트  ·  window.AskRegression

   왜 있는가
     AI 검색은 "답이 나왔다"만으로는 맞는지 알 수 없습니다. 조건이 조용히
     버려져도 그럴듯한 문장이 나오기 때문입니다. 실제로 예전에는
     "Titer 3 이상" · "Titer 상위 5개" · 조건 없는 질문이 완전히 같은
     문장을 돌려줬습니다. 그래서 이 파일은 "응답이 있는가"가 아니라
     아래 네 가지를 봅니다.

       A. 20건 배터리   — 질문마다 의도 · 해석 · 무시 · 건수 · 응답
       B. 조건 구별     — 조건이 다르면 응답도 달라야 한다
       C. 숫자 진위     — 응답에 나온 수치가 데이터셋의 실제 값인가
       D. 막다른 응답   — 한 줄 실패로 끝난 응답이 있는가

   숫자 검증 방식
     엔진이 쓴 경로와 다른 경로로 직접 다시 계산해 대조합니다. 그리고
     원본 Excel 에서 손으로 확인해 둔 값 몇 개를 앵커로 박아 둡니다 —
     테이블 생성 단계가 통째로 틀어지면 자기 자신과의 대조로는 못 잡습니다.

   실행
     tests/ask-regression.html 을 브라우저로 열면 자동으로 돕니다.
     콘솔에서: AskRegression.run() → 결과 객체, AskRegression.text() → 표
   ========================================================================== */

window.AskRegression = (function () {
  "use strict";

  /* ── 20건 배터리 ───────────────────────────────────────────────────────
     expect 는 "이 정도는 지켜져야 한다"만 적습니다. 문장을 통째로 박아
     두면 표현을 조금만 다듬어도 빨간불이 떠서 아무도 안 보게 됩니다. */
  const BATTERY = [
    { q: "수율이 가장 높은 Batch는?",      intent: "max",     kind: "extreme" },
    { q: "역가 제일 높은 거",              intent: "max",     kind: "extreme" },
    /* 정성어 — "제일 좋았어"를 최고값으로 읽고, 무엇을 기준으로 봤는지 밝혀야 합니다 */
    { q: "배지 뭐가 제일 좋았어?",          scope: "Media screening test",
      intent: "max", kind: "extreme", applied: /Titer 기준으로 해석/ },
    { q: "B045-2가 어느 과제 거야?",        kind: "entity",    scope: "B045-2", rows: 1 },
    { q: "B045-2 정제 결과 보여줘",         kind: "group",     scope: "B045-2", rows: 1 },
    { q: "미디어 스크리닝 결과 보여줘",       scope: "Media screening test" },
    { q: "무슨 데이터 있어?",              kind: "meta" },
    /* 사용법 질문은 데이터 요약과 다른 응답이어야 합니다 */
    { q: "뭘 물어볼 수 있어?",             kind: "help" },
    { q: "미입력이 가장 많은 항목은?",        intent: "missing", kind: "missing" },
    /* 실측 18~2494 mg/L 에서 "3" 은 단위가 안 맞습니다 — 되물어야 합니다 */
    { q: "Titer 3 이상인 배치",            kind: "clarify" },
    { q: "Titer 상위 5개",                applied: /상위 5/ },
    { q: "스펙 벗어난 항목 있어?",           unhandled: /규격/ },
    { q: "생존율 평균이랑 편차",             intent: "stat",    kind: "stat" },
    { q: "과제별 Total Yield 비교",         intent: "compare", kind: "compare" },
    { q: "일자별 Titer 추이",              intent: "trend",   kind: "trend" },
    { q: "정제팀 데이터 보여줘",             kind: "group",     minRows: 1 },
    { q: "왜 B123-3만 Titer가 낮았지?",     scope: "B123-3",   unhandled: /원인/ },
    { q: "DA-1234 최고 Titer 알려줘",       intent: "max",     scope: "DA-1234" },
    /* 19 · 20 은 앞 질문을 이어받습니다 — 순서대로 돌려야 의미가 있습니다.
       "그럼 …" 은 범위(과제)를, "그거" 는 직전 답변이 지목한 배치를 가리킵니다. */
    { q: "그럼 정제는?",                   kind: "group",  scope: "DA-1234", rows: 18, applied: /직전 질의/ },
    { q: "그거 언제 배양한 거야?",           kind: "date",   rows: 1,          applied: /지목한/ }
  ];

  /* ── E. Phase 1 에서 통과시킨 조건 파서 — 다시 깨지지 않게 고정 ─────
     건수는 원본 28건에서 손으로 센 값입니다 (2024-08:1 · 11:5 · 12:11 · 2025-01:10). */
  const PHASE1 = [
    { q: "2024년 1월부터 7월까지 배치", rows: 0, applied: /2024-01-01 ~ 2024-07-31/, kind: "no-rows" },
    { q: "2024년 12월 Titer 평균",     rows: 11 },
    { q: "11월 배치 Titer",            rows: 5,  applied: /가장 최근 연도/ },
    { q: "12월부터 1월까지 Titer",       rows: 21, applied: /2024-12-01 ~ 2025-01-31/ },
    { q: "24년 하반기 Titer 평균",       rows: 17 },
    { q: "2024년 3분기 Titer",         rows: 1 },
    { q: "최근 3개월 Titer 평균",        rows: 26, applied: /데이터 최신일/ },
    { q: "2024-12-10에 시작한 배치 Titer", rows: 11 },
    { q: "2024년 Titer 평균",          rows: 17 },
    { q: "Titer 1000 이상인 배치",       rows: 15, applied: /≥ 1000/ },
    /* 단위를 직접 적으면 되묻지 않고 환산합니다 */
    { q: "Titer 3 g/L 이상",            rows: 0,  applied: /3 g\/L = 3000/ },
    { q: "Titer 1 g/L 이상인 배치",      rows: 15, applied: /1 g\/L = 1000/ },
    { q: "Titer 1000~2000 배치",       rows: 13, applied: /1000 .* ~ .*2000/ },
    { q: "Titer 2000보다 큰 거",        rows: 2,  applied: /> 2000/ },
    { q: "생존율 90 이상",              rows: 17 },
    { q: "수율 85 이하 배치",            rows: 24 },
    { q: "최소 1500 Titer",           rows: 6 },
    /* 배양 경과일은 달력 날짜가 아닙니다 — 기간으로 읽히면 안 됩니다 */
    { q: "10일차 Titer 알려줘",         rows: 28, unhandled: /D10/ },
    { q: "D10 Titer",                 rows: 28, unhandled: /D10/ },
    /* 오늘 기준 상대 기간은 해석을 거부하고 이유를 말합니다 */
    { q: "지난달 Titer 평균",           rows: 28, unhandled: /지난달/ },
    { q: "Fail 제외하고 수율 보여줘",      unhandled: /규격/ }
  ];

  /* ── F. Phase 2 에서 통과시킨 어휘 · 팀 · 승계 ────────────────────── */
  const PHASE2 = [
    /* 한글 Study 별칭 — 음차 · 번역 · 부분 · 붙여쓰기 · 대소문자 */
    { q: "미디어 스크리닝 결과",     scope: "Media screening test", rows: 6 },
    { q: "미디어스크리닝",          scope: "Media screening test" },
    { q: "스크리닝 배치",           scope: "Media screening test" },
    { q: "배지 스크리닝 Titer 평균", scope: "Media screening test" },
    { q: "Media Screening Test 결과", scope: "Media screening test" },
    { q: "디오이 테스트 수율",        scope: "DoE test", rows: 12 },
    { q: "실험계획법 배치",          scope: "DoE test" },
    { q: "타당성 시험 Titer",       scope: "Feasibility test", rows: 10 },
    { q: "feasibility 결과",       scope: "Feasibility test" },
    { q: "1234 과제 Titer",        scope: "DA-1234", rows: 18 },
    /* 숫자가 값 조건으로 쓰였으면 과제 코드로 읽지 않습니다 (오탐 방어) */
    { q: "Titer 1234 이상인 배치",  scope: "전체" },
    { q: "수율 1234~2000",         scope: "전체" },
    { q: "Titer 4321 이하",        scope: "전체" },
    /* 팀 = 볼 컬럼 (행을 자르지 않습니다 — 자르면 0건이 됐었습니다) */
    { q: "정제팀 데이터 보여줘", kind: "group", rows: 28 },
    { q: "배양팀 데이터",       kind: "group", rows: 28 },
    { q: "분석팀 데이터",       kind: "group", rows: 28 },
    { q: "CQA 항목 보여줘",     kind: "group", rows: 28 }
  ];

  /* ── H. 조건이 아무 일도 안 했으면 경고해야 한다 ──────────────────────
     단위 환산으로도 구제되지 않아 숫자를 그대로 적용한 경우입니다.
     라벨만 붙고 결과가 그대로면 연구원은 걸러진 것으로 봅니다. */
  const NOOP_WARN = [
    { q: "Titer 10 이상",   warn: true,  rows: 28 },
    { q: "생존율 10 이상",   warn: true,  rows: 27 },
    { q: "수율 5 이상",      warn: true,  rows: 28 },
    /* 실제로 걸러지면 경고가 뜨면 안 됩니다 (거짓 경고 방지) */
    { q: "Titer 1000 이상", warn: false, rows: 15 },
    { q: "생존율 90 이상",   warn: false, rows: 17 }
  ];

  /* 승계는 순서가 있어야 의미가 있습니다 */
  const CONTEXT = [
    { q: "DA-1234 최고 Titer 알려줘", scope: "DA-1234", rows: 18 },
    /* 생략형은 범위(scope)를 잇습니다 */
    { q: "그럼 정제는?",             scope: "DA-1234", rows: 18, kind: "group", applied: /직전 질의/ },
    /* 지시어는 직전 답변이 지목한 배치(result)를 가리킵니다 — 18건이 아니라 1건 */
    { q: "그거 언제 배양한 거야?",     rows: 1, kind: "date", applied: /지목한/ },
    /* 이어받기 표시가 없으면 물려받지 않아야 합니다 */
    { q: "Titer 평균은?",           scope: "전체",     rows: 28 }
  ];

  /* ── B. 조건이 다르면 결과 "집합"이 달라야 한다 ───────────────────────
     문장만 비교하면 안 됩니다. 예전 판정은 조건 라벨이 붙었다는 이유로
     통과시켰는데, 실제로는 "Titer 3 이상" 이 무조건 질의와 똑같은 12행 ·
     평균 981.4 를 돌려주고 있었습니다. 라벨은 붙고 필터는 아무 일도
     안 한 상태 — 정확히 없애려던 그 오답입니다.
     그래서 조건 질의의 결과는 무조건 질의 결과의 "진부분집합"이어야 합니다. */
  const SUBSET = [
    { base: "Titer 기록된 배치", variants: ["Titer 1000 이상인 배치", "Titer 상위 5개", "Titer 2000보다 큰 거"] },
    { base: "Titer 평균",       variants: ["2024년 12월 Titer 평균", "2024년 11월 Titer 평균"] },
    { base: "생존율 평균",       variants: ["생존율 90 이상"] }
  ];

  /* ── C. 원본 Excel 에서 손으로 확인해 둔 값 ───────────────────────────
     Batch_Data_example.xlsx / "Batch Data" 시트 (머리글 2행 + 데이터 28행).
     테이블 생성이 통째로 어긋나는 경우는 자기 대조로 못 잡으므로 박아 둡니다. */
  const ANCHORS = [
    { what: "배치 수",              get: t => t.rows.length,                          want: 28 },
    { what: "가장 이른 시작일",       get: t => dates(t)[0],                            want: "2024-08-16" },
    { what: "가장 늦은 시작일",       get: t => dates(t).slice(-1)[0],                  want: "2025-01-09" },
    { what: "Titer HCCF 최대",      get: t => extreme(t.rows, "titerHCCF", "max").v,  want: 2494 },
    { what: "Titer HCCF 최대 배치",  get: t => extreme(t.rows, "titerHCCF", "max").l,  want: "B321-7" },
    { what: "Titer HCCF 최소",      get: t => extreme(t.rows, "titerHCCF", "min").v,  want: 18 },
    { what: "Total Yield 최대",     get: t => extreme(t.rows, "downstream_totalYield", "max").v, want: 89.5 },
    { what: "Total Yield 최대 배치", get: t => extreme(t.rows, "downstream_totalYield", "max").l, want: "B123-10" },
    { what: "DA-1234 Titer 최대",   get: t => extreme(t.rows.filter(r => r.project === "DA-1234"), "titerHCCF", "max").v, want: 1414 },
    { what: "Final Viability 기록", get: t => nums(t.rows, "finalViability").length,   want: 27 }
  ];

  /* ── 도우미 (엔진과 다른 경로로 직접 계산) ─────────────────────────── */
  function nums(rows, key) {
    return rows.map(r => r[key]).filter(v => typeof v === "number" && isFinite(v));
  }
  function dates(t) { return t.rows.map(r => r.date).filter(Boolean).sort(); }
  function extreme(rows, key, dir) {
    let best = null;
    rows.forEach(function (r) {
      const v = r[key];
      if (typeof v !== "number" || !isFinite(v)) return;
      if (!best || (dir === "max" ? v > best.v : v < best.v)) best = { v: v, l: r.__label };
    });
    return best || { v: null, l: null };
  }
  function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
  function sd(a) {
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
  }
  /* 문장에서 숫자 뽑기 — 콤마 제거, 날짜·연도는 뺍니다 */
  function numbersIn(s) {
    const t = String(s || "").replace(/\d{4}-\d{2}-\d{2}/g, " ").replace(/(\d),(\d)/g, "$1$2");
    return (t.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  }
  function near(a, b) { return Math.abs(a - b) <= Math.max(0.051, Math.abs(b) * 0.002); }

  /* ══════════════════════════════════════════════════════════════════════
     실행
     ══════════════════════════════════════════════════════════════════════ */
  function run(table) {
    const E = window.AskEngine;
    const t = table || window.AskTables.internal();
    const out = { table: t.label, rows: [], checks: [], at: new Date().toISOString() };

    /* 한 건 검사 — 기대한 것만 봅니다 */
    function verify(r, c) {
      const fail = [];
      if (c.kind && r.kind !== c.kind) fail.push("kind=" + r.kind + " 기대=" + c.kind);
      if (c.intent && r.intent !== c.intent) fail.push("intent=" + r.intent + " 기대=" + c.intent);
      if (c.scope && r.scopeLabel !== c.scope) fail.push("scope=" + r.scopeLabel + " 기대=" + c.scope);
      if (typeof c.rows === "number" && r.scopeRows !== c.rows) fail.push("rows=" + r.scopeRows + " 기대=" + c.rows);
      if (c.minRows && r.scopeRows < c.minRows) fail.push("rows=" + r.scopeRows + " < " + c.minRows);
      if (c.applied && !c.applied.test((r.applied || []).join(" "))) fail.push("해석 조건에 " + c.applied + " 없음");
      if (c.unhandled && !c.unhandled.test((r.unhandled || []).join(" "))) fail.push("무시 조건에 " + c.unhandled + " 없음");
      if (c.warn === true && !(r.warnings && r.warnings.length)) fail.push("좁혀지지 않았는데 경고가 없음");
      if (c.warn === false && (r.warnings && r.warnings.length)) fail.push("실제로 걸러졌는데 경고가 붙음");
      return fail;
    }
    /* sequential=true 면 앞 결과를 다음 질문에 넘깁니다 (승계 검사용) */
    function runSet(list, sequential) {
      let prev = null;
      return list.map(function (c, i) {
        const r = E.answer(c.q, { table: t, prev: sequential ? prev : null });
        if (r.carry) prev = { carry: r.carry, question: c.q };
        const fail = verify(r, c);
        return {
          no: i + 1, q: c.q, ok: r.ok, kind: r.kind, intent: r.intent,
          applied: (r.applied || []).join(" / ") || "—",
          unhandled: (r.unhandled || []).map(x => x.split(" — ")[0]).join(" / ") || "—",
          count: r.scopeRows,
          headline: String(r.headline || "").replace(/^\[[^\]]*\]\s*/, ""),
          shown: r.rows ? r.rows.length + "행" : (r.facts ? r.facts.length + "항목" : "—"),
          pass: !fail.length, fail: fail
        };
      });
    }
    function summarize(id, list, results) {
      const bad = results.filter(x => !x.pass);
      out.checks.push({
        id: id, pass: !bad.length,
        detail: (list.length - bad.length) + "/" + list.length + " 통과" +
          (bad.length ? " · 실패: " + bad.map(f => "\"" + f.q + "\"(" + f.fail.join(", ") + ")").join(" ; ") : "")
      });
      return bad;
    }

    /* ── A. 배터리 (순서대로 — 뒤 두 건이 앞을 이어받습니다) ─────────── */
    out.rows = runSet(BATTERY, true);
    summarize("A. 20건 배터리", BATTERY, out.rows);

    /* ── B. 조건 질의의 결과 집합은 무조건 질의의 진부분집합이어야 한다 ─ */
    /* 실제 결과 집합은 조회 대상 행(carry.rowIds)입니다. 화면 표는 종류마다
       상한이 달라(8 · 12 · 15행) 그걸로 비교하면 서로 다른 질의가 같아 보입니다.
       예외는 상위/하위 N — 이건 대상을 줄이는 게 아니라 보여 줄 개수를 줄이는
       조건이라, 화면에 내놓은 행이 곧 결과입니다. */
    const idOf = {};
    t.rows.forEach(x => { idOf[x.__label] = x.__id; });
    function effectiveSet(r) {
      const topN = r.conditions && r.conditions.topN;
      if (topN && r.rows) return r.rows.map(x => idOf[x.__label]).filter(Boolean);
      return (r.carry && r.carry.rowIds) ? r.carry.rowIds.slice() : [];
    }
    function meanOf(r) { return r.stats ? r.stats.mean : null; }

    const dis = [];
    SUBSET.forEach(function (grp) {
      const b = E.answer(grp.base, { table: t });
      const bSet = effectiveSet(b), bKey = bSet.slice().sort().join("|");
      grp.variants.forEach(function (q) {
        const v = E.answer(q, { table: t });
        const vSet = effectiveSet(v), vKey = vSet.slice().sort().join("|");
        const subset = vSet.every(x => bSet.indexOf(x) > -1);
        const proper = subset && vKey !== bKey;
        /* 상위 N 은 대상을 줄이는 게 아니라 보여 줄 개수를 줄이는 조건이라
           평균이 그대로인 것이 정상입니다 */
        const isTopN = !!(v.conditions && v.conditions.topN);
        const sameMean = !isTopN && meanOf(b) !== null && meanOf(b) === meanOf(v);
        const fail = [];
        /* 되묻기(clarify)는 아직 조건을 적용하지 않은 상태라 예외입니다 —
           대신 "왜 안 걸렀는지"를 사용자에게 묻고 있어야 합니다. */
        if (v.kind === "clarify") {
          if (!v.choices || !v.choices.length) fail.push("되묻기인데 선택지가 없음");
        } else {
          if (!subset) fail.push("부분집합 아님 (" + vSet.length + "행이 base " + bSet.length + "행 밖)");
          else if (!proper) fail.push("집합이 base 와 동일 — 조건이 아무 일도 하지 않음");
          if (sameMean) fail.push("집계값(평균)이 base 와 완전히 동일");
        }
        dis.push({ base: grp.base, q: q, kind: v.kind, baseN: bSet.length, n: vSet.length,
                   pass: !fail.length, fail: fail });
      });
    });
    out.distinct = dis;
    const disBad = dis.filter(d => !d.pass);
    out.checks.push({
      id: "B. 조건 구별(결과 집합)", pass: !disBad.length,
      detail: (dis.length - disBad.length) + "/" + dis.length + " 통과" +
        (disBad.length ? " · 실패: " + disBad.map(d => "\"" + d.q + "\"(" + d.fail.join(", ") + ")").join(" ; ") : "")
    });

    /* ── C. 숫자 진위 ────────────────────────────────────────────────── */
    const numChecks = [];
    ANCHORS.forEach(function (a) {
      let got;
      try { got = a.get(t); } catch (e) { got = "오류: " + e.message; }
      const pass = typeof a.want === "number" && typeof got === "number" ? near(got, a.want) : got === a.want;
      numChecks.push({ what: "앵커 · " + a.what, got: got, want: a.want, pass: pass });
    });

    /* 엔진 응답의 수치를 독립 계산으로 대조 */
    [["역가 제일 높은 거", "titerHCCF", "max"],
     ["수율이 가장 높은 Batch는?", "downstream_totalYield", "max"],
     ["DA-1234 최고 Titer 알려줘", "titerHCCF", "max"]].forEach(function (c) {
      const r = E.answer(c[0], { table: t });
      const pool = r.scopeLabel === "전체" ? t.rows : t.rows.filter(x => x.project === r.scopeLabel);
      const truth = extreme(pool, c[1], c[2]);
      const inHead = numbersIn(r.headline);
      numChecks.push({
        what: "응답 수치 · " + c[0],
        got: inHead.filter(n => near(n, truth.v)).length ? truth.v : inHead.join(","),
        want: truth.v,
        pass: inHead.some(n => near(n, truth.v)) && String(r.headline).indexOf(truth.l) > -1
      });
    });
    /* 평균 · 표준편차 */
    (function () {
      const r = E.answer("생존율 평균이랑 편차", { table: t });
      const v = nums(t.rows, "finalViability");
      const m = mean(v), s = sd(v), inHead = numbersIn(r.headline);
      numChecks.push({ what: "응답 수치 · 생존율 평균", got: inHead.join(","), want: +m.toFixed(1),
        pass: inHead.some(n => near(n, m)) });
      numChecks.push({ what: "응답 수치 · 생존율 표준편차", got: inHead.join(","), want: +s.toFixed(1),
        pass: inHead.some(n => near(n, s)) });
      numChecks.push({ what: "응답 수치 · 생존율 n", got: r.stats && r.stats.n, want: v.length,
        pass: !!(r.stats && r.stats.n === v.length) });
    })();
    /* 표에 나온 배치 이름이 데이터셋에 실재하는가 */
    (function () {
      const known = {};
      t.rows.forEach(r => { known[r.__label] = 1; });
      const bad = [];
      out.rows.forEach(function (row) {
        const r = E.answer(row.q, { table: t });
        (r.rows || []).forEach(function (x) {
          if (x.__label && !known[x.__label]) bad.push(row.no + ":" + x.__label);
        });
      });
      numChecks.push({ what: "표의 배치명이 모두 실재", got: bad.length ? bad.join(",") : "전부 실재",
        want: "전부 실재", pass: !bad.length });
    })();

    out.numbers = numChecks;
    const numFail = numChecks.filter(c => !c.pass);
    out.checks.push({
      id: "C. 숫자 진위", pass: !numFail.length,
      detail: (numChecks.length - numFail.length) + "/" + numChecks.length + " 통과" +
        (numFail.length ? " · 실패: " + numFail.map(f => f.what + "(got " + f.got + ", want " + f.want + ")").join(" ; ") : "")
    });

    /* ── D. 한 줄 실패로 끝난 응답이 있는가 ───────────────────────────
       실패 응답이라도 다음에 무엇을 하면 되는지는 줘야 합니다. */
    const deadEnds = [];
    const PROBE = BATTERY.map(c => c.q).concat([
      "2024년 1월부터 7월까지 배치", "2024년 12월 Titer 5000 이상", "없는항목 평균",
      "pH 알려줘", "2030년 배치", "Titer 99999 이상", ""
    ]);
    let p2 = null;
    PROBE.forEach(function (q) {
      const r = window.AskEngine.answer(q, { table: t, prev: p2 });
      if (r.carry) p2 = { carry: r.carry, question: q };
      const helped = (r.hints && r.hints.length) || (r.suggestions && r.suggestions.length) ||
                     (r.rows && r.rows.length) || (r.facts && r.facts.length);
      if (!helped) deadEnds.push((q || "(빈 질문)") + " → " + r.kind);
    });
    out.deadEnds = deadEnds;
    out.checks.push({
      id: "D. 막다른 응답", pass: !deadEnds.length,
      detail: deadEnds.length ? deadEnds.join(" ; ") : PROBE.length + "건 모두 다음 행동 안내 있음"
    });

    /* ── E · F · 승계 — 앞 Phase 에서 통과시킨 것이 깨지지 않았는가 ──── */
    out.phase1 = runSet(PHASE1, false);
    summarize("E. Phase 1 조건 파서", PHASE1, out.phase1);
    out.phase2 = runSet(PHASE2, false);
    summarize("F. Phase 2 어휘 · 팀", PHASE2, out.phase2);
    out.context = runSet(CONTEXT, true);
    summarize("G. 맥락 승계", CONTEXT, out.context);
    out.noop = runSet(NOOP_WARN, false);
    summarize("H. 무효 조건 경고", NOOP_WARN, out.noop);

    out.pass = out.checks.every(c => c.pass);
    return out;
  }

  /* 콘솔용 표 */
  function text(res) {
    const r = res || run();
    const L = [];
    L.push("AI 검색 회귀 테스트 · " + r.at + " · " + r.table);
    L.push("");
    L.push(" # | 의도     | 해석된 조건                    | 무시된 조건        | 건수 | 표시   | 응답");
    L.push("---+----------+--------------------------------+--------------------+------+--------+" + "-".repeat(46));
    r.rows.forEach(function (x) {
      L.push(String(x.no).padStart(2) + " | " + String(x.intent).padEnd(8) + " | " +
        x.applied.slice(0, 30).padEnd(30) + " | " + x.unhandled.slice(0, 18).padEnd(18) + " | " +
        String(x.count).padStart(4) + " | " + x.shown.padEnd(6) + " | " +
        (x.pass ? "" : "[실패] ") + x.headline.slice(0, 44));
    });
    L.push("");
    [["E. Phase 1 조건 파서", r.phase1], ["F. Phase 2 어휘 · 팀", r.phase2],
     ["G. 맥락 승계", r.context], ["H. 무효 조건 경고", r.noop]]
      .forEach(function (pair) {
        if (!pair[1]) return;
        L.push(pair[0]);
        pair[1].forEach(x => L.push("   " + (x.pass ? "통과" : "실패") + " · " + x.q.padEnd(26) +
          " → " + String(x.count).padStart(3) + "건 · " + x.kind.padEnd(8) +
          (x.pass ? "" : "  ← " + x.fail.join(", "))));
        L.push("");
      });
    r.checks.forEach(c => L.push((c.pass ? "  통과  " : "  실패  ") + c.id + " — " + c.detail));
    L.push("");
    L.push(r.pass ? "전체 통과" : "실패 있음");
    return L.join("\n");
  }

  return { run: run, text: text, BATTERY: BATTERY, ANCHORS: ANCHORS, SUBSET: SUBSET,
           PHASE1: PHASE1, PHASE2: PHASE2, CONTEXT: CONTEXT, NOOP_WARN: NOOP_WARN };
})();
