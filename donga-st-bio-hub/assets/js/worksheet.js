/* ==========================================================================
   worksheet.js — 엑셀 워크시트 모양 입력판  ·  window.Worksheet

   왜 이 모양인가
     연구원이 옮겨 적는 원본이 엑셀 시트입니다. 항목이 왼쪽 열에 세로로
     서고, 오른쪽으로 시점(또는 시료)이 하나씩 늘어납니다. 화면이 다른
     배열이면 눈이 원본의 칸과 화면의 칸을 계속 짝지어야 하고, 그 과정에서
     한 칸씩 밀려 적는 실수가 납니다.

         ┌───────────┬──────┬──────┬──────┐
         │ 행추가 ↓  │  D10 │  D11 │  D12 │ ← 열추가 →
         ├───────────┼──────┼──────┼──────┤
         │ Date      │      │      │      │
         │ VCD       │      │      │      │
         │ Titer     │      │      │      │
         └───────────┴──────┴──────┴──────┘

   열이 무엇인가는 팀마다 다릅니다
     배양   배양 경과 일자 (D10 · D11 …)  — 하루에 한 번 재는 값
     분석   시료 (SMP-…)                  — 시료마다 한 번 재는 값
     정제   단일 열                        — 배치당 한 번 재는 값
     사용자가 화면에서 축을 바꿀 수 있습니다. 실제 실험이 늘 이 셋 중
     하나로 떨어지지는 않기 때문입니다.

   ★ 이 파일은 값을 저장하지 않습니다.
     저장·검증·감사 이력은 부르는 쪽(ebr-page)이 합니다. 저장까지 여기서
     하면 서식마다 다른 규칙(사유 필수 · 범위 검사 · 단위 해석)이 이 안으로
     새어 들어오고, 그러면 공통 컴포넌트가 아니게 됩니다.

   쓰는 법
     Worksheet.mount(host, {
       rows:    [{ k, label, unit, type, group, scalar }],
       cols:    [{ id, label, sub, scope }],
       cell:    (row, col) => ({ display, origin, missing, edited, editCount, readonly }),
       onCommit:(row, col, raw) => "saved" | "none" | "error" | "needReason",
       onRevert:(row, col) => {},
       onHistory:(anchorEl, row, col, sticky) => {},
       onAddRow: label => {},        없으면 행추가 버튼을 그리지 않습니다
       onAddCol: () => {},           없으면 열추가 버튼을 그리지 않습니다
       onDropRow: rowKey => {}       사용자가 만든 행만 지울 수 있습니다
     })

   scalar: true 인 행은 배치 단위 값입니다 — 첫 열에만 칸을 두고 나머지는
   비웁니다. 열마다 칸을 두면 같은 값을 여러 번 적게 되고, 어느 칸이 진짜인지
   알 수 없게 됩니다.
   ========================================================================== */

window.Worksheet = (function () {
  "use strict";

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  function isMeasure(r) { return r.type !== "date" && r.type !== "text"; }

  /* 셀 하나 — data-r / data-c 로 찾습니다. 한 칸이 한 (행,열)입니다. */
  function cellHTML(row, col, c, first) {
    /* 배치 단위 값은 첫 열에만 둡니다 */
    if (row.scalar && !first) {
      return '<td class="ws-td is-void" aria-hidden="true"></td>';
    }
    const measure = isMeasure(row);
    const miss = c.missing || null;
    const edited = !!c.edited;
    const id = row.k + "::" + col.id;

    return '<td class="ws-td' + (edited ? " is-edited" : "") + '" ' +
        'data-cell="' + esc(id) + '">' +
      '<div class="ws-box">' +
        '<label class="sr-only" for="ws-' + esc(id) + '">' +
          esc(row.label) + " · " + esc(col.label) + '</label>' +
        '<input class="ws-in' + (miss ? " is-missing" : "") + '" ' +
          'id="ws-' + esc(id) + '" data-r="' + esc(row.k) + '" data-c="' + esc(col.id) + '" ' +
          (c.readonly ? "readonly " : "") +
          (measure
            ? 'type="text" inputmode="decimal" autocomplete="off" list="val-tokens"'
            : 'type="' + (row.type === "date" ? "date" : "text") + '"') +
          ' value="' + esc(c.display == null ? "" : c.display) + '">' +
        (edited
          ? '<button class="ws-mark" type="button" data-hist="' + esc(id) + '" ' +
            'aria-label="' + esc(row.label) + " " + esc(col.label) +
            ' 변경 이력 ' + esc(c.editCount) + '건 보기">' +
            '<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="3"><path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/></svg></button>'
          : "") +
      '</div>' +
      (c.origin ? '<span class="ws-origin" title="' + esc(c.origin) + '">' +
                  esc(c.origin) + '</span>' : "") +
      '<p class="ws-msg" data-msg="' + esc(id) + '" role="alert"></p>' +
    '</td>';
  }

  function markup(o) {
    const rows = o.rows || [];
    const cols = o.cols || [];
    let lastGroup = null;

    const body = rows.map(function (row) {
      let out = "";
      /* 그룹이 바뀌면 구분 행을 넣습니다 — 어디서 성격이 바뀌는지 보여야
         합니다. 그룹이 없는 스키마면 그냥 안 나옵니다. */
      if (row.group && row.group !== lastGroup) {
        lastGroup = row.group;
        out += '<tr class="ws-grp"><th colspan="' + (cols.length + 1) + '" scope="colgroup">' +
          esc(row.group) + '</th></tr>';
      }
      out += '<tr class="ws-row" data-row="' + esc(row.k) + '">' +
        '<th scope="row" class="ws-th">' +
          '<span class="ws-th-name">' + esc(row.label) + '</span>' +
          (row.unit ? '<span class="ws-th-unit">' + esc(row.unit) + '</span>' : "") +
          (row.custom && o.onDropRow
            ? '<button class="ws-drop" type="button" data-drop="' + esc(row.k) + '" ' +
              'aria-label="' + esc(row.label) + ' 행 지우기" title="이 행 지우기">×</button>'
            : "") +
        '</th>' +
        cols.map((col, i) => cellHTML(row, col, o.cell(row, col) || {}, i === 0)).join("") +
      '</tr>';
      return out;
    }).join("");

    return '<div class="ws-wrap">' +
      '<table class="ws-tbl">' +
        '<thead><tr>' +
          '<th scope="col" class="ws-corner">' +
            (o.onAddRow ? '<button class="ws-add" type="button" id="ws-addrow">행추가 ↓</button>' : "") +
            (o.onAddCol ? '<button class="ws-add" type="button" id="ws-addcol">열추가 →</button>' : "") +
            (!o.onAddRow && !o.onAddCol ? esc(o.cornerLabel || "항목") : "") +
          '</th>' +
          cols.map(c => '<th scope="col" class="ws-colh">' +
            '<span class="ws-colh-name">' + esc(c.label) + '</span>' +
            (c.sub ? '<span class="ws-colh-sub">' + esc(c.sub) + '</span>' : "") +
            '</th>').join("") +
        '</tr></thead>' +
        '<tbody>' + body + '</tbody>' +
      '</table></div>' +
      '<p class="ws-hint">' +
        '<b>← ↑ ↓ →</b> 칸 이동 · <b>Tab</b> 오른쪽 · <b>Enter</b> 확정하고 아래로 · ' +
        '<b>Shift+Enter</b> 위로 · <b>Esc</b> 되돌리기' +
      '</p>';
  }

  /* ── 키보드 ───────────────────────────────────────────────────────────
     엑셀에서 옮겨 적는 사람이 손을 마우스로 옮기지 않아야 합니다. 한 칸
     적고 마우스를 잡는 순간 리듬이 끊기고, 그때 줄이 밀립니다.

     좌우가 필요한 것이 한 줄짜리 표와 다른 점입니다 — 같은 항목의 다음
     시점으로 가는 이동이 가로이기 때문입니다.

     ★ Enter 로 확정했을 때 사유가 필요하면 옮기지 않습니다. 옮겨 버리면
       사유 창은 앞 칸에 떠 있고 커서는 다른 칸에 있어, 무엇에 대한
       사유인지 알 수 없게 됩니다. */
  function wire(host, o) {
    const rows = o.rows || [];
    const inputs = () => $$(".ws-in", host);

    /* (행,열) 격자에서의 이동 — 화면에 실제로 있는 칸만 셉니다.
       scalar 행은 첫 열에만 칸이 있어, 좌표로 계산하면 빈자리를 짚습니다. */
    function grid() {
      const map = [];
      $$(".ws-row", host).forEach(function (tr) {
        map.push($$(".ws-in", tr));
      });
      return map;
    }
    function locate(el) {
      const g = grid();
      for (let r = 0; r < g.length; r++) {
        const c = g[r].indexOf(el);
        if (c > -1) return { g: g, r: r, c: c };
      }
      return null;
    }
    function focusAt(g, r, c) {
      if (r < 0 || r >= g.length) return false;
      const line = g[r];
      if (!line.length) return false;
      const el = line[Math.min(c, line.length - 1)];
      if (!el) return false;
      el.focus();
      if (el.select) { try { el.select(); } catch (e) { /* date */ } }
      return true;
    }
    function move(el, dr, dc) {
      const p = locate(el);
      if (!p) return;
      if (dc) { focusAt(p.g, p.r, p.c + dc); return; }
      /* 세로 이동은 칸이 없는 행(scalar 의 2열 이후)을 건너뜁니다 */
      let r = p.r + dr;
      while (r >= 0 && r < p.g.length) {
        if (p.g[r].length > p.c || p.g[r].length) { focusAt(p.g, r, p.c); return; }
        r += dr;
      }
    }

    inputs().forEach(function (inp) {
      inp.addEventListener("keydown", function (e) {
        const row = rows.find(x => x.k === inp.dataset.r);
        const col = (o.cols || []).find(x => x.id === inp.dataset.c);
        if (!row || !col) return;

        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          /* 글자 안에서 커서를 옮기는 중이면 가로채지 않습니다 */
          const atEdge = e.key === "ArrowLeft"
            ? inp.selectionStart === 0
            : inp.selectionStart === String(inp.value).length;
          if (!atEdge || inp.type === "date") return;
          e.preventDefault();
          move(inp, 0, e.key === "ArrowRight" ? 1 : -1);
          return;
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          if (inp.type === "date") return;      /* 날짜는 위아래가 값 증감 */
          e.preventDefault();
          move(inp, e.key === "ArrowDown" ? 1 : -1, 0);
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          const r = o.onCommit(row, col, inp.value);
          if (r === "needReason" || r === "error") return;
          const dr = e.shiftKey ? -1 : 1;
          if (r === "saved") {
            /* 저장하면 부르는 쪽이 표를 다시 그립니다. 지금 노드를 붙잡고
               있으면 사라진 노드를 가리키므로 키로 다시 찾습니다. */
            const rk = inp.dataset.r, ck = inp.dataset.c;
            setTimeout(function () {
              const again = host.querySelector('[data-r="' + rk + '"][data-c="' + ck + '"]');
              if (again) move(again, dr, 0);
            }, 0);
            return;
          }
          move(inp, dr, 0);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          if (o.onRevert) o.onRevert(row, col);
        }
      });

      inp.addEventListener("change", function () {
        const row = rows.find(x => x.k === inp.dataset.r);
        const col = (o.cols || []).find(x => x.id === inp.dataset.c);
        if (row && col) o.onCommit(row, col, inp.value);
      });
    });

    /* 행추가 · 열추가 · 행 삭제 */
    const ar = host.querySelector("#ws-addrow");
    if (ar && o.onAddRow) ar.addEventListener("click", function () {
      const name = window.prompt("추가할 항목 이름을 적어 주세요 (예: Glucose, pH)");
      if (name && name.trim()) o.onAddRow(name.trim());
    });
    const ac = host.querySelector("#ws-addcol");
    if (ac && o.onAddCol) ac.addEventListener("click", function () { o.onAddCol(); });
    if (o.onDropRow) {
      $$("[data-drop]", host).forEach(function (b) {
        b.addEventListener("click", function () {
          if (window.confirm("이 행과 여기 적은 값을 지웁니다. 계속할까요?")) {
            o.onDropRow(b.dataset.drop);
          }
        });
      });
    }

    /* 이력 표식 — 올려도 뜨고 눌러도 뜹니다. 올리면 뜨는 것만 두면
       태블릿에서 볼 방법이 없고 키보드로도 닿지 않습니다. */
    if (!o.onHistory) return;
    let timer = null;
    $$("[data-hist]", host).forEach(function (b) {
      const parts = String(b.dataset.hist).split("::");
      const row = rows.find(x => x.k === parts[0]) || { k: parts[0] };
      const col = (o.cols || []).find(x => x.id === parts[1]) || { id: parts[1] };
      b.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        clearTimeout(timer); o.onHistory(b, row, col, true);
      });
      b.addEventListener("mouseenter", function () {
        clearTimeout(timer);
        timer = setTimeout(() => o.onHistory(b, row, col, false), 120);
      });
      b.addEventListener("mouseleave", function () {
        clearTimeout(timer);
        timer = setTimeout(() => o.onHistory(null, row, col, false), 160);
      });
      b.addEventListener("focus", () => o.onHistory(b, row, col, false));
      b.addEventListener("blur", () => o.onHistory(null, row, col, false));
    });
  }

  function mount(host, o) {
    if (!host) return null;
    host.innerHTML = markup(o);
    wire(host, o);
    return {
      cellOf: id => host.querySelector('[data-cell="' + id + '"]'),
      inputOf: (rk, ck) => host.querySelector('[data-r="' + rk + '"][data-c="' + ck + '"]')
    };
  }

  return { mount: mount, markup: markup };
})();
