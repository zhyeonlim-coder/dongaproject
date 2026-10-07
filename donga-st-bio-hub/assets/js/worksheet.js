/* ==========================================================================
   worksheet.js — 엑셀 워크시트 모양 입력판  ·  window.Worksheet

   왜 이 모양인가
     연구원이 옮겨 적는 원본이 엑셀 시트입니다. 항목이 왼쪽 열에 세로로
     서고, 오른쪽으로 시점(또는 시료)이 하나씩 늘어납니다. 화면이 다른
     배열이면 눈이 원본의 칸과 화면의 칸을 계속 짝지어야 하고, 그 과정에서
     한 칸씩 밀려 적는 실수가 납니다.

         ┌───────────┬──────┬──────┬──────┐
         │ 행추가 ↓  │  D10 │  D11 │  D12 │ ← 열추가 →
         │ 열추가 →  │ 10일차│11일차│12일차│
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

   ── 이름은 전부 고칠 수 있습니다 ───────────────────────────────────────
     머리글(열 이름 · 부제)과 항목명은 그 자리에서 바로 고치는 입력 칸입니다.
     누르면 입력 칸으로 "바뀌는" 방식은 쓰지 않았습니다 — 한 번 눌러야
     고칠 수 있다는 것을 아무도 알려 주지 않으면 고칠 수 있다는 사실
     자체를 모르고, 키보드로는 닿지도 않습니다. 늘 입력 칸으로 두고
     평소에는 글자처럼 보이게 했습니다.

   ★ 이 파일은 값도 이름도 저장하지 않습니다.
     저장·검증·감사 이력은 부르는 쪽(ebr-page)이 합니다. 저장까지 여기서
     하면 서식마다 다른 규칙(사유 필수 · 범위 검사 · 단위 해석 · 어느 이름이
     전사 공통이고 어느 이름이 이 화면만의 것인지)이 이 안으로 새어 들어오고,
     그러면 공통 컴포넌트가 아니게 됩니다.

   쓰는 법
     Worksheet.mount(host, {
       rows:    [{ k, label, unit, type, group, scalar, custom, orig }],
       cols:    [{ id, label, sub, scope, orig, origSub, fixed }],
       cell:    (row, col) => ({ display, origin, missing, edited, editCount, readonly }),
       onCommit:(row, col, raw) => "saved" | "none" | "error" | "needReason",
       onRevert:(row, col) => {},
       onHistory:(anchorEl, row, col, sticky) => {},
       onAddRow:  label => {},              없으면 행추가 버튼을 그리지 않습니다
       onAddCol:  () => {},                 없으면 열추가 버튼을 그리지 않습니다
       onDropRow: rowKey => {},
       onDropCol: col => {},                열 머리글의 × 버튼
       onRenameRow: (row, text) => {},      없으면 항목명이 글자로만 나옵니다
       onRenameCol: (col, part, text) => {} part 는 "name" | "sub"
     })

   scalar: true 인 행은 배치 단위 값입니다 — 첫 열에만 칸을 두고 나머지는
   비웁니다. 열마다 칸을 두면 같은 값을 여러 번 적게 되고, 어느 칸이 진짜인지
   알 수 없게 됩니다.

   orig / origSub 는 원본에 적혀 있던 이름입니다. 고친 뒤에도 마우스를 올리면
   원래 무엇이었는지 보여야 합니다 — 고친 이름만 남으면 원본 시트와 맞춰 볼
   수 없습니다.
   ========================================================================== */

window.Worksheet = (function () {
  "use strict";

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  function isMeasure(r) { return r.type !== "date" && r.type !== "text"; }

  /* 고친 이름 옆에 원래 이름을 달아 줍니다 (마우스를 올렸을 때) */
  function origTip(label, orig, what) {
    const o = orig == null ? "" : String(orig);
    if (!o || o === String(label == null ? "" : label)) return what + "을 고칠 수 있습니다";
    return what + " · 원래 이름: " + o;
  }

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
            /* ★ 추천값 목록(list="val-tokens")을 떼었습니다.

               칸을 누를 때마다 <1 · >200 · ND · NA 네 줄짜리 창이 열려서
               아래 칸들을 가렸습니다. 숫자를 옮겨 적는 사람에게는 매번
               치워야 하는 장애물입니다 — 네 값은 한 해에 몇 번 쓰는데,
               숫자는 하루에 수백 번 칩니다.

               값 자체는 그대로 받습니다. ND 나 <1 을 직접 치면 VAL.parse 가
               예전과 똑같이 알아듣습니다. 고른 것이 아니라 친 것이 됐을 뿐입니다. */
            ? 'type="text" inputmode="decimal" autocomplete="off"'
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

  /* ── 머리글 ───────────────────────────────────────────────────────────
     이름과 부제가 각각 입력 칸입니다. fixed 인 열(예: "시료 없음" 자리
     지킴)은 고칠 것이 없으므로 글자로만 둡니다. */
  function colHeadHTML(col, o) {
    const editable = !!o.onRenameCol && !col.fixed;
    const name = editable
      ? '<input class="ws-hin ws-hin-name" data-col="' + esc(col.id) + '" data-part="name" ' +
        'value="' + esc(col.label) + '" spellcheck="false" ' +
        'aria-label="' + esc(col.label) + ' 열 이름" ' +
        'title="' + esc(origTip(col.label, col.orig, "열 이름")) + '">'
      : '<span class="ws-colh-name">' + esc(col.label) + '</span>';
    const sub = editable
      ? '<input class="ws-hin ws-hin-sub" data-col="' + esc(col.id) + '" data-part="sub" ' +
        'value="' + esc(col.sub == null ? "" : col.sub) + '" spellcheck="false" ' +
        'placeholder="설명 추가" aria-label="' + esc(col.label) + ' 열 설명" ' +
        'title="' + esc(origTip(col.sub, col.origSub, "열 설명")) + '">'
      : (col.sub ? '<span class="ws-colh-sub">' + esc(col.sub) + '</span>' : "");

    return '<th scope="col" class="ws-colh" data-colh="' + esc(col.id) + '">' +
      '<div class="ws-colh-top">' + name +
        (o.onDropCol && !col.fixed
          ? '<button class="ws-colx" type="button" data-dropcol="' + esc(col.id) + '" ' +
            'title="이 열 지우기" aria-label="' + esc(col.label) + ' 열 지우기">×</button>'
          : "") +
      '</div>' + sub +
    '</th>';
  }

  function rowHeadHTML(row, o) {
    const editable = !!o.onRenameRow;
    const name = editable
      ? '<input class="ws-lin" data-rowlabel="' + esc(row.k) + '" ' +
        'value="' + esc(row.label) + '" spellcheck="false" ' +
        'aria-label="' + esc(row.label) + ' 항목명" ' +
        'title="' + esc(origTip(row.label, row.orig, "항목명")) + '">'
      : '<span class="ws-th-name">' + esc(row.label) + '</span>';

    return '<th scope="row" class="ws-th">' +
      '<div class="ws-th-top">' + name +
        (row.custom && o.onDropRow
          ? '<button class="ws-drop" type="button" data-drop="' + esc(row.k) + '" ' +
            'aria-label="' + esc(row.label) + ' 행 지우기" title="이 행 지우기">×</button>'
          : "") +
      '</div>' +
      (row.unit ? '<span class="ws-th-unit">' + esc(row.unit) + '</span>' : "") +
    '</th>';
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
        rowHeadHTML(row, o) +
        cols.map((col, i) => cellHTML(row, col, o.cell(row, col) || {}, i === 0)).join("") +
      '</tr>';
      return out;
    }).join("");

    return '<div class="ws-wrap">' +
      '<table class="ws-tbl">' +
        '<thead><tr>' +
          '<th scope="col" class="ws-corner">' +
            /* 부르는 쪽이 이름을 정합니다 — 이 표에서 한 열이 무엇인지는
               화면마다 다릅니다. Data 입력에서는 열 하나가 시료 하나라,
               "열추가" 라고 쓰면 무엇이 생기는지 알 수 없습니다. */
            (o.onAddRow ? '<button class="ws-add" type="button" id="ws-addrow">' +
              esc(o.addRowLabel || "행추가 ↓") + '</button>' : "") +
            (o.onAddCol ? '<button class="ws-add" type="button" id="ws-addcol">' +
              esc(o.addColLabel || "열추가 →") + '</button>' : "") +
            (!o.onAddRow && !o.onAddCol ? esc(o.cornerLabel || "항목") : "") +
          '</th>' +
          cols.map(c => colHeadHTML(c, o)).join("") +
        '</tr></thead>' +
        '<tbody>' + body + '</tbody>' +
      '</table></div>' +
      '<p class="ws-hint">' +
        '<b>← ↑ ↓ →</b> 칸 이동 · <b>Tab</b> 오른쪽 · <b>Enter</b> 확정하고 아래로 · ' +
        '<b>Shift+Enter</b> 위로 · <b>Esc</b> 되돌리기' +
        (o.onRenameCol || o.onRenameRow
          ? ' · 머리글과 항목명은 <b>눌러서</b> 고칩니다' : "") +
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
       scalar 행은 첫 열에만 칸이 있어, 좌표로 계산하면 빈자리를 짚습니다.
       ★ 머리글·항목명 입력 칸(.ws-hin · .ws-lin)은 격자에 넣지 않습니다.
         넣으면 값 칸에서 ↓ 를 눌렀을 때 이름 칸으로 떨어집니다. */
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
    /* Tab — 줄 끝에서 다음 줄 첫 칸으로 넘어갑니다. 엑셀과 같습니다.
       가로 이동(→)과 달리 표 전체를 한 줄로 이어서 봅니다. */
    function step(el, dir) {
      const p = locate(el);
      if (!p) return false;
      let r = p.r, c = p.c + dir;
      while (r >= 0 && r < p.g.length) {
        if (c >= 0 && c < p.g[r].length) { return focusAt(p.g, r, c); }
        r += dir;
        if (r < 0 || r >= p.g.length) return false;
        c = dir > 0 ? 0 : p.g[r].length - 1;
      }
      return false;
    }

    inputs().forEach(function (inp) {
      inp.addEventListener("keydown", function (e) {
        const row = rows.find(x => x.k === inp.dataset.r);
        const col = (o.cols || []).find(x => x.id === inp.dataset.c);
        if (!row || !col) return;

        if (e.key === "Tab") {
          /* 표 안에서는 Tab 이 다음 칸입니다. 막지 않으면 머리글 입력 칸과
             × 버튼까지 차례로 들러, 값을 이어 적을 수 없습니다. */
          if (step(inp, e.shiftKey ? -1 : 1)) e.preventDefault();
          return;
        }
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

      /* 글자를 치는 동안의 값 — 아직 저장 전입니다.
         부르는 쪽이 옆 그래프를 미리 그리는 데만 씁니다. 저장은 Enter 나
         칸을 벗어날 때만 일어나고, 여기서는 아무것도 기록하지 않습니다 —
         치다 만 숫자가 기록으로 남으면 이력이 오타로 가득 찹니다. */
      if (o.onEdit) inp.addEventListener("input", function () {
        const row = rows.find(x => x.k === inp.dataset.r);
        const col = (o.cols || []).find(x => x.id === inp.dataset.c);
        if (row && col) o.onEdit(row, col, inp.value);
      });
    });

    /* ── 이름 고치기 ───────────────────────────────────────────────────
       Enter 로 확정, Esc 로 되돌립니다. 칸을 벗어나도 확정합니다 —
       고쳐 놓고 다른 데를 누른 것을 "취소" 로 읽으면 방금 적은 것이
       사라집니다.

       ★ 확정하면 부르는 쪽이 표를 다시 그립니다. 다시 그리면 이 입력 칸이
         사라지고, 사라지는 과정에서 blur 가 한 번 더 납니다 — 그때 또
         확정하면 같은 이름 변경이 이력에 두 번 남습니다. 그래서 한 번
         보낸 칸은 잠급니다. */
    function wireName(el, commit) {
      const was = el.value;
      let done = false;
      function send() {
        if (done) return;
        const now = el.value.trim();
        if (now === was.trim()) return;
        done = true;
        commit(now);
      }
      el.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); send(); el.blur(); return; }
        if (e.key === "Escape") { e.preventDefault(); done = true; el.value = was; el.blur(); return; }
        /* 이름 칸에서 좌우 방향키는 글자 안에서만 씁니다 — 표 이동으로
           가로채면 오타를 고칠 수 없습니다. 아래로는 같은 줄의 첫 값 칸으로
           내려갑니다.

           ★ 고친 것이 있으면 내려가지 않습니다. 확정하면 부르는 쪽이 표를
             다시 그려 이 줄의 칸이 새 노드로 바뀌는데, 그때 옛 노드에
             focus() 를 걸면 커서가 아무 데도 없는 상태가 됩니다. */
        if (e.key === "ArrowDown") {
          const tr = el.closest("tr");
          const next = tr ? tr.querySelector(".ws-in") : null;
          if (!next) return;
          e.preventDefault();
          const changed = el.value.trim() !== was.trim();
          send();
          if (!changed) next.focus();
        }
      });
      el.addEventListener("blur", send);
    }

    if (o.onRenameCol) {
      $$(".ws-hin", host).forEach(function (el) {
        const col = (o.cols || []).find(x => x.id === el.dataset.col);
        if (!col) return;
        wireName(el, txt => o.onRenameCol(col, el.dataset.part, txt));
      });
    }
    if (o.onRenameRow) {
      $$(".ws-lin", host).forEach(function (el) {
        const row = rows.find(x => x.k === el.dataset.rowlabel);
        if (!row) return;
        wireName(el, txt => o.onRenameRow(row, txt));
      });
    }

    /* 행추가 · 열추가 · 행 삭제 · 열 삭제 */
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
    /* 열 삭제는 물어보지 않고 부르는 쪽에 넘깁니다 — 지울 수 있는 열인지,
       값이 있어 숨기기만 해야 하는 열인지는 부르는 쪽만 알기 때문입니다. */
    if (o.onDropCol) {
      $$("[data-dropcol]", host).forEach(function (b) {
        b.addEventListener("click", function () {
          const col = (o.cols || []).find(x => x.id === b.dataset.dropcol);
          if (col) o.onDropCol(col);
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
