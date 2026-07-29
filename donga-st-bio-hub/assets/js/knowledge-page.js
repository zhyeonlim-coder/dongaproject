/* ==========================================================================
   연구 지식 — 이상 기록 · 트러블슈팅 사례집

   같은 레코드를 두 방향으로 읽습니다.
     배치에서 보면   "이 배치에 무슨 일이 있었나"
     사례집에서 보면 "이 증상일 때 남들은 어떻게 했나"

   그래서 기록하는 사람은 배치에서 이상을 적을 뿐이고, 사례집은 저절로
   쌓입니다. 사례집을 따로 관리하게 하면 아무도 채우지 않습니다.

   검색은 제목이 아니라 **증상**으로 합니다. 사람은 "HCP 높음" 으로 찾지,
   남이 붙인 제목을 기억하지 못합니다.
   ========================================================================== */

(function () {
  "use strict";

  const user = window.Shell.mount({ page: "knowledge" });
  if (!user) return;

  const L = window.LABELS, I = window.Issues, R = window.Repo;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  let q = "";
  let tagFilter = null;
  let openId = null;
  let writing = false;
  let editId = null;

  /* 초안이 보이는 범위는 "내 팀"입니다. 계정에 소속 필드가 없어 화면에서
     고른 팀을 씁니다 — 계정에 팀이 들어오면 이 한 줄만 바꾸면 됩니다. */
  function viewerTeam() { return window.Scope.get().team || null; }

  function paintSubnav() {
    const vt = viewerTeam();
    window.Shell.subnav([
      { label: "내 팀 (초안 보기)", items: window.DATA_TEAMS.map(t => ({
        key: t.id, ko: t.ko, active: vt === t.id, color: t.color })) },
      { label: "작성", items: [
        { key: "__new", ko: "+ 이상 기록 작성" }
      ]},
      { label: "바로가기", items: [
        { ko: "오늘 할 일", href: "worklist.html" },
        { ko: "데이터 조회", href: "data.html" },
        { ko: "K-Ron 문헌", href: "hub.html" }
      ]}
    ], function (k) {
      if (k === "__new") { writing = true; editId = null; }
      else window.Scope.setTeam(window.Scope.get().team === k ? null : k);
      render();
    });
  }

  /* ── 목록 ───────────────────────────────────────────────────────────── */
  function list() {
    const vt = viewerTeam();
    let items = I.search(q, vt);
    if (tagFilter) items = items.filter(i => (i.tags || []).indexOf(tagFilter) > -1);
    return items.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  function tagBar() {
    const tags = I.topTags(viewerTeam(), 14);
    if (!tags.length) return "";
    return '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:var(--s-4)">' +
      '<button class="mm-chip" data-tag="" aria-pressed="' + (!tagFilter) + '">전체</button>' +
      tags.map(t => '<button class="mm-chip" data-tag="' + esc(t.tag) + '" ' +
        'aria-pressed="' + (tagFilter === t.tag) + '">' + esc(t.tag) +
        '<span class="mm-chip-count">' + t.n + '</span></button>').join("") +
      '</div>';
  }

  function cardOf(i) {
    const sev = I.SEVERITY[i.severity] || I.SEVERITY.mid;
    const st = I.STATUS[i.status] || I.STATUS.investigating;
    const team = window.DATA_TEAMS.find(t => t.id === i.team);
    const open = openId === i.id;

    return '<section class="card" style="margin-bottom:var(--s-3);border-left:3px solid ' +
        (team ? team.color : "var(--c-border)") + '">' +
      '<div class="card-head" style="flex-wrap:wrap;gap:var(--s-3);cursor:pointer" ' +
        'data-open="' + esc(i.id) + '"><div style="min-width:0">' +
        '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:4px">' +
          '<span class="badge badge-' + sev.tone + '">위험도 ' + esc(sev.ko) + '</span>' +
          '<span class="badge badge-' + st.tone + '">' + esc(st.ko) + '</span>' +
          (team ? '<span class="badge">' + esc(team.short) + '</span>' : "") +
          (i.visibility === "team"
            ? '<span class="badge badge-warn">팀 내부 초안</span>'
            : '<span class="badge badge-ok">전체 공개</span>') +
          (i.batchId ? '<span class="badge mono">' + esc(i.batchId) + '</span>' : "") +
        '</div>' +
        '<h2 class="card-title" style="font-size:14.5px">' + esc(i.title) + '</h2>' +
        '<p class="card-sub" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;' +
          'overflow:hidden">' + esc(i.symptom) + '</p>' +
      '</div>' +
      '<div style="text-align:right;font-size:11px;color:var(--c-text-mute);white-space:nowrap">' +
        esc(i.createdBy) + '<br>' + esc(String(i.updatedAt || i.createdAt).slice(0, 10)) + '</div>' +
      '</div>' +
      (open ? detailOf(i) : "") +
    '</section>';
  }

  const FIVE = [
    ["symptom", "현상", "무엇이 어떻게 이상했나"],
    ["cause", "추정 원인", "왜 그랬다고 보는가"],
    ["action", "조치", "무엇을 했나"],
    ["outcome", "조치 결과", "그래서 나아졌나"],
    ["prevention", "재발 방지", "다음에 같은 일이 없으려면"]
  ];

  function detailOf(i) {
    const batch = i.batchId ? window.DATA_BATCHES.find(b => b.id === i.batchId) : null;

    return '<div class="card-body" style="border-top:1px solid var(--c-border)">' +
      FIVE.map(function (f) {
        const v = i[f[0]];
        return '<div style="margin-bottom:var(--s-4)">' +
          '<div class="eyebrow" style="margin-bottom:4px">' + esc(f[1]) +
            '<span style="font-weight:400;text-transform:none;color:var(--c-text-soft)"> · ' +
            esc(f[2]) + '</span></div>' +
          (v ? '<p style="font-size:13px;line-height:1.8;margin:0">' + esc(v) + '</p>'
             : '<p style="font-size:12.5px;color:var(--c-text-soft);margin:0">' +
               (f[0] === "action" || f[0] === "outcome"
                 ? '아직 비어 있습니다 — 이 칸이 채워져야 공개할 수 있습니다.'
                 : '아직 비어 있습니다.') + '</p>') +
        '</div>';
      }).join("") +

      ((i.tags || []).length
        ? '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:var(--s-4)">' +
          i.tags.map(t => '<span class="badge">' + esc(t) + '</span>').join("") + '</div>'
        : "") +

      (batch
        ? '<div class="eyebrow" style="margin-bottom:var(--s-2)">이 배치가 쓴 자재</div>' +
          '<div class="tbl-scroll" style="margin-bottom:var(--s-4)">' + lotTable(batch.id) + '</div>'
        : "") +

      '<div style="display:flex;gap:var(--s-2);flex-wrap:wrap;padding-top:var(--s-3);' +
        'border-top:1px solid var(--c-paper-2)">' +
        '<button class="btn btn-ghost btn-sm" data-edit="' + esc(i.id) + '">수정</button>' +
        (i.visibility === "team"
          ? '<button class="btn btn-accent btn-sm" data-pub="' + esc(i.id) + '">전체 공개</button>'
          : '<button class="btn btn-ghost btn-sm" data-unpub="' + esc(i.id) + '">초안으로 되돌리기</button>') +
        (i.batchId ? '<a class="btn btn-ghost btn-sm" href="data.html">데이터 조회</a>' : "") +
        '<span style="margin-left:auto;font-size:11px;color:var(--c-text-mute);align-self:center">' +
          esc(I.VISIBILITY[i.visibility].hint) + '</span>' +
      '</div></div>';
  }

  /* 이상 조사의 출발점 — 이 배치가 어느 lot 을 썼나 */
  function lotTable(batchId) {
    const rows = window.Lots ? window.Lots.forBatch(batchId) : [];
    if (!rows.length) return '<p style="font-size:12.5px;color:var(--c-text-mute)">자재 정보가 없습니다.</p>';
    return '<table class="tbl"><thead><tr>' +
      '<th scope="col">역할</th><th scope="col">자재</th><th scope="col">Lot</th>' +
      '<th scope="col">사용 이력</th><th scope="col">유효기간</th>' +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        const u = window.Lots.usage(r.lot);
        const ex = window.Lots.expiry(r.lot);
        return '<tr><td>' + esc(r.role) + '</td>' +
          '<td>' + esc(r.lot.name) + '</td>' +
          '<td class="mono">' + esc(r.lot.lotNo) + '</td>' +
          '<td class="mono">' + esc(r.extra || (u ? u.used + " / " + u.limit + " " + u.unit : "—")) + '</td>' +
          '<td class="mono"' + (ex && ex.state !== "ok" ? ' style="color:var(--c-risk)"' : "") + '>' +
            (ex ? esc(ex.expiryAt) + (ex.state === "expired" ? " (지남)" : "") : "—") + '</td></tr>';
      }).join("") + '</tbody></table>';
  }

  /* ── 작성 폼 ────────────────────────────────────────────────────────── */
  function formView() {
    const cur = editId ? I.get(editId) : null;
    const sel = window.Scope.get();
    const ids = sel.scopeId ? R.studiesInScope(sel).map(x => x.id) : null;
    const batches = window.DATA_BATCHES.filter(b => !ids || ids.indexOf(b.studyId) > -1);

    return '<section class="card"><div class="card-head"><div>' +
        '<h2 class="card-title">' + (cur ? "이상 기록 수정" : "이상 기록 작성") + '</h2>' +
        '<p class="card-sub">다섯 칸을 채우면 사례집에 그대로 쌓입니다 · ' +
          '새 기록은 팀 내부 초안으로 시작합니다</p></div>' +
        '<button class="btn btn-ghost btn-sm" id="k-cancel">취소</button></div>' +
      '<form class="card-body" id="k-form">' +
        '<div class="ebr-grid" style="margin-bottom:var(--s-4)">' +
          '<label class="ebr-cell" style="grid-column:1/-1"><span>제목 (필수)</span>' +
            '<input class="ebr-input" id="k-title" value="' + esc(cur ? cur.title : "") + '" ' +
              'placeholder="예: 배양 후기 생존율 급락 (Harvest 59.7%)"></label>' +
          '<label class="ebr-cell"><span>관련 배치</span>' +
            '<select class="ebr-input" id="k-batch"><option value="">— 특정 배치 없음 —</option>' +
              batches.map(b => '<option value="' + esc(b.id) + '"' +
                (cur && cur.batchId === b.id ? " selected" : "") + '>' + esc(b.id) + '</option>').join("") +
            '</select></label>' +
          '<label class="ebr-cell"><span>팀</span>' +
            '<select class="ebr-input" id="k-team">' +
              window.DATA_TEAMS.map(t => '<option value="' + t.id + '"' +
                ((cur ? cur.team : viewerTeam()) === t.id ? " selected" : "") + '>' +
                esc(t.ko) + '</option>').join("") +
            '</select></label>' +
          '<label class="ebr-cell"><span>위험도</span>' +
            '<select class="ebr-input" id="k-sev">' +
              Object.keys(I.SEVERITY).map(k => '<option value="' + k + '"' +
                ((cur ? cur.severity : "mid") === k ? " selected" : "") + '>' +
                esc(I.SEVERITY[k].ko) + ' — ' + esc(I.SEVERITY[k].hint) + '</option>').join("") +
            '</select></label>' +
          '<label class="ebr-cell"><span>상태</span>' +
            '<select class="ebr-input" id="k-status">' +
              Object.keys(I.STATUS).map(k => '<option value="' + k + '"' +
                ((cur ? cur.status : "investigating") === k ? " selected" : "") + '>' +
                esc(I.STATUS[k].ko) + '</option>').join("") +
            '</select></label>' +
        '</div>' +

        FIVE.map(function (f) {
          return '<label class="ebr-cell" style="margin-bottom:var(--s-4)">' +
            '<span>' + esc(f[1]) + (f[0] === "symptom" ? " (필수)" : "") +
              ' <span style="font-weight:400;color:var(--c-text-soft)">· ' + esc(f[2]) + '</span></span>' +
            '<textarea class="ebr-input" id="k-' + f[0] + '" rows="3" ' +
              'style="min-height:78px;padding:8px 10px;line-height:1.7;font-family:inherit">' +
              esc(cur ? (cur[f[0]] || "") : "") + '</textarea></label>';
        }).join("") +

        '<label class="ebr-cell" style="margin-bottom:var(--s-4)"><span>태그 (쉼표로 구분)</span>' +
          '<input class="ebr-input" id="k-tags" value="' +
            esc(cur ? (cur.tags || []).join(", ") : "") + '" ' +
            'placeholder="예: HCP, Protein A, 세정, 수율"></label>' +

        '<div style="display:flex;gap:var(--s-3);align-items:center;flex-wrap:wrap">' +
          '<button class="btn btn-accent" type="submit">' + (cur ? "저장" : "기록 만들기") + '</button>' +
          '<p class="field-error" id="k-err" role="alert" style="margin:0"></p>' +
        '</div>' +
      '</form></section>';
  }

  /* ── 렌더 ───────────────────────────────────────────────────────────── */
  function render() {
    paintSubnav();
    const vt = viewerTeam();
    const teamKo = vt ? (window.DATA_TEAMS.find(t => t.id === vt) || {}).ko : null;

    $("#page-title").textContent = "연구 지식 · 트러블슈팅 사례집";
    $("#crumb").innerHTML = teamKo
      ? '<span>' + esc(teamKo) + ' 초안 포함</span>'
      : '<span style="color:var(--c-text-mute)">전체 공개 사례만 — 좌측에서 팀을 고르면 그 팀 초안도 보입니다</span>';

    if (writing) { $("#body").innerHTML = formView(); wireForm(); return; }

    const items = list();
    $("#body").innerHTML =
      '<section class="card" style="margin-bottom:var(--s-4)"><div class="card-body">' +
        '<div class="ai-bar">' +
          '<span class="ai-bar-icon" aria-hidden="true">' +
            '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></span>' +
          '<label class="sr-only" for="k-q">증상으로 검색</label>' +
          '<input class="ai-bar-input" id="k-q" type="search" value="' + esc(q) + '" ' +
            'placeholder="증상으로 찾기 (예: HCP 높음, 생존율 급락, 피크 갈라짐)">' +
        '</div>' +
        '<p style="font-size:11.5px;color:var(--c-text-mute);margin:var(--s-3) 0 0;line-height:1.7">' +
          '제목뿐 아니라 현상 · 원인 · 조치 · 재발 방지 본문을 모두 훑습니다. ' +
          '남이 붙인 제목을 기억할 필요 없이 겪은 증상으로 찾으세요.</p>' +
      '</div></section>' +

      tagBar() +

      '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:var(--s-3);' +
        'margin-bottom:var(--s-3);flex-wrap:wrap">' +
        '<span style="font-size:12.5px;color:var(--c-text-mute)">' + items.length + '건' +
          (q ? ' · "' + esc(q) + '" 검색 결과' : "") +
          (tagFilter ? ' · 태그 ' + esc(tagFilter) : "") + '</span>' +
        '<button class="btn btn-accent btn-sm" id="k-new">+ 이상 기록 작성</button>' +
      '</div>' +

      (items.length
        ? items.map(cardOf).join("")
        : '<div class="empty"><div class="empty-title">' + esc(L.noResult) + '</div>' +
          '<div class="empty-body">검색어나 태그를 지워 보세요. ' +
          '초안은 작성 팀에게만 보이므로, 좌측에서 팀을 고르면 더 나올 수 있습니다.</div></div>');

    wireList();
  }

  function wireList() {
    const s = $("#k-q");
    if (s) {
      let t = null;
      s.addEventListener("input", function () {
        clearTimeout(t);
        const v = this.value, pos = this.selectionStart;
        t = setTimeout(function () {
          q = v; render();
          const n = $("#k-q");
          if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} }
        }, 220);
      });
    }
    $$("[data-tag]").forEach(b => b.addEventListener("click", function () {
      tagFilter = b.dataset.tag || null; render();
    }));
    $$("[data-open]").forEach(b => b.addEventListener("click", function () {
      openId = openId === b.dataset.open ? null : b.dataset.open; render();
    }));
    $$("[data-edit]").forEach(b => b.addEventListener("click", function (e) {
      e.stopPropagation(); writing = true; editId = b.dataset.edit; render();
    }));
    $$("[data-pub]").forEach(b => b.addEventListener("click", function (e) {
      e.stopPropagation();
      const r = I.publish(b.dataset.pub);
      if (!r.ok) { window.alert(r.reason); return; }
      render();
    }));
    $$("[data-unpub]").forEach(b => b.addEventListener("click", function (e) {
      e.stopPropagation(); I.unpublish(b.dataset.unpub); render();
    }));
    const nb = $("#k-new");
    if (nb) nb.addEventListener("click", function () { writing = true; editId = null; render(); });
  }

  function wireForm() {
    $("#k-cancel").addEventListener("click", function () {
      writing = false; editId = null; render();
    });
    $("#k-form").addEventListener("submit", function (e) {
      e.preventDefault();
      const err = $("#k-err");
      const batchId = $("#k-batch").value || null;
      const batch = batchId ? window.DATA_BATCHES.find(b => b.id === batchId) : null;
      const payload = {
        title: $("#k-title").value,
        batchId: batchId,
        studyId: batch ? batch.studyId : (window.Scope.get().studyId || null),
        team: $("#k-team").value,
        severity: $("#k-sev").value,
        status: $("#k-status").value,
        tags: $("#k-tags").value.split(",").map(t => t.trim()).filter(Boolean)
      };
      FIVE.forEach(f => { payload[f[0]] = $("#k-" + f[0]).value; });

      const res = editId ? I.update(editId, payload) : I.create(payload);
      if (!res.ok) { err.textContent = res.reason; err.classList.add("is-shown"); return; }
      err.classList.remove("is-shown");
      openId = res.issue.id;
      writing = false; editId = null;
      render();
    });
  }

  window.StudySelector.mount($("#selector"), { showResults: false });
  window.Scope.subscribe(render);
  window.Issues.subscribe(render);
  render();
})();
