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
    /* 정성어도 최고/최저로 읽습니다 — "제일 좋았어?" 가 목록으로 떨어지지 않게 */
    if (["가장 낮", "제일 낮", "최저", "최소", "lowest", "min", "worst",
         "제일 나쁘", "가장 나쁘", "제일 안 좋", "가장 안 좋", "안좋", "부진"].some(t => has(text, t))) return "min";
    if (["제일 좋", "가장 좋", "젤 좋", "잘 나온", "잘나온", "우수"].some(t => has(text, t))) return "max";
    if (["평균", "average", "mean", "표준편차", "편차", "분포", "범위"].some(t => has(text, t))) return "stat";
    if (["몇 건", "몇건", "몇 개", "몇개", "개수", "건수", "how many", "count"].some(t => has(text, t))) return "count";
    return "list";
  }

  /* 영문 Study · Project 이름을 한글로 물어도 걸리도록 하는 별칭 사전.

     원본의 Study 명이 "Media screening test" 라 "미디어 스크리닝" 이 아무
     데도 걸리지 않았습니다. 음차(미디어)와 번역(배지)을 모두 받아 줍니다.
     이름 자체를 바꾸지는 않습니다 — 원본 표기는 그대로 두고 입구만 넓힙니다. */
  const WORD_KO = {
    media: ["미디어", "배지"],
    screening: ["스크리닝", "선별"],
    doe: ["디오이", "도이", "실험계획", "실험계획법"],
    feasibility: ["피저빌리티", "피지빌리티", "타당성", "실현가능성"],
    test: ["테스트", "시험"],
    development: ["개발"],
    process: ["공정"],
    stability: ["안정성"],
    comparability: ["동등성"]
  };
  /* 어느 Study 에나 붙는 말이라 이것만으로는 지목했다고 보지 않습니다 */
  const NAME_STOP = ["test", "테스트", "시험", "study", "스터디", "data", "데이터"];

  function nameAliases(name) {
    const raw = String(name || "").toLowerCase().trim();
    if (!raw) return { all: [], strong: [] };
    const all = [raw, raw.replace(/\s+/g, "")];
    const strong = [];
    raw.split(/[\s\-_]+/).forEach(function (tok) {
      if (!tok) return;
      const isStop = NAME_STOP.indexOf(tok) > -1;
      /* "테스트" · "시험" 은 Study 이름마다 다 붙습니다. 별칭으로 두면
         "디오이 테스트" 가 세 Study 를 모두 지목해 범위가 전체로 벌어집니다. */
      if (isStop) return;
      if (tok.length >= 3) strong.push(tok);
      (WORD_KO[tok] || []).forEach(function (k) { all.push(k); strong.push(k); });
    });
    /* 음차를 이어 붙인 형태 — "미디어 스크리닝" · "미디어스크리닝" */
    const parts = raw.split(/[\s\-_]+/).filter(t => t && NAME_STOP.indexOf(t) === -1);
    if (parts.length > 1) {
      const heads = parts.map(t => (WORD_KO[t] || [t])[0]);
      all.push(heads.join(" "), heads.join(""));
      strong.push(heads.join(" "), heads.join(""));
    }
    return { all: all.concat(strong), strong: strong };
  }

  /* 과제 코드를 숫자만으로 부르는 경우("1234" → DA-1234)를 받되, 그 숫자가
     값 조건으로 쓰였으면 무시합니다. 이 방어가 없으면 "Titer 1234 이상" 이
     과제 DA-1234 로 조용히 좁아집니다 — 정확히 없애려는 그 부류의 오답입니다. */
  function bareNumberHit(text, digits) {
    const re = new RegExp("(^|[^0-9.])" + digits + "([^0-9.]|$)", "g");
    let m;
    while ((m = re.exec(text)) !== null) {
      const after = text.slice(m.index + m[0].length - (m[2] ? m[2].length : 0));
      if (/^\s*(%|이상|이하|초과|미만|보다|넘|개|건|위|일|월|년|~|-|에서|부터|사이)/.test(after)) continue;
      return true;
    }
    return false;
  }

  function matchesName(text, name) {
    const a = nameAliases(name);
    if (a.all.some(x => x && has(text, x))) return true;
    return a.strong.some(x => x && has(text, x));
  }

  /* 범위를 "명세"로 만들어 둡니다 — 후속 질문이 이어받을 수 있어야 하고,
     화면에도 그대로 설명할 수 있어야 하기 때문입니다. */
  function detectScope(text, table) {
    const spec = { projects: [], studies: [], batchIds: [] };
    const scope = { spec: spec, label: [], filters: [] };
    if (table.kind !== "internal") return finishScope(scope, table);

    (window.DATA_PROJECTS || []).forEach(function (p) {
      const code = String(p.code || "").toLowerCase();
      const digits = code.replace(/[^0-9]/g, "");
      if (code && (has(text, code) ||
                   (digits.length >= 3 && bareNumberHit(text, digits)) ||
                   (matchesName(text, p.name) && String(p.name) !== String(p.code)))) {
        spec.projects.push(p.code);
      }
    });

    (window.DATA_STUDIES || []).forEach(function (s) {
      if (s.name && matchesName(text, s.name)) spec.studies.push(s.name);
    });

    /* 배치 이름 직접 지목 */
    table.rows.forEach(function (r) {
      if (r.__label && has(text, String(r.__label).toLowerCase())) spec.batchIds.push(r.__id);
    });

    /* 팀(배양 · 정제 · 분석)은 더 이상 행을 자르지 않습니다.
       28행 전부 team="배양공정팀" 이고 정제 · 분석 값은 컬럼으로 있어서,
       행을 자르면 "정제팀 데이터"가 0건이 됐습니다. 팀은 detectGroups 에서
       "볼 컬럼"을 고르는 데 씁니다. */
    return finishScope(scope, table);

    /* 달력 날짜(연 · 월 · 기간)는 여기서 다루지 않습니다 — parseConditions 의
       기간 파서가 담당합니다. 예전에는 여기서 연도만 뽑아 썼는데, 그러면
       "2024년 1월부터 7월까지" 가 그냥 "2024년" 이 되어 8 · 11 · 12월까지
       조용히 딸려 들어왔습니다. 조건을 반쯤 읽고 넘어가는 경로를 없앱니다. */

    /* "최근" — 정렬만 최신순으로 바꾸고 행을 잘라내지는 않습니다.
       임의로 N건을 자르면 "최근"의 범위를 시스템이 지어내는 셈이 됩니다.
       ("최근 3개월"처럼 기간이 붙은 표현은 기간 파서가 따로 처리합니다) */
    scope.recent = ["최근", "최신", "요즘", "latest", "recent"].some(t => has(text, t));
    return scope;
  }

  /* 명세 → 실제 필터 · 라벨. 직접 물어서 만든 범위든, 앞 질문에서 물려받은
     범위든 같은 함수를 지나므로 둘의 동작이 어긋나지 않습니다. */
  function finishScope(scope, table) {
    const s = scope.spec;
    scope.filters = [];
    scope.label = [];
    if (s.projects.length) {
      scope.filters.push(r => s.projects.indexOf(r.project) > -1);
      scope.label.push(s.projects.join(", "));
    }
    if (s.studies.length) {
      scope.filters.push(r => s.studies.indexOf(r.study) > -1);
      scope.label.push(s.studies.join(", "));
    }
    if (s.batchIds.length) {
      scope.filters.push(r => s.batchIds.indexOf(r.__id) > -1);
      const labels = table.rows.filter(r => s.batchIds.indexOf(r.__id) > -1).map(r => r.__label);
      scope.label.push(labels.join(", "));
    }
    return scope;
  }
  function emptySpec() { return { projects: [], studies: [], batchIds: [] }; }
  function specIsEmpty(s) { return !s.projects.length && !s.studies.length && !s.batchIds.length; }

  function applyScope(rows, scope) {
    let out = rows.slice();
    scope.filters.forEach(f => { out = out.filter(f); });
    return out;
  }

  /* ══════════════════════════════════════════════════════════════════════
     2-c. 조회 대상 4종 — metric · group · entity · meta (+ 날짜 열)

     예전에는 대상이 "수치 항목" 하나뿐이라, 행 자체 · 지표군 · 데이터셋
     자체 · 날짜를 가리킬 단어를 아예 만들 수 없었습니다. 사전을 늘려도
     안 되던 것이 이것이라, 표현 종류를 늘립니다.
     ══════════════════════════════════════════════════════════════════════ */

  /* 팀 = 볼 컬럼 묶음. 행을 자르지 않습니다 (28행 전부 배양공정팀 소속이라
     행으로 자르면 정제 · 분석이 0건이 됩니다). */
  const TEAM_ALIAS = {
    upstream:   ["배양공정팀", "배양팀", "배양 데이터", "배양 결과", "배양 전체", "업스트림", "upstream"],
    downstream: ["정제공정팀", "정제팀", "정제 데이터", "정제 결과", "정제 전체", "다운스트림", "downstream"],
    analytics:  ["바이오분석팀", "분석팀", "분석 데이터", "분석 결과", "분석 전체", "cqa", "품질특성", "특성분석", "analytics"]
  };
  /* 팀 이름 없이 짧게 부르는 말 — 더 구체적인 것이 없을 때만 씁니다 */
  const TEAM_SHORT = { upstream: ["배양"], downstream: ["정제"], analytics: ["분석"] };

  /* 데이터 요약을 묻는 것과 사용법을 묻는 것은 다른 질문입니다 */
  const META_DATA = ["무슨 데이터", "어떤 데이터", "데이터 목록", "데이터 범위",
    "언제부터 언제까지", "기간이 어떻게", "어디까지 있", "얼마나 있", "데이터 요약"];
  const META_HELP = ["뭘 물어", "뭐 물어", "무엇을 물어", "물어볼 수 있", "어떻게 물어",
    "조회 가능", "무슨 항목", "어떤 항목", "항목 목록", "도움말", "가능한 질문", "사용법", "help"];

  const DATE_ALIAS = {
    date:    ["시작일", "시작 날짜", "배양 시작", "언제 배양", "언제 시작", "접종일", "initial date", "inoculation"],
    endDate: ["종료일", "완료일", "끝난 날", "언제 끝", "end date", "harvest", "하베스트", "수확일"]
  };
  const DATE_GENERIC = ["언제", "며칠", "날짜", "일정이"];

  const ENTITY_HINTS = ["어느 과제", "무슨 과제", "어떤 과제", "어느 스터디", "무슨 스터디",
    "어디 거", "어디 것", "소속", "정보 보여", "정보 알려", "상세", "전체 항목"];

  function detectMeta(text) {
    if (META_HELP.some(h => has(text, h))) return "help";
    return META_DATA.some(h => has(text, h)) ? "data" : false;
  }

  /* ── 정성어("제일 좋았어") → 지표 ────────────────────────────────────
     "좋다"의 기준은 팀마다 다릅니다. 무엇으로 읽었는지 반드시 밝힙니다. */
  const GOOD_WORDS = ["제일 좋", "가장 좋", "젤 좋", "잘 나온", "잘나온", "우수", "베스트", "best"];
  const BAD_WORDS  = ["제일 나쁘", "가장 나쁘", "제일 안 좋", "가장 안 좋", "안좋", "부진", "worst"];
  const TEAM_DEFAULT_METRIC = {
    upstream:   { key: "titerHCCF",              ko: "Titer" },
    downstream: { key: "downstream_totalYield",  ko: "Total Yield" },
    analytics:  { key: null, ko: "규격 판정",
                  why: "규격 한계값 테이블이 아직 없어 분석 항목의 좋고 나쁨은 판정할 수 없습니다" }
  };
  function qualitativeMetric(text, table, groups) {
    if (!GOOD_WORDS.some(w => has(text, w)) && !BAD_WORDS.some(w => has(text, w))) return null;
    /* 지표군을 함께 말했으면 그 팀의 기본 지표로, 아니면 배양 기준으로 */
    let teamId = "upstream";
    if (groups && groups.length) {
      const m = String(groups[0].id).match(/^team:(.+)$/);
      if (m) teamId = m[1];
      else if (groups[0].columns[0] && groups[0].columns[0].team) teamId = groups[0].columns[0].team;
    }
    const def = TEAM_DEFAULT_METRIC[teamId] || TEAM_DEFAULT_METRIC.upstream;
    const col = def.key ? table.columns.find(c => c.key === def.key) : null;
    return { col: col, teamId: teamId, ko: def.ko, why: def.why || null };
  }

  function detectDateCols(text, table) {
    const hit = [];
    Object.keys(DATE_ALIAS).forEach(function (k) {
      const col = table.columns.find(c => c.key === k);
      if (col && DATE_ALIAS[k].some(a => has(text, a))) hit.push(col);
    });
    if (!hit.length && DATE_GENERIC.some(g => has(text, g))) {
      table.columns.filter(c => c.type === "date").forEach(c => hit.push(c));
    }
    return hit;
  }

  /* 지표군 — 팀 단위(정제 전체) 와 분석 세부 그룹(SE-HPLC 등) 을 모두 받습니다 */
  function detectGroups(text, table) {
    const out = [];
    const seen = {};
    const push = (id, label, cols) => {
      if (seen[id] || !cols.length) return;
      seen[id] = 1; out.push({ id: id, label: label, columns: cols });
    };
    (window.DATA_TEAMS || []).forEach(function (t) {
      const cols = table.columns.filter(c => c.team === t.id && c.type === "num");
      if ((TEAM_ALIAS[t.id] || []).some(a => has(text, a))) push("team:" + t.id, t.ko, cols);
    });
    /* 분석 세부 그룹 (SE-HPLC · N-glycan …) */
    const byGroup = {};
    table.columns.forEach(function (c) {
      if (c.type !== "num" || !c.group || c.group === "base") return;
      (byGroup[c.group] = byGroup[c.group] || { label: c.groupLabel || c.group, cols: [] }).cols.push(c);
    });
    Object.keys(byGroup).forEach(function (g) {
      const lab = String(byGroup[g].label || "").toLowerCase();
      if (lab.length >= 3 && has(text, lab)) push("grp:" + g, byGroup[g].label, byGroup[g].cols);
    });
    /* 짧은 호칭은 더 구체적인 것이 아무것도 안 걸렸을 때만 */
    if (!out.length) {
      (window.DATA_TEAMS || []).forEach(function (t) {
        const cols = table.columns.filter(c => c.team === t.id && c.type === "num");
        if ((TEAM_SHORT[t.id] || []).some(a => has(text, a))) push("team:" + t.id, t.ko, cols);
      });
    }
    return out;
  }

  function detectEntityAsk(text) { return ENTITY_HINTS.some(h => has(text, h)); }

  /* 후속 질문 표시 — 이것이 있을 때만 앞 질의를 이어받습니다.
     표시가 없는데도 이어받으면 사용자가 전체를 물었는데 조용히 좁아집니다. */
  /* 생략형 후속 질문 — 범위를 그대로 두고 보는 항목만 바꿉니다 */
  const FOLLOWUP = ["그럼", "그러면", "그건", "이어서", "위에서", "앞에서",
    "같은 범위", "동일 범위", "계속"];
  /* 지시어 — 직전 답변이 지목한 그 배치를 가리킵니다 */
  const DEICTIC = ["그거", "그것", "저거", "그 배치", "이 배치", "해당 배치", "방금 그", "아까 그"];
  function looksFollowUp(text) { return FOLLOWUP.some(f => has(text, f)); }
  function looksDeictic(text) {
    let hit = null;
    DEICTIC.forEach(function (d) { if (!hit && has(text, d)) hit = d; });
    return hit;
  }

  /* ══════════════════════════════════════════════════════════════════════
     2-b. 조건 파서 — 임계값 · 상위N · 기간 · 제외

     이 파서의 계약은 "읽은 것과 못 읽은 것을 모두 돌려준다" 입니다.
     예전에는 "Titer 3 이상" 의 "3 이상" 이 그냥 사라져서, 걸러지지 않은
     28건이 걸러진 결과처럼 보였습니다. 조용한 오답은 명시적 실패보다
     위험합니다 — 연구원이 그 숫자를 그대로 보고서에 쓰기 때문입니다.
     그래서 applied / unhandled 를 항상 함께 내보내고, 화면은 둘 다 띄웁니다.
     ══════════════════════════════════════════════════════════════════════ */

  const MONTH_LAST = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function lastDay(y, m) {
    if (m === 2 && ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) return 29;
    return MONTH_LAST[m - 1];
  }
  function iso(y, m, d) {
    return String(y) + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  }
  function shiftMonths(ymd, n) {
    const y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(5, 7)), d = Number(ymd.slice(8, 10));
    const t = (y * 12 + (m - 1)) + n;
    const ny = Math.floor(t / 12), nm = (t % 12) + 1;
    return iso(ny, nm, Math.min(d, lastDay(ny, nm)));
  }

  /* 보유 구간은 늘 데이터에서 계산합니다 (하드코딩 금지 — 원본이 바뀌면 같이 바뀝니다) */
  function dateRangeOf(table) {
    const ds = table.rows.map(r => r.date).filter(Boolean).sort();
    return ds.length ? { min: ds[0], max: ds[ds.length - 1], n: ds.length } : null;
  }
  function yearsOf(table) {
    const set = {};
    table.rows.forEach(r => { if (r.date) set[r.date.slice(0, 4)] = 1; });
    return Object.keys(set).map(Number).sort((a, b) => b - a);   /* 최신 연도부터 */
  }
  function countBetween(table, from, to) {
    return table.rows.filter(r => r.date && r.date >= from && r.date <= to).length;
  }

  /* 연도가 없는 월 표현 — "올해" 로 넘겨짚지 않습니다. 데이터가 실제로 있는
     가장 최근 연도로 붙이고, 그렇게 해석했다는 사실을 라벨에 남깁니다. */
  function resolveYearless(fromM, toM, table) {
    const years = yearsOf(table);
    const spans = years.map(function (y) {
      const endY = toM >= fromM ? y : y + 1;                     /* 12월~1월 = 해 넘김 */
      return { from: iso(y, fromM, 1), to: iso(endY, toM, lastDay(endY, toM)), guessed: true };
    });
    for (let i = 0; i < spans.length; i++) {
      if (countBetween(table, spans[i].from, spans[i].to) > 0) return spans[i];
    }
    return spans[0] || null;
  }

  /* 오늘 날짜에 기대는 상대 기간 — 해석하지 않고 그 이유를 말합니다.
     데이터 보유 구간이 오늘과 멀면 조용히 0건이 나와 오해를 부릅니다. */
  const RELATIVE_DATE = ["이번 달", "이번달", "지난달", "지난 달", "이번 주", "이번주",
    "지난주", "지난 주", "이번 분기", "이번분기", "지난 분기", "지난분기",
    "올해", "작년", "재작년", "어제", "오늘", "내일"];

  /* 조건처럼 보이지만 지금 구조로는 처리할 수 없는 것들 — 반드시 밝힙니다 */
  const CANT_YET = [
    { terms: ["왜", "원인", "이유", "때문"], ko: "원인 분석(\"왜\")", why: "값 조회만 가능하고 원인 추론은 아직 지원하지 않습니다" },
    { terms: ["스펙", "규격", "spec", "합격", "불합격", "pass", "fail", "일탈", "ooS", "oos"], ko: "규격 판정", why: "규격 한계값 테이블이 아직 도입되지 않아 Pass/Fail 을 판정할 수 없습니다" }
    /* "그거 · 그럼" 같은 후속 표현은 이제 직전 질의에서 이어받습니다
       (answer() 의 맥락 승계). 이어받을 것이 없을 때만 안내를 붙입니다. */
  ];

  function parseConditions(text, table, metrics) {
    const primary = metrics && metrics.length ? metrics[0] : null;
    const c = {
      period: null, thresholds: [], topN: null, excludeMissing: false,
      dayRef: null, applied: [], unhandled: [], warnings: [], clarify: null,
      ignoredTokens: []
    };
    let t = " " + text + " ";
    const eat = (re, fn) => {
      let m;
      while ((m = re.exec(t)) !== null) {
        const keep = fn(m);
        t = t.slice(0, m.index) + " ".repeat(m[0].length) + t.slice(m.index + m[0].length);
        re.lastIndex = 0;
        if (keep === false) break;
      }
    };

    /* ── 0. 배양 경과일 먼저 걷어냅니다 ────────────────────────────────
       D10 · 10일차 는 배양 시작 후 며칠인지(경과일)이고, INITIAL DATE 는
       달력 날짜입니다. 축이 다릅니다. 먼저 소비해 두지 않으면 "10일차" 의
       10 이 기간이나 임계값으로 잘못 읽힙니다. */
    eat(/(?:^|[^a-z0-9])d\s?(\d{1,2})(?![0-9])|(\d{1,2})\s*일\s*차|day\s*(\d{1,2})(?![0-9])/g, function (m) {
      const d = m[1] || m[2] || m[3];
      c.dayRef = "D" + d;
      c.unhandled.push("\"D" + d + "\"(배양 경과일) — 특정 일차만 골라내는 조회는 아직 없습니다. \"일자별 추이\"로 물으면 전체 일차를 표로 보여 드립니다");
    });

    /* ── 1. 기간 ────────────────────────────────────────────────────── */
    /* 1-1. ISO 날짜 (하루 또는 구간) */
    eat(/(20\d{2})-(\d{1,2})-(\d{1,2})\s*(?:~|-|—|부터|에서)\s*(20\d{2})-(\d{1,2})-(\d{1,2})/g, function (m) {
      c.period = { from: iso(+m[1], +m[2], +m[3]), to: iso(+m[4], +m[5], +m[6]) };
      return false;
    });
    if (!c.period) eat(/(20\d{2})-(\d{1,2})-(\d{1,2})/g, function (m) {
      const d = iso(+m[1], +m[2], +m[3]);
      c.period = { from: d, to: d };
      return false;
    });
    /* 1-2. "최근 N개월 · N일" — 오늘이 아니라 데이터 최신일 기준 */
    if (!c.period) eat(/최근\s*(\d{1,2})\s*(개월|달|일)/g, function (m) {
      const rg = dateRangeOf(table);
      if (!rg) return false;
      const n = +m[1];
      c.period = m[2] === "일"
        ? { from: iso(+rg.max.slice(0,4), +rg.max.slice(5,7), Math.max(1, +rg.max.slice(8,10) - n + 1)), to: rg.max, anchored: rg.max }
        : { from: shiftMonths(rg.max, -n), to: rg.max, anchored: rg.max };
      return false;
    });
    /* 1-3. "2024년 1월부터 7월까지" · "2024년 9월" · "2024년 상반기/3분기" · "2024년" */
    if (!c.period) eat(/(20\d{2}|\d{2})\s*년\s*(\d{1,2})\s*월\s*(?:~|-|—|부터|에서)\s*(\d{1,2})\s*월/g, function (m) {
      const y = m[1].length === 2 ? 2000 + +m[1] : +m[1];
      const a = +m[2], b = +m[3], endY = b >= a ? y : y + 1;
      c.period = { from: iso(y, a, 1), to: iso(endY, b, lastDay(endY, b)) };
      return false;
    });
    if (!c.period) eat(/(20\d{2}|\d{2})\s*년\s*(\d{1,2})\s*월/g, function (m) {
      const y = m[1].length === 2 ? 2000 + +m[1] : +m[1], a = +m[2];
      c.period = { from: iso(y, a, 1), to: iso(y, a, lastDay(y, a)) };
      return false;
    });
    if (!c.period) eat(/(20\d{2}|\d{2})\s*년\s*(상반기|하반기)/g, function (m) {
      const y = m[1].length === 2 ? 2000 + +m[1] : +m[1];
      c.period = m[2] === "상반기" ? { from: iso(y,1,1), to: iso(y,6,30) } : { from: iso(y,7,1), to: iso(y,12,31) };
      return false;
    });
    if (!c.period) eat(/(20\d{2}|\d{2})\s*년\s*([1-4])\s*분기/g, function (m) {
      const y = m[1].length === 2 ? 2000 + +m[1] : +m[1], q = +m[2], a = q * 3 - 2, b = q * 3;
      c.period = { from: iso(y, a, 1), to: iso(y, b, lastDay(y, b)) };
      return false;
    });
    if (!c.period) eat(/(20\d{2})\s*년(?!\s*\d)/g, function (m) {
      c.period = { from: iso(+m[1],1,1), to: iso(+m[1],12,31) };
      return false;
    });
    /* 1-4. 연도 없는 월 표현 */
    if (!c.period) eat(/(\d{1,2})\s*월\s*(?:~|-|—|부터|에서)\s*(\d{1,2})\s*월/g, function (m) {
      c.period = resolveYearless(+m[1], +m[2], table);
      return false;
    });
    if (!c.period) eat(/(\d{1,2})\s*월(?!\s*\d)/g, function (m) {
      c.period = resolveYearless(+m[1], +m[1], table);
      return false;
    });

    if (c.period) {
      let lab = "기간 " + c.period.from + " ~ " + c.period.to;
      if (c.period.guessed) lab += " (연도를 말씀하지 않아 데이터가 있는 가장 최근 연도로 해석)";
      if (c.period.anchored) lab += " (오늘이 아니라 데이터 최신일 " + c.period.anchored + " 기준)";
      c.applied.push(lab);
    }
    RELATIVE_DATE.forEach(function (w) {
      if (has(text, w)) {
        const rg = dateRangeOf(table);
        c.unhandled.push("\"" + w + "\" — 오늘 날짜 기준 상대 기간입니다. 데이터 보유 구간(" +
          (rg ? rg.min + " ~ " + rg.max : "없음") + ")과 어긋날 수 있어 임의로 해석하지 않았습니다");
      }
    });

    /* ── 2. 상위 / 하위 N ───────────────────────────────────────────── */
    eat(/(상위|최상위|top|하위|최하위|bottom)\s*(\d{1,3})\s*(?:개|건|위)?/g, function (m) {
      const dir = /하위|bottom/.test(m[1]) ? "bottom" : "top";
      c.topN = { dir: dir, n: +m[2] };
      c.applied.push((dir === "top" ? "상위 " : "하위 ") + m[2] + "건만");
      return false;
    });

    /* ── 3. 임계값 — 파싱과 단위 해석은 Units 한 곳에서 합니다 ────────
       회의 모드 봇도 같은 모듈을 씁니다. 두 화면이 같은 질문에 다르게
       동작하지 않게 하려면 숫자를 조건으로 바꾸는 자리가 하나여야 합니다. */
    const U = window.Units;
    (U ? U.parseThresholds(t) : []).forEach(function (th) {
      if (!primary) {
        c.unhandled.push("\"" + th.raw + "\" — 어느 항목에 적용할지 알 수 없습니다. \"Titer 1000 이상\"처럼 항목 이름과 함께 물어봐 주세요");
        return;
      }
      const res = U.interpretThreshold(th, primary, table.rows);

      /* 실측 범위와 어긋나면 마음대로 고르지 않고 되묻습니다.
         "Titer 3 이상"(실측 18~2494 mg/L)이 28건 전부를 통과시켜 조건 없는
         질문과 같은 결과를 내던 것이 이 분기를 만든 이유입니다. */
      if (res.suspect) {
        c.clarify = { metric: primary, th: th, options: res.options,
                      note: res.notes.join(" "), side: res.side };
        return;
      }
      res.notes.forEach(n => c.applied.push(n));
      c.thresholds.push({ key: primary.key, label: primary.label,
                          op: res.th.op, min: res.th.min, max: res.th.max });
      const u = primary.unit ? " " + primary.unit : "";
      const T = res.th;
      c.applied.push(primary.label + " " + (
        T.op === "between" ? T.min + u + " ~ " + T.max + u :
        T.op === "gte" ? "≥ " + T.min + u : T.op === "gt" ? "> " + T.min + u :
        T.op === "lte" ? "≤ " + T.max + u : "< " + T.max + u));

      /* 조건이 아무것도 못 거르면 그 사실을 말해야 합니다 */
      const chk = U.isNoOp(table.rows, primary.key, res.th);
      if (chk.noop) {
        c.warnings.push("이 조건은 " + primary.label + " 값이 있는 " + chk.total +
          "건 전부에 해당하여 결과가 좁혀지지 않았습니다. 단위나 기준값을 확인해 주세요 " +
          "(실측 범위 " + (function () {
            const rg = U.observedRange(table.rows, primary.key);
            return rg ? rg.min + " ~ " + rg.max + (primary.unit ? " " + primary.unit : "") : "알 수 없음";
          })() + ").");
      }
    });

    /* ── 4. 제외 ───────────────────────────────────────────────────── */
    if (/(미입력|결측|빈\s*값|null)[^.]{0,6}(빼고|제외|except|없는 것만 빼)/.test(text)) {
      if (primary) {
        c.excludeMissing = true;
        c.excludeMissingKey = primary.key;
        c.applied.push(primary.label + " 미입력 행 제외");
      } else {
        c.unhandled.push("\"미입력 제외\" — 어느 항목의 미입력인지 알 수 없습니다");
      }
    }

    /* ── 5. 아직 못 하는 것들 ──────────────────────────────────────── */
    CANT_YET.forEach(function (e) {
      if (e.terms.some(x => has(text, x))) c.unhandled.push(e.ko + " — " + e.why);
    });

    /* 남은 낱말 중 숫자가 붙은 토큰 = 못 읽은 조건일 가능성 (디버그용) */
    c.ignoredTokens = (t.match(/\S*\d+\S*/g) || []).filter(x => x.length < 20);
    return c;
  }

  function applyConditions(rows, c) {
    let out = rows;
    if (c.period) out = out.filter(r => r.date && r.date >= c.period.from && r.date <= c.period.to);
    c.thresholds.forEach(function (th) {
      out = out.filter(function (r) {
        const v = r[th.key];
        if (typeof v !== "number" || !isFinite(v)) return false;   /* 값이 없으면 조건 판정 불가 */
        if (th.op === "between") return v >= th.min && v <= th.max;
        if (th.op === "gte") return v >= th.min;
        if (th.op === "gt") return v > th.min;
        if (th.op === "lte") return v <= th.max;
        return v < th.max;
      });
    });
    if (c.excludeMissing && c.excludeMissingKey) {
      out = out.filter(r => typeof r[c.excludeMissingKey] === "number" && isFinite(r[c.excludeMissingKey]));
    }
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

  /* 모든 응답이 반드시 지나는 단일 관문.

     해석한 조건(applied)과 반영하지 못한 것(unhandled)을 결과에 붙입니다.
     answer() 의 반환은 예외 없이 여기를 통과하므로, 조건을 조용히 버리는
     경로가 구조적으로 남을 수 없습니다.

     headline 이 아니라 별도 필드에 담는 것이 핵심입니다 — headline 은
     /api/narrate 가 문장을 다시 씁니다. 조건을 headline 안에만 넣으면
     모델이 지워버릴 수 있어, 화면은 이 필드를 따로 렌더링합니다. */
  function decorate(r, cond, table) {
    r.applied = (cond && cond.applied) ? cond.applied.slice() : [];
    r.unhandled = (cond && cond.unhandled) ? cond.unhandled.slice() : [];
    r.warnings = (cond && cond.warnings) ? cond.warnings.slice() : [];
    /* 이 응답이 지목한 배치를 기록합니다 — 다음 질문의 "그거" 가 이것입니다.
       최고/최저는 그 한 건, 1건짜리 조회는 그 건. 목록은 지목한 것이 없습니다. */
    if (r.carry && r.focusLabels && r.focusLabels.length && table) {
      const ids = table.rows.filter(x => r.focusLabels.indexOf(x.__label) > -1).map(x => x.__id);
      if (ids.length) r.carry.focus = { ids: ids, labels: r.focusLabels.slice() };
      delete r.focusLabels;
    }
    /* 해석한 조건을 문장 맨 앞에 박아 둡니다. 조건이 다르면 답도 반드시
       달라 보여야 합니다 — "3 이상" 과 "상위 5개" 와 조건 없는 질문이
       똑같은 문장을 내놓던 것이 이번 수정의 출발점이었습니다. */
    if (r.applied.length) {
      r.headline = "[" + r.applied.join(" · ") + "] " + (r.headline || "");
    }
    if (r.unhandled.length) {
      r.note = (r.note ? r.note + " " : "") +
        "이번 조회에 반영하지 못한 조건이 있습니다 — " + r.unhandled.join(" · ") + ".";
    }
    if (window.console && console.debug) {
      console.debug("[AskEngine]", r.question, {
        의도: r.intent, 결과: r.kind, 조회건수: r.scopeRows,
        해석한조건: r.applied, 무시한조건: r.unhandled, 경고: r.warnings,
        남은토큰: cond ? cond.ignoredTokens : []
      });
    }
    return r;
  }

  function answer(question, opts) {
    const o = opts || {};
    const text = norm(question);
    const table = o.table || window.AskTables.internal();

    if (!text) {
      return decorate({
        ok: false, kind: "empty", question: question, intent: "list",
        table: { id: table.id, label: table.label, kind: table.kind },
        scopeLabel: "전체", scopeRows: table.rows.length,
        headline: "질문을 입력하면 실제 데이터에서 값을 찾아 답합니다.",
        hints: sampleQuestions(table), suggestions: suggestList(table)
      }, null, table);
    }

    const intent = detectIntent(text);
    let metrics = detectMetrics(text, table);
    const missingAsked = table.kind === "internal" ? detectNotRecorded(text) : [];
    const askedCondition = CONDITION_WORDS.some(t => has(text, t));
    const scope = detectScope(text, table);
    const isMeta = detectMeta(text);
    let dateCols = detectDateCols(text, table);
    let groups = detectGroups(text, table);
    const askedEntity = detectEntityAsk(text);

    /* ── 맥락 승계 — 두 층으로 나눕니다 ────────────────────────────────
       scope  : 직전 질의의 조회 범위 (과제 · Study · 배치)
       focus  : 직전 응답이 실제로 지목한 배치 (최고값 배치 등)

       "그거"(지시어)는 직전 답변이 가리킨 그 배치를 뜻하고,
       "그럼 …은?"(생략형)은 범위를 그대로 두고 보는 항목만 바꾸는 말입니다.
       둘을 한 층으로 묶으면 "그거 언제 배양했어?" 가 과제 18건을 되돌려
       줍니다 — 사용자가 가리킨 것은 한 건인데도. */
    const prev = o.prev && o.prev.carry ? o.prev.carry : null;
    const inherited = [];
    const deictic = looksDeictic(text);
    const elliptic = looksFollowUp(text);
    if (deictic || elliptic) {
      if (!prev) {
        inherited.push("이어받을 앞 질문이 없어 이번 질문만으로 조회했습니다");
      } else if (deictic && prev.focus && prev.focus.ids && prev.focus.ids.length && specIsEmpty(scope.spec)) {
        scope.spec = { projects: [], studies: [], batchIds: prev.focus.ids.slice() };
        finishScope(scope, table);
        inherited.push("\"" + deictic + "\" 는 직전 답변이 지목한 " +
          prev.focus.labels.join(", ") + " 를 가리키는 것으로 봤습니다");
      } else if (!specIsEmpty(prev.spec) && specIsEmpty(scope.spec)) {
        scope.spec = { projects: prev.spec.projects.slice(), studies: prev.spec.studies.slice(),
                       batchIds: prev.spec.batchIds.slice() };
        finishScope(scope, table);
        inherited.push("직전 질의의 " + scope.label.join(" · ") + " 범위를 유지했습니다");
      }
      /* 보는 항목은 새 질문 쪽이 우선입니다 — "그럼 정제는?" 은 범위만 잇습니다 */
      if (prev && !metrics.length && !groups.length && !dateCols.length && !isMeta) {
        if (prev.metricKeys && prev.metricKeys.length) {
          metrics = prev.metricKeys.map(k => table.columns.find(c => c.key === k)).filter(Boolean);
          if (metrics.length) inherited.push("직전 질의의 항목(" + metrics[0].label + ")을 이어받았습니다");
        }
      }
    }

    /* ── 정성어("제일 좋았어") → 팀 기본 지표 ─────────────────────────── */
    let qualNote = null;
    if (!metrics.length) {
      const qm = qualitativeMetric(text, table, groups);
      if (qm && qm.col) {
        metrics = [qm.col];
        qualNote = "\"좋다/나쁘다\" 를 " + qm.ko + " 기준으로 해석했습니다. " +
          "다른 기준으로 보시려면 항목을 지정해 주세요.";
      } else if (qm && !qm.col) {
        qualNote = null;
      }
    }

    const cond = parseConditions(text, table, metrics);
    if ((deictic || elliptic) && !prev) {
      cond.unhandled.push("앞 질문 이어받기 — 이 세션에 직전 질의가 없습니다");
    }
    inherited.forEach(x => cond.applied.push(x));
    if (qualNote) cond.applied.push(qualNote);
    /* 분석 항목의 "좋고 나쁨"은 규격이 있어야 판정할 수 있습니다 */
    (function () {
      const qm = qualitativeMetric(text, table, groups);
      if (qm && !qm.col && qm.why) cond.unhandled.push(qm.ko + " — " + qm.why);
    })();

    const scoped = applyScope(table.rows, scope);
    let rows = applyConditions(scoped, cond);

    /* 조건을 걸었는데 한 건도 걸러지지 않았으면 알려 줍니다. 라벨만 붙고
       결과가 그대로면 연구원은 걸러진 것으로 봅니다 — 그게 조용한 오답입니다. */
    const filtered = cond.thresholds.length || cond.period || cond.excludeMissing;
    if (filtered && rows.length === scoped.length && !cond.warnings.length) {
      cond.warnings.push("이 조건은 대상 " + scoped.length +
        "건 전부에 해당하여 결과가 좁혀지지 않았습니다. 단위나 기준값을 확인해 주세요.");
    }

    if (scope.label.length) cond.applied.unshift("범위 " + scope.label.join(" · "));

    const base = {
      ok: true, question: question, table: { id: table.id, label: table.label, kind: table.kind },
      intent: intent, scopeLabel: scope.label.join(" · ") || "전체",
      scopeRows: rows.length, notRecorded: missingAsked, askedCondition: askedCondition,
      conditions: cond,
      /* 다음 질문이 이어받을 것 — ask.js 가 그대로 되돌려 줍니다.
         spec(범위) 과 focus(지목한 배치) 를 나눠 둡니다. */
      carry: { spec: scope.spec, metricKeys: metrics.map(c => c.key),
               groupIds: groups.map(g => g.id), rowIds: [],
               /* 지목한 배치는 새로 지목할 때까지 유지합니다. 목록을 한 번
                  보여 줬다고 "그거" 의 대상이 사라지지는 않습니다. */
               focus: (prev && prev.focus) ? prev.focus : null }
    };

    /* ── 단위가 분명하지 않으면 답하기 전에 되묻습니다 ────────────────── */
    if (cond.clarify) return decorate(clarifyAnswer(base, table, scoped, cond), cond, table);

    /* ── 데이터셋 자체를 물었을 때 ────────────────────────────────────
       "무슨 데이터 있어"(요약) 와 "뭘 물어볼 수 있어"(사용법)는 다른 질문입니다. */
    if (isMeta === "help") return decorate(helpAnswer(base, table), cond, table);
    if (isMeta) return decorate(metaAnswer(base, table), cond, table);

    /* ── 0건 — 왜 0건인지와 다음 수를 함께 줍니다 ─────────────────────── */
    if (!rows.length) {
      const rg = dateRangeOf(table);
      const hints = [];
      /* 어느 조건에서 0건이 됐는지 짚어 줍니다. 기간 안에 데이터가 있는데도
         "그 기간에 기록이 없다"고 말하면 그 자체가 잘못된 안내가 됩니다. */
      const afterPeriod = cond.period
        ? scoped.filter(r => r.date && r.date >= cond.period.from && r.date <= cond.period.to)
        : scoped;
      if (cond.period && !afterPeriod.length) {
        hints.push("이 데이터의 보유 구간은 " + (rg ? rg.min + " ~ " + rg.max : "없음") +
          " 입니다. 요청하신 " + cond.period.from + " ~ " + cond.period.to + " 에는 기록이 없습니다.");
      } else if (cond.period && cond.thresholds.length) {
        hints.push("기간 " + cond.period.from + " ~ " + cond.period.to + " 안에는 " +
          afterPeriod.length + "건이 있습니다. 0건이 된 것은 값 조건 때문입니다.");
      }
      if (cond.thresholds.length) {
        cond.thresholds.forEach(function (th) {
          const col = table.columns.find(c => c.key === th.key) || th;
          const s = stats(values(afterPeriod.length ? afterPeriod : scoped, th.key));
          if (s) hints.push(th.label + " 의 실제 분포는 " + fmt(s.min, col) + " ~ " + fmt(s.max, col) +
            " (평균 " + fmt(s.mean, col) + ", n=" + s.n + ") 입니다. 조건을 넓혀 보세요.");
        });
      }
      if (scope.label.length && !cond.period && !cond.thresholds.length) {
        hints.push("범위(" + scope.label.join(" · ") + ")를 빼고 다시 물어보면 전체 " +
          table.rows.length + "건에서 찾습니다.");
      }
      if (!hints.length) hints.push("조건을 하나씩 빼면서 다시 물어봐 주세요.");
      return decorate(Object.assign(base, {
        ok: false, kind: "no-rows",
        headline: "조건에 맞는 데이터가 0건입니다.",
        hints: hints, suggestions: suggestList(table)
      }), cond, table);
    }

    base.carry.rowIds = rows.map(r => r.__id);

    /* ── 수치 항목이 아닌 대상들 — 날짜 열 · 지표군 · 행 자체 ──────────
       수치 항목이 함께 잡혔으면 기존 계산 경로를 그대로 씁니다 (회귀 방지). */
    if (!metrics.length) {
      if (dateCols.length) return decorate(dateAnswer(base, table, rows, dateCols), cond, table);
      if (groups.length) return decorate(groupAnswer(base, table, rows, groups, cond), cond, table);
      if (rows.length === 1 || askedEntity) {
        return decorate(entityAnswer(base, table, rows, missingAsked, askedEntity), cond, table);
      }
    }

    /* ── 항목을 못 찾았을 때 — 포기하지 않고 추려진 범위를 그대로 보여 줍니다 ──
       예전에는 여기서 "조회할 항목을 찾지 못했습니다" 로 끝냈습니다. 범위가
       1건으로 정확히 좁혀진 상태에서도 그 1건을 버렸습니다. 손에 쥔 데이터를
       버리지 않는 것이 이 폴백의 목적입니다. */
    if (!metrics.length && intent !== "missing" && intent !== "count") {
      /* 목록을 보여 주더라도 "무엇을 못 알아들었는지"는 반드시 말합니다.
         질문을 못 읽은 채 전체를 펼쳐 놓고 잠자코 있으면, 그것도 조용한
         오답입니다 — 사용자는 자기 질문이 반영된 결과라고 믿게 됩니다. */
      cond.unhandled.push(scope.label.length
        ? "조회할 항목을 특정하지 못했습니다 — 범위만 적용하고 그 안의 기록을 그대로 펼쳤습니다"
        : "질문에서 조회할 항목도 범위(과제 · Study · 배치)도 찾지 못했습니다 — 전체 목록을 보여 드립니다");
      return decorate(overviewAnswer(base, table, rows, missingAsked), cond, table);
    }

    const metric = metrics[0];
    const alt = metrics.slice(1, 4).map(c => c.label);

    let out;
    if (intent === "trend") out = trendAnswer(base, table, rows, metric, scope);
    else if (intent === "missing") out = missingAnswer(base, table, rows, metrics);
    else if (intent === "compare") out = compareAnswer(base, table, rows, metric);
    else if (intent === "count") out = countAnswer(base, table, rows, metric);
    else if (intent === "stat") out = statAnswer(base, table, rows, metric, alt);
    else if (intent === "max" || intent === "min")
      out = extremeAnswer(base, table, rows, metric, intent, alt, askedCondition, missingAsked, scope);
    else out = listAnswer(base, table, rows, metric, alt, scope, cond);

    /* 상위/하위 N — list 이외의 의도에서도 개수를 실제로 반영합니다 */
    if (cond.topN && out.rows && out.rows.length > cond.topN.n) {
      out.rows = cond.topN.dir === "top" ? out.rows.slice(0, cond.topN.n)
                                         : out.rows.slice(-cond.topN.n);
    }
    return decorate(out, cond, table);
  }

  /* ── 되묻기 — 단위가 분명하지 않을 때 ────────────────────────────────
     값을 마음대로 고르지 않습니다. 대신 각 해석이 몇 건을 남기는지 미리
     계산해 보여 주고 고르게 합니다. */
  function clarifyAnswer(base, table, scoped, cond) {
    const cl = cond.clarify, col = cl.metric;
    const opts = cl.options.map(function (o) {
      const th = Object.assign({}, cl.th);
      th[cl.side] = o.value;
      const chk = window.Units.isNoOp(scoped, col.key, th);
      return {
        label: o.label, unit: o.unit, value: o.value,
        kept: chk.kept, total: chk.total,
        hint: chk.kept + " / " + chk.total + "건" + (chk.noop ? " (전부 해당 — 걸러지지 않음)" : ""),
        /* 이 버튼을 누르면 단위를 명시해 다시 묻습니다.
           숫자만 바꾸고 "이상 · 이하" 같은 연산자는 그대로 둡니다 —
           통째로 갈아치우면 조건이 사라진 질문이 됩니다. */
        question: base.question.replace(cl.th.raw,
          cl.th.raw.replace(/^-?\d+(?:\.\d+)?/, o.value + (col.unit ? " " + col.unit : "")))
      };
    });
    const rg = window.Units.observedRange(scoped, col.key);
    return Object.assign(base, {
      kind: "clarify",
      headline: "\"" + cl.th.raw + "\" 를 어느 단위로 읽어야 할지 분명하지 않아 먼저 여쭙습니다. " +
        col.label + " 의 실측 범위는 " + (rg ? rg.min + " ~ " + rg.max : "알 수 없음") +
        (col.unit ? " " + col.unit : "") + " 입니다.",
      choices: opts,
      hints: opts.map(o => o.label + " 로 보면 → " + o.hint)
        .concat(["단위를 직접 적어 물어보셔도 됩니다 — 예: \"" + col.label + " 3 g/L 이상\"."]),
      note: cl.note + " 값을 임의로 바꾸지 않고 그대로 두었습니다.",
      suggestions: suggestList(table)
    });
  }

  /* ── help — "뭘 물어볼 수 있어?" ────────────────────────────────────
     데이터 요약(metaAnswer)과는 다른 질문입니다. 여기서는 "이 시스템이
     무엇을 할 수 있고 무엇을 못 하는지"를 답합니다. */
  function helpAnswer(base, table) {
    const byTeam = (window.DATA_TEAMS || []).map(function (t) {
      const cols = table.columns.filter(c => c.team === t.id && c.type === "num" &&
        window.AskTables.filledCount(table, c.key) > 0);
      return { ko: t.ko, cols: cols };
    }).filter(x => x.cols.length);

    const first = (byTeam[0] && byTeam[0].cols[0]) ? byTeam[0].cols[0].label : "Titer HCCF";
    const rg = dateRangeOf(table);
    const mon = rg ? rg.max.slice(0, 4) + "년 " + Number(rg.max.slice(5, 7)) + "월" : "2024년 12월";

    const examples = [
      "최고 · 최저 — \"" + first + " 가장 높은 배치는?\"",
      "평균 · 편차 — \"" + first + " 평균이랑 편차\"",
      "추이       — \"일자별 Titer 추이\"",
      "비교       — \"과제별 Total Yield 비교\"",
      "결측       — \"미입력이 가장 많은 항목은?\"",
      "목록 · 조건 — \"" + mon + " 배치 보여줘\" · \"Titer 1000 이상인 배치\" · \"Titer 상위 5개\""
    ];

    return Object.assign(base, {
      kind: "help",
      headline: "질문 유형 6가지(최고·최저 / 평균·편차 / 추이 / 비교 / 결측 / 목록·조건)를 " +
        "지원하고, 조회 가능한 측정 항목은 " + suggestList(table).length + "개입니다. " +
        "배치 이름 · 과제 · Study · 기간 · 값 조건을 섞어 물어보실 수 있습니다.",
      facts: byTeam.map(x => ({ k: x.ko, v: x.cols.length + "개 — " + x.cols.slice(0, 4).map(c => c.label).join(", ") +
        (x.cols.length > 4 ? " 외" : "") })),
      hints: examples,
      note: "아직 못 하는 것 — 규격 판정(Pass/Fail: 한계값 테이블 미도입) · " +
        "원인 분석(\"왜 낮았지?\") · 오늘 날짜 기준 상대 기간(\"지난달\"). " +
        "이런 질문에는 답 대신 그 사실을 알려 드립니다.",
      suggestions: suggestList(table)
    });
  }

  /* ── meta — 데이터셋 자체에 대한 질문 ────────────────────────────────
     값은 전부 데이터에서 셉니다. 목록을 코드에 적어 두면 원본이 바뀔 때
     화면만 옛날 이야기를 하게 됩니다. */
  function metaAnswer(base, table, rows) {
    const rg = dateRangeOf(table);
    const projects = {}, studies = {};
    table.rows.forEach(function (r) {
      if (r.project) projects[r.project] = (projects[r.project] || 0) + 1;
      if (r.study) studies[r.study] = (studies[r.study] || 0) + 1;
    });
    const byTeam = (window.DATA_TEAMS || []).map(function (t) {
      const cols = table.columns.filter(c => c.team === t.id && c.type === "num");
      const filled = cols.filter(c => window.AskTables.filledCount(table, c.key) > 0);
      return { team: t, ko: t.ko, total: cols.length, filled: filled.length };
    }).filter(x => x.total > 0);

    const facts = [
      { k: "배치", v: table.rows.length + "건" },
      { k: "기간", v: rg ? rg.min + " ~ " + rg.max : "미입력" },
      { k: "과제", v: Object.keys(projects).length + "개" },
      { k: "Study", v: Object.keys(studies).length + "개" },
      { k: "조회 가능 항목", v: suggestList(table).length + "개" }
    ];
    byTeam.forEach(x => facts.push({ k: x.ko + " 항목", v: x.filled + " / " + x.total + "개" }));

    const hints = [];
    Object.keys(projects).forEach(function (p) {
      const ss = Object.keys(studies).filter(s => table.rows.some(r => r.project === p && r.study === s));
      hints.push("과제 " + p + " — " + projects[p] + "건 · Study: " + (ss.join(", ") || "미지정"));
    });
    hints.push("예: \"" + (suggestList(table)[0] || "Titer") + " 가장 높은 배치는?\" · \"" +
      (rg ? rg.max.slice(0, 4) + "년 " + Number(rg.max.slice(5, 7)) + "월 배치 보여줘" : "전체 목록") + "\"");

    return Object.assign(base, {
      kind: "meta",
      headline: "이 데이터에는 배치 " + table.rows.length + "건이 있고, 기간은 " +
        (rg ? rg.min + " ~ " + rg.max : "미입력") + " 입니다. 과제 " +
        Object.keys(projects).length + "개 · Study " + Object.keys(studies).length +
        "개 · 조회 가능한 측정 항목은 " + suggestList(table).length + "개입니다.",
      facts: facts, hints: hints, suggestions: suggestList(table)
    });
  }

  /* ── 날짜 열 — "언제 배양한 거야?" ──────────────────────────────────── */
  function dateAnswer(base, table, rows, dateCols) {
    const cols = dateCols.slice(0, 2);
    const evCols = [{ key: "__label", label: "Batch" }];
    if (table.kind === "internal") evCols.push({ key: "project", label: "과제" }, { key: "study", label: "Study" });
    cols.forEach(c => evCols.push({ key: c.key, label: c.label }));

    const evRows = rows.slice(0, 15).map(function (r) {
      const o = { __label: r.__label };
      if (table.kind === "internal") { o.project = r.project; o.study = r.study; }
      cols.forEach(c => { o[c.key] = r[c.key] || "미입력"; });
      return o;
    });

    const ds = rows.map(r => r.date).filter(Boolean).sort();
    const headline = rows.length === 1
      ? rows[0].__label + " 은(는) " + (rows[0].date || "미입력") + " 에 배양을 시작해 " +
        (rows[0].endDate || "미입력") + " 에 종료했습니다." +
        (typeof rows[0].cultureDays === "number" ? " 배양 일수는 " + rows[0].cultureDays + "일입니다." : "")
      : base.scopeLabel + " 범위 " + rows.length + "건의 배양 시작일은 " +
        (ds.length ? ds[0] + " ~ " + ds[ds.length - 1] : "모두 미입력") + " 입니다.";

    return Object.assign(base, {
      kind: "date", headline: headline,
      facts: rows.length === 1 ? rowMeta(rows[0], table) : [
        { k: "대상", v: rows.length + "건" },
        { k: "가장 이른 시작", v: ds[0] || "미입력" },
        { k: "가장 늦은 시작", v: ds[ds.length - 1] || "미입력" }],
      rows: evRows, evidenceCols: evCols,
      note: "날짜는 원본의 Initial Date · End Date 입니다. 배양 경과일(D10 등)과는 다른 축입니다."
    });
  }

  /* ── 지표군 — "정제 전체" · "정제팀 데이터" · "분석 항목" ──────────────
     팀은 행이 아니라 볼 컬럼을 고릅니다. 28행 전부 배양공정팀 소속이라
     행으로 자르면 정제 · 분석이 0건이 되기 때문입니다. */
  function groupAnswer(base, table, rows, groups, cond) {
    const g = groups[0];
    const cols = g.columns.filter(c => rows.some(r => typeof r[c.key] === "number")).slice(0, 8);
    const empty = g.columns.filter(c => !rows.some(r => typeof r[c.key] === "number"));

    if (!cols.length) {
      return Object.assign(base, {
        ok: false, kind: "no-value",
        headline: g.label + " 의 항목 " + g.columns.length + "개는 " + base.scopeLabel +
          " 범위에서 모두 미입력입니다.",
        hints: ["항목: " + g.columns.map(c => c.label).join(", "),
                "값을 추정해 채우지 않습니다. 범위를 넓히면 기록된 배치가 있을 수 있습니다."],
        suggestions: suggestList(table)
      });
    }

    const evCols = [{ key: "__label", label: "Batch" }];
    if (table.kind === "internal") evCols.push({ key: "study", label: "Study" });
    cols.forEach(c => evCols.push({ key: c.key, label: c.label + (c.unit ? " (" + c.unit + ")" : "") }));

    const cap = cond && cond.topN ? cond.topN.n : 15;
    const evRows = rows.slice(0, cap).map(function (r) {
      const o = { __label: r.__label };
      if (table.kind === "internal") o.study = r.study;
      cols.forEach(c => { o[c.key] = (r[c.key] === null || r[c.key] === undefined) ? "미입력" : fmt(r[c.key], c); });
      return o;
    });

    const facts = cols.slice(0, 6).map(function (c) {
      const s = stats(values(rows, c.key));
      return { k: c.label, v: s ? fmt(s.mean, c) + " (n=" + s.n + ")" : "미입력" };
    });

    const notes = [];
    if (empty.length) notes.push("이 범위에서 값이 없는 항목 " + empty.length + "개는 표에서 뺐습니다 — " +
      empty.slice(0, 5).map(c => c.label).join(", ") + (empty.length > 5 ? " 외" : "") + ".");
    if (cols.some(c => c.group === "downstream")) notes.push("정제 항목은 원본에 컬럼이 없어 생성한 값입니다.");
    if (cols.length < g.columns.length - empty.length) notes.push("항목이 많아 앞 " + cols.length + "개만 표시했습니다.");

    return Object.assign(base, {
      kind: "group",
      headline: base.scopeLabel + " 범위 " + rows.length + "건의 " + g.label + " 항목 " +
        cols.length + "개를 표시합니다. 각 항목의 평균은 아래와 같습니다.",
      facts: facts, rows: evRows, evidenceCols: evCols, note: notes.join(" "),
      suggestions: cols.map(c => c.label)
    });
  }

  /* ── 행 자체 — "B045-2가 어느 과제 거야?" ───────────────────────────── */
  function entityAnswer(base, table, rows, missingAsked, askedEntity) {
    if (rows.length !== 1) {
      return Object.assign(base, {
        kind: "entity",
        headline: base.scopeLabel + " 범위에 배치가 " + rows.length +
          "건 있습니다. 한 건을 지목해 주시면 그 배치의 기록을 전부 펼쳐 드립니다.",
        facts: [{ k: "대상", v: rows.length + "건" }],
        rows: rows.slice(0, 15).map(r => ({ __label: r.__label, project: r.project, study: r.study, date: r.date })),
        evidenceCols: [{ key: "__label", label: "Batch" }, { key: "project", label: "과제" },
                       { key: "study", label: "Study" }, { key: "date", label: "시작일" }],
        suggestions: suggestList(table)
      });
    }
    const r = rows[0];
    const meta = rowMeta(r, table);
    const vals = [];
    table.columns.forEach(function (col) {
      if (col.group === "base") return;
      const v = r[col.key];
      if (v === null || v === undefined) return;
      vals.push({ k: col.label, v: fmt(v, col) });
    });
    /* "어느 과제 거야?" 는 소속을 먼저 답합니다 */
    const head = askedEntity && (r.project || r.study)
      ? r.__label + " 은(는) " + (r.project || "미지정") + " 과제 · " +
        (r.study || "미지정") + " Study 소속입니다. 기록된 값은 " + vals.length + "개입니다."
      : r.__label + " 의 기록된 값 " + vals.length + "개를 표시합니다.";

    return Object.assign(base, {
      kind: "entity", headline: head,
      facts: meta.concat(vals),
      focusLabels: [r.__label],
      note: (r.__unnamed ? r.__label + " 은(는) 원본에 배치번호(Exp. No.)가 비어 있어 가져올 때 부여한 임시 이름입니다. " : "") +
        (missingAsked.length
          ? missingAsked.join(" · ") + "은(는) 원본에 컬럼이 없어 표시할 수 없습니다. " : "") +
        "특정 항목만 보시려면 항목 이름을 넣어 다시 물어봐 주세요.",
      suggestions: suggestList(table)
    });
  }

  /* 항목 없이 물었을 때의 기본 답 — 범위를 유지한 채 있는 것을 보여 줍니다 */
  function overviewAnswer(base, table, rows, missingAsked) {
    const avail = suggestList(table);

    /* 1건으로 좁혀졌으면 그 배치의 기록된 값을 전부 펼칩니다 */
    if (rows.length === 1) {
      const r = rows[0];
      const facts = rowMeta(r, table).slice();
      table.columns.forEach(function (col) {
        if (col.group === "base") return;
        const v = r[col.key];
        if (v === null || v === undefined) return;
        facts.push({ k: col.label, v: fmt(v, col) });
      });
      return Object.assign(base, {
        kind: "overview",
        headline: r.__label + " 의 기록된 값 " + (facts.length - rowMeta(r, table).length) +
          "개를 표시합니다. 특정 항목을 물으시면 그 항목만 계산해 드립니다.",
        facts: facts,
        note: (missingAsked.length
          ? missingAsked.join(" · ") + "은(는) 원본에 컬럼이 없어 표시할 수 없습니다. "
          : "") + "질문에서 조회할 항목을 특정하지 못해 이 배치의 전체 기록을 펼쳤습니다.",
        suggestions: avail
      });
    }

    /* 여러 건이면 목록 — 값이 실제로 있는 대표 항목만 컬럼으로 붙입니다 */
    const preferred = ["cultureDays", "maxVCD", "finalViability", "titerHCCF", "downstream_totalYield"];
    const cols = preferred
      .map(k => table.columns.find(c => c.key === k))
      .filter(c => c && rows.some(r => typeof r[c.key] === "number"))
      .slice(0, 4);

    const evCols = [{ key: "__label", label: "Batch" }];
    if (table.kind === "internal") {
      evCols.push({ key: "project", label: "과제" }, { key: "study", label: "Study" }, { key: "date", label: "시작일" });
    }
    cols.forEach(c => evCols.push({ key: c.key, label: c.label + (c.unit ? " (" + c.unit + ")" : "") }));

    const evRows = rows.slice(0, 15).map(function (r) {
      const o = { __label: r.__label };
      if (table.kind === "internal") { o.project = r.project; o.study = r.study; o.date = r.date; }
      cols.forEach(c => { o[c.key] = (r[c.key] === null || r[c.key] === undefined) ? "미입력" : fmt(r[c.key], c); });
      return o;
    });

    return Object.assign(base, {
      kind: "overview",
      headline: base.scopeLabel + " 범위의 배치 " + rows.length + "건을 표시합니다. " +
        "질문에서 특정 항목을 찾지 못해 목록으로 보여 드립니다.",
      facts: [{ k: "대상", v: rows.length + "건" }, { k: "범위", v: base.scopeLabel }],
      rows: evRows, evidenceCols: evCols,
      note: (missingAsked.length
        ? missingAsked.join(" · ") + "은(는) 원본에 컬럼이 없어 표시할 수 없습니다. " : "") +
        "항목 이름을 넣어 다시 물으면 그 항목만 계산합니다 (예: \"" +
        (avail[0] || "Titer") + " 평균\").",
      suggestions: avail
    });
  }

  /* 빈 질문일 때 보여 줄 실제로 동작하는 예시 — 지어내지 않고 데이터에서 만듭니다 */
  function sampleQuestions(table) {
    const avail = suggestList(table);
    const rg = dateRangeOf(table);
    const out = [];
    if (avail[0]) out.push(avail[0] + " 가장 높은 배치는?");
    if (avail[0]) out.push(avail[0] + " 평균이랑 편차");
    if (rg) out.push(rg.max.slice(0, 4) + "년 " + Number(rg.max.slice(5, 7)) + "월 배치 보여줘");
    out.push("미입력이 가장 많은 항목은?");
    return out;
  }

  function suggestList(table) {
    return window.AskTables.numericColumns(table)
      .filter(c => window.AskTables.filledCount(table, c.key) > 0)
      .map(c => c.label);
  }

  /* 그 항목이 이 범위 밖에는 있는지 알려 줍니다 — "없다"로 끝내지 않기 위해 */
  function filledElsewhere(table, metric, rows) {
    const all = table.rows.filter(r => typeof r[metric.key] === "number" && isFinite(r[metric.key]));
    const hints = [];
    if (all.length) {
      hints.push(metric.label + " 는 전체 데이터에는 " + all.length + "건 기록돼 있습니다 (예: " +
        all.slice(0, 3).map(r => r.__label).join(", ") + "). 범위를 빼고 다시 물어보세요.");
    } else {
      hints.push(metric.label + " 는 원본 전체에서 한 건도 기록돼 있지 않습니다. 값을 추정해 채우지 않습니다.");
    }
    const alt = table.columns.filter(c => c.type === "num" && c.group === metric.group &&
      c.key !== metric.key && rows.some(r => typeof r[c.key] === "number")).slice(0, 3);
    if (alt.length) hints.push("같은 그룹에서 값이 있는 항목 — " + alt.map(c => c.label).join(", ") + ".");
    return hints;
  }

  /* ── 최고 / 최저 ─────────────────────────────────────────────────────── */
  function extremeAnswer(base, table, rows, metric, intent, alt, askedCondition, missingAsked, scope) {
    const withVal = rows.filter(r => typeof r[metric.key] === "number" && isFinite(r[metric.key]));
    if (!withVal.length) {
      return Object.assign(base, {
        ok: false, kind: "no-value",
        headline: metric.label + " 값이 기록된 행이 " + base.scopeLabel + " 범위에 " +
          rows.length + "건 중 하나도 없습니다.",
        hints: filledElsewhere(table, metric, rows),
        suggestions: suggestList(table)
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

    /* 배치번호가 원본에 없던 행이면 그 사실을 밝힙니다 — 지어낸 이름을
       실제 배치번호처럼 읽게 두면 안 됩니다 (원본 Exp. No. 공란 1건). */
    if (top.__unnamed) {
      notes.push(top.__label + " 은(는) 원본에 배치번호(Exp. No.)가 비어 있어 " +
        "가져올 때 부여한 임시 이름입니다. 값은 원본 그대로이며, 행을 빼지 않고 그대로 셉니다.");
    }

    return Object.assign(base, {
      kind: "extreme", headline: headline, facts: facts, context: ctx,
      stats: s, metric: { key: metric.key, label: metric.label, unit: metric.unit },
      rows: sorted.slice(0, 8).map(r => evidence(r, table, metric)),
      evidenceCols: evidenceCols(table, metric),
      focusLabels: [top.__label],
      note: notes.join(" ")
    });
  }

  /* ── 평균·분포 ───────────────────────────────────────────────────────── */
  function statAnswer(base, table, rows, metric, alt) {
    const vals = values(rows, metric.key);
    const s = stats(vals);
    if (!s) {
      return Object.assign(base, { ok: false, kind: "no-value",
        headline: metric.label + " 값이 기록된 행이 " + base.scopeLabel + " 범위에 " +
          rows.length + "건 중 하나도 없어 평균을 낼 수 없습니다.",
        hints: filledElsewhere(table, metric, rows),
        suggestions: suggestList(table) });
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
  function listAnswer(base, table, rows, metric, alt, scope, cond) {
    const topN = cond && cond.topN ? cond.topN : null;
    const cap = topN ? topN.n : 12;
    const withVal = rows.filter(r => typeof r[metric.key] === "number" && isFinite(r[metric.key]));
    let sorted = scope.recent
      ? rows.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
      : withVal.slice().sort((a, b) => b[metric.key] - a[metric.key]);
    if (topN && topN.dir === "bottom") sorted = sorted.slice().reverse();
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
      rows: sorted.slice(0, cap).map(r => evidence(r, table, metric)),
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
        headline: "비교할 축(과제 · Study · 팀)을 찾지 못했습니다.",
        hints: ["업로드한 표에는 과제 · Study 구분이 없어 그룹을 나눌 수 없습니다.",
                "사내 데이터로 바꾸면 과제별 · Study별 비교가 가능합니다."],
        suggestions: suggestList(table) });
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
      const axisKo0 = axisKey === "project" ? "과제" : axisKey === "study" ? "Study" : "팀";
      return Object.assign(base, { ok: false, kind: "no-axis",
        headline: "비교하려면 " + metric.label + " 값이 있는 " + axisKo0 +
          "이(가) 2개 이상 필요한데, 지금 범위(" + base.scopeLabel + ")에는 " +
          summary.length + "개뿐입니다.",
        hints: [summary.length === 1
          ? "값이 있는 " + axisKo0 + "은(는) " + summary[0].group + " 하나뿐입니다. 범위를 넓혀 다시 물어보세요."
          : metric.label + " 값이 기록된 행이 이 범위에 없습니다.",
          "범위를 빼고 \"" + axisKo0 + "별 " + metric.label + " 비교\"로 물으면 전체에서 비교합니다."],
        suggestions: suggestList(table) });
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
        headline: "업로드한 표에는 일자별 추이를 계산할 축이 없습니다.",
        hints: ["일자별 추이는 사내 데이터의 Titer D10~D20 컬럼으로만 계산합니다.",
                "업로드한 표에서는 항목별 평균 · 최고 · 비교를 대신 물어보실 수 있습니다."],
        suggestions: suggestList(table) });
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
      /* 전체에는 있는데 이 범위에만 없는 것인지 구분해 줍니다 */
      const anyAll = (window.DATA_BATCHES || []).filter(function (b) {
        const tt = b.upstream && b.upstream.titer;
        return tt && days.filter(d => typeof tt[d] === "number").length > 1;
      });
      return Object.assign(base, { ok: false, kind: "no-trend",
        headline: "일자별 Titer 가 2개 이상 기록된 배치가 " + base.scopeLabel + " 범위에 없습니다.",
        hints: anyAll.length
          ? ["전체 데이터에는 " + anyAll.length + "건이 있습니다 (예: " +
             anyAll.slice(0, 3).map(b => b.expNo || b.id).join(", ") + ").",
             "범위를 빼고 \"일자별 Titer 추이\"로 다시 물어보세요."]
          : ["원본에 Titer D10~D20 이 2개 이상 기록된 배치가 없습니다.",
             "최종 Titer(Titer HCCF)로는 조회하실 수 있습니다."],
        suggestions: suggestList(table) });
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
    _detectMetrics: detectMetrics, _fmt: fmt, NOT_RECORDED,
    _parseConditions: parseConditions, _applyConditions: applyConditions,
    _dateRangeOf: dateRangeOf, _detectScope: detectScope
  };
})();
