/* ==========================================================================
   StudySelector — 조회 조건 패널

   전 화면(대시보드 · EBR · 데이터 조회 · 회의 모드 · 일정)이 이 하나를
   mount 합니다. 적용된 상태는 window.Scope 에만 있으므로 복붙 사본이 없습니다.

   최상위 범위(과제) 선택은 상단 내비게이션이 담당하고,
   이 컴포넌트는 그 아래 단계 — Study → 팀 → 기간 → 조건 — 를 다룹니다.

   ── 고르는 즉시 적용하지 않습니다 ───────────────────────────────────────
   드롭다운을 바꿀 때마다 표가 다시 그려지면, 조건 세 개를 고르는 동안
   화면이 세 번 요동칩니다. 기간처럼 시작일을 고른 뒤 종료일을 고르는
   조건은 중간 상태가 아예 틀린 결과를 보여주기까지 합니다.

   그래서 선택은 draft 에만 쌓고, [조회] 를 눌러야 Scope 에 한 번에
   적용합니다. 적용 전에는 "미적용 변경" 표시가 뜹니다.
   ========================================================================== */

window.StudySelector = (function () {
  "use strict";

  const esc = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const KEYS = ["studyId", "team", "q", "dataClass", "status", "from", "to", "sort"];

  function pick(state) {
    const o = {};
    KEYS.forEach(k => { o[k] = state[k] === null || state[k] === undefined ? "" : state[k]; });
    return o;
  }
  function differs(a, b) {
    return KEYS.some(k => String(a[k] || "") !== String(b[k] || ""));
  }

  /* ── 역할 두 가지 ────────────────────────────────────────────────────
     같은 컴포넌트가 화면에 따라 다른 일을 합니다. 두 벌로 나누지 않는
     이유는 둘 다 같은 Scope 를 읽고 쓰기 때문입니다 — 나누면 두 화면이
     같은 조건에 다르게 반응하기 시작합니다.

       mode: "search"  조회용 전체 바. 검색어 · 6개 조건 · 조회/초기화 ·
                       적용된 조건 태그 · Study 목록. 데이터 조회와
                       대시보드처럼 "무엇을 볼지 좁히는" 화면에 둡니다.

       mode: "pick"    기록 대상 선택만. Study · 팀 두 개와 팀별 제출
                       현황뿐입니다. 검색어 · 기간 · 정렬 · 진행 상태 ·
                       조회/초기화 · 조건 태그 · 목록은 그리지 않습니다.
                       EBR 입력처럼 "지금 무엇에 기록하는가" 만 정해야
                       하는 화면에 둡니다. 조회 버튼이 없으므로 고르는
                       즉시 적용합니다.

     일정 관리처럼 Scope 를 읽기만 하는 화면에는 아예 mount 하지 않습니다.
     상단 바의 과제 선택으로 충분합니다. */
  function mount(host, opts) {
    const o = opts || {};
    if (!host) return null;
    const pickOnly = o.mode === "pick";
    let unsub = null;
    let draft = pick(window.Scope.get());

    function render() {
      const sel = window.Scope.get();
      if (!sel.scopeId) {
        host.innerHTML =
          '<div class="selector"><div class="selector-empty" style="padding:var(--s-6)">' +
            '상단에서 <b>과제</b>를 먼저 선택하세요.' +
          '</div></div>';
        return;
      }

      Promise.all([
        window.Repo.getFilterOptions(sel),
        window.Repo.searchStudies(sel.q, sel),
        window.Repo.getTeamDataSetsForSelection(sel)
      ]).then(function (r) {
        const opt = r[0], studies = r[1], teamSets = r[2];
        const n = window.Scope.activeCount();
        const desc = window.Scope.describe();
        const dirty = differs(draft, pick(sel));

        host.innerHTML = pickOnly
          ? pickMarkup(studies, opt, teamSets, sel)
          : '<div class="selector' + (dirty ? " is-dirty" : "") + '">' +

            '<div class="selector-top">' +
              '<div class="selector-search">' +
                '<span class="selector-search-icon" aria-hidden="true">' +
                  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                  'stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></span>' +
                '<label class="sr-only" for="sel-q">Study명 및 Data 분류 검색</label>' +
                '<input class="input" id="sel-q" type="search" value="' + esc(draft.q || "") + '" ' +
                  'placeholder="Study명 · Data 분류 검색 (예: Titer, Viability, Step Yield)">' +
              '</div>' +
            '</div>' +

            '<div class="selector-filters">' +
              field("studyId", "Study",
                studies.map(s => ({ v: s.id, t: s.name })), draft.studyId,
                studies.length ? null : "하위 Study 없음") +
              field("team", "팀",
                (opt.team || []).map(t => ({ v: t.id, t: t.ko })), draft.team,
                (opt.team || []).length ? null : "데이터 있는 팀 없음") +
              /* Study 유형(DOE · Feasibility …) 대신 측정 항목 축을 둡니다.
                 연구자가 실제로 찾는 건 Study 의 성격이 아니라 데이터 항목입니다. */
              field("dataClass", "Data 분류",
                (opt.dataClass || []).map(c => ({ v: c.id, t: c.label })), draft.dataClass,
                (opt.dataClass || []).length ? null : "해당 항목 없음") +
              field("status", "진행 상태",
                (opt.status || []).map(v => ({ v: v, t: v })), draft.status) +
              dateField("from", "기간 시작", draft.from) +
              dateField("to", "기간 종료", draft.to) +
              field("sort", "정렬",
                Object.keys(window.Repo.SORTS).map(k => ({ v: k, t: window.Repo.SORTS[k] })),
                draft.sort || window.Repo.DEFAULT_SORT) +
            '</div>' +

            '<div class="selector-actions">' +
              '<button class="btn btn-accent" id="sel-apply">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                'stroke-width="2.2" aria-hidden="true"><circle cx="11" cy="11" r="7"/>' +
                '<path d="m20 20-3.5-3.5"/></svg>조회</button>' +
              '<button class="btn btn-ghost" id="sel-clear">초기화</button>' +
              (dirty
                ? '<span class="selector-dirty" role="status">변경한 조건이 아직 적용되지 않았습니다 — ' +
                  '<b>조회</b>를 누르세요</span>'
                : '') +
            '</div>' +

            '<div class="selector-applied">' +
              '<span class="selector-count" data-n="' + n + '">적용된 검색조건 <b>' + n + '</b></span>' +
              chips(sel, desc) +
            '</div>' +

            (o.showResults === false ? "" :
              '<div class="selector-results" role="listbox" aria-label="Study 목록">' +
                (studies.length
                  ? studies.map(s =>
                      '<button class="selector-result" role="option" data-pick="' + esc(s.id) + '" ' +
                        'aria-selected="' + (sel.studyId === s.id) + '">' +
                        '<span style="flex:1;min-width:0">' +
                          '<span class="selector-result-name">' + esc(s.name) + '</span>' +
                          '<span class="selector-result-meta">' +
                            (s.type ? esc(s.type) + " · " : "") + s.batchCount + "개 배치 · " +
                            (s.startDate || window.LABELS.empty) + '</span></span>' +
                        '<span class="badge badge-' +
                          (s.status === "완료" ? "ok" : s.status === "진행중" ? "info" : "warn") +
                          '" style="font-size:10px">' + esc(s.status) + '</span>' +
                      '</button>').join("")
                  : '<div class="selector-empty">' + esc(window.LABELS.noResult) + '</div>') +
              '</div>') +

            teamStrip(teamSets, sel) +
          '</div>';

        wire();
      });
    }

    /* ── 기록 대상 선택 (mode: "pick") ────────────────────────────────
       조회 버튼이 없으므로 고르는 즉시 Scope 에 적용합니다. 여기서
       "미적용 변경" 을 만들면, 사용자는 골랐는데 폼은 안 열리는 상태가
       되고 그 이유를 화면에서 알 수 없습니다. */
    function pickMarkup(studies, opt, teamSets, sel) {
      const teams = (opt.team || []).map(t => ({ v: t.id, t: t.ko }));
      return '<div class="selector is-pick">' +
        '<div class="selector-filters" style="margin-top:0">' +
          field("studyId", "Study", studies.map(s => ({ v: s.id, t: s.name })),
                sel.studyId, studies.length ? null : "하위 Study 없음") +
          field("team", "팀", teams, sel.team,
                teams.length ? null : "데이터 있는 팀 없음") +
        '</div>' +
        '<div class="selector-pick-note">' +
          (sel.studyId && sel.team
            ? "이 Study · 팀에 기록합니다. 바꾸면 아래 입력 폼이 다시 그려집니다."
            : "기록할 <b>Study</b> 와 <b>팀</b> 을 고르면 입력 폼이 열립니다.") +
        '</div>' +
        teamStrip(teamSets, sel) +
      '</div>';
    }

    function field(key, label, list, val, emptyMsg) {
      return '<label class="selector-field"><span>' + esc(label) + '</span>' +
        '<select class="input" data-d="' + key + '"' + (emptyMsg ? " disabled" : "") + '>' +
          '<option value="">' + (emptyMsg ? esc(emptyMsg) : "전체") + '</option>' +
          list.map(x => '<option value="' + esc(x.v) + '"' +
            (String(val) === String(x.v) ? " selected" : "") + '>' + esc(x.t) + '</option>').join("") +
        '</select></label>';
    }

    function dateField(key, label, val) {
      return '<label class="selector-field"><span>' + esc(label) + '</span>' +
        '<input class="input mono" type="date" data-d="' + key + '" value="' + esc(val || "") + '"></label>';
    }

    /* 팀별 데이터 제출 현황 — 빈 열이 "해당 없음"인지 "미입력"인지 구분 */
    function teamStrip(sets, sel) {
      if (!sets || !sets.length) return "";
      return '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:var(--s-4);' +
        'padding-top:var(--s-4);border-top:1px solid var(--c-paper-2)">' +
        sets.map(t => {
          const state = !t.defined ? "none" : t.hasData ? (t.filled >= t.total ? "full" : "part") : "none";
          const txt = !t.defined ? "데이터 없음"
                    : t.hasData ? (t.filled + "/" + t.total)
                    : "미입력";
          return '<button class="team-chip" data-team="' + t.team + '" data-state="' + state + '" ' +
            'style="cursor:pointer;border:1px solid ' +
            (sel.team === t.team ? "var(--c-accent)" : "transparent") + '">' +
            '<span class="team-chip-dot"></span>' + esc(t.short) + ' ' + esc(txt) + '</button>';
        }).join("") + '</div>';
    }

    function chips(sel, desc) {
      const out = [];
      if (sel.q && sel.q.trim()) out.push(chip("검색", sel.q.trim(), "q"));
      if (desc.study) out.push(chip("Study", desc.study, "studyId"));
      if (desc.team)  out.push(chip("팀", desc.team, "team"));
      const period = window.Scope.periodLabel();
      if (period) out.push(chip("기간", period, "period"));
      if (sel.dataClass) {
        const c = window.Repo.dataClass(sel.dataClass);
        out.push(chip("Data 분류", c ? c.label : sel.dataClass, "dataClass"));
      }
      if (sel.status) out.push(chip("상태", sel.status, "status"));
      return out.join("");
    }

    function chip(k, v, key) {
      return '<span class="chip"><span class="chip-k">' + esc(k) + '</span>' + esc(v) +
        '<button class="chip-x" data-clear="' + esc(key) + '" aria-label="' + esc(k) + ' 조건 해제">' +
        '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></span>';
    }

    /* draft 만 바꾸고 화면의 "미적용" 표시를 갱신합니다 — 표는 건드리지 않습니다 */
    function markDirty() {
      const dirty = differs(draft, pick(window.Scope.get()));
      const root = host.querySelector(".selector");
      if (root) root.classList.toggle("is-dirty", dirty);
      let note = host.querySelector(".selector-dirty");
      if (dirty && !note) {
        note = document.createElement("span");
        note.className = "selector-dirty";
        note.setAttribute("role", "status");
        note.innerHTML = "변경한 조건이 아직 적용되지 않았습니다 — <b>조회</b>를 누르세요";
        const bar = host.querySelector(".selector-actions");
        if (bar) bar.appendChild(note);
      } else if (!dirty && note) {
        note.remove();
      }
    }

    function apply() {
      const q = host.querySelector("#sel-q");
      if (q) draft.q = q.value;
      window.Scope.apply(draft);
    }

    function wire() {
      const q = host.querySelector("#sel-q");
      if (q) {
        q.addEventListener("input", function () { draft.q = this.value; markDirty(); });
        q.addEventListener("keydown", function (e) {
          if (e.key === "Enter") { e.preventDefault(); apply(); }
        });
      }

      Array.prototype.forEach.call(host.querySelectorAll("[data-d]"), function (el) {
        el.addEventListener("change", function () {
          draft[el.dataset.d] = el.value;
          /* 대상 선택 모드에는 조회 버튼이 없습니다 — 고르는 즉시 적용해야
             합니다. Study 는 setStudy, 팀은 setTeam 을 씁니다. 조회 화면이
             쓰는 경로를 그대로 타서, 두 화면이 같은 선택에 같이 반응합니다. */
          if (pickOnly) {
            if (el.dataset.d === "studyId") window.Scope.setStudy(el.value || null);
            else if (el.dataset.d === "team") window.Scope.setTeam(el.value || null);
            else window.Scope.apply(draft);
            draft = pick(window.Scope.get());
            return;
          }
          markDirty();
        });
      });

      const ap = host.querySelector("#sel-apply");
      if (ap) ap.addEventListener("click", apply);

      const cl = host.querySelector("#sel-clear");
      if (cl) cl.addEventListener("click", function () {
        window.Scope.clearFilters();
        draft = pick(window.Scope.get());
      });

      Array.prototype.forEach.call(host.querySelectorAll("[data-clear]"), function (b) {
        b.addEventListener("click", function () {
          window.Scope.clearOne(b.dataset.clear);
          draft = pick(window.Scope.get());
        });
      });

      /* Study 목록과 팀 칩은 즉시 적용합니다 — 목록에서 하나를 고르는 건
         "조건을 짜는 중"이 아니라 "이걸 보겠다"는 확정 동작이라서입니다. */
      Array.prototype.forEach.call(host.querySelectorAll("[data-pick]"), function (b) {
        b.addEventListener("click", function () {
          const cur = window.Scope.get().studyId;
          window.Scope.setStudy(cur === b.dataset.pick ? null : b.dataset.pick);
          draft = pick(window.Scope.get());
        });
      });

      Array.prototype.forEach.call(host.querySelectorAll("[data-team]"), function (b) {
        b.addEventListener("click", function () {
          const cur = window.Scope.get().team;
          window.Scope.setTeam(cur === b.dataset.team ? null : b.dataset.team);
          draft = pick(window.Scope.get());
        });
      });
    }

    unsub = window.Scope.subscribe(function (sel, reason) {
      /* 적용·초기화·상위 선택 변경이면 draft 를 적용된 값으로 되돌립니다.
         그러지 않으면 초기화 후에도 "미적용 변경" 표시가 남습니다. */
      if (reason !== "filter") draft = pick(sel);
      render();
      if (o.onChange) o.onChange(sel, reason);
    });
    render();

    return { destroy: function () { if (unsub) unsub(); host.innerHTML = ""; } };
  }

  return { mount };
})();
