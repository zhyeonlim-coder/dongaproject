/* ==========================================================================
   케이론(K-Ron) 연동 화면 — 시연용 모방 UI

   ⚠ 이 화면은 실제 K-Ron 서비스에 연결되어 있지 않습니다.
     케이론은 실존하는 솔루션이므로, 이 파일은 제품의 실제 기능·성능·사양을
     주장하지 않습니다. 발표 자리에서 흐름을 보여주기 위한 화면 구성일 뿐이며,
     그 사실을 화면에도 그대로 적어 둡니다.

   구성
     1. 질의 패널      추천 프롬프트 칩 → 출처 태그 · 핵심 요약 표 · 적합도 점수
     2. 문헌 · 특허    DA-1234 / DA-4321 맥락의 코퍼스 (data/literature.js)
     3. 내부 R&D 보고서 통합 검색 — RAG 챗봇

   ── 어디까지가 진짜인가 ────────────────────────────────────────────────
   · 추천 칩의 분석 결과는 **미리 작성한 예시**입니다 (data/literature.js).
   · 자유 입력 질의와 문서 검색은 **실제로 계산**합니다 — 브라우저에서
     BM25 로 색인하고 점수를 매겨 근거 구절을 찾습니다. 업로드한 파일도
     FileReader 로 본문을 읽어 똑같이 색인하므로, 처음 보는 문서도 걸립니다.
   · 답변 문장을 새로 생성하지는 않습니다(추출형). LLM 호출이 없어서입니다.
   ========================================================================== */

window.KRon = (function () {
  "use strict";

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  /* ══════════════════════════════════════════════════════════════════════
     검색 엔진 — BM25
     한국어는 조사가 붙어 어절이 그대로 일치하지 않습니다("가이드라인" vs
     "가이드라인의"). 그래서 한글 구간은 2-gram 으로 쪼개 색인합니다.
     ══════════════════════════════════════════════════════════════════════ */
  const K1 = 1.4, B = 0.75;

  function tokenize(s) {
    const out = [];
    const t = String(s || "").toLowerCase();
    (t.match(/[a-z0-9][a-z0-9._%-]*/g) || []).forEach(w => out.push(w));
    (t.match(/[가-힣]+/g) || []).forEach(function (run) {
      if (run.length <= 2) { out.push(run); return; }
      for (let i = 0; i + 2 <= run.length; i++) out.push(run.slice(i, i + 2));
    });
    return out;
  }

  function counts(arr) {
    const m = {};
    arr.forEach(t => { m[t] = (m[t] || 0) + 1; });
    return m;
  }

  function buildIndex(items) {
    // items: [{ id, label, text, meta }]
    const docs = items.map(function (it) {
      const tok = tokenize(it.text);
      return { ref: it, tf: counts(tok), len: tok.length };
    });
    const df = {};
    docs.forEach(d => Object.keys(d.tf).forEach(t => { df[t] = (df[t] || 0) + 1; }));
    const avgdl = docs.length
      ? docs.reduce((s, d) => s + d.len, 0) / docs.length : 1;
    return { docs, df, avgdl, N: docs.length };
  }

  function search(index, q, topN) {
    if (!index || !index.N) return [];
    const qt = Object.keys(counts(tokenize(q)));
    if (!qt.length) return [];
    const scored = index.docs.map(function (d) {
      let s = 0;
      qt.forEach(function (t) {
        const f = d.tf[t] || 0;
        if (!f) return;
        const n = index.df[t] || 0;
        const idf = Math.log(1 + (index.N - n + 0.5) / (n + 0.5));
        s += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / (index.avgdl || 1))));
      });
      return { ref: d.ref, score: s };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);

    const top = scored.slice(0, topN || 5);
    const max = top.length ? top[0].score : 1;
    /* 화면에 쓰는 '적합도'는 이번 질의 안에서의 상대값입니다.
       BM25 점수는 상한이 없어 절대 백분율로 바꿀 수 없습니다. */
    return top.map(x => Object.assign({}, x, { pct: Math.round((x.score / (max || 1)) * 100) }));
  }

  /* 검색어를 본문에서 눈에 띄게 — 2-gram 이 아니라 사람이 친 단어 그대로.

     이미 이스케이프한 문자열에 <mark> 를 바로 끼워 넣으면 그 태그가 다음
     단어의 치환 대상이 되어 깨집니다. 본문에 나올 수 없는 사용자 정의 영역
     문자(U+E000/U+E001)로 먼저 표시해 두고, 마지막에 한 번만 태그로 바꿉니다. */
  const MK_OPEN = "\uE000", MK_CLOSE = "\uE001";

  function highlight(text, q) {
    const words = (String(q).match(/[가-힣]{2,}|[a-zA-Z0-9][a-zA-Z0-9._%-]{1,}/g) || [])
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort((a, b) => b.length - a.length)
      .slice(0, 12);
    let out = esc(text);
    words.forEach(function (w) {
      /* 위 정규식이 뽑아 주는 단어에는 한글·영숫자와 . _ % - 만 들어옵니다.
         그중 정규식에서 특별한 뜻을 갖는 건 마침표뿐이라 그것만 감싸 줍니다. */
      const re = new RegExp(w.split(".").join("[.]"), "gi");
      out = out.replace(re, m => MK_OPEN + m + MK_CLOSE);
    });
    return out.split(MK_OPEN).join("<mark>").split(MK_CLOSE).join("</mark>");
  }

  /* ══════════════════════════════════════════════════════════════════════
     상태
     ══════════════════════════════════════════════════════════════════════ */
  const S = {
    query: "",
    result: null,          // { kind:"preset"|"corpus", ... }
    busy: false,
    litKind: "전체",
    litQuery: "",
    litOpen: null,
    docs: [],              // { id, name, kind, chars, chunks:[], unsupported }
    ragIndex: null,
    chat: [],              // { role:"me"|"kron", text, hits:[] }
    ragBusy: false
  };

  let seq = 0;
  const uid = p => p + "-" + (++seq) + "-" + Date.now().toString(36);

  /* ══════════════════════════════════════════════════════════════════════
     1. 질의 패널
     ══════════════════════════════════════════════════════════════════════ */

  const litById = {};
  function indexLiterature() {
    const L = window.LIT.LITERATURE;
    L.forEach(x => { litById[x.id] = x; });
    return buildIndex(L.map(x => ({
      id: x.id, label: x.title_ko,
      text: [x.title_ko, x.title_en, x.summary, x.tag, x.src,
             (x.topics || []).join(" "), x.project || ""].join(" "),
      meta: x
    })));
  }
  let LIT_INDEX = null;

  function askPanel() {
    const P = window.LIT.PROMPTS;
    return '<section class="card" style="margin-bottom:var(--s-4)">' +
      '<div class="card-head" style="flex-wrap:wrap;gap:var(--s-3)">' +
        '<div class="kron-head">' +
          '<span class="kron-mark" aria-hidden="true">K</span>' +
          '<div><h2 class="card-title" style="margin:0">케이론 · K-Ron</h2>' +
          '<p class="card-sub" style="margin:2px 0 0">바이오 특화 AI로 문헌 · 특허 · 규제 자료를 함께 검토합니다</p></div>' +
        '</div>' +
        '<span class="badge badge-warn" style="margin-left:auto"><span class="badge-dot"></span>시연용 모방 화면</span>' +
      '</div>' +

      '<div class="card-body">' +
        '<div class="ai-bar">' +
          '<span class="ai-bar-icon" aria-hidden="true"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" ' +
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15v4M17 17h4"/></svg></span>' +
          '<label class="sr-only" for="kron-q">케이론에게 질문</label>' +
          '<input class="ai-bar-input" id="kron-q" type="search" autocomplete="off" value="' + esc(S.query) + '" ' +
            'placeholder="예: DA-1234 관련 특허 회피 전략">' +
          '<button class="btn btn-accent ai-bar-go" id="kron-go" type="button">분석</button>' +
        '</div>' +

        '<div class="ai-suggest" style="margin-top:var(--s-3)">' +
          P.map(p => '<button class="ai-chip" data-preset="' + esc(p.id) + '">' + esc(p.q) + '</button>').join("") +
        '</div>' +

        '<div id="kron-out" style="margin-top:var(--s-4)" aria-live="polite"></div>' +

        '<p style="font-size:11px;color:var(--c-text-mute);margin:var(--s-4) 0 0;line-height:1.8">' +
          '추천 프롬프트의 분석 결과는 시연을 위해 <b>미리 작성한 예시</b>입니다. ' +
          '그 외 문장을 직접 입력하면 아래 문헌 · 특허 코퍼스를 <b>실제로 검색</b>해 적합도 순으로 보여줍니다.<br>' +
          '이 화면은 실제 케이론 서비스에 연결되어 있지 않으며, 제품의 기능이나 성능을 나타내지 않습니다.' +
        '</p>' +
      '</div></section>';
  }

  function skeleton() {
    return '<div class="kron-panel"><span class="ai-tag">' +
      '<span class="badge-dot" style="background:currentColor"></span>K-Ron 분석 중…</span>' +
      '<div style="margin-top:var(--s-3);display:grid;gap:8px">' +
      '<div style="height:9px;width:86%;background:var(--c-paper-2);border-radius:4px"></div>' +
      '<div style="height:9px;width:67%;background:var(--c-paper-2);border-radius:4px"></div>' +
      '<div style="height:9px;width:74%;background:var(--c-paper-2);border-radius:4px"></div></div></div>';
  }

  function sourceRow(lit, pct, why) {
    if (!lit) return "";
    return '<div style="display:flex;gap:var(--s-3);align-items:center;padding:var(--s-2) 0;' +
        'border-bottom:1px solid var(--c-paper-2)">' +
      '<span class="lit-kind lit-kind-' + esc(lit.kind) + '" style="flex:none">' + esc(lit.kind) + '</span>' +
      '<span style="min-width:0;flex:1">' +
        '<button class="kron-cite" data-open="' + esc(lit.id) + '" style="max-width:100%">' +
          '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(lit.title_ko) + '</span>' +
        '</button>' +
        '<span style="display:block;font-size:11px;color:var(--c-text-mute);margin-top:3px">' +
          '<span class="mono">' + esc(lit.src) + ' · ' + lit.year + '</span>' +
          (why ? ' — ' + esc(why) : "") + '</span>' +
      '</span>' +
      '<span style="flex:none;text-align:right;min-width:96px">' +
        '<span class="mono" style="font-size:12px;font-weight:700">' + pct + '%</span>' +
        '<span class="kron-meter" style="margin-top:4px"><span style="width:' + pct + '%"></span></span>' +
      '</span></div>';
  }

  function presetResult(p) {
    return '<div class="kron-panel rise">' +
      '<div style="display:flex;gap:var(--s-3);align-items:center;flex-wrap:wrap;margin-bottom:var(--s-3)">' +
        '<span class="ai-tag">K-Ron 분석</span>' +
        '<span class="badge">' + esc(p.intent) + '</span>' +
        '<span class="badge badge-warn" style="margin-left:auto">예시 응답</span>' +
      '</div>' +

      '<p style="font-size:13.5px;line-height:1.85;margin:0 0 var(--s-4)">' + p.headline + '</p>' +

      '<div class="eyebrow" style="margin-bottom:var(--s-2)">핵심 요약</div>' +
      '<div class="tbl-scroll"><table class="tbl"><thead><tr>' +
        p.table.cols.map(c => '<th scope="col">' + esc(c) + '</th>').join("") +
      '</tr></thead><tbody>' +
        p.table.rows.map(r => '<tr>' + r.map((c, i) => i === 0
          ? '<th scope="row" style="font-weight:600">' + esc(c) + '</th>'
          : '<td>' + esc(c) + '</td>').join("") + '</tr>').join("") +
      '</tbody></table></div>' +

      '<div class="eyebrow" style="margin:var(--s-5) 0 var(--s-2)">근거 출처 · 적합도</div>' +
      p.sources.map(s => sourceRow(litById[s.litId], Math.round(s.score * 100), s.why)).join("") +

      '<p style="font-size:11.5px;color:var(--c-text-mute);margin:var(--s-4) 0 0;line-height:1.8">' +
        '⚠ ' + esc(p.caveat) + '</p>' +
    '</div>';
  }

  function corpusResult(q, hits) {
    if (!hits.length) {
      return '<div class="kron-panel"><span class="ai-tag">K-Ron 검색</span>' +
        '<p style="font-size:13.5px;margin:var(--s-3) 0 0;line-height:1.8">' +
        '코퍼스에서 관련 문헌을 찾지 못했습니다. 위 추천 프롬프트를 눌러 보시거나 ' +
        '<span class="mono">특허 · 당쇄 · 수율 · 가이드라인</span> 같은 키워드를 넣어 보세요.</p></div>';
    }
    return '<div class="kron-panel rise">' +
      '<div style="display:flex;gap:var(--s-3);align-items:center;flex-wrap:wrap;margin-bottom:var(--s-3)">' +
        '<span class="ai-tag">K-Ron 검색</span>' +
        '<span class="badge">코퍼스 ' + (LIT_INDEX ? LIT_INDEX.N : 0) + '건 검색</span>' +
        '<span class="badge badge-accent" style="margin-left:auto">실제 계산 결과</span>' +
      '</div>' +
      '<p style="font-size:13.5px;line-height:1.85;margin:0 0 var(--s-4)">' +
        '<b>' + esc(q) + '</b> 와(과) 가장 가까운 자료 ' + hits.length + '건입니다. ' +
        '적합도는 이번 질의 안에서의 상대 점수(BM25)입니다.</p>' +
      '<div class="eyebrow" style="margin-bottom:var(--s-2)">근거 출처 · 적합도</div>' +
      hits.map(h => sourceRow(h.ref.meta, h.pct,
        (h.ref.meta.topics || []).slice(0, 3).join(" · "))).join("") +
      '<p style="font-size:11.5px;color:var(--c-text-mute);margin:var(--s-4) 0 0;line-height:1.8">' +
        '문장을 새로 생성하지 않고 코퍼스에서 찾은 자료를 순위대로 제시합니다 — ' +
        '없는 근거를 만들어 내지 않기 위해서입니다.</p>' +
    '</div>';
  }

  function runQuery(q) {
    const out = $("#kron-out");
    if (!out) return;
    const term = String(q || "").trim();
    S.query = term;
    if (!term) { out.innerHTML = ""; S.result = null; return; }

    out.innerHTML = skeleton();
    setTimeout(function () {
      const preset = window.LIT.PROMPTS.find(p => p.q === term) ||
                     window.LIT.PROMPTS.find(p => term.length > 3 && p.q.indexOf(term) > -1);
      out.innerHTML = preset ? presetResult(preset) : corpusResult(term, search(LIT_INDEX, term, 5));
      wireCites();
    }, 520);
  }

  function wireCites() {
    $$("[data-open]").forEach(b => b.addEventListener("click", function () {
      S.litOpen = b.dataset.open;
      S.litKind = "전체";
      S.litQuery = "";
      paintLit();
      const el = document.querySelector('[data-lit="' + S.litOpen + '"]');
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }));
  }

  /* ══════════════════════════════════════════════════════════════════════
     2. 문헌 · 특허 목록
     ══════════════════════════════════════════════════════════════════════ */
  function litSection() {
    return '<section class="card" style="margin-bottom:var(--s-4)" id="lit-section">' +
      '<div class="card-head" style="flex-wrap:wrap;gap:var(--s-3)">' +
        '<div><h2 class="card-title">학술 문헌 &amp; 특허</h2>' +
          '<p class="card-sub" id="lit-count"></p></div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap" id="lit-kinds"></div>' +
      '</div>' +
      '<div class="card-body" style="padding-bottom:var(--s-4)">' +
        '<label class="sr-only" for="lit-q">문헌 검색</label>' +
        '<input class="input" id="lit-q" type="search" value="' + esc(S.litQuery) + '" ' +
          'placeholder="키워드, 저널명, 과제 코드로 검색 (예: 당쇄, 특허, DA-4321)">' +
      '</div>' +
      '<div id="lit-list"></div>' +
    '</section>';
  }

  function litList() {
    const kinds = ["전체", "논문", "특허", "가이던스", "내부보고서"];
    const q = S.litQuery.toLowerCase();
    const list = window.LIT.LITERATURE.filter(function (x) {
      if (S.litKind !== "전체" && x.kind !== S.litKind) return false;
      if (!q) return true;
      return [x.title_ko, x.title_en, x.src, x.summary, x.tag, x.project,
              (x.topics || []).join(" ")].join(" ").toLowerCase().indexOf(q) > -1;
    });

    $("#lit-count").textContent = "논문 · 특허 · 규제 가이던스 · 내부 R&D 보고서 통합 — " + list.length + "건";
    $("#lit-kinds").innerHTML = kinds.map(k =>
      '<button class="btn btn-ghost btn-sm" data-kind="' + esc(k) + '"' +
        (k === S.litKind ? ' style="background:var(--c-navy-700);color:#fff;border-color:var(--c-navy-700)"' : "") +
        '>' + esc(k) + '</button>').join("");

    $("#lit-list").innerHTML = list.length ? list.map(x =>
      '<div class="lit-item" data-lit="' + esc(x.id) + '" aria-expanded="' + (S.litOpen === x.id) + '">' +
        '<div style="display:flex;gap:var(--s-3);align-items:flex-start">' +
          '<span class="lit-kind lit-kind-' + esc(x.kind) + '">' + esc(x.kind) + '</span>' +
          '<div style="min-width:0;flex:1">' +
            '<div style="font-size:13.5px;font-weight:600;margin-bottom:3px">' + esc(x.title_ko) + '</div>' +
            '<div style="font-size:11.5px;color:var(--c-text-mute);margin-bottom:5px">' + esc(x.title_en) + '</div>' +
            '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:11.5px;color:var(--c-text-mute)">' +
              '<span class="mono">' + esc(x.src) + '</span><span>·</span><span class="mono">' + x.year + '</span>' +
              '<span>·</span><span>' + esc(x.authors) + '</span>' +
              (x.cited ? '<span class="badge">인용 ' + x.cited + '</span>' : "") +
              (x.project ? '<span class="badge badge-accent mono">' + esc(x.project) + '</span>' : "") +
              '<span class="badge">' + esc(x.tag) + '</span>' +
            '</div>' +
            (S.litOpen === x.id
              ? '<div style="margin-top:var(--s-4);padding:var(--s-4);background:var(--c-surface);' +
                'border:1px solid var(--c-border);border-radius:var(--r-md)">' +
                '<div class="eyebrow" style="margin-bottom:var(--s-2)">원문 요약</div>' +
                '<p style="font-size:13px;line-height:1.8;margin:0">' + esc(x.summary) + '</p>' +
                ((x.topics || []).length
                  ? '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:var(--s-3)">' +
                    x.topics.map(t => '<span class="badge">' + esc(t) + '</span>').join("") + '</div>'
                  : "") +
                '</div>'
              : "") +
          '</div>' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
            'aria-hidden="true" style="color:var(--c-text-soft);flex:none;transform:rotate(' +
            (S.litOpen === x.id ? "180" : "0") + 'deg)"><path d="m6 9 6 6 6-6"/></svg>' +
        '</div></div>').join("")
      : '<div class="empty"><div class="empty-title">검색 결과가 없습니다</div>' +
        '<div class="empty-body">다른 키워드를 입력하거나 종류 필터를 해제해 보세요.</div></div>';

    $$("[data-kind]").forEach(b => b.addEventListener("click", () => { S.litKind = b.dataset.kind; paintLit(); }));
    $$("[data-lit]").forEach(b => b.addEventListener("click", function () {
      S.litOpen = S.litOpen === b.dataset.lit ? null : b.dataset.lit;
      paintLit();
    }));
  }
  function paintLit() { if ($("#lit-list")) litList(); }

  /* ══════════════════════════════════════════════════════════════════════
     3. 내부 R&D 보고서 통합 검색 (RAG)
     ══════════════════════════════════════════════════════════════════════ */

  const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|log|htm|html|xml|yaml|yml)$/i;

  /* 문단 단위로 쪼갭니다. 너무 긴 문단은 문장 경계에서 한 번 더 나눠
     인용했을 때 화면을 뒤덮지 않도록 합니다. */
  function chunk(text) {
    const paras = String(text).split(/\n\s*\n+/).map(s => s.trim()).filter(Boolean);
    const out = [];
    paras.forEach(function (p) {
      if (p.length <= 600) { out.push(p); return; }
      let buf = "";
      p.split(/(?<=[.!?。]|다\.)\s+/).forEach(function (s) {
        if ((buf + " " + s).length > 600 && buf) { out.push(buf.trim()); buf = s; }
        else buf += (buf ? " " : "") + s;
      });
      if (buf.trim()) out.push(buf.trim());
    });
    return out;
  }

  function addDoc(name, kind, text) {
    const parts = chunk(text);
    S.docs.push({
      id: uid("doc"), name: name, kind: kind || "업로드",
      chars: text.length, chunks: parts, unsupported: false
    });
    reindex();
  }

  function addUnsupported(name, size) {
    S.docs.push({
      id: uid("doc"), name: name, kind: "본문 추출 불가",
      chars: size || 0, chunks: [], unsupported: true
    });
    paintDocs();
  }

  function reindex() {
    const items = [];
    S.docs.forEach(function (d) {
      d.chunks.forEach(function (c, i) {
        items.push({ id: d.id + "#" + i, label: d.name, text: c,
                     meta: { docName: d.name, docKind: d.kind, part: i + 1, total: d.chunks.length, text: c } });
      });
    });
    S.ragIndex = items.length ? buildIndex(items) : null;
    paintDocs();
  }

  function removeDoc(id) {
    S.docs = S.docs.filter(d => d.id !== id);
    reindex();
  }

  function ragSection() {
    return '<section class="card" id="rag-section">' +
      '<div class="card-head" style="flex-wrap:wrap;gap:var(--s-3)">' +
        '<div><h2 class="card-title">내부 R&amp;D 보고서 통합 검색</h2>' +
          '<p class="card-sub">보고서 · 가이드라인 · SOP를 올리면 그 문서 안에서 근거 구절을 찾아 답합니다</p></div>' +
        '<span class="badge badge-accent" style="margin-left:auto">' +
          '<span class="badge-dot"></span>브라우저에서 실제 검색</span>' +
      '</div>' +

      '<div class="card-body">' +
        '<div class="drop" id="rag-drop">' +
          '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color:var(--c-text-soft)">' +
            '<path d="M12 16V4M8 8l4-4 4 4"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>' +
          '<p style="font-size:13px;margin:var(--s-2) 0 var(--s-1)">문서를 여기에 끌어다 놓거나</p>' +
          '<div style="display:flex;gap:var(--s-2);justify-content:center;flex-wrap:wrap;margin-top:var(--s-3)">' +
            '<label class="btn btn-ghost btn-sm" style="cursor:pointer">파일 선택' +
              '<input type="file" id="rag-file" multiple class="sr-only" ' +
                'accept=".txt,.md,.markdown,.csv,.tsv,.json,.log,.htm,.html,.xml,.yaml,.yml"></label>' +
            '<button class="btn btn-ghost btn-sm" id="rag-sample">시연용 예시 문서 불러오기</button>' +
          '</div>' +
          '<p style="font-size:11px;color:var(--c-text-mute);margin:var(--s-3) 0 0;line-height:1.7">' +
            '텍스트 계열(.txt · .md · .csv · .json · .log)은 본문을 읽어 색인합니다. ' +
            'PDF · 워드는 브라우저만으로 본문을 꺼낼 수 없어 파일명만 등록됩니다.<br>' +
            '업로드한 파일은 이 브라우저 안에서만 처리되며 어디에도 전송되지 않습니다.</p>' +
        '</div>' +

        '<div id="rag-docs" style="margin-top:var(--s-4)"></div>' +

        '<div class="rule-hair" style="margin:var(--s-5) 0"></div>' +

        '<div id="rag-log" class="chat-log" aria-live="polite"></div>' +

        '<div class="ai-suggest" id="rag-suggest" style="margin-top:var(--s-4)"></div>' +

        '<form id="rag-form" style="display:flex;gap:var(--s-2);margin-top:var(--s-3)">' +
          '<label class="sr-only" for="rag-q">업로드한 문서에 질문</label>' +
          '<input class="input" id="rag-q" autocomplete="off" style="flex:1" ' +
            'placeholder="예: Harvest 기준이 어떻게 되나요?">' +
          '<button class="btn btn-accent" type="submit">질문</button>' +
        '</form>' +
      '</div></section>';
  }

  function paintDocs() {
    const host = $("#rag-docs");
    if (!host) return;
    const chunks = S.ragIndex ? S.ragIndex.N : 0;
    host.innerHTML = S.docs.length
      ? '<div style="display:flex;gap:var(--s-2);flex-wrap:wrap;align-items:center">' +
          S.docs.map(d =>
            '<span class="drop-file">' +
              '<span class="lit-kind" style="background:var(--c-paper-2);color:var(--c-text-mute)">' +
                esc(d.kind) + '</span>' +
              '<span class="mono" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
                esc(d.name) + '</span>' +
              '<span style="color:var(--c-text-mute);font-size:11px">' +
                (d.unsupported ? "본문 없음" : d.chunks.length + "구절") + '</span>' +
              '<button class="btn-icon" data-rmdoc="' + esc(d.id) + '" aria-label="' + esc(d.name) + ' 제거" ' +
                'style="width:22px;height:22px"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" ' +
                'stroke="currentColor" stroke-width="3"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
            '</span>').join("") +
          '<span style="font-size:11.5px;color:var(--c-text-mute);margin-left:auto">색인 구절 ' + chunks + '개</span>' +
        '</div>'
      : '<p style="font-size:12.5px;color:var(--c-text-mute);margin:0">아직 등록된 문서가 없습니다.</p>';

    $$("[data-rmdoc]").forEach(b => b.addEventListener("click", () => removeDoc(b.dataset.rmdoc)));
    paintSuggest();
  }

  function paintSuggest() {
    const host = $("#rag-suggest");
    if (!host) return;
    const qs = S.docs.length
      ? ["Harvest 기준이 어떻게 되나요?", "대조약 로트는 어떻게 선정하나요?",
         "고만노스가 왜 문제가 되나요?", "DoE 적합결여 결과는 어땠나요?"]
      : [];
    host.innerHTML = qs.map(q => '<button class="ai-chip" data-ragq="' + esc(q) + '">' + esc(q) + '</button>').join("");
    $$("[data-ragq]").forEach(b => b.addEventListener("click", function () {
      const inp = $("#rag-q");
      if (inp) inp.value = b.dataset.ragq;
      ask(b.dataset.ragq);
    }));
  }

  function paintChat() {
    const host = $("#rag-log");
    if (!host) return;
    if (!S.chat.length) {
      host.innerHTML = '<div class="empty" style="padding:var(--s-6)">' +
        '<div class="empty-title">문서를 등록하고 질문해 보세요</div>' +
        '<div class="empty-body">질문과 문서 본문을 대조해 근거가 된 구절을 그대로 인용합니다. ' +
        '답변 문장을 새로 지어내지 않습니다.</div></div>';
      return;
    }
    host.innerHTML = S.chat.map(function (t) {
      if (t.role === "me") {
        return '<div class="chat-turn is-me"><div class="chat-bubble">' + esc(t.text) + '</div></div>';
      }
      return '<div class="chat-turn"><div class="chat-bubble">' +
        '<div style="display:flex;gap:var(--s-2);align-items:center;margin-bottom:var(--s-2)">' +
          '<span class="kron-mark" style="width:22px;height:22px;border-radius:7px;font-size:10px" aria-hidden="true">K</span>' +
          '<span class="eyebrow">K-Ron</span></div>' +
        '<p style="margin:0">' + t.text + '</p>' +
        (t.hits || []).map(h =>
          '<div class="chat-quote">' +
            '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap">' +
              '<span class="mono" style="font-size:11px;font-weight:600">' + esc(h.docName) + '</span>' +
              '<span class="badge" style="font-size:10px">구절 ' + h.part + '/' + h.total + '</span>' +
              '<span style="margin-left:auto;display:flex;align-items:center;gap:6px">' +
                '<span class="mono" style="font-size:11px;font-weight:700">' + h.pct + '%</span>' +
                '<span class="kron-meter" style="width:56px"><span style="width:' + h.pct + '%"></span></span>' +
              '</span></div>' +
            h.html +
          '</div>').join("") +
        (t.note ? '<p style="font-size:11px;color:var(--c-text-mute);margin:var(--s-3) 0 0;line-height:1.75">' +
          t.note + '</p>' : "") +
      '</div></div>';
    }).join("");
    host.scrollTop = host.scrollHeight;
  }

  function ask(q) {
    const term = String(q || "").trim();
    if (!term || S.ragBusy) return;
    S.chat.push({ role: "me", text: term });
    paintChat();

    if (!S.docs.length) {
      S.chat.push({ role: "kron",
        text: '등록된 문서가 없습니다. 위에서 보고서를 올리거나 <b>시연용 예시 문서 불러오기</b>를 눌러 주세요.',
        hits: [] });
      paintChat();
      return;
    }

    S.ragBusy = true;
    setTimeout(function () {
      const hits = search(S.ragIndex, term, 3);
      if (!hits.length) {
        S.chat.push({ role: "kron",
          text: '등록된 ' + S.docs.length + '개 문서에서 관련 구절을 찾지 못했습니다. ' +
                '문서에 실제로 쓰인 표현으로 바꿔 질문해 보세요.',
          hits: [] });
      } else {
        S.chat.push({
          role: "kron",
          text: '문서 ' + S.docs.length + '건 · 색인 구절 ' + S.ragIndex.N + '개에서 ' +
                '<b>관련 구절 ' + hits.length + '건</b>을 찾았습니다.',
          hits: hits.map(h => ({
            docName: h.ref.meta.docName, part: h.ref.meta.part, total: h.ref.meta.total,
            pct: h.pct, html: highlight(h.ref.meta.text, term)
          })),
          note: '위 구절이 근거입니다. 적합도는 이번 질의 안에서의 상대 점수(BM25)이며, ' +
                '답변 문장을 새로 생성하지는 않습니다 — 없는 내용을 만들어 내지 않기 위해서입니다.'
        });
      }
      S.ragBusy = false;
      paintChat();
    }, 480);
  }

  function readFiles(fileList) {
    Array.prototype.slice.call(fileList).forEach(function (f) {
      if (!TEXT_EXT.test(f.name)) { addUnsupported(f.name, f.size); return; }
      const fr = new FileReader();
      fr.onload = function () { addDoc(f.name, "업로드", String(fr.result || "")); };
      fr.onerror = function () { addUnsupported(f.name, f.size); };
      fr.readAsText(f);
    });
  }

  function wireRag() {
    const drop = $("#rag-drop");
    if (drop) {
      ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, function (e) {
        e.preventDefault(); drop.classList.add("is-over");
      }));
      ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, function (e) {
        e.preventDefault(); drop.classList.remove("is-over");
      }));
      drop.addEventListener("drop", function (e) {
        if (e.dataTransfer && e.dataTransfer.files) readFiles(e.dataTransfer.files);
      });
    }
    const fileInput = $("#rag-file");
    if (fileInput) fileInput.addEventListener("change", function () {
      readFiles(this.files);
      this.value = "";
    });
    const sample = $("#rag-sample");
    if (sample) sample.addEventListener("click", function () {
      window.LIT.SAMPLE_DOCS.forEach(function (d) {
        if (S.docs.some(x => x.name === d.name)) return;
        addDoc(d.name, d.kind, d.text);
      });
    });

    const form = $("#rag-form");
    if (form) form.addEventListener("submit", function (e) {
      e.preventDefault();
      const inp = $("#rag-q");
      ask(inp.value);
      inp.value = "";
    });

    paintDocs();
    paintChat();
  }

  /* ══════════════════════════════════════════════════════════════════════
     조립
     ══════════════════════════════════════════════════════════════════════ */
  function view() {
    if (!LIT_INDEX) LIT_INDEX = indexLiterature();
    return askPanel() + litSection() + ragSection();
  }

  function wire() {
    const input = $("#kron-q");
    if (input) {
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); runQuery(this.value); }
      });
    }
    const go = $("#kron-go");
    if (go) go.addEventListener("click", () => runQuery($("#kron-q").value));
    $$("[data-preset]").forEach(b => b.addEventListener("click", function () {
      const p = window.LIT.PROMPTS.find(x => x.id === b.dataset.preset);
      if (!p) return;
      $("#kron-q").value = p.q;
      runQuery(p.q);
    }));

    const lq = $("#lit-q");
    if (lq) {
      let t = null;
      lq.addEventListener("input", function () {
        clearTimeout(t);
        const v = this.value;
        t = setTimeout(function () { S.litQuery = v; paintLit(); }, 200);
      });
    }

    litList();
    wireRag();

    /* 탭을 다시 열었을 때 직전 결과를 되살립니다 —
       발표 중 탭을 옮겼다 돌아오면 화면이 비어 버리면 곤란합니다. */
    if (S.query) runQuery(S.query);
  }

  return { view, wire };
})();
