/* ==========================================================================
   ask-engine.js — 자연어 질의 → 실제 데이터 조회·통계  ·  window.AskEngine

   숫자는 전부 여기서 나옵니다. 질문을 해석해 AskTables 의 행을 실제로
   추리고 계산한 뒤, 답변 문장과 "그 값이 어디서 나왔는지"를 함께 돌려줍니다.

   설계 원칙
     · 값을 지어내지 않습니다. 원본에 없는 항목(pH · DO · 온도 · Feed rate)을
       물으면 "기록되어 있지 않습니다"라고 답하고, 대신 같은 배치에 실제로
       기록된 항목을 제시합니다.
     · 못 알아들었으면 아는 척하지 않습니다 — 무엇을 못 읽었는지 말하고
       인식 가능한 항목 목록을 보여 줍니다.
     · 답변에는 항상 근거 행(batch · study · 날짜)이 따라붙습니다.

   LLM 은 이 결과를 문장으로 다듬는 데만 쓰입니다 (ask.js → /api/narrate).
   숫자 자체는 LLM 을 거치지 않습니다.
   ========================================================================== */

window.AskEngine = (function () {
  "use strict";

  /* ══════════════════════════════════════════════════════════════════════
     1. 어휘 — 항목 별칭
     ══════════════════════════════════════════════════════════════════════ */

  /* 내부 데이터 컬럼 키 → 인식할 표현들. 한글·영문을 함께 둡니다.
     긴 표현을 먼저 매칭해야 "vcd" 가 "max vcd" 를 가로채지 않습니다. */
  const ALIAS = {
    titerHCCF:      ["titer hccf", "titerhccf", "hccf", "역가", "타이터", "titer", "생산량"],
    qP:             ["qp", "비생산성", "비생산속도", "세포당 생산성"],
    ivcd:           ["ivcd", "적산 세포", "적산세포", "누적 세포"],
    maxVCD:         ["max vcd", "maxvcd", "최대 세포농도", "최대세포농도", "피크 vcd", "피크세포"],
    finalVCD:       ["final vcd", "finalvcd", "최종 세포농도", "최종세포농도"],
    finalViability: ["final viability", "viability", "생존율", "생존도", "세포 생존"],

    downstream_proteinAYield: ["protein a", "proteina", "프로틴 a", "프로테인 a", "단백질 a"],
    downstream_cexYield:      ["cex", "양이온교환", "양이온 교환"],
    downstream_aexYield:      ["aex", "음이온교환", "음이온 교환"],
    downstream_totalYield:    ["total yield", "totalyield", "총 수율", "총수율", "전체 수율", "최종 수율", "수율", "yield", "회수율", "recovery"],
    downstream_monomerPurity: ["sec-hplc monomer", "sec monomer", "단량체 순도", "monomer purity"],
    downstream_hcp:           ["hcp", "숙주세포 단백", "숙주세포단백"],
    downstream_residualDNA:   ["residual dna", "잔류 dna", "잔류dna", "dna"],

    seHPLC_hmw:  ["hmw", "고분자량", "응집체", "aggregate"],
    seHPLC_main: ["se-hplc main", "se hplc main", "sec main", "se-hplc", "sec"],
    seHPLC_lmw:  ["lmw", "저분자량"],

    ieHPLC_acidic:       ["acidic", "산성 변이체", "산성변이체", "산성"],
    ieHPLC_main:         ["ie-hplc main", "ie hplc main", "main peak", "주peak", "메인 피크"],
    ieHPLC_basic:        ["basic", "염기성 변이체", "염기성변이체", "염기성"],
    ieHPLC_basicUnknown: ["basic unknown", "미지 염기성"],

    nGlycan_g0f:          ["g0f"],
    nGlycan_g1f:          ["g1f"],
    nGlycan_highMannose:  ["high mannose", "highmannose", "고만노스", "만노스"],
    nGlycan_sialicAcid:   ["sialic acid", "sialic", "시알산"],
    nGlycan_afucosylated: ["afucosylated", "afuco", "비푸코실"],

    ceSdsNR_monomer: ["ce-sds nr monomer", "nr monomer", "비환원 단량체"],
    ceSdsNR_h2l1:    ["2h1l", "h2l1"],
    ceSdsR_lc:       ["ce-sds lc", "경쇄", "light chain"],
    ceSdsR_hc:       ["ce-sds hc", "중쇄", "heavy chain"],
    ceSdsR_lcHc:     ["lc+hc", "lchc", "경쇄+중쇄"],
    ceSdsR_nghc:     ["nghc", "비당화 중쇄"],

    cultureDays: ["배양 일수", "배양일수", "배양 기간", "culture day", "culture days"]
  };

  /* 원본에 컬럼 자체가 없는 항목 — 지어내지 않고 없다고 답합니다.
     (공정 설정값은 Excel "Batch Data" 시트에 열이 존재하지 않습니다) */
  const NOT_RECORDED = [
    { terms: ["ph", "산도", "피에이치"],                       ko: "pH" },
    { terms: ["do", "용존산소", "용존 산소", "dissolved oxygen"], ko: "DO(용존산소)" },
    { terms: ["온도", "temperature", "temp", "섭씨"],           ko: "온도" },
    { terms: ["feed rate", "피드", "feed", "유가", "fed-batch"], ko: "Feed rate" },
    { terms: ["교반", "rpm", "agitation", "stirring"],          ko: "교반 속도" },
    { terms: ["삼투압", "osmolality", "osmo"],                  ko: "삼투압" },
    { terms: ["글루코스", "포도당", "glucose"],                  ko: "Glucose" },
    { terms: ["젖산", "lactate"],                               ko: "Lactate" },
    { terms: ["암모니아", "ammonia", "nh3"],                    ko: "암모니아" },
    { terms: ["접종 농도", "접종농도", "seeding density", "seed density"], ko: "접종 농도" },
    { terms: ["배지 조성", "배지조성", "media composition"],     ko: "배지 조성" }
  ];

  /* "조건" 을 물었는지 — 물었다면 같은 배치의 기록값을 함께 붙여 줍니다 */
  const CONDITION_WORDS = ["조건", "컨디션", "condition", "파라미터", "parameter", "설정", "공정 조건", "어떻게"];

  /* 외부 문헌 쪽 질문인지 판별하는 신호 */
  const EXTERNAL_HINTS = ["논문", "문헌", "paper", "publication", "저널", "journal",
    "특허", "patent", "선행기술", "연구 동향", "최신 연구", "학술", "pubmed", "doi",
    "리뷰", "review article", "인용"];

  /* ══════════════════════════════════════════════════════════════════════
     2. 질문 해석
     ══════════════════════════════════════════════════════════════════════ */

  function norm(q) {
    return String(q || "").toLowerCase()
      .replace(/[·・]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  /* 한글 조사 때문에 단어 경계를 쓸 수 없어 부분 문자열로 봅니다.
     짧은 영문 토큰만 앞뒤가 영문자가 아닌지 확인합니다 ("do" 가 "doe" 에 걸리지 않도록) */
  function has(text, term) {
    const t = term.toLowerCase();
    const i = text.indexOf(t);
    if (i === -1) return false;
    if (!/^[a-z0-9 +]+$/.test(t) || t.length > 4) return true;
    const before = text[i - 1], after = text[i + t.length];
    return !(before && /[a-z0-9]/.test(before)) && !(after && /[a-z0-9]/.test(after));
  }

  function detectMetrics(text, table) {
    if (table.kind === "upload") return detectUploadColumns(text, table);
    const hits = [];
    Object.keys(ALIAS).forEach(function (key) {
      const col = table.columns.find(c => c.key === key);
      if (!col) return;
      /* 가장 긴 별칭이 걸린 것을 그 항목의 점수로 씁니다 */
      let best = 0;
      ALIAS[key].forEach(a => { if (has(text, a) && a.length > best) best = a.length; });
      if (best) hits.push({ col, score: best });
    });
    hits.sort((a, b) => b.score - a.score);
    return hits.map(h => h.col);
  }

  /* 업로드 표는 별칭 사전이 없으니 머리글 자체로 맞춥니다 */
  function detectUploadColumns(text, table) {
    const hits = [];
    table.columns.forEach(function (col) {
      const l = String(col.label || "").toLowerCase().trim();
      if (l.length < 2) return;
      if (has(text, l)) hits.push({ col, score: l.length });
    });
    hits.sort((a, b) => b.score - a.score);
    return hits.map(h => h.col);
  }

  function detectNotRecorded(text) {
    return NOT_RECORDED.filter(e => e.terms.some(t => has(text, t))).map(e => e.ko);
  }

  function detectIntent(text) {
    if (["추이", "추세", "변화", "trend", "일자별", "날짜별", "경시"].some(t => has(text, t))) return "trend";
    if (["미입력", "결측", "빠진", "누락", "missing", "비어"].some(t => has(text, t))) return "missing";
    if (["비교", "대비", "차이", "versus", " vs ", "compare"].some(t => has(text, t))) return "compare";
    if (["가장 높", "제일 높", "최고", "최대", "highest", "max", "top", "베스트", "best"].some(t => has(text, t))) return "max";
    if (["가장 낮", "제일 낮", "최저", "최소", "lowest", "min", "worst"].some(t => has(text, t))) return "min";
    if (["평균", "average", "mean", "표준편차", "편차", "분포", "범위"].some(t => has(text, t))) return "stat";
    if (["몇 건", "몇건", "몇 개", "몇개", "개수", "건수", "how many", "count"].some(t => has(text, t))) return "count";
    return "list";
  }

  function detectScope(text, table) {
    const scope = { filters: [], label: [] };
    if (table.kind !== "internal") return scope;

    (window.DATA_PROJECTS || []).forEach(function (p) {
      const code = String(p.code || "").toLowerCase();
      if (code && (has(text, code) || has(text, code.replace("da-", "")))) {
        scope.filters.push(r => r.project === p.code);
        scope.label.push(p.code);
      }
    });

    (window.DATA_STUDIES || []).forEach(function (s) {
      const n = String(s.name || "").toLowerCase();
      if (n && has(text, n)) {
        scope.filters.push(r => r.study === s.name);
        scope.label.push(s.name);
      }
    });

    /* 팀은 "팀"이 붙은 표현으로만 잡습니다. 짧은 이름(배양 · 정제 · 분석)을
       그대로 매칭하면 "배양 조건" · "정제 수율" 같은 말이 팀 필터로 오독돼
       조회 범위가 조용히 좁아집니다. */
    (window.DATA_TEAMS || []).forEach(function (t) {
      const forms = [t.ko, t.short + "팀", t.id, String(t.en || "").toLowerCase()];
      if (forms.some(f => f && has(text, f))) {
        scope.filters.push(r => r.team === t.ko);
        scope.label.push(t.ko);
      }
    });

    /* 배치 이름 직접 지목 */
    const named = table.rows.filter(r => r.__label && has(text, String(r.__label).toLowerCase()));
    if (named.length) {
      const ids = named.map(r => r.__id);
      scope.filters.push(r => ids.indexOf(r.__id) > -1);
      scope.label.push(named.map(r => r.__label).join(", "));
    }

    /* 연도 */
    const yr = text.match(/(20\d{2})\s*년?/);
    if (yr) {
      scope.filters.push(r => String(r.date || "").slice(0, 4) === yr[1]);
      scope.label.push(yr[1] + "년");
    }

    /* "최근" — 정렬만 최신순으로 바꾸고 행을 잘라내지는 않습니다.
       임의로 N건을 자르면 "최근"의 범위를 시스템이 지어내는 셈이 됩니다. */
    scope.recent = ["최근", "최신", "요즘", "latest", "recent"].some(t => has(text, t));
    return scope;
  }

  function applyScope(rows, scope) {
    let out = rows.slice();
    scope.filters.forEach(f => { out = out.filter(f); });
    return out;
  }

  /* ══════════════════════════════════════════════════════════════════════
     3. 통계
     ══════════════════════════════════════════════════════════════════════ */
  function values(rows, key) {
    return rows.map(r => r[key]).filter(v => typeof v === "number" && isFinite(v));
  }
  function stats(vals) {
    const n = vals.length;
    if (!n) return null;
    const sorted = vals.slice().sort((a, b) => a - b);
    const sum = vals.reduce((a, b) => a + b, 0);
    const mean = sum / n;
    const mid = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    const sd = n > 1 ? Math.sqrt(vals.reduce((a, v) => a + (v - mean) * (v - mean), 0) / (n - 1)) : 0;
    return { n, mean, median: mid, sd, min: sorted[0], max: sorted[n - 1], cv: mean ? (sd / mean) * 100 : null };
  }
  function fmt(v, col) {
    if (v === null || v === undefined || !isFinite(v)) return "미입력";
    const dp = col && typeof col.dp === "number" ? col.dp
      : (Math.abs(v) >= 100 ? 1 : Math.abs(v) >= 1 ? 2 : 3);
    const s = Number(v).toFixed(dp).replace(/\.?0+$/, "");
    const out = s === "" || s === "-" ? "0" : s;
    return col && col.unit ? out + " " + col.unit : out;
  }

  /* ══════════════════════════════════════════════════════════════════════
     4. 답변 생성
     ══════════════════════════════════════════════════════════════════════ */

  /* 그 배치에 실제로 기록된 값들 — "해당 조건" 질문의 정직한 대체물 */
  function contextOf(row, table, exceptKey) {
    const keys = ["cultureDays", "maxVCD", "finalVCD", "finalViability", "ivcd", "qP", "titerHCCF"];
    const out = [];
    keys.forEach(function (k) {
      if (k === exceptKey) return;
      const col = table.columns.find(c => c.key === k);
      if (!col) return;
      const v = row[k];
      if (v === null || v === undefined) return;
      out.push({ k: col.label, v: fmt(v, col) });
    });
    return out;
  }

  function rowMeta(row, table) {
    const meta = [];
    if (table.kind === "internal") {
      if (row.project) meta.push({ k: "과제", v: row.project });
      if (row.study) meta.push({ k: "Study", v: row.study });
      if (row.team) meta.push({ k: "팀", v: row.team });
      if (row.date) meta.push({ k: "시작일", v: row.date });
    }
    return meta;
  }

  function answer(question, opts) {
    const o = opts || {};
    const text = norm(question);
    if (!text) return { ok: false, kind: "empty", headline: "질문을 입력해 주세요." };

    const table = o.table || window.AskTables.internal();
    const intent = detectIntent(text);
    const metrics = detectMetrics(text, table);
    const missingAsked = table.kind === "internal" ? detectNotRecorded(text) : [];
    const askedCondition = CONDITION_WORDS.some(t => has(text, t));
    const scope = detectScope(text, table);
    let rows = applyScope(table.rows, scope);

    const base = {
      ok: true, question: question, table: { id: table.id, label: table.label, kind: table.kind },
      intent: intent, scopeLabel: scope.label.join(" · ") || "전체",
      scopeRows: rows.length, notRecorded: missingAsked, askedCondition: askedCondition
    };

    if (!rows.length) {
      return Object.assign(base, {
        ok: false, kind: "no-rows",
        headline: "선택한 조건(" + base.scopeLabel + ")에 해당하는 데이터가 없습니다."
      });
    }

    /* 항목을 못 찾았을 때 — 아는 척하지 않고 무엇을 읽을 수 있는지 보여 줍니다 */
    if (!metrics.length && intent !== "missing" && intent !== "count") {
      if (missingAsked.length) {
        return Object.assign(base, {
          ok: false, kind: "not-recorded",
          headline: missingAsked.join(" · ") + "은(는) 원본 데이터에 기록되어 있지 않습니다.",
          note: "Batch_Data_example.xlsx 에 해당 컬럼이 없습니다. 값을 추정해 채우지 않습니다.",
          suggestions: suggestList(table)
        });
      }
      return Object.assign(base, {
        ok: false, kind: "no-metric",
        headline: "질문에서 조회할 항목을 찾지 못했습니다.",
        suggestions: suggestList(table)
      });
    }

    const metric = metrics[0];
    const alt = metrics.slice(1, 4).map(c => c.label);

    if (intent === "trend") return trendAnswer(base, table, rows, metric, scope);
    if (intent === "missing") return missingAnswer(base, table, rows, metrics);
    if (intent === "compare") return compareAnswer(base, table, rows, metric);
    if (intent === "count") return countAnswer(base, table, rows, metric);
    if (intent === "stat") return statAnswer(base, table, rows, metric, alt);
    if (intent === "max" || intent === "min") return extremeAnswer(base, table, rows, metric, intent, alt, askedCondition, missingAsked, scope);
    return listAnswer(base, table, rows, metric, alt, scope);
  }

  function suggestList(table) {
    return window.AskTables.numericColumns(table)
      .filter(c => window.AskTables.filledCount(table, c.key) > 0)
      .map(c => c.label);
  }

  /* ── 최고 / 최저 ─────────────────────────────────────────────────────── */
  function extremeAnswer(base, table, rows, metric, intent, alt, askedCondition, missingAsked, scope) {
    const withVal = rows.filter(r => typeof r[metric.key] === "number" && isFinite(r[metric.key]));
    if (!withVal.length) {
      return Object.assign(base, {
        ok: false, kind: "no-value",
        headline: metric.label + " 값이 기록된 행이 " + base.scopeLabel + " 범위에 없습니다."
      });
    }
    const sorted = withVal.slice().sort((a, b) =>
      intent === "max" ? b[metric.key] - a[metric.key] : a[metric.key] - b[metric.key]);
    const top = sorted[0];
    const s = stats(values(withVal, metric.key));
    const word = intent === "max" ? "가장 높은" : "가장 낮은";

    const facts = [{ k: metric.label, v: fmt(top[metric.key], metric) }]
      .concat(rowMeta(top, table));
    const ctx = table.kind === "internal" ? contextOf(top, table, metric.key) : [];

    let headline = base.scopeLabel === "전체"
      ? metric.label + "이(가) " + word + " 것은 " + top.__label + " — " + fmt(top[metric.key], metric) + "입니다."
      : base.scopeLabel + " 범위에서 " + metric.label + "이(가) " + word + " 것은 " +
        top.__label + " — " + fmt(top[metric.key], metric) + "입니다.";
    if (s && s.n > 1) {
      headline += " 같은 범위 " + s.n + "건의 평균은 " + fmt(s.mean, metric) +
        ", 범위는 " + fmt(s.min, metric) + "~" + fmt(s.max, metric) + "입니다.";
    }

    const notes = [];
    if (askedCondition || missingAsked.length) {
      const miss = missingAsked.length ? missingAsked : ["pH", "DO(용존산소)", "온도", "Feed rate"];
      notes.push(miss.join(" · ") + "은(는) 원본 데이터에 컬럼이 없어 답할 수 없습니다. 대신 같은 배치에 기록된 값을 함께 표시합니다.");
    }
    if (metric.group === "downstream") notes.push("정제 항목은 원본에 컬럼이 없어 생성한 값입니다.");
    if (alt.length) notes.push("비슷한 항목도 함께 인식했습니다 — " + alt.join(", ") + ". 다른 항목을 원하시면 이름을 그대로 넣어 다시 물어보세요.");
    if (scope.recent) notes.push("\"최근\"은 기간을 임의로 자르지 않고 최신순 정렬로만 반영했습니다.");

    return Object.assign(base, {
      kind: "extreme", headline: headline, facts: facts, context: ctx,
      stats: s, metric: { key: metric.key, label: metric.label, unit: metric.unit },
      rows: sorted.slice(0, 8).map(r => evidence(r, table, metric)),
      evidenceCols: evidenceCols(table, metric),
      note: notes.join(" ")
    });
  }

  /* ── 평균·분포 ───────────────────────────────────────────────────────── */
  function statAnswer(base, table, rows, metric, alt) {
    const vals = values(rows, metric.key);
    const s = stats(vals);
    if (!s) {
      return Object.assign(base, { ok: false, kind: "no-value",
        headline: metric.label + " 값이 기록된 행이 없습니다." });
    }
    const headline = base.scopeLabel + " 범위 " + s.n + "건의 " + metric.label +
      " 평균은 " + fmt(s.mean, metric) + "입니다. 중앙값 " + fmt(s.median, metric) +
      ", 표준편차 " + fmt(s.sd, metric) +
      (s.cv !== null ? " (CV " + s.cv.toFixed(1) + "%)" : "") +
      ", 범위 " + fmt(s.min, metric) + "~" + fmt(s.max, metric) + "입니다.";
    const notes = [];
    if (rows.length > s.n) notes.push(rows.length - s.n + "건은 값이 미입력이라 계산에서 제외했습니다.");
    if (metric.group === "downstream") notes.push("정제 항목은 원본에 컬럼이 없어 생성한 값입니다.");
    if (alt.length) notes.push("함께 인식된 항목 — " + alt.join(", ") + ".");

    return Object.assign(base, {
      kind: "stat", headline: headline, stats: s,
      metric: { key: metric.key, label: metric.label, unit: metric.unit },
      facts: [
        { k: "건수", v: String(s.n) + "건" },
        { k: "평균", v: fmt(s.mean, metric) },
        { k: "중앙값", v: fmt(s.median, metric) },
        { k: "표준편차", v: fmt(s.sd, metric) },
        { k: "최소", v: fmt(s.min, metric) },
        { k: "최대", v: fmt(s.max, metric) }
      ],
      rows: rows.slice().sort((a, b) => (b[metric.key] || -Infinity) - (a[metric.key] || -Infinity))
        .slice(0, 8).map(r => evidence(r, table, metric)),
      evidenceCols: evidenceCols(table, metric),
      note: notes.join(" ")
    });
  }

  /* ── 목록·순위 ───────────────────────────────────────────────────────── */
  function listAnswer(base, table, rows, metric, alt, scope) {
    const withVal = rows.filter(r => typeof r[metric.key] === "number" && isFinite(r[metric.key]));
    const sorted = scope.recent
      ? rows.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
      : withVal.slice().sort((a, b) => b[metric.key] - a[metric.key]);
    const s = stats(values(rows, metric.key));
    const headline = base.scopeLabel + " 범위에서 " + metric.label + "이(가) 기록된 배치는 " +
      withVal.length + "건입니다." +
      (s ? " 평균 " + fmt(s.mean, metric) + ", 최고 " + fmt(s.max, metric) +
           " (" + (withVal.slice().sort((a, b) => b[metric.key] - a[metric.key])[0].__label) + ")." : "");
    const notes = [];
    if (metric.group === "downstream") notes.push("정제 항목은 원본에 컬럼이 없어 생성한 값입니다.");
    if (alt.length) notes.push("함께 인식된 항목 — " + alt.join(", ") + ".");

    return Object.assign(base, {
      kind: "list", headline: headline, stats: s,
      metric: { key: metric.key, label: metric.label, unit: metric.unit },
      facts: s ? [{ k: "건수", v: withVal.length + "건" }, { k: "평균", v: fmt(s.mean, metric) },
                  { k: "범위", v: fmt(s.min, metric) + " ~ " + fmt(s.max, metric) }] : [],
      rows: sorted.slice(0, 12).map(r => evidence(r, table, metric)),
      evidenceCols: evidenceCols(table, metric),
      note: notes.join(" ")
    });
  }

  /* ── 개수 ────────────────────────────────────────────────────────────── */
  function countAnswer(base, table, rows, metric) {
    if (!metric) {
      return Object.assign(base, {
        kind: "count",
        headline: base.scopeLabel + " 범위의 데이터는 " + rows.length + "건입니다.",
        facts: [{ k: "건수", v: rows.length + "건" }],
        rows: rows.slice(0, 12).map(r => evidence(r, table, null)),
        evidenceCols: evidenceCols(table, null)
      });
    }
    const n = values(rows, metric.key).length;
    return Object.assign(base, {
      kind: "count",
      headline: base.scopeLabel + " 범위 " + rows.length + "건 중 " + metric.label +
        " 값이 기록된 것은 " + n + "건입니다.",
      metric: { key: metric.key, label: metric.label, unit: metric.unit },
      facts: [{ k: "전체", v: rows.length + "건" }, { k: metric.label + " 기록", v: n + "건" },
              { k: "미입력", v: (rows.length - n) + "건" }],
      rows: rows.slice(0, 12).map(r => evidence(r, table, metric)),
      evidenceCols: evidenceCols(table, metric)
    });
  }

  /* ── 비교 (과제 · Study · 팀 축) ──────────────────────────────────────── */
  function compareAnswer(base, table, rows, metric) {
    const axisKey = table.kind === "internal"
      ? (new Set(rows.map(r => r.project)).size > 1 ? "project"
        : new Set(rows.map(r => r.study)).size > 1 ? "study" : "team")
      : null;
    if (!axisKey) {
      return Object.assign(base, { ok: false, kind: "no-axis",
        headline: "비교할 축(과제 · Study · 팀)을 찾지 못했습니다." });
    }
    const groups = {};
    rows.forEach(function (r) {
      const g = r[axisKey] || "미지정";
      (groups[g] = groups[g] || []).push(r);
    });
    const summary = Object.keys(groups).map(function (g) {
      const s = stats(values(groups[g], metric.key));
      return { group: g, n: s ? s.n : 0, mean: s ? s.mean : null, max: s ? s.max : null, min: s ? s.min : null };
    }).filter(x => x.n > 0).sort((a, b) => b.mean - a.mean);

    if (summary.length < 2) {
      return Object.assign(base, { ok: false, kind: "no-axis",
        headline: "비교하려면 " + metric.label + " 값이 있는 그룹이 2개 이상 필요합니다." });
    }
    const axisKo = axisKey === "project" ? "과제" : axisKey === "study" ? "Study" : "팀";
    const hi = summary[0], lo = summary[summary.length - 1];
    const gap = hi.mean - lo.mean;
    const headline = axisKo + "별 " + metric.label + " 평균은 " +
      hi.group + "이(가) " + fmt(hi.mean, metric) + "로 가장 높고, " +
      lo.group + "이(가) " + fmt(lo.mean, metric) + "로 가장 낮습니다. 차이는 " +
      fmt(gap, metric) + (lo.mean ? " (" + ((gap / Math.abs(lo.mean)) * 100).toFixed(1) + "%)" : "") + "입니다.";

    return Object.assign(base, {
      kind: "compare", headline: headline, axis: axisKo,
      metric: { key: metric.key, label: metric.label, unit: metric.unit },
      facts: summary.map(x => ({ k: x.group, v: fmt(x.mean, metric) + " (n=" + x.n + ")" })),
      compare: summary.map(x => ({
        group: x.group, n: x.n,
        mean: fmt(x.mean, metric), min: fmt(x.min, metric), max: fmt(x.max, metric)
      })),
      note: metric.group === "downstream" ? "정제 항목은 원본에 컬럼이 없어 생성한 값입니다." : ""
    });
  }

  /* ── 일자별 Titer 추이 ───────────────────────────────────────────────── */
  function trendAnswer(base, table, rows, metric, scope) {
    if (table.kind !== "internal") {
      return Object.assign(base, { ok: false, kind: "no-trend",
        headline: "업로드한 표에는 일자별 추이를 계산할 축이 없습니다." });
    }
    const days = window.DATA_TITER_DAYS || [];
    const ids = rows.map(r => r.__id);
    const batches = (window.DATA_BATCHES || []).filter(b => ids.indexOf(b.id) > -1);
    const series = batches.map(function (b) {
      const pts = days.map(function (d) {
        const v = b.upstream && b.upstream.titer ? b.upstream.titer[d] : null;
        return { day: d, value: typeof v === "number" ? v : null };
      }).filter(p => p.value !== null);
      return { label: b.expNo || b.id, points: pts };
    }).filter(s => s.points.length > 1);

    if (!series.length) {
      return Object.assign(base, { ok: false, kind: "no-trend",
        headline: "일자별 Titer 가 2개 이상 기록된 배치가 " + base.scopeLabel + " 범위에 없습니다." });
    }
    const best = series.slice().sort(function (a, b) {
      return b.points[b.points.length - 1].value - a.points[a.points.length - 1].value;
    })[0];
    const first = best.points[0], last = best.points[best.points.length - 1];
    const headline = base.scopeLabel + " 범위에서 일자별 Titer 가 기록된 배치는 " + series.length +
      "건입니다. 최종 Titer 가 가장 높은 " + best.label + "은(는) " + first.day + " " + first.value +
      " mg/L 에서 " + last.day + " " + last.value + " mg/L 로 " +
      (first.value ? ((last.value - first.value) / first.value * 100).toFixed(0) + "% " : "") + "상승했습니다.";

    return Object.assign(base, {
      kind: "trend", headline: headline, series: series,
      metric: { key: "titer", label: "일자별 Titer", unit: "mg/L" },
      facts: series.slice(0, 6).map(s => ({
        k: s.label,
        v: s.points[0].day + " " + s.points[0].value + " → " +
           s.points[s.points.length - 1].day + " " + s.points[s.points.length - 1].value + " mg/L"
      })),
      note: "원본에 Titer D15~D20 은 전 행이 \"-\" 로 기록되어 있어 계산에서 빠집니다."
    });
  }

  /* ── 미입력 현황 ─────────────────────────────────────────────────────── */
  function missingAnswer(base, table, rows, metrics) {
    const cols = metrics.length ? metrics : window.AskTables.numericColumns(table);
    const list = cols.map(function (c) {
      const filled = rows.filter(r => r[c.key] !== null && r[c.key] !== undefined).length;
      return { label: c.label, filled: filled, missing: rows.length - filled };
    }).filter(x => x.missing > 0).sort((a, b) => b.missing - a.missing);

    if (!list.length) {
      return Object.assign(base, { kind: "missing",
        headline: base.scopeLabel + " 범위 " + rows.length + "건은 조회한 항목이 모두 입력되어 있습니다.",
        facts: [] });
    }
    return Object.assign(base, {
      kind: "missing",
      headline: base.scopeLabel + " 범위 " + rows.length + "건 중 미입력이 가장 많은 항목은 " +
        list[0].label + " (" + list[0].missing + "건)입니다. 미입력이 있는 항목은 총 " + list.length + "개입니다.",
      facts: list.slice(0, 10).map(x => ({ k: x.label, v: x.missing + "건 미입력 / " + x.filled + "건 기록" })),
      note: "미입력에는 미측정 · 해당 없음 · 불검출 · 무효가 섞여 있을 수 있습니다. EBR 화면에서 사유별로 구분됩니다."
    });
  }

  /* ── 근거 표 ─────────────────────────────────────────────────────────── */
  function evidenceCols(table, metric) {
    const cols = [{ key: "__label", label: "Batch" }];
    if (table.kind === "internal") {
      cols.push({ key: "project", label: "과제" }, { key: "study", label: "Study" }, { key: "date", label: "시작일" });
    }
    if (metric) cols.push({ key: metric.key, label: metric.label + (metric.unit ? " (" + metric.unit + ")" : "") });
    return cols;
  }
  function evidence(row, table, metric) {
    const out = { __label: row.__label };
    if (table.kind === "internal") { out.project = row.project; out.study = row.study; out.date = row.date; }
    if (metric) out[metric.key] = row[metric.key] === null || row[metric.key] === undefined
      ? "미입력" : fmt(row[metric.key], metric);
    return out;
  }

  /* 질문이 외부 문헌 쪽인지 — ask.js 의 자동 분기에서 씁니다 */
  function looksExternal(question) {
    const t = norm(question);
    return EXTERNAL_HINTS.some(h => has(t, h));
  }

  /* 어떤 항목을 인식할 수 있는지 (화면 안내용) */
  function knownMetrics(table) { return suggestList(table || window.AskTables.internal()); }

  return {
    answer, looksExternal, knownMetrics,
    /* 검증용 */
    _stats: stats, _detectIntent: detectIntent, _norm: norm, _has: has,
    _detectMetrics: detectMetrics, _fmt: fmt, NOT_RECORDED
  };
})();
