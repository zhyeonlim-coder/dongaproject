/* ==========================================================================
   ai/commands.js — 자연어로 화면을 움직입니다  ·  window.AICommands

   "대시보드 보여줘" · "데이터 조회로 이동" · "배양공정팀 선택해줘" ·
   "새 Study 창 열어줘" 를 알아듣고 실제로 그 화면을 엽니다.

   ── 왜 바로 실행하나 ────────────────────────────────────────────────────
   조회 결과를 바꾸는 조작(필터 · 정렬)은 지금도 [적용] 버튼을 눌러야
   실행됩니다. 보던 표가 말없이 바뀌면 사용자는 자기가 읽던 숫자를 잃기
   때문입니다.

   여기 있는 것은 성질이 다릅니다 — **이동과 선택**입니다. 결과가 눈에
   바로 보이고, 한 번 더 말하면 되돌아오고, 데이터를 건드리지 않습니다.
   그래서 되묻지 않고 바로 하고, 무엇을 했는지 말로 남깁니다.

   ── 여기 넣지 않은 것 ───────────────────────────────────────────────────
   저장 · 삭제 · 전체 비우기 · 값 입력은 이 목록에 없습니다. 자연어는
   "무엇을" 에서 자주 틀리고, 그 종류는 틀렸을 때 되돌릴 수 없습니다.
   그런 요청은 알아듣되 "그 버튼은 직접 눌러 주세요" 라고 답합니다.

   ── 왜 말을 사전으로 두나 ───────────────────────────────────────────────
   페이지 목록은 shell2 의 NAV 와 같아야 합니다. 두 벌을 두면 메뉴가 바뀔
   때 한쪽만 따라가고, 사용자는 "없는 화면으로 보냈다" 를 보게 됩니다.
   그래서 주소는 NAV 를 정본으로 읽고, 부르는 말만 여기서 더합니다.
   ========================================================================== */

window.AICommands = (function () {
  "use strict";

  /* 화면 — 주소는 shell2.NAV 가 정본이고, 여기에는 "부르는 말" 만 둡니다.
     NAV 에서 내려온 화면(데이터 탐색)은 주소를 직접 적습니다 — 메뉴에는
     없지만 주소로 열면 동작하고, 사용자가 이름을 부르면 데려가야 합니다. */
  const PAGE_WORDS = {
    dashboard: ["대시보드", "dashboard", "현황", "요약 화면", "홈", "메인"],
    ebr:       ["data 입력", "데이터 입력", "입력 화면", "입력화면", "ebr",
                "기록 입력", "입력 표", "입력표", "입력 폼", "입력폼", "값 입력"],
    data:      ["데이터 조회", "데이터조회", "조회 화면", "조회화면", "조회 표",
                "데이터 표", "데이터 목록"],
    schedule:  ["일정 관리", "일정관리", "일정", "스케줄", "schedule", "달력", "캘린더"],
    hub:       ["doe", "intelligence", "인텔리전스", "ai 검색", "자연어 검색",
                "troubleshooting", "wiki", "위키", "지식"],
    booking:   ["장비 예약", "장비예약", "예약", "booking"],
    explorer:  ["데이터 탐색", "탐색 화면", "explorer"]
  };
  const FALLBACK_HREF = {
    dashboard: "dashboard.html", ebr: "ebr.html", data: "data.html",
    schedule: "schedule.html", hub: "hub.html", booking: "booking.html",
    explorer: "explorer.html"
  };
  const PAGE_KO = {
    dashboard: "대시보드", ebr: "Data 입력", data: "데이터 조회",
    schedule: "일정 관리", hub: "DoE & Intelligence", booking: "장비 예약",
    explorer: "데이터 탐색"
  };

  /* 페이지 안의 탭 — 그 페이지에서만 뜻이 있습니다 */
  const SECTIONS = {
    hub: [
      { key: "doe",  ko: "DoE 조건 설계 & 분석", words: ["doe 설계", "doe 조건", "조건 설계", "설계"] },
      { key: "ai",   ko: "AI 검색",             words: ["ai 검색", "자연어 검색", "문헌 검색"] },
      { key: "wiki", ko: "Troubleshooting & Wiki", words: ["wiki", "위키", "트러블", "troubleshooting", "lesson"] },
      { key: "spec", ko: "규격(Spec) 관리",      words: ["규격", "spec 관리"] }
    ],
    data: [
      { key: "sample",  ko: "시료별",    words: ["시료별", "샘플별", "시료 별"] },
      { key: "compare", ko: "시료 비교", words: ["시료 비교", "샘플 비교", "비교 보기", "나란히"] }
    ]
  };

  /* 팀 — 이름은 DATA_TEAMS 가 정본입니다. 줄여 부르는 말만 더합니다. */
  const TEAM_WORDS = {
    upstream:   ["배양공정팀", "배양팀", "배양 공정", "배양", "업스트림", "upstream"],
    downstream: ["정제공정팀", "정제팀", "정제 공정", "정제", "다운스트림", "downstream"],
    analytics:  ["바이오분석팀", "분석팀", "바이오 분석", "분석", "analytics", "qc"]
  };

  /* ── 말투 ──────────────────────────────────────────────────────────────
     "이동" 과 "선택" 을 가릅니다. 가르지 않으면 "정제 데이터 보여줘" 가
     팀 선택으로 읽혀, 물어본 값 대신 화면만 바뀝니다 — 사용자는 답을
     받지 못한 채 화면을 잃습니다.

       화면 이름 + 보여줘   → 이동   (대시보드에는 "조회할 값" 이 없습니다)
       팀 이름  + 보여줘    → 조회   (지금까지 하던 대로 값을 답합니다)
       팀 이름  + 선택해줘  → 선택   (고르라고 분명히 말한 경우)
  */
  const GO_WORDS = ["이동", "가줘", "가 줘", "가자", "로 가", "으로 가", "열어", "열기",
                    "띄워", "띄우", "전환", "들어가", "보여줘", "보여 줘", "보여주",
                    "보여 주", "켜줘", "켜 줘", "화면으로", "페이지로", "탭으로", "불러와"];
  const PICK_WORDS = ["선택", "골라", "고르", "바꿔", "바꾸", "변경", "설정", "지정",
                      "맞춰", "로 해", "으로 해", "필터"];
  const RESET_WORDS = ["초기화", "전체 보기", "전체보기", "다 보여", "모두 보여",
                       "필터 해제", "조건 해제", "필터 지우"];
  const NEW_STUDY_WORDS = ["새 study", "새study", "새 스터디", "새스터디",
                           "study 등록", "스터디 등록", "study 만들", "스터디 만들",
                           "study 추가", "스터디 추가", "새 과제 study"];

  /* 자연어로 맡기면 안 되는 것 — 알아듣고, 하지 않고, 그렇다고 말합니다 */
  const DANGER = [
    { words: ["db 비우", "db 비워", "디비 비우", "디비 비워", "데이터베이스 비우",
              "전체 삭제", "전부 삭제", "다 지워", "모두 삭제", "데이터 삭제",
              "데이터 지워", "싹 지워"],
      ko: "데이터 삭제 · DB 비우기",
      why: "되돌릴 수 없는 일이라 말로는 하지 않습니다. /ops/backup.html 에서 " +
           "스냅샷을 먼저 내려받은 뒤 직접 눌러 주세요." },
    { words: ["저장해줘", "전체 저장", "저장 눌러", "제출해줘"],
      ko: "값 저장",
      why: "무엇을 적었는지는 화면에서 보고 누르셔야 합니다 — 적은 사람이 " +
           "확인하지 않은 값이 이력에 남으면 되돌릴 근거가 없어집니다." }
  ];

  function low(s) { return String(s === null || s === undefined ? "" : s).toLowerCase(); }
  function hit(t, words) { return words.some(w => t.indexOf(low(w)) > -1); }

  /* 가장 긴 말이 걸린 것을 고릅니다 — "데이터 입력" 과 "데이터" 가 같이
     걸리면 긴 쪽이 사용자가 말한 것입니다 */
  function bestOf(t, dict) {
    let best = null, len = 0;
    Object.keys(dict).forEach(function (k) {
      dict[k].forEach(function (w) {
        const s = low(w);
        if (t.indexOf(s) > -1 && s.length > len) { best = k; len = s.length; }
      });
    });
    return best ? { key: best, len: len } : null;
  }

  function teamKo(id) {
    const t = (window.DATA_TEAMS || []).find(x => x && x.id === id);
    return t ? t.ko : id;
  }
  function hrefOf(pageId) {
    /* shell2 의 NAV 를 먼저 봅니다 — 메뉴가 바뀌면 여기도 따라옵니다 */
    try {
      const nav = (window.Shell && window.Shell.navItems) ? window.Shell.navItems() : null;
      const n = nav && nav.find(x => x.id === pageId);
      if (n && n.href) return n.href;
    } catch (e) { /* NAV 를 못 읽으면 아래 기본값 */ }
    return FALLBACK_HREF[pageId] || null;
  }
  function currentPage() {
    try { return (window.AIContext.get() || {}).page || null; } catch (e) { return null; }
  }

  /* ══════════════════════════════════════════════════════════════════════
     읽기 — 명령이면 계획을, 아니면 null
     ══════════════════════════════════════════════════════════════════════ */
  function detect(text) {
    const t = low(text).replace(/\s+/g, " ").trim();
    if (!t) return null;

    for (let i = 0; i < DANGER.length; i++) {
      if (hit(t, DANGER[i].words)) {
        return { kind: "refuse", ko: DANGER[i].ko, why: DANGER[i].why };
      }
    }

    const go = hit(t, GO_WORDS);
    const pick = hit(t, PICK_WORDS);

    /* 새 Study 창 — 만들라는 말과 함께여야 합니다 */
    if (hit(t, NEW_STUDY_WORDS) && (go || pick || hit(t, ["만들", "등록", "추가", "창"]))) {
      return { kind: "newStudy" };
    }

    const page = bestOf(t, PAGE_WORDS);
    const team = bestOf(t, TEAM_WORDS);

    /* 화면 이동 — 화면 이름을 불렀고, 가자는 말이 있을 때만 */
    if (page && go) {
      /* 그 화면의 탭까지 말했으면 함께 엽니다 ("hub 의 AI 검색 탭") */
      const sec = sectionOf(page.key, t);
      return { kind: "navigate", page: page.key, section: sec ? sec.key : null,
               sectionKo: sec ? sec.ko : null };
    }

    /* 탭만 말한 경우 — 지금 화면의 탭이면 그 탭을 엽니다 */
    const here = currentPage();
    const hereSec = here ? sectionOf(here, t) : null;
    if (hereSec && (go || pick)) {
      return { kind: "section", page: here, key: hereSec.key, ko: hereSec.ko };
    }

    /* 팀 선택 — "고르라" 고 분명히 말했을 때만 (보여줘 는 조회로 둡니다) */
    if (team && pick) {
      const toInput = hit(t, ["입력", "적을", "기록", "시트", "표 열"]);
      return { kind: "team", team: team.key, toInput: toInput };
    }

    /* Study 선택 */
    const study = studyOf(t);
    if (study && pick) return { kind: "study", id: study.id, name: study.name };

    /* 과제 선택 */
    const prj = projectOf(t);
    if (prj && pick) return { kind: "project", id: prj.id, ko: prj.code || prj.id };

    /* 조건 초기화 */
    if (hit(t, RESET_WORDS) && (hit(t, ["필터", "조건", "범위", "선택"]) || hit(t, ["초기화"]))) {
      return { kind: "reset" };
    }

    return null;
  }

  function sectionOf(pageId, t) {
    const list = SECTIONS[pageId];
    if (!list) return null;
    let best = null, len = 0;
    list.forEach(function (s) {
      s.words.forEach(function (w) {
        const x = low(w);
        if (t.indexOf(x) > -1 && x.length > len) { best = s; len = x.length; }
      });
    });
    return best;
  }

  /* Study · 과제는 사용자가 만든 이름이라 사전에 적을 수 없습니다 —
     지금 등록된 것에 대고 맞춥니다 (대소문자 · 공백 · 붙임표 무시). */
  function studyOf(t) {
    const list = (window.DATA_STUDIES || []).filter(s => s && s.name);
    let best = null, len = 0;
    list.forEach(function (s) {
      if (!nameHit(t, s.name)) return;
      if (String(s.name).length > len) { best = s; len = String(s.name).length; }
    });
    return best;
  }
  function projectOf(t) {
    const list = (window.DATA_PROJECTS || []);
    return list.find(p => p && ((p.code && nameHit(t, p.code)) ||
                               (p.name && nameHit(t, p.name)))) || null;
  }
  /* 이름 맞추기는 조회 엔진과 같은 함수를 씁니다 — 두 벌을 두면 챗봇이
     찾는 이름과 조회가 찾는 이름이 갈립니다 */
  function nameHit(t, name) {
    if (window.AskEngine && window.AskEngine._labelHit) {
      return window.AskEngine._labelHit(t, name);
    }
    return low(t).indexOf(low(name)) > -1;
  }

  /* ══════════════════════════════════════════════════════════════════════
     실행 — 사용자가 실제로 누르는 길을 그대로 지납니다

     상태를 여기서 직접 만지지 않습니다. Scope 의 설정 함수와 화면이
     등록한 훅만 씁니다. 여기서 DOM 을 흉내 내면 화면 구조가 조금 바뀔
     때마다 엉뚱한 것을 건드리고, 그 사고가 조용히 지나갑니다.
     ══════════════════════════════════════════════════════════════════════ */

  /* 화면을 옮기면 이 대화는 사라집니다 (페이지가 다시 로드됩니다).
     무엇을 했는지 한 줄을 남겨 두고, 새 화면의 패널이 그것을 먼저
     보여 줍니다 — 그러지 않으면 사용자는 바뀐 화면만 보고 "왜 바뀌었지"
     를 혼자 추측하게 됩니다. */
  const CARRY_KEY = "hub.ai.lastAction";
  function carry(msg) {
    try {
      sessionStorage.setItem(CARRY_KEY, JSON.stringify({ msg: msg, at: Date.now() }));
    } catch (e) { /* 저장소가 막힌 환경 — 메시지만 못 남기고 이동은 됩니다 */ }
  }
  function takeCarried() {
    try {
      const raw = sessionStorage.getItem(CARRY_KEY);
      if (!raw) return null;
      sessionStorage.removeItem(CARRY_KEY);
      const o = JSON.parse(raw);
      /* 오래된 것은 버립니다 — 어제 눌렀던 것이 오늘 아침에 뜨면 안 됩니다 */
      if (!o || !o.msg || Date.now() - (o.at || 0) > 20000) return null;
      return o.msg;
    } catch (e) { return null; }
  }

  function run(plan) {
    if (!plan) return { ok: false, message: "무엇을 할지 읽지 못했습니다." };

    if (plan.kind === "refuse") {
      return { ok: false, refused: true,
               message: plan.ko + " 는 챗봇이 대신 하지 않습니다. " + plan.why };
    }

    if (plan.kind === "newStudy")  return openNewStudy();
    if (plan.kind === "navigate")  return goPage(plan);
    if (plan.kind === "section")   return goSection(plan);
    if (plan.kind === "team")      return pickTeam(plan);
    if (plan.kind === "study")     return pickStudy(plan);
    if (plan.kind === "project")   return pickProject(plan);
    if (plan.kind === "reset")     return doReset();

    return { ok: false, message: "아직 할 수 없는 요청입니다: " + plan.kind };
  }

  /* 새 Study 창 — 만드는 창은 Data 입력 화면이 가지고 있습니다.
     다른 화면에서 부르면 그 화면으로 옮긴 뒤 열립니다 (#new-study).
     여는 것까지만 합니다 — 이름을 적고 [등록] 을 누르는 것은 사용자입니다. */
  function openNewStudy() {
    const sel = window.Scope ? window.Scope.get() : {};
    if (!sel.scopeId) {
      return { ok: false, message: "과제를 먼저 골라야 Study 를 만들 수 있습니다 — " +
        "Study 는 과제 아래에 생깁니다." };
    }
    const h = window.AIContext && window.AIContext.hook("newStudy");
    if (h) {
      try {
        h();
        return { ok: true, message: "새 Study 등록 창을 열었습니다. " +
          "이름을 적고 [등록] 을 누르면 만들어집니다 — 등록은 직접 눌러 주세요." };
      } catch (e) { /* 아래 이동 경로로 */ }
    }
    const msg = "Data 입력 화면으로 옮겨 새 Study 등록 창을 열었습니다.";
    carry(msg);
    setTimeout(function () { location.href = hrefOf("ebr") + "#new-study"; }, 450);
    return { ok: true, message: msg, navigating: true };
  }

  function goPage(plan) {
    const href = hrefOf(plan.page);
    if (!href) return { ok: false, message: "그 화면의 주소를 찾지 못했습니다." };
    const ko = PAGE_KO[plan.page] || plan.page;

    /* 이미 그 화면이면 옮기지 않습니다 — 새로 로드하면 사용자가 보던
       자리(스크롤 · 접은 칸)를 잃습니다. 탭만 말했으면 탭은 엽니다. */
    if (currentPage() === plan.page) {
      if (plan.section) {
        const r = goSection({ page: plan.page, key: plan.section, ko: plan.sectionKo });
        if (r.ok) return r;
      }
      return { ok: true, message: "이미 [" + ko + "] 화면입니다." };
    }

    const url = href + (plan.section ? "#" + plan.section : "");
    const msg = "요청하신 [" + ko + "]" +
      (plan.sectionKo ? " · " + plan.sectionKo : "") + " 화면으로 이동했습니다.";
    carry(msg);
    /* 대화창에 완료 문장이 한 번 보인 뒤 옮깁니다 — 바로 옮기면 사용자는
       자기 말이 전달됐는지 모르는 채 화면이 바뀌는 것만 봅니다. */
    setTimeout(function () { location.href = url; }, 450);
    return { ok: true, message: msg, navigating: true };
  }

  function goSection(plan) {
    const ko = plan.ko || plan.key;
    /* 화면이 등록해 둔 탭 전환을 씁니다. 없으면 부제 메뉴의 그 버튼을
       눌러 줍니다 — 사용자가 누르는 바로 그 버튼입니다. */
    const h = window.AIContext && window.AIContext.hook("section");
    if (h) {
      try { h(plan.key); return { ok: true, message: "[" + ko + "] 탭을 열었습니다." }; }
      catch (e) { /* 아래 버튼 경로로 */ }
    }
    const btn = document.querySelector('#subnav [data-key="' + plan.key + '"]');
    if (btn) { btn.click(); return { ok: true, message: "[" + ko + "] 탭을 열었습니다." }; }
    return { ok: false, message: "이 화면에서는 [" + ko + "] 탭을 찾지 못했습니다." };
  }

  function pickTeam(plan) {
    if (!window.Scope || !window.Scope.setTeam) {
      return { ok: false, message: "이 화면에는 팀 선택이 없습니다." };
    }
    const sel = window.Scope.get();
    if (!sel.scopeId) {
      return { ok: false, message: "과제를 먼저 골라야 팀을 바꿀 수 있습니다 — " +
        "상단 셀렉터에서 과제를 고르거나 \"DA-1234 선택해줘\" 라고 말해 주세요." };
    }
    /* 화면의 규칙과 같습니다 — Study 가 정해지기 전에는 팀만 바꿔도 열
       표가 없습니다. 바꿔 놓고 아무 일도 안 일어나면 사용자는 명령이
       먹지 않은 것으로 읽습니다. */
    if (!sel.studyId) {
      return { ok: false, message: "Study 를 먼저 골라야 팀을 바꿀 수 있습니다 " +
        "(과제 → Study → 팀 → 시료 순서입니다). \"<Study 이름> 선택해줘\" 라고 말해 주세요." };
    }

    window.Scope.setTeam(plan.team);
    const ko = teamKo(plan.team);

    if (plan.toInput && currentPage() !== "ebr") {
      const msg = "[" + ko + "] 으로 바꾸고 Data 입력 화면을 열었습니다.";
      carry(msg);
      setTimeout(function () { location.href = hrefOf("ebr"); }, 450);
      return { ok: true, message: msg, navigating: true };
    }
    return { ok: true, message: "요청하신 [" + ko + "] 으로 바꿨습니다. " +
      "이 화면이 그 팀 기준으로 다시 그려졌습니다." +
      (currentPage() === "ebr" ? " 입력 표가 그 팀 서식으로 열렸습니다." : "") };
  }

  function pickStudy(plan) {
    if (!window.Scope || !window.Scope.setStudy) {
      return { ok: false, message: "이 화면에는 Study 선택이 없습니다." };
    }
    const s = (window.DATA_STUDIES || []).find(x => x && x.id === plan.id);
    if (!s) return { ok: false, message: "그 Study 를 찾지 못했습니다." };
    /* Study 는 과제 하위입니다 — 과제가 다르면 과제까지 함께 옮깁니다.
       Study 만 꽂으면 상단 셀렉터가 두 단계가 어긋난 상태로 남습니다. */
    const sel = window.Scope.get();
    if (s.projectId && sel.scopeId !== s.projectId) {
      window.Scope.setScope("project", s.projectId);
    }
    window.Scope.setStudy(s.id);
    return { ok: true, message: "요청하신 Study [" + (s.name || s.id) + "] 를 선택했습니다." };
  }

  function pickProject(plan) {
    if (!window.Scope || !window.Scope.setScope) {
      return { ok: false, message: "이 화면에는 과제 선택이 없습니다." };
    }
    window.Scope.setScope("project", plan.id);
    return { ok: true, message: "요청하신 과제 [" + plan.ko + "] 를 선택했습니다. " +
      "Study 는 다시 고르셔야 합니다 (과제를 바꾸면 하위 선택이 비워집니다)." };
  }

  function doReset() {
    if (!window.Scope || !window.Scope.clearFilters) {
      return { ok: false, message: "이 화면에는 지울 조건이 없습니다." };
    }
    const n = window.Scope.activeCount ? window.Scope.activeCount() : null;
    window.Scope.clearFilters();
    return { ok: true, message: "조회 조건을 지웠습니다" +
      (n ? " (" + n + "개 걸려 있었습니다)" : "") + ". 과제와 Study 선택은 그대로입니다." };
  }

  /* 무엇을 말할 수 있는지 — 패널의 추천 질문이 씁니다 */
  function examples() {
    return ["대시보드 보여줘", "데이터 조회로 이동", "배양공정팀 선택해줘",
            "새 Study 창 열어줘"];
  }

  return { detect: detect, run: run, examples: examples,
           takeCarried: takeCarried,
           /* 검사용 */
           _pages: PAGE_WORDS, _teams: TEAM_WORDS, _sections: SECTIONS };
})();
