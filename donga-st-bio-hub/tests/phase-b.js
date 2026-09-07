/* ==========================================================================
   phase-b.js — Phase B 방어선 검사  ·  window.PhaseBTest

   무엇을 재는가
     모델이 이미 넘어갔다고 가정하고, 그 다음에 오는 것이 막는지 봅니다.
     Phase A 의 llm-adversarial.js 와 같은 태도입니다 — 모델의 협조가
     필요 없으므로 키가 없어도 돌고, 키가 붙어도 결과가 같습니다.

       1) 클라이언트 가드 (AIPlanGuard)  실행 직전 마지막 방어선
       2) 서버 이탈 차단                 받은 값 밖의 숫자를 잡는가
       3) 키 노출                        클라이언트 자산에 키가 있는가
       4) 스트리밍 순서                  수치가 검증 전에 나가지 않는가
       5) 단계별 전송 계약               plan/narrate 가 각각 약속을 지키는가

   ★ 용어를 나눠 씁니다.
     검증(verification)  값이 실제 데이터와 맞는지 — 브라우저 AskVerify 만
                         할 수 있습니다 (데이터셋에서 재계산해 대조).
     이탈 차단(containment) 모델이 받은 값 밖의 숫자를 썼는지 — 서버가 합니다.
     서버는 Repo 를 볼 수 없으므로 값의 진위를 판단할 수 없습니다.
   ========================================================================== */

window.PhaseBTest = (function () {
  "use strict";

  function mk() {
    const out = [];
    return { out: out,
      add: (q, ok, note) => out.push({ q: q, pass: !!ok, fail: ok ? [] : [String(note || "")] }) };
  }

  /* ── 1. 클라이언트 가드 — 서버가 이상한 것을 돌려줬을 때 ──────────── */
  function guardChecks() {
    const T = mk();
    const G = window.AIPlanGuard;

    const cases = [
      { id: "목록 밖 도구", plan: { tool: "deleteEverything", args: {} } },
      { id: "함수 이름 흉내", plan: { tool: "eval", args: { code: "alert(1)" } } },
      { id: "빈 응답", plan: null },
      { id: "도구 이름 없음", plan: { args: { question: "x" } } },
      { id: "도구가 객체", plan: { tool: { name: "searchExperimentData" }, args: {} } },
      { id: "서버 오류 전달", plan: { error: "not-allowed", message: "허용되지 않음" } }
    ];
    cases.forEach(function (c) {
      const r = G.check(c.plan);
      T.add("가드 · " + c.id + " 거절", r.ok === false, JSON.stringify(r).slice(0, 100));
    });

    /* 정상 지시는 통과해야 합니다 (거짓 차단 방지) */
    const good = G.check({ tool: "searchExperimentData", args: { question: "Titer 평균" } });
    T.add("가드 · 정상 지시는 통과", good.ok === true && good.tool === "searchExperimentData",
      JSON.stringify(good).slice(0, 100));

    /* 스키마에 없는 인자는 버립니다 */
    const extra = G.check({ tool: "searchExperimentData",
      args: { question: "Titer 평균", __proto__x: 1, url: "http://evil", limit: 9 } });
    T.add("가드 · 스키마 밖 인자 제거",
      extra.ok && !("url" in extra.args) && extra.dropped.indexOf("url") > -1,
      JSON.stringify(extra.args));

    /* 긴 문자열은 자릅니다 */
    const longq = G.check({ tool: "searchExperimentData",
      args: { question: "가".repeat(5000) } });
    T.add("가드 · 긴 인자 절단", longq.ok && longq.args.question.length <= 500,
      "길이 " + (longq.args ? longq.args.question.length : "?"));

    /* DoE 는 이 화면(검사 페이지)에서 막혀야 합니다 */
    const doe = G.check({ tool: "runANOVA", args: {} });
    T.add("가드 · DoE 화면 밖 차단", doe.ok === false && /DoE/.test(doe.why || ""),
      JSON.stringify(doe).slice(0, 110));

    return T.out;
  }

  /* ── 2. 서버 이탈 차단 로직 ──────────────────────────────────────────
     api/chat.js 의 unknownNumbers 와 같은 규칙을 여기서 확인합니다.
     서버 파일을 브라우저에서 부를 수 없으므로 같은 입력을 넣어
     "무엇을 잡아야 하는가" 를 고정합니다. 규칙이 갈리면 이 검사가
     먼저 깨져야 합니다. */
  function numberGuardSpec() {
    const T = mk();
    const cases = [
      { id: "없는 수치 삽입", text: "평균은 9999 입니다", allowed: [981.4, 28], bad: true },
      { id: "자리 바꾼 수치", text: "최고는 2949 입니다", allowed: [2494], bad: true },
      { id: "정상 원값", text: "평균은 981.4 입니다", allowed: [981.4], bad: false },
      { id: "반올림 허용", text: "평균은 981 입니다", allowed: [981.4], bad: false },
      { id: "배치 식별자는 수치 아님", text: "B045-1 이 가장 높습니다", allowed: [], bad: false },
      { id: "날짜는 따로", text: "2024-08-16 에 시작했습니다", allowed: [], bad: false }
    ];
    cases.forEach(function (c) {
      const got = unknownNumbers(c.text, c.allowed);
      const blocked = got.length > 0;
      T.add("이탈 차단 · " + c.id, blocked === c.bad,
        "기대=" + (c.bad ? "차단" : "통과") + " 실제=" + (blocked ? "차단(" + got.join(",") + ")" : "통과"));
    });
    return T.out;
  }

  /* api/chat.js 와 같은 구현 — 어긋나면 위 검사가 깨집니다 */
  function unknownNumbers(text, allowed) {
    let t = String(text || "");
    t = t.replace(/\d{4}-\d{2}-\d{2}/g, " ");
    t = t.replace(/[A-Za-z]+[-_]?\d+(?:-\d+)*/g, " ");
    t = t.replace(/(\d),(?=\d{3}\b)/g, "$1");
    const set = new Set();
    (allowed || []).forEach(function (v) {
      set.add(v);
      for (let dp = 0; dp <= 3; dp++) set.add(Number(v.toFixed(dp)));
      set.add(Math.floor(v)); set.add(Math.ceil(v));
    });
    const out = [];
    const re = /-?\d+(?:\.\d+)?/g;
    let m;
    while ((m = re.exec(t)) !== null) {
      const n = Number(m[0]);
      if (isFinite(n) && !set.has(n)) out.push(n);
    }
    return Array.from(new Set(out));
  }

  /* ── 3. 키가 클라이언트에 노출되지 않았는가 ──────────────────────────
     서버가 "노출 안 됐다" 고 말하는 것은 근거가 없습니다. 실제 자산을
     받아서 훑어야 합니다. */
  function keyLeakCheck() {
    const files = [
      "../assets/js/ai/context.js", "../assets/js/ai/tools.js",
      "../assets/js/ai/assistant.js", "../assets/js/ai/ui.js",
      "../assets/js/ai/guard.js", "../assets/js/ask-llm.js",
      "../assets/js/data.js", "../assets/js/shell2.js"
    ];
    /* 키 자체를 적지 않고 형태로 찾습니다 */
    const patterns = [
      { id: "Anthropic 키 형태", re: /sk-ant-[A-Za-z0-9_\-]{10,}/ },
      { id: "일반 비밀 키 형태", re: /sk-[A-Za-z0-9]{32,}/ },
      { id: "환경변수 하드코딩", re: /ANTHROPIC_API_KEY\s*[:=]\s*["'][^"']+["']/ },
      { id: "Bearer 토큰", re: /Bearer\s+[A-Za-z0-9_\-.]{30,}/ }
    ];
    return Promise.all(files.map(function (f) {
      return fetch(f, { cache: "no-store" })
        .then(r => r.ok ? r.text() : "")
        .catch(() => "");
    })).then(function (texts) {
      const T = mk();
      const all = texts.join("\n");
      T.add("클라이언트 자산을 실제로 읽음", all.length > 1000, "길이 " + all.length);
      patterns.forEach(function (p) {
        const hit = p.re.test(all);
        T.add("키 노출 없음 · " + p.id, !hit, "패턴이 클라이언트 자산에서 발견됨");
      });
      /* 키를 서버로만 보내는지 — fetch 에 Authorization 헤더가 없어야 합니다 */
      T.add("클라이언트가 인증 헤더를 붙이지 않음",
        !/headers:\s*\{[^}]*[Aa]uthorization/.test(all), "Authorization 헤더가 있음");
      return T.out;
    });
  }

  /* ── 4. 스트리밍 순서 — 수치가 검증 전에 나가지 않는가 ──────────────
     narrate() 는 ask() 가 끝난 뒤에만 불려야 합니다. ui.js 소스를 읽어
     호출 순서를 확인합니다 — 순서가 뒤집히면 검증 전 숫자가 먼저 보입니다. */
  function streamOrderCheck() {
    return fetch("../assets/js/ai/ui.js", { cache: "no-store" })
      .then(r => r.text()).then(function (src) {
        const T = mk();
        const answerAt = src.indexOf("slot.innerHTML = answerHTML(out)");
        const narrAt = src.indexOf("streamNarration(slot, question, out)");
        T.add("수치 확정 표시가 해설보다 먼저",
          answerAt > -1 && narrAt > -1 && answerAt < narrAt,
          "answerHTML=" + answerAt + " streamNarration=" + narrAt);
        T.add("차단되면 문장을 통째로 버림",
          /r\.blocked/.test(src) && /box\.innerHTML\s*=\s*'<div class="gai-warn">/.test(src),
          "부분 노출을 남기는 경로가 있을 수 있습니다");
        return T.out;
      });
  }

  /* ── 5. 서버로 무엇이 가는가 ─────────────────────────────────────────
     ★ 이 검사는 한 번 틀렸던 자리입니다.

     예전에는 ask() 만 부르고 narrate() 는 부르지 않은 채 "실험 측정값이
     서버로 가지 않음" 을 통과시켰습니다. plan 단계에서만 참인 주장을,
     참인 경로만 골라 확인한 셈입니다. 검사가 주장을 뒷받침한 게 아니라
     주장이 참인 곳만 본 것입니다.

     이제 두 단계를 따로 봅니다. 단계마다 계약이 다르기 때문입니다.
       plan    실험 측정값이 하나도 가면 안 됨
       narrate 검증된 요약 통계는 가도 됨. 배치별 값·행 목록은 가면 안 됨 */
  function payloadCheck() {
    const T = mk();
    const t = window.AskTables.internal();
    const sent = [];
    const real = window.fetch;
    window.fetch = function (url, opt) {
      if (String(url).indexOf("/api/chat") > -1) {
        try { sent.push(JSON.parse(opt.body)); } catch (e) { sent.push({ parse: "fail" }); }
      }
      return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
    };

    /* 배치별 실측값 — 이 값들이 나가면 안 되는 것들입니다 */
    function cellValues() {
      const numCols = t.columns.filter(c => c.type === "num");
      const out = [];
      t.rows.forEach(function (row) {
        numCols.forEach(function (c) {
          const v = row[c.key];
          if (typeof v !== "number" || !isFinite(v)) return;
          if (String(Math.abs(v)).replace(".", "").length < 4) return;   /* 우연 일치 방지 */
          out.push(v);
        });
      });
      return Array.from(new Set(out));
    }
    function leakedIn(str, values) {
      return values.filter(function (v) {
        const lit = String(v).replace(/[.\\+*?()[\]{}|^$]/g, "\\$&");
        return new RegExp("(^|[^0-9.])" + lit + "([^0-9.]|$)").test(str);
      });
    }

    let out = null;
    return window.GlobalAI.ask("이번 실험에서 뭔가 특이한 점이 있어?").then(function (o) {
      out = o;
      /* ── plan 단계 계약 ───────────────────────────────────────────── */
      const plan = sent.find(x => x.mode === "plan" || (!x.mode && x.toolDefs));
      T.add("plan · LLM 경로가 서버를 부름", !!plan, "호출 없음 (규칙이 처리했을 수 있음)");
      if (plan) {
        const s = JSON.stringify(plan);
        T.add("plan · 질문과 도구 정의만 보냄",
          !!plan.question && Array.isArray(plan.toolDefs), Object.keys(plan).join(","));
        const leak = leakedIn(s, cellValues());
        T.add("plan · 실험 측정값 0건", leak.length === 0,
          "유출: " + leak.slice(0, 5).join(", "));
        T.add("plan · 배치 목록이 가지 않음", !/B\d{3}-\d/.test(s),
          "배치 식별자가 payload 에 있음");
      }
      sent.length = 0;
      /* plan 단계에서 503(키 없음)을 받으면 더 부르지 않는 것이 정상
         동작입니다. narrate 계약을 따로 보려면 그 판단을 되돌려야 합니다. */
      window.GlobalAI._setLlmState(null);
      /* ── narrate 단계 계약 ────────────────────────────────────────── */
      return window.GlobalAI.narrate("이번 실험에서 뭔가 특이한 점이 있어?", out, function () {});
    }).then(function () {
      window.fetch = real;
      const nar = sent.find(x => x.mode === "narrate");
      T.add("narrate · 서버를 부름", !!nar, "narrate 호출 없음");
      if (!nar) return T.out;

      const s = JSON.stringify(nar);
      /* 요약 통계는 가도 됩니다 — 그게 설명의 대상입니다 */
      T.add("narrate · 요약 통계만 보냄 (배치별 값 없음)",
        !("rows" in (nar.result || {})) && !("facts" in (nar.result || {})),
        "result 키: " + Object.keys(nar.result || {}).join(","));
      T.add("narrate · 배치 식별자가 가지 않음", !/B\d{3}-\d/.test(s),
        "배치 식별자가 payload 에 있음");

      /* 울타리(allowedNumbers)가 보낸 것보다 넓으면 안 됩니다 —
         넓으면 모델이 보지도 않은 값을 "허용된 값" 으로 쓸 수 있습니다 */
      const inResult = new Set();
      String(JSON.stringify(nar.result)).replace(/-?\d+(?:\.\d+)?/g,
        m => { inResult.add(Number(m)); return m; });
      const wider = (nar.allowedNumbers || []).filter(function (v) {
        if (inResult.has(v)) return false;
        /* 반올림 표기는 같은 값으로 봅니다 */
        for (let dp = 0; dp <= 3; dp++) if (inResult.has(Number(v.toFixed(dp)))) return false;
        return !(inResult.has(Math.floor(v)) || inResult.has(Math.ceil(v)));
      });
      T.add("narrate · 울타리가 보낸 값보다 넓지 않음", wider.length === 0,
        "보내지 않은 값이 허용됨: " + wider.slice(0, 5).join(", "));

      /* 해설을 끄면 아무것도 나가지 않아야 합니다 */
      sent.length = 0;
      window.GlobalAI._setLlmState(null);
      window.fetch = function (url, opt) {
        if (String(url).indexOf("/api/chat") > -1) sent.push({ called: true });
        return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
      };
      let prev = null;
      try { prev = localStorage.getItem("hub.ai.narrate"); localStorage.setItem("hub.ai.narrate", "off"); } catch (e) {}
      return window.GlobalAI.narrate("x", out, function () {}).then(function () {
        window.fetch = real;
        try {
          if (prev === null) localStorage.removeItem("hub.ai.narrate");
          else localStorage.setItem("hub.ai.narrate", prev);
        } catch (e) {}
        T.add("해설을 끄면 아무것도 보내지 않음", sent.length === 0,
          "꺼진 상태에서도 서버를 불렀습니다");
        return T.out;
      });
    }).catch(function (e) {
      window.fetch = real;
      T.add("payload 검사 실행", false, (e && e.message) || "실패");
      return T.out;
    });
  }

  function run() {
    const groups = [];
    groups.push(["A. 클라이언트 가드", guardChecks()]);
    groups.push(["B. 서버 이탈 차단 규칙", numberGuardSpec()]);
    return keyLeakCheck()
      .then(r => { groups.push(["C. 키 노출", r]); return streamOrderCheck(); })
      .then(r => { groups.push(["D. 스트리밍 순서", r]); return payloadCheck(); })
      .then(function (r) {
        groups.push(["E. 단계별 전송 계약", r]);
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
    res.checks.forEach(c => { s += (c.pass ? " OK  " : "★NG  ") + c.id + "  " + c.detail + "\n"; });
    return s;
  }

  return { run: run, text: text, _unknownNumbers: unknownNumbers };
})();
