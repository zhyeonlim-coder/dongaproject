/* ==========================================================================
   Troubleshooting & Lesson Learned — DoE & Intelligence 안의 위키 모듈

   실험 이슈(pH Drift · Titer Drop · Purity 이상 …)별로
     원인 → 해결책 → 관련 배치
   를 카드로 봅니다. 자료는 Issues 모듈에 쌓인 이상 기록 그대로입니다 —
   위키를 따로 채우게 하면 아무도 안 채웁니다.

   ── DoE 와 상호 참조 ────────────────────────────────────────────────────
   설계 조건을 정하는 자리에서 "그 조건에서 예전에 뭐가 터졌는지"를 같이
   봐야 의미가 있습니다. 그래서 두 방향으로 잇습니다.

     DoE 분석 화면  → 요인·반응치 이름으로 관련 사례를 찾아 옆에 붙입니다
     위키 카드      → 관련 배치와 DoE 설계로 되돌아가는 링크를 답니다

   검색은 증상으로 합니다. 남이 붙인 제목을 기억할 필요가 없어야 합니다.
   ========================================================================== */

window.Wiki = (function () {
  "use strict";

  const esc = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  /* 이슈 분류 — 현업에서 부르는 이름으로 묶습니다. 각 분류는 사례 본문에서
     찾을 키워드를 들고 있어, 기록하는 사람이 분류를 고르지 않아도 걸립니다.

     ── 키워드를 한글·영문 양쪽으로 두는 이유 ────────────────────────────
     DoE 요인은 영문으로 적히고(pH · Temp · Feed rate · Titer) 사례 본문은
     한글로 쓰입니다("산도", "피드", "역가"). 한쪽만 두면 설계 화면에서
     관련 사례를 하나도 못 찾습니다 — 실제로 그렇게 비어 있었습니다.
     두 표기를 같은 분류에 묶어 두면 그 분류가 다리 역할을 합니다. */
  const TOPICS = [
    { id: "titer",   ko: "Titer Drop",      keys: ["titer", "역가", "생산량", "hccf", "qp"] },
    { id: "ph",      ko: "pH Drift",        keys: ["ph", "산도", "완충", "buffer", "전도도", "conductivity"] },
    { id: "viab",    ko: "생존율 급락",      keys: ["생존율", "viability", "파쇄", "harvest", "글루코스", "glucose",
                                                   "피드", "feed", "온도", "temp", "배양", "culture"] },
    { id: "purity",  ko: "Purity 이상",     keys: ["순도", "purity", "monomer", "hmw", "응집", "aggregate",
                                                   "피크", "peak", "main"] },
    { id: "glycan",  ko: "당쇄 프로파일 이상", keys: ["당쇄", "glycan", "고만노스", "mannose", "시알산",
                                                     "sialic", "아푸코", "fucos"] },
    { id: "impur",   ko: "불순물 (HCP/DNA)", keys: ["hcp", "숙주", "host cell", "dna", "불순물", "impurit", "잔류"] },
    { id: "yield",   ko: "수율 저하",        keys: ["수율", "yield", "회수", "recovery", "용출", "elution", "로드", "load"] },
    { id: "equip",   ko: "장비 · 컬럼",     keys: ["컬럼", "column", "resin", "사이클", "cycle",
                                                   "적합성", "suitability", "장비"] }
  ];

  let state = { q: "", topic: null, open: null, team: null };

  function text(i) {
    return [i.title, i.symptom, i.cause, i.action, i.outcome, i.prevention,
            (i.tags || []).join(" ")].join(" ").toLowerCase();
  }

  function matchTopic(i, topicId) {
    const t = TOPICS.find(x => x.id === topicId);
    if (!t) return true;
    const s = text(i);
    return t.keys.some(k => s.indexOf(k) > -1);
  }

  function pool() {
    return window.Issues.visibleTo(state.team);
  }

  function list() {
    let out = window.Issues.search(state.q, state.team);
    if (state.topic) out = out.filter(i => matchTopic(i, state.topic));
    return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  /* ── 관련 배치 ──────────────────────────────────────────────────────────
     기록에 배치가 달려 있으면 그것, 없으면 같은 Study 배치를 후보로 보여
     "어디서 있었던 일인가"를 잃지 않게 합니다. */
  function relatedBatches(i) {
    if (i.batchId) return [i.batchId];
    if (!i.studyId || !window.DATA_BATCHES) return [];
    return window.DATA_BATCHES.filter(b => b.studyId === i.studyId).map(b => b.id);
  }

  /* ── DoE 상호 참조 ──────────────────────────────────────────────────────
     요인 이름(pH · Temp · Feed)과 반응치 이름(Titer)으로 사례를 찾습니다.
     설계를 만지는 중에 관련 사례가 눌려 있으면 아무도 안 봅니다. */
  /* 요인·반응치 이름을 그대로 본문에서 찾지 않고, **분류를 거쳐** 잇습니다.
     이름을 직접 대조하면 두 가지가 깨집니다.
       · 표기 차이 — "Feed rate" 는 "피드" 를 못 찾습니다
       · 짧은 토큰 — "ph" 가 "graph" 안에서도 걸립니다
     분류가 한글·영문 키워드를 함께 들고 있어 다리가 되어 줍니다. */
  function forDesign(factorNames, responseName, limit) {
    const raw = (factorNames || []).concat([responseName || ""]).join(" ").toLowerCase();
    if (!raw.trim()) return [];

    const topics = TOPICS.filter(t => t.keys.some(k => raw.indexOf(k) > -1));
    if (!topics.length) return [];

    const scored = pool().map(function (i) {
      const hit = topics.filter(t => matchTopic(i, t.id));
      return { issue: i, hits: hit.length, topics: hit.map(t => t.ko) };
    }).filter(x => x.hits > 0)
      .sort((a, b) => b.hits - a.hits ||
        String(b.issue.updatedAt).localeCompare(String(a.issue.updatedAt)));

    return scored.slice(0, limit || 3);
  }

  /* DoE 분석 화면에 붙는 패널 */
  function designPanel(factorNames, responseName) {
    const hits = forDesign(factorNames, responseName, 3);
    if (!hits.length) {
      return '<div class="eyebrow" style="margin-bottom:var(--s-2)">관련 트러블슈팅</div>' +
        '<p style="font-size:12px;color:var(--c-text-mute);margin:0">' +
        '이 요인·반응치와 겹치는 과거 사례가 없습니다.</p>';
    }
    return '<div class="eyebrow" style="margin-bottom:var(--s-2)">관련 트러블슈팅 ' +
        hits.length + '건</div>' +
      hits.map(function (h) {
        const i = h.issue;
        const sev = window.Issues.SEVERITY[i.severity] || {};
        return '<a class="wiki-mini" href="#wiki-' + esc(i.id) + '" data-jump="' + esc(i.id) + '">' +
          '<span class="badge badge-' + (sev.tone || "info") + '" style="font-size:10px;flex:none">' +
            esc(sev.ko || "") + '</span>' +
          '<span style="min-width:0;flex:1">' +
            '<span style="display:block;font-size:12px;font-weight:600">' + esc(i.title) + '</span>' +
            '<span style="display:block;font-size:11px;color:var(--c-text-mute);' +
              'overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
              esc(i.prevention || i.action || i.symptom) + '</span>' +
            /* 왜 걸렸는지 보여줍니다 — 근거 없이 "관련 있음"만 뜨면 못 믿습니다 */
            (h.topics && h.topics.length
              ? '<span style="display:block;margin-top:3px">' + h.topics.map(t =>
                  '<span class="badge" style="font-size:9.5px">' + esc(t) + '</span>').join(" ") + '</span>'
              : "") +
          '</span></a>';
      }).join("") +
      '<p style="font-size:11px;color:var(--c-text-mute);margin:var(--s-2) 0 0;line-height:1.6">' +
        '요인·반응치 이름이 속한 이슈 분류로 사례를 찾았습니다. ' +
        '누르면 Troubleshooting &amp; Wiki 탭에서 펼쳐집니다.</p>';
  }

  /* ══════════════════════════════════════════════════════════════════════
     위키 화면
     ══════════════════════════════════════════════════════════════════════ */
  const FIVE = [
    ["symptom", "현상"], ["cause", "원인"], ["action", "해결책"],
    ["outcome", "결과"], ["prevention", "재발 방지"]
  ];

  function view() {
    const items = list();
    const all = pool();
    const counts = {};
    TOPICS.forEach(t => { counts[t.id] = all.filter(i => matchTopic(i, t.id)).length; });

    return '<section class="card" style="margin-bottom:var(--s-4)"><div class="card-body">' +
        '<div class="ai-bar">' +
          '<span class="ai-bar-icon" aria-hidden="true">' +
            '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></span>' +
          '<label class="sr-only" for="wk-q">증상으로 검색</label>' +
          '<input class="ai-bar-input" id="wk-q" type="search" value="' + esc(state.q) + '" ' +
            'placeholder="증상으로 찾기 (예: HCP 높음, 생존율 급락, 피크 갈라짐)">' +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:var(--s-3)">' +
          '<button class="mm-chip" data-topic="" aria-pressed="' + (!state.topic) + '">전체 ' +
            '<span class="mm-chip-count">' + all.length + '</span></button>' +
          TOPICS.filter(t => counts[t.id]).map(t =>
            '<button class="mm-chip" data-topic="' + t.id + '" ' +
            'aria-pressed="' + (state.topic === t.id) + '">' + esc(t.ko) +
            '<span class="mm-chip-count">' + counts[t.id] + '</span></button>').join("") +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:var(--s-3);' +
          'padding-top:var(--s-3);border-top:1px solid var(--c-paper-2)">' +
          '<span style="font-size:11.5px;color:var(--c-text-mute)">팀 내부 초안 보기</span>' +
          '<button class="mm-chip" data-wteam="" aria-pressed="' + (!state.team) + '">공개만</button>' +
          window.DATA_TEAMS.map(t => '<button class="mm-chip" data-wteam="' + t.id + '" ' +
            'aria-pressed="' + (state.team === t.id) + '">' + esc(t.short) + '</button>').join("") +
          '<button class="btn btn-accent btn-sm" id="wk-new" style="margin-left:auto">' +
            '+ 이상 기록 작성</button>' +
        '</div>' +
      '</div></section>' +

      '<p style="font-size:12.5px;color:var(--c-text-mute);margin:0 0 var(--s-3)">' +
        items.length + '건' + (state.q ? ' · "' + esc(state.q) + '" 검색' : "") +
        (state.topic ? ' · ' + esc((TOPICS.find(t => t.id === state.topic) || {}).ko) : "") + '</p>' +

      (items.length
        ? '<div class="wiki-grid">' + items.map(cardOf).join("") + '</div>'
        : '<div class="empty"><div class="empty-title">' + esc(window.LABELS.noResult) + '</div>' +
          '<div class="empty-body">검색어나 분류를 지워 보세요. ' +
          '초안은 작성 팀에게만 보이므로 위에서 팀을 고르면 더 나올 수 있습니다.</div></div>');
  }

  function cardOf(i) {
    const sev = window.Issues.SEVERITY[i.severity] || {};
    const st = window.Issues.STATUS[i.status] || {};
    const team = window.DATA_TEAMS.find(t => t.id === i.team);
    const open = state.open === i.id;
    const batches = relatedBatches(i);
    const topics = TOPICS.filter(t => matchTopic(i, t.id));

    return '<article class="card wiki-card" id="wiki-' + esc(i.id) + '"' +
        (team ? ' style="border-top:3px solid ' + team.color + '"' : "") + '>' +
      '<div class="card-body" style="cursor:pointer" data-wopen="' + esc(i.id) + '">' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">' +
          '<span class="badge badge-' + (sev.tone || "info") + '">위험도 ' + esc(sev.ko || "") + '</span>' +
          '<span class="badge badge-' + (st.tone || "info") + '">' + esc(st.ko || "") + '</span>' +
          (i.visibility === "team" ? '<span class="badge badge-warn">초안</span>' : "") +
        '</div>' +
        '<h3 style="font-size:14px;font-weight:700;margin:0 0 6px;line-height:1.5">' + esc(i.title) + '</h3>' +
        '<p style="font-size:12.5px;color:var(--c-text-mute);line-height:1.7;margin:0;' +
          (open ? "" : 'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden') +
          '">' + esc(i.symptom) + '</p>' +
        (topics.length
          ? '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:8px">' +
            topics.slice(0, 3).map(t => '<span class="badge" style="font-size:10px">' +
              esc(t.ko) + '</span>').join("") + '</div>'
          : "") +
      '</div>' +

      (open
        ? '<div class="card-body" style="border-top:1px solid var(--c-border);padding-top:var(--s-3)">' +
            FIVE.slice(1).map(function (f) {
              const v = i[f[0]];
              return '<div style="margin-bottom:var(--s-3)">' +
                '<div class="eyebrow" style="margin-bottom:3px">' + esc(f[1]) + '</div>' +
                (v ? '<p style="font-size:12.5px;line-height:1.75;margin:0">' + esc(v) + '</p>'
                   : '<p style="font-size:12px;color:var(--c-text-soft);margin:0">비어 있습니다</p>') +
              '</div>';
            }).join("") +

            (batches.length
              ? '<div class="eyebrow" style="margin-bottom:4px">관련 배치</div>' +
                '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:var(--s-3)">' +
                batches.slice(0, 8).map(b => '<span class="badge mono" style="font-size:10.5px">' +
                  esc(b) + '</span>').join("") +
                (batches.length > 8 ? '<span class="badge" style="font-size:10.5px">+' +
                  (batches.length - 8) + '</span>' : "") + '</div>'
              : "") +

            '<div style="display:flex;gap:6px;flex-wrap:wrap;font-size:11px;color:var(--c-text-mute)">' +
              '<span>' + esc(i.createdBy) + ' · ' + esc(String(i.updatedAt || i.createdAt).slice(0, 10)) + '</span>' +
              '<a href="data.html" style="margin-left:auto">데이터 조회</a>' +
              (i.visibility === "team"
                ? '<button class="btn btn-accent btn-sm" data-wpub="' + esc(i.id) + '">전체 공개</button>'
                : "") +
              '<button class="btn btn-ghost btn-sm" data-wedit="' + esc(i.id) + '">수정</button>' +
            '</div>' +
          '</div>'
        : "") +
    '</article>';
  }

  /* ── 작성 · 수정 ────────────────────────────────────────────────────────
     사례를 남기는 자리는 여기 하나입니다. Issues 모듈이 검증까지 합니다. */
  function formView(editId) {
    const cur = editId ? window.Issues.get(editId) : null;
    const batches = window.DATA_BATCHES || [];
    const F = [["symptom", "현상 (필수)", "무엇이 어떻게 이상했나"],
               ["cause", "원인", "왜 그랬다고 보는가"],
               ["action", "해결책", "무엇을 했나"],
               ["outcome", "결과", "그래서 나아졌나"],
               ["prevention", "재발 방지", "다음에 같은 일이 없으려면"]];

    return '<section class="card"><div class="card-head"><div>' +
        '<h2 class="card-title">' + (cur ? "이상 기록 수정" : "이상 기록 작성") + '</h2>' +
        '<p class="card-sub">새 기록은 팀 내부 초안으로 시작하고, 해결책과 결과를 채워야 전체 공개할 수 있습니다</p>' +
        '</div><button class="btn btn-ghost btn-sm" id="wk-cancel">취소</button></div>' +
      '<form class="card-body" id="wk-form">' +
        '<div class="ebr-grid" style="margin-bottom:var(--s-4)">' +
          '<label class="ebr-cell" style="grid-column:1/-1"><span>제목 (필수)</span>' +
            '<input class="ebr-input" id="wk-title" value="' + esc(cur ? cur.title : "") + '" ' +
              'placeholder="예: 배양 후기 생존율 급락 (Harvest 59.7%)"></label>' +
          '<label class="ebr-cell"><span>관련 배치</span>' +
            '<select class="ebr-input" id="wk-batch"><option value="">— 특정 배치 없음 —</option>' +
              batches.map(b => '<option value="' + esc(b.id) + '"' +
                (cur && cur.batchId === b.id ? " selected" : "") + '>' + esc(b.id) + '</option>').join("") +
            '</select></label>' +
          '<label class="ebr-cell"><span>팀</span>' +
            '<select class="ebr-input" id="wk-team">' +
              window.DATA_TEAMS.map(t => '<option value="' + t.id + '"' +
                ((cur ? cur.team : state.team) === t.id ? " selected" : "") + '>' +
                esc(t.ko) + '</option>').join("") + '</select></label>' +
          '<label class="ebr-cell"><span>위험도</span>' +
            '<select class="ebr-input" id="wk-sev">' +
              Object.keys(window.Issues.SEVERITY).map(k => '<option value="' + k + '"' +
                ((cur ? cur.severity : "mid") === k ? " selected" : "") + '>' +
                esc(window.Issues.SEVERITY[k].ko) + '</option>').join("") + '</select></label>' +
          '<label class="ebr-cell"><span>상태</span>' +
            '<select class="ebr-input" id="wk-status">' +
              Object.keys(window.Issues.STATUS).map(k => '<option value="' + k + '"' +
                ((cur ? cur.status : "investigating") === k ? " selected" : "") + '>' +
                esc(window.Issues.STATUS[k].ko) + '</option>').join("") + '</select></label>' +
        '</div>' +
        F.map(f => '<label class="ebr-cell" style="margin-bottom:var(--s-4)">' +
          '<span>' + esc(f[1]) + ' <span style="font-weight:400;color:var(--c-text-soft)">· ' +
            esc(f[2]) + '</span></span>' +
          '<textarea class="ebr-input" id="wk-' + f[0] + '" rows="3" ' +
            'style="min-height:76px;padding:8px 10px;line-height:1.7;font-family:inherit">' +
            esc(cur ? (cur[f[0]] || "") : "") + '</textarea></label>').join("") +
        '<label class="ebr-cell" style="margin-bottom:var(--s-4)"><span>태그 (쉼표로 구분)</span>' +
          '<input class="ebr-input" id="wk-tags" value="' +
            esc(cur ? (cur.tags || []).join(", ") : "") + '" ' +
            'placeholder="예: HCP, Protein A, 세정, 수율"></label>' +
        '<div style="display:flex;gap:var(--s-3);align-items:center;flex-wrap:wrap">' +
          '<button class="btn btn-accent" type="submit">' + (cur ? "저장" : "기록 만들기") + '</button>' +
          '<p class="field-error" id="wk-err" role="alert" style="margin:0"></p>' +
        '</div>' +
      '</form></section>';
  }

  /* onRepaint() — hub.js 가 넘겨주는 재렌더 콜백.
     이 모듈은 자기 DOM 만 알고 hub 의 탭 구조는 모릅니다. */
  function wire(onRepaint) {
    const q = $("#wk-q");
    if (q) {
      let t = null;
      q.addEventListener("input", function () {
        clearTimeout(t);
        const v = this.value, pos = this.selectionStart;
        t = setTimeout(function () {
          state.q = v; onRepaint();
          const n = $("#wk-q");
          if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} }
        }, 220);
      });
    }
    $$("[data-topic]").forEach(b => b.addEventListener("click", function () {
      state.topic = b.dataset.topic || null; onRepaint();
    }));
    $$("[data-wteam]").forEach(b => b.addEventListener("click", function () {
      state.team = b.dataset.wteam || null; onRepaint();
    }));
    $$("[data-wopen]").forEach(b => b.addEventListener("click", function () {
      state.open = state.open === b.dataset.wopen ? null : b.dataset.wopen; onRepaint();
    }));
    $$("[data-wpub]").forEach(b => b.addEventListener("click", function (e) {
      e.stopPropagation();
      const r = window.Issues.publish(b.dataset.wpub);
      if (!r.ok) { window.alert(r.reason); return; }
      onRepaint();
    }));
    $$("[data-wedit]").forEach(b => b.addEventListener("click", function (e) {
      e.stopPropagation(); onRepaint({ edit: b.dataset.wedit });
    }));
    const nb = $("#wk-new");
    if (nb) nb.addEventListener("click", function () { onRepaint({ edit: null, writing: true }); });
  }

  function wireForm(editId, onRepaint) {
    $("#wk-cancel").addEventListener("click", function () { onRepaint({ done: true }); });
    $("#wk-form").addEventListener("submit", function (e) {
      e.preventDefault();
      const err = $("#wk-err");
      const batchId = $("#wk-batch").value || null;
      const batch = batchId ? (window.DATA_BATCHES || []).find(b => b.id === batchId) : null;
      const payload = {
        title: $("#wk-title").value,
        batchId: batchId,
        studyId: batch ? batch.studyId : null,
        team: $("#wk-team").value,
        severity: $("#wk-sev").value,
        status: $("#wk-status").value,
        tags: $("#wk-tags").value.split(",").map(t => t.trim()).filter(Boolean)
      };
      ["symptom", "cause", "action", "outcome", "prevention"]
        .forEach(k => { payload[k] = $("#wk-" + k).value; });

      const res = editId ? window.Issues.update(editId, payload) : window.Issues.create(payload);
      if (!res.ok) { err.textContent = res.reason; err.classList.add("is-shown"); return; }
      state.open = res.issue.id;
      state.team = res.issue.team;          // 방금 만든 초안이 보이도록
      onRepaint({ done: true });
    });
  }

  return { TOPICS, view, formView, wire, wireForm, designPanel, forDesign,
           relatedBatches, state: () => state };
})();
