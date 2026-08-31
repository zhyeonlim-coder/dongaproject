/* ==========================================================================
   ask.js — AI 자연어 검색 화면  ·  window.Ask

   한 검색창에서 두 가지를 받습니다.

     · 사내 데이터 질문  → ask-engine.js 가 실제 행을 추려 계산 (브라우저)
     · 외부 문헌 질문    → lit-api.js 가 Europe PMC · Crossref 를 실시간 검색

   자동 분기이며, 사용자가 직접 고를 수도 있습니다.

   답변 문장은 두 단계입니다. 먼저 엔진이 계산한 결정론적 문장을 즉시 띄우고,
   /api/narrate 가 살아 있으면 Claude 가 다듬은 문장으로 바꿔 답니다. 원문은
   접어서 남겨 두어 언제든 대조할 수 있게 합니다 — 숫자는 어느 쪽이든 같습니다.

   상태를 모듈이 들고 있어 탭을 옮겼다 돌아와도 결과가 살아남습니다.
   ========================================================================== */

window.Ask = (function () {
  "use strict";

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const S = {
    q: "",
    mode: "auto",          // auto | data | lit
    tableId: "internal",
    busy: false,
    result: null,          // 내부 조회 결과
    lit: null,             // 외부 검색 결과
    narration: null,       // { text, model } | null
    narrating: false,
    error: null,
    uploadMsg: null,
    prev: null,           // 직전 질의의 범위·항목 (후속 질문이 이어받습니다)
    turns: [],            // 최근 3턴 (LLM 에는 2턴만 요약으로 전달)
    debug: null,          // 경로·슬롯·소요 시간 (개발 모드에서만 표시)
    lastWasClarify: false,// 되묻기에 답하지 않고 새 문장을 던졌는지 판정용
    lastAnswerAt: null,   // 직전 답변 시각 (즉시 재질문 감지)
    lastQuestion: null
  };

  /* 답을 받고 이 시간 안에 다른 질문을 던지면 "답이 만족스럽지 않았다"로 봅니다 */
  const REQUERY_MS = 30000;

  /* 개발 모드 — ?dev=1 또는 localStorage 로 켭니다. 배포 화면에는 안 뜹니다. */
  const DEV = (function () {
    try {
      if (/[?&]dev=1/.test(location.search)) { localStorage.setItem("hub.dev", "1"); return true; }
      if (/[?&]dev=0/.test(location.search)) { localStorage.removeItem("hub.dev"); return false; }
      return localStorage.getItem("hub.dev") === "1";
    } catch (e) { return false; }
  })();

  /* ── 온보딩 예시 ──────────────────────────────────────────────────────
     처음 쓰는 연구원은 무엇을 물을 수 있는지 모릅니다. 지원하는 의도 6가지를
     하나씩, 실제로 동작하는 문장으로 놓습니다.

     문항을 코드에 박지 않고 데이터에서 만듭니다 — 원본이 바뀌면 예시도
     같이 바뀌어야 "눌렀는데 0건" 이 나오지 않습니다. */
  function onboardingChips() {
    const t = window.AskTables.internal();
    const names = window.AskEngine.knownMetrics(t);
    const pick = (re, fb) => names.find(n => re.test(n)) || fb || names[0] || "Titer HCCF";
    const titer = pick(/titer/i);
    const yieldCol = pick(/total yield|수율/i, titer);
    const via = pick(/viability/i, titer);
    const ds = t.rows.map(r => r.date).filter(Boolean).sort();
    const last = ds.length ? ds[ds.length - 1] : null;
    const month = last ? last.slice(0, 4) + "년 " + Number(last.slice(5, 7)) + "월" : "";

    return [
      { ko: "최고 · 최저", q: titer + " 가장 높은 배치는?" },
      { ko: "평균 · 편차", q: via + " 평균이랑 편차" },
      { ko: "추이",       q: "일자별 Titer 추이" },
      { ko: "비교",       q: "과제별 " + yieldCol + " 비교" },
      { ko: "결측",       q: "미입력이 가장 많은 항목은?" },
      { ko: "목록 · 조건", q: month ? month + " 배치 보여줘" : yieldCol + " 상위 5개" }
    ];
  }

  /* ══════════════════════════════════════════════════════════════════════
     화면
     ══════════════════════════════════════════════════════════════════════ */
  function view() {
    return searchCard() + '<div id="ask-out">' + resultBlock() + "</div>" + sourceCard();
  }

  function searchCard() {
    const tables = window.AskTables.all();
    return '<section class="card" style="margin-bottom:var(--s-4)"><div class="card-body">' +

      '<div class="ask-modes" role="group" aria-label="검색 대상">' +
        [["auto", "자동 판별"], ["data", "사내 실험 데이터"], ["lit", "외부 학술 문헌"]]
          .map(([k, ko]) => '<button class="ask-mode" data-mode="' + k + '" aria-pressed="' +
            (S.mode === k) + '">' + esc(ko) + "</button>").join("") +
      "</div>" +

      '<div class="ai-bar" style="margin-top:var(--s-3)">' +
        '<span class="ai-bar-icon" aria-hidden="true"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" ' +
          'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15v4M17 17h4"/></svg></span>' +
        '<label class="sr-only" for="ask-q">연구 데이터 및 학술 문헌 자연어 검색</label>' +
        '<input class="ai-bar-input" id="ask-q" type="search" autocomplete="off" value="' + esc(S.q) + '" ' +
          'placeholder="예: DA-1234 과제의 최고 Titer 값과 해당 배양 조건 알려줘">' +
        '<button class="btn btn-accent ai-bar-go" id="ask-go" type="button"' +
          (S.busy ? " disabled" : "") + ">" + (S.busy ? "검색 중…" : "검색") + "</button>" +
      "</div>" +

      '<div class="ask-onboard"><span class="ask-onboard-k">이런 걸 물어보실 수 있습니다</span>' +
        '<div class="ai-suggest">' +
          onboardingChips().map(c =>
            '<button class="ai-chip" data-q="' + esc(c.q) + '">' +
              '<span class="ai-chip-k">' + esc(c.ko) + "</span>" + esc(c.q) + "</button>").join("") +
        "</div></div>" +

      (tables.length > 1
        ? '<div class="ask-tablepick"><label for="ask-table">조회 대상 표</label>' +
          '<select class="ebr-input" id="ask-table">' +
            tables.map(t => '<option value="' + esc(t.id) + '"' +
              (t.id === S.tableId ? " selected" : "") + ">" + esc(t.label) +
              " (" + t.rows.length + "행)</option>").join("") +
          "</select></div>"
        : "") +

      "</div></section>";
  }

  /* ── 결과 ────────────────────────────────────────────────────────────── */
  function resultBlock() {
    if (S.error) {
      return '<div class="ask-answer is-bad"><p class="ask-head">' + esc(S.error) + "</p></div>";
    }
    if (S.busy) return skeleton();
    if (S.lit) return litBlock(S.lit);
    if (S.result) return answerBlock(S.result);
    return emptyHint();
  }

  function skeleton() {
    return '<div class="ask-answer"><span class="ai-tag">' +
      '<span class="badge-dot" style="background:currentColor"></span>조회 중…</span>' +
      '<div style="margin-top:var(--s-3);display:grid;gap:8px">' +
      '<div class="ask-sk" style="width:88%"></div>' +
      '<div class="ask-sk" style="width:66%"></div>' +
      '<div class="ask-sk" style="width:74%"></div></div></div>';
  }

  function emptyHint() {
    const known = window.AskEngine.knownMetrics();
    return '<div class="empty">' +
      '<div class="empty-title">질문을 입력하면 실제 데이터에서 값을 찾아 답합니다</div>' +
      '<div class="empty-body">사내 데이터는 이 브라우저에서 직접 계산하고, 외부 문헌은 ' +
      'Europe PMC · Crossref 를 실시간으로 검색합니다.<br>' +
      '현재 조회 가능한 측정 항목 ' + known.length + '개 — ' +
      esc(known.slice(0, 12).join(", ")) + (known.length > 12 ? " 외" : "") + "</div></div>";
  }

  /* 해석한 조건 · 반영하지 못한 조건.

     headline 과 분리해 둡니다. headline 은 /api/narrate 가 문장을 다시 쓰기
     때문에, 조건을 headline 안에만 두면 모델이 지워버릴 수 있습니다. 이
     블록은 엔진이 실제로 적용한 것만 담고 모델을 거치지 않습니다. */
  function condBlock(r) {
    let h = "";
    if (r.applied && r.applied.length) {
      h += '<div class="ask-cond"><span class="ask-cond-k">해석한 조건</span>' +
        r.applied.map(x => '<span class="ask-cond-v">' + esc(x) + "</span>").join("") + "</div>";
    }
    if (r.unhandled && r.unhandled.length) {
      h += '<div class="ask-cond is-miss"><span class="ask-cond-k">반영 못 함</span>' +
        r.unhandled.map(x => '<span class="ask-cond-v">' + esc(x) + "</span>").join("") + "</div>";
    }
    /* 조건이 걸렸는데 아무것도 못 걸렀을 때 — 가장 눈에 띄어야 합니다.
       라벨만 붙고 결과가 그대로면 걸러진 것으로 오해하기 때문입니다. */
    if (r.warnings && r.warnings.length) {
      h += r.warnings.map(x => '<p class="ask-warn">⚠ ' + esc(x) + "</p>").join("");
    }
    return h;
  }

  /* 단위 되묻기 — 값을 대신 고르지 않고 각 해석의 결과 건수를 보여 줍니다 */
  function choiceBlock(r) {
    if (!r.choices || !r.choices.length) return "";
    return '<div class="ask-choices">' + r.choices.map((c, i) =>
      '<button type="button" class="btn ask-choice" data-choice="' + i + '">' +
        "<b>" + esc(c.label) + "</b><span>" + esc(c.hint) + "</span></button>").join("") + "</div>";
  }

  function hintBlock(r) {
    if (!r.hints || !r.hints.length) return "";
    return '<ul class="ask-hints">' +
      r.hints.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>";
  }

  /* 개발 모드 디버그 패널 — 경로 · 슬롯 · 소요 시간 · 조회 건수.
     사용자 화면에는 나오지 않습니다 (규칙/LLM 구분은 개발 모드에서만). */
  function debugBlock() {
    if (!DEV || !S.debug) return "";
    const d = S.debug;
    const PATH_KO = { rule: "규칙", llm: "LLM", "rule-fallback": "규칙(폴백)", "llm-rejected": "LLM(가드 거절)" };
    return '<details class="disclose ask-dbg"><summary>경로: ' + esc(PATH_KO[d.path] || d.path) +
      " · " + d.ms + "ms" + (d.llmMs !== null ? " (LLM " + d.llmMs + "ms" + (d.cached ? ", 캐시" : "") + ")" : "") +
      " · " + d.rows + "행 · " + esc(d.kind) +
      (d.confidence !== null ? " · confidence " + d.confidence.toFixed(2) : "") +
      /* 이 응답이 수치 검증을 거쳤는지 — 거치지 않은 경로가 남지 않도록 */
      " · 수치 검증 " + (d.verified
        ? (d.verified.ok ? "통과(" + d.verified.checked + "개)" : "차단(" + d.verified.violations.length + "건)")
        : "미적용") +
      (d.narration === "blocked" ? " · 서술 차단" : d.narration === "ok" ? " · 서술 검증 통과" : "") +
      '<span class="disclose-note">개발 모드</span></summary>' +
      '<div style="padding:0 var(--s-4) var(--s-4)">' +
      (d.rejected && d.rejected.length
        ? '<p class="ask-note">가드 거절 — ' + esc(d.rejected.join(" · ")) + "</p>" : "") +
      '<pre class="ask-dbg-pre">' + esc(d.slots ? JSON.stringify(d.slots, null, 1) : "(규칙 경로 — 슬롯 없음)") +
      "</pre></div></details>";
  }

  /* 조건은 headline 앞에도 [ ] 로 박혀 있습니다 — 문장만 떼어 봐도 조건이
     따라가도록(내레이션 · 복사 · 로그) 엔진이 그렇게 넣습니다. 화면에는
     바로 위 칩으로 이미 보이니 여기서는 중복만 걷어냅니다. */
  function stripCond(r) {
    return (r.applied && r.applied.length)
      ? String(r.headline || "").replace(/^\[[^\]]*\]\s*/, "") : r.headline;
  }

  function answerBlock(r) {
    if (!r.ok) {
      return '<div class="ask-answer is-warn">' +
        '<span class="ai-tag">조회 결과</span>' +
        condBlock(r) +
        '<p class="ask-head">' + esc(stripCond(r)) + "</p>" +
        hintBlock(r) +
        (r.note ? '<p class="ask-note">' + esc(r.note) + "</p>" : "") +
        (r.suggestions && r.suggestions.length
          ? '<p class="ask-note">조회 가능한 항목 — ' + esc(r.suggestions.join(", ")) + "</p>" : "") +
        debugBlock() +
        "</div>";
    }

    const headText = S.narration ? S.narration.text : stripCond(r);
    const badge = S.narration
      ? '<span class="ask-by">문장: Claude ' + esc(shortModel(S.narration.model)) + " · 수치: 브라우저 계산</span>"
      : (S.narrating ? '<span class="ask-by">문장 다듬는 중…</span>'
                     : '<span class="ask-by">수치·문장 모두 브라우저 계산</span>');
    /* 서술 문장이 검증에 걸려 버려졌으면 그 사실을 밝힙니다 — 조용히
       다른 문장을 쓰면 사용자는 무슨 일이 있었는지 알 수 없습니다. */
    const blocked = S.narrationBlocked
      ? '<p class="ask-warn">⚠ 다듬은 문장에 조회 결과에 없는 수치(' +
        esc(S.narrationBlocked.nums.concat(S.narrationBlocked.dates).join(", ")) +
        ')가 있어 사용하지 않았습니다. 아래는 엔진이 계산한 원문입니다.</p>'
      : "";

    return '<div class="ask-answer">' +
      '<span class="ai-tag">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
        'aria-hidden="true"><path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/></svg>' +
        '실제 데이터 조회 결과</span>' + badge +

      condBlock(r) + blocked +
      '<p class="ask-head" id="ask-headline">' + esc(headText) + "</p>" +
      choiceBlock(r) +
      hintBlock(r) +

      (S.narration
        ? '<details class="disclose ask-raw"><summary>엔진이 계산한 원문 문장' +
          '<span class="disclose-note">숫자 대조용</span></summary>' +
          '<div style="padding:0 var(--s-4) var(--s-4);font-size:13px;line-height:1.8">' +
          esc(r.headline) + "</div></details>"
        : "") +

      (r.facts && r.facts.length ? factGrid(r.facts) : "") +
      (r.context && r.context.length
        ? '<div class="ask-sub">같은 배치에 기록된 값</div>' + factGrid(r.context)
        : "") +
      (r.compare ? compareTable(r) : "") +
      (r.series ? seriesTable(r) : "") +
      (r.rows && r.rows.length ? evidenceTable(r) : "") +
      (r.note ? '<p class="ask-note">⚠ ' + esc(r.note) + "</p>" : "") +

      debugBlock() +
      '<p class="ask-basis">근거: ' + esc(r.table.label) + " · 조회 범위 " + esc(r.scopeLabel) +
        " · 대상 " + r.scopeRows + "행" +
        (r.table.kind === "upload" ? " · 업로드한 파일 (브라우저 안에서만 처리)" : "") + "</p>" +
      "</div>";
  }

  function shortModel(m) {
    return String(m || "").replace(/^claude-/, "").replace(/-\d{8}$/, "");
  }

  function factGrid(facts) {
    return '<dl class="ask-facts">' + facts.map(f =>
      "<dt>" + esc(f.k) + "</dt><dd>" + esc(f.v) + "</dd>").join("") + "</dl>";
  }

  function evidenceTable(r) {
    const cols = r.evidenceCols || [];
    return '<div class="ask-sub">근거 데이터 (상위 ' + r.rows.length + "행)</div>" +
      '<div class="tbl-scroll"><table class="tbl"><thead><tr>' +
      cols.map(c => '<th scope="col">' + esc(c.label) + "</th>").join("") +
      "</tr></thead><tbody>" +
      r.rows.map(row => "<tr>" + cols.map(c =>
        '<td' + (c.key === "__label" ? ' class="mono" style="font-weight:600"' :
                 (typeof row[c.key] === "string" && /[\d]/.test(row[c.key]) ? ' class="mono"' : "")) + ">" +
        esc(row[c.key] == null ? "—" : row[c.key]) + "</td>").join("") + "</tr>").join("") +
      "</tbody></table></div>";
  }

  function compareTable(r) {
    return '<div class="ask-sub">' + esc(r.axis) + "별 " + esc(r.metric.label) + "</div>" +
      '<div class="tbl-scroll"><table class="tbl"><thead><tr>' +
      ['<th scope="col">' + esc(r.axis) + "</th>", '<th scope="col">건수</th>',
       '<th scope="col">평균</th>', '<th scope="col">최소</th>', '<th scope="col">최대</th>'].join("") +
      "</tr></thead><tbody>" +
      r.compare.map(x => "<tr><td>" + esc(x.group) + '</td><td class="mono">' + x.n +
        '</td><td class="mono" style="font-weight:600">' + esc(x.mean) +
        '</td><td class="mono">' + esc(x.min) + '</td><td class="mono">' + esc(x.max) +
        "</td></tr>").join("") + "</tbody></table></div>";
  }

  function seriesTable(r) {
    return '<div class="ask-sub">일자별 Titer (mg/L)</div>' +
      '<div class="tbl-scroll"><table class="tbl"><thead><tr><th scope="col">Batch</th>' +
      (window.DATA_TITER_DAYS || []).map(d => '<th scope="col">' + esc(d) + "</th>").join("") +
      "</tr></thead><tbody>" +
      r.series.map(function (s) {
        const byDay = {};
        s.points.forEach(p => { byDay[p.day] = p.value; });
        return '<tr><td class="mono" style="font-weight:600">' + esc(s.label) + "</td>" +
          (window.DATA_TITER_DAYS || []).map(d =>
            '<td class="mono">' + (byDay[d] == null ? "—" : byDay[d]) + "</td>").join("") + "</tr>";
      }).join("") + "</tbody></table></div>";
  }

  /* ── 외부 문헌 ───────────────────────────────────────────────────────── */
  function litBlock(L) {
    const okSrc = L.sources.filter(s => s.ok);
    const badSrc = L.sources.filter(s => !s.ok);

    let head;
    if (L.failedAll) {
      head = "외부 문헌 데이터베이스에 연결하지 못했습니다. 네트워크나 사내 방화벽을 확인해 주세요.";
    } else if (!L.items.length) {
      head = '"' + L.query + '" 로 검색했으나 결과가 없습니다. 검색어를 넓혀 다시 시도해 보세요.';
    } else {
      head = "\"" + L.query + "\" 로 " + okSrc.map(s => s.name).join(" · ") +
        " 를 검색해 " + L.items.length + "건을 찾았습니다. 각 DB가 매긴 관련도 순위를 " +
        "번갈아 배치했습니다 — 인용수는 참고 지표로만 표시합니다.";
    }

    return '<div class="ask-answer">' +
      '<span class="ai-tag">외부 학술 문헌 · 실시간 검색</span>' +
      '<span class="ask-by">Europe PMC · Crossref 공개 API</span>' +
      '<p class="ask-head">' + esc(head) + "</p>" +

      (L.translated
        ? '<p class="ask-note">한글 질문을 영문 검색어로 변환했습니다 — ' +
          esc(L.mapped.join(" · ")) + ". 원하는 용어가 아니면 영문으로 직접 입력해 주세요.</p>"
        : "") +

      (badSrc.length
        ? '<p class="ask-note">' + badSrc.map(s => esc(s.name) + " 응답 실패 (" + esc(s.error) + ")").join(" · ") + "</p>"
        : "") +

      (L.items.length ? '<div class="lit-list">' + L.items.map(litCard).join("") + "</div>" : "") +

      '<div class="ask-sub">특허 검색</div>' +
      '<p class="ask-note">특허 전문 검색은 공개 API 가 없어 이 화면에 포함하지 않았습니다. ' +
      "아래 검색 서비스로 같은 검색어를 넘길 수 있습니다.</p>" +
      '<div class="ask-links">' + window.LitAPI.patentLinks(L.question).map(l =>
        '<a class="ask-link" href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer">' +
        esc(l.label) + " ↗</a>").join("") + "</div>" +
      "</div>";
  }

  function litCard(it) {
    return '<article class="lit-card">' +
      '<div class="lit-card-top">' +
        '<span class="lit-kind lit-kind-' + (it.type === "논문" ? "논문" : "특허") + '">' + esc(it.type) + "</span>" +
        (it.openAccess ? '<span class="lit-oa">Open Access</span>' : "") +
        (it.cites != null ? '<span class="lit-cites">인용 ' + it.cites + "</span>" : "") +
        '<span class="lit-from">' + esc(it.from) + "</span>" +
      "</div>" +
      (it.url
        ? '<a class="lit-title" href="' + esc(it.url) + '" target="_blank" rel="noopener noreferrer">' +
          esc(it.title) + " ↗</a>"
        : '<span class="lit-title">' + esc(it.title) + "</span>") +
      '<div class="lit-meta">' +
        [it.authors, it.journal, it.year].filter(Boolean).map(esc).join(" · ") +
      "</div>" +
      (it.abstract ? '<p class="lit-abs">' + esc(it.abstract) + "</p>" : "") +
      (it.doi ? '<div class="lit-doi mono">DOI ' + esc(it.doi) + "</div>" : "") +
      "</article>";
  }

  /* ── 데이터 소스 카드 (업로드) ───────────────────────────────────────── */
  function sourceCard() {
    const ups = window.AskTables.uploads();
    return '<section class="card"><div class="card-head"><div>' +
      '<h2 class="card-title">조회 대상 데이터</h2>' +
      '<p class="card-sub">사내 데이터에 더해, 보유한 엑셀/CSV 를 올려 같은 방식으로 질문할 수 있습니다</p>' +
      "</div></div><div class=\"card-body\">" +

      '<div class="ask-srcrow">' +
        '<span class="badge badge-accent"><span class="badge-dot"></span>사내 실험 데이터</span>' +
        '<span style="font-size:12px;color:var(--c-text-mute)">Batch ' +
          window.AskTables.internal().rows.length + "행 · 측정 항목 " +
          window.AskTables.numericColumns(window.AskTables.internal()).length + "개</span>" +
      "</div>" +

      ups.map(t => '<div class="ask-srcrow">' +
        '<span class="badge">' + esc(t.label) + "</span>" +
        '<span style="font-size:12px;color:var(--c-text-mute)">' + t.rows.length + "행 · " +
          t.columns.length + "컬럼 (숫자 " + window.AskTables.numericColumns(t).length + ")</span>" +
        '<button class="btn btn-ghost btn-sm" data-drop-src="' + esc(t.id) + '">제거</button>' +
      "</div>").join("") +

      '<div class="drop" id="ask-drop" tabindex="0" role="button" ' +
        'aria-label="엑셀 또는 CSV 파일 올리기">' +
        "<strong>엑셀 · CSV 파일을 여기에 놓거나 클릭해 선택</strong><br>" +
        "<span style=\"font-size:12px;color:var(--c-text-mute)\">.xlsx · .xls · .csv · .tsv — " +
        "파일은 브라우저 안에서만 파싱되며 서버로 전송되지 않습니다</span>" +
        '<input type="file" id="ask-file" accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm" ' +
          'multiple style="display:none">' +
      "</div>" +
      (S.uploadMsg ? '<p class="ask-note" id="ask-upmsg">' + esc(S.uploadMsg) + "</p>" : "") +
      "</div></section>";
  }

  /* ══════════════════════════════════════════════════════════════════════
     동작
     ══════════════════════════════════════════════════════════════════════ */
  let repaint = function () {};

  function wire(onRepaint) {
    repaint = typeof onRepaint === "function" ? onRepaint : function () {};

    const input = $("#ask-q");
    if (input) {
      input.addEventListener("input", function () { S.q = this.value; });
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); run(); }
      });
    }
    const go = $("#ask-go");
    if (go) go.addEventListener("click", run);

    $$(".ai-chip").forEach(c => c.addEventListener("click", function () {
      S.q = c.dataset.q;
      const i = $("#ask-q"); if (i) i.value = S.q;
      run();
    }));

    /* 단위 되묻기 — 고른 쪽을 단위까지 적어 다시 묻습니다.
       질문을 그대로 다시 보내므로 어떤 조건으로 조회했는지 기록에 남습니다. */
    $$(".ask-choice").forEach(b => b.addEventListener("click", function () {
      const r = S.result;
      const c = r && r.choices ? r.choices[Number(b.dataset.choice)] : null;
      if (!c) return;
      /* 되묻기에 사용자가 무엇을 골랐는지 남깁니다 — 어느 해석이 실제로
         의도였는지 알아야 다음에 되묻지 않을 수 있습니다. */
      if (window.AskLog) window.AskLog.recordChoice(r.question, c.label);
      S.q = c.question;
      const i = $("#ask-q"); if (i) i.value = S.q;
      run();
    }));

    $$(".ask-mode").forEach(b => b.addEventListener("click", function () {
      S.mode = b.dataset.mode; repaint();
    }));

    const pick = $("#ask-table");
    if (pick) pick.addEventListener("change", function () { S.tableId = this.value; });

    wireUpload();
  }

  function wireUpload() {
    const drop = $("#ask-drop"), file = $("#ask-file");
    if (!drop || !file) return;

    drop.addEventListener("click", () => file.click());
    drop.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); }
    });
    file.addEventListener("change", () => handleFiles(file.files));

    ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => {
      e.preventDefault(); drop.classList.add("is-over");
    }));
    ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => {
      e.preventDefault(); drop.classList.remove("is-over");
    }));
    drop.addEventListener("drop", e => {
      if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
    });

    $$("[data-drop-src]").forEach(b => b.addEventListener("click", function () {
      if (window.AskTables.remove(b.dataset.dropSrc)) {
        if (S.tableId === b.dataset.dropSrc) S.tableId = "internal";
        S.uploadMsg = "표를 제거했습니다.";
        repaint();
      }
    }));
  }

  function handleFiles(list) {
    const files = Array.prototype.slice.call(list || []);
    if (!files.length) return;
    S.uploadMsg = files.length + "개 파일을 읽는 중…";
    repaint();

    Promise.all(files.map(f =>
      window.AskTables.addFile(f)
        .then(ts => ({ ok: true, name: f.name, tables: ts }))
        .catch(e => ({ ok: false, name: f.name, error: e.message }))
    )).then(function (res) {
      const good = res.filter(r => r.ok), bad = res.filter(r => !r.ok);
      const added = good.reduce((n, r) => n + r.tables.length, 0);
      const parts = [];
      if (added) {
        parts.push(added + "개 표를 불러왔습니다 (" +
          good.map(r => r.name).join(", ") + "). 위 검색창에서 바로 질문할 수 있습니다.");
        const first = good[0].tables[0];
        if (first) S.tableId = first.id;
      }
      bad.forEach(r => parts.push(r.name + " — " + r.error));
      S.uploadMsg = parts.join(" ");
      repaint();
    });
  }

  /* ── 검색 실행 ───────────────────────────────────────────────────────── */
  let seq = 0;

  function run() {
    const q = String(S.q || "").trim();
    S.error = null; S.narration = null; S.narrating = false;
    if (!q) { S.result = null; S.lit = null; repaint(); return; }

    const useLit = S.mode === "lit" || (S.mode === "auto" && window.AskEngine.looksExternal(q));
    const my = ++seq;
    S.busy = true; S.result = null; S.lit = null;
    S.narration = null; S.narrationBlocked = null;
    repaint();

    if (useLit) {
      window.LitAPI.search(q, { limit: 10 }).then(function (L) {
        if (my !== seq) return;                 // 더 최근 검색이 이미 진행 중
        S.busy = false; S.lit = L; repaint();
      }).catch(function (e) {
        if (my !== seq) return;
        S.busy = false;
        S.error = "외부 문헌 검색에 실패했습니다 — " + (e.message || "알 수 없는 오류");
        repaint();
      });
      return;
    }

    /* 내부 데이터는 동기 계산입니다. 스켈레톤이 한 프레임이라도 보이도록
       다음 틱에 실행합니다 — 즉시 결과가 튀면 무엇이 일어났는지 안 보입니다. */
    setTimeout(function () {
      if (my !== seq) return;
      const table = window.AskTables.get(S.tableId) || window.AskTables.internal();
      const t0 = (window.performance && performance.now) ? performance.now() : Date.now();

      /* ── [1] 규칙 매칭. 성공하면 여기서 끝납니다 — LLM 을 부르지 않습니다.
         속도 · 비용 · 결정성이 규칙 경로의 이유입니다. */
      let r;
      try {
        /* 직전 턴을 넘깁니다 — "그럼 정제는?" 처럼 이어받는 표현이 있을 때만
           엔진이 씁니다. 표시 없이 물려받으면 사용자가 전체를 물었는데도
           조용히 범위가 좁아집니다. */
        r = window.AskEngine.answer(q, { table: table, prev: S.prev });
      } catch (e) {
        S.busy = false; S.error = "조회 중 오류가 발생했습니다 — " + (e.message || e); repaint(); return;
      }

      const missed = window.AskLLM &&
        (window.AskLLM.ruleMissed(r, r.conditions) || S.lastWasClarify);
      if (!missed) return finish(r, "rule", null, t0, my);

      /* ── [2] 규칙이 놓친 경우에만 LLM 슬롯 추출 ────────────────────── */
      const catalog = window.Catalog.get(table);
      window.AskLLM.extract(q, catalog, historyForLLM()).then(function (ex) {
        if (my !== seq) return;
        if (!ex.ok) {
          /* [4f] 타임아웃 · 오류 · 키 없음 → 규칙 결과로 되돌아가고 그 사실을 적습니다 */
          r.unhandled = (r.unhandled || []).concat([fallbackNote(ex)]);
          return finish(r, "rule-fallback", ex, t0, my);
        }

        /* ── [3] 가드 — 카탈로그 · 단위 · 확신도 검증 ─────────────────── */
        const g = window.AskGuard.check(ex.slots, table, catalog);

        if (g.reason === "unsupported") {
          const u = window.AskEngine.unsupportedAnswer(q, table, g.unsupported, g.unhandled);
          return finish(u, "llm", ex, t0, my, g);
        }
        if (g.clarify) {
          /* 단위가 분명하지 않으면 실행하지 않고 되묻습니다 */
          const c = window.AskEngine.answer(q, {
            table: table, prev: S.prev, plan: g.plan,
            guardRejected: g.rejected, slotUnhandled: g.unhandled, forceClarify: g.clarify
          });
          return finish(c, "llm", ex, t0, my, g);
        }
        if (!g.ok) {
          /* [4d] 낮은 확신 → 실행하지 않고 규칙 결과 + 이유를 보여 줍니다 */
          r.unhandled = (r.unhandled || []).concat(
            ["확신이 낮아(" + g.confidence.toFixed(2) + ") 해석을 적용하지 않았습니다"],
            g.rejected);
          return finish(r, "llm-rejected", ex, t0, my, g);
        }

        /* ── [4] 실행 — 조회 · 집계는 전부 기존 엔진이 합니다 ─────────── */
        let out;
        try {
          out = window.AskEngine.answer(q, {
            table: table, prev: S.prev, plan: g.plan,
            guardRejected: g.rejected, slotUnhandled: g.unhandled
          });
        } catch (e) {
          r.unhandled = (r.unhandled || []).concat(["해석을 적용하다 오류가 나 규칙 결과로 되돌렸습니다"]);
          return finish(r, "rule-fallback", ex, t0, my);
        }
        finish(out, "llm", ex, t0, my, g);
      });
    }, 180);
  }

  function fallbackNote(ex) {
    if (ex.reason === "not-configured") return "AI 해석이 설정되지 않아 규칙 매칭 결과만 사용했습니다";
    if (ex.reason === "timeout") return "AI 해석이 " + (window.AskLLM.TIMEOUT_MS / 1000) +
      "초 안에 오지 않아 규칙 매칭 결과로 되돌렸습니다";
    return "AI 해석에 실패해(" + ex.reason + ") 규칙 매칭 결과로 되돌렸습니다";
  }

  /* 최근 3턴 보관 — LLM 에는 직전 2턴만, 원본 데이터 없이 요약만 보냅니다 */
  function historyForLLM() {
    return S.turns.slice(-2).map(t => ({
      question: t.question, slots: t.slots,
      summary: t.kind + " · " + t.rows + "행 · " + String(t.headline || "").slice(0, 120)
    }));
  }

  function finish(r, path, ex, t0, my, guard) {
    if (my !== seq) return;
    /* ★ 모든 응답이 여기를 지납니다 — 규칙 · LLM · 되묻기 · 미지원 · 폴백 ·
       0건 · 메타 · help 가 예외 없이 한 곳으로 모입니다. 엔진이 만든 문장의
       숫자를 데이터에서 유도한 허용집합과 대조하고, 근거 없는 값이 있으면
       문장을 데이터 기반 템플릿으로 바꿉니다. */
    if (window.AskVerify) {
      const table = window.AskTables.get(S.tableId) || window.AskTables.internal();
      window.AskVerify.enforce(r, table);
      if (r.verified && !r.verified.ok && window.AskLog) {
        window.AskLog.record({
          question: r.question, path: "result-blocked", kind: r.kind, intent: r.intent,
          rows: r.scopeRows, confidence: null,
          rejected: ["엔진 문장에 근거 없는 수치: " +
            r.verified.violations.map(v => v.value).join(", ") + " · 원문: " +
            String(r.blockedHeadline || "").slice(0, 80)]
        });
      }
    }
    const t1 = (window.performance && performance.now) ? performance.now() : Date.now();
    S.busy = false;
    S.result = r;
    S.debug = {
      path: path, ms: Math.round(t1 - t0), llmMs: ex ? ex.ms : null,
      cached: !!(ex && ex.cached), model: ex ? ex.model : null,
      slots: ex && ex.slots ? ex.slots : null,
      confidence: guard ? guard.confidence : null,
      rejected: guard ? guard.rejected : [],
      rows: r.scopeRows, kind: r.kind,
      verified: r.verified || null, narration: null
    };
    if (r.carry) S.prev = { carry: r.carry, question: r.question };
    S.turns.push({ question: r.question, slots: S.debug.slots, kind: r.kind,
                   rows: r.scopeRows, headline: r.headline });
    if (S.turns.length > 3) S.turns.shift();

    if (window.AskLog) {
      /* 답을 받고 곧바로 다시 물었다면 앞 답이 만족스럽지 않았다는 신호입니다 */
      if (S.lastAnswerAt && S.lastQuestion && S.lastQuestion !== r.question) {
        const gap = Date.now() - S.lastAnswerAt;
        if (gap < REQUERY_MS) window.AskLog.recordRequery(S.lastQuestion, gap);
      }
      window.AskLog.record({
        question: r.question, path: path, kind: r.kind, intent: r.intent,
        rows: r.scopeRows, slots: S.debug.slots,
        ms: S.debug.ms, llmMs: S.debug.llmMs,
        confidence: guard ? guard.confidence : null,
        rejected: guard ? guard.rejected : [],
        repeatedAfterClarify: !!S.lastWasClarify
      });
      S.lastAnswerAt = Date.now();
      S.lastQuestion = r.question;
    }
    S.lastWasClarify = (r.kind === "clarify");
    repaint();
    if (r.ok) narrate(r, my);
  }

  /* ── Claude 문장 다듬기 (선택적) ─────────────────────────────────────── */
  function narrate(r, my) {
    if (!r.facts || !r.facts.length) return;
    S.narrating = true;
    const host = $("#ask-out");
    if (host) {
      const by = host.querySelector(".ask-by");
      if (by) by.textContent = "문장 다듬는 중…";
    }

    fetch("/api/narrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: r.question,
        headline: r.headline,
        note: r.note || "",
        facts: (r.facts || []).concat(r.context || [])
      })
    })
      .then(res => res.json().then(j => ({ status: res.status, body: j })))
      .then(function (out) {
        if (my !== seq) return;
        S.narrating = false;
        if (out.status === 200 && out.body && out.body.text) {
          /* 서술 문장의 숫자를 조회 결과와 대조합니다. 근거 없는 숫자가
             하나라도 있으면 그 문장을 버리고 엔진이 만든 결정론적 문장을
             그대로 씁니다 — 의심스러우면 안 쓰는 쪽입니다. */
          const v = window.AskVerify.checkNarration(out.body.text, r);
          if (v.ok) {
            S.narration = { text: out.body.text, model: out.body.model };
            if (S.debug) S.debug.narration = "ok";
          } else {
            if (S.debug) S.debug.narration = "blocked";
            S.narration = null;
            S.narrationBlocked = {
              nums: v.unknownNums, dates: v.unknownDates, model: out.body.model
            };
            if (window.AskLog) {
              window.AskLog.record({
                question: r.question, path: "narrate-blocked", kind: r.kind,
                intent: r.intent, rows: r.scopeRows, confidence: null,
                rejected: ["서술 문장에 근거 없는 수치: " +
                  v.unknownNums.concat(v.unknownDates).join(", ")]
              });
            }
          }
        }
        repaint();
      })
      .catch(function () {
        /* 키 미설정 · 로컬 파일 열람 · 오프라인 — 전부 정상 경로입니다.
           엔진이 만든 문장이 이미 화면에 있으므로 조용히 유지합니다. */
        if (my !== seq) return;
        S.narrating = false; repaint();
      });
  }

  function state() { return S; }

  return { view, wire, state };
})();
