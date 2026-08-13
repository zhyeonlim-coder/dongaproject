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
    uploadMsg: null
  };

  const CHIPS = [
    "DA-1234 과제의 최고 Titer 값과 해당 배양 조건 알려줘",
    "수율이 가장 높은 Batch는?",
    "DA-4321 생존율 평균과 편차",
    "과제별 Total Yield 비교",
    "일자별 Titer 추이",
    "미입력이 가장 많은 항목은?",
    "CHO 유가배양 역가 향상 최신 논문"
  ];

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

      '<div class="ai-suggest">' +
        CHIPS.map(c => '<button class="ai-chip" data-q="' + esc(c) + '">' + esc(c) + "</button>").join("") +
      "</div>" +

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

  function answerBlock(r) {
    if (!r.ok) {
      return '<div class="ask-answer is-warn">' +
        '<span class="ai-tag">조회 결과</span>' +
        '<p class="ask-head">' + esc(r.headline) + "</p>" +
        (r.note ? '<p class="ask-note">' + esc(r.note) + "</p>" : "") +
        (r.suggestions && r.suggestions.length
          ? '<p class="ask-note">조회 가능한 항목 — ' + esc(r.suggestions.join(", ")) + "</p>" : "") +
        "</div>";
    }

    const headText = S.narration ? S.narration.text : r.headline;
    const badge = S.narration
      ? '<span class="ask-by">문장: Claude ' + esc(shortModel(S.narration.model)) + " · 수치: 브라우저 계산</span>"
      : (S.narrating ? '<span class="ask-by">문장 다듬는 중…</span>'
                     : '<span class="ask-by">수치·문장 모두 브라우저 계산</span>');

    return '<div class="ask-answer">' +
      '<span class="ai-tag">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
        'aria-hidden="true"><path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/></svg>' +
        '실제 데이터 조회 결과</span>' + badge +

      '<p class="ask-head" id="ask-headline">' + esc(headText) + "</p>" +

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
      let r;
      try {
        const table = window.AskTables.get(S.tableId) || window.AskTables.internal();
        r = window.AskEngine.answer(q, { table: table });
      } catch (e) {
        S.busy = false; S.error = "조회 중 오류가 발생했습니다 — " + (e.message || e); repaint(); return;
      }
      S.busy = false; S.result = r; repaint();
      if (r.ok) narrate(r, my);
    }, 180);
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
          S.narration = { text: out.body.text, model: out.body.model };
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
