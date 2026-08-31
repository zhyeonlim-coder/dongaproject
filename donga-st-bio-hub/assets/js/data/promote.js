/* ==========================================================================
   promote.js — 자가 개선 루프  ·  window.Promote

   루프가 닫히려면 네 가지가 다 있어야 합니다.

     1) 추출 — LLM 이 해석에 성공한 질문에서, 규칙이 놓친 어휘를 찾는다
     2) 안전 — 그 어휘를 넣으면 기존 해석이 깨지는지 먼저 확인한다
     3) 반영 — 승인하면 RuleLex 에 들어가 다음부터 규칙이 처리한다
     4) 측정 — 규칙 경로 비율이 실제로 올라갔는지 본다

   4가 없으면 루프가 도는지 알 수 없고, 2가 없으면 돌수록 망가집니다.

   어휘 추출 방식
     사전에 넣을 말을 사람이 고르지 않습니다. 질문에서 후보 조각을 만든 뒤,
     "이 조각을 사전에 넣으면 detectIntent 가 LLM 이 말한 의도로 바뀌는가"
     를 실제로 돌려 봅니다. 바뀌는 것 중 가장 짧고, 다른 미해결 질문도 함께
     해결하는 것을 고릅니다. 추측이 아니라 실행으로 고르는 것입니다.
   ========================================================================== */

window.Promote = (function () {
  "use strict";

  /* ── 승격 안전장치: 이것들이 깨지면 승격을 막습니다 ──────────────────
     회귀 스위트 전체를 관리자 화면에서 돌릴 수는 없으므로(테스트 파일은
     배포에 포함하지 않습니다), 의도 판정에 가장 민감한 핵심만 여기 둡니다.
     tests/ask-regression.js 가 이 배열을 그대로 검사군 M 으로 돌립니다 —
     두 곳이 같은 코드를 보므로 조용히 어긋날 수 없습니다. */
  const CORE_SPEC = [
    { q: "수율이 가장 높은 Batch는?", intent: "max", kind: "extreme" },
    { q: "역가 제일 높은 거", intent: "max", kind: "extreme" },
    { q: "HCP 제일 낮은 조건이 뭐였지", intent: "min" },
    { q: "생존율 평균이랑 편차", intent: "stat", kind: "stat" },
    { q: "정제 수율 평균이 얼마나 돼", intent: "stat" },
    { q: "과제별 Total Yield 비교", intent: "compare", kind: "compare" },
    { q: "일자별 Titer 추이", intent: "trend", kind: "trend" },
    { q: "미입력이 가장 많은 항목은?", intent: "missing", kind: "missing" },
    { q: "DA-1234 배치 몇 개야", intent: "count" },
    { q: "무슨 데이터 있어?", kind: "meta" },
    { q: "뭘 물어볼 수 있어?", kind: "help" },
    { q: "B045-2가 어느 과제 거야?", kind: "entity", rows: 1 },
    { q: "B045-2 정제 결과 보여줘", kind: "group", rows: 1 },
    { q: "정제팀 데이터 보여줘", kind: "group", rows: 28 },
    /* kind 까지 봅니다. rows 만 보면 의도가 바뀌어도(list → count) 통과해
       버려서, 위험한 승격을 막지 못합니다 — 실제로 그 구멍이 있었습니다. */
    { q: "Titer 1000 이상인 배치", rows: 15, kind: "list", intent: "list" },
    { q: "Titer 상위 5개", applied: /상위 5/, kind: "list", intent: "list" },
    { q: "Titer 기록된 배치", kind: "list", intent: "list" },
    { q: "Titer 3 이상인 배치", kind: "clarify" },
    { q: "2024년 12월 Titer 평균", rows: 11 },
    { q: "11월 배치 Titer", rows: 5 },
    { q: "최근 3개월 Titer 평균", rows: 26 },
    { q: "미디어 스크리닝 결과", scope: "Media screening test", rows: 6 },
    { q: "지난달 Titer 평균", unhandled: /지난달/ },
    { q: "10일차 Titer 알려줘", unhandled: /D10/ },
    { q: "배지 뭐가 제일 좋았어?", intent: "max", kind: "extreme" },
    { q: "Titer 평균", rows: 28 }
  ];

  function checkOne(r, c) {
    const fail = [];
    if (c.intent && r.intent !== c.intent) fail.push(c.q + ": intent=" + r.intent + " 기대=" + c.intent);
    if (c.kind && r.kind !== c.kind) fail.push(c.q + ": kind=" + r.kind + " 기대=" + c.kind);
    if (typeof c.rows === "number" && r.scopeRows !== c.rows) fail.push(c.q + ": rows=" + r.scopeRows + " 기대=" + c.rows);
    if (c.scope && r.scopeLabel !== c.scope) fail.push(c.q + ": scope=" + r.scopeLabel + " 기대=" + c.scope);
    if (c.applied && !c.applied.test((r.applied || []).join(" "))) fail.push(c.q + ": 해석 조건 없음");
    if (c.unhandled && !c.unhandled.test((r.unhandled || []).join(" "))) fail.push(c.q + ": 미처리 표시 없음");
    return fail;
  }

  /* 현재 사전 상태로 핵심 스펙을 통과하는가 */
  function safetyCheck(table) {
    const t = table || window.AskTables.internal();
    const E = window.AskEngine;
    const fails = [];
    CORE_SPEC.forEach(function (c) {
      let r;
      try { r = E.answer(c.q, { table: t }); }
      catch (e) { fails.push(c.q + ": 예외 " + e.message); return; }
      checkOne(r, c).forEach(f => fails.push(f));
    });
    return { ok: !fails.length, fails: fails, total: CORE_SPEC.length };
  }

  /* 어휘를 임시로 넣고 스펙이 깨지는지 봅니다. 반드시 원상 복구합니다. */
  function dryRun(entry, table) {
    const L = window.RuleLex;
    const added = L.add(Object.assign({}, entry, { source: entry.source || "(dry-run)", temp: true }));
    let res;
    try { res = safetyCheck(table); }
    finally { L.revert(added.id, "dry-run"); }
    return res;
  }

  /* ── 후보 조각 만들기 ────────────────────────────────────────────────
     질문을 어절로 자르고, 어절 하나와 인접한 두 어절을 후보로 둡니다.
     끝에 붙는 조사·어미는 떼어 냅니다 — "좋았어?" 의 "?" 나 "은/는" 이
     붙은 채로 사전에 들어가면 다른 문장에서는 안 걸립니다. */
  const TAIL = /(은가|는가|나요|가요|인가|였지|았어|었어|해줘|해주라|주라|줘|야|어|지|네|까|나|요|은|는|이|가|을|를|도|만|의|에|와|과|랑|이랑)$/;
  const STOP = ["데이터", "배치", "결과", "값", "항목", "알려", "보여", "뭐", "뭔", "어떤", "무슨", "좀", "그", "이", "저"];

  /* 항목 이름 · 과제 · Study · 배치 이름은 의도 트리거가 될 수 없습니다.
     "수율" 을 max 트리거로 승격하면 "수율 평균" 도 최고값으로 읽힙니다 —
     안전 검사만으로는 안 걸리는 종류의 잘못이라 후보 단계에서 막습니다. */
  function isEntityWord(v) {
    const E = window.AskEngine;
    const A = (E && E.ALIAS) || {};
    let hit = false;
    Object.keys(A).forEach(function (k) {
      A[k].forEach(function (a) {
        if (a.length >= 2 && (v === a || v.indexOf(a) > -1 || a.indexOf(v) > -1)) hit = true;
      });
    });
    if (hit) return true;
    const names = []
      .concat((window.DATA_PROJECTS || []).map(p => String(p.code || "").toLowerCase()))
      .concat((window.DATA_STUDIES || []).map(s => String(s.name || "").toLowerCase()))
      .concat((window.DATA_TEAMS || []).map(t => String(t.ko || "")))
      .concat((window.DATA_TEAMS || []).map(t => String(t.short || "")));
    return names.some(n => n && (v === n || n.indexOf(v) > -1));
  }

  function candidates(question) {
    const q = String(question || "").toLowerCase()
      .replace(/[?!.,·]/g, " ").replace(/\d+/g, " ").replace(/\s+/g, " ").trim();
    const words = q.split(" ").filter(Boolean);
    const out = [];
    const push = s => {
      let v = String(s).trim();
      for (let i = 0; i < 2; i++) v = v.replace(TAIL, "");
      v = v.trim();
      if (v.length < 2) return;
      if (STOP.indexOf(v) > -1) return;
      if (isEntityWord(v)) return;          /* 항목 · 과제 · Study 이름은 제외 */
      if (out.indexOf(v) === -1) out.push(v);
    };
    words.forEach(function (w, i) {
      push(w);
      if (i + 1 < words.length) push(w + " " + words[i + 1]);
    });
    /* 짧은 것부터 — 사전은 좁고 구체적일수록 좋습니다 */
    return out.sort((a, b) => a.length - b.length);
  }

  /* 이미 규칙이 아는 말인지 — 넣어도 아무것도 바뀌지 않으면 후보가 아닙니다 */
  function alreadyKnown(question, wantIntent) {
    const E = window.AskEngine;
    return E._detectIntent(E._norm(question)) === wantIntent;
  }

  /* ── 승격 제안 만들기 ────────────────────────────────────────────────
     로그에서 "LLM 이 해석에 성공했고 규칙은 다른 의도로 읽은" 질문만 봅니다. */
  function suggestions(table) {
    const t = table || window.AskTables.internal();
    const E = window.AskEngine, L = window.RuleLex, Log = window.AskLog;
    if (!Log || !L) return [];
    const st = Log.state();

    /* 아직 규칙이 못 읽는 질문들 — 새 어휘가 몇 개나 함께 해결하는지 셉니다 */
    const unsolved = st.list.filter(e => e.slots && e.slots.intent &&
      ["max", "min", "stat", "trend", "compare", "count", "missing", "meta", "help"].indexOf(e.slots.intent) > -1 &&
      !alreadyKnown(e.question, e.slots.intent));

    const seen = {};
    const out = [];
    unsolved.forEach(function (e) {
      if (st.approved.indexOf(e.question) > -1) return;
      const want = e.slots.intent;
      const cands = candidates(e.question);

      /* 넣었을 때 실제로 의도가 바뀌는 조각만 남깁니다 (실행으로 고릅니다) */
      let picked = null;
      for (let i = 0; i < cands.length && !picked; i++) {
        const phrase = cands[i];
        const tmp = L.add({ kind: "intent", intent: want, phrase: phrase, source: "(probe)", temp: true });
        let works = false;
        try { works = E._detectIntent(E._norm(e.question)) === want; }
        finally { L.revert(tmp.id, "probe"); }
        if (works) picked = phrase;
      }
      if (!picked) return;
      const dedup = picked + "→" + want;
      if (seen[dedup]) { seen[dedup].count += e.count || 1; return; }

      /* 이 어휘가 다른 미해결 질문도 해결하는가 */
      const tmp2 = L.add({ kind: "intent", intent: want, phrase: picked, source: "(probe)", temp: true });
      let alsoSolves = [];
      try {
        alsoSolves = unsolved.filter(x => x.question !== e.question &&
          x.slots.intent === want && E._detectIntent(E._norm(x.question)) === want)
          .map(x => x.question);
      } finally { L.revert(tmp2.id, "probe"); }

      const item = {
        question: e.question, phrase: picked, intent: want,
        count: e.count || 1, alsoSolves: alsoSolves,
        target: INTENT_KO[want] || want,
        where: "detectIntent (RuleLex 오버레이)"
      };
      seen[dedup] = item;
      out.push(item);
    });

    /* 안전 검사는 목록을 만들 때 한 번씩 돌려 둡니다 — 승인 버튼을 누르기
       전에 이미 결과가 보여야 관리자가 판단할 수 있습니다. */
    out.forEach(function (s) {
      const res = dryRun({ kind: "intent", intent: s.intent, phrase: s.phrase }, t);
      s.safe = res.ok;
      s.breaks = res.fails;
    });

    return out.sort((a, b) =>
      (b.count + b.alsoSolves.length) - (a.count + a.alsoSolves.length) || a.phrase.length - b.phrase.length);
  }

  const INTENT_KO = {
    max: "최고값(max)", min: "최저값(min)", stat: "통계(stat)", trend: "추이(trend)",
    compare: "비교(compare)", count: "건수(count)", missing: "결측(missing)",
    meta: "데이터 요약(meta)", help: "사용법(help)"
  };

  /* ── 승인 ───────────────────────────────────────────────────────────
     안전 검사를 통과하지 못하면 반영하지 않고 무엇이 깨지는지 돌려줍니다. */
  function approve(sug, who, table) {
    const t = table || window.AskTables.internal();
    const res = dryRun({ kind: "intent", intent: sug.intent, phrase: sug.phrase }, t);
    if (!res.ok) return { ok: false, blocked: true, fails: res.fails };

    /* 승격 전 지표를 남겨 전후를 비교합니다 */
    const before = window.AskLog ? window.AskLog.metrics() : null;
    window.RuleLex.snapshot("승격 전: " + sug.phrase, before);

    const e = window.RuleLex.add({
      kind: "intent", intent: sug.intent, phrase: sug.phrase,
      source: sug.question, by: who || null
    });
    if (window.AskLog) window.AskLog.approve(sug.question);
    return { ok: true, entry: e, checked: res.total };
  }

  function revert(id, why) {
    const ok = window.RuleLex.revert(id, why);
    if (ok && window.AskLog) {
      window.RuleLex.snapshot("되돌림", window.AskLog.metrics());
    }
    return ok;
  }

  /* ── 효과 측정 ──────────────────────────────────────────────────────
     "규칙 경로 비율이 실제로 움직였는가" 를 봅니다. 승격 전 스냅샷과
     지금 지표를 나란히 놓습니다. */
  function effect() {
    const now = window.AskLog ? window.AskLog.metrics() : null;
    const snaps = window.RuleLex.state().snapshots.filter(s => s.metrics);
    const base = snaps.length ? snaps[snaps.length - 1] : null;   /* 가장 오래된 스냅샷 */
    if (!now || !base) return { now: now, base: null };
    const d = (a, b) => (a == null || b == null) ? null : a - b;
    return {
      now: now, base: base.metrics, baseAt: base.at, baseLabel: base.label,
      delta: {
        rulePct: d(now.rulePct, base.metrics.rulePct),
        llmCalls: d(now.llmCalls, base.metrics.llmCalls),
        avgMs: d(now.avgMs, base.metrics.avgMs)
      }
    };
  }

  /* 승격된 어휘로 특정 질문 묶음이 규칙으로 처리되는지 — 루프 검증용 */
  function ruleRatio(questions, table) {
    const t = table || window.AskTables.internal();
    const E = window.AskEngine;
    let rule = 0, ms = 0;
    (questions || []).forEach(function (q) {
      const t0 = (window.performance && performance.now) ? performance.now() : Date.now();
      const r = E.answer(q, { table: t });
      const t1 = (window.performance && performance.now) ? performance.now() : Date.now();
      ms += (t1 - t0);
      if (!window.AskLLM.ruleMissed(r, r.conditions)) rule++;
    });
    const n = (questions || []).length || 1;
    return { total: n, rule: rule, llm: n - rule,
             rulePct: Math.round(rule / n * 1000) / 10, avgMs: Math.round(ms / n * 100) / 100 };
  }

  return {
    CORE_SPEC: CORE_SPEC, INTENT_KO: INTENT_KO,
    safetyCheck: safetyCheck, dryRun: dryRun,
    candidates: candidates, suggestions: suggestions,
    approve: approve, revert: revert,
    effect: effect, ruleRatio: ruleRatio
  };
})();
