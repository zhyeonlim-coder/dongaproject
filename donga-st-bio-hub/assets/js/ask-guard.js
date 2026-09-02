/* ==========================================================================
   ask-guard.js — LLM 슬롯 검증  ·  window.AskGuard

   모델 출력을 그대로 실행하지 않습니다. 실행 전에 전부 통과시킵니다.

     a) 카탈로그 대조 — 없는 컬럼 · 과제 · Study · 배치는 무효화
     b) 단위 대조     — 기존 Units 를 그대로 재사용. 범위 밖이면 되묻기
     c) 무효 조건     — 걸러지지 않으면 기존 경고 문구
     d) 낮은 확신     — confidence < 0.6 이면 실행하지 않고 되묻기
     e) 미처리        — unhandled 는 반드시 화면에 표시
     f) 오류 · 타임아웃 — 규칙 폴백으로 되돌아가고 그 사실을 표시

   b · c 는 새로 만들지 않고 units.js 와 ask-engine.js 가 이미 하던 것을
   그대로 씁니다. 두 경로(규칙 · LLM)가 같은 검증을 지나야 화면이 일관됩니다.
   ========================================================================== */

window.AskGuard = (function () {
  "use strict";

  const MIN_CONFIDENCE = 0.6;

  function norm(s) { return String(s == null ? "" : s).toLowerCase().trim(); }

  /* api/extract.js 의 intent enum 과 같아야 합니다. 여기서 한 번 더 보는
     이유는, 스키마를 통과했다는 것이 우리가 실행할 수 있다는 뜻은
     아니기 때문입니다 — 스키마는 서버 쪽이고 이건 실행 직전입니다. */
  const KNOWN_INTENTS = ["max", "min", "stat", "trend", "compare", "count",
    "missing", "list", "meta", "help", "unsupported", "ambiguous"];

  /* 카탈로그에 있는 것만 남깁니다. 없는 이름은 버리고 이유를 적습니다. */
  function keepKnown(list, known, kind, rejected) {
    const out = [];
    (list || []).forEach(function (x) {
      const hit = known.find(k => norm(k) === norm(x));
      if (hit) out.push(hit);
      else rejected.push(kind + " \"" + x + "\" 는 이 데이터에 없습니다");
    });
    return out;
  }

  /* 슬롯 → 엔진이 이해하는 형태.
     반환: { ok, plan, clarify, rejected[], unhandled[], reason } */
  function check(slots, table, catalog) {
    const cat = catalog || window.Catalog.get(table);
    const rejected = [];
    /* confidence 는 모델이 스스로 매긴 값입니다. 스키마가 범위를 강제하지
       않으므로 0~1 밖의 값이 올 수 있고, 그대로 두면 confidence 99 짜리
       슬롯이 낮은 확신 검사를 그냥 통과합니다 — 모델이 자신에 대한 검사를
       스스로 끄는 셈입니다. 범위 밖은 신뢰하지 않고 0 으로 봅니다. */
    const rawConf = slots && typeof slots.confidence === "number" ? slots.confidence : 0;
    const confOk = isFinite(rawConf) && rawConf >= 0 && rawConf <= 1;
    if (!confOk && slots && typeof slots === "object") {
      rejected.push("confidence 값(" + rawConf + ")이 0~1 밖이라 신뢰하지 않았습니다");
    }

    const out = {
      ok: false, plan: null, clarify: null,
      rejected: rejected,
      unhandled: Array.isArray(slots && slots.unhandled) ? slots.unhandled.slice() : [],
      confidence: confOk ? rawConf : 0
    };

    if (!slots || typeof slots !== "object") {
      out.reason = "슬롯이 비어 있습니다";
      return out;
    }

    /* 엔진이 아는 의도만 실행합니다. 모르는 의도를 그냥 넘기면 엔진이
       기본값(list)으로 떨어뜨리고, 화면에는 목록이 나옵니다 — 사용자는
       자기 질문이 그렇게 해석된 줄 압니다. 조용한 오답입니다. */
    if (slots.intent && KNOWN_INTENTS.indexOf(slots.intent) === -1) {
      out.reason = "unknown-intent";
      rejected.push("의도 \"" + slots.intent + "\" 는 이 시스템이 실행할 수 있는 것이 아닙니다");
      return out;
    }

    /* ── unsupported — 실행하지 않고 못 한다고 답합니다 ─────────────────── */
    if (slots.intent === "unsupported") {
      out.reason = "unsupported";
      out.unsupported = matchUnsupported(slots, cat);
      return out;
    }

    /* ── a) 카탈로그 대조 ─────────────────────────────────────────────── */
    const colKeys = cat.columns.map(c => c.key);
    const dateKeys = cat.dateFields.map(c => c.key);
    const targetKeys = keepKnown((slots.target && slots.target.keys) || [],
      colKeys.concat(dateKeys), "항목", rejected);

    const f = slots.filters || {};
    const projects = keepKnown(f.projectIds, cat.projects.map(p => p.code), "과제", rejected);
    const studies = keepKnown(f.studyIds, cat.studies.map(s => s.name), "Study", rejected);
    const batches = keepKnown(f.batchIds, cat.batchIds, "배치", rejected);
    const team = f.team && cat.teams.some(t => t.id === f.team) ? f.team : null;
    if (f.team && !team) rejected.push("팀 \"" + f.team + "\" 는 이 데이터에 없습니다");

    /* ── 조건: 컬럼 존재 + 단위 대조 ───────────────────────────────────── */
    const conditions = [];
    (f.conditions || []).forEach(function (c) {
      if (!c || !c.field) return;
      const col = table.columns.find(x => norm(x.key) === norm(c.field));
      if (!col) { rejected.push("조건 항목 \"" + c.field + "\" 는 이 데이터에 없습니다"); return; }
      if (c.value === null || c.value === undefined) {
        rejected.push("\"" + col.label + "\" 조건에 기준값이 없습니다");
        return;
      }
      const th = toThreshold(c);
      if (!th) { rejected.push("\"" + col.label + "\" 조건의 형태를 읽지 못했습니다"); return; }

      /* b) 단위 대조 — 규칙 경로와 똑같은 로직입니다 */
      const res = window.Units.interpretThreshold(th, col, table.rows);
      if (res.suspect) {
        out.clarify = { metric: col, th: th, options: res.options,
                        note: res.notes.join(" "), side: res.side };
        return;
      }
      conditions.push({ key: col.key, label: col.label, op: res.th.op,
                        min: res.th.min, max: res.th.max, notes: res.notes });
    });

    /* ── d) 낮은 확신 ─────────────────────────────────────────────────── */
    if (out.confidence < MIN_CONFIDENCE || slots.intent === "ambiguous") {
      out.reason = "low-confidence";
      out.plan = buildPlan(slots, targetKeys, projects, studies, batches, team, conditions, table);
      return out;
    }

    out.ok = !out.clarify;
    out.plan = buildPlan(slots, targetKeys, projects, studies, batches, team, conditions, table);
    return out;
  }

  function toThreshold(c) {
    const op = c.op;
    if (op === "between") {
      const v = Array.isArray(c.value) ? c.value : null;
      if (!v || v.length < 2) return null;
      return { op: "between", min: Math.min(v[0], v[1]), max: Math.max(v[0], v[1]),
               raw: String(v[0]) + "~" + String(v[1]), unit: c.unit || null };
    }
    const n = Array.isArray(c.value) ? c.value[0] : c.value;
    if (typeof n !== "number" || !isFinite(n)) return null;
    if (op === "gte" || op === "gt") return { op: op, min: n, max: null, raw: String(n), unit: c.unit || null };
    if (op === "lte" || op === "lt") return { op: op, min: null, max: n, raw: String(n), unit: c.unit || null };
    return null;
  }

  function buildPlan(slots, targetKeys, projects, studies, batches, team, conditions, table) {
    const f = slots.filters || {};
    const dr = f.dateRange || {};
    return {
      intent: slots.intent,
      targetType: (slots.target && slots.target.type) || "metric",
      targetKeys: targetKeys,
      spec: { projects: projects, studies: studies, batchIds: batches },
      team: team,
      period: (dr.from || dr.to) ? { from: dr.from || null, to: dr.to || null } : null,
      conditions: conditions,
      excludeMissing: (f.exclude || []).some(x => /미입력|결측|null|missing/i.test(String(x))),
      topN: typeof slots.limit === "number" && slots.limit > 0
        ? { n: slots.limit, dir: (slots.sortBy && slots.sortBy.order === "asc") ? "bottom" : "top" }
        : null,
      sortField: (slots.sortBy && slots.sortBy.field) || null,
      qualitativeBasis: slots.qualitativeBasis || null,
      refersToPrevious: !!slots.refersToPrevious
    };
  }

  function matchUnsupported(slots, cat) {
    const text = ((slots.unhandled || []).join(" ") + " " + (slots.qualitativeBasis || "")).toLowerCase();
    const byWord = [
      { re: /상관|correlat|회귀|regress/, id: "correlation" },
      { re: /추세|올라가|떨어지|증가|감소|나아지|좋아지|trend/, id: "time-trend" },
      { re: /예측|추천|다음|predict|recommend/, id: "prediction" },
      { re: /왜|원인|이유|실패|why|cause/, id: "root-cause" },
      { re: /규격|스펙|spec|pass|fail|합격/, id: "spec-judgement" }
    ];
    let id = null;
    byWord.forEach(function (w) { if (!id && w.re.test(text)) id = w.id; });
    return cat.unsupportedFeatures.find(u => u.id === id) || cat.unsupportedFeatures[0];
  }

  return { check: check, MIN_CONFIDENCE: MIN_CONFIDENCE, _toThreshold: toThreshold };
})();
