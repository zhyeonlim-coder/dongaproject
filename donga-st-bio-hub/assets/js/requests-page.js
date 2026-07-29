/* ==========================================================================
   분석 의뢰 · 시료 보관

   세 팀이 실제로 만나는 지점입니다. 배양·정제팀은 시료를 넘기고 분석팀은
   받아서 시험합니다. 지금 이 인계는 구두·메신저로 이뤄져 시스템에 흔적이
   남지 않습니다.

     의뢰 큐    분석팀의 "오늘 뭐가 들어왔나" 화면
     의뢰하기   시료를 골라 시험 항목과 목적을 적어 넘김
     시료 보관  "그 시료 어디 있어요?" 에 답하는 화면

   상태 전환은 Requests 모듈이 관리하고, 이 파일은 그리기만 합니다.
   ========================================================================== */

(function () {
  "use strict";

  const user = window.Shell.mount({ page: "requests" });
  if (!user) return;

  const L = window.LABELS, R = window.Repo, Q = window.Requests;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  let tab = "queue";            // "queue" | "new" | "storage"
  let filter = "open";          // "open" | "all"
  let openId = null;

  const TEST_LABEL = {};
  window.DATA_ANALYTE_GROUPS.forEach(g => {
    if (g.team === "analytics" && !g.empty) TEST_LABEL[g.id] = g.label;
  });

  function paintSubnav() {
    window.Shell.subnav([
      { label: "분석 의뢰", items: [
        { key: "queue",   ko: "의뢰 큐",   active: tab === "queue" },
        { key: "new",     ko: "의뢰하기",  active: tab === "new" },
        { key: "storage", ko: "시료 보관", active: tab === "storage" }
      ]},
      { label: "바로가기", items: [
        { ko: "오늘 할 일", href: "worklist.html" },
        { ko: "EBR 입력", href: "ebr.html" },
        { ko: "연구 지식", href: "knowledge.html" }
      ]}
    ], k => { tab = k; render(); });
  }

  /* ══════════════════════════════════════════════════════════════════════
     1. 의뢰 큐
     ══════════════════════════════════════════════════════════════════════ */
  function dueBadge(r) {
    const d = Q.due(r);
    if (!d) return "";
    const txt = d.state === "over" ? "기한 " + (-d.days) + "일 초과"
              : d.days === 0 ? "오늘 마감" : "D-" + d.days;
    const tone = d.state === "over" ? "risk" : d.state === "today" || d.state === "soon" ? "warn" : "";
    return '<span class="badge' + (tone ? " badge-" + tone : "") + '" style="font-size:10px">' +
      esc(txt) + '</span>';
  }

  function sampleNames(r) {
    return (r.sampleIds || []).map(function (id) {
      const s = (window.DATA_SAMPLES || []).find(x => x.id === id);
      return s ? s.name : id;
    });
  }

  function queueView() {
    const sel = window.Scope.get();
    let list = Q.forSelection(sel);
    if (filter === "open") list = list.filter(Q.isOpen);

    const byStatus = {};
    Q.forSelection(sel).forEach(r => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });

    return '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:var(--s-4)">' +
        Q.FLOW.map(function (s) {
          const st = Q.STATUS[s];
          return '<span class="badge badge-' + st.tone + '">' + esc(st.ko) +
            ' <b>' + (byStatus[s] || 0) + '</b></span>';
        }).join("") +
        (byStatus.rejected ? '<span class="badge badge-risk">반려 <b>' + byStatus.rejected + '</b></span>' : "") +
        '<button class="btn btn-ghost btn-sm" id="q-filter" style="margin-left:auto">' +
          (filter === "open" ? "진행 중만 보는 중" : "전체 보는 중") + '</button>' +
      '</div>' +

      (list.length
        ? list.map(cardOf).join("")
        : '<div class="empty"><div class="empty-title">' + esc(L.noResult) + '</div>' +
          '<div class="empty-body">진행 중인 의뢰가 없습니다. [의뢰하기] 에서 새로 만들 수 있습니다.</div></div>');
  }

  function cardOf(r) {
    const st = Q.STATUS[r.status];
    const open = openId === r.id;
    const names = sampleNames(r);

    return '<section class="card" style="margin-bottom:var(--s-3);border-left:3px solid var(--c-' +
        (st.tone === "accent" ? "accent" : st.tone === "risk" ? "risk" : st.tone === "ok" ? "ok" : "warn") + ')">' +
      '<div class="card-head" style="flex-wrap:wrap;gap:var(--s-3);cursor:pointer" data-open="' + esc(r.id) + '">' +
        '<div style="min-width:0">' +
          '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px">' +
            '<span class="mono" style="font-weight:700;font-size:13px">' + esc(r.id) + '</span>' +
            '<span class="badge badge-' + st.tone + '">' + esc(st.ko) + '</span>' +
            (r.priority === "urgent" ? '<span class="badge badge-risk">긴급</span>' : "") +
            dueBadge(r) +
          '</div>' +
          '<h2 class="card-title" style="font-size:14px">' + esc(r.purpose) + '</h2>' +
          '<p class="card-sub">' +
            '시료 ' + names.map(esc).join(", ") + ' · ' +
            '시험 ' + (r.tests || []).map(t => esc(TEST_LABEL[t] || t)).join(", ") + ' · ' +
            '의뢰 ' + esc(r.requestedBy) +
          '</p>' +
        '</div>' +
        actionsOf(r) +
      '</div>' +
      (open ? detailOf(r) : "") +
    '</section>';
  }

  function actionsOf(r) {
    const st = Q.STATUS[r.status];
    const btns = [];
    if (st.next) {
      btns.push('<button class="btn btn-accent btn-sm" data-adv="' + esc(r.id) + '" ' +
        'data-to="' + st.next + '">' + esc(Q.STATUS[st.next].ko) + ' 처리</button>');
    }
    if (Q.isOpen(r) && r.status !== "requested") {
      btns.push('<button class="btn btn-ghost btn-sm" data-rej="' + esc(r.id) + '">반려</button>');
    }
    if (!btns.length) return "";
    return '<div style="display:flex;gap:var(--s-2);flex-wrap:wrap" ' +
      'onclick="event.stopPropagation()">' + btns.join("") + '</div>';
  }

  function detailOf(r) {
    const names = sampleNames(r);
    return '<div class="card-body" style="border-top:1px solid var(--c-border)">' +
      '<div class="ebr-grid" style="margin-bottom:var(--s-4)">' +
        kv("의뢰자", r.requestedBy + (r.requestedTeam ? " · " + teamKo(r.requestedTeam) : "")) +
        kv("의뢰일", (r.requestedAt || "").replace("T", " ")) +
        kv("희망 기한", r.dueAt || "—") +
        kv("담당", r.assignedTo || "미배정") +
      '</div>' +
      (r.note ? '<p style="font-size:13px;line-height:1.75;margin:0 0 var(--s-4)">' +
        esc(r.note) + '</p>' : "") +

      '<div class="eyebrow" style="margin-bottom:var(--s-2)">시료</div>' +
      '<div style="display:grid;gap:var(--s-2);margin-bottom:var(--s-4)">' +
        (r.sampleIds || []).map(function (id) {
          const s = (window.DATA_SAMPLES || []).find(x => x.id === id);
          if (!s) return '<div class="drop-file"><span class="mono">' + esc(id) + '</span></div>';
          const loc = s.storage;
          return '<div class="drop-file" style="justify-content:flex-start">' +
            '<span class="mono" style="font-weight:600">' + esc(s.name) + '</span>' +
            '<span style="color:var(--c-text-mute)">' + esc(s.stage || "") + '</span>' +
            (loc ? '<span class="mono" style="margin-left:auto;color:var(--c-text-mute)">' +
              esc(loc.freezer + " " + loc.rack + " " + loc.box + " " + loc.pos) + '</span>' : "") +
          '</div>';
        }).join("") +
      '</div>' +

      '<div class="eyebrow" style="margin-bottom:var(--s-2)">처리 이력</div>' +
      (r.history || []).slice().reverse().map(function (h) {
        const st = Q.STATUS[h.status] || { ko: h.status, tone: "" };
        return '<div class="rail-event">' +
          '<span class="rail-event-bar" style="background:var(--c-accent)"></span>' +
          '<span style="min-width:0;flex:1">' +
            '<span style="display:block;font-size:12.5px;font-weight:500">' + esc(st.ko) + '</span>' +
            '<span class="mono" style="display:block;font-size:10.5px;color:var(--c-text-mute)">' +
              esc(h.by) + ' · ' + esc(String(h.at).replace("T", " ")) + '</span>' +
            (h.note ? '<span style="display:block;font-size:11.5px;color:var(--c-text-mute);margin-top:2px">' +
              esc(h.note) + '</span>' : "") +
          '</span></div>';
      }).join("") +

      '<div style="display:flex;gap:var(--s-2);margin-top:var(--s-4);flex-wrap:wrap">' +
        '<a class="btn btn-ghost btn-sm" href="ebr.html">EBR 에서 결과 입력</a>' +
        '<a class="btn btn-ghost btn-sm" href="data.html">데이터 조회</a>' +
      '</div>' +
    '</div>';
  }

  function kv(k, v) {
    return '<div class="ebr-cell"><span>' + esc(k) + '</span>' +
      '<div class="mono" style="font-size:13px;padding-top:4px">' + esc(v) + '</div></div>';
  }
  function teamKo(id) {
    const t = window.DATA_TEAMS.find(x => x.id === id);
    return t ? t.ko : id;
  }

  /* ══════════════════════════════════════════════════════════════════════
     2. 의뢰하기
     ══════════════════════════════════════════════════════════════════════ */
  function newView() {
    const sel = window.Scope.get();
    if (!sel.scopeId) {
      return '<div class="empty"><div class="empty-title">과제를 먼저 선택하세요</div>' +
        '<div class="empty-body">상단 우측 셀렉터에서 과제를 고르면 그 범위의 시료를 의뢰할 수 있습니다.</div></div>';
    }

    const ids = R.studiesInScope(sel).map(x => x.id);
    const batches = window.DATA_BATCHES.filter(b => ids.indexOf(b.studyId) > -1);
    const samples = [];
    batches.forEach(b => R.samplesOfBatch(b.id).forEach(s => samples.push(s)));

    const today = window.HubCalendar ? window.HubCalendar.today() : "";
    const due = window.HubCalendar ? window.HubCalendar.addDays(today, 5) : "";

    return '<section class="card"><div class="card-head"><div>' +
        '<h2 class="card-title">분석 의뢰 작성</h2>' +
        '<p class="card-sub">시료와 시험 항목을 고르고 목적을 적으면 분석팀 큐에 올라갑니다</p></div></div>' +
      '<form class="card-body" id="req-form">' +

        '<div class="eyebrow" style="margin-bottom:var(--s-2)">시료 선택 (' + samples.length + '건)</div>' +
        (samples.length
          ? '<div class="req-samples">' + samples.map(function (s) {
              const openReq = Q.forSample(s.id).filter(Q.isOpen).length;
              return '<label class="req-sample">' +
                '<input type="checkbox" data-smp="' + esc(s.id) + '">' +
                '<span style="min-width:0;flex:1">' +
                  '<span class="mono" style="font-weight:600;font-size:12.5px">' + esc(s.name) + '</span>' +
                  '<span style="display:block;font-size:11px;color:var(--c-text-mute)">' +
                    esc(s.stage || "채취 시점 미입력") +
                    (s.storage ? " · " + esc(s.storage.freezer + " " + s.storage.rack + " " +
                      s.storage.box + " " + s.storage.pos) : "") + '</span>' +
                '</span>' +
                (openReq ? '<span class="badge badge-warn" style="font-size:10px">의뢰 중</span>' : "") +
              '</label>';
            }).join("") + '</div>'
          : '<p style="font-size:12.5px;color:var(--c-text-mute)">이 범위에 시료가 없습니다.</p>') +

        '<div class="rule-hair" style="margin:var(--s-5) 0"></div>' +

        '<div class="eyebrow" style="margin-bottom:var(--s-2)">시험 항목</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:var(--s-5)">' +
          Object.keys(TEST_LABEL).map(k =>
            '<label class="mm-chip" style="cursor:pointer">' +
              '<input type="checkbox" data-test="' + esc(k) + '" style="margin-right:6px">' +
              esc(TEST_LABEL[k]) + '</label>').join("") +
        '</div>' +

        '<div class="ebr-grid" style="margin-bottom:var(--s-4)">' +
          '<label class="ebr-cell" style="grid-column:1/-1"><span>의뢰 목적 (필수)</span>' +
            '<input class="ebr-input" id="req-purpose" ' +
              'placeholder="예: CEX 용출 조건 비교 — 중간 단계 순도 확인"></label>' +
          '<label class="ebr-cell"><span>희망 기한</span>' +
            '<input class="ebr-input mono" id="req-due" type="date" value="' + esc(due) + '"></label>' +
          '<label class="ebr-cell"><span>우선순위</span>' +
            '<select class="ebr-input" id="req-priority">' +
              '<option value="normal">일반</option><option value="urgent">긴급</option>' +
            '</select></label>' +
          '<label class="ebr-cell"><span>의뢰 팀</span>' +
            '<select class="ebr-input" id="req-team">' +
              window.DATA_TEAMS.filter(t => t.id !== "analytics")
                .map(t => '<option value="' + t.id + '">' + esc(t.ko) + '</option>').join("") +
            '</select></label>' +
          '<label class="ebr-cell" style="grid-column:1/-1"><span>전달 사항</span>' +
            '<input class="ebr-input" id="req-note" ' +
              'placeholder="예: 해당 배치는 Harvest 생존율이 낮았습니다 — 불순물 확인 필요"></label>' +
        '</div>' +

        '<div style="display:flex;gap:var(--s-3);align-items:center;flex-wrap:wrap">' +
          '<button class="btn btn-accent" type="submit">의뢰 등록</button>' +
          '<p class="field-error" id="req-err" role="alert" style="margin:0"></p>' +
        '</div>' +
      '</form></section>';
  }

  /* ══════════════════════════════════════════════════════════════════════
     3. 시료 보관
     ══════════════════════════════════════════════════════════════════════ */
  function storageView() {
    const sel = window.Scope.get();
    const ids = sel.scopeId ? R.studiesInScope(sel).map(x => x.id) : null;
    const batches = window.DATA_BATCHES.filter(b => !ids || ids.indexOf(b.studyId) > -1);

    const rows = [];
    batches.forEach(b => R.samplesOfBatch(b.id).forEach(s => rows.push({ s: s, b: b })));

    /* 냉동고별로 묶어 보여줍니다 — 실제로 찾아갈 때 그 순서로 움직입니다 */
    const byFreezer = {};
    rows.forEach(function (x) {
      const f = x.s.storage ? x.s.storage.freezer : "미지정";
      (byFreezer[f] = byFreezer[f] || []).push(x);
    });

    if (!rows.length) {
      return '<div class="empty"><div class="empty-title">' + esc(L.noResult) + '</div></div>';
    }

    return '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:var(--s-4)">' +
        '<label class="ebr-cell" style="min-width:260px;flex:1"><span>시료 · 위치 검색</span>' +
          '<input class="ebr-input" id="st-q" type="search" ' +
            'placeholder="예: B123-3, FR-01, R3, B07"></label></div>' +

      Object.keys(byFreezer).sort().map(function (f) {
        const list = byFreezer[f];
        return '<section class="card" style="margin-bottom:var(--s-4)">' +
          '<div class="card-head"><div><h2 class="card-title">' + esc(f) + '</h2>' +
          '<p class="card-sub">' + list.length + '개 시료 · -80 °C</p></div></div>' +
          '<div class="tbl-scroll"><table class="tbl"><thead><tr>' +
            '<th scope="col">시료</th><th scope="col">채취 시점</th>' +
            '<th scope="col">위치</th><th scope="col">분취</th>' +
            '<th scope="col">잔량</th><th scope="col">동결-해동</th>' +
            '<th scope="col">의뢰</th>' +
          '</tr></thead><tbody>' +
          list.map(function (x) {
            const s = x.s, st = s.storage || {};
            const openReq = Q.forSample(s.id).filter(Q.isOpen);
            const ft = st.freezeThaw || 0;
            return '<tr data-strow="' + esc((s.name + " " + s.batchId + " " + st.freezer + " " +
                st.rack + " " + st.box + " " + st.pos).toLowerCase()) + '">' +
              '<td class="mono" style="font-weight:600">' + esc(s.name) + '</td>' +
              '<td>' + esc(s.stage || L.empty) + '</td>' +
              '<td class="mono">' + esc([st.rack, st.box, st.pos].filter(Boolean).join(" · ") || L.empty) + '</td>' +
              '<td class="mono">' + (st.aliquots != null ? st.aliquots + " 개" : L.empty) + '</td>' +
              '<td class="mono">' + (st.volumeMl != null ? st.volumeMl + " mL" : L.empty) + '</td>' +
              '<td class="mono"' + (ft >= 2 ? ' style="color:var(--c-risk);font-weight:600"' : "") + '>' +
                ft + ' 회</td>' +
              '<td>' + (openReq.length
                ? '<span class="badge badge-warn" style="font-size:10px">' +
                  esc(openReq[0].id) + '</span>' : "—") + '</td>' +
            '</tr>';
          }).join("") +
          '</tbody></table></div></section>';
      }).join("") +

      '<p style="font-size:11.5px;color:var(--c-text-mute);line-height:1.7">' +
        '동결-해동 2회 이상은 붉게 표시합니다 — 반복 해동은 응집체와 분해산물을 늘립니다.<br>' +
        '보관 위치·잔량은 원본 Excel 에 없어 시료 ID 에서 생성한 값입니다. ' +
        '실제 냉동고 배치도가 들어오면 이 값을 대체합니다.</p>';
  }

  /* ══════════════════════════════════════════════════════════════════════
     렌더 · 배선
     ══════════════════════════════════════════════════════════════════════ */
  function render() {
    paintSubnav();
    const desc = window.Scope.describe();
    const titles = { queue: "분석 의뢰 큐", new: "분석 의뢰 작성", storage: "시료 보관 현황" };
    $("#page-title").textContent = titles[tab];
    $("#crumb").innerHTML = desc.scope
      ? '<span>' + esc(desc.scope) + '</span>'
      : '<span style="color:var(--c-text-mute)">전 과제</span>';

    $("#body").innerHTML = tab === "queue" ? queueView()
                         : tab === "new" ? newView()
                         : storageView();
    wire();
  }

  function wire() {
    const f = $("#q-filter");
    if (f) f.addEventListener("click", function () {
      filter = filter === "open" ? "all" : "open"; render();
    });

    $$("[data-open]").forEach(b => b.addEventListener("click", function () {
      openId = openId === b.dataset.open ? null : b.dataset.open;
      render();
    }));

    $$("[data-adv]").forEach(b => b.addEventListener("click", function (e) {
      e.stopPropagation();
      const r = Q.advance(b.dataset.adv, b.dataset.to, "");
      if (!r.ok) window.alert(r.reason);
      render();
    }));

    $$("[data-rej]").forEach(b => b.addEventListener("click", function (e) {
      e.stopPropagation();
      const why = window.prompt("반려 사유를 입력하세요\n(사유 없이 돌려보내면 의뢰자가 손쓸 방법이 없습니다)");
      if (why === null) return;
      const r = Q.advance(b.dataset.rej, "rejected", why);
      if (!r.ok) { window.alert(r.reason); return; }
      render();
    }));

    const form = $("#req-form");
    if (form) form.addEventListener("submit", function (e) {
      e.preventDefault();
      const err = $("#req-err");
      const sampleIds = $$("[data-smp]").filter(c => c.checked).map(c => c.dataset.smp);
      const tests = $$("[data-test]").filter(c => c.checked).map(c => c.dataset.test);
      const res = Q.create({
        sampleIds: sampleIds, tests: tests,
        purpose: $("#req-purpose").value,
        note: $("#req-note").value,
        dueAt: $("#req-due").value,
        priority: $("#req-priority").value,
        requestedTeam: $("#req-team").value
      });
      if (!res.ok) { err.textContent = res.reason; err.classList.add("is-shown"); return; }
      err.classList.remove("is-shown");
      openId = res.request.id;
      tab = "queue";
      render();
    });

    const q = $("#st-q");
    if (q) q.addEventListener("input", function () {
      const term = this.value.trim().toLowerCase();
      $$("[data-strow]").forEach(function (tr) {
        tr.style.display = (!term || tr.dataset.strow.indexOf(term) > -1) ? "" : "none";
      });
    });
  }

  window.StudySelector.mount($("#selector"), { showResults: false });
  window.Scope.subscribe(render);
  window.Requests.subscribe(render);
  render();
})();
