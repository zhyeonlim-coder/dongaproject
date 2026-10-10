/* ==========================================================================
   데이터 조회  [지시서 §3 §4]

   · '배치별(가로)' / '측정값별(세로)' 탭 분리 제거 — 단일 테이블
   · 선택한 Study 중심
   · 다중 컬럼 정렬 (Shift+클릭으로 2·3차 정렬 추가)
   · 컬럼 필터 + 조건 칩
   · Sample Name 자유 추가 (creatable) + 샘플별 모아보기
   · CSV 내보내기
   ========================================================================== */

(function () {
  "use strict";

  const user = window.Shell.mount({ page: "data" });
  if (!user) return;

  const L = window.LABELS;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  /* 다중 정렬 — [{key, dir}] 순서대로 우선순위.
     비어 있으면 조회 조건의 정렬(최신 날짜순 등)을 그대로 씁니다.
     컬럼을 눌러 직접 정렬한 순간부터 이쪽이 우선합니다. */
  let sorts = [];
  /* ── 조회 단위는 '시료' 하나입니다 ────────────────────────────────────
     Data 입력의 열 하나가 시료 하나이고, 시료마다 값 담는 그릇이 1:1 로
     붙습니다. 그래서 그릇 한 줄이 곧 시료 한 줄입니다 — 여러 열을 적어도
     한 줄로 묶이지 않고 각각 독립된 레코드로 조회됩니다.

     예전의 '배치별' 과 '시료별' 구분은 그릇 하나에 시료가 여럿일 때의
     것이었습니다. 1:1 이 된 지금 둘은 같은 결과를 내고, 둘을 남겨 두면
     "어느 쪽이 맞는 숫자인가" 를 사용자가 판단해야 합니다.

     'compare' 는 여러 시료를 나란히 놓고 차이 큰 항목만 올려 보는 화면으로
     남깁니다 — 단위가 아니라 보기 방식입니다. */
  let groupBy = "sample";       // "sample" | "compare"
  let colFilters = {};          // { colKey: "부분일치 문자열" }

  /* ══════════════════════════════════════════════════════════════════════
     표 보기 설정 — 밀도 · 컬럼 너비 · 숨긴 컬럼

     43개 컬럼짜리 표를 하루 종일 보는 사람의 화면입니다. 어느 컬럼을 넓히고
     어느 것을 치웠는지는 그 사람의 작업 방식이라, 새로 고칠 때마다 원래대로
     돌아가면 매번 다시 맞추게 됩니다. 그래서 브라우저에 남깁니다.

     ★ 이 설정은 **보는 방식**일 뿐 데이터가 아닙니다. 값을 거르거나 바꾸지
       않습니다 — 숨긴 컬럼도 CSV 에는 그대로 나갈 수 있고(내보낼 때 묻습니다),
       컬럼 필터(colFilters)와 달리 행 수를 바꾸지 않습니다.
     ══════════════════════════════════════════════════════════════════════ */
  const GRID_KEY = "hub.data.grid";
  const GRID_DEFAULT = { dense: true, hidden: {}, width: {} };

  let grid = (function () {
    try {
      const r = window.Persist.getLocalJSON(GRID_KEY, null);
      if (!r || typeof r !== "object") return Object.assign({}, GRID_DEFAULT);
      return { dense: r.dense !== false, hidden: r.hidden || {}, width: r.width || {} };
    } catch (e) { return Object.assign({}, GRID_DEFAULT); }
  })();
  function saveGrid() {
    window.Persist.setLocalJSON(GRID_KEY, grid);
  }

  /* 숨긴 컬럼 수 — 식별 컬럼까지 포함해 셉니다 */
  function hiddenCount(cols) {
    return (cols || []).filter(c => grid.hidden[c.key]).length;
  }
  function widthOf(c) {
    const w = grid.width[c.key];
    return (typeof w === "number" && w > 0) ? w : c.w;
  }

  /* ── AI 에게 이 화면의 표 상태를 알려 줍니다 ─────────────────────────
     "여기서 가장 높은 값" 의 "여기" 를 풀려면, 지금 표에 무엇이 어떤
     순서로 보이는지 알아야 합니다. Scope(과제·기간 등)는 AIContext 가
     이미 읽고 있으므로, 여기서는 이 화면만 아는 것을 더합니다 —
     컬럼 정렬과 컬럼 필터입니다. */
  if (window.AIContext) {
    window.AIContext.provide("table", function () {
      return {
        groupBy: groupBy,
        sorts: sorts.map(s => ({ key: s.key, dir: s.dir })),
        colFilters: Object.keys(colFilters).length ? Object.assign({}, colFilters) : null
      };
    });
  }

  window.Shell.subnav([
    { label: "보기", items: [
      { key: "sample",  ko: "시료별", active: true },
      { key: "compare", ko: "시료 비교", active: false }
    ]},
    { label: "바로가기", items: [
      { ko: "대시보드", href: "dashboard.html" },
      { ko: "Data 입력", href: "ebr.html" },
      { ko: "Troubleshooting", href: "hub.html#wiki" }
    ]}
  ], k => { groupBy = k; syncSelectHook(); render(); });

  /* ══════════════════════════════════════════════════════════════════════
     배치 비교 — "이 배치만 왜 달랐나"

     여러 배치를 나란히 놓는 것까지는 표로도 됩니다. 사람이 못 하는 건
     **어느 항목이 실제로 다른지** 를 골라내는 일입니다. 그래서 값이 서로
     비슷한 행은 접고, 편차가 큰 행만 위로 올려 표시합니다.
     ══════════════════════════════════════════════════════════════════════ */
  let cmpPicked = [];
  const CMP_MAX = 4;

  /* 상대 편차 — 값의 크기가 제각각이라(ppm vs %) 절대 차이로는 비교가 안 됩니다.
     중앙값 대비 폭으로 재야 항목끼리 견줄 수 있습니다. */
  function spreadOf(vals) {
    const v = vals.filter(x => x !== null && x !== undefined && isFinite(x));
    if (v.length < 2) return null;
    const lo = Math.min.apply(null, v), hi = Math.max.apply(null, v);
    const mid = (lo + hi) / 2;
    if (!mid) return hi - lo === 0 ? 0 : 1;
    return Math.abs(hi - lo) / Math.abs(mid);
  }

  function compareView(batches) {
    if (batches.length < 2) {
      return '<div class="empty"><div class="empty-title">비교할 배치가 부족합니다</div>' +
        '<div class="empty-body">이 범위에 배치가 2건 이상이어야 비교할 수 있습니다.</div></div>';
    }

    const cols = cmpPicked.map(id => batches.find(b => b.id === id)).filter(Boolean);
    const picked = cmpPicked;
    const sel = window.Scope.get();

    /* 비교 대상 항목 — 배치 메타 · 배양 · 정제 · 분석

       ★ 분석 항목이 예전에는 빠져 있었습니다. 값이 배치가 아니라 시료에
         붙는다는 이유였는데, 그 때문에 [SE-HPLC] 같은 Data 분류 버튼이 이
         화면에서만 아무 반응도 없었습니다 — 표에 해당 행 자체가 없으니
         걸러 낼 것도 없었던 것입니다.

         배치별 표는 이미 대표 시료 값으로 분석 컬럼을 보여 주고 있습니다
         (Repo.valueOf 가 그렇게 내려갑니다). 같은 데이터를 한 화면에서는
         보여 주고 다른 화면에서는 감추면, 두 화면을 견주는 사람이 어느
         쪽이 맞는지 알 수 없습니다. 대표 시료 값이라는 사실은 표 아래에
         밝혀 둡니다. */
    const rows = [];
    rows.push({ key: "cultureDays", group: "기간", label: "배양 일수", unit: "일", dp: 0,
                get: b => b.cultureDays });
    window.DATA_ANALYTE_GROUPS.forEach(function (g) {
      if (g.empty) return;
      const perSample = g.team === "analytics";
      g.items.forEach(it => rows.push({
        /* 키는 컬럼 표와 같은 규칙이어야 합니다 — Data 분류가 그 키로
           걸러지기 때문입니다 (repo.colInClass) */
        key: (g.team === "upstream") ? it.key : g.id + "." + it.key,
        group: g.label, label: it.label, unit: it.unit, dp: it.dp, perSample: perSample,
        get: b => window.Repo.valueOf(b, g.id, it.key)
      }));
    });

    /* Data 분류 선택 → 그 분류의 항목만 남깁니다. 컬럼 표와 같은 기준입니다. */
    const shown = sel.dataClass
      ? rows.filter(r => window.Repo.colInClass(r.key, sel.dataClass))
      : rows;
    const clsLabel = sel.dataClass
      ? ((window.Repo.getDataClasses().find(c => c.id === sel.dataClass) || {}).label || "")
      : "";
    if (sel.dataClass && !shown.length) {
      return cmpChipBar(batches, picked) +
        '<div class="empty"><div class="empty-title">' + esc(clsLabel) +
          ' 에 해당하는 비교 항목이 없습니다</div>' +
        '<div class="empty-body">위 [전체 항목] 을 누르면 모든 항목이 다시 나옵니다.</div></div>';
    }
    const anySample = shown.some(r => r.perSample);

    const scored = shown.map(function (r) {
      const vals = cols.map(r.get);
      return { r: r, vals: vals, spread: spreadOf(vals) };
    });
    const diff = scored.filter(x => x.spread !== null && x.spread >= 0.1)
                       .sort((a, b) => b.spread - a.spread);
    const same = scored.filter(x => diff.indexOf(x) === -1);

    const cell = (v, dp) => (v === null || v === undefined || !isFinite(v))
      ? '<td class="na">' + L.empty + '</td>'
      : '<td class="mono">' + Number(v).toFixed(dp) + '</td>';

    const table = (list, mark) => list.map(function (x) {
      const nums = x.vals.filter(v => v !== null && isFinite(v));
      const hi = nums.length ? Math.max.apply(null, nums) : null;
      const lo = nums.length ? Math.min.apply(null, nums) : null;
      return '<tr' + (mark ? ' class="cmp-diff"' : "") + '>' +
        '<th scope="row"><span style="font-size:10px;color:var(--c-text-mute);display:block">' +
          esc(x.r.group) + '</span>' + esc(x.r.label) +
          '<span style="font-weight:400;color:var(--c-text-soft)"> ' + esc(x.r.unit) + '</span></th>' +
        x.vals.map(function (v) {
          if (v === null || v === undefined || !isFinite(v)) return cell(v, x.r.dp);
          const tag = (nums.length > 1 && v === hi) ? " is-hi" : (nums.length > 1 && v === lo) ? " is-lo" : "";
          return '<td class="mono' + tag + '">' + Number(v).toFixed(x.r.dp) + '</td>';
        }).join("") +
        '<td class="mono" style="color:var(--c-text-mute)">' +
          (x.spread === null ? "—" : Math.round(x.spread * 100) + "%") + '</td>' +
      '</tr>';
    }).join("");

    return cmpChipBar(batches, picked) +

      (sel.dataClass
        ? '<div class="card-body" style="padding-bottom:0"><div class="demo-note">' +
          '<b>' + esc(clsLabel) + '</b> 항목만 보는 중입니다 (' + shown.length + '건). ' +
          '다른 공정에 원인이 있을 수 있으니, 짚이는 것이 없으면 ' +
          '[전체 항목] 으로 되돌려 보세요.</div></div>'
        : "") +

      '<div class="dgrid' + (grid.dense ? " is-dense" : "") + '">' +
      '<table class="tbl cmp-tbl"><thead><tr>' +
        '<th scope="col">항목</th>' +
        cols.map(b => '<th scope="col"><span class="mono">' + esc(b.id) + '</span>' +
          '<br><span style="font-weight:400;text-transform:none;font-size:10px">' +
          esc(b.initialDate || "") + '</span></th>').join("") +
        '<th scope="col">편차</th>' +
      '</tr></thead><tbody>' +
        (diff.length
          ? '<tr class="cmp-sep"><th scope="row" colspan="' + (cols.length + 2) + '">' +
            '차이가 큰 항목 ' + diff.length + '건 (중앙값 대비 10% 이상)</th></tr>' + table(diff, true)
          : '<tr class="cmp-sep"><th scope="row" colspan="' + (cols.length + 2) + '">' +
            '뚜렷한 차이가 없습니다</th></tr>') +
        '<tr class="cmp-sep"><th scope="row" colspan="' + (cols.length + 2) + '">' +
          '비슷한 항목 ' + same.length + '건</th></tr>' + table(same, false) +
      '</tbody></table></div>' +

      '<div class="card-body">' +
        '<p style="font-size:11.5px;color:var(--c-text-mute);margin:0;line-height:1.7">' +
        '편차는 <b>(최댓값 − 최솟값) ÷ 중앙값</b> 입니다. 단위가 다른 항목끼리 견주려면 ' +
        '절대 차이가 아니라 상대 폭으로 재야 합니다. 각 행에서 가장 큰 값은 파랑, 가장 작은 값은 주황입니다.' +
        (anySample
          ? '<br>분석 항목(SE-HPLC · IE-HPLC · N-glycan · CE-SDS)은 배치가 아니라 시료를 측정한 ' +
            '값이라, 여기서는 <b>각 배치의 대표 시료</b> 값을 보여 줍니다. 한 배치에서 여러 시료를 ' +
            '시험했다면 <b>시료별</b> 보기에서 확인하세요.'
          : "") +
        '</p>' +
      '</div>';
  }

  /* 비교할 배치 고르는 줄 — 항목이 하나도 남지 않았을 때도 이 줄은 나와야
     합니다. 배치 선택까지 사라지면 되돌릴 방법이 화면에 없습니다. */
  function cmpChipBar(batches, picked) {
    return '<div class="card-body" style="border-bottom:1px solid var(--c-border)">' +
      '<div class="eyebrow" style="margin-bottom:var(--s-2)">비교할 배치 (최대 ' + CMP_MAX + '개)</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
        batches.map(b => '<button class="mm-chip" data-cmp="' + esc(b.id) + '" ' +
          'aria-pressed="' + (picked.indexOf(b.id) > -1) + '">' + esc(b.id) + '</button>').join("") +
      '</div></div>';
  }

  /* ── 컬럼 정의 ──────────────────────────────────────────────────────────
     식별 컬럼(과제 · Study · Exp. No. …)은 항상 남기고, 측정 컬럼만
     팀 · Data 분류 · 검색어로 좁힙니다. 식별 컬럼까지 사라지면 어느 배치의
     값인지 알 수 없게 되기 때문입니다. */
  /* opts.all = true 면 숨긴 컬럼까지 전부 돌려줍니다 — 컬럼 표시/숨기기
     목록과 CSV 가 씁니다. 화면에 안 보이는 컬럼도 목록에는 있어야 다시
     꺼낼 수 있습니다. */
  function columns(titerDays, opts) {
    const sel = window.Scope.get();
    const team = sel.team;

    /* ── 식별 컬럼 ──────────────────────────────────────────────────────
       과제 → Study → 팀 → Sample. 계층 그대로입니다.

       ★ 'Exp. No.' · 'Initial / End Date' · 'Days' · '채취 단계' · '채취일'
         을 전부 내렸습니다. 사용자가 적는 곳이 없는 칸들입니다 — Data 입력
         표에는 그 항목이 없고, 그릇(hidden batch)의 날짜는 자동으로 찍히는
         값입니다. 늘 "미입력" 인 컬럼이 여섯 개나 서 있으면 미입력이
         신호가 아니라 배경이 됩니다.

         남는 것은 **무엇의 값인가**(과제 · Study · 팀 · 시료)와 측정값뿐입니다. */
    const base = [
      { key: "projectLabel", label: "과제",      type: "s", w: 120 },
      { key: "studyName",    label: "Study",     type: "s", w: 140 },
      { key: "teamLabel",    label: "팀",        type: "s", w: 80 },
      { key: "sampleName",   label: L.ui.sampleName, type: "s", w: 190 }
    ];

    const measure = [];

    /* ★ 측정 항목은 **전부 스키마에서 읽습니다.**
       예전에는 배양 항목만 여기 따로 적어 두었고, 지표를 재설정했을 때
       이 화면만 옛 항목(Titer HCCF · qP)을 계속 보여 줬습니다. 조회 화면이
       Data 입력과 다른 항목을 보여 주면 어느 쪽이 맞는지 알 수 없습니다. */
    window.DATA_ANALYTE_GROUPS.forEach(g => {
      if (g.empty) return;
      if (team && g.team !== team) return;
      g.items.forEach(it => measure.push({
        /* 배양 그룹은 이름을 겹쳐 적지 않습니다 (배양 IVCD → IVCD) */
        key: g.id + "." + it.key,
        /* 그룹 이름과 항목 이름이 같으면 한 번만 적습니다 ("Potency Potency") */
        label: (g.team === "upstream" || g.label === it.label)
          ? it.label : g.label + " " + it.label,
        type: "n", dp: it.dp, w: g.team === "upstream" ? 92 : 108
      }));
      if (g.team === "upstream") {
        titerDays.forEach(d => measure.push({
          key: "titer." + d, label: "Titer " + d, type: "n", dp: 0, w: 88 }));
      }
    });

    /* Data 입력에서 직접 더한 항목 · 열 */
    const all = base.concat(narrowMeasures(measure.concat(customCols(opts && opts.batches)), sel));
    if (opts && opts.all) return all;

    /* 마지막 한 컬럼까지 숨기지는 않습니다 — 빈 표가 되면 되돌릴 손잡이가
       화면에서 사라집니다 (설정 창은 남지만, 표가 통째로 비면 무엇이
       잘못됐는지 알기 어렵습니다). */
    const shown = all.filter(c => !grid.hidden[c.key]);
    return shown.length ? shown : all;
  }

  /* ── Data 입력에서 직접 더한 항목 ─────────────────────────────────────
     워크시트에서 [항목 추가 ↓] 로 만든 칸은 ws_<행이름> 키로
     저장됩니다. 그 값이 입력 화면에만 머물면, 적어 놓고도 조회할 수 없는
     데이터가 생깁니다 — 적은 사람만 아는 숫자입니다.

     스키마에 없는 항목이라 **실제로 값이 있는 것만** 컬럼으로 세웁니다.
     있지도 않은 조합까지 열을 세우면 43개 컬럼짜리 표가 조합 수만큼
     넓어집니다.

     ★ 컬럼 키는 cust.<저장키> 입니다. 점이 들어가지만 분석 그룹 키("그룹.항목")
       와 섞이지 않도록 cellValue 에서 cust. 를 먼저 가릅니다. */
  /* ★ 키 모양이 바뀌었습니다: ws_<행>@<열id> → ws_<행>.

     열이 시료가 되면서 열마다 자기 그릇이 생겼습니다. 그릇 안에서는 그 행이
     하나뿐이라 열 id 를 키에 붙일 이유가 없습니다. 예전 모양(@ 포함)도 계속
     읽습니다 — 이미 적어 둔 값이 있으면 조회 화면에서 사라지면 안 됩니다. */
  function customCols(batches) {
    if (!window.Entries || !window.Entries.getScopeValues) return [];
    const seen = {};
    (batches || []).forEach(function (b) {
      const vals = window.Entries.getScopeValues("batch:" + b.id) || {};
      Object.keys(vals).forEach(function (k) {
        if (k.indexOf("ws_") !== 0 || seen[k]) return;
        const at = k.indexOf("@");
        const rowKey = at < 0 ? k.slice(3) : k.slice(3, at);
        seen[k] = { key: "cust." + k,
                    label: customLabel(rowKey) + (at < 0 ? "" : " · " + k.slice(at + 1)),
                    type: "n", dp: 2, w: 110 };
      });
    });
    return Object.keys(seen).sort().map(k => seen[k]);
  }

  /* 행 이름 — 스키마 항목이면 그 라벨을, 사용자가 만든 항목이면 이름 그대로 */
  function customLabel(rowKey) {
    let hit = null;
    (window.DATA_ANALYTE_GROUPS || []).some(function (g) {
      const it = (g.items || []).find(x => window.Repo.fieldKey(g.id, x.key) === rowKey);
      if (it) { hit = it.label; return true; }
      return false;
    });
    if (hit) return hit;
    if (rowKey === "titer") return (window.DATA_TITER_ITEM || {}).label || "Titer";
    return rowKey;
  }

  /* Data 분류 선택 → 그 분류의 컬럼만.
     검색어 → 컬럼 라벨이나 Data 분류 별칭에 걸리는 컬럼만.
     둘 다 걸리는 게 없으면 좁히지 않습니다 — 검색 한 글자에 표가 빈
     껍데기가 되는 것보다 전부 보여주는 편이 낫습니다. */
  function narrowMeasures(measure, sel) {
    let out = measure;

    if (sel.dataClass) {
      out = out.filter(c => window.Repo.colInClass(c.key, sel.dataClass));
    }

    const term = (sel.q || "").trim().toLowerCase();
    if (term) {
      const classHits = window.Repo.getDataClasses()
        .filter(dc => window.Repo.classMatchesTerm(dc, term));
      const hit = out.filter(c =>
        c.label.toLowerCase().indexOf(term) > -1 ||
        classHits.some(dc => window.Repo.colInClass(c.key, dc.id)));
      if (hit.length) out = hit;
    }
    return out;
  }

  const IDENT_COLS = ["projectLabel", "studyName", "teamLabel", "sampleName"];

  /* ── 값 읽기 ──────────────────────────────────────────────────────────
     한 줄이 여러 팀의 시료를 묶고 있을 수 있습니다 (mergeBySample).
     그때는 묶인 그릇을 차례로 보고 **처음 나오는 값**을 씁니다.

     한 팀의 서식에 없는 항목은 그 팀 그릇에서 null 로 나오므로, 배양 칸은
     배양 그릇이, 정제 칸은 정제 그릇이 자연히 채웁니다. 팀을 키로 미리
     갈라 두지 않는 이유는 [항목 추가 ↓] 로 만든 칸(ws_*)에는 팀이 없기
     때문입니다 — 갈라 두면 그 칸이 어느 쪽에서도 안 보입니다.

     식별 칸(과제 · Study · 팀 · 시료)은 묶을 때 이미 정해 두었으므로
     묶음 줄에서 그대로 읽습니다. */
  function cellValue(row, key) {
    if (row && row._parts && IDENT_COLS.indexOf(key) < 0) {
      for (let i = 0; i < row._parts.length; i++) {
        const v = cellOf(row._parts[i], key);
        if (v !== null && v !== undefined && v !== "") return v;
      }
      return null;
    }
    return cellOf(row, key);
  }

  /* 묶이지 않은 한 줄에서 읽습니다 */
  function cellOf(row, key) {
    if (IDENT_COLS.indexOf(key) > -1)
      return row[key] === undefined ? null : row[key];
    /* Data 입력에서 더한 항목 — 배치 범위에 ws_ 키로 들어 있습니다.
       아래 "그룹.항목" 가르기보다 먼저 봐야 합니다 (키에 점이 있습니다). */
    if (key.indexOf("cust.") === 0) {
      const rec = window.Entries.getValue("batch:" + (row.batchId || row.id), key.slice(5));
      return rec ? window.VAL.numeric(window.VAL.coerce(rec.value)) : null;
    }
    if (key.indexOf("titer.") === 0) return row.upstream?.titer?.[key.slice(6)] ?? null;
    /* 정제 값은 batch.downstream 에 있습니다 (downstream.js 가 채움) */
    if (key.indexOf("downstream.") === 0)
      return row.downstream ? row.downstream[key.slice(11)] : null;
    if (key.indexOf(".") > -1) {
      const p = key.split(".");
      /* ★ 팀을 가리지 않고 Repo.valueOf 하나를 지납니다.

         Data 입력이 적은 값은 그 시료의 그릇(batch:<id>)에 들어가고,
         valueOf 는 그 그릇을 **먼저** 봅니다. 여기서 valueOfSample 로 바로
         내려가면 적은 값을 건너뛰고 Excel 원본만 보여 줍니다 — 입력 화면에는
         고친 값이, 조회 화면에는 옛 값이 뜨고 둘 다 그럴듯해서 어느 쪽이
         맞는지 알 수 없게 됩니다. */
      return window.Repo.valueOf(row, p[0], p[1]);
    }
    if (row.upstream && row.upstream[key] !== undefined) return row.upstream[key];
    return row[key] === undefined ? null : row[key];
  }

  /* 회의 모드에서 남긴 의사결정 핀 — 값이 어디서 지적됐는지 이 화면에서도
     보여야 회의 밖에서 데이터를 볼 때 맥락이 끊기지 않습니다.
     이 화면의 컬럼 키는 "그룹.항목" 이라 그대로 쪼개 쓰면 됩니다. */
  /* 한 줄이 쓰는 그릇 목록 — 묶인 줄은 여럿입니다 */
  function rowIds(row) {
    if (!row) return [];
    if (row._parts) return row._parts.map(p => p.batchId || p.id).filter(Boolean);
    const id = row.batchId || row.id;
    return id ? [id] : [];
  }

  /* 묶인 줄은 어느 그릇에 찍힌 핀이든 그 줄에 보여야 합니다 — 한쪽만 보면
     정제 칸을 지적한 핀이 통째로 사라집니다. */
  function pinMarkRow(row, key) {
    return rowIds(row).map(id => pinMark(id, key)).join("");
  }

  function pinMark(batchId, key) {
    if (!window.Pins || !batchId) return "";
    const k = String(key);
    /* 이 화면의 컬럼 키는 두 모양이 섞여 있습니다. 정제 · 분석은 "그룹.항목",
       배양 · Titer 는 점 없이 항목만("maxVCD"). 한쪽만 보면 배양 칸의 핀이
       통째로 안 보입니다. */
    const list = k.indexOf(".") > -1
      ? window.Pins.forCell(batchId, k.split(".")[0], k.split(".")[1])
      : window.Pins.forField(batchId, k);
    if (!list.length) return "";
    const tip = list.map(x =>
      ((window.Pins.KIND[x.kind] || {}).ko || "핀") + ": " + x.text + " — " + x.createdBy).join(" / ");
    return '<span class="pin-mark" title="' + esc(tip) + '">◆' +
      (list.length > 1 ? list.length : "") + '</span>';
  }

  /* ── 행 구성 ──────────────────────────────────────────────────────────
     한 시료 = 한 행.

     Data 입력에서 열을 두 개 적었으면 여기 두 줄이 섭니다 — 묶이지 않습니다.
     그릇(hidden batch)이 시료와 1:1 이라, 그릇 목록을 그대로 펼치면 됩니다.

     아직 시료 레코드가 없는 옛 그릇도 한 줄로 둡니다. 값은 그 그릇에
     적혀 있으므로, 빼면 적어 둔 숫자가 조회 화면에서 사라집니다. */
  function buildRows(batches, studies) {
    return mergeBySample(buildSampleRows(batches, studies));
  }

  function buildSampleRows(batches, studies) {
    const teamById = {};
    window.DATA_TEAMS.forEach(t => { teamById[t.id] = t; });

    const out = [];
    batches.forEach(function (b) {
      const st = studies.find(s => s.id === b.studyId) || null;
      const d = Object.assign({}, b, {
        studyName: st ? st.name : b.studyId,
        projectLabel: window.Repo.projectLabel(st),
        teamLabel: teamById[b.team] ? teamById[b.team].short : b.team
      });
      const samples = window.Repo.samplesOfBatch(b.id);
      if (!samples.length) {
        out.push(Object.assign({}, d, {
          sampleName: b.expNo || b.id, sampleId: null, sampleStage: null,
          collectedAt: null, _sample: null
        }));
        return;
      }
      samples.forEach(s => out.push(Object.assign({}, d, {
        sampleName: s.name, sampleId: s.id, sampleStage: s.stage,
        collectedAt: s.collectedAt || null, _sample: s
      })));
    });
    return out;
  }

  /* ══════════════════════════════════════════════════════════════════════
     같은 시료 이름은 한 줄로 — 팀별 입력, 한 줄 조회

     배양 담당과 정제 담당은 각자 자기 서식에 적습니다. 그래서 같은 시료라도
     그릇이 둘로 생깁니다. 입력 쪽은 그대로 두는 게 맞습니다 — 자기 팀 항목만
     보이는 서식이 입력에는 훨씬 빠릅니다.

     하지만 조회 쪽에서 두 줄로 남으면, 같은 시료의 배양 수율과 정제 수율을
     견주려고 두 줄 사이를 눈으로 왕복하게 됩니다. 그 왕복이 오독입니다.
     그래서 **같은 Study · 같은 시료 이름**이면 가로로 이어 한 줄로 놓습니다.

     묶는 규칙:
     · 이름은 앞뒤 공백과 중간 공백 수, 대소문자를 무시해 견줍니다
       ("Sample 1" = "sample  1"). 사람이 손으로 적는 칸이라 그 차이로
       같은 시료가 갈라지면 묶이는 이유를 알 수 없습니다.
     · **다른 팀끼리만** 묶습니다. 한 팀 안에서 이름이 겹치는 두 열은 서로
       다른 시료일 수 있으므로 합치지 않습니다 — 합치면 둘 중 하나의 값이
       화면에서 사라집니다.
     · 이름이 비어 있으면 묶지 않습니다. 빈 이름끼리 묶으면 아무 관계 없는
       시료가 한 줄이 됩니다.
     · 한 팀에 같은 이름이 여러 열 있으면 나온 순서대로 짝을 맞춥니다.
       짝이 없는 쪽은 그 칸만 미입력으로 남습니다.

     원본은 건드리지 않습니다 — 묶음은 보기 방식이고, 각 줄은 자기 그릇을
     _parts 로 그대로 들고 있습니다 (값·핀·CSV 가 그 그릇을 지납니다).
     ══════════════════════════════════════════════════════════════════════ */
  function sampleKeyOf(name) {
    return String(name === null || name === undefined ? "" : name)
      .trim().replace(/\s+/g, " ").toLowerCase();
  }

  function mergeBySample(rows) {
    const groups = [];
    const at = {};
    (rows || []).forEach(function (r) {
      const nk = sampleKeyOf(r.sampleName);
      if (!nk) { groups.push([r]); return; }
      const gk = String(r.studyId || "") + "\u0000" + nk;
      if (at[gk] === undefined) { at[gk] = groups.length; groups.push([]); }
      groups[at[gk]].push(r);
    });

    const out = [];
    groups.forEach(g => fold(g).forEach(r => out.push(r)));
    return out;
  }

  function fold(group) {
    if (group.length < 2) return group;

    const teams = [], byTeam = {};
    group.forEach(function (r) {
      const t = r.team || "";
      if (!byTeam[t]) { byTeam[t] = []; teams.push(t); }
      byTeam[t].push(r);
    });
    if (teams.length < 2) return group;          // 같은 팀끼리는 묶지 않습니다

    let n = 0;
    teams.forEach(t => { if (byTeam[t].length > n) n = byTeam[t].length; });

    const out = [];
    for (let i = 0; i < n; i++) {
      const parts = teams.map(t => byTeam[t][i]).filter(Boolean);
      out.push(parts.length > 1 ? combine(parts) : parts[0]);
    }
    return out;
  }

  /* 묶인 그릇을 보는 순서를 팀 정의 순서(배양 → 정제 → 분석)로 못박습니다.
     나온 순서 그대로 두면 표 정렬을 바꿀 때마다 순서가 달라지고, 같은 칸을
     두 팀이 모두 적은 드문 경우에 **어느 값이 보일지가 정렬에 따라 바뀝니다**.
     보이는 숫자가 정렬 때문에 달라지면 어느 쪽이 맞는지 알 수 없습니다. */
  function teamOrder(team) {
    const i = (window.DATA_TEAMS || []).findIndex(t => t.id === team);
    return i < 0 ? 99 : i;
  }

  function combine(parts) {
    const ordered = parts.slice().sort((a, b) => teamOrder(a.team) - teamOrder(b.team));
    /* 이름은 팀 순서상 앞선 쪽(보통 배양)에 적힌 표기를 씁니다 — 공백·대소문자만
       다른 표기 중 하나를 골라야 하고, 그 선택도 정렬과 무관해야 합니다. */
    const row = Object.assign({}, ordered[0]);
    row._parts = ordered;
    /* 팀 칸에는 묶인 팀을 모두 적습니다 — 이 줄의 숫자가 어느 서식에서
       왔는지가 팀 이름 하나만 보이면 틀리게 읽힙니다. */
    row.teamLabel = ordered.map(p => p.teamLabel).filter(Boolean).join(" · ");
    return row;
  }

  /* ══════════════════════════════════════════════════════════════════════
     값이 하나도 없는 시료는 숨깁니다

     시료를 만들어 두고 아직 아무것도 적지 않으면, 측정 컬럼이 전부 "미입력"
     인 줄이 섭니다. 그런 줄이 여럿이면 표는 "미입력" 으로 가득 차고, 진짜
     빠진 값 하나가 그 안에 묻힙니다.

     ★ 지우는 것이 아니라 접는 것입니다. 몇 줄을 접었는지 표 위에 적고,
       한 번 눌러 펼칠 수 있습니다. 이 프로젝트의 규칙은 "조건 밖이면
       강조만 하고 지우지 않는다" 이고, 데이터는 늘 한 번에 볼 수 있어야
       합니다 — 기본만 접어 두는 것이지 닿지 못하게 하지 않습니다. */
  let showBlank = false;

  function keepMeasured(rows, cols) {
    const measure = (cols || []).filter(c => c.type === "n");
    if (!measure.length) return rows;
    return (rows || []).filter(function (r) {
      return measure.some(function (c) {
        const v = cellValue(r, c.key);
        return v !== null && v !== undefined && v !== "";
      });
    });
  }

  function paintBlankNote(n) {
    const host = $("#blank-note");
    if (!host) return;
    if (!n) { host.innerHTML = ""; return; }
    host.innerHTML = '<div class="demo-note" style="display:flex;gap:var(--s-3);' +
      'align-items:center;flex-wrap:wrap">' +
      '<span>값이 아직 하나도 없는 시료 <b>' + n + '개</b>' +
        (showBlank ? '를 함께 보고 있습니다.' : '를 접어 두었습니다.') + '</span>' +
      '<button class="btn btn-ghost btn-sm" id="blank-toggle">' +
        (showBlank ? "접기" : "펼쳐 보기") + '</button></div>';
    const b = $("#blank-toggle");
    if (b) b.addEventListener("click", function () { showBlank = !showBlank; render(); });
  }

  /* ── 정렬 ───────────────────────────────────────────────────────────── */
  function applySort(rows) {
    if (!sorts.length) return rows;
    return rows.slice().sort(function (a, b) {
      for (let i = 0; i < sorts.length; i++) {
        const s = sorts[i];
        const va = cellValue(a, s.key), vb = cellValue(b, s.key);
        // 미입력은 정렬 방향과 무관하게 항상 뒤로
        if (va === null && vb === null) continue;
        if (va === null) return 1;
        if (vb === null) return -1;
        let c;
        if (typeof va === "number" && typeof vb === "number") c = va - vb;
        else c = String(va).localeCompare(String(vb));
        if (c !== 0) return c * s.dir;
      }
      return 0;
    });
  }

  function toggleSort(key, additive) {
    const i = sorts.findIndex(s => s.key === key);
    if (additive) {
      if (i > -1) sorts[i].dir *= -1;
      else sorts.push({ key, dir: 1 });
    } else {
      if (i === 0 && sorts.length === 1) sorts[0].dir *= -1;
      else sorts = [{ key, dir: 1 }];
    }
    render();
  }

  /* AI 가 정렬을 제안하고 사용자가 [적용] 을 눌렀을 때 — 화면이 원래
     쓰는 정렬 경로를 그대로 탑니다. AI 전용 정렬을 따로 만들면 컬럼을
     눌렀을 때와 결과가 갈립니다. */
  if (window.AIContext && window.AIContext.registerHook) {
    window.AIContext.registerHook("sort", function (patch) {
      if (!patch || !patch.key) throw new Error("정렬 대상이 없습니다");
      sorts = [{ key: patch.key, dir: patch.dir === 1 ? 1 : -1 }];
      render();
    });
  }

  /* 배치 선택은 "배치 비교" 화면에서만 뜻이 있습니다 — 거기서만 배치를
     골라 넣는 자리가 있기 때문입니다. 다른 조회 단위에서는 훅을 걸지
     않고, 그러면 AI 도 선택을 제안하지 않습니다. 할 수 없는 일에
     [적용] 버튼을 띄우면 눌러도 아무 일이 없고, 사용자는 됐다고
     생각한 채 표를 읽습니다. */
  function syncSelectHook() {
    if (!window.AIContext || !window.AIContext.registerHook) return;
    if (groupBy !== "compare") { window.AIContext.registerHook("select", null); return; }
    window.AIContext.registerHook("select", function (patch) {
      const id = patch && (patch.batchId || patch.label);
      if (!id) throw new Error("선택할 배치가 없습니다");
      /* 화면에 실제로 그려진 후보 칩에 대고 확인합니다. Scope.batches() 는
         Promise 라 여기서는 쓸 수 없고, 무엇보다 "이 화면에서 선택" 은
         지금 보이는 것 기준이어야 합니다. */
      const shown = $$("[data-cmp]").map(b => b.dataset.cmp);
      if (shown.indexOf(id) === -1) {
        throw new Error(id + " 은(는) 지금 화면 범위에 없습니다");
      }
      if (cmpPicked.indexOf(id) === -1) {
        if (cmpPicked.length >= CMP_MAX) cmpPicked.shift();
        cmpPicked.push(id);
      }
      render();
    });
  }

  function applyColFilters(rows) {
    const keys = Object.keys(colFilters).filter(k => colFilters[k]);
    if (!keys.length) return rows;
    return rows.filter(r => keys.every(k => {
      const v = cellValue(r, k);
      if (v === null) return false;
      return String(v).toLowerCase().indexOf(colFilters[k].toLowerCase()) > -1;
    }));
  }

  /* ── 렌더 ───────────────────────────────────────────────────────────── */
  function render() {
    const sel = window.Scope.get();

    if (!sel.scopeId) {
      $("#count").textContent = "과제 미선택";
      $("#table-host").innerHTML =
        '<div class="empty"><div class="empty-title">과제를 선택하세요</div>' +
        '<div class="empty-body">상단 우측 셀렉터에서 선택하면 해당 범위의 데이터만 표시됩니다.</div></div>';
      $("#sample-bar").innerHTML = "";
      if ($("#grid-tools")) $("#grid-tools").innerHTML = "";
      return;
    }

    Promise.all([window.Scope.batches(), window.Repo.getStudies()]).then(function (res) {
      const batches = res[0], studies = res[1];

      /* 배치 비교는 표 구조가 완전히 달라(항목이 행, 배치가 열) 따로 그립니다 */
      if (groupBy === "compare") {
        /* 선택을 여기서 확정해 둡니다. 그리는 쪽에서 임시로 채우면 그 값이
           남지 않아, 사용자가 네 번째 배치를 눌러도 다시 기본값으로 돌아갑니다. */
        cmpPicked = cmpPicked.filter(id => batches.some(b => b.id === id));
        if (cmpPicked.length < 2) {
          cmpPicked = batches.slice(0, Math.min(3, batches.length)).map(b => b.id);
        }
        $("#count").textContent = batches.length + "개 시료 중 " +
          cmpPicked.length + "개 비교 (최대 " + CMP_MAX + ")";
        $("#sample-bar").innerHTML = "";
        $("#sort-chips").innerHTML = "";
        paintGridTools(null, batches);
        $("#table-host").innerHTML = compareView(batches);
        $$("[data-cmp]").forEach(b => b.addEventListener("click", function () {
          const id = b.dataset.cmp;
          const i = cmpPicked.indexOf(id);
          if (i > -1) cmpPicked.splice(i, 1);
          else if (cmpPicked.length < CMP_MAX) cmpPicked.push(id);
          render();
        }));
        return;
      }

      const titerDays = window.DATA_TITER_DAYS.filter(d =>
        batches.some(b => (b.upstream?.titer?.[d] ?? null) !== null));

      const cols = columns(titerDays, { batches: batches });

      let rows = buildRows(batches, studies);
      const blankCount = rows.length - keepMeasured(rows, cols).length;
      if (!showBlank) rows = keepMeasured(rows, cols);
      rows = applyColFilters(rows);
      rows = applySort(rows);

      const sortLabel = window.Repo.SORTS[sel.sort] || window.Repo.SORTS[window.Repo.DEFAULT_SORT];
      const undated = window.Repo.undatedExcluded(sel);
      /* 묶인 줄이 몇 개인지 밝혀 둡니다 — 입력한 열 수와 조회 줄 수가
         다를 때 "하나가 빠졌나" 로 읽히면 안 됩니다. */
      const merged = rows.filter(r => r._parts).length;
      $("#count").textContent = rows.length + "개 시료" +
        (merged ? " · " + merged + "건은 팀 데이터를 한 줄로 묶음" : "") +
        " · " + sortLabel +
        (window.Scope.periodLabel() ? " · " + window.Scope.periodLabel() : "") +
        (undated ? " · 날짜 미기재 " + undated + "건 제외" : "") +
        " · " + (titerDays.length ? "Titer " + titerDays[0] + "~" + titerDays[titerDays.length - 1] : "Titer 미입력");
      paintBlankNote(blankCount);

      paintSampleBar(batches);
      /* 숨긴 컬럼으로 정렬·필터가 걸려 있을 수 있습니다. 보이는 컬럼만
         넘기면 칩에 라벨 대신 내부 키("projectLabel")가 뜨고, 왜 이렇게
         정렬됐는지 읽을 수 없게 됩니다. */
      paintSortChips(columns(titerDays, { all: true, batches: batches }));

      paintGridTools(titerDays, batches);

      /* 폭을 <colgroup> 으로 못박고 table-layout:fixed 를 씁니다.
         자동 배치로 두면 드래그로 폭을 바꿔도 브라우저가 내용에 맞춰 다시
         계산해, 끌어 놓은 자리에 머무르지 않습니다. */
      const totalW = cols.reduce((n, c) => n + widthOf(c), 0);

      $("#table-host").innerHTML = rows.length
        ? '<div class="dgrid' + (grid.dense ? " is-dense" : "") + '">' +
            '<table class="tbl tbl-fixed" style="width:' + totalW + 'px">' +
            '<colgroup>' + cols.map(c =>
              '<col data-cw="' + esc(c.key) + '" style="width:' + widthOf(c) + 'px">').join("") +
            '</colgroup>' +
            '<thead><tr>' + cols.map(function (c) {
              const si = sorts.findIndex(s => s.key === c.key);
              const ind = si > -1
                ? '<span class="sort-ind">' + (sorts[si].dir === 1 ? "▲" : "▼") +
                  (sorts.length > 1 ? '<sub>' + (si + 1) + '</sub>' : "") + '</span>'
                : '<span class="sort-ind sort-ind-off">↕</span>';
              return '<th scope="col">' +
                /* 폭을 좁히면 머리글도 잘립니다 — 전체 이름은 title 로 남깁니다 */
                '<button class="sort-btn" data-sort="' + esc(c.key) + '" ' +
                  'title="' + esc(c.label) + ' — 클릭: 정렬 · Shift+클릭: 정렬 추가" ' +
                  'aria-label="' + esc(c.label) + ' 기준 정렬">' +
                  '<span class="sort-btn-txt">' + esc(c.label) + '</span>' + ind + '</button>' +
                '<input class="col-filter" data-cf="' + esc(c.key) + '" value="' +
                  esc(colFilters[c.key] || "") + '" placeholder="필터" ' +
                  'aria-label="' + esc(c.label) + ' 필터">' +
                /* 경계선 손잡이 — 끌면 폭, 두 번 누르면 내용에 맞춤 */
                '<span class="col-grip" data-grip="' + esc(c.key) + '" role="separator" ' +
                  'aria-orientation="vertical" tabindex="0" ' +
                  'title="끌어서 너비 조절 · 두 번 누르면 내용에 맞춤"></span>' +
              '</th>';
            }).join("") + '</tr></thead>' +
            '<tbody>' + rows.map(function (r) {
              return '<tr>' + cols.map(function (c) {
                const v = cellValue(r, c.key);
                const pin = pinMarkRow(r, c.key);
                if (v === null || v === undefined)
                  return '<td class="na">' + (c.key === "sampleName" ? "(샘플 미생성)" : L.empty) + pin + '</td>';
                const txt = c.type === "n" ? Number(v).toFixed(c.dp) : String(v);
                /* 폭을 좁히면 글자가 잘립니다. 잘린 값을 눈으로만 읽고 넘어가면
                   안 되므로 전체 값을 title 로 남깁니다. */
                return '<td' + (c.type === "n" ? ' class="mono"' : "") +
                  ' title="' + esc(txt) + '">' + esc(txt) + pin + '</td>';
              }).join("") + '</tr>';
            }).join("") +
            '</tbody></table></div>'
        : '<div class="empty"><div class="empty-title">' + esc(L.noResult) + '</div>' +
          '<div class="empty-body">' + esc(L.noResultHint) +
          ' 표 안의 컬럼 필터도 함께 확인하세요.</div></div>';

      wireResize(cols, rows);
      $$("[data-sort]").forEach(b => b.addEventListener("click", e => toggleSort(b.dataset.sort, e.shiftKey)));
      $$("[data-cf]").forEach(function (inp) {
        inp.addEventListener("click", e => e.stopPropagation());
        let t = null;
        inp.addEventListener("input", function () {
          clearTimeout(t);
          const k = inp.dataset.cf, val = inp.value, pos = inp.selectionStart;
          t = setTimeout(function () {
            colFilters[k] = val;
            render();
            const n = document.querySelector('[data-cf="' + k + '"]');
            if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} }
          }, 250);
        });
      });
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     엑셀처럼 다루기 — 밀도 · 너비 · 컬럼 표시

     43개 컬럼을 한 화면에서 훑어야 하는 표입니다. 기본 여백으로는 한 번에
     대여섯 행밖에 안 보여, 배치끼리 견주려면 스크롤을 오르내리며 앞서 본
     숫자를 외우게 됩니다. 그 외움이 곧 오독입니다.
     ══════════════════════════════════════════════════════════════════════ */
  function paintGridTools(titerDays, batches) {
    const host = $("#grid-tools");
    if (!host) return;
    if (groupBy === "compare") {
      /* 비교 표는 항목이 행, 배치가 열이라 컬럼 설정이 의미가 없습니다 */
      host.innerHTML = densityToggle();
      wireDensity(host);
      return;
    }
    const all = columns(titerDays || [], { all: true, batches: batches });
    const hid = hiddenCount(all);

    host.innerHTML = densityToggle() +
      '<button type="button" class="grid-btn" id="grid-fit" ' +
        'title="모든 컬럼 너비를 내용에 맞춥니다">너비 자동 맞춤</button>' +
      '<button type="button" class="grid-btn" id="grid-cols" aria-haspopup="true" ' +
        'aria-expanded="false">컬럼 ⚙' +
        (hid ? '<span class="grid-badge">' + hid + ' 숨김</span>' : "") +
      '</button>';

    wireDensity(host);
    $("#grid-fit").addEventListener("click", () => autoFitAll());
    $("#grid-cols").addEventListener("click", function (e) {
      e.stopPropagation();
      openColumnMenu(this, all);
    });
  }

  function densityToggle() {
    const opt = (v, ko, tip) =>
      '<button type="button" class="grid-seg' + (grid.dense === v ? " is-on" : "") + '" ' +
        'data-dense="' + v + '" aria-pressed="' + (grid.dense === v) + '" ' +
        'title="' + esc(tip) + '">' + ko + '</button>';
    return '<span class="grid-seg-wrap" role="group" aria-label="보기 모드">' +
      opt(true, "콤팩트", "행 간격을 좁혀 한 화면에 더 많이 봅니다") +
      opt(false, "기본", "여유 있는 행 간격") +
    '</span>';
  }
  function wireDensity(host) {
    $$("[data-dense]", host).forEach(b => b.addEventListener("click", function () {
      const next = b.dataset.dense === "true";
      if (grid.dense === next) return;
      grid.dense = next; saveGrid(); render();
    }));
  }

  /* ── 너비 조절 ────────────────────────────────────────────────────────
     끄는 동안에는 화면을 다시 그리지 않습니다. 다시 그리면 붙잡고 있던
     손잡이가 사라져 마우스를 놓을 때까지 따라오지 않습니다. <col> 의 폭만
     바꾸고, 놓을 때 한 번 저장합니다. */
  const COL_MIN = 56, COL_MAX = 480;

  function wireResize(cols, rows) {
    const host = $("#table-host");
    if (!host) return;
    const table = host.querySelector(".tbl-fixed");
    if (!table) return;
    const colOf = key => table.querySelector('col[data-cw="' + key + '"]');

    function setW(key, px) {
      const w = Math.max(COL_MIN, Math.min(COL_MAX, Math.round(px)));
      const el = colOf(key);
      if (el) el.style.width = w + "px";
      grid.width[key] = w;
      return w;
    }
    function retotal() {
      table.style.width = cols.reduce((n, c) => n + widthOf(c), 0) + "px";
    }

    $$("[data-grip]", host).forEach(function (grip) {
      const key = grip.dataset.grip;

      grip.addEventListener("mousedown", function (e) {
        e.preventDefault(); e.stopPropagation();
        const startX = e.clientX;
        const startW = widthOf(cols.find(c => c.key === key) || { w: 100 });
        document.body.classList.add("is-colresize");
        grip.classList.add("is-drag");

        function move(ev) { setW(key, startW + (ev.clientX - startX)); retotal(); }
        function up() {
          document.removeEventListener("mousemove", move);
          document.removeEventListener("mouseup", up);
          document.body.classList.remove("is-colresize");
          grip.classList.remove("is-drag");
          saveGrid();
        }
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
      });

      /* 두 번 누르면 이 컬럼만 내용에 맞춥니다 */
      grip.addEventListener("dblclick", function (e) {
        e.preventDefault(); e.stopPropagation();
        const c = cols.find(x => x.key === key);
        if (!c) return;
        setW(key, measureCol(c, rows));
        retotal(); saveGrid();
      });

      /* 마우스가 없어도 조절할 수 있어야 합니다 */
      grip.addEventListener("keydown", function (e) {
        const step = e.shiftKey ? 24 : 8;
        if (e.key === "ArrowLeft")  { e.preventDefault(); setW(key, widthOf(cols.find(c => c.key === key)) - step); retotal(); saveGrid(); }
        if (e.key === "ArrowRight") { e.preventDefault(); setW(key, widthOf(cols.find(c => c.key === key)) + step); retotal(); saveGrid(); }
        if (e.key === "Enter") {
          e.preventDefault();
          const c = cols.find(x => x.key === key);
          if (c) { setW(key, measureCol(c, rows)); retotal(); saveGrid(); }
        }
      });
    });
  }

  /* 내용에 맞는 폭 — 캔버스로 글자 너비를 잽니다.
     table-layout:fixed 에서는 "자연 너비" 를 브라우저에 물을 수 없고, 잠깐
     auto 로 되돌려 재면 화면이 한 번 출렁입니다. */
  let measureCtx = null;
  function textWidth(s, font) {
    if (!measureCtx) {
      const cv = document.createElement("canvas");
      measureCtx = cv.getContext ? cv.getContext("2d") : null;
    }
    if (!measureCtx) return String(s).length * 7;      /* 캔버스가 없으면 어림 */
    measureCtx.font = font;
    return measureCtx.measureText(String(s)).width;
  }
  /* ★ 머리글 길이가 아니라 **값** 길이에 맞춥니다.

     자동 맞춤이 머리글까지 다 담으려 하면 표가 오히려 넓어집니다 —
     "N-glycan Afucosylated form" 은 스물여섯 자인데 그 아래 값은 늘
     "12.3" 넉 자입니다. 스물여섯 자에 맞춘 컬럼이 마흔세 개면 자동
     맞춤을 누를수록 가로로 길어집니다.

     그래서 머리글은 넘치면 말줄임으로 자르고(전체 이름은 마우스를 올리면
     보입니다), 폭은 값이 정하게 합니다. 정렬 화살표와 필터 칸이 들어갈
     자리만 바닥으로 둡니다. */
  const COL_FIT_FLOOR = 64;

  function measureCol(c, rows) {
    const cs = getComputedStyle(document.body);
    const bodyFont = "12px " + (c.type === "n"
      ? (cs.getPropertyValue("--font-data") || "monospace")
      : cs.fontFamily);

    let w = COL_FIT_FLOOR;
    (rows || []).forEach(function (r) {
      const v = cellValue(r, c.key);
      const s = (v === null || v === undefined)
        ? L.empty
        : (c.type === "n" ? Number(v).toFixed(c.dp) : String(v));
      const t = textWidth(s, bodyFont) + 20;
      if (t > w) w = t;
    });
    return Math.max(COL_MIN, Math.min(COL_MAX, Math.ceil(w)));
  }
  function autoFitAll() {
    Promise.all([window.Scope.batches(), window.Repo.getStudies()]).then(function (res) {
      const batches = res[0], studies = res[1];
      const titerDays = window.DATA_TITER_DAYS.filter(d =>
        batches.some(b => (b.upstream?.titer?.[d] ?? null) !== null));
      const cols = columns(titerDays, { batches: batches });
      const rows = applySort(applyColFilters(buildRows(batches, studies)));
      cols.forEach(c => { grid.width[c.key] = measureCol(c, rows); });
      saveGrid();
      render();
    });
  }

  /* ── 컬럼 표시 / 숨기기 ──────────────────────────────────────────────
     43개 중 과제 · Study · 팀처럼 모든 행에서 같은 값이 반복되는 컬럼이
     있습니다. 그것만 치워도 화면이 한참 넓어집니다. */
  let colMenu = null;
  function closeColumnMenu() {
    if (!colMenu) return;
    colMenu.remove(); colMenu = null;
    const b = $("#grid-cols");
    if (b) b.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onMenuKey, true);
  }
  function onDocClick(e) { if (colMenu && !colMenu.contains(e.target)) closeColumnMenu(); }
  function onMenuKey(e) { if (e.key === "Escape") { e.preventDefault(); closeColumnMenu(); } }

  function openColumnMenu(anchor, all) {
    if (colMenu) { closeColumnMenu(); return; }
    anchor.setAttribute("aria-expanded", "true");

    const shownN = all.filter(c => !grid.hidden[c.key]).length;
    colMenu = document.createElement("div");
    colMenu.className = "pop col-menu";
    colMenu.innerHTML =
      '<div class="col-menu-head">' +
        '<b>컬럼 표시</b><span>' + shownN + ' / ' + all.length + '</span>' +
      '</div>' +
      '<div class="col-menu-acts">' +
        '<button type="button" class="grid-btn btn-xs" data-cm="all">모두 표시</button>' +
        '<button type="button" class="grid-btn btn-xs" data-cm="ids">식별 컬럼만</button>' +
        '<button type="button" class="grid-btn btn-xs" data-cm="reset">너비도 초기화</button>' +
      '</div>' +
      '<div class="col-menu-list">' +
        all.map(c =>
          '<label class="col-menu-row">' +
            '<input type="checkbox" data-colvis="' + esc(c.key) + '"' +
              (grid.hidden[c.key] ? "" : " checked") + '>' +
            '<span>' + esc(c.label) + '</span>' +
          '</label>').join("") +
      '</div>' +
      '<p class="col-menu-foot">숨긴 컬럼도 값은 그대로 있습니다 — ' +
        'CSV 로 내보낼 때 포함할지 묻습니다.</p>';
    document.body.appendChild(colMenu);

    const r = anchor.getBoundingClientRect();
    colMenu.style.top = Math.min(r.bottom + 6, window.innerHeight - 380) + "px";
    colMenu.style.left = Math.max(8,
      Math.min(r.right - 260, window.innerWidth - 272)) + "px";

    $$("[data-colvis]", colMenu).forEach(cb => cb.addEventListener("change", function () {
      if (cb.checked) delete grid.hidden[cb.dataset.colvis];
      else grid.hidden[cb.dataset.colvis] = true;
      saveGrid();
      /* 목록은 열어 둔 채 표만 다시 그립니다 — 하나 끌 때마다 창이 닫히면
         여러 개를 치우는 데 그만큼 다시 열어야 합니다. */
      const keep = colMenu;
      render();
      if (keep && !keep.isConnected) document.body.appendChild(keep);
    }));

    $$("[data-cm]", colMenu).forEach(b => b.addEventListener("click", function () {
      const what = b.dataset.cm;
      if (what === "all") grid.hidden = {};
      if (what === "ids") ["projectLabel", "studyName", "teamLabel"]
        .forEach(k => { grid.hidden[k] = true; });
      if (what === "reset") { grid.width = {}; grid.hidden = {}; }
      saveGrid();
      closeColumnMenu();
      render();
    }));

    setTimeout(function () {
      document.addEventListener("click", onDocClick, true);
      document.addEventListener("keydown", onMenuKey, true);
    }, 0);
  }

  function paintSortChips(cols) {
    const host = $("#sort-chips");
    /* 숨긴 컬럼이면 그렇다고 적습니다 — 표에 없는 컬럼으로 정렬·필터가
       걸려 있으면, 왜 이 순서인지 화면 어디에도 단서가 없습니다. */
    const labelOf = k => ((cols.find(c => c.key === k) || {}).label || k) +
      (grid.hidden[k] ? " (숨김)" : "");
    const filterKeys = Object.keys(colFilters).filter(k => colFilters[k]);
    if (!sorts.length && !filterKeys.length) { host.innerHTML = ""; return; }

    host.innerHTML =
      sorts.map((s, i) =>
        '<span class="chip"><span class="chip-k">정렬 ' + (i + 1) + '</span>' +
          esc(labelOf(s.key)) + (s.dir === 1 ? " ▲" : " ▼") +
          '<button class="chip-x" data-unsort="' + esc(s.key) + '" aria-label="정렬 해제">' +
          '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
          'stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></span>').join("") +
      filterKeys.map(k =>
        '<span class="chip"><span class="chip-k">필터</span>' + esc(labelOf(k)) + ': ' + esc(colFilters[k]) +
          '<button class="chip-x" data-unfilter="' + esc(k) + '" aria-label="필터 해제">' +
          '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
          'stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></span>').join("");

    /* 정렬을 모두 풀면 조회 조건의 정렬로 되돌아갑니다 */
    $$("[data-unsort]").forEach(b => b.addEventListener("click", () => {
      sorts = sorts.filter(s => s.key !== b.dataset.unsort);
      render();
    }));
    $$("[data-unfilter]").forEach(b => b.addEventListener("click", () => {
      delete colFilters[b.dataset.unfilter]; render();
    }));
  }

  /* ── Sample 추가 줄을 없앴습니다 ──────────────────────────────────────
     시료를 만드는 길은 Data 입력 표의 [시료 추가 →] 하나뿐입니다.

     여기에도 만드는 버튼이 있으면, 값이 하나도 없는 시료가 조회 화면에서
     생길 수 있습니다 — 조회 화면은 "무엇이 들어 있나" 를 보는 곳이지
     만드는 곳이 아닙니다. 그리고 두 길이 서로 다른 모양의 레코드를 만들면
     (여기서는 담을 그릇이 정해지지 않습니다) 어느 쪽으로 만들었는지에
     따라 값이 들어갈 자리가 달라집니다. */
  function paintSampleBar() {
    const host = $("#sample-bar");
    if (host) host.innerHTML = "";
  }

  /* ── Data 분류 빠른 선택 ────────────────────────────────────────────────
     상단 셀렉터의 "Data 분류" 드롭다운과 **같은 상태**를 씁니다.
     한쪽에서 고르면 다른 쪽도 함께 바뀝니다 — 필터가 두 개로 보이면
     어느 쪽이 적용된 건지 알 수 없게 됩니다. */
  function paintClassFilter() {
    const host = $("#group-filter");
    if (!host) return;
    const sel = window.Scope.get();
    const list = [{ id: null, label: "전체 항목" }]
      .concat(window.Repo.getDataClasses(sel.team).map(c => ({ id: c.id, label: c.label })));

    /* 고른 것이 어느 것인지 인라인 style 이 아니라 클래스로 표시합니다.
       인라인이면 상태가 문자열 안에 숨어 있어, 눌렀는데 안 바뀌는지
       눌리지 않은 것인지 화면에서도 코드에서도 구분이 안 됩니다.
       aria-pressed 로 화면 낭독기에도 같은 사실이 전달됩니다. */
    host.innerHTML = list.map(function (c) {
      const on = sel.dataClass === c.id;
      return '<button type="button" class="cls-chip' + (on ? " is-on" : "") + '" ' +
        'data-g="' + esc(c.id || "") + '" aria-pressed="' + on + '">' +
        esc(c.label) + '</button>';
    }).join("");

    /* 문서 전체가 아니라 이 줄 안에서만 찾습니다 — 다른 화면 요소가 같은
       data-g 를 쓰게 되면 그쪽까지 필터 버튼으로 잡힙니다. */
    $$("[data-g]", host).forEach(b => b.addEventListener("click", function () {
      /* 같은 것을 다시 누르면 전체로 되돌립니다 — 되돌릴 길이 [전체 항목]
         하나뿐이면, 좁혀 놓고 원래대로 오는 방법을 찾게 됩니다. */
      const next = b.dataset.g || null;
      window.Scope.setFilter({ dataClass: sel.dataClass === next ? null : next });
    }));
  }

  /* ── CSV ──────────────────────────────────────────────────────────────

     ★ 이 파일은 보고서에 그대로 붙습니다.

     화면에는 생성값 ◇ 표식과 "검증 필요 N건 제외" 가 붙어 있지만, 예전에는
     CSV 에 아무것도 따라가지 않았습니다. 파일이 나가는 순간 그 표시가
     전부 사라져, 받는 사람은 43개 컬럼이 전부 실측인 줄 압니다.
     화면에서 막아 놓고 파일로 새게 두면 막은 것이 아닙니다.

     그래서 세 가지를 함께 씁니다.
       1) 파일 맨 위 고지 블록 — 출처 · 스캔 전사 경고 · 생성값 · 검증 필요
       2) 컬럼 이름에 붙는 표식 — 컬럼 하나만 복사해 가도 따라갑니다
       3) 행마다 "검증 필요 항목" 열 — 어느 배치의 어느 값인지

     숫자 자체는 건드리지 않습니다. 셀에 기호를 섞으면 Excel 에서 수치가
     아니게 되어, 받는 사람이 계산을 못 합니다 — 그건 다른 종류의 손해입니다.
     ────────────────────────────────────────────────────────────────────── */

  /* 화면·봇과 같은 판정을 씁니다. 두 곳이 다른 기준을 쓰면 언젠가 어긋나고,
     어긋난 쪽이 파일이면 아무도 모릅니다. */
  function provenanceOf() {
    const P = window.Provenance;
    if (!P || !window.AskTables) return null;
    const t = window.AskTables.internal();
    const gen = {}, unv = {};
    t.columns.forEach(function (c) { if (c.generated) gen[c.label] = true; });
    t.rows.forEach(function (r) {
      if (!r.__unverified) return;
      unv[r.__label] = t.columns
        .filter(c => r.__unverified[c.key] && typeof r[c.key] === "number")
        .map(c => c.label);
    });
    return { P: P, genLabels: Object.keys(gen), unvByBatch: unv, table: t };
  }

  /* 컬럼 라벨이 생성값 컬럼인가 — data-page 의 라벨과 AskTables 의 라벨은
     표기가 조금 다릅니다("정제 Total Yield" vs "Total Yield"). 끝말로 봅니다. */
  function isGeneratedLabel(label, genLabels) {
    const s = String(label);
    return genLabels.some(g => s === g || s.endsWith(" " + g));
  }

  function exportCSV() {
    Promise.all([window.Scope.batches(), window.Repo.getStudies()]).then(function (res) {
      const batches = res[0], studies = res[1];
      const titerDays = window.DATA_TITER_DAYS.filter(d => batches.some(b => (b.upstream?.titer?.[d] ?? null) !== null));

      /* ★ 화면에서 숨긴 컬럼을 파일에도 뺄지 묻습니다.

         묻지 않고 한쪽으로 정하면 어느 쪽이든 조용히 틀립니다. 화면대로
         빼면 어제 숨긴 것을 잊은 채 내보내 컬럼이 빠진 파일이 나가고,
         무조건 다 넣으면 일부러 추린 줄 알았던 사람이 전체 컬럼을 받습니다.
         받는 사람은 둘 다 알 길이 없으므로, 내보내는 사람이 한 번 정합니다. */
      const allCols = columns(titerDays, { all: true, batches: batches });
      const hid = allCols.filter(c => grid.hidden[c.key]);
      let cols = columns(titerDays, { batches: batches });
      if (hid.length) {
        const take = window.confirm(
          "화면에서 숨긴 컬럼이 " + hid.length + "개 있습니다.\n" +
          hid.slice(0, 8).map(c => "· " + c.label).join("\n") +
          (hid.length > 8 ? "\n· … 외 " + (hid.length - 8) + "개" : "") +
          "\n\n[확인] 숨긴 컬럼까지 모두 내보냅니다\n" +
          "[취소] 화면에 보이는 컬럼만 내보냅니다");
        if (take) cols = allCols;
      }

      let rows = applySort(applyColFilters(buildRows(batches, studies)));
      const q = v => {
        if (v === null || v === undefined) return "";
        const s = String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };

      const pv = provenanceOf();
      const genLabels = pv ? pv.genLabels : [];
      const genInFile = cols.filter(c => isGeneratedLabel(c.label, genLabels)).map(c => c.label);

      /* 이 파일에 실제로 들어간 배치 중 검증 필요가 걸린 것 */
      /* 묶인 줄은 그릇이 여럿입니다 — 한쪽만 보면 정제 그릇에 걸린
         검증 필요 표시가 파일에서 빠집니다. */
      const unvOf = function (r) {
        const out = [];
        rowIds(r).concat(r.expNo ? [r.expNo] : []).forEach(function (id) {
          (pv.unvByBatch[id] || []).forEach(function (x) {
            if (out.indexOf(x) === -1) out.push(x);
          });
        });
        return out;
      };

      const unvRows = [];
      if (pv) {
        rows.forEach(function (r) {
          const list = unvOf(r);
          if (list.length) unvRows.push({ id: rowIds(r).join("+") || r.id, items: list });
        });
      }

      /* 1) 고지 블록 — 컬럼 머리 위에 놓습니다. Excel 에서도 그대로 보입니다. */
      const head = [];
      if (pv) {
        head.push([q("※ 이 파일을 인용하기 전에 읽어 주세요")]);
        head.push([q("출처"), q(pv.P.SOURCE.file + " / " + pv.P.SOURCE.sheet +
          " — 스캔 이미지 전사본")]);
        head.push([q("원본 비고"), q("스캔 화질로 인한 판독 오차 가능성이 있어 " +
          "중요한 수치는 원본과 대조 확인이 필요합니다")]);
        head.push([q("생성값 (실측 아님)"), q(genInFile.length
          ? genInFile.join(" · ") + " — " + pv.P.GENERATED_WHY
          : "이 파일에 없음")]);
        head.push([q("검증 필요"), q(unvRows.length
          ? unvRows.length + "개 시료(" + unvRows.map(x => x.id).join(" · ") +
            ")가 여러 항목에서 동시에 같은 값입니다. 원본 스캔과 대조 전까지 " +
            "통계에 넣지 마세요. 해당 항목은 행 끝 \"검증 필요 항목\" 열에 적었습니다."
          : "이 파일에 없음")]);
        head.push([q("내보낸 시각"), q(window.Entries.stamp()),
                   q("행 수"), q(rows.length)]);
        head.push([""]);
      }

      /* 2) 컬럼 이름에 표식 — 컬럼 하나만 복사해 가도 따라갑니다 */
      const label = c => isGeneratedLabel(c.label, genLabels)
        ? c.label + " [생성값·실측아님]" : c.label;

      const lines = head.map(a => a.join(","));
      const extra = pv ? [q("검증 필요 항목")] : [];
      lines.push(cols.map(c => q(label(c))).concat(extra).join(","));

      /* 3) 행마다 어느 값이 검증 필요인지 */
      rows.forEach(function (r) {
        const cells = cols.map(c => q(cellValue(r, c.key)));
        if (pv) {
          const list = unvOf(r);
          cells.push(q(list.length ? list.join(" · ") : ""));
        }
        lines.push(cells.join(","));
      });

      const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "batch_data_" + window.Entries.stamp().slice(0, 10) + ".csv";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      /* 내보낸 직후에도 한 번 말해 줍니다 — 파일을 열기 전에 알아야
         보고서에 붙이기 전에 확인합니다 */
      toast(rows.length + "행을 CSV로 내보냈습니다." +
        (genInFile.length ? " 생성값 " + genInFile.length + "개 항목" : "") +
        (unvRows.length ? " · 검증 필요 " + unvRows.length + "개 시료" : "") +
        ((genInFile.length || unvRows.length) ? " — 파일 맨 위 고지를 확인하세요." : ""));
    });
  }

  function toast(msg) {
    const t = $("#toast");
    t.innerHTML = '<div class="card" style="border-left:3px solid var(--c-ok);padding:var(--s-3) var(--s-4);' +
      'font-size:13px">' + esc(msg) + '</div>';
    t.style.display = "block";
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.style.display = "none"; }, 3000);
  }

  /* 조회 바가 아니라 대상 선택만 둡니다. 큰 박스가 표를 화면 아래로
     밀어내고 있었습니다 — 이 화면의 본체는 표입니다.
     좁히는 일은 표 안의 컬럼 필터와 정렬 머리글, 그리고 AI 어시스턴트의
     필터 제안으로 합니다. */
  window.StudySelector.mount($("#selector"), { mode: "pick" });
  window.Scope.subscribe(function (sel, reason) {
    paintClassFilter();
    /* [조회]·[초기화]·과제 전환으로 조건이 새로 적용되면 직접 건 컬럼 정렬을
       풀고 조회 정렬(기본 최신 날짜순)로 되돌립니다. */
    if (reason === "apply" || reason === "reset-filters" || reason === "scope") sorts = [];
    render();
  });
  window.Entries.subscribe(render);

  /* 다른 탭에서 바뀐 것 · 레코드가 늘어난 것도 받습니다 —
     값 변경은 Entries 가, Study·Batch 추가는 Repo 가 알려 줍니다. */
  if (window.Repo && window.Repo.subscribe) {
    window.Repo.subscribe(function (what) {
      if (what === "remote" || what === "dataset") render();
    });
  }
  $("#export").addEventListener("click", exportCSV);
  paintClassFilter();
  syncSelectHook();
  render();
})();
