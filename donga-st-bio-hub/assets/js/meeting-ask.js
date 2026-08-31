/* ==========================================================================
   meeting-ask.js — 회의 모드 AI 봇  ·  window.MeetingAsk

   AI 검색(ask-engine.js)을 회의 화면에 붙입니다. 답만 하는 게 아니라,
   그 답을 회의 화면에 **그대로 걸어 줍니다**.

     "Titer 900 이상인 배치 리스트업해줘"
       → 목록 + 근거표를 보여 주고
       → [화면에 적용] 을 누르면 Titer 슬라이더가 900~ 로 맞춰지고
          해당 배치가 선택·강조되며 가장 높은 배치로 3팀 카드가 연동됩니다.

   ── 바로 적용하지 않고 확인을 거치는 이유 ────────────────────────────────
   발표 중에 화면이 예고 없이 바뀌면 보고 있던 맥락이 끊깁니다. 무엇이 바뀔지
   먼저 문장으로 보여 주고, 누를 때만 바꿉니다.

   ── 숫자는 이 파일에서 만들지 않습니다 ───────────────────────────────────
   값·통계는 전부 ask-engine.js 가 실제 데이터에서 계산합니다. 여기서는
   그 결과를 화면 조작으로 옮기기만 합니다.
   ========================================================================== */

window.MeetingAsk = (function () {
  "use strict";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const num = (v) => typeof v === "number" && isFinite(v);

  const S = { q: "", busy: false, result: null, cmd: null, error: null, applied: null };

  const CHIPS = [
    "Titer 900 이상인 배치 리스트업",
    "Total Yield 가장 높은 배치",
    "생존율 평균과 편차",
    "미입력이 가장 많은 항목",
    "과제별 Total Yield 비교"
  ];

  /* ══════════════════════════════════════════════════════════════════════
     항목 키 변환 — 엔진과 회의 화면이 서로 다른 표기를 씁니다
       엔진(tables.js)  : Repo.fieldKey → "titerHCCF" · "downstream_totalYield"
       회의 화면        : "titer.titerHCCF" · "downstream.totalYield"
     ══════════════════════════════════════════════════════════════════════ */
  function dottedOf(fieldKey) {
    const gs = window.DATA_ANALYTE_GROUPS || [];
    for (let i = 0; i < gs.length; i++) {
      const g = gs[i];
      for (let j = 0; j < g.items.length; j++) {
        const it = g.items[j];
        const fk = window.Repo ? window.Repo.fieldKey(g.id, it.key)
                               : ((g.id === "upstream" || g.id === "titer") ? it.key : g.id + "_" + it.key);
        if (fk === fieldKey) return { dotted: g.id + "." + it.key, group: g, item: it };
      }
    }
    return null;
  }

  /* ══════════════════════════════════════════════════════════════════════
     질문에서 임계값 뽑기 — 엔진은 "무슨 항목/무슨 집계"까지만 읽습니다
     ══════════════════════════════════════════════════════════════════════ */
  /* 파싱과 단위 해석은 Units 한 곳에서 합니다. 예전에는 이 파일이 자기
     정규식을 따로 갖고 있어서, AI 검색만 고치면 같은 질문이 회의 모드에서만
     다르게 동작했습니다. 단위 대조("Titer 3" 이 mg/L 인지 g/L 인지)도
     여기서 같이 받습니다.
     col · rows 를 넘기면 실측 범위와 대조하고, 없으면 숫자를 그대로 씁니다. */
  function parseThreshold(q, col, rows) {
    const U = window.Units;
    if (!U) return null;
    const list = U.parseThresholds(q);
    if (!list.length) return null;
    const th = list[0];
    let min = th.min, max = th.max;

    if (col) {
      const res = U.interpretThreshold(th, col, rows || []);
      /* 단위가 분명하지 않으면 화면 조건을 건드리지 않습니다 —
         잘못된 범위로 슬라이더를 움직이면 걸러진 것처럼 보입니다. */
      if (res.suspect) return { ambiguous: true, options: res.options, raw: th.raw, label: col.label };
      min = res.th.min; max = res.th.max;
    }
    return { min: min, max: max,
             how: th.op === "between" ? "between" : (th.op === "gte" || th.op === "gt") ? "min" : "max" };
  }

  /* ══════════════════════════════════════════════════════════════════════
     엔진 결과 → 화면 명령
     ══════════════════════════════════════════════════════════════════════ */
  function buildCommand(r, ctx) {
    if (!r || !r.ok) return null;
    const cmd = { tab: null, range: null, picked: null, focus: null, sortKey: null, parts: [] };

    const conv = r.metric ? dottedOf(r.metric.key) : null;
    if (conv) {
      cmd.sortKey = conv.dotted;
      /* 항목이 속한 팀 탭으로 — 전체 탭이면 그대로 둡니다 (동기화 뷰가 유용) */
      if (conv.group.team && ctx.currentView().tab !== "all") {
        cmd.tab = conv.group.team;
        cmd.parts.push((window.People ? window.People.teamKo(conv.group.team) : conv.group.team) + " 탭으로 전환");
      }

      const slot = ctx.rangeSlotFor(conv.dotted);
      /* 실측 범위와 대조해 단위를 확인합니다 — 회의 중에 잘못된 범위로
         슬라이더가 움직이면 세 팀이 같은 화면을 보며 오해합니다. */
      const col = { key: r.metric.key, label: r.metric.label, unit: r.metric.unit };
      const th = parseThreshold(r.question, col, (window.AskTables && r.table && r.table.id
        ? (window.AskTables.get(r.table.id) || { rows: [] }).rows : []));
      if (th && th.ambiguous) {
        cmd.parts.push("\"" + th.raw + "\" 의 단위가 분명하지 않아 범위는 건드리지 않았습니다 (" +
          th.options.map(o => o.label).join(" / ") + " 중 어느 쪽인지 확인해 주세요)");
      } else if (slot && th) {
        cmd.range = { id: slot, key: conv.dotted, min: th.min, max: th.max };
        cmd.parts.push(conv.item.label + " 범위를 " +
          (th.min !== null ? th.min : "최소") + " ~ " + (th.max !== null ? th.max : "최대") +
          (conv.item.unit ? " " + conv.item.unit : "") + " 로 설정");
      }
    }

    /* 답변에 나온 배치를 화면에서 고릅니다 */
    const labels = (r.rows || []).map(x => x.__label).filter(Boolean);
    if (labels.length) {
      const byLabel = {};
      ctx.batches().forEach(b => { byLabel[b.expNo || b.id] = b.id; });
      const ids = labels.map(l => byLabel[l]).filter(Boolean);
      if (ids.length) {
        cmd.picked = ids;
        cmd.focus = ids[0];
        cmd.parts.push("배치 " + ids.length + "건 선택 · " + labels[0] + " 로 3팀 카드 연동");
      }
    }

    return cmd.parts.length ? cmd : null;
  }

  /* ══════════════════════════════════════════════════════════════════════
     화면
     ══════════════════════════════════════════════════════════════════════ */
  function view() {
    return '<section class="card mm-ask"><div class="card-body">' +
      '<div class="ai-bar">' +
        '<span class="ai-bar-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" ' +
          'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15v4M17 17h4"/></svg></span>' +
        '<label class="sr-only" for="mm-ask-q">회의 데이터 자연어 질문</label>' +
        '<input class="ai-bar-input" id="mm-ask-q" type="search" autocomplete="off" value="' + esc(S.q) + '" ' +
          'placeholder="예: Titer 900 이상인 배치 리스트업">' +
        '<button class="btn btn-accent ai-bar-go" id="mm-ask-go" type="button"' +
          (S.busy ? " disabled" : "") + ">" + (S.busy ? "조회 중…" : "질문") + "</button>" +
      '</div>' +
      '<div class="ai-suggest">' + CHIPS.map(c =>
        '<button class="ai-chip" data-mq="' + esc(c) + '">' + esc(c) + "</button>").join("") + '</div>' +
      '<div id="mm-ask-out">' + outMarkup() + '</div>' +
      '</div></section>';
  }

  function outMarkup() {
    if (S.error) return '<div class="mm-ask-panel is-bad">' + esc(S.error) + '</div>';
    if (S.busy) return '<div class="mm-ask-panel"><span class="ai-tag">조회 중…</span></div>';
    if (S.applied) return '<div class="mm-ask-panel is-ok">' +
      '<span class="ai-tag">화면에 적용했습니다</span>' +
      '<p class="mm-ask-head">' + esc(S.applied) + '</p></div>';
    if (!S.result) return "";

    const r = S.result;
    if (!r.ok) {
      return '<div class="mm-ask-panel is-warn"><p class="mm-ask-head">' + esc(r.headline) + '</p>' +
        (r.note ? '<p class="mm-ask-note">' + esc(r.note) + '</p>' : "") +
        (r.suggestions && r.suggestions.length
          ? '<p class="mm-ask-note">조회 가능한 항목 — ' + esc(r.suggestions.slice(0, 14).join(", ")) + '</p>' : "") +
        '</div>';
    }

    return '<div class="mm-ask-panel">' +
      '<span class="ai-tag">실제 데이터 조회 결과</span>' +
      '<span class="mm-ask-by">수치는 브라우저 계산</span>' +
      '<p class="mm-ask-head">' + esc(r.headline) + '</p>' +
      (r.rows && r.rows.length ? listTable(r) : "") +
      (r.note ? '<p class="mm-ask-note">⚠ ' + esc(r.note) + '</p>' : "") +
      (S.cmd
        ? '<div class="mm-ask-apply">' +
            '<div class="mm-ask-plan"><b>화면에 적용하면</b><ul>' +
              S.cmd.parts.map(p => "<li>" + esc(p) + "</li>").join("") + '</ul></div>' +
            '<button class="btn btn-accent btn-sm" id="mm-ask-apply">화면에 적용</button>' +
            '<button class="btn btn-ghost btn-sm" id="mm-ask-dismiss">닫기</button>' +
          '</div>'
        : '<p class="mm-ask-note">이 답변으로 바꿀 화면 조건을 찾지 못했습니다 — 목록만 참고하세요.</p>') +
      '<p class="mm-ask-basis">근거 ' + esc(r.table.label) + ' · 범위 ' + esc(r.scopeLabel) +
        ' · 대상 ' + r.scopeRows + '행</p>' +
      '</div>';
  }

  function listTable(r) {
    const cols = r.evidenceCols || [];
    return '<div class="tbl-scroll" style="margin-top:var(--s-3);max-height:230px">' +
      '<table class="tbl"><thead><tr>' +
      cols.map(c => '<th scope="col">' + esc(c.label) + '</th>').join("") +
      '</tr></thead><tbody>' +
      r.rows.map(row => "<tr>" + cols.map(c =>
        '<td' + (c.key === "__label" ? ' class="mono" style="font-weight:600"' : "") + ">" +
        esc(row[c.key] == null ? "—" : row[c.key]) + "</td>").join("") + "</tr>").join("") +
      '</tbody></table></div>';
  }

  /* ══════════════════════════════════════════════════════════════════════
     동작
     ══════════════════════════════════════════════════════════════════════ */
  let CTX = null;

  function wire(ctx) {
    CTX = ctx;
    const input = $("#mm-ask-q");
    if (input) {
      input.addEventListener("input", function () { S.q = this.value; });
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); run(); }
      });
    }
    const go = $("#mm-ask-go");
    if (go) go.addEventListener("click", run);
    $$("[data-mq]").forEach(c => c.addEventListener("click", function () {
      S.q = c.dataset.mq;
      const i = $("#mm-ask-q"); if (i) i.value = S.q;
      run();
    }));
    wireOut();
  }

  function wireOut() {
    const ap = $("#mm-ask-apply");
    if (ap) ap.addEventListener("click", function () {
      if (!S.cmd || !CTX) return;
      CTX.apply(S.cmd);
      S.applied = S.cmd.parts.join(" · ");
      S.result = null; S.cmd = null;
      repaintOut();
    });
    const dm = $("#mm-ask-dismiss");
    if (dm) dm.addEventListener("click", function () {
      S.result = null; S.cmd = null; S.applied = null; repaintOut();
    });
  }

  function repaintOut() {
    const host = $("#mm-ask-out");
    if (!host) return;
    host.innerHTML = outMarkup();
    wireOut();
  }

  let seq = 0;
  function run() {
    const q = String(S.q || "").trim();
    S.error = null; S.applied = null; S.cmd = null;
    if (!q) { S.result = null; repaintOut(); return; }
    if (!window.AskEngine || !window.AskTables) {
      S.error = "질의 엔진이 로드되지 않았습니다.";
      repaintOut(); return;
    }

    const my = ++seq;
    S.busy = true; S.result = null;
    repaintOut();

    setTimeout(function () {
      if (my !== seq) return;
      try {
        /* 지금 회의에서 보고 있는 배치만으로 표를 만듭니다.
           전체 데이터로 답하면 화면에 없는 배치를 리스트업하고, 슬라이더
           상한과 답변의 최고값이 어긋납니다. */
        const bs = (CTX && CTX.batches) ? CTX.batches() : null;
        const table = (bs && bs.length && window.AskTables.build)
          ? window.AskTables.build(bs, "회의 범위 데이터 (Batch)",
              "지금 회의에서 선택한 과제 · Study 범위입니다.")
          : (window.AskTables.invalidate(), window.AskTables.internal());
        const r = window.AskEngine.answer(q, { table: table });
        /* 회의 모드도 같은 검증을 지납니다. 회의 중에 잘못된 수치가 화면에
           걸리면 세 팀이 같이 오해하므로 오히려 더 중요합니다. */
        if (window.AskVerify) {
          window.AskVerify.enforce(r, table);
          if (r.verified && !r.verified.ok && window.AskLog) {
            window.AskLog.record({
              question: q, path: "result-blocked", kind: r.kind, intent: r.intent,
              rows: r.scopeRows, confidence: null,
              rejected: ["회의 모드 · 근거 없는 수치: " +
                r.verified.violations.map(v => v.value).join(", ")]
            });
          }
        }
        S.busy = false;
        S.result = r;
        S.cmd = CTX ? buildCommand(r, CTX) : null;
      } catch (e) {
        S.busy = false;
        S.error = "조회 중 오류가 발생했습니다 — " + (e.message || e);
      }
      repaintOut();
    }, 120);
  }

  function reset() { S.q = ""; S.result = null; S.cmd = null; S.error = null; S.applied = null; }

  return { view, wire, run, reset, state: () => S, _parseThreshold: parseThreshold, _dottedOf: dottedOf };
})();
