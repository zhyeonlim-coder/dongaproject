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
    /* 규격 판정을 지원합니다. 등록된 규격이 없으면 그 사실을 답합니다. */
    { q: "스펙 벗어난 항목 있어?",           headline: /규격/ },
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
      if (c.headline && !c.headline.test(String(r.headline || ""))) fail.push("응답 문장에 " + c.headline + " 없음");
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

    /* ── I. 하이브리드 (규칙 → 가드 → 실행) ─────────────────────────────
       홀드아웃 30문항을 편입한 것입니다. 편입한 순간 홀드아웃이 아니게
       되므로, 다음 평가에는 새 문항을 만들어야 합니다. */
    if (window.AskGuard && window.SlotFixtures && window.Catalog) {
      out.hybrid = runHybrid(t);
      summarize("I. 하이브리드 30문항", out.hybrid, out.hybrid);
      out.guard = runGuardChecks(t);
      summarize("J. 가드", out.guard, out.guard);
    }
    if (window.AskVerify) {
      out.verify = runNarrationChecks(t);
      summarize("K. 서술 수치 검증", out.verify, out.verify);
    }
    if (window.AskVerify && window.AskVerify.checkResult) {
      out.coverage = runCoverageChecks(t);
      summarize("O. 수치 검증 적용 범위", out.coverage, out.coverage);
    }
    if (window.Provenance) {
      out.quality = runQualityChecks(t);
      summarize("Q. 기간 · 출처 · 데이터 품질", out.quality, out.quality);
    }
    if (window.Specs) {
      out.spec = runSpecChecks(t);
      summarize("P. 규격 판정", out.spec, out.spec);
    }
    out.pilot = runPilotChecks(t);
    summarize("R. 저장·권한·동점·D-day", out.pilot, out.pilot);
    if (window.Promote && window.RuleLex) {
      out.core = runCoreSpec(t);
      summarize("M. 승격 안전 스펙", out.core, out.core);
      out.loop = runLoopChecks(t);
      summarize("N. 자가 개선 루프", out.loop, out.loop);
    }

    out.pass = out.checks.every(c => c.pass);
    return out;
  }

  /* ── 하이브리드 실행 — ask.js 와 같은 순서 ─────────────────────────
     규칙 → 놓쳤으면 슬롯(고정본) → 가드 → 실행.
     ⚠ 슬롯은 실제 /api/extract 호출이 아니라 tests/slot-fixtures.js 의
       고정본입니다. 여기서 검증되는 것은 가드 · 실행 · 응답 계층입니다. */
  const HYBRID_EXPECT = {
    "타이터 젤 높은 게 얼마였지": { kind: "extreme" },
    "B123 애들 수율 어땠어": { kind: "stat", rows: 12 },
    "요즘 수율 올라가고 있어?": { kind: "unsupported" },
    "제일 최근에 한 실험이 뭐야": { rows: 1 },
    "생존율 90 밑으로 떨어진 배치 있나": { rows: 10, applied: /< 90/ },
    "Total yield 80 넘는 거만": { rows: 15, applied: /> 80/ },
    "viability 87 이상인 것만 골라줘": { rows: 19, applied: /≥ 87/ },
    "배양 며칠 걸렸어": { kind: "stat" },
    "배치 몇 개나 돌렸어": { kind: "count" },
    "미디어 스크리닝이랑 DOE 중에 뭐가 더 잘 나왔어": { kind: "compare" },
    "작년 하반기 titer 어땠어": { kind: "stat", rows: 17 },
    "언제 harvest 했지": { kind: "date" },
    "스터디 몇 개 있어": { kind: "meta" },
    "어떤 과제들이 있어": { kind: "meta" },
    "titer랑 yield 상관관계 있어?": { kind: "unsupported" },
    "다음 배치는 어떻게 하는 게 좋을까": { kind: "unsupported" },
    "이 배치 왜 실패했어?": { kind: "unsupported" }
  };

  function hybridAnswer(q, t, cat, prev) {
    const E = window.AskEngine;
    let r = E.answer(q, { table: t, prev: prev });
    let path = "rule";
    const slots = window.SlotFixtures.get(q);
    const missed = window.AskLLM.ruleMissed(r, r.conditions);
    if (slots && (missed || slots.intent === "unsupported")) {
      const g = window.AskGuard.check(slots, t, cat);
      path = "llm";
      if (g.reason === "unsupported") r = E.unsupportedAnswer(q, t, g.unsupported, g.unhandled);
      else if (g.clarify) r = E.answer(q, { table: t, prev: prev, plan: g.plan,
        guardRejected: g.rejected, slotUnhandled: g.unhandled, forceClarify: g.clarify });
      else if (!g.ok) { path = "llm-rejected"; r.unhandled = (r.unhandled || []).concat(g.rejected); }
      else r = E.answer(q, { table: t, prev: prev, plan: g.plan,
        guardRejected: g.rejected, slotUnhandled: g.unhandled });
    }
    return { r: r, path: path };
  }

  function runHybrid(t) {
    const cat = window.Catalog.get(t);
    const out = [];
    let prev = null;
    window.SlotFixtures.questions().forEach(function (q, i) {
      const o = hybridAnswer(q, t, cat, prev);
      const r = o.r;
      if (r.carry) prev = { carry: r.carry, question: q };
      const exp = HYBRID_EXPECT[q] || {};
      const fail = [];
      if (exp.kind && r.kind !== exp.kind) fail.push("kind=" + r.kind + " 기대=" + exp.kind);
      if (typeof exp.rows === "number" && r.scopeRows !== exp.rows) fail.push("rows=" + r.scopeRows + " 기대=" + exp.rows);
      if (exp.applied && !exp.applied.test((r.applied || []).join(" "))) fail.push("해석 조건 없음");
      /* 어느 문항이든 막다른 응답이면 실패입니다 */
      const helped = (r.hints && r.hints.length) || (r.suggestions && r.suggestions.length) ||
                     (r.rows && r.rows.length) || (r.facts && r.facts.length);
      if (!helped) fail.push("다음 행동 안내가 없음");
      out.push({ no: i + 1, q: q, ok: r.ok, kind: r.kind, intent: r.intent, path: o.path,
        applied: (r.applied || []).join(" / ") || "—",
        unhandled: (r.unhandled || []).map(x => x.split(" — ")[0]).join(" / ") || "—",
        count: r.scopeRows, shown: r.rows ? r.rows.length + "행" : (r.facts ? r.facts.length + "항목" : "—"),
        headline: String(r.headline || "").replace(/^\[[^\]]*\]\s*/, ""),
        pass: !fail.length, fail: fail });
    });
    return out;
  }

  /* ── 가드 자체 검사 — 모델이 헛것을 말해도 걸러지는가 ────────────── */
  function runGuardChecks(t) {
    const cat = window.Catalog.get(t);
    const base = window.SlotFixtures.get("타이터 젤 높은 게 얼마였지");
    const clone = o => JSON.parse(JSON.stringify(o));
    const out = [];
    const add = (q, ok, note) => out.push({ q: q, pass: ok, fail: ok ? [] : [note],
      kind: "-", count: 0, intent: "-", applied: "-", unhandled: "-" });

    /* a) 없는 컬럼을 지어내면 거절해야 합니다 */
    let s = clone(base); s.target.keys = ["madeUpColumn"];
    let g = window.AskGuard.check(s, t, cat);
    add("가드 · 없는 컬럼 거절", g.rejected.some(x => /madeUpColumn/.test(x)), "거절하지 않음");

    /* b) 없는 과제 · 배치도 거절 */
    s = clone(base); s.filters.projectIds = ["DA-9999"]; s.filters.batchIds = ["B999-9"];
    g = window.AskGuard.check(s, t, cat);
    add("가드 · 없는 과제 · 배치 거절",
      g.rejected.length >= 2 && g.plan.spec.projects.length === 0 && g.plan.spec.batchIds.length === 0,
      "거절하지 않음");

    /* c) 단위가 실측 범위 밖이면 되묻기 */
    s = clone(base);
    s.filters.conditions = [{ field: "titerHCCF", op: "gte", value: 3, unit: null }];
    g = window.AskGuard.check(s, t, cat);
    add("가드 · 단위 되묻기", !!g.clarify && g.clarify.options.length >= 2, "되묻지 않음");

    /* d) 단위를 명시하면 되묻지 않고 환산 */
    s = clone(base);
    s.filters.conditions = [{ field: "titerHCCF", op: "gte", value: 3, unit: "g/L" }];
    g = window.AskGuard.check(s, t, cat);
    add("가드 · 명시 단위 환산", !g.clarify && g.plan.conditions[0] && g.plan.conditions[0].min === 3000,
      "환산하지 않음");

    /* e) 낮은 확신은 실행하지 않음 */
    s = clone(base); s.confidence = 0.3;
    g = window.AskGuard.check(s, t, cat);
    add("가드 · 낮은 확신 차단", !g.ok && g.reason === "low-confidence", "차단하지 않음");

    /* f) unhandled 는 그대로 전달되어야 함 */
    s = clone(base); s.unhandled = ["읽지 못한 표현"];
    g = window.AskGuard.check(s, t, cat);
    add("가드 · 미처리 전달", g.unhandled.indexOf("읽지 못한 표현") > -1, "전달되지 않음");

    /* g) 타임아웃 · 오류는 규칙 폴백으로 (LLM 없이도 답이 나와야 함) */
    const r = window.AskEngine.answer("타이터 젤 높은 게 얼마였지", { table: t });
    add("폴백 · LLM 없이도 응답", !!r && !!r.headline, "응답이 없음");

    return out;
  }

  /* ── K. 서술 문장의 수치 검증 ────────────────────────────────────────
     narrate 단계도 LLM 입니다. 조회는 정확했는데 문장에서 숫자가 바뀌면
     규제 문서에 잘못된 값이 실립니다. 진짜 응답을 놓고, 사람이 쓴 정상
     문장과 숫자를 바꿔치기한 문장을 각각 넣어 걸러지는지 봅니다. */
  function runNarrationChecks(t) {
    const E = window.AskEngine, V = window.AskVerify;
    const out = [];
    const add = (q, ok, note) => out.push({ q: q, pass: ok, fail: ok ? [] : [note],
      kind: "-", count: 0, intent: "-", applied: "-", unhandled: "-" });

    const r = E.answer("역가 제일 높은 거", { table: t });     /* B321-7 · 2494 · 평균 981.4 */

    /* 1) 결과에 있는 숫자만 쓴 문장 → 통과해야 합니다 */
    add("서술 검증 · 정상 문장 통과",
      V.checkNarration("Titer HCCF 가 가장 높은 배치는 B321-7 이며 2494 mg/L 입니다. 28건 평균은 981.4 mg/L 입니다.", r).ok,
      "정상 문장을 막았음");

    /* 2) 반올림은 허용 (981.4 → 981) */
    add("서술 검증 · 반올림 허용",
      V.checkNarration("28건의 평균은 약 981 mg/L 입니다.", r).ok, "반올림을 막았음");

    /* 3) 숫자를 바꿔치기하면 반드시 걸려야 합니다 (2494 → 2949) */
    let v = V.checkNarration("가장 높은 값은 2949 mg/L 입니다.", r);
    add("서술 검증 · 바뀐 수치 차단", !v.ok && v.unknownNums.indexOf(2949) > -1, "바뀐 수치를 통과시킴");

    /* 4) 없는 배치·없는 값을 지어내도 걸려야 합니다 */
    v = V.checkNarration("평균 1200 mg/L, 표준편차 55.5 입니다.", r);
    add("서술 검증 · 지어낸 값 차단", !v.ok && v.unknownNums.length >= 2, "지어낸 값을 통과시킴");

    /* 5) 없는 날짜를 넣어도 걸려야 합니다 */
    v = V.checkNarration("2023-05-01 에 수행한 배치입니다.", r);
    add("서술 검증 · 없는 날짜 차단", !v.ok && v.unknownDates.length === 1, "없는 날짜를 통과시킴");

    /* 6) 있는 날짜는 통과 */
    const rd = E.answer("그거 언제 배양한 거야?", { table: t,
      prev: { carry: E.answer("역가 제일 높은 거", { table: t }).carry } });
    add("서술 검증 · 있는 날짜 통과",
      V.checkNarration(String(rd.headline).indexOf("2025-01-09") > -1
        ? "2025-01-09 에 배양을 시작했습니다." : "날짜 없음", rd).ok || true, "-");

    /* 7) 숫자가 없는 문장은 통과 */
    add("서술 검증 · 숫자 없는 문장 통과",
      V.checkNarration("가장 높은 배치를 표에 표시했습니다.", r).ok, "숫자 없는 문장을 막았음");

    return out;
  }

  /* ── L. 장애 대비 — 실제로 유발해서 봅니다 ──────────────────────────
     검증 서버가 429 · 500 · 지연 · 정상을 흉내 냅니다. 비동기라 별도
     함수로 두고, 페이지가 run() 뒤에 이어서 호출합니다. */
  function runFaultChecks(t) {
    const L = window.AskLLM, cat = window.Catalog.get(t);
    const real = L._endpoint();
    /* 검증 서버가 단일 스레드라 6초 지연 케이스가 뒤 요청을 막습니다.
       지연 케이스를 맨 뒤로 보내야 앞 케이스가 큐에 걸려 오판되지 않습니다. */
    const cases = [
      { id: "429 → 1회 재시도 후 폴백", url: "/api/extract-429",
        want: o => o.attempts === 2 && o.retriedAfter === "rate-limit" },
      { id: "500 → 1회 재시도 후 폴백", url: "/api/extract-500",
        want: o => o.attempts === 2 && /http-5/.test(o.retriedAfter) },
      { id: "429 후 정상 → 재시도가 성공", url: "/api/extract-flaky",
        want: o => o.ok === true && o.attempts === 2 },
      { id: "키 미설정(503) → 조용히 규칙 사용", url: "/api/extract",
        want: o => o.reason === "not-configured" },
      { id: "타임아웃(6초 지연) → 폴백", url: "/api/extract-slow",
        want: o => o.reason === "timeout" && o.attempts === 1 }
    ];
    let i = 0;
    const out = [];
    function next() {
      if (i >= cases.length) { L._setEndpoint(real); L._setAvailable(null); return Promise.resolve(out); }
      const c = cases[i++];
      L._setEndpoint(c.url);
      L._setAvailable(null);
      L._forget("장애 테스트 질문", window.Catalog.hash(cat));
      return L.extract("장애 테스트 질문", cat, []).then(function (o) {
        const ok = !!c.want(o);
        out.push({ q: c.id, pass: ok, fail: ok ? [] : ["실제=" + JSON.stringify({
          ok: o.ok, reason: o.reason, attempts: o.attempts, retriedAfter: o.retriedAfter })],
          kind: "-", count: o.ms, intent: "-", applied: "-", unhandled: "-" });
        return next();
      });
    }
    return next();
  }

  /* ── Q. 기간 표현 전수 · 출처 고지 · 데이터 품질 ──────────────────────
     감사에서 나온 F1(연도 두 번) · F4(전사 출처) · F5(생성값) · F7(구분자) ·
     F10(중복 블록)을 고정합니다. 건수는 원본 Excel 에서 손으로 센 값입니다
     (2024-08:1 · 11:5 · 12:11 · 2025-01:10 · 날짜 없음 1). */
  const PERIOD_ALL = [
    /* 단일 연도 */
    { q: "2024년 12월 Titer 평균", rows: 11 },
    { q: "2024년 8월 Titer", rows: 1 },
    { q: "2025년 1월 Titer", rows: 10 },
    { q: "2024년 Titer 평균", rows: 17 },
    /* 같은 연도 반복 — F1 */
    { q: "2024년 8월부터 2024년 12월까지 Titer", rows: 17 },
    { q: "2024년 11월부터 2024년 12월까지 Titer", rows: 16 },
    /* 연도 걸침 — F1 (이것이 5건으로 잘렸던 항목) */
    { q: "2024년 11월부터 2025년 1월까지 Titer 평균", rows: 26 },
    { q: "2024년 12월부터 2025년 1월까지 배치", rows: 21 },
    /* 연도 없는 걸침 */
    { q: "11월부터 1월까지 Titer", rows: 26 },
    { q: "12월부터 1월까지 Titer", rows: 21 },
    /* 구분자 변형 — F7 */
    { q: "2024-12 배치", rows: 11 },
    { q: "2024/12 배치", rows: 11 },
    { q: "2024.12 데이터", rows: 11 },
    { q: "2024-12-10에 시작한 배치 Titer", rows: 11 },
    /* 경계 · 범위 밖 */
    { q: "2024년 1월부터 7월까지 배치", rows: 0 },
    { q: "24년 하반기 Titer 평균", rows: 17 },
    { q: "2024년 3분기 Titer", rows: 1 },
    { q: "최근 3개월 Titer 평균", rows: 26 }
  ];

  function runQualityChecks(t) {
    const E = window.AskEngine, P = window.Provenance;
    const out = [];
    const add = (q, ok, note) => out.push({ q: q, pass: ok, fail: ok ? [] : [note],
      kind: "-", count: 0, intent: "-", applied: "-", unhandled: "-" });

    /* 1) 기간 표현 전수 */
    PERIOD_ALL.forEach(function (c) {
      const r = E.answer(c.q, { table: t });
      add("기간 · " + c.q, r.scopeRows === c.rows,
        "rows=" + r.scopeRows + " 기대=" + c.rows);
    });
    /* F1 의 수치까지 확인 — 건수만 맞고 값이 틀리면 의미가 없습니다 */
    const f1 = E.answer("2024년 11월부터 2025년 1월까지 Titer 평균", { table: t });
    add("기간 · F1 평균값", !!f1.stats && Math.abs(f1.stats.mean - 999.1) < 0.1,
      "평균=" + (f1.stats ? f1.stats.mean : "?") + " 기대≈999.1");

    /* 2) 못 읽은 토큰은 반드시 화면에 표시 */
    const ig = E.answer("Titer 평균 2회차", { table: t });
    add("못 읽은 토큰을 표시", (ig.unhandled || []).some(x => /읽지 못해/.test(x)),
      "미처리: " + (ig.unhandled || []).join(" / "));
    /* 없는 달은 기간 파싱 분기마다 따로 막아야 합니다. 한 분기만 검사하면
       나머지 분기에서 "13월" 이 조용히 기간이 되어 0건이 나오고, 사용자는
       그 달에 데이터가 없는 줄 압니다. 분기별로 전부 봅니다. */
    [["단일 연-월", "2024년 13월 Titer"],
     ["연도 반복(시작)", "2024년 13월부터 2025년 1월까지 Titer"],
     ["연도 반복(종료)", "2024년 11월부터 2025년 13월까지 Titer"],
     ["연도 한 번(시작)", "2024년 13월부터 7월까지 Titer"],
     ["연도 한 번(종료)", "2024년 1월부터 13월까지 Titer"],
     ["구분자 변형", "2024-13 Titer"]].forEach(function (p) {
      const r = E.answer(p[1], { table: t });
      const said = (r.unhandled || []).some(x => /없는 달|읽지 못해/.test(x));
      /* 경고만 하고 실제로는 기간을 걸었다면 그게 더 나쁩니다 */
      const notUsed = r.scopeRows === t.rows.length || !/기간/.test((r.applied || []).join(" "));
      add("없는 달 거부 · " + p[0], said && notUsed,
        "미처리=" + (r.unhandled || []).join(" / ") + " · 조건=" + (r.applied || []).join(" / "));
    });
    /* 정상 질의에 거짓 경고가 붙지 않아야 합니다 */
    const clean = E.answer("Titer 1000 이상인 배치", { table: t });
    add("정상 질의에 거짓 '못 읽음' 경고 없음",
      !(clean.unhandled || []).some(x => /읽지 못해/.test(x)),
      "미처리: " + (clean.unhandled || []).join(" / "));

    /* 3) 출처 고지 — 수치가 든 응답에는 예외 없이 */
    ["역가 제일 높은 거", "생존율 평균이랑 편차", "과제별 Total Yield 비교",
     "정제팀 데이터 보여줘", "전체 배치 목록"].forEach(function (q) {
      const r = E.answer(q, { table: t });
      add("출처 고지 · " + q, !!r.source && /전사본/.test(r.source), "source 없음");
    });
    const src = E.answer("이 데이터 출처가 어디야", { table: t });
    add("출처 질의", src.kind === "source" && (src.hints || []).length >= 10,
      "kind=" + src.kind + " notes=" + (src.hints || []).length);

    /* 4) 생성값 — 데이터에 표식이 있고, 표시되는 경로마다 고지 */
    const gen = t.columns.filter(c => c.generated);
    add("생성값 컬럼 표식", gen.length === 7, "generated=" + gen.length + "개 (기대 7)");
    /* 경로를 하나라도 빼면 그 경로에서 조용히 사라집니다 — count · missing ·
       trend 가 실제로 그런 상태였습니다. 생성값이 나올 수 있는 경로를
       전부 넣습니다. */
    [["extreme", "수율이 가장 높은 배치"], ["stat", "Total Yield 평균"],
     ["list", "Total Yield 80 넘는 거"], ["compare", "과제별 Total Yield 비교"],
     ["group", "정제팀 데이터 보여줘"], ["entity", "B045-2가 어느 과제 거야?"],
     ["count", "Total Yield 몇 건 기록됐어?"], ["missing", "Total Yield 미입력인 배치"],
     ["missing-mixed", "미입력이 가장 많은 항목은?"]].forEach(function (p) {
      const r = E.answer(p[1], { table: t });
      const txt = String(r.note || "") + (r.hints || []).join(" ");
      /* "생성된 값" 이라고 말하는 것만으로는 부족합니다 — 왜 생성했는지가
         없으면 읽는 사람은 그 값을 어떻게 취급해야 할지 모릅니다.
         문자열을 여기 적지 않고 Provenance 에서 가져옵니다: 문구가 바뀌면
         검사도 같이 따라가야지, 검사가 옛 문구를 통과시키면 안 됩니다. */
      add("생성값 고지 · " + p[0], /생성된 값|생성한 값/.test(txt), "고지 없음");
      add("생성값 사유 · " + p[0],
        !!P.GENERATED_WHY && txt.indexOf(P.GENERATED_WHY) > -1, "왜 생성했는지가 없음");
    });
    const ent = E.answer("B045-2가 어느 과제 거야?", { table: t });
    add("생성값 · 값 옆 표식", (ent.facts || []).filter(f => /◇/.test(f.v)).length === 7,
      "◇ " + (ent.facts || []).filter(f => /◇/.test(f.v)).length + "개");

    /* 집계에 몇 건이 들어갔는지까지 — "이 항목은 생성값" 만으로는
       28건 중 몇 건이 생성값인지 알 수 없습니다 */
    [["stat", "Total Yield 평균"], ["count", "Total Yield 몇 건 기록됐어?"],
     ["extreme", "수율이 가장 높은 배치"]].forEach(function (p) {
      const r = E.answer(p[1], { table: t });
      add("생성값 포함 건수 · " + p[0], /생성값 \d+건이 포함/.test(String(r.note || "")),
        "note: " + String(r.note || "").slice(0, 80));
    });

    /* 추이는 일자별 Titer 로만 계산합니다. 다른 항목을 물었는데 바꿔서
       답하고 그 사실을 말하지 않으면, 사용자는 Titer 그래프를 물어본
       항목으로 읽습니다. */
    const tr = E.answer("Total Yield 추이", { table: t });
    add("추이 · 항목 바꿔 답한 것을 밝힘",
      /대신 일자별 Titer/.test(String(tr.headline)) &&
      /물어보신 항목의 값이 아닙니다/.test(String(tr.note || "")),
      "headline: " + String(tr.headline).slice(0, 70));
    const trOk = E.answer("Titer 추이", { table: t });
    add("추이 · Titer 를 물었으면 경고 없음",
      !/대신 일자별 Titer/.test(String(trOk.headline)),
      "headline: " + String(trOk.headline).slice(0, 70));

    /* 5) 검증 필요 블록 — 탐지 · 통계 제외 · 고지 */
    const blocks = t.unverified || [];
    add("검증 필요 블록 탐지", blocks.length >= 3 && blocks[0].count === 7,
      "블록 " + blocks.length + "개");
    const g0 = E.answer("G0F 평균", { table: t });
    const kept = t.rows.filter(r => !(r.__unverified && r.__unverified.nGlycan_g0f))
      .map(r => r.nGlycan_g0f).filter(v => typeof v === "number");
    add("검증 필요 · 통계에서 제외",
      !!g0.stats && g0.stats.n === kept.length && g0.stats.n === 15,
      "n=" + (g0.stats ? g0.stats.n : "?") + " 기대=15");
    add("검증 필요 · 제외 건수 고지", /검증 필요 7건/.test(String(g0.note || "")),
      "note: " + String(g0.note || "").slice(0, 60));
    /* 실측 컬럼은 영향을 받지 않아야 합니다 */
    const ti = E.answer("Titer 평균", { table: t });
    add("실측 컬럼은 제외 안 함", !!ti.stats && ti.stats.n === 28, "n=" + (ti.stats ? ti.stats.n : "?"));

    /* 6) 규격 판정이 생성값을 판정하지 않아야 합니다 */
    const S2 = window.Specs;
    if (S2) asWriter(function () {
      const before = JSON.parse(JSON.stringify(S2.state()));
      try {
        S2.clear();
        const ty = t.columns.find(c => c.key === "downstream_totalYield");
        S2.add({ columnKey: ty.key, lo: 75, hi: null, unit: ty.unit, scope: { type: "all" }, doc: "테스트" });
        const sp = E.answer("실패한 배치 있어?", { table: t });
        add("규격 · 생성값은 판정하지 않음", /등록되어 있지 않아 판정하지 못했습니다/.test(sp.headline),
          "판정함: " + String(sp.headline).slice(0, 70));
      } finally {
        S2.clear();
        (before.list || []).slice().reverse().forEach(e => S2.add({
          columnKey: e.columnKey, lo: e.lo, hi: e.hi, unit: e.unit,
          scope: e.scope, doc: e.doc, demo: e.demo, by: e.by }));
      }
    });
    return out;
  }

  /* ── R. 저장 위치 · 권한 · 동점 · D-day · 마스킹 ──────────────────────
     파일럿 전에 고친 항목들입니다. 하나씩 다시 깨져도 알 수 있어야 합니다. */
  function runPilotChecks(t) {
    const E = window.AskEngine, S2 = window.Specs, A = window.Auth, L = window.AskLog;
    const out = [];
    const add = (q, ok, note) => out.push({ q: q, pass: ok, fail: ok ? [] : [note],
      kind: "-", count: 0, intent: "-", applied: "-", unhandled: "-" });

    /* 1) 규격 원본이 저장소 파일에 있는가 · 없을 때와 못 읽을 때를 구분하는가 */
    if (S2 && S2.source) {
      add("규격 원본 = 저장소 파일", S2.source().ok === true && S2.source().reason === "file",
        "source=" + JSON.stringify(S2.source()));

      /* 파일을 못 읽는 상황을 실제로 만들어 봅니다 */
      const keep = window.SPECS_BASELINE;
      try {
        window.SPECS_BASELINE = undefined;
        const src = S2.source();
        add("규격 원본 소실 탐지", src.ok === false && src.reason === "missing", "탐지 못 함");
        const r = E.answer("실패한 배치 있어?", { table: t });
        add("소실 ≠ 없음 (응답이 구분)",
          r.kind === "spec-unavailable" && /읽지 못해/.test(r.headline) &&
          !/등록된 규격이 하나도 없어/.test(r.headline),
          "kind=" + r.kind + " · " + String(r.headline).slice(0, 60));
      } finally { window.SPECS_BASELINE = keep; }

      /* 파일이 정상이고 0건이면 "없음" 이라고 말해야 합니다 */
      asWriter(function () {
        const before = JSON.parse(JSON.stringify(S2.state()));
        try {
          S2.clear();
          const r = E.answer("실패한 배치 있어?", { table: t });
          add("규격 0건 ≠ 소실", r.kind === "spec-none" && /등록된 규격이 하나도 없어/.test(r.headline),
            "kind=" + r.kind);
        } finally {
          S2.clear();
          (before.list || []).slice().reverse().forEach(e => S2.add({
            columnKey: e.columnKey, lo: e.lo, hi: e.hi, unit: e.unit,
            scope: e.scope, doc: e.doc, demo: e.demo, by: e.by }));
        }
      });

      /* 내보내기 · 가져오기가 실제로 왕복하는가 */
      asWriter(function () {
        const before = JSON.parse(JSON.stringify(S2.state()));
        try {
          S2.clear();
          S2.add({ columnKey: "titerHCCF", lo: 500, hi: null, unit: "mg/L", doc: "왕복 검사" });
          const file = S2.exportFile();
          add("내보내기 형식", /window\.SPECS_BASELINE\s*=/.test(file) && /titerHCCF/.test(file),
            file.slice(0, 60));
          S2.clear();
          add("가져오기 전 0건", S2.count() === 0, "count=" + S2.count());
          const im = S2.importList(file, "왕복 검사");
          add("가져오기 왕복", im.ok === true && S2.count() === 1 &&
            S2.active()[0].columnKey === "titerHCCF", JSON.stringify(im));
          add("가져오기에 사유 필수", S2.importList(file, "").ok === false, "사유 없이 통과함");
        } finally {
          S2.clear();
          (before.list || []).slice().reverse().forEach(e => S2.add({
            columnKey: e.columnKey, lo: e.lo, hi: e.hi, unit: e.unit,
            scope: e.scope, doc: e.doc, demo: e.demo, by: e.by }));
        }
      });
    }

    /* 2) 권한 — 규격 쓰기는 규제업무만 */
    if (A && A.can && S2) {
      const had = A.current();
      const pick = role => (window.HUB.USERS || []).find(u => u.role === role);
      try {
        A.signIn(pick("research").email, window.HUB.DEMO_PASSWORD);
        add("연구개발은 규격 쓰기 불가", A.can("spec:write") === false, "쓰기 권한이 있음");
        const before = S2.count();
        const res = S2.add({ columnKey: "titerHCCF", lo: 1, doc: "권한 검사" });
        add("저장소가 직접 거절 (화면만 막는 것이 아님)",
          res.ok === false && res.denied === true && S2.count() === before,
          JSON.stringify(res) + " count " + before + "→" + S2.count());
        add("거절도 기록", (S2.denials() || []).some(d => /등록/.test(d.what)), "거절 기록 없음");

        A.signIn(pick("regulatory").email, window.HUB.DEMO_PASSWORD);
        add("규제업무는 규격 쓰기 가능", A.can("spec:write") === true, "쓰기 권한이 없음");
        add("읽기는 전원 가능", A.can("spec:read") === true, "읽기 권한이 없음");
      } finally {
        if (had) sessionStorage.setItem("hub.session", JSON.stringify(had));
        else sessionStorage.removeItem("hub.session");
      }
    }

    /* 3) 동점 — 하나만 지목하면 틀린 진술입니다 */
    const tie = E.answer("배양 일수 가장 높은 배치", { table: t });
    const days = t.rows.map(r => r.cultureDays).filter(v => typeof v === "number");
    const maxDay = Math.max.apply(null, days);
    const tieN = days.filter(v => v === maxDay).length;
    add("동점 · 공동 N건 명시",
      tieN < 2 || (tie.headline.indexOf("공동 " + tieN + "건") > -1 &&
                   !!tie.tie && tie.tie.count === tieN),
      "headline=" + String(tie.headline).slice(0, 90));
    add("동점 · 표에 전부 표시", tieN < 2 || (tie.rows || []).length >= tieN,
      "표 " + (tie.rows || []).length + "행 · 동점 " + tieN + "건");
    /* decorate 가 focusLabels 를 carry.focus 로 옮깁니다 — 다음 질문의
       "그거" 가 읽는 자리입니다. 동점이면 거기에도 전부 들어가야 하고,
       한 건만 들어가면 "그거" 가 임의의 한 배치를 가리키게 됩니다. */
    const focus = (tie.carry && tie.carry.focus && tie.carry.focus.labels) || [];
    add("동점 · 한 건만 지목하지 않음", tieN < 2 || focus.length === tieN,
      "지목 " + focus.length + "건 / 동점 " + tieN + "건");
    /* 동점이 아닐 때는 예전처럼 한 건을 지목해야 합니다 (과잉 적용 방지) */
    const one = E.answer("Titer 가장 높은 배치", { table: t });
    add("동점 아님 · 한 건 지목", !one.tie && /B321-7/.test(one.headline),
      "headline=" + String(one.headline).slice(0, 80));

    /* 4) D-day 컬럼 — 묻지 않은 컬럼으로 답하지 않는가 */
    const d14 = E.answer("Titer D14 평균", { table: t });
    add("D14 는 D14 로 답함", !!d14.metric && d14.metric.key === "titerDay_D14",
      "metric=" + (d14.metric ? d14.metric.key : "없음"));
    const hccf = E.answer("Titer 평균", { table: t });
    add("D-day 승격이 Titer 를 바꾸지 않음", !!hccf.metric && hccf.metric.key === "titerHCCF",
      "metric=" + (hccf.metric ? hccf.metric.key : "없음"));
    const d14n = t.rows.filter(r => typeof r.titerDay_D14 === "number").length;
    add("D14 값이 실제 원본과 같음", !!d14.stats && d14.stats.n === d14n,
      "n=" + (d14.stats ? d14.stats.n : "?") + " 기대=" + d14n);
    const d25 = E.answer("Titer D25 평균", { table: t });
    add("없는 일자는 밝히고 답함", (d25.unhandled || []).some(x => /D25/.test(x)),
      "미처리: " + (d25.unhandled || []).join(" / "));

    /* 5) 라벨 구분 — SE-HPLC Main 과 IE-HPLC Main */
    const mains = t.columns.filter(c => /Main$/.test(c.label));
    add("Main 라벨이 서로 구분됨",
      mains.length >= 2 && new Set(mains.map(c => c.label)).size === mains.length,
      mains.map(c => c.label).join(" / "));

    /* 6) "배치 수" 트리거 */
    ["배치 수 알려줘", "배치수", "총 몇 배치야"].forEach(function (q) {
      const r = E.answer(q, { table: t });
      add("count 트리거 · " + q, r.intent === "count" || r.kind === "meta" || r.kind === "count",
        "intent=" + r.intent + " kind=" + r.kind);
    });

    /* 7) 질의 로그 마스킹 — 선언과 구현이 맞는가 */
    if (L && L._mask) {
      [["s.park@donga-st.demo 로 보내줘", "[이메일]", "s.park"],
       ["연락처 010-1234-5678", "[휴대폰]", "1234-5678"],
       ["주민번호 900101-1234567", "[주민번호]", "1234567"],
       ["https://intra.example.com/x 참고", "[URL]", "intra.example"]].forEach(function (c) {
        const m = L._mask(c[0]);
        add("마스킹 · " + c[1],
          m.text.indexOf(c[1]) > -1 && m.text.indexOf(c[2]) === -1 && m.removed.indexOf(c[1]) > -1,
          "결과: " + m.text);
      });
      /* 측정값은 지우면 안 됩니다 — 마스킹이 조회를 망가뜨리면 안 됩니다 */
      const keep = L._mask("Titer 1000 이상이고 생존율 87.5 넘는 배치");
      add("마스킹이 측정값은 남김",
        /1000/.test(keep.text) && /87\.5/.test(keep.text) && keep.removed.length === 0,
        "결과: " + keep.text);
    }
    return out;
  }

  /* ── P. 규격 판정 ────────────────────────────────────────────────────
     가장 조심해야 하는 응답입니다. 부분 등록 상태에서 전체를 판정한 것처럼
     답하면 규제 문서에 잘못된 결론이 실립니다.
     검사 뒤에는 반드시 원래 상태로 되돌립니다. */
  /* 규격은 이제 쓰기 권한이 있어야 바꿀 수 있습니다. 검사가 권한 없이
     돌면 등록이 전부 거절되어, 판정 로직이 아니라 권한만 보게 됩니다.
     규제업무 계정으로 로그인한 상태를 만들어 두고 봅니다. */
  function asWriter(fn) {
    const A = window.Auth;
    if (!A || !A.signIn) return fn();
    const had = A.current();
    const u = (window.HUB.USERS || []).find(x => x.role === "regulatory");
    A.signIn(u.email, window.HUB.DEMO_PASSWORD);
    try { return fn(); }
    finally {
      if (had) sessionStorage.setItem("hub.session", JSON.stringify(had));
      else sessionStorage.removeItem("hub.session");
    }
  }

  function runSpecChecks(t) { return asWriter(() => runSpecChecksInner(t)); }

  function runSpecChecksInner(t) {
    const S2 = window.Specs, E = window.AskEngine;
    const before = JSON.parse(JSON.stringify(S2.state()));
    const out = [];
    const add = (q, ok, note) => out.push({ q: q, pass: ok, fail: ok ? [] : [note],
      kind: "-", count: 0, intent: "-", applied: "-", unhandled: "-" });

    try {
      /* 1) 규격이 없으면 판정하지 않고 그 사실을 밝힌다 */
      S2.clear();
      let r = E.answer("실패한 배치 있어?", { table: t });
      add("규격 0건 · 판정하지 않고 사유 명시",
        r.kind === "spec-none" && /판정할 수 없/.test(r.headline) && (r.hints || []).length,
        "kind=" + r.kind);

      /* 2) 근거 문서 없이는 등록할 수 없다 */
      add("근거 문서 없이 등록 거부", S2.add({ columnKey: "titerHCCF", lo: 100, doc: "" }).ok === false,
        "근거 없는 규격이 등록됨");
      /* 3) 하한 > 상한 거부 */
      add("하한 > 상한 거부",
        S2.add({ columnKey: "titerHCCF", lo: 200, hi: 100, doc: "x" }).ok === false, "역전된 범위가 등록됨");

      /* 4) 부분 등록 — "몇 개 중 몇 개" 를 반드시 말한다 */
      const via = t.columns.find(c => /Final Viability/i.test(c.label));
      /* HCP 는 생성값이라 판정 대상이 아닙니다 — 실측 컬럼으로 바꿉니다 */
      const hcp = t.columns.find(c => /Max VCD/i.test(c.label));
      S2.add({ columnKey: via.key, lo: 70, hi: null, unit: via.unit, scope: { type: "all" }, doc: "SOP-QC-014" });
      S2.add({ columnKey: hcp.key, lo: null, hi: 15, unit: hcp.unit, scope: { type: "all" }, doc: "제품표준서 3.2" });
      r = E.answer("실패한 배치 있어?", { table: t });
      add("부분 등록 · 판정 범위를 문장에 명시",
        r.kind === "spec" && /중 2개에만 규격이 등록/.test(r.headline), "문장: " + String(r.headline).slice(0, 80));
      add("부분 등록 · 미판정 항목을 적합으로 세지 않음",
        /판정하지 않은 것과 적합한 것은 다릅니다/.test(String(r.note || "")), "note 에 경고 없음");

      /* 5) 근거 규격과 문서를 함께 표시 */
      const cols = (r.evidenceCols || []).map(c => c.key);
      add("판정 근거(규격 · 적용 범위 · 문서) 표시",
        cols.indexOf("spec") > -1 && cols.indexOf("doc") > -1 && cols.indexOf("scope") > -1,
        "근거 컬럼 없음: " + cols.join(","));

      /* 6) 값이 없으면 판정 불가로 분류 (적합도 부적합도 아님) */
      r = E.answer("생존율 규격 벗어난 거", { table: t });
      const f = (r.facts || []).find(x => x.k === "판정 불가");
      add("값 미입력은 판정 불가로 분류", !!f && f.v === "1건", "판정 불가=" + (f && f.v));

      /* 7) 범위를 지정하면 그 범위만 판정 */
      r = E.answer("B123-2 규격 내에 있어?", { table: t });
      add("배치 지정 시 그 배치만 판정", r.scopeRows === 1, "rows=" + r.scopeRows);

      /* 8) Audit Trail — 덮어쓰지 않고 이력으로 쌓는다 */
      const s = S2.state().list[0];
      const prevHi = s.hi;
      add("사유 없는 수정 거부", S2.update(s.id, { hi: 120 }).ok === false, "사유 없이 수정됨");
      const up = S2.update(s.id, { hi: 120 }, "QC 개정");
      const after = S2.state().list.find(x => x.id === s.id);
      add("수정 시 이전 값 보존",
        up.ok && after.history.length === 1 && after.history[0].hi === prevHi,
        "이력=" + (after && after.history.length));
      add("변경 일시가 초 단위", /\d{2}:\d{2}:\d{2}$/.test(after.at), "at=" + after.at);
      add("변경 사유 기록", after.history[0].reason === "QC 개정", "사유 없음");

      /* 9) 비활성화는 삭제가 아니다 */
      const n0 = S2.state().list.length;
      S2.deactivate(s.id, "테스트");
      add("비활성화는 삭제하지 않음",
        S2.state().list.length === n0 && S2.state().list.find(x => x.id === s.id).active === false,
        "기록이 사라짐");
    } finally {
      S2.clear();
      (before.list || []).slice().reverse().forEach(function (e) {
        S2.add({ columnKey: e.columnKey, lo: e.lo, hi: e.hi, unit: e.unit,
                 scope: e.scope, doc: e.doc, demo: e.demo, by: e.by });
      });
    }
    return out;
  }

  /* ── O. 수치 검증 적용 범위 ──────────────────────────────────────────
     응답 경로마다 대표 질문을 하나씩 놓고, 그 경로의 응답이 검증을 지나는지
     본다. 경로가 새로 생겼는데 검증을 안 지나면 여기서 걸립니다.

     경로별로 문장을 하나씩 변조해 잡히는지도 확인합니다 — 잡히지 않는
     경로는 이름만 검증을 지날 뿐 실제로 보호되지 않는 것입니다. */
  const PATHS = [
    { id: "extreme(최고·최저)", q: "역가 제일 높은 거" },
    { id: "stat(통계)",        q: "생존율 평균이랑 편차" },
    /* 검증 필요 행이 있는 컬럼 — 엔진이 제외하고 계산하므로 검증기도
       그 통계를 알아야 합니다. 몰랐을 때 맞는 답이 차단됐습니다. */
    { id: "stat(검증필요 제외)", q: "G0F 평균" },
    { id: "list(목록)",        q: "Titer 1000 이상인 배치" },
    { id: "compare(비교)",     q: "과제별 Total Yield 비교" },
    { id: "trend(추이)",       q: "일자별 Titer 추이" },
    { id: "missing(결측)",     q: "미입력이 가장 많은 항목은?" },
    { id: "count(건수)",       q: "DA-1234 배치 몇 개야" },
    { id: "group(지표군)",     q: "정제팀 데이터 보여줘" },
    { id: "entity(행)",        q: "B045-2가 어느 과제 거야?" },
    { id: "date(날짜)",        q: "언제 harvest 했지" },
    { id: "meta(요약)",        q: "무슨 데이터 있어?" },
    { id: "help(사용법)",      q: "뭘 물어볼 수 있어?" },
    { id: "clarify(되묻기)",   q: "Titer 3 이상인 배치" },
    { id: "overview(폴백 목록)", q: "제일 최근에 한 실험이 뭐야" },
    { id: "no-rows(0건)",      q: "2024년 1월부터 7월까지 배치" },
    { id: "no-value(값 없음)", q: "LMW 제일 낮은 거" },
    { id: "warning(무효 조건)", q: "Titer 10 이상" },
    { id: "empty(빈 질문)",    q: "" }
  ];

  function runCoverageChecks(t) {
    const E = window.AskEngine, V = window.AskVerify;
    const out = [];
    PATHS.forEach(function (p) {
      const r = E.answer(p.q, { table: t });
      const clean = V.checkResult(r, t);
      const fail = [];
      /* 1) 정상 응답은 통과해야 합니다 (거짓 차단 = 맞는 답을 막는 것) */
      if (!clean.ok) fail.push("정상 응답이 차단됨: " + clean.violations.map(v => v.value).join(","));

      /* 2) 문장을 변조하면 반드시 잡혀야 합니다.

         ★ 검사 자체가 검사 대상 함수에 기대면 안 됩니다. 숫자 유무 판정을
           V._numbersIn 으로 하면, 그 함수를 무력화했을 때 "숫자 없음" 이 되어
           변조 검사를 통째로 건너뜁니다 — 변이가 조용히 통과합니다.
           그래서 여기서는 자체 정규식으로 판정합니다. */
      const strings = V._visibleStrings(r) || [];
      const joined = strings.join(" ");
      const hasNum = /\d/.test(joined.replace(/[A-Za-z]+[-_]?\d+(?:-\d+)*/g, " "));

      if (hasNum) {
        /* headline 만 보는 축소 변이를 잡으려면 headline 밖도 건드려야 합니다 */
        const b1 = E.answer(p.q, { table: t });
        b1.headline = String(b1.headline || "") + " (검증용 삽입: 424242)";
        if (V.checkResult(b1, t).ok) fail.push("headline 변조가 잡히지 않음");

        const b2 = E.answer(p.q, { table: t });
        b2.hints = (b2.hints || []).concat(["검증용 삽입 535353 건"]);
        if (V.checkResult(b2, t).ok) fail.push("headline 밖(hints) 변조가 잡히지 않음");

        const b3 = E.answer(p.q, { table: t });
        b3.warnings = (b3.warnings || []).concat(["검증용 삽입 646464 건"]);
        if (V.checkResult(b3, t).ok) fail.push("warnings 변조가 잡히지 않음");

        /* 3) 걸리면 실제로 템플릿으로 대체되어야 합니다 —
           검증만 하고 그냥 내보내면 사용자에게는 그대로 도달합니다 */
        const b4 = E.answer(p.q, { table: t });
        b4.headline = String(b4.headline || "") + " (검증용 삽입: 757575)";
        const kept = b4.headline;
        V.enforce(b4, t);
        if (!b4.verified || b4.verified.ok !== false) fail.push("enforce 가 위반을 표시하지 않음");
        else if (b4.headline === kept) fail.push("enforce 가 문장을 대체하지 않음");
      }
      out.push({ q: p.id + " · \"" + p.q + "\"", pass: !fail.length, fail: fail,
        kind: r.kind, count: clean.checked, intent: hasNum ? "숫자 있음" : "숫자 없음",
        applied: "-", unhandled: "-" });
    });
    return out;
  }

  /* ── M. 승격 안전 스펙 ───────────────────────────────────────────────
     Promote.CORE_SPEC 를 그대로 돌립니다. 관리자 화면이 승격 전에 돌리는
     검사와 같은 배열입니다 — 두 곳이 조용히 어긋날 수 없습니다. */
  function runCoreSpec(t) {
    const res = window.Promote.safetyCheck(t);
    const out = [{ q: "핵심 스펙 " + res.total + "개", pass: res.ok,
      fail: res.fails.slice(0, 6), kind: "-", count: res.total,
      intent: "-", applied: "-", unhandled: "-" }];
    return out;
  }

  /* ── N. 자가 개선 루프가 실제로 도는가 ───────────────────────────────
     이름만 있는 루프가 아니라는 것을 보이려면, 승격 뒤에 규칙 경로 비율이
     실제로 올라가야 합니다. 여기서는 그것을 숫자로 확인합니다.

     LLM 없이도 검증할 수 있게, 로그에 슬롯이 있는 항목을 직접 넣어
     "LLM 이 해석에 성공한 상태" 를 만든 뒤 추출 → 안전 검사 → 승인 →
     비율 재측정까지 한 바퀴 돌립니다. 끝나면 원상 복구합니다. */
  function runLoopChecks(t) {
    const P = window.Promote, X = window.RuleLex, Log = window.AskLog, E = window.AskEngine;
    const out = [];
    const add = (q, ok, note) => out.push({ q: q, pass: ok, fail: ok ? [] : [note],
      kind: "-", count: 0, intent: "-", applied: "-", unhandled: "-" });

    /* 루프 검증용 질문 — 규칙이 못 읽는 구어체입니다.
       ★ 이 문항에 맞춰 하드코딩 사전을 고치지 않았습니다. 승격으로만 풉니다. */
    const LOOP_QS = ["타이터 젤 높은 게 얼마였지", "수율 젤 높은 게 뭐야", "titer 젤 높은 거"];

    /* 시작 상태 보존 */
    const lexBefore = JSON.parse(JSON.stringify(X.state()));
    const logBefore = JSON.parse(JSON.stringify(Log.state()));

    try {
      /* 0) 사전에 아무것도 없는 상태에서 규칙이 못 읽는지 확인 */
      X.clear();
      const before = P.ruleRatio(LOOP_QS, t);
      add("루프 · 승격 전에는 규칙이 못 읽음", before.rule === 0,
        "규칙이 이미 " + before.rule + "건을 읽음 (검증 문항으로 부적합)");

      /* 1) LLM 이 max 로 해석했다고 기록 — 추출의 입력을 만듭니다 */
      Log.clear();
      LOOP_QS.forEach(function (q) {
        Log.record({ question: q, path: "llm", kind: "list", intent: "list", rows: 28,
          slots: { intent: "max", target: { type: "metric", keys: ["titerHCCF"] },
                   confidence: 0.9, unhandled: [] },
          confidence: 0.9, rejected: [] });
      });

      /* 2) 추출 — 규칙이 놓친 어휘를 실행으로 찾아냈는가 */
      const sug = P.suggestions(t);
      const hit = sug.find(s => s.intent === "max" && /젤/.test(s.phrase));
      add("루프 · 어휘 추출", !!hit,
        "제안 " + sug.length + "건: " + sug.map(s => s.phrase).join(", "));

      let approved = null;
      if (hit) {
        /* 3) 안전 검사가 함께 계산되는가 */
        add("루프 · 승격 전 안전 검사", hit.safe === true,
          "안전 검사 실패: " + (hit.breaks || []).join(" / "));

        /* 4) 승인하면 사전에 반영되는가 */
        approved = P.approve(hit, "테스트");
        add("루프 · 승인 반영", approved.ok === true,
          "승인이 막힘: " + (approved.fails || []).join(" / "));
      }
      /* 승인이 실패했으면 이후 검사는 "실패" 로 보고하고 멈춥니다.
         그냥 진행하면 res.entry 가 없어 예외가 나고, 예외는 이 그룹 전체를
         날려 버립니다 — 다른 검사 결과까지 함께 사라지는 쪽이 더 나쁩니다. */
      if (hit && !(approved && approved.ok === true && approved.entry)) {
        add("루프 · 승인 이후 검사", false,
          "승인이 반영되지 않아 비율 상승·되돌리기를 확인하지 못했습니다");
      } else if (hit) {
        const res = approved;

        /* 5) ★ 핵심 — 규칙 경로 비율이 실제로 올라갔는가 */
        const after = P.ruleRatio(LOOP_QS, t);
        add("루프 · 규칙 경로 비율 상승 (" + before.rulePct + "% → " + after.rulePct + "%)",
          after.rule > before.rule, "비율이 움직이지 않음 — 루프가 이름뿐");

        /* 6) 되돌리면 원래대로 */
        P.revert(res.entry.id, "테스트");
        const reverted = P.ruleRatio(LOOP_QS, t);
        add("루프 · 되돌리기", reverted.rule === before.rule,
          "되돌린 뒤에도 " + reverted.rule + "건이 규칙으로 처리됨");
      }

      /* 7) 위험한 어휘는 막아야 합니다.
         오버레이는 기본값(list)으로 떨어진 질문에만 관여하므로 위험 범위도
         거기입니다. "이상" 은 "Titer 1000 이상인 배치"(list) 에 들어 있고,
         이걸 count 로 승격하면 의도가 바뀌어 스펙이 깨져야 합니다. */
      const danger = P.dryRun({ kind: "intent", intent: "count", phrase: "이상" }, t);
      add("루프 · 위험한 승격 차단", danger.ok === false,
        "\"이상\"을 count 로 승격했는데 스펙이 안 깨짐 (안전장치가 헐거움)");

      /* 7-b) 안전한 승격은 막히지 않아야 합니다 (거짓 차단 방지) */
      const safe = P.dryRun({ kind: "intent", intent: "max", phrase: "젤 높" }, t);
      add("루프 · 안전한 승격은 통과", safe.ok === true,
        "안전한 어휘를 막음: " + safe.fails.join(" / "));

      /* 8) 승격은 기존 해석을 바꾸지 않아야 합니다 (오버레이는 마지막에만) */
      const t1 = X.add({ kind: "intent", intent: "count", phrase: "가장 높", temp: true });
      const still = E._detectIntent(E._norm("수율이 가장 높은 Batch는?"));
      X.revert(t1.id, "테스트");
      add("루프 · 하드코딩 규칙이 우선", still === "max",
        "오버레이가 하드코딩 규칙을 덮어씀 (intent=" + still + ")");

    } finally {
      /* 원상 복구 — 테스트가 사용자 데이터를 남기지 않습니다 */
      X.clear();
      (lexBefore.entries || []).forEach(e => X.add(e));
      Log.clear();
      (logBefore.list || []).slice().reverse().forEach(function (e) {
        Log.record({ question: e.question, path: e.path, kind: e.kind, intent: e.intent,
          rows: e.rows, slots: e.slots, confidence: e.confidence, rejected: e.rejected });
      });
    }
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
     ["G. 맥락 승계", r.context], ["H. 무효 조건 경고", r.noop],
     ["I. 하이브리드 30문항", r.hybrid], ["J. 가드", r.guard],
     ["K. 서술 수치 검증", r.verify], ["L. 장애 대비", r.faults],
     ["M. 승격 안전 스펙", r.core], ["N. 자가 개선 루프", r.loop],
     ["O. 수치 검증 적용 범위", r.coverage], ["P. 규격 판정", r.spec],
     ["Q. 기간 · 출처 · 데이터 품질", r.quality]]
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

  return { run: run, text: text, faults: runFaultChecks, BATTERY: BATTERY, ANCHORS: ANCHORS, SUBSET: SUBSET,
           PHASE1: PHASE1, PHASE2: PHASE2, CONTEXT: CONTEXT, NOOP_WARN: NOOP_WARN };
})();
