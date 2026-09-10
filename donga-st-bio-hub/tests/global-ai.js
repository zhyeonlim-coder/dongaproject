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

      /* Europe PMC 는 검색어와 겹치는 낱말을 <b> 로 감싸 주는데, 그것을
         &lt;b&gt; 로 escape 해서 돌려주는 응답이 섞여 있습니다. 그대로
         두면 화면에 논문 제목 대신 "&lt;b&gt;EGFR&lt;/b&gt;" 이 찍힙니다.
         실제 production 에서 이 모양으로 보였습니다. */
      const clean = window.LitAPI && window.LitAPI._clean;
      T.add("문헌 제목 정리 함수 노출됨", typeof clean === "function", "없음");
      if (typeof clean === "function") {
        T.add("escape 된 강조 태그 제거",
          clean("&lt;b&gt;EGFR&lt;/b&gt; signalling") === "EGFR signalling",
          JSON.stringify(clean("&lt;b&gt;EGFR&lt;/b&gt; signalling")));
        T.add("생 태그 제거",
          clean("<b>EGFR</b> signalling") === "EGFR signalling",
          JSON.stringify(clean("<b>EGFR</b> signalling")));
        T.add("본문 앰퍼샌드는 살림",
          clean("Smith &amp; Jones") === "Smith & Jones",
          JSON.stringify(clean("Smith &amp; Jones")));
      }
      return T.out;
    });
  }

  /* ── 8. 결과 재가공 — 새 수치를 만들지 않는가 ────────────────────────
     "표로 정리해줘" · "보고서 문장으로" 는 이미 나온 값을 옮기는 것이지
     다시 조회하는 것이 아닙니다. 다시 조회하면 그 사이 값이 바뀌었을 때
     원래 답과 다른 숫자가 나오고, 사용자는 같은 것을 봤다고 생각합니다. */
  function runFormat() {
    const T = mk();
    window.GlobalAI.reset();
    return window.GlobalAI.ask("Titer 평균이랑 편차").then(function (a1) {
      const st = a1.answer && a1.answer.stats;
      T.add("재가공 · 원본 통계 확보", !!st, "통계 없음");
      return window.GlobalAI.ask("이 결과를 표로 정리해줘").then(function (a2) {
        T.add("표로 정리", a2.kind === "formatted" && a2.data.style === "table" &&
          a2.data.rows.length > 0, "kind=" + a2.kind);
        /* 표의 모든 값이 원본 통계에서 온 것인지 */
        if (st && a2.data && a2.data.rows) {
          const allowed = new Set();
          ["n", "mean", "median", "sd", "min", "max", "cv"].forEach(function (k) {
            const v = st[k];
            if (typeof v !== "number") return;
            allowed.add(v);
            for (let dp = 0; dp <= 3; dp++) allowed.add(Number(v.toFixed(dp)));
          });
          const bad = [];
          a2.data.rows.forEach(function (r) {
            String(r["값"]).replace(/-?\d+(?:\.\d+)?/g, function (m) {
              const n = Number(m);
              if (!allowed.has(n) && !allowed.has(Number(n.toFixed(1)))) bad.push(n);
              return m;
            });
          });
          T.add("표 · 원본에 없는 수치 0", bad.length === 0, "새 수치: " + bad.slice(0, 4).join(", "));
        }
        /* 재가공물을 다시 재가공해도 원본을 찾아야 합니다 */
        return window.GlobalAI.ask("이 결과를 보고서 문장으로 만들어줘");
      }).then(function (a3) {
        T.add("보고서 문장 (재가공물 뒤에서도)",
          a3.kind === "formatted" && a3.data.style === "report" && !!a3.data.text,
          "kind=" + a3.kind + " — 직전이 표 정리 결과여도 원본 조회를 찾아야 합니다");
        if (st && a3.data && a3.data.text) {
          const allowed = new Set();
          ["n", "mean", "median", "sd", "min", "max", "cv"].forEach(function (k) {
            const v = st[k];
            if (typeof v !== "number") return;
            allowed.add(v);
            for (let dp = 0; dp <= 3; dp++) allowed.add(Number(v.toFixed(dp)));
          });
          const bad = [];
          String(a3.data.text).replace(/-?\d+(?:\.\d+)?/g, function (m) {
            const n = Number(m);
            if (!allowed.has(n) && !allowed.has(Number(n.toFixed(1)))) bad.push(n);
            return m;
          });
          T.add("보고서 문장 · 원본에 없는 수치 0", bad.length === 0,
            "새 수치: " + bad.slice(0, 4).join(", "));
        }
        /* 조회한 적이 없으면 지어내지 않고 없다고 답해야 합니다 */
        window.GlobalAI.reset();
        return window.GlobalAI.ask("이 결과를 보고서 문장으로 만들어줘");
      }).then(function (a4) {
        T.add("직전 결과 없으면 만들지 않음",
          a4.kind === "no-data" && /직전 결과가 없|먼저/.test(String(a4.headline)),
          "kind=" + a4.kind + " · " + String(a4.headline).slice(0, 60));
        return T.out;
      });
    });
  }

  /* ── 9. 화면 조작 3종 — 제안만 하고 실행하지 않는가 ─────────────────── */
  function runActions() {
    const T = mk();

    /* ★ 훅이 없는 화면에서는 제안 자체가 나오지 않아야 합니다. 예전에는
       어느 화면에서든 [적용] 버튼이 떴고, 눌러도 아무 일이 없었습니다.
       먼저 훅 없는 상태를 확인하고, 그 다음에 훅을 걸고 제안을 봅니다. */
    const sorted = [], picked = [];
    return window.GlobalAI.ask("Titer 높은 순으로 정렬해줘").then(function (a) {
      T.add("훅 없으면 정렬 제안을 만들지 않음",
        a.kind === "no-data" && /정렬/.test(String(a.headline || "")),
        "kind=" + a.kind + " head=" + String(a.headline || "").slice(0, 60));
      return window.GlobalAI.ask("B123-7 선택해줘");
    }).then(function (a) {
      /* 거절만 하고 끝내면 사용자는 어디서 되는지 모릅니다 — 되는 곳을
         함께 알려 주는지까지 봅니다. 문구가 아니라 그 계약을 봅니다. */
      T.add("훅 없으면 선택 제안을 만들지 않음",
        a.kind === "no-data" && /배치 비교/.test(String(a.headline || "")),
        "kind=" + a.kind + " head=" + String(a.headline || "").slice(0, 70));

      window.AIContext.registerHook("sort", p => sorted.push(p));
      window.AIContext.registerHook("select", p => picked.push(p));
      return window.GlobalAI.ask("Titer 높은 순으로 정렬해줘");
    }).then(function (a) {
      T.add("정렬 · 제안 생성", a.kind === "action-proposal" && a.data.action === "sort",
        "kind=" + a.kind);
      T.add("정렬 · 항목을 실제 컬럼에서 찾음",
        !!a.data && /Titer/.test(String(a.data.label)), "label=" + (a.data && a.data.label));
      return window.GlobalAI.ask("B123-7 선택해줘");
    }).then(function (a) {
      T.add("선택 · 제안 생성", a.kind === "action-proposal" && a.data.action === "select",
        "kind=" + a.kind);
      return window.GlobalAI.ask("B999-99 선택해줘");
    }).then(function (a) {
      T.add("선택 · 없는 배치는 거절",
        a.kind === "no-data" || (a.kind === "engine"), "kind=" + a.kind);

      /* 훅이 걸린 화면에서는 [적용] 이 실제로 그 훅을 부릅니다 */
      const r1 = window.GlobalAI.applyAction({ action: "sort", patch: { key: "titerHCCF", dir: -1 } });
      T.add("정렬 [적용] 이 화면 훅을 부름",
        r1.ok === true && sorted.length === 1 && sorted[0].key === "titerHCCF",
        JSON.stringify(r1) + " calls=" + JSON.stringify(sorted));
      const r2 = window.GlobalAI.applyAction({ action: "select", patch: { batchId: "x", label: "B123-7" } });
      T.add("선택 [적용] 이 화면 훅을 부름",
        r2.ok === true && picked.length === 1, JSON.stringify(r2));

      T.add("알 수 없는 동작은 거절",
        window.GlobalAI.applyAction({ action: "deleteAll" }).ok === false, "실행됨");

      /* 뒤 그룹이 훅을 물려받지 않도록 되돌립니다 */
      window.AIContext.registerHook("sort", null);
      window.AIContext.registerHook("select", null);
      T.add("훅 해제됨", !window.AIContext.hook("sort") && !window.AIContext.hook("select"),
        "남아 있음");
      return T.out;
    });
  }

  /* ── 10. Context 표준 필드 ───────────────────────────────────────────── */
  function runContextFields() {
    const T = mk();
    const c = window.AIContext.get();
    ["currentExperiment", "selectedRows", "selectedFilters", "currentDateRange",
     "currentLiteratureQuery", "currentLiteratureResults",
     "selectedLiterature", "selectedLiteratureId", "selectedDOI"].forEach(function (k) {
      T.add("Context 필드 존재 · " + k, k in c, "없음");
    });
    T.add("Context 훅 등록 API", typeof window.AIContext.registerHook === "function", "없음");
    /* 훅은 화면이 등록할 때만 있어야 합니다 — 없는 화면에서 있으면 안 됩니다 */
    T.add("훅은 등록한 화면에서만", window.AIContext.hook("sort") === null,
      "검사 페이지에 정렬 훅이 있습니다");
    return Promise.resolve(T.out);
  }

  /* ── 11. 이어지는 대화 ───────────────────────────────────────────────
     순위 · 지시어 · 문헌 후속. 여기서 지키려는 것은 하나입니다 —
     사용자가 앞 답을 보고 이어 물었을 때, 답이 <b>그것</b>에 대한 것이어야
     합니다. 다른 것을 답하면서 그럴듯한 숫자를 붙이는 것이 최악입니다. */
  function runConversation(t) {
    const T = mk();
    const E = window.AskEngine;

    /* 엔진 계약 그대로 씁니다 — prev 는 { carry, question } */
    function chain(qs) {
      let prev = null; const outs = [];
      qs.forEach(function (q) {
        const r = E.answer(q, { table: t, prev: prev });
        outs.push(r);
        if (r.carry) prev = { carry: r.carry, question: q };
      });
      return outs;
    }

    /* 순위 — "다음" 이 실제로 다음 값을 가리키는가 */
    const asc = t.columns.find(c => c.key === "titerHCCF");
    const r1 = chain(["Titer HCCF 가장 높은 배치는?", "다음으로 높은 건?", "그 다음은?"]);
    const vals = r1.map(r => r.facts && r.facts[0] ? r.facts[0].v : null);
    T.add("순위 · 1위 → 2위 → 3위 가 모두 다른 값",
      vals[0] && vals[1] && vals[2] && vals[0] !== vals[1] && vals[1] !== vals[2],
      JSON.stringify(vals));
    T.add("순위 · carry.rank 가 1 → 2 → 3",
      r1[0].carry.rank === 1 && r1[1].carry.rank === 2 && r1[2].carry.rank === 3,
      r1.map(r => r.carry.rank).join(","));
    const sortedDesc = t.rows.map(r => r[asc.key])
      .filter(v => typeof v === "number" && isFinite(v)).sort((a, b) => b - a);
    const distinct = sortedDesc.filter((v, i) => i === 0 || sortedDesc[i - 1] !== v);
    T.add("순위 · 2위 값이 실제 2번째 서로 다른 값",
      String(vals[1]).indexOf(String(distinct[1])) > -1,
      "답=" + vals[1] + " 실제=" + distinct[1]);

    /* 명시 순위 */
    const r2 = E.answer("Titer HCCF 3번째로 높은 배치는?", { table: t, prev: null });
    T.add("순위 · \"3번째로 높은\" 을 바로 읽음",
      r2.carry.rank === 3 && String(r2.facts[0].v).indexOf(String(distinct[2])) > -1,
      "rank=" + r2.carry.rank + " v=" + (r2.facts[0] || {}).v);
    T.add("순위 · 순위 표현이 미처리 조건으로 남지 않음",
      !(r2.conditions.unhandled || []).some(u => /번째/.test(u)),
      JSON.stringify(r2.conditions.unhandled));

    /* 범위 밖 순위는 지어내지 않습니다 */
    const r3 = E.answer("Titer HCCF 999번째로 높은 배치는?", { table: t, prev: null });
    T.add("순위 · 없는 순위는 없다고 답함",
      r3.ok === false && r3.kind === "no-rank", r3.kind + " / " + (r3.headline || "").slice(0, 60));

    /* 동점 순위는 값 단위로 셉니다 — 공동 1위 안에서 2위를 뽑으면 안 됩니다 */
    const days = t.columns.find(c => c.key === "cultureDays");
    if (days) {
      const rr = chain(["배양 일수 가장 높은 배치는?", "다음으로 높은 건?"]);
      const v0 = rr[0].tie ? rr[0].tie.value : null;
      const v1 = rr[1].facts && rr[1].facts[0] ? rr[1].facts[0].v : null;
      T.add("순위 · 공동 1위 다음은 더 낮은 값",
        v0 !== null && v1 !== null && String(v1).indexOf(String(v0)) === -1,
        "1위=" + v0 + " 2위=" + v1);
    }

    /* 지시어 — 배치를 뭐라고 부르든 같은 것을 가리켜야 합니다 */
    ["그 배치", "그 조건", "그 실험", "그 결과"].forEach(function (w) {
      const rr = chain(["Titer HCCF 가장 높은 배치는?", w + "의 Total Yield는?"]);
      const top = rr[0].facts && rr[0].rows && rr[0].rows.length ? rr[0].focusLabels : null;
      T.add("지시어 · \"" + w + "\" 가 한 건으로 좁혀짐",
        rr[1].scopeRows === 1, "행 " + rr[1].scopeRows + "건");
    });

    /* 모호하면 되묻습니다 — 아무거나 고르지 않습니다 */
    if (days) {
      const rr = chain(["배양 일수 가장 높은 배치는?", "그 배치의 Titer는?"]);
      T.add("모호 · 후보가 여럿이면 되물음",
        rr[1].kind === "ambiguous-ref" && (rr[1].choices || []).length > 1,
        rr[1].kind + " / choices=" + ((rr[1].choices || []).length));
      T.add("모호 · 되물을 때 수치를 내놓지 않음",
        rr[1].kind !== "ambiguous-ref" || !rr[1].stats,
        "stats 가 함께 나왔습니다");
      const rp = chain(["배양 일수 가장 높은 배치는?", "그 중 전부의 Titer는?"]);
      T.add("모호 · \"그 중 전부\" 는 지목된 건수를 그대로 이어받음",
        rp[1].scopeRows === (rp[0].tie ? rp[0].tie.count : -1),
        "이어받은 " + rp[1].scopeRows + "건 vs 지목 " + (rp[0].tie ? rp[0].tie.count : "?") + "건");
    }
    return Promise.resolve(T.out);
  }

  /* ── 12. 문헌 후속 — 재검색 없이, DOI 는 지어내지 않고 ───────────────
     실제 네트워크를 쓰지 않습니다. LitAPI.search 를 가짜로 바꿔 두고,
     몇 번 불렸는지를 셉니다 — 후속 질문에서 다시 부르면 그게 결함입니다. */
  function runLitFollowUp() {
    const T = mk();
    const real = window.LitAPI.search;
    let calls = 0;
    const FAKE = [
      { key: "10.1/aaa", title: "Alpha EGFR study", authors: "Kim", journal: "J1",
        year: "2020", doi: "10.1/aaa", url: "https://doi.org/10.1/aaa",
        abstract: "Alpha abstract text.", cites: 5, type: "논문", from: "Europe PMC" },
      { key: "np:2", title: "Beta EGFR study without doi", authors: "Lee", journal: "J2",
        year: "2024", doi: null, url: "https://europepmc.org/article/MED/2",
        abstract: "", cites: 40, type: "논문", from: "Europe PMC" },
      { key: "10.1/ccc", title: "Gamma EGFR study", authors: "Park", journal: "J3",
        year: "2022", doi: "10.1/ccc", url: "https://doi.org/10.1/ccc",
        abstract: "Gamma abstract text.", cites: 1, type: "논문", from: "Crossref" }
    ];
    window.LitAPI.search = function () {
      calls++;
      return Promise.resolve({ items: FAKE.slice() });
    };
    window.GlobalAI.reset();
    window.GlobalAI._setLlmState(false);

    const seen = [];
    function ask(q) {
      return window.GlobalAI.ask(q).then(function (a) { seen.push(a); return a; });
    }
    return ask("EGFR 관련 논문 찾아줘").then(function (a) {
      T.add("문헌 · 첫 질문은 실제로 검색함", a.kind === "literature" && calls === 1,
        a.kind + " calls=" + calls);
      return ask("가장 최근 논문은?");
    }).then(function (a) {
      T.add("문헌 · 최신은 재검색 없이 답함",
        a.kind === "literature-one" && calls === 1, a.kind + " calls=" + calls);
      T.add("문헌 · 최신 = 연도 최대(2024)",
        a.data && a.data.paper && a.data.paper.year === "2024",
        a.data && a.data.paper ? a.data.paper.year : "없음");
      return ask("그 논문의 DOI는?");
    }).then(function (a) {
      T.add("문헌 · DOI 는 지목한 논문 그대로 (없으면 null)",
        a.kind === "literature-one" && a.data.aspect === "doi" &&
        a.data.paper.key === "np:2" && a.data.paper.doi === null,
        JSON.stringify(a.data && { k: a.data.paper.key, d: a.data.paper.doi }));
      T.add("문헌 · DOI 를 만들어 내지 않음", calls === 1, "calls=" + calls);
      return ask("두 번째 논문은?");
    }).then(function (a) {
      T.add("문헌 · 번호로 고르기",
        a.data && a.data.paper && a.data.paper.key === "np:2" && calls === 1,
        a.data && a.data.paper ? a.data.paper.key : "없음");
      return ask("첫 번째 논문의 DOI는?");
    }).then(function (a) {
      T.add("문헌 · 고른 논문의 실제 DOI",
        a.data && a.data.paper && a.data.paper.doi === "10.1/aaa",
        a.data && a.data.paper ? String(a.data.paper.doi) : "없음");
      return ask("이 논문의 주요 결과를 정리해줘");
    }).then(function (a) {
      T.add("문헌 · 초록은 출처 원문을 그대로",
        a.data && a.data.aspect === "abstract" &&
        a.data.paper.abstract === "Alpha abstract text.",
        JSON.stringify(a.data && a.data.paper && a.data.paper.abstract));
      return ask("HER2 관련 논문 찾아줘");
    }).then(function (a) {
      T.add("문헌 · 새 주제어는 새로 검색함",
        a.kind === "literature" && calls === 2, a.kind + " calls=" + calls);
      /* 지목은 새 검색에서 풀려야 합니다 */
      const c = window.AIContext.get();
      T.add("문헌 · 새 검색이 오면 지목이 풀림", c.selectedLiteratureId === null,
        String(c.selectedLiteratureId));
      T.add("문헌 · Context 에 검색어가 올라감",
        !!c.currentLiteratureQuery, String(c.currentLiteratureQuery));
      window.LitAPI.search = real;
      window.GlobalAI.reset();
      return T.out;
    }).catch(function (e) {
      window.LitAPI.search = real;
      T.add("문헌 후속 검사가 끝까지 돌았는가", false, (e && e.message) || "오류");
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
      .then(r => { groups.push(["G. 문헌 도구", r]); return runFormat(); })
      .then(r => { groups.push(["H. 결과 재가공", r]); return runActions(); })
      .then(r => { groups.push(["I. 화면 조작 3종", r]); return runContextFields(); })
      .then(r => { groups.push(["J. Context 표준 필드", r]); return runConversation(t); })
      .then(r => { groups.push(["K. 이어지는 대화 · 순위 · 지시어", r]); return runLitFollowUp(); })
      .then(function (r) {
        groups.push(["L. 문헌 후속 · DOI", r]);
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
