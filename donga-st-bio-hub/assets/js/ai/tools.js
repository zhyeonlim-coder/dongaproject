/* ==========================================================================
   ai/tools.js — AI 가 부를 수 있는 도구 목록  ·  window.AITools

   원칙 하나
     여기 있는 함수는 계산을 <b>하지 않습니다</b>. 이미 화면이 쓰고 있는
     함수를 부르기만 합니다. 같은 질문을 화면에서 눌렀을 때와 AI 로 물었을
     때 값이 다르면 그게 가장 나쁜 결과이기 때문입니다.

       화면 ─┐
             ├→ 같은 함수 (AskEngine · Doe · LitAPI · Calc)
       AI   ─┘

     그래서 이 파일에는 통계 공식이 한 줄도 없습니다. 공식을 여기 다시
     쓰는 순간 두 벌이 되고, 언젠가 갈라집니다.

   Phase B 대비
     각 도구는 name · description · params 를 갖습니다. 그대로 Claude 의
     tool 정의로 변환할 수 있는 모양입니다. 지금은 규칙 엔진이 도구를
     고르고, 키가 붙으면 모델이 고릅니다 — 고르는 주체만 바뀌고 실행부는
     그대로입니다.

   ★ 반환 규약
     모든 도구는 { ok, data, meta, error } 를 돌려줍니다.
       ok=false 일 때 error 는 사용자에게 그대로 보여도 되는 문장입니다.
       meta 에는 "무엇을 근거로 했는가" 가 들어갑니다 — 화면이 Source 카드로
       씁니다. 근거를 못 적는 결과는 내보내지 않습니다.
   ========================================================================== */

window.AITools = (function () {
  "use strict";

  const ok = (data, meta) => ({ ok: true, data: data, meta: meta || {} });
  const no = (msg, meta) => ({ ok: false, error: msg, meta: meta || {} });

  /* ★ 검증기가 없으면 수치를 내보내지 않습니다.

     이 파일이 어느 페이지에 실렸는지에 따라 검증이 되기도 하고 안 되기도
     하면, 페이지마다 안전 수준이 다른 시스템이 됩니다. 그리고 그건 화면
     어디에도 보이지 않습니다 — 검증 없이 나간 숫자와 검증된 숫자가
     똑같이 생겼기 때문입니다.

     그래서 없으면 답하지 않습니다. 답이 없는 것이 검증 안 된 답보다 낫습니다. */
  function ready() {
    const miss = [];
    if (!window.AskTables) miss.push("데이터 테이블");
    if (!window.AskEngine) miss.push("조회 엔진");
    if (!window.AskVerify) miss.push("수치 검증기");
    return miss;
  }
  function notReady(miss) {
    return no("이 화면에서는 데이터 조회를 사용할 수 없습니다 (" + miss.join(" · ") +
      " 미로드). 수치를 검증 없이 답하지 않기 위해 조회를 중단했습니다 — " +
      "DoE & Intelligence → AI 검색 화면에서 물어봐 주세요.",
      { source: "확인 불가" });
  }

  function table() { return window.AskTables.internal(); }

  /* 화면이 좁혀 놓은 범위를 실제 행 목록으로 — 없으면 null(=전체) */
  function scopedRows(t, ctx) {
    const ids = ctx && ctx.visibleBatchIds;
    if (!Array.isArray(ids) || !ids.length) return null;
    const set = {};
    ids.forEach(id => { set[id] = true; });
    const rows = t.rows.filter(r => set[r.__id] || set[r.__label]);
    return rows.length ? rows : null;
  }

  /* ── 1. 실험 데이터 조회 · 집계 ──────────────────────────────────────
     기존 AskEngine 을 그대로 부릅니다. 이 한 줄에 조건 파싱 · 필터 · 집계 ·
     단위 해석 · 생성값 표식 · 검증 필요 제외 · 출처 고지가 전부 들어 있습니다.
     새로 만들 이유가 없습니다. */
  function searchExperimentData(args, ctx) {
    const miss = ready();
    if (miss.length) return notReady(miss);
    const q = String((args && args.question) || "").trim();
    if (!q) return no("무엇을 찾을지 알려 주세요.");
    const t = table();
    const r = window.AskEngine.answer(q, {
      table: t,
      prev: (args && args.prev) || null
    });
    /* 서술 문장의 수치를 데이터와 다시 대조합니다 — 통과하지 못한 문장은
       엔진이 스스로 표만 남깁니다 */
    window.AskVerify.enforce(r, t);
    return ok(r, {
      source: "사내 실험 데이터",
      rows: r.scopeRows,
      scope: r.scopeLabel,
      verified: r.verified ? r.verified.ok : null,
      checked: r.verified ? r.verified.checked : 0
    });
  }

  /* ── 2. 배치 하나 ───────────────────────────────────────────────────── */
  function getExperiment(args, ctx) {
    const miss = ready();
    if (miss.length) return notReady(miss);
    const id = String((args && args.batch) || "").trim();
    if (!id) return no("어느 배치인지 알려 주세요.");
    const t = table();
    const row = t.rows.find(r => r.__label === id || r.__id === id);
    if (!row) {
      return no("\"" + id + "\" 배치는 이 데이터에 없습니다. " +
        "기록된 배치는 " + t.rows.length + "건입니다.");
    }
    return searchExperimentData({ question: id + " 알려줘" }, ctx);
  }

  /* ── 3~6. 통계 — 전부 AskEngine 의 stats() 를 거칩니다 ─────────────
     평균 · 중앙값 · 표준편차 · 최소 · 최대 · CV 가 한 번에 나옵니다.
     CV 만 따로 계산하는 함수를 만들지 않는 이유도 같습니다 — 두 벌이 되면
     반올림 한 자리에서 갈라집니다. */
  function calculateStatistics(args, ctx) {
    const metric = String((args && args.metric) || "").trim();
    if (!metric) return no("어떤 항목의 통계인지 알려 주세요.");
    return searchExperimentData({ question: metric + " 평균" }, ctx);
  }
  function calculateCV(args, ctx) { return calculateStatistics(args, ctx); }

  /* ── 7. 비교 ────────────────────────────────────────────────────────── */
  function compareExperiments(args, ctx) {
    const miss = ready();
    if (miss.length) return notReady(miss);
    const a = (args && args.a) || "", b = (args && args.b) || "";
    const metric = (args && args.metric) || "";
    if (a && b) {
      const t = table();
      const rows = [a, b].map(function (id) {
        return t.rows.find(r => r.__label === id || r.__id === id) || null;
      });
      const missing = [a, b].filter((id, i) => !rows[i]);
      if (missing.length) {
        return no("\"" + missing.join("\", \"") + "\" 배치는 이 데이터에 없습니다.");
      }
      const cols = t.columns.filter(c => c.type === "num" &&
        (!metric || c.label.toLowerCase().indexOf(String(metric).toLowerCase()) > -1));
      const use = cols.length ? cols : t.columns.filter(c => c.type === "num");
      const rowsOut = use.map(function (c) {
        const va = rows[0][c.key], vb = rows[1][c.key];
        if (typeof va !== "number" && typeof vb !== "number") return null;
        return {
          항목: c.label + (c.generated ? " ◇" : ""),
          [a]: typeof va === "number" ? va : "기록 없음",
          [b]: typeof vb === "number" ? vb : "기록 없음"
        };
      }).filter(Boolean);
      return ok({ kind: "compare-rows", a: a, b: b, rows: rowsOut },
        { source: "사내 실험 데이터", rows: 2, scope: a + " vs " + b });
    }
    return searchExperimentData({ question: (metric || "") + " 과제별 비교" }, ctx);
  }

  /* ── 8~11. DoE — hub 화면의 설계와 응답값에만 적용됩니다 ────────────
     Doe.fit / optimise 는 화면이 들고 있는 plan 과 responses 를 받습니다.
     그 상태는 저장되지 않으므로, 다른 화면에서는 분석할 대상 자체가
     없습니다. 있는 척하지 않고 없다고 답합니다. */
  function doeGuard(name) {
    if (window.AIContext.allows(name)) return null;
    return no(window.AIContext.whyNot(name), { source: "DoE" });
  }
  function doeState() {
    const c = window.AIContext.get();
    return (c && c.doe) || null;
  }

  function runDoE(args) {
    const g = doeGuard("runDoE"); if (g) return g;
    const d = doeState();
    return ok({ kind: "doe-plan", design: d.designName, factors: d.factors,
                runs: d.runs, centers: d.centers },
      { source: "DoE 설계 (현재 화면)", rows: d.runs });
  }
  function runRegression(args) {
    const g = doeGuard("runRegression"); if (g) return g;
    const d = doeState();
    const m = d.fit();
    if (!m || m.ok === false) {
      return no(m && m.need
        ? "응답값이 부족해 모형을 세울 수 없습니다 — 항 " + m.need + "개에 대해 " +
          (m.have || 0) + "개만 입력되어 있습니다."
        : "아직 응답값이 입력되지 않아 분석할 수 없습니다.", { source: "DoE" });
    }
    return ok({ kind: "doe-fit", model: m, response: d.responseName },
      { source: "DoE 회귀 (현재 화면 설계)", rows: m.n });
  }
  function runANOVA(args) {
    const g = doeGuard("runANOVA"); if (g) return g;
    const r = runRegression(args);
    if (!r.ok) return r;
    const m = r.data.model;
    if (!m.anova) return no("분산분석표를 만들 수 없습니다 (잔차 자유도 부족).", { source: "DoE" });
    return ok({ kind: "doe-anova", anova: m.anova, model: m, response: r.data.response },
      { source: "DoE 분산분석 (Type I SS · 현재 화면 설계)", rows: m.n });
  }
  function optimizeExperiment(args) {
    const g = doeGuard("optimizeExperiment"); if (g) return g;
    const r = runRegression(args);
    if (!r.ok) return r;
    const d = doeState(), m = r.data.model;
    const goal = (args && args.goal) === "min" ? "min" : "max";
    /* 전역 이름은 DOE 입니다 (doe.js 가 window.DOE 로 노출) */
    const D = window.DOE;
    if (!D || !D.optimise) return no("DoE 모듈이 로드되지 않았습니다.", { source: "DoE" });
    const best = D.optimise(m, d.k, goal, d.alpha || 1);
    if (!best || best.x == null) return no("최적점을 찾지 못했습니다.", { source: "DoE" });
    /* codedToActual 은 값 하나씩 받습니다 — 인자별로 부릅니다 */
    const defs = d.factorDefs || [];
    const actual = best.x.map(function (c, i) {
      const f = defs[i];
      if (!f) return null;
      return { name: f.name, unit: f.unit, value: D.codedToActual(c, f) };
    }).filter(Boolean);
    return ok({ kind: "doe-optimum", goal: goal, coded: best.x,
                actual: actual.length ? actual : null,
                predicted: best.y, response: r.data.response, model: m },
      { source: "DoE 최적화 (현재 화면 설계 · 모형 예측값)", rows: m.n });
  }

  /* ── 12~13. 문헌 — 기존 LitAPI 그대로 ───────────────────────────────
     Europe PMC · Crossref 실제 응답만 씁니다. DOI 가 없는 논문은 없는 채로
     둡니다 — 지어내면 그 순간 이 기능의 쓸모가 사라집니다. */
  function searchLiterature(args) {
    const q = String((args && args.query) || "").trim();
    if (!q) return Promise.resolve(no("무엇을 찾을지 알려 주세요."));
    if (!window.LitAPI) return Promise.resolve(no("문헌 검색 모듈이 로드되지 않았습니다."));
    const limit = Math.min(20, Math.max(1, (args && args.limit) || 10));
    return window.LitAPI.search(q, { limit: limit }).then(function (list) {
      const arr = (list && list.items) || list || [];
      if (!arr.length) {
        return no("\"" + q + "\" 로 검색된 논문이 없습니다.",
          { source: "Europe PMC · Crossref", rows: 0 });
      }
      return ok({ kind: "literature", query: q, items: arr },
        { source: "Europe PMC · Crossref", rows: arr.length, external: true });
    }).catch(function (e) {
      return no("문헌 검색에 실패했습니다 — " + ((e && e.message) || "네트워크 오류") +
        ". 사내 데이터 조회는 계속 사용하실 수 있습니다.",
        { source: "Europe PMC · Crossref" });
    });
  }

  /* ── 14. 공정 계산 — 기존 Calc 그대로 ──────────────────────────────── */
  function calculateProcess(args) {
    if (!window.Calc) return no("공정 계산 모듈이 로드되지 않았습니다.");
    const kind = (args && args.kind) || "";
    const fn = { massBalance: "massBalance", feedVolume: "feedVolume",
                 seedVolume: "seedVolume", dilution: "dilution" }[kind];
    if (!fn) return no("계산 종류를 알 수 없습니다 (물질수지 · Feed · Seed · 희석).");
    try {
      const out = window.Calc[fn](args.input || {});
      return ok({ kind: "calc", type: kind, result: out },
        { source: "공정 계산 (Calc)", formula: kind });
    } catch (e) {
      return no("계산에 실패했습니다 — 입력값을 확인해 주세요.");
    }
  }

  /* ── 15. 현재 화면 상태 ─────────────────────────────────────────────── */
  function getCurrentPageContext() {
    const c = window.AIContext.get();
    return ok({ kind: "context", context: c, describe: window.AIContext.describe() },
      { source: "현재 화면 상태" });
  }

  /* ── 16. 화면 조작 제안 — 실행하지 않습니다 ─────────────────────────
     ★ 사용자가 보고 있는 화면을 AI 가 임의로 바꾸지 않습니다.
       무엇을 하겠다는 제안만 만들고, 실행은 사용자가 버튼을 눌렀을 때
       assistant.js 가 합니다. 화면이 갑자기 바뀌면 사용자는 자기가 보던
       것을 잃고, 무엇 때문에 바뀌었는지도 모릅니다. */
  function proposeFilter(args) {
    if (!window.Scope) return no("이 화면에는 필터가 없습니다.");
    const patch = (args && args.filter) || null;
    if (!patch || !Object.keys(patch).length) return no("적용할 필터를 알 수 없습니다.");
    const label = Object.keys(patch).map(k => k + " = " + patch[k]).join(" · ");
    return ok({ kind: "action-proposal", action: "filter", patch: patch, label: label },
      { source: "화면 조작 제안" });
  }

  /* ★ 화면이 그 동작을 실제로 할 수 있을 때만 제안합니다.
     훅이 없는 화면에서도 [적용] 버튼이 뜨고, 눌러도 아무 일이 없었습니다.
     사용자는 눌렀으니 됐다고 생각하고 표를 그대로 읽습니다 — 제안하지
     않는 편이 낫습니다. 할 수 없으면 할 수 없다고 먼저 말합니다. */
  function canDo(kind) {
    try { return !!(window.AIContext && window.AIContext.hook(kind)); }
    catch (e) { return false; }
  }

  /* 정렬 제안 — 실행하지 않습니다 */
  function proposeSort(args) {
    if (!window.Scope || !window.Scope.setFilter) return no("이 화면에는 정렬이 없습니다.");
    if (!canDo("sort")) {
      return no("이 화면에서는 정렬을 대신 적용할 수 없습니다. 표 머리글을 눌러 정렬해 주세요.");
    }
    const metric = String((args && args.metric) || "").trim();
    const dir = (args && args.order) === "asc" ? "asc" : "desc";
    if (!metric) return no("어떤 항목으로 정렬할지 알려 주세요.");
    const t = table();
    const col = t.columns.find(c => c.type === "num" &&
      String(c.label).toLowerCase().indexOf(metric.toLowerCase()) > -1);
    if (!col) {
      return no("\"" + metric + "\" 항목을 찾지 못해 정렬할 수 없습니다.");
    }
    return ok({ kind: "action-proposal", action: "sort",
                patch: { key: col.key, dir: dir === "asc" ? 1 : -1 },
                label: col.label + " " + (dir === "asc" ? "낮은 순" : "높은 순") },
      { source: "화면 조작 제안" });
  }

  /* 행 선택 제안 — 실행하지 않습니다 */
  function proposeSelect(args) {
    const miss = ready();
    if (miss.length) return notReady(miss);
    if (!canDo("select")) {
      return no("이 화면에는 배치를 골라 넣는 자리가 없습니다. " +
        "데이터 조회의 \"배치 비교\" 에서는 배치를 골라 나란히 볼 수 있습니다.");
    }
    const id = String((args && args.batch) || "").trim();
    if (!id) return no("어느 배치를 선택할지 알려 주세요.");
    const t = table();
    const row = t.rows.find(r => r.__label === id || r.__id === id);
    if (!row) return no("\"" + id + "\" 배치는 이 데이터에 없습니다.");
    return ok({ kind: "action-proposal", action: "select",
                patch: { batchId: row.__id, label: row.__label },
                label: row.__label + " 선택" },
      { source: "화면 조작 제안" });
  }

  /* ── 결과 재가공 ─────────────────────────────────────────────────────
     "이 결과를 표로 정리해줘" · "보고서 문장으로 만들어줘".

     ★ 새 수치를 만들지 않습니다. 직전 답에 이미 있는 값을 다른 모양으로
       옮길 뿐입니다. 그래서 이 도구는 조회를 다시 하지 않고, 넘겨받은
       결과만 씁니다 — 다시 조회하면 그 사이 값이 바뀌었을 때 원래 답과
       다른 숫자가 나오고, 사용자는 같은 것을 봤다고 생각합니다. */
  function formatResult(args, ctx) {
    const prev = (args && args.prevAnswer) || null;
    if (!prev) {
      return no("정리할 직전 결과가 없습니다. 먼저 무엇인가를 조회해 주세요.");
    }
    const style = (args && args.style) === "report" ? "report" : "table";
    const r = prev.answer || prev.data || {};
    const st = r.stats || null;
    const m = r.metric || null;

    if (style === "table") {
      const rows = [];
      if (st) {
        [["건수", st.n, "건"], ["평균", st.mean, m && m.unit],
         ["중앙값", st.median, m && m.unit], ["표준편차", st.sd, m && m.unit],
         ["최소", st.min, m && m.unit], ["최대", st.max, m && m.unit],
         ["CV", st.cv, "%"]].forEach(function (x) {
          if (typeof x[1] === "number" && isFinite(x[1])) {
            rows.push({ 항목: x[0], 값: fmtNum(x[1]) + (x[2] ? " " + x[2] : "") });
          }
        });
      }
      (r.facts || []).forEach(f => rows.push({ 항목: f.k, 값: String(f.v) }));
      if (!rows.length) return no("표로 정리할 수치가 직전 결과에 없습니다.");
      return ok({ kind: "formatted", style: "table",
                  title: (m ? m.label : "조회 결과") + " 정리", rows: rows,
                  scope: r.scopeLabel, source: r.source || null },
        { source: "직전 조회 결과 재구성", rows: rows.length });
    }

    /* 보고서 문장 — 값은 전부 직전 결과에서 가져옵니다 */
    if (!st || !m) {
      return no("보고서 문장으로 만들 통계가 직전 결과에 없습니다. " +
        "평균·분포를 먼저 조회해 주세요.");
    }
    const u = m.unit ? " " + m.unit : "";
    const sent =
      (r.scopeLabel && r.scopeLabel !== "전체" ? r.scopeLabel + " 범위의 " : "") +
      "배치 " + st.n + "건에 대한 " + m.label + " 측정 결과, " +
      "평균 " + fmtNum(st.mean) + u + " (표준편차 " + fmtNum(st.sd) + u +
      (typeof st.cv === "number" ? ", CV " + st.cv.toFixed(1) + "%" : "") + ")," +
      " 범위는 " + fmtNum(st.min) + u + "에서 " + fmtNum(st.max) + u + "이었다." +
      (r.note ? " " + r.note : "");
    return ok({ kind: "formatted", style: "report", title: m.label + " 보고 문장",
                text: sent, scope: r.scopeLabel, source: r.source || null },
      { source: "직전 조회 결과 재구성", rows: st.n });
  }

  function fmtNum(v) {
    if (typeof v !== "number" || !isFinite(v)) return "—";
    return Math.abs(v) >= 100 ? v.toFixed(1) : String(+v.toFixed(2));
  }

  /* ── 도구 명세 — Phase B 에서 그대로 tool 정의가 됩니다 ────────────── */
  const SPEC = [
    { name: "searchExperimentData", ko: "실험 데이터 조회",
      description: "사내 실험 데이터에서 조회·필터·집계·최고/최저·비교·추이를 수행합니다. 자연어 질문을 그대로 넘깁니다.",
      params: { question: "string" }, run: searchExperimentData },
    { name: "getExperiment", ko: "배치 상세",
      description: "배치 하나의 모든 기록된 값을 가져옵니다.",
      params: { batch: "string" }, run: getExperiment },
    { name: "calculateStatistics", ko: "통계 계산",
      description: "항목의 건수·평균·중앙값·표준편차·최소·최대·CV 를 실제 데이터에서 계산합니다.",
      params: { metric: "string" }, run: calculateStatistics },
    { name: "calculateCV", ko: "CV 계산",
      description: "변동계수(CV)를 계산합니다. calculateStatistics 와 같은 계산을 씁니다.",
      params: { metric: "string" }, run: calculateCV },
    { name: "compareExperiments", ko: "배치 비교",
      description: "두 배치를 항목별로 나란히 비교하거나, 과제·Study 축으로 비교합니다.",
      params: { a: "string", b: "string", metric: "string" }, run: compareExperiments },
    { name: "runDoE", ko: "DoE 설계",
      description: "현재 DoE 화면의 설계를 요약합니다. DoE 화면에서만 동작합니다.",
      params: {}, run: runDoE },
    { name: "runRegression", ko: "회귀분석",
      description: "현재 DoE 설계와 응답값으로 회귀모형을 적합합니다. DoE 화면에서만 동작합니다.",
      params: {}, run: runRegression },
    { name: "runANOVA", ko: "분산분석",
      description: "현재 DoE 모형의 분산분석표(Type I SS)를 만듭니다. DoE 화면에서만 동작합니다.",
      params: {}, run: runANOVA },
    { name: "optimizeExperiment", ko: "최적 조건",
      description: "현재 DoE 모형에서 응답을 최대/최소로 하는 조건을 찾습니다. DoE 화면에서만 동작합니다.",
      params: { goal: "max|min" }, run: optimizeExperiment },
    { name: "searchLiterature", ko: "문헌 검색",
      description: "Europe PMC · Crossref 에서 실제 논문을 검색합니다. 검색 결과에 없는 논문·DOI 는 만들지 않습니다.",
      params: { query: "string", limit: "number" }, run: searchLiterature, async: true },
    { name: "calculateProcess", ko: "공정 계산",
      description: "물질수지 · Feed · Seed · 희석 계산을 수행합니다.",
      params: { kind: "string", input: "object" }, run: calculateProcess },
    { name: "getCurrentPageContext", ko: "현재 화면",
      description: "사용자가 지금 보고 있는 페이지·필터·선택 상태를 돌려줍니다.",
      params: {}, run: getCurrentPageContext },
    { name: "proposeFilter", ko: "필터 제안",
      description: "화면 필터 변경을 제안합니다. 실행하지 않고 제안만 만듭니다.",
      params: { filter: "object" }, run: proposeFilter },
    { name: "proposeSort", ko: "정렬 제안",
      description: "표를 어떤 항목 기준으로 정렬할지 제안합니다. 실행하지 않고 제안만 만듭니다.",
      params: { metric: "string", order: "string" }, run: proposeSort },
    { name: "proposeSelect", ko: "배치 선택 제안",
      description: "특정 배치를 화면에서 선택하도록 제안합니다. 실행하지 않고 제안만 만듭니다.",
      params: { batch: "string" }, run: proposeSelect },
    { name: "formatResult", ko: "결과 정리",
      description: "직전 조회 결과를 표 또는 연구보고서 문장으로 다시 정리합니다. " +
        "새로 조회하거나 새 수치를 만들지 않고, 이미 나온 값만 옮깁니다.",
      params: { style: "string" }, run: formatResult }
  ];

  const BY_NAME = {};
  SPEC.forEach(s => { BY_NAME[s.name] = s; });

  /* 도구 하나 실행 — 항상 Promise 를 돌려줍니다 (비동기 도구가 섞여 있음) */
  function run(name, args, ctx) {
    const s = BY_NAME[name];
    if (!s) return Promise.resolve(no("알 수 없는 도구입니다: " + name));
    if (!window.AIContext.allows(name)) {
      return Promise.resolve(no(window.AIContext.whyNot(name)));
    }
    try {
      const out = s.run(args || {}, ctx || window.AIContext.get());
      return Promise.resolve(out);
    } catch (e) {
      return Promise.resolve(no("도구 실행 중 오류가 났습니다 — " +
        ((e && e.message) || "알 수 없는 오류")));
    }
  }

  /* Phase B 용 — Claude tool 정의로 변환 */
  function toolDefs() {
    return SPEC.filter(s => window.AIContext.allows(s.name)).map(function (s) {
      const props = {}; const required = [];
      Object.keys(s.params).forEach(function (k) {
        props[k] = { type: s.params[k] === "number" ? "number"
                   : s.params[k] === "object" ? "object" : "string" };
      });
      return { name: s.name, description: s.description,
               input_schema: { type: "object", properties: props,
                               required: required, additionalProperties: false },
               /* 인자가 스키마를 정확히 지키도록 — 프리필이 없는 모델에서
                  JSON 형태를 강제하는 문서화된 방법입니다 */
               strict: true };
    });
  }

  return { SPEC: SPEC, run: run, toolDefs: toolDefs, names: () => SPEC.map(s => s.name) };
})();
