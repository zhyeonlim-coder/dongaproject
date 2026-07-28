/* ==========================================================================
   AI Knowledge Hub — natural-language search + recommendations

   ⚠ THIS IS NOT AN LLM. Queries are scored by keyword overlap against a small
   set of pre-written answers in rnd.js (AI_ANSWERS). There is no retrieval, no
   embedding, no generation. It demonstrates the interaction design of a RAG
   search — the input, the streaming-style answer, citations, and follow-ups —
   so the UI can be evaluated before a real backend exists.

   Wiring a real RAG service means replacing ask() with a fetch to it. Nothing
   else in this file needs to change.
   ========================================================================== */

window.AI = (function () {
  "use strict";

  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  const SUGGESTIONS = [
    "2024년 이후 Titer 3.5 g/L 이상 배양의 pH/DO 조건 요약해줘",
    "정제 공정별 HCP 제거 성능 비교",
    "최근 규격 이탈 항목 알려줘"
  ];

  /* INTEGRATION: replace with a call to the real RAG endpoint. */
  function ask(q) {
    const query = String(q || "").toLowerCase();
    let best = null, bestScore = 0;
    window.RND.AI_ANSWERS.forEach(a => {
      const score = a.match.reduce((s, kw) => s + (query.indexOf(kw.toLowerCase()) > -1 ? 1 : 0), 0);
      if (score > bestScore) { bestScore = score; best = a; }
    });
    return { hit: bestScore > 0, answer: best, score: bestScore };
  }

  function renderBar(el, opts) {
    const o = opts || {};
    el.innerHTML =
      '<div class="ai-bar">' +
        '<span class="ai-bar-icon" aria-hidden="true">' +
          '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
            'stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15v4M17 17h4"/></svg>' +
        '</span>' +
        '<label class="sr-only" for="ai-q">연구 데이터 자연어 검색</label>' +
        '<input class="ai-bar-input" id="ai-q" type="search" autocomplete="off" ' +
               'placeholder="' + esc(o.placeholder || "자연어로 물어보세요 — 예: Titer 3.5 g/L 이상 배양의 pH 조건은?") + '">' +
        '<button class="btn btn-accent ai-bar-go" id="ai-go" type="button">검색</button>' +
      '</div>' +
      '<div class="ai-suggest">' +
        SUGGESTIONS.map(s => '<button class="ai-chip" data-q="' + esc(s) + '">' + esc(s) + '</button>').join("") +
      '</div>' +
      '<div id="ai-out" style="margin-top:var(--s-4)" aria-live="polite"></div>';

    const input = el.querySelector("#ai-q");
    const out = el.querySelector("#ai-out");

    function run() {
      const q = input.value.trim();
      if (!q) { out.innerHTML = ""; return; }

      out.innerHTML =
        '<div class="ai-panel">' +
          '<span class="ai-tag"><span class="badge-dot" style="background:currentColor"></span>AI 검색 중…</span>' +
          '<div style="margin-top:var(--s-3);display:grid;gap:8px">' +
            '<div style="height:9px;width:82%;background:var(--c-paper-2);border-radius:4px"></div>' +
            '<div style="height:9px;width:64%;background:var(--c-paper-2);border-radius:4px"></div>' +
          '</div>' +
        '</div>';

      setTimeout(function () {
        const r = ask(q);
        if (!r.hit) {
          out.innerHTML =
            '<div class="ai-panel">' +
              '<span class="ai-tag">AI 응답</span>' +
              '<p style="font-size:13.5px;margin:var(--s-3) 0 0;line-height:1.75">' +
                '이 데모는 미리 작성된 3개의 질의에만 응답합니다. 아래 예시 질문을 눌러 보세요.' +
              '</p>' +
              '<p style="font-size:12px;color:var(--c-text-mute);margin:var(--s-2) 0 0">' +
                '실제 배포 시에는 사내 RAG 검색 엔진에 연결됩니다.</p>' +
            '</div>';
          return;
        }
        const a = r.answer;
        out.innerHTML =
          '<div class="ai-panel rise">' +
            '<span class="ai-tag">' +
              '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">' +
              '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/></svg>AI 응답' +
            '</span>' +
            '<p style="font-size:13.5px;line-height:1.8;margin:var(--s-3) 0 0;white-space:pre-line">' + a.answer + '</p>' +
            '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:var(--s-4);' +
                        'padding-top:var(--s-3);border-top:1px solid var(--c-accent-bg-2)">' +
              '<span style="font-size:11.5px;color:var(--c-text-mute)">근거 데이터</span>' +
              a.cites.map(c => '<a class="badge badge-accent mono" href="explorer.html#' + esc(c) + '">' + esc(c) + '</a>').join("") +
            '</div>' +
            '<p style="font-size:11px;color:var(--c-text-mute);margin:var(--s-3) 0 0">' +
              '⚠ 데모 응답입니다 — 실제 생성형 모델이 아니라 사전 작성된 답변입니다.</p>' +
          '</div>';
      }, 620);
    }

    el.querySelector("#ai-go").addEventListener("click", run);
    input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); run(); } });
    Array.prototype.forEach.call(el.querySelectorAll(".ai-chip"), function (c) {
      c.addEventListener("click", function () { input.value = c.dataset.q; run(); });
    });
  }

  function renderRecs(el, limit) {
    const recs = window.RND.AI_RECS.slice(0, limit || 3);
    el.innerHTML = recs.map(r =>
      '<button class="ai-rec" data-target="' + esc(r.target) + '">' +
        '<span class="ai-score">' + r.score + '%</span>' +
        '<span style="min-width:0">' +
          '<span style="display:block;font-size:13px;font-weight:600;margin-bottom:3px">💡 ' + esc(r.ko) + '</span>' +
          '<span style="display:block;font-size:12px;color:var(--c-text-mute);line-height:1.6">' + esc(r.detail) + '</span>' +
        '</span>' +
      '</button>'
    ).join("");

    Array.prototype.forEach.call(el.querySelectorAll(".ai-rec"), function (b) {
      b.addEventListener("click", function () {
        const t = b.dataset.target;
        window.location.href = t === "doe" ? "doe.html" : "explorer.html#" + t;
      });
    });
  }

  return { ask, renderBar, renderRecs, SUGGESTIONS };
})();
