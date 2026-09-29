/* ==========================================================================
   data-grid.js — 스키마로 그리는 입력 표  ·  window.DataGrid

   무엇인가
     "그룹 → 항목" 스키마를 주면 엑셀 모양의 입력 표를 그려 주고, 키보드
     이동을 걸어 주는 컴포넌트입니다. 어느 팀 서식이든 같은 표가 나옵니다.

   왜 뽑았는가
     연구원이 옮겨 적는 원본이 엑셀 표입니다. 화면이 서식마다 다른 모양이면
     눈이 원본의 행과 화면의 칸을 계속 짝지어야 하고, 그 과정에서 한 칸씩
     밀려 적는 실수가 납니다. 한 곳에서 그리면 모든 서식이 같은 배열입니다.

   ★ 이 파일은 값을 저장하지 않습니다.
     저장·검증·감사 이력은 부르는 쪽이 합니다. 여기서 저장까지 하면 서식마다
     다른 저장 규칙(사유 필수 · 범위 검사 · 단위 해석)이 이 안으로 새어
     들어오고, 그러면 공통 컴포넌트가 아니게 됩니다.

   쓰는 법
     const g = DataGrid.mount(host, {
       groups: [{ g: "SE-HPLC", items: [{ k, label, unit, type }] }],
       cell:   f => ({ value, display, origin, missing, edited, editCount }),
       onCommit: (f, raw, opts) => "saved" | "none" | "error" | "needReason",
       onRevert: f => {},
       onHistory: (anchorEl, f, sticky) => {}   // 표식을 올리거나 눌렀을 때
     });

   열 구성
     항목 · 입력값 · 단위 · 이력/출처
     단위를 값과 같은 칸에 넣지 않습니다 — 숫자만 세로로 정렬되어야
     자릿수가 눈에 들어옵니다.
   ========================================================================== */

window.DataGrid = (function () {
  "use strict";

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  /* 측정값인가 — 날짜·자유 텍스트는 숫자 정렬도 단위도 의미가 없습니다 */
  function isMeasure(f) { return f.type !== "date" && f.type !== "text"; }

  function rowMarkup(f, c) {
    const measure = isMeasure(f);
    const miss = c.missing || null;
    const edited = !!c.edited;

    return '<tr class="ebr-row' + (edited ? " is-edited" : "") + '" data-cell="' + esc(f.k) + '">' +
      '<th scope="row" class="ebr-th">' + esc(f.label) + (c.pin || "") + '</th>' +

      '<td class="ebr-td-in">' +
        '<div class="ebr-cellbox">' +
          '<label class="sr-only" for="in-' + esc(f.k) + '">' + esc(f.label) +
            (f.unit ? " (" + esc(f.unit) + ")" : "") + '</label>' +
          '<input class="ebr-gin' + (miss ? " is-missing" : "") +
            (c.bounded ? " is-bounded" : "") + '" ' +
            'id="in-' + esc(f.k) + '" data-f="' + esc(f.k) + '" ' +
            (measure
              ? 'type="text" inputmode="decimal" autocomplete="off" list="val-tokens" ' +
                'placeholder="숫자 · <1 · ND"'
              : 'type="' + (f.type === "date" ? "date" : "text") + '" ') +
            ' value="' + esc(c.display == null ? "" : c.display) + '">' +
          /* 수정 표시는 셀 우측 상단에 얹습니다. 값 옆에 나란히 두면 숫자
             정렬이 흐트러지고, 값이 길 때 가려집니다. */
          (edited
            ? '<button class="ebr-mark" data-hist="' + esc(f.k) + '" type="button" ' +
              'aria-label="' + esc(f.label) + ' 변경 이력 ' + esc(c.editCount) + '건 보기">' +
              '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
              'stroke-width="3"><path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/></svg></button>'
            : "") +
        '</div>' +
        '<p class="field-msg" data-msg="' + esc(f.k) + '" role="alert"></p>' +
      '</td>' +

      '<td class="ebr-td-unit">' + (f.unit ? esc(f.unit) : "") + '</td>' +

      '<td class="ebr-td-audit">' +
        (miss ? '<span class="miss-tag miss-' + esc(miss.code) + '" title="' + esc(miss.hint) + '">' +
                esc(miss.label) + '</span>' : "") +
        (c.origin ? '<span class="ebr-origin">' + esc(c.origin) + '</span>'
                  : (miss ? "" : '<span class="audit-none">미측정</span>')) +
        (edited ? '<span class="ebr-editcount" data-hist="' + esc(f.k) + '">수정 ' +
                  esc(c.editCount) + '회</span>' : "") +
      '</td>' +
    '</tr>';
  }

  /* 그룹마다 표를 나누지 않고 한 표에 담습니다. 나누면 열 너비가 그룹마다
     달라져, 정렬이라는 표의 유일한 이점이 사라집니다. */
  function markup(o) {
    const groups = o.groups || [];
    return '<div class="ebr-tbl-wrap">' +
      '<table class="ebr-tbl">' +
        '<thead><tr>' +
          '<th scope="col">항목</th>' +
          '<th scope="col">입력값</th>' +
          '<th scope="col">단위</th>' +
          '<th scope="col">이력 · 출처</th>' +
        '</tr></thead>' +
        groups.map(function (grp) {
          return '<tbody>' +
            '<tr class="ebr-grp"><th colspan="4" scope="colgroup">' + esc(grp.g) + '</th></tr>' +
            (grp.items || []).map(f => rowMarkup(f, o.cell(f) || {})).join("") +
          '</tbody>';
        }).join("") +
      '</table></div>' +
      '<p class="ebr-keyhint">' +
        '<b>↑ ↓</b> 위아래 셀 · <b>Tab</b> 다음 셀 · <b>Enter</b> 확정하고 아래로 · ' +
        '<b>Shift+Enter</b> 위로 · <b>Esc</b> 되돌리기' +
      '</p>';
  }

  /* ── 키보드 이동 ──────────────────────────────────────────────────────
     엑셀에서 옮겨 적는 사람이 손을 마우스로 옮기지 않아야 합니다. 한 칸
     적고 마우스를 잡는 순간 리듬이 끊기고, 그때 줄이 밀립니다.

     ★ Enter 로 확정했을 때 사유가 필요하면 아래로 옮기지 않습니다.
       옮겨 버리면 사유 창은 위 셀에 떠 있고 커서는 다른 셀에 있어, 무엇에
       대한 사유인지 알 수 없게 됩니다. */
  function wireKeys(host, o) {
    const all = (o.groups || []).reduce((a, g) => a.concat(g.items || []), []);
    const inputs = () => $$(".ebr-gin", host);

    function move(from, delta) {
      const list = inputs();
      const i = list.indexOf(from);
      if (i === -1) return;
      const next = list[i + delta];
      if (!next) return;
      next.focus();
      if (next.select) { try { next.select(); } catch (e) { /* date 입력 */ } }
    }

    inputs().forEach(function (inp) {
      inp.addEventListener("keydown", function (e) {
        const f = all.find(x => x.k === inp.dataset.f);
        if (!f) return;

        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          /* 날짜 칸에서는 위아래가 값 증감입니다 — 가로채지 않습니다 */
          if (f.type === "date") return;
          e.preventDefault();
          move(inp, e.key === "ArrowDown" ? 1 : -1);
          return;
        }

        if (e.key === "Enter") {
          e.preventDefault();
          const r = o.onCommit(f, inp.value, { via: "enter" });
          if (r === "needReason" || r === "error") return;   /* 그 자리에 머무릅니다 */
          const delta = e.shiftKey ? -1 : 1;
          if (r === "saved") {
            /* 저장하면 부르는 쪽이 표를 다시 그립니다. 지금 노드를 붙잡고
               있으면 사라진 노드를 가리키므로, 다시 그린 뒤의 같은 자리를
               키로 찾아 옮깁니다. */
            const key = inp.dataset.f;
            setTimeout(function () {
              const list = $$(".ebr-gin", host);
              const i = list.findIndex(x => x.dataset.f === key);
              const next = list[i + delta];
              if (next) { next.focus(); if (next.select) { try { next.select(); } catch (er) {} } }
            }, 0);
            return;
          }
          move(inp, delta);
          return;
        }

        if (e.key === "Escape") {
          e.preventDefault();
          if (o.onRevert) o.onRevert(f);
        }
      });

      /* 셀을 벗어나면 저장합니다 — 엑셀과 같은 느낌이어야 합니다 */
      inp.addEventListener("change", function () {
        const f = all.find(x => x.k === inp.dataset.f);
        if (f) o.onCommit(f, inp.value, { via: "blur" });
      });
    });

    /* 이력 표식 — 올려도 뜨고 눌러도 뜹니다. 올리면 뜨는 것만 두면
       태블릿에서 볼 방법이 없고 키보드로도 닿지 않습니다. */
    if (!o.onHistory) return;
    let timer = null;
    $$("[data-hist]", host).forEach(function (b) {
      const f = all.find(x => x.k === b.dataset.hist) || { k: b.dataset.hist };
      b.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        clearTimeout(timer);
        o.onHistory(b, f, true);
      });
      b.addEventListener("mouseenter", function () {
        clearTimeout(timer);
        timer = setTimeout(() => o.onHistory(b, f, false), 120);
      });
      b.addEventListener("mouseleave", function () {
        clearTimeout(timer);
        timer = setTimeout(() => o.onHistory(null, f, false), 160);
      });
      b.addEventListener("focus", () => o.onHistory(b, f, false));
      b.addEventListener("blur", () => o.onHistory(null, f, false));
    });
  }

  /* host 에 표를 그리고 키보드를 겁니다. 다시 그리려면 또 부르면 됩니다. */
  function mount(host, o) {
    if (!host) return null;
    host.innerHTML = markup(o);
    wireKeys(host, o);
    return {
      /* 셀 하나를 찾는 표준 방법 — 부르는 쪽이 메시지를 붙일 때 씁니다 */
      cellOf: k => host.querySelector('[data-cell="' + k + '"]'),
      inputOf: k => host.querySelector('[data-f="' + k + '"]')
    };
  }

  return { mount: mount, markup: markup, _isMeasure: isMeasure };
})();
