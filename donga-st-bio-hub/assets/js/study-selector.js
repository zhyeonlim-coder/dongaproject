/* ==========================================================================
   StudySelector — 계층형 필터 컴포넌트  [P1-2]

   전 화면(대시보드 · EBR · 데이터 조회 · 회의 모드 · 일정)이 이 하나를
   mount 합니다. 상태는 window.Scope 에만 있으므로 복붙 사본이 없습니다.

   최상위 범위(과제) 선택은 상단 내비게이션이 담당하고,
   이 컴포넌트는 그 아래 단계 — Study → 팀 → 조건 — 를 다룹니다.

     StudySelector.mount(el, { onChange, showResults })
   ========================================================================== */

window.StudySelector = (function () {
  "use strict";

  const esc = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function mount(host, opts) {
    const o = opts || {};
    if (!host) return null;
    let unsub = null;

    function render() {
      const sel = window.Scope.get();
      const skips = window.Scope.skipsStudyStep();

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

        host.innerHTML =
          '<div class="selector">' +

            '<div class="selector-top">' +
              '<div class="selector-search">' +
                '<span class="selector-search-icon" aria-hidden="true">' +
                  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                  'stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></span>' +
                '<label class="sr-only" for="sel-q">Study명 및 Data 분류 검색</label>' +
                '<input class="input" id="sel-q" type="search" value="' + esc(sel.q || "") + '" ' +
                  'placeholder="Study명 · Data 분류 검색 (예: Titer, Viability, Step Yield)">' +
              '</div>' +
            '</div>' +

            '<div class="selector-filters">' +
              (skips ? "" : field("studyId", "Study",
                studies.map(s => ({ v: s.id, t: s.name })), sel.studyId,
                studies.length ? null : "하위 Study 없음")) +
              field("team", "팀",
                (opt.team || []).map(t => ({ v: t.id, t: t.ko })), sel.team,
                (opt.team || []).length ? null : "데이터 있는 팀 없음") +
              /* Study 유형(DOE · Feasibility …) 대신 측정 항목 축을 둡니다.
                 연구자가 실제로 찾는 건 Study 의 성격이 아니라 데이터 항목입니다. */
              field("dataClass", "Data 분류",
                (opt.dataClass || []).map(c => ({ v: c.id, t: c.label })), sel.dataClass,
                (opt.dataClass || []).length ? null : "해당 항목 없음") +
              field("status", "진행 상태",
                (opt.status || []).map(v => ({ v: v, t: v })), sel.status) +
            '</div>' +

            '<div class="selector-applied">' +
              '<span class="selector-count" data-n="' + n + '">적용된 검색조건 <b>' + n + '</b></span>' +
              chips(sel, desc) +
              '<button class="selector-reset" id="sel-reset" aria-label="전체 초기화"' +
                (n === 0 ? " disabled" : "") + ' title="전체 초기화">' +
                '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                'stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/>' +
                '<path d="M3 3v5h5"/></svg></button>' +
            '</div>' +

            (o.showResults === false || skips ? "" :
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
                  : '<div class="selector-empty">조건에 맞는 Study가 없습니다.</div>') +
              '</div>') +

            teamStrip(teamSets, sel) +
          '</div>';

        wire();
      });
    }

    function field(key, label, list, val, emptyMsg) {
      return '<label class="selector-field"><span>' + esc(label) + '</span>' +
        '<select class="input" data-f="' + key + '"' + (emptyMsg ? " disabled" : "") + '>' +
          '<option value="">' + (emptyMsg ? esc(emptyMsg) : "전체") + '</option>' +
          list.map(x => '<option value="' + esc(x.v) + '"' +
            (val === x.v ? " selected" : "") + '>' + esc(x.t) + '</option>').join("") +
        '</select></label>';
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

    function wire() {
      const q = host.querySelector("#sel-q");
      if (q) {
        let t = null;
        q.addEventListener("input", function () {
          clearTimeout(t);
          const pos = this.selectionStart, val = this.value;
          t = setTimeout(function () {
            window.Scope.setFilter({ q: val });
            const nq = host.querySelector("#sel-q");
            if (nq) { nq.focus(); try { nq.setSelectionRange(pos, pos); } catch (e) {} }
          }, 220);
        });
      }

      Array.prototype.forEach.call(host.querySelectorAll("[data-f]"), function (s) {
        s.addEventListener("change", function () {
          const k = s.dataset.f, v = s.value || null;
          if (k === "studyId") window.Scope.setStudy(v);
          else if (k === "team") window.Scope.setTeam(v);
          else { const p = {}; p[k] = v; window.Scope.setFilter(p); }
        });
      });

      Array.prototype.forEach.call(host.querySelectorAll("[data-clear]"), function (b) {
        b.addEventListener("click", function () { window.Scope.clearOne(b.dataset.clear); });
      });

      const r = host.querySelector("#sel-reset");
      if (r) r.addEventListener("click", function () { window.Scope.reset(); });

      Array.prototype.forEach.call(host.querySelectorAll("[data-pick]"), function (b) {
        b.addEventListener("click", function () {
          const cur = window.Scope.get().studyId;
          window.Scope.setStudy(cur === b.dataset.pick ? null : b.dataset.pick);
        });
      });

      Array.prototype.forEach.call(host.querySelectorAll("[data-team]"), function (b) {
        b.addEventListener("click", function () {
          const cur = window.Scope.get().team;
          window.Scope.setTeam(cur === b.dataset.team ? null : b.dataset.team);
        });
      });
    }

    unsub = window.Scope.subscribe(function (sel, reason) {
      render();
      if (o.onChange) o.onChange(sel, reason);
    });
    render();

    return { destroy: function () { if (unsub) unsub(); host.innerHTML = ""; } };
  }

  return { mount };
})();
