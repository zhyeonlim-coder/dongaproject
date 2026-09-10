/* ==========================================================================
   ai/assistant.js — 질문 → 도구 선택 → 실행 → 검증 → 답변  ·  window.GlobalAI

   지금(Phase A)은 규칙이 도구를 고릅니다. 키가 붙으면(Phase B) 모델이
   고릅니다. 바뀌는 것은 route() 하나뿐이고, 실행·검증·표시는 그대로입니다.

     질문 ─→ route()  ─→ AITools.run() ─→ AskVerify ─→ 화면
             ↑ 여기만 Phase B 에서 교체

   ★ 검증되지 않은 숫자를 먼저 보여주지 않습니다.
     수치·표는 도구 실행과 검증이 끝난 뒤에 한 번에 확정 표시합니다.
     해설 문장만 나중에 흘려보냅니다(Phase B). 스트리밍 중에 틀린 숫자가
     잠깐이라도 보이면, 사용자는 그것을 이미 읽습니다.

   ★ 화면을 마음대로 바꾸지 않습니다.
     필터·정렬 같은 조작은 제안만 만들고 사용자가 버튼을 눌러야 실행합니다.
   ========================================================================== */

window.GlobalAI = (function () {
  "use strict";

  const MAX_TURNS = 3;          /* 맥락으로 넘기는 직전 대화 수 */
  const history = [];           /* [{ q, answer, carry, at }] */

  function has(text, t) { return String(text).toLowerCase().indexOf(String(t).toLowerCase()) > -1; }

  /* ── 도구 선택 (Phase A · 규칙) ──────────────────────────────────────
     엔진이 이미 15가지 의도를 읽습니다. 여기서는 "엔진 밖의 일" 만
     갈라내면 됩니다 — 문헌 · DoE · 공정계산 · 화면조작. 나머지는 전부
     엔진에게 넘깁니다. 엔진이 못 읽으면 엔진이 스스로 그렇게 답합니다. */
  const LIT_WORDS = ["논문", "문헌", "paper", "publication", "pubmed", "doi",
                     "저널", "journal", "학술", "레퍼런스", "reference"];
  const DOE_WORDS = ["anova", "분산분석", "회귀", "regression", "최적 조건", "최적조건",
                     "최적화", "optimi", "설계", "doe", "인자", "factor"];
  const CALC_WORDS = ["물질수지", "mass balance", "feed", "seed", "희석", "dilution"];
  const FILTER_WORDS = ["만 보여", "만 조회", "필터", "걸러"];
  const SORT_WORDS = ["정렬", "sort", "순으로", "순서대로", "높은 순", "낮은 순"];
  const SELECT_WORDS = ["선택해", "골라줘", "선택하", "지정해"];
  const FORMAT_WORDS = ["표로", "정리해", "정리 해", "보고서", "논문 스타일", "논문스타일",
                        "문장으로", "요약해 줘", "요약해줘"];
  const REPORT_WORDS = ["보고서", "논문", "문장으로", "서술"];

  /* 질문에서 항목 이름을 꺼냅니다 — 엔진의 별칭 사전을 그대로 씁니다.
     여기서 이름 목록을 다시 적으면 두 벌이 되고, 컬럼이 늘 때 한쪽만
     따라갑니다. */
  function metricFromText(t) {
    try {
      const table = window.AskTables.internal();
      const cols = window.AskEngine._detectMetrics
        ? window.AskEngine._detectMetrics(String(t).toLowerCase(), table) : [];
      if (cols && cols.length) return cols[0].label;
    } catch (e) { /* 엔진이 없는 화면 */ }
    return null;
  }
  /* 질문에서 배치명을 꺼냅니다 — 실제 존재하는 것만 */
  /* ★ 긴 배치명부터 봅니다. B123-1 과 B123-10 이 같이 있으면 짧은 쪽이
     먼저 걸려서, "B123-10 을 선택해 줘" 가 B123-1 선택으로 갔습니다.
     화면에는 [적용] 버튼과 함께 B123-1 이라고 적혀 나오므로 사용자가
     눈으로 잡을 수는 있지만, 물어본 것과 다른 배치를 제안하는 것은
     조용한 오답에 가깝습니다. */
  function batchFromText(t) {
    try {
      const table = window.AskTables.internal();
      const up = String(t).toUpperCase();
      const labels = table.rows.map(r => String(r.__label))
        .sort((a, b) => b.length - a.length);
      const hit = labels.find(function (lab) {
        const i = up.indexOf(lab.toUpperCase());
        if (i === -1) return false;
        /* 뒤에 숫자가 더 붙어 있으면 다른 배치의 앞부분을 문 것입니다 */
        return !/[0-9]/.test(up.charAt(i + lab.length));
      });
      return hit || null;
    } catch (e) { return null; }
  }

  /* ── 문헌 대화 상태 ──────────────────────────────────────────────────
     검색 결과 자체는 history 에 이미 있습니다. 여기서 따로 갖고 있는 것은
     "그 중 어느 논문을 가리키는가" 하나뿐입니다 — 결과를 복사해 두면
     history 와 어긋나서, 화면에 보이는 목록과 다른 논문을 답하게 됩니다. */
  let litFocusKey = null;
  /* 직전 문헌 검색 결과. history 는 MAX_TURNS 만큼만 남으므로 "검색 → 최신 →
     DOI → 주요 결과" 네 턴을 가면 원본 목록이 밀려 사라집니다. 대화가 아직
     문헌을 향해 있는 동안은 그 목록을 여기서 붙잡습니다 — ask.js 화면 검색과
     별개인, 봇이 자기가 받은 결과입니다. */
  let litCache = null;             /* { query, items } */

  function lastLiterature() {
    if (!litCache || !litCache.items || !litCache.items.length) return null;
    /* 사내 데이터 조회가 끼면 "그 논문" 의 대상이 흐려집니다 — 그때는 문맥을
       끊고 사내 조회 쪽으로 답합니다. */
    for (let i = history.length - 1; i >= 0; i--) {
      const a = history[i].answer;
      if (!a) continue;
      if (a.kind === "literature" || a.kind === "literature-one") break;
      if (a.kind === "formatted" || a.kind === "action-proposal" ||
          a.kind === "unsupported" || a.kind === "empty") continue;
      return null;
    }
    return { query: litCache.query, items: litCache.items, focusKey: litFocusKey };
  }
  function lastWasLiterature() { return !!lastLiterature(); }

  const CARRY_WORDS = ["그 중", "그중", "이 중", "그것", "그거", "그 논문", "이 논문",
    "그 결과", "방금", "아까", "그럼", "그러면", "다음으로", "나머지"];
  function looksLikeFollowUp(t) { return CARRY_WORDS.some(w => has(t, w)); }

  /* 문헌 후속 질문에서 무엇을 묻는지 — 없으면 null */
  function litAspect(t) {
    if (/doi/i.test(t)) return "doi";
    /* 서지 항목은 검색 결과에 그대로 들어 있습니다 — 저자·저널·발행연도.
       초록보다 먼저 봅니다. "저자가 누구야" 를 초록 요청으로 읽으면
       초록이 없는 논문에서 엉뚱하게 "확인할 수 없습니다" 가 나옵니다. */
    if (/저자|authors?|누가 (썼|쓴)|필자/.test(t)) return "authors";
    if (/저널|journal|학술지|어디에 실/.test(t)) return "journal";
    if (/발행|출판|연도|몇 년|언제 나온|published/.test(t)) return "published";
    if (/제목|title/.test(t)) return "title";
    if (/초록|abstract|주요\s*결과|결론|무슨 내용|어떤 내용|정리해|요약/.test(t)) return "abstract";
    if (/인용|cited|많이 인용/.test(t)) return "cited";
    if (/최신|최근|가장 새|제일 새|newest|latest/.test(t)) return "latest";
    /* 가장 오래된 것도 순위 질문입니다 — 최신의 반대편입니다 */
    if (/가장 오래|제일 오래|oldest|가장 예전/.test(t)) return "oldest";
    return null;
  }
  /* ── 문헌 후속인가, 새 검색인가 ───────────────────────────────────────
     "가장 최근 논문은?" 에도 "논문" 이 들어 있어서, 규칙만 보면 새 검색으로
     갑니다. 그러면 같은 질의라도 순위가 달라져 화면의 목록과 다른 논문을
     "그 논문" 이라고 답하게 됩니다.

     가르는 기준은 "새 주제어를 가져왔는가" 입니다. EGFR · HER2 처럼 라틴
     문자 토큰이 새로 나오면 새 검색으로 봅니다. 지금 질의에 이미 있는
     낱말이면 후속으로 봅니다 — "EGFR 논문 중 최신 것은?" 이 그렇습니다. */
  function litNewSubject(t, cache) {
    const q = String((cache && cache.query) || "").toLowerCase();
    const toks = String(t).match(/[A-Za-z][A-Za-z0-9\-]{1,}/g) || [];
    return toks.some(function (x) {
      const low = x.toLowerCase();
      if (low === "doi") return false;            /* 후속 질문에 자주 나오는 말 */
      return q.indexOf(low) === -1;
    });
  }
  function isLitFollowUp(t, cache) {
    if (!cache) return false;
    if (litNewSubject(t, cache)) return false;
    return !!(litAspect(t) || litIndex(t) || looksLikeFollowUp(t));
  }

  /* "세 번째 논문" · "2번 논문" — 목록에서 골라 달라는 말 */
  function litIndex(t) {
    /* 숫자를 먼저 통째로 읽습니다 — 한글 수사 표를 먼저 훑으면 "12번째" 의
       "2번째" 가 걸려 다른 논문을 가리킵니다. */
    const d = t.match(/(\d+)\s*(?:번째|번)/);
    if (d) return +d[1];
    const ko = [["첫", 1], ["둘|두", 2], ["셋|세", 3], ["넷|네", 4], ["다섯", 5]];
    for (let i = 0; i < ko.length; i++) {
      if (new RegExp("(" + ko[i][0] + ")\\s*(번째|번)").test(t)) return ko[i][1];
    }
    return null;
  }

  function route(q, ctx) {
    const t = String(q || "");

    if (LIT_WORDS.some(w => has(t, w))) {
      return { tool: "searchLiterature", args: { query: litQuery(t) } };
    }
    if (DOE_WORDS.some(w => has(t, w))) {
      if (has(t, "anova") || has(t, "분산분석")) return { tool: "runANOVA", args: {} };
      if (has(t, "최적")) return { tool: "optimizeExperiment", args: { goal: has(t, "낮") || has(t, "최소") ? "min" : "max" } };
      if (has(t, "회귀") || has(t, "regression")) return { tool: "runRegression", args: {} };
      /* "인자" · "설계" 만 나온 경우 — DoE 화면이면 설계 요약, 아니면
         데이터 조회로 보냅니다. 엉뚱하게 막지 않기 위해서입니다. */
      if (window.AIContext.allows("runDoE")) return { tool: "runDoE", args: {} };
    }
    if (CALC_WORDS.some(w => has(t, w))) {
      const kind = has(t, "물질수지") || has(t, "mass") ? "massBalance"
        : has(t, "feed") ? "feedVolume"
        : has(t, "seed") ? "seedVolume" : "dilution";
      return { tool: "calculateProcess", args: { kind: kind, input: {} } };
    }
    /* 결과 재가공 — 직전 답을 다른 모양으로. 새 조회가 아닙니다. */
    if (FORMAT_WORDS.some(w => has(t, w))) {
      /* "이 결과" 는 마지막 <b>조회</b> 결과를 가리킵니다.
         방금 표로 정리한 것을 다시 보고서로 바꿔 달라고 할 수 있는데,
         직전 항목만 보면 그때 "정리 결과" 를 원본으로 삼아 통계가 없다고
         답하게 됩니다. 재가공물은 건너뛰고 원본을 찾습니다. */
      let prev = null;
      for (let i = history.length - 1; i >= 0; i--) {
        const a = history[i].answer;
        if (a && a.kind !== "formatted" && a.kind !== "action-proposal") { prev = a; break; }
      }
      const style = REPORT_WORDS.some(w => has(t, w)) ? "report" : "table";
      return { tool: "formatResult", args: { style: style, prevAnswer: prev } };
    }
    /* 정렬 — 필터보다 먼저 봅니다. "정렬" 이 FILTER_WORDS 에도 있어서
       순서가 뒤바뀌면 정렬 요청이 필터 제안으로 갑니다. */
    if (SORT_WORDS.some(w => has(t, w))) {
      const m = metricFromText(t);
      if (m) {
        return { tool: "proposeSort",
                 args: { metric: m, order: /낮은|오름|작은|적은/.test(t) ? "asc" : "desc" } };
      }
    }
    if (SELECT_WORDS.some(w => has(t, w))) {
      const b = batchFromText(t);
      if (b) return { tool: "proposeSelect", args: { batch: b } };
    }
    if (FILTER_WORDS.some(w => has(t, w)) && window.Scope) {
      const patch = filterFromText(t);
      if (patch) return { tool: "proposeFilter", args: { filter: patch } };
    }
    return { tool: "searchExperimentData", args: { question: t } };
  }

  /* 문헌 질의어 — 한국어 조사와 요청 표현을 걷어냅니다 */
  function litQuery(t) {
    return String(t)
      .replace(/관련(된)?|에 (관한|대한)|논문|문헌|찾아\s*줘?|알려\s*줘?|검색(해)?\s*줘?|보여\s*줘?/g, " ")
      .replace(/\s+/g, " ").trim() || t;
  }

  /* "2025년 1월 데이터만 보여줘" → { from, to } */
  function filterFromText(t) {
    const m = String(t).match(/(20\d{2})\s*년\s*(\d{1,2})\s*월/);
    if (m) {
      const y = +m[1], mo = +m[2];
      if (mo < 1 || mo > 12) return null;
      const last = new Date(y, mo, 0).getDate();
      const p = n => String(n).padStart(2, "0");
      return { from: y + "-" + p(mo) + "-01", to: y + "-" + p(mo) + "-" + p(last) };
    }
    return null;
  }

  /* ── LLM 경로 (Phase B) ──────────────────────────────────────────────
     규칙이 먼저입니다. 규칙이 확실히 읽은 질문은 LLM 을 부르지 않습니다 —
     빠르고, 공짜이고, 이미 검증된 경로이기 때문입니다.

     LLM 을 부르는 것은 규칙이 놓쳤을 때뿐입니다. 그때도 LLM 이 하는 일은
     "어떤 도구를 어떤 인자로" 하나이고, 조회·계산·검증은 그대로 브라우저가
     합니다. 모델은 데이터를 본 적이 없어 수치를 지어낼 재료가 없습니다. */
  let llmAvailable = null;        /* null=모름, false=키 없음(더 안 부름) */

  /* ── 외부 AI 해설 스위치 ─────────────────────────────────────────────
     기본 꺼짐. "on" 이라고 적혀 있을 때만 켜집니다.
     읽기에 실패해도 꺼진 쪽입니다 — 모르면 안 보냅니다. */
  const NARRATE_KEY = "hub.ai.narrate";
  function narrateEnabled() {
    try { return localStorage.getItem(NARRATE_KEY) === "on"; }
    catch (e) { return false; }
  }
  function setNarrate(on) {
    try {
      if (on) localStorage.setItem(NARRATE_KEY, "on");
      else localStorage.removeItem(NARRATE_KEY);
    } catch (e) { /* 저장소가 막힌 환경 — 꺼진 상태로 남습니다 */ }
    return narrateEnabled();
  }

  function ruleMissed(question, plan) {
    if (plan.tool !== "searchExperimentData") return false;
    try {
      const t = window.AskTables.internal();
      const r = window.AskEngine.answer(question, { table: t });
      if (r.kind === "overview" || r.kind === "clarify") return true;
      if ((r.unhandled || []).some(u => /읽지 못해|찾지 못했습니다/.test(u))) return true;
      return false;
    } catch (e) { return false; }
  }

  function askServer(question, ctx) {
    if (llmAvailable === false) return Promise.resolve(null);
    const ctl = ("AbortController" in window) ? new AbortController() : null;
    const timer = setTimeout(() => ctl && ctl.abort(), 12000);
    return fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctl ? ctl.signal : undefined,
      body: JSON.stringify({
        mode: "plan", question: question,
        context: {
          pageKo: ctx.pageKo, section: ctx.section,
          describe: window.AIContext.describe(),
          doe: ctx.doe ? { hasPlan: ctx.doe.hasPlan, runs: ctx.doe.runs,
                           filled: ctx.doe.filled } : null
        },
        toolDefs: window.AITools.toolDefs(),
        history: history.slice(-3).map(h => ({ q: h.q }))
      })
    }).then(function (r) {
      clearTimeout(timer);
      if (r.status === 503) { llmAvailable = false; return null; }
      if (!r.ok) return null;
      return r.json();
    }).then(function (j) {
      if (!j) return null;
      llmAvailable = true;
      /* ★ 실행 직전 마지막 방어선 — 서버 allowlist 와 별개로 한 번 더 */
      const g = window.AIPlanGuard.check(j);
      return g.ok ? { tool: g.tool, args: g.args, via: "llm" } : null;
    }).catch(function () {
      clearTimeout(timer);
      return null;      /* 실패하면 규칙 경로가 이어받습니다 */
    });
  }

  /* ── 실행 ────────────────────────────────────────────────────────────
     반환은 화면이 그대로 그릴 수 있는 모양입니다. 수치는 이 시점에 이미
     검증을 통과했습니다 — 화면은 검증 여부를 다시 따지지 않아도 됩니다. */
  /* onStage(info) — 어느 도구를 어떤 경로로 부르는지 화면에 알려 줍니다.
     화면이 직접 route() 를 다시 부르면 실제로 실행되는 도구와 어긋납니다
     (문헌 후속처럼 여기서 계획을 바꾸는 경우가 있습니다). */
  function ask(q, onStage) {
    const stage = typeof onStage === "function" ? onStage : function () {};
    const question = String(q || "").trim();
    if (!question) {
      return Promise.resolve({ kind: "empty",
        headline: "무엇이 궁금하신지 적어 주세요.",
        suggestions: suggestions() });
    }

    const ctx = window.AIContext.get();
    const rulePlan = route(question, ctx);

    /* ★ 직전 답이 문헌 목록이었는데 "그 중 최신 것은?" 처럼 이어 물으면,
       규칙은 그 말에서 문헌 신호를 못 찾아 사내 배치 데이터 조회로 보냈고
       화면에는 논문 대신 배치 28건이 나왔습니다. 사용자는 논문 목록을 보고
       물었으므로 그 표를 논문의 답으로 읽습니다. 그래서 문헌 문맥이 살아
       있는 동안에는 후속 질문을 문헌 쪽으로 돌립니다 — 다시 검색하지 않고
       그때 받은 목록 안에서만 답합니다. */
    const lit = lastLiterature();
    if (lit && isLitFollowUp(question, lit) &&
        (rulePlan.tool === "searchExperimentData" || rulePlan.tool === "searchLiterature")) {
      const idx = litIndex(question);
      const asp = litAspect(question);
      rulePlan.tool = "literatureFollowUp";
      rulePlan.args = idx && !asp
        ? { aspect: "select", index: idx }
        : { aspect: asp || (litFocusKey ? "abstract" : "latest"), index: idx || null };
    }

    const started = Date.now();
    const koOf = n => ((window.AITools.SPEC.find(s => s.name === n) || {}).ko || n);

    const willAsk = ruleMissed(question, rulePlan);
    if (willAsk) stage({ stage: "llm", tool: null, ko: null, via: "llm" });
    else stage({ stage: "tool", tool: rulePlan.tool, ko: koOf(rulePlan.tool), via: "rule" });

    const decide = willAsk
      ? askServer(question, ctx).then(p => (p && p.tool) ? p : rulePlan)
      : Promise.resolve(rulePlan);

    return decide.then(function (plan) {
      if (willAsk) {
        stage({ stage: "tool", tool: plan.tool, ko: koOf(plan.tool),
                via: plan.via || "rule" });
      }
      return window.AITools.run(plan.tool, Object.assign({}, plan.args, {
        prev: history.length ? history[history.length - 1].carry : null,
        /* 문헌 후속 도구는 직전 검색 결과를 그대로 받습니다 — 다시 검색하면
           같은 질의라도 순위가 달라져 화면의 목록과 다른 논문을 답합니다. */
        lit: plan.tool === "literatureFollowUp" ? lit : null
      }), ctx).then(function (res) {
        const out = shape(question, plan, res, ctx, Date.now() - started);
        out.via = plan.via || "rule";
        remember(question, out, res);
        log(question, plan, res, Date.now() - started, out.via);
        return out;
      });
    }).catch(function (e) {
      return { kind: "error", tool: rulePlan.tool,
        headline: "답변을 만들지 못했습니다 — " + ((e && e.message) || "알 수 없는 오류"),
        note: "이 오류는 AI 기능에만 영향을 줍니다. 화면의 다른 기능은 그대로 쓰실 수 있습니다.",
        suggestions: suggestions() };
    });
  }

  /* ── 해설 스트리밍 (B-4) ─────────────────────────────────────────────
     ★ 수치는 이 함수가 불리기 전에 이미 확정·검증돼 화면에 그려져
       있습니다. 여기서 흐르는 것은 설명 문장뿐입니다.

     서버가 문장을 막으면(근거 없는 수치) 아무것도 남기지 않습니다 —
     반쯤 나온 문장을 두면 그게 곧 검증 안 된 답이 됩니다. */
  function narrate(question, out, onDelta) {
    if (llmAvailable === false) return Promise.resolve(null);
    /* ★ 기본값은 꺼짐입니다. 켜는 것은 명시적 선택(opt-in)입니다.

       해설을 만들려면 무엇을 설명할지 모델에게 알려야 하고, 그 순간
       측정에서 나온 수치(min·max·평균 등)가 외부로 나갑니다. 그건
       기능 문제가 아니라 데이터 반출 결정이라, 사용자가 모르는 채로
       켜져 있으면 안 됩니다.

       꺼져 있어도 나머지는 전부 그대로입니다 — 조회 · 도구 · 통계 ·
       DoE · 검증 · 근거 표시 · 화면 제안. 꺼지는 것은 해설 문단 하나뿐입니다.

         켜기: localStorage.setItem("hub.ai.narrate", "on")
       저장소를 못 읽는 환경에서도 꺼진 쪽으로 갑니다 — 모르면 안 보내는
       것이 맞는 기본값입니다. */
    if (!narrateEnabled()) return Promise.resolve(null);
    return fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "narrate", question: question,
        result: slimResult(out), allowedNumbers: collectNumbers(out)
      })
    }).then(function (r) {
      if (r.status === 503) { llmAvailable = false; return null; }
      if (!r.ok || !r.body) return null;
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "", text = "", blocked = null;
      function pump() {
        return reader.read().then(function (c) {
          if (c.done) return blocked ? { blocked: blocked } : { text: text };
          buf += dec.decode(c.value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop();
          parts.forEach(function (chunk) {
            const ev = (chunk.match(/^event: (.+)$/m) || [])[1];
            const dl = (chunk.match(/^data: (.+)$/m) || [])[1];
            if (!ev || !dl) return;
            let d; try { d = JSON.parse(dl); } catch (e) { return; }
            if (ev === "delta") { text += d.text; if (onDelta) onDelta(d.text); }
            else if (ev === "blocked" || ev === "error") blocked = d;
          });
          return pump();
        });
      }
      return pump();
    }).catch(function () { return null; });
  }

  /* ── 모델이 문장에 쓸 수 있는 수치 ───────────────────────────────────
     ★ 이것은 "검증 기준" 이 아니라 "울타리" 입니다.

     이 목록은 이미 AskVerify 를 통과한 결과에서 뽑습니다. 서버는 이
     목록 밖의 숫자가 문장에 있는지만 봅니다 — 목록 안의 숫자가 옳은지는
     서버가 판단할 수 없고, 판단할 필요도 없습니다. 그건 AskVerify 가
     데이터셋에서 다시 계산해 이미 확인했습니다.

     보내는 결과(slimResult)에 없는 값은 여기에도 넣지 않습니다.
     울타리가 보낸 것보다 넓으면, 모델이 보지도 않은 값을 "허용된 값"
     으로 쓸 수 있게 됩니다. */
  function collectNumbers(out) {
    const nums = [];
    const push = v => { if (typeof v === "number" && isFinite(v)) nums.push(v); };
    const grab = s => String(s == null ? "" : s)
      .replace(/-?\d+(?:\.\d+)?/g, m => { push(Number(m)); return m; });
    const r = (out && (out.answer || out.data)) || {};
    if (r.stats) ["n", "mean", "median", "sd", "min", "max", "cv"].forEach(k => push(r.stats[k]));
    push(r.scopeRows);
    push((r.rows || []).length);
    grab(r.headline);
    grab(r.note);
    return Array.from(new Set(nums)).slice(0, 200);
  }

  /* ── 서버로 나가는 결과 ──────────────────────────────────────────────
     ★ 여기서 나가는 것은 실제 측정에서 나온 수치입니다.
       "데이터를 서버로 보내지 않는다" 는 plan 단계에만 참이고, 이 단계에는
       해당하지 않습니다. 그러니 최소한만 보냅니다.

     행 단위 값(rows)과 항목별 값(facts)은 보내지 않습니다. 2~4문장짜리
     설명을 쓰는 데 배치별 개별 측정값은 필요 없고, 표는 이미 사용자
     화면에 검증된 채로 그려져 있습니다. 요약 통계만으로 충분합니다.

     보내는 것: 문장 · 요약 통계 · 항목 이름/단위 · 주의 문구 · 범위 건수
     안 보내는 것: 배치별 값 · 배치 목록 · 원본 행 */
  function slimResult(out) {
    const r = (out && (out.answer || out.data)) || {};
    return {
      kind: out.kind,
      headline: r.headline,
      stats: r.stats || null,
      metric: r.metric || null,
      note: r.note || "",
      scopeLabel: r.scopeLabel,
      scopeRows: r.scopeRows,
      unhandled: r.unhandled || [],
      /* 표에 몇 행이 있는지만 — 값은 보내지 않습니다 */
      rowCount: (r.rows || []).length
    };
  }

  /* 도구 결과를 화면이 쓰는 모양으로 */
  function shape(question, plan, res, ctx, ms) {
    if (!res.ok) {
      return { kind: "no-data", tool: plan.tool, question: question,
        headline: res.error, meta: res.meta, ms: ms,
        suggestions: suggestions() };
    }
    const d = res.data;

    /* 엔진 응답은 이미 완성된 답입니다 — 그대로 씁니다 */
    if (plan.tool === "searchExperimentData" || plan.tool === "getExperiment" ||
        plan.tool === "calculateStatistics" || plan.tool === "calculateCV") {
      return { kind: "engine", tool: plan.tool, question: question, answer: d,
        meta: res.meta, ms: ms, contextUsed: window.AIContext.describe() };
    }
    return { kind: d.kind || plan.tool, tool: plan.tool, question: question,
      data: d, meta: res.meta, ms: ms, contextUsed: window.AIContext.describe() };
  }

  /* ── 이어지는 질문 ───────────────────────────────────────────────────
     "그 실험의 Yield 는?" 의 "그" 를 풀려면 직전 답이 무엇을 지목했는지
     알아야 합니다. 엔진이 carry 에 그것을 담아 줍니다. */
  /* ★ 엔진은 prev 를 { carry, question } 모양으로 받습니다 (ask.js 와 같은
     계약입니다). 여기서 carry 객체를 그대로 넘기면 엔진 쪽 o.prev.carry 가
     undefined 가 되어 승계가 조용히 꺼집니다 — "그 조건의 Titer 는?" 이
     전체 28건을 되돌려 주고 있었습니다. 되돌아온 값이 그럴듯해서 화면만
     봐서는 승계가 안 됐다는 것을 알 수 없었습니다. */
  function remember(q, out, res) {
    const carry = out.answer && out.answer.carry
      ? { carry: out.answer.carry, question: q } : null;

    /* 어느 논문을 가리키는지 갱신합니다. 새 검색이 오면 지목은 풀립니다 —
       앞 검색의 논문을 새 목록의 "그 논문" 으로 계속 가리키면 안 됩니다. */
    if (out.kind === "literature") {
      litCache = { query: out.data.query, items: out.data.items || [] };
      litFocusKey = null;
    } else if (out.data && out.data.litFocus) {
      litFocusKey = out.data.litFocus;
    }

    history.push({ q: q, answer: out, carry: carry, at: Date.now() });
    while (history.length > MAX_TURNS) history.shift();
  }
  function reset() { history.length = 0; litFocusKey = null; litCache = null; }

  /* ── 진단 기록 ────────────────────────────────────────────────────────
     운영에서 "왜 이 답이 나왔는가" 를 되짚을 수 있어야 합니다. 다만
     되짚기 위해 남기는 것이 사고의 원인이 되면 안 됩니다.

     남기는 것   요청 id · 화면 · 의도 · 도구 · 성공여부 · 경로 · 소요시간 ·
                 오류 분류 · 결과 행 수
     남기지 않는 것  API key · 측정값 · 표 내용 · 개인정보 · 오류 원문

     오류는 분류만 적습니다. 원문에는 URL·경로·응답 조각이 섞여 들어옵니다. */
  let seq = 0;
  const trace = [];               /* 최근 진단 기록 (메모리에만) */
  const TRACE_MAX = 50;

  function errCategory(res) {
    if (!res || res.ok !== false) return null;
    const e = String(res.error || "");
    if (/모듈이 로드되지|준비되지 않았/.test(e)) return "module-missing";
    if (/네트워크|요청 실패|응답이 .*초/.test(e)) return "network";
    if (/신뢰할 수 없어/.test(e)) return "bad-tool-shape";
    if (/화면에는|이 화면에서는|없습니다\.$/.test(e)) return "not-available-here";
    if (/찾지 못|없습니다/.test(e)) return "no-data";
    if (/오류가 났습니다/.test(e)) return "tool-threw";
    return "other";
  }

  function log(q, plan, res, ms, via) {
    const rec = {
      id: "gai-" + Date.now().toString(36) + "-" + (++seq),
      at: Date.now(),
      page: (function () { try { return window.AIContext.get().page; } catch (e) { return null; } })(),
      intent: plan.tool,          /* 규칙·모델이 고른 도구가 곧 의도입니다 */
      tool: plan.tool,
      providerPath: via || "rule",
      ok: !!(res && res.ok),
      errorCategory: errCategory(res),
      rows: (res && res.meta && res.meta.rows != null) ? res.meta.rows : null,
      ms: ms,
      qLen: String(q || "").length   /* 질문 길이만 — 문장은 남기지 않습니다 */
    };
    trace.push(rec);
    while (trace.length > TRACE_MAX) trace.shift();

    if (!window.AskLog || !window.AskLog.record) return;
    try {
      window.AskLog.record({
        question: q, path: "global-ai", kind: plan.tool,
        intent: plan.tool, rows: res.meta && res.meta.rows,
        confidence: null, ms: ms,
        rejected: res.ok ? [] : [String(res.error).slice(0, 80)]
      });
    } catch (e) { /* 로그 실패가 답변을 막지 않습니다 */ }
  }

  /* ── 화면별 추천 질문 ────────────────────────────────────────────────
     문구를 손으로 적지 않습니다. 데이터가 바뀌면 없는 컬럼을 추천하게
     되기 때문입니다 — 실제 컬럼과 배치에서 만듭니다. */
  function suggestions() {
    const c = window.AIContext.get();
    const page = c.page;
    let cols = [], batch = null;
    try {
      const t = window.AskTables.internal();
      cols = t.columns.filter(x => x.type === "num" && !x.generated).map(x => x.label);
      batch = t.rows.length ? t.rows[0].__label : null;
    } catch (e) { /* 데이터 계층이 없는 화면 */ }
    const m1 = cols[0] || "Titer HCCF", m2 = cols[1] || "Max VCD";

    if (page === "hub" && c.section === "doe") {
      return ["ANOVA 결과 설명해줘", "최적 조건 찾아줘",
              "어느 인자가 가장 영향이 커?", "회귀모형 설명해줘"];
    }
    if (page === "hub" && c.section === "lit") {
      return ["EGFR 관련 최근 논문 찾아줘", "이 주제와 비슷한 논문은?",
              "2024년 이후 논문만", "DOI 정리해줘"];
    }
    if (page === "data") {
      return [m1 + " 가장 높은 배치는?", m1 + " 평균이랑 편차",
              "미입력이 가장 많은 항목은?", "과제별 " + m1 + " 비교"];
    }
    if (page === "ebr") {
      return [(batch || "B045-1") + " 알려줘", m1 + " 아직 안 들어온 배치",
              m2 + " 평균", "이 배치가 어느 과제야?"];
    }
    if (page === "schedule" || page === "booking") {
      return ["최근에 시작한 배치는?", m1 + " 평균", "배치 수 알려줘",
              "언제 harvest 했지"];
    }
    return [m1 + " 가장 높은 배치는?", m1 + " 평균이랑 편차",
            "배치 수 알려줘", "미입력이 가장 많은 항목은?"];
  }

  /* ── 제안한 화면 조작을 실제로 적용 ─────────────────────────────────
     사용자가 버튼을 눌렀을 때만 여기 들어옵니다. */
  function applyAction(proposal) {
    if (!proposal || !proposal.action) return { ok: false, why: "적용할 수 없는 제안입니다." };

    if (proposal.action === "filter") {
      if (!window.Scope || !window.Scope.setFilter) return { ok: false, why: "이 화면에는 필터가 없습니다." };
      try { window.Scope.setFilter(proposal.patch); return { ok: true }; }
      catch (e) { return { ok: false, why: "필터를 적용하지 못했습니다." }; }
    }

    if (proposal.action === "sort") {
      /* 화면이 정렬 훅을 등록해 두었을 때만 됩니다. 없는 화면에서
         억지로 DOM 을 만지지 않습니다 — 화면마다 표 구조가 달라서
         한 곳에서 흉내 내면 언젠가 엉뚱한 표를 건드립니다. */
      const h = window.AIContext.hook("sort");
      if (!h) return { ok: false, why: "이 화면에서는 정렬을 대신 적용할 수 없습니다. 표 머리글을 눌러 주세요." };
      try { h(proposal.patch); return { ok: true }; }
      catch (e) { return { ok: false, why: "정렬을 적용하지 못했습니다 — " +
        ((e && e.message) || "알 수 없는 이유") + "." }; }
    }

    if (proposal.action === "select") {
      const h = window.AIContext.hook("select");
      if (!h) return { ok: false, why: "이 화면에서는 배치를 대신 선택할 수 없습니다." };
      try { h(proposal.patch); return { ok: true }; }
      catch (e) { return { ok: false, why: "선택하지 못했습니다 — " +
        ((e && e.message) || "알 수 없는 이유") + "." }; }
    }

    return { ok: false, why: "알 수 없는 동작입니다: " + proposal.action };
  }

  /* 봇의 문헌 대화 상태를 AIContext 표준 자리에 올립니다. 값을 복사해
     넘기지 않고 함수를 넘겨, 물어볼 때마다 지금 상태를 읽게 합니다. */
  if (window.AIContext && window.AIContext.provide) {
    window.AIContext.provide("aiLiterature", function () {
      if (!litCache) return null;
      const sel = litFocusKey
        ? (litCache.items || []).find(p => p.key === litFocusKey) || null : null;
      return { query: litCache.query, items: litCache.items || [], selected: sel };
    });
  }

  return { ask: ask, reset: reset, suggestions: suggestions, narrate: narrate,
           applyAction: applyAction, history: () => history.slice(),
           llmState: () => llmAvailable,
           narrateEnabled: narrateEnabled, setNarrate: setNarrate,
           /* 검사용 — 503(키 없음)을 한 번 받으면 더 부르지 않는 것이
              정상 동작이라, 단계별 계약을 따로 보려면 되돌릴 수 있어야
              합니다. 제품 코드에서는 부르지 않습니다. */
           _setLlmState: v => { llmAvailable = v; },
           /* 운영 진단 — 최근 요청의 경로와 결과만. 질문 문장·측정값은
              들어 있지 않습니다. */
           trace: () => trace.slice(),
           _route: route, _filterFromText: filterFromText, _litQuery: litQuery,
           _collectNumbers: collectNumbers, _slimResult: slimResult,
           _ruleMissed: ruleMissed };
})();
