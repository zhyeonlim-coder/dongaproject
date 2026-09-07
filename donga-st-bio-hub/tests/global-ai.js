/* ==========================================================================
   global-ai.js — Global AI Assistant 검사  ·  window.GlobalAITest

   무엇을 보는가
     1) 어느 화면에서든 같은 답이 나오는가 — 페이지마다 다르면 그게 결함
     2) 수치가 반드시 검증을 통과했는가 — 통과하지 않은 수치는 못 나감
     3) 도구가 기존 함수와 같은 값을 내는가 — 화면과 AI 가 갈리면 안 됨
     4) 없는 데이터는 "기록 없음" 인가 — 지어내지 않는가
     5) DoE 도구가 DoE 화면 밖에서 막히는가
     6) 화면을 마음대로 바꾸지 않는가 — 제안만 하는가

   이 파일은 화면(ui.js) 없이 돕니다. 로직과 표시를 갈라 두면, 표시가
   바뀌어도 검사가 살아남습니다.
   ========================================================================== */

window.GlobalAITest = (function () {
  "use strict";

  function mk() {
    const out = [];
    return {
      out: out,
      add: function (q, ok, note) {
        out.push({ q: q, pass: !!ok, fail: ok ? [] : [String(note || "")] });
      }
    };
  }

  /* ── 1. 검증을 통과하지 않은 수치는 나가지 않는다 ────────────────── */
  function runVerify(t) {
    const T = mk();
    const QS = ["Titer 평균이랑 편차", "역가 제일 높은 거", "생존율 90 이상인 배치",
                "과제별 Total Yield 비교", "배치 수 알려줘", "B045-2 알려줘"];
    return Promise.all(QS.map(q => window.AITools.run("searchExperimentData", { question: q })))
      .then(function (list) {
        list.forEach(function (res, i) {
          const q = QS[i];
          T.add("검증 통과 · " + q,
            res.ok && res.data && res.data.verified && res.data.verified.ok === true,
            "verified=" + JSON.stringify(res.data && res.data.verified));
          T.add("근거 표시 · " + q,
            res.ok && res.meta && res.meta.source && res.meta.rows != null,
            "meta=" + JSON.stringify(res.meta));
        });
        return T.out;
      });
  }

  /* ── 2. 도구 결과 = 화면이 쓰는 함수 결과 ────────────────────────────
     같은 질문을 AskEngine 으로 직접 물었을 때와 도구로 물었을 때가
     한 글자라도 다르면 안 됩니다. */
  function runParity(t) {
    const T = mk();
    const QS = ["Titer 평균", "수율이 가장 높은 배치", "생존율 분포"];
    return Promise.all(QS.map(q => window.AITools.run("searchExperimentData", { question: q })))
      .then(function (list) {
        list.forEach(function (res, i) {
          const q = QS[i];
          const direct = window.AskEngine.answer(q, { table: t });
          window.AskVerify.enforce(direct, t);
          const a = res.data, b = direct;
          T.add("화면과 동일 · " + q,
            a.headline === b.headline &&
            JSON.stringify(a.stats || null) === JSON.stringify(b.stats || null),
            "AI: " + String(a.headline).slice(0, 60) + " / 직접: " + String(b.headline).slice(0, 60));
        });
        return T.out;
      });
  }

  /* ── 3. 없는 데이터는 지어내지 않는다 ───────────────────────────────── */
  function runNoInvent() {
    const T = mk();
    return Promise.all([
      window.AITools.run("getExperiment", { batch: "B999-9" }),
      window.AITools.run("compareExperiments", { a: "B999-9", b: "B045-1" }),
      window.AITools.run("searchExperimentData", { question: "pH 평균 알려줘" })
    ]).then(function (r) {
      T.add("없는 배치 · 기록 없음이라 답함",
        r[0].ok === false && /없습니다/.test(r[0].error), JSON.stringify(r[0]).slice(0, 100));
      T.add("없는 배치 비교 · 거절",
        r[1].ok === false && /없습니다/.test(r[1].error), JSON.stringify(r[1]).slice(0, 100));
      /* pH 는 원본에 컬럼이 없는 항목입니다 — 값을 만들면 안 됩니다 */
      const txt = r[2].ok ? JSON.stringify(r[2].data) : r[2].error;
      T.add("없는 컬럼 · 값을 만들지 않음",
        /컬럼이 없어|답할 수 없|찾지 못/.test(txt), txt.slice(0, 120));
      return T.out;
    });
  }

  /* ── 4. DoE 도구는 DoE 화면에서만 ───────────────────────────────────── */
  function runDoeGate() {
    const T = mk();
    const names = ["runANOVA", "runRegression", "optimizeExperiment", "runDoE"];
    return Promise.all(names.map(n => window.AITools.run(n, {}))).then(function (list) {
      list.forEach(function (res, i) {
        /* 이 검사 페이지는 hub 가 아니므로 전부 막혀야 합니다 */
        T.add("DoE 차단 · " + names[i],
          res.ok === false && /DoE 화면|설계/.test(res.error || ""),
          JSON.stringify(res).slice(0, 120));
      });
      return T.out;
    });
  }

  /* ── 5. 화면을 마음대로 바꾸지 않는다 ───────────────────────────────
     제안만 만들고, 실행은 사용자가 버튼을 눌렀을 때만 일어나야 합니다. */
  function runNoAutoAction() {
    const T = mk();
    const before = window.Scope ? JSON.stringify(window.Scope.get()) : null;
    return window.GlobalAI.ask("2025년 1월 데이터만 보여줘").then(function (out) {
      const after = window.Scope ? JSON.stringify(window.Scope.get()) : null;
      T.add("필터를 제안만 함", out.kind === "action-proposal",
        "kind=" + out.kind);
      T.add("묻기 전에 화면을 바꾸지 않음", before === after,
        "before=" + String(before).slice(0, 60) + " after=" + String(after).slice(0, 60));
      /* 없는 달은 제안하지 않아야 합니다 */
      const bad = window.GlobalAI._filterFromText("2025년 13월 데이터만 보여줘");
      T.add("없는 달은 필터로 만들지 않음", bad === null, JSON.stringify(bad));
      return T.out;
    });
  }

  /* ── 6. 화면별 추천 질문이 실제 컬럼에서 나오는가 ──────────────────── */
  function runSuggestions(t) {
    const T = mk();
    const labels = t.columns.filter(c => c.type === "num").map(c => c.label);
    const pages = ["dashboard", "data", "ebr", "schedule", "hub"];
    pages.forEach(function (p) {
      window.AIContext.setPage(p);
      const s = window.GlobalAI.suggestions();
      T.add("추천 질문 · " + p, s.length >= 3, "개수 " + s.length);
      /* 항목 이름을 쓴 추천은 실제 컬럼이어야 합니다 */
      const madeUp = s.filter(q => /Titer|VCD|Yield|생존율|배양/.test(q))
        .filter(q => !labels.some(l => q.indexOf(l) > -1) &&
                     !/배치|미입력|과제|harvest|어느|ANOVA|최적|인자|회귀|논문|DOI/.test(q));
      T.add("추천 질문에 없는 항목 없음 · " + p, madeUp.length === 0, madeUp.join(" / "));
    });
    window.AIContext.setPage(null);
    return Promise.resolve(T.out);
  }

  /* ── 7. 문헌 도구는 실제 결과만 (네트워크 없이 형태만 확인) ────────── */
  function runLit() {
    const T = mk();
    T.add("문헌 도구 등록됨", window.AITools.names().indexOf("searchLiterature") > -1, "없음");
    T.add("빈 질의 거절", true, "");
    return window.AITools.run("searchLiterature", { query: "" }).then(function (r) {
      T.out.pop();
      T.add("빈 질의 거절", r.ok === false, JSON.stringify(r).slice(0, 80));
      return T.out;
    });
  }

  function run() {
    const t = window.AskTables.internal();
    const groups = [];
    return runVerify(t)
      .then(r => { groups.push(["A. 수치 검증", r]); return runParity(t); })
      .then(r => { groups.push(["B. 화면과 동일한 값", r]); return runNoInvent(); })
      .then(r => { groups.push(["C. 지어내지 않음", r]); return runDoeGate(); })
      .then(r => { groups.push(["D. DoE 화면 밖 차단", r]); return runNoAutoAction(); })
      .then(r => { groups.push(["E. 화면 임의 변경 없음", r]); return runSuggestions(t); })
      .then(r => { groups.push(["F. 추천 질문", r]); return runLit(); })
      .then(function (r) {
        groups.push(["G. 문헌 도구", r]);
        const checks = groups.map(function (g) {
          const bad = g[1].filter(x => !x.pass);
          return { id: g[0], pass: !bad.length,
            detail: (g[1].length - bad.length) + "/" + g[1].length + " 통과" +
              (bad.length ? " · 실패: " + bad.map(b => "\"" + b.q + "\"(" + b.fail.join(",") + ")").join(" ; ") : "") };
        });
        return { pass: checks.every(c => c.pass), checks: checks, groups: groups };
      });
  }

  function text(res) {
    let s = "";
    res.checks.forEach(function (c) {
      s += (c.pass ? " OK  " : "★NG  ") + c.id + "  " + c.detail + "\n";
    });
    return s;
  }

  return { run: run, text: text };
})();
