/* ==========================================================================
   Data 입력

   대상 지정 순서: 과제 → Study → 팀 → Sample
     · Study 를 고르기 전에는 팀을 고를 수 없습니다 (계층 순서)
     · 팀을 고르기 전에는 입력 표가 열리지 않습니다

   ── 표의 열 하나가 Sample 하나입니다 ────────────────────────────────────
   예전에는 Batch 를 고르고, 그 안에서 시료를 고르고, 열은 "일자 · 차수 ·
   조건" 같은 자유 축이었습니다. 단위가 셋(Batch · Sample · 열)이나 되는데
   값이 어디에 붙는지는 조합마다 달랐습니다 — 같은 숫자가 배치에 붙기도
   하고 시료에 붙기도 했고, 조회 화면에서는 한 줄로 묶여 어느 열의 값인지
   알 수 없었습니다.

   이제 단위는 **Sample 하나**입니다.

       열을 하나 더하면   → 시료 하나가 생깁니다
       머리글을 고치면    → 그 시료의 이름이 바뀝니다
       열을 지우면        → 그 시료가 비활성이 됩니다 (값·이력은 남습니다)

   버튼으로 만드는 길은 없앴습니다. 표에 적은 것만이 데이터입니다.

   ── 값이 들어가는 자리 ──────────────────────────────────────────────────
   시료마다 값을 담는 그릇(hidden batch)이 1:1 로 붙습니다. 값의 주소는
   예전과 똑같이 batch:<그릇id>|<항목키> 입니다. 그래서 대시보드 · 차트 ·
   데이터 조회 · CSV · DoE · AI 가 지나는 Repo.valueOf 를 한 줄도 고치지
   않고, "열 하나 = 조회 화면의 독립된 한 줄" 이 그대로 성립합니다.

   그릇은 사용자에게 보이지 않습니다. 화면에서 "Batch" 라는 말은 없습니다.

   ── 저장 전 단계 (드래프트) ─────────────────────────────────────────────
   표에 적은 값은 [전체 저장] 을 눌러야 DB 로 갑니다. 그전까지는 이 브라우저
   에만 머물고, 몇 번 고쳐도 변경 이력이 남지 않습니다 — 처음 옮겨 적는
   동안의 오타가 감사 이력을 가득 채우는 것을 막습니다.

   저장된 뒤에 고치는 것은 "기록을 고치는 일" 이므로, 그때만 사유를 받고
   이전 값을 이력으로 쌓습니다 (ALCOA+).

   적다 만 내용은 이 브라우저에 자동 보관합니다 — 탭을 닫아도 남습니다.
   ========================================================================== */

(function () {
  "use strict";

  const user = window.Shell.mount({ page: "ebr" });
  if (!user) return;

  const L = window.LABELS, E = window.Entries;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  /* 열(=시료)은 Study · 팀에서 그때그때 읽습니다. 지금 무엇에 적는지는
     Scope 에 있으므로, 이 화면이 따로 들고 있을 상태가 없습니다. */


  /* "form" = 팀 서식 입력 · "requests" = 분석 및 시료 관리
     대시보드 카드에서 ebr.html#requests 로 바로 들어옵니다 (딥링크) */
  let mode = (location.hash || "").replace("#", "") === "requests" ? "requests" : "form";

  /* ── AI 에게 지금 무엇을 입력 중인지 알려 줍니다 ──────────────────────
     값을 복사해 넘기지 않고 함수로 넘깁니다 — 복사하면 그 순간의 사본이
     되어, 사용자가 다른 배치로 옮겨도 AI 는 옛 배치를 봅니다.

     ★ 입력 중인(저장 전) 값은 넘기지 않습니다. 저장되지 않은 값은 아직
       공식 기록이 아니고, 다른 사람은 볼 수도 없습니다. AI 가 그것을
       조회 결과에 섞으면 저장된 값과 구분되지 않습니다.

     ★ 등록은 mode 선언 뒤에 둡니다. provide() 는 곧바로 구독자에게
       변경을 알리고, 그 구독자가 이 함수를 부릅니다 — 선언보다 앞에
       두면 초기화 전 변수를 읽어 화면 전체가 멈춥니다. */
  if (window.AIContext) {
    window.AIContext.provide("experiment", function () {
      const sel = window.Scope.get();
      if (!sel.studyId) return null;
      const s = (window.DATA_STUDIES || []).find(x => x.id === sel.studyId);
      return s ? s.name : sel.studyId;
    });
    window.AIContext.provide("ebr", function () {
      const sel = window.Scope.get();
      /* ★ 세어 보는 것은 try 안에 둡니다. provide() 는 등록하는 순간
         구독자에게 알리고, 그 구독자가 이 함수를 부릅니다 — 아래쪽 상수들이
         아직 초기화되기 전입니다. 여기서 터지면 화면 전체가 멈춥니다. */
      let n = 0;
      try { if (sel.studyId && sel.team) n = allCols(sel.studyId, sel.team).length; }
      catch (e) { n = 0; }
      return { studyId: sel.studyId || null, team: sel.team || null, mode: mode,
               시료수: n, 입력중: !!(sel.studyId && sel.team) };
    });
  }
  let reqTab = "queue";     // "queue" | "storage"
  let reqOpen = null;
  let reqFilter = "open";

  /* ── 팀별 필드 세트 ───────────────────────────────────────────────────
     측정 항목은 **전부 studies.js 의 스키마에서 읽습니다.** 화면에 따로
     적어 두면 지표를 바꿀 때 이 화면만 옛 항목을 보여 줍니다 — 실제로
     upstream 이 그랬습니다. 지표를 재설정했는데 Data 입력에는 Titer HCCF 와
     qP 가 그대로 남아 있었고, 조회·대시보드와 서로 다른 항목을 보여 주는
     상태였습니다.

     키는 Repo.fieldKey 가 정합니다 — 여기서 다시 규칙을 적으면 또 갈립니다.

     기록 칸(Harvest 일자 · Resin · 특이사항)만 화면 고유로 남깁니다.
     측정값이 아니라 이 화면에서만 적는 메모이기 때문입니다. */
  function schemaFields(team) {
    const fk = (gid, k) => (window.Repo ? window.Repo.fieldKey(gid, k) : gid + "_" + k);
    return (window.DATA_ANALYTE_GROUPS || [])
      .filter(g => g.team === team && !g.empty && (g.items || []).length)
      .map(g => ({ g: g.label, items: g.items.map(it => ({
        k: fk(g.id, it.key), label: it.label, unit: it.unit, dp: it.dp,
        src: [g.id, it.key], spec: team === "analytics"
      })) }));
  }

  /* 일자별 Titer — DATA_TITER_DAYS 를 쓸 때만 나타납니다 (기본은 안 씀) */
  function titerDayFields() {
    const days = (window.DATA_TITER_DAYS || []).filter(d =>
      (window.DATA_BATCHES || []).some(b => (b.upstream?.titer?.[d] ?? null) !== null));
    if (!days.length) return [];
    const ti = window.DATA_TITER_ITEM || { unit: "mg/L", dp: 0 };
    return [{ g: "Titer (일자별)", items: days.map(d => ({
      k: "titer_" + d, label: "Titer " + d, unit: ti.unit, dp: ti.dp, src: ["titer", d] })) }];
  }

  const FIELDS = {
    upstream: function () {
      return schemaFields("upstream")
        .concat(titerDayFields())
        .concat([{ g: "Harvest", items: [
          { k: "harvestDate", label: "Harvest 일자", unit: "", type: "date", src: ["meta","endDate"] }
        ]}]);
    },
    downstream: function () {
      return schemaFields("downstream").concat([{ g: "정제 기록", items: [
        { k: "dsResin", label: "Resin",    unit: "", type: "text" },
        { k: "dsNote",  label: "특이사항", unit: "", type: "text" }
      ]}]);
    },
    analytics: function () { return schemaFields("analytics"); }
  };

  /* ══════════════════════════════════════════════════════════════════════
     열 = 시료

     보이는 열은 두 가지입니다.

       저장된 열   시료 레코드가 있고, 값 담는 그릇(hidden batch)도 있습니다
       저장 전 열  아직 아무것도 만들지 않았습니다 — 이 브라우저에만 있습니다

     "열추가 →" 는 저장 전 열만 만듭니다. 레코드는 [전체 저장] 때,
     그 열에 **값이 하나라도 적혀 있을 때만** 생깁니다. 빈 열을 열어 두고
     그만두면 아무것도 남지 않습니다 — 버튼을 누른 흔적이 데이터가 되면
     이름 없는 빈 시료가 목록에 쌓입니다.
     ══════════════════════════════════════════════════════════════════════ */
  const NEWCOL_KEY = "hub.ebr.newcols";    /* 저장 전 열 — 이 브라우저 */
  const DRAFT_KEY  = "hub.ebr.draft";      /* 저장 전 값 — 이 브라우저 */

  function pairKey(studyId, team) { return studyId + "|" + team; }

  /* 저장된 열 — 이 Study · 팀의 그릇을 만든 순서대로.
     시료가 아직 없는 그릇(지표 재설정 전에 만든 Batch)도 한 열로 보여
     줍니다. 안 보여 주면 거기 적어 둔 값이 화면에서 사라지고, 사용자는
     지워진 줄 압니다 — 값은 그대로 있는데 닿을 길만 없어지는 셈입니다. */
  function savedCols(studyId, team) {
    const out = [];
    (window.DATA_BATCHES || []).forEach(function (b) {
      if (!b || b.studyId !== studyId || b.team !== team) return;
      if (b.active === false) return;
      const s = (window.Repo.samplesOfBatch(b.id) || [])[0] || null;
      /* ★ 시료를 비활성으로 돌린 그릇은 열에서 내립니다.

         이게 없으면 열을 내려도 사라지지 않습니다 — 시료가 없는 그릇은
         expNo 를 이름 삼아 다시 그려지기 때문입니다. 내렸는데 그대로 있으면
         사용자는 한 번 더 누르고, 그래도 그대로이니 고장으로 봅니다. */
      if (!s && E.inactiveSamples(b.id).length) return;
      out.push({
        id: s ? s.id : "bx:" + b.id,
        bid: b.id,
        sid: s ? s.id : null,
        name: s ? s.name : (b.expNo || b.id),
        sub: s ? (s.stage || "") : "",
        at: (s && s.createdAt) || b.createdAt || "",
        saved: true
      });
    });
    out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    return out;
  }

  function newCols(studyId, team) {
    const m = window.Persist.getLocalJSON(NEWCOL_KEY, {}) || {};
    return (m[pairKey(studyId, team)] || []).map(c => ({
      id: c.cid, bid: null, sid: null, name: c.name, sub: c.sub || "",
      at: c.cid, saved: false
    }));
  }
  function saveNewCols(studyId, team, list) {
    const m = window.Persist.getLocalJSON(NEWCOL_KEY, {}) || {};
    if (list && list.length) m[pairKey(studyId, team)] = list;
    else delete m[pairKey(studyId, team)];
    window.Persist.setLocalJSON(NEWCOL_KEY, m);
  }

  /* 표가 아예 빈 상태로 열리지 않도록 한 열은 늘 있습니다. 이 한 열은
     **아무 데도 적어 두지 않습니다** — 화면을 여는 것만으로 저장소가
     바뀌면, 열어 본 적 없는 조합까지 기록이 생깁니다. */
  function allCols(studyId, team) {
    const list = savedCols(studyId, team).concat(newCols(studyId, team));
    if (list.length) return list;
    return [{ id: "new-1", bid: null, sid: null, name: "시료 1", sub: "", at: "",
              saved: false, bare: true }];
  }

  /* ── 저장 전 값 ───────────────────────────────────────────────────────
     { "<열id>::<항목키>": 적은 글자 }. 이 브라우저에만 둡니다 — 아직
     기록이 아니라서 남에게 보일 것이 아니고, 서버로 보내면 "저장했다" 와
     구분되지 않습니다. */
  let pend = {};
  let pendPair = null;

  function loadPend(studyId, team) {
    const k = pairKey(studyId, team);
    if (pendPair === k) return;
    const m = window.Persist.getLocalJSON(DRAFT_KEY, {}) || {};
    pend = (m[k] && typeof m[k] === "object") ? m[k] : {};
    pendPair = k;
  }
  function savePend() {
    if (!pendPair) return;
    const m = window.Persist.getLocalJSON(DRAFT_KEY, {}) || {};
    if (Object.keys(pend).length) m[pendPair] = pend;
    else delete m[pendPair];
    window.Persist.setLocalJSON(DRAFT_KEY, m);
  }
  function pendCount() { return Object.keys(pend).length; }

  /* ── 갈 곳이 없어진 저장 전 내용 치우기 ───────────────────────────────
     저장 전 값과 열은 <studyId>|<팀> 으로 묶여 있습니다. 그 Study 가 사라지면
     (중앙 DB 를 비웠거나 다른 사람이 지웠거나) 그 묶음은 **저장할 길이
     없습니다** — 화면에 닿지도 않고, [전체 저장] 을 눌러도 갈 곳이 없습니다.

     ★ 통째로 지우지 않습니다. 저장 전 내용은 아직 기록이 아닐 뿐 사용자가
       친 것입니다. 지금 적고 있는 Study 의 것까지 지우면, 비우기 한 번에
       남의 작업이 날아갑니다. 갈 곳이 없어진 것만 치웁니다.

     ★ 서버 사본이 도착하기 전에는 하지 않습니다. 그때는 Study 목록이 아직
       비어 있어서, 멀쩡한 것까지 "없어진 Study" 로 보입니다. */
  function pruneOrphanDrafts() {
    if (window.Persist && window.Persist.ready && !window.Persist.ready()) return;
    const alive = {};
    (window.DATA_STUDIES || []).forEach(function (s) { if (s && s.id) alive[s.id] = true; });

    [DRAFT_KEY, NEWCOL_KEY].forEach(function (key) {
      const m = window.Persist.getLocalJSON(key, {}) || {};
      let dropped = 0;
      Object.keys(m).forEach(function (pair) {
        const studyId = pair.slice(0, pair.lastIndexOf("|"));
        if (!alive[studyId]) { delete m[pair]; dropped++; }
      });
      if (dropped) {
        window.Persist.setLocalJSON(key, m);
        if (window.console && console.info) {
          console.info("[EBR] 없어진 Study 의 저장 전 내용 " + dropped + "묶음을 치웠습니다");
        }
      }
    });
    /* 메모리에 들고 있던 것도 같이 — 안 그러면 다음 저장에서 되살아납니다 */
    if (pendPair && !alive[pendPair.slice(0, pendPair.lastIndexOf("|"))]) {
      pend = {}; pendPair = null;
    }
  }

  /* ── 렌더 ──────────────────────────────────────────────────────────────
     폼 렌더는 배치를 비동기로 받아 그립니다. 그 사이에 다른 렌더가 시작되면
     먼저 시작한 쪽이 나중에 끝나 화면을 덮어씁니다 — 의뢰를 등록하자마자
     큐로 넘어가야 하는데 폼이 다시 그려지는 식입니다.
     그래서 렌더마다 번호를 붙이고, 결과가 돌아왔을 때 내가 최신인지 확인합니다. */
  let renderSeq = 0;

  function render() {
    const my = ++renderSeq;
    const sel = window.Scope.get();
    const desc = window.Scope.describe();
    pruneOrphanDrafts();
    paintSubnav();

    /* 과제 › Study › 팀 › Sample.
       Sample 은 표의 열이라 하나가 아니므로 몇 개인지로 적습니다 — 여기에
       열 이름 하나만 적으면 나머지 열이 없는 것처럼 보입니다. */
    const nCols = (sel.studyId && sel.team) ? allCols(sel.studyId, sel.team).length : 0;
    $("#crumb").innerHTML = desc.path.length
      ? desc.path.map((p, i) => (i ? '<span class="crumb-sep">›</span>' : "") +
          '<span>' + esc(p.label) + '</span>').join("") +
        (nCols ? '<span class="crumb-sep">›</span><span>시료 ' + nCols + '개</span>' : "")
      : '<span style="color:var(--c-text-mute)">과제를 선택하세요</span>';

    /* 분석 및 시료 관리 — 예전 '분석 의뢰' 화면을 이 탭 안으로 흡수했습니다.
       데이터 입력과 시료 인계는 같은 사람이 이어서 하는 일이라 한 메뉴에 둡니다. */
    /* 드롭다운에 없는 Study · Batch 를 그 자리에서 만드는 줄.
       게이트 화면에서도 보여야 합니다 — "결과 없음" 을 만난 사람이 가장
       먼저 하고 싶은 일이 새로 만드는 것입니다. */
    const eb = $("#entity-bar");
    if (eb) {
      eb.innerHTML = mode === "requests" ? "" : entityBar();
      wireEntityBar();
    }

    if (mode === "requests") { renderRequests(); return; }

    if (!sel.scopeId) { gate("상단에서 과제를 선택하세요."); return; }
    if (!window.Scope.skipsStudyStep() && !sel.studyId) {
      gate((window.DATA_STUDIES || []).some(s => s.projectId === sel.scopeId)
        ? "Study 를 먼저 선택하세요. 팀은 그다음에 고를 수 있습니다."
        : "이 과제에는 등록된 Study 가 없습니다. 위 [+ 새 Study] 로 만들면 입력 표가 열립니다.");
      return;
    }
    if (!sel.team) {
      gate("팀을 선택해야 입력 표가 열립니다. (팀 미지정 상태에서는 저장할 수 없습니다)"); return;
    }

    /* ★ Scope.batches() 를 기다리지 않습니다.

       예전에는 "이 Study 의 Batch 목록" 을 받아 와야 표를 그릴 수 있었고,
       배치가 없으면 막다른 안내로 끝났습니다. 이제 표의 열은 시료이고,
       시료가 없으면 빈 열 하나로 시작하면 됩니다 — 기다릴 것도, 막힐 것도
       없습니다. 비동기 렌더 경합(먼저 시작한 쪽이 나중에 끝나 화면을
       덮어쓰는 문제)도 함께 사라집니다. */
    {
      loadPend(sel.studyId, sel.team);
      const groups = FIELDS[sel.team]();
      const teamKo = (window.DATA_TEAMS.find(t => t.id === sel.team) || {}).ko || sel.team;
      const studyName = ((window.DATA_STUDIES || []).find(s => s.id === sel.studyId) || {}).name || "";

      $("#form-host").innerHTML =
        '<section class="card" style="border-top:3px solid ' +
          ((window.DATA_TEAMS.find(t => t.id === sel.team) || {}).color || "var(--c-accent)") + '">' +
          '<div class="card-head" style="flex-wrap:wrap;gap:var(--s-3)">' +
            '<div><h2 class="card-title">' + esc(teamKo) + ' 서식</h2>' +
            '<p class="card-sub">' + esc(studyName) + ' · ' +
              '표의 <b>열 하나가 시료 하나</b>입니다 — ' +
              '[시료 추가 →] 로 시료를 늘리고, 머리글을 눌러 이름을 적습니다</p></div>' +
          '</div>' +

          (sel.team === "downstream"
            ? '<div class="card-body" style="padding-bottom:0"><div class="demo-note">' +
              '정제 공정 값은 Protein A → CEX → AEX 3-step 기준입니다. ' +
              '수정하면 기존 값을 덮어쓰지 않고 변경 이력으로 쌓입니다.</div></div>' : "") +

          /* 입력칸이 참조하는 datalist 만 둡니다 (화면에는 아무것도 안 그립니다).

             여기 있던 접힘 패널 셋 — 값 입력 표기 · 계산 도구 · 이 배치가 쓴
             자재 — 을 걷어냈습니다. 표와 그래프 사이에 접힌 띠가 셋이나
             끼어 있어, 값을 적으러 온 사람이 매번 그만큼 지나쳐 내려가야
             했습니다. 셋 다 "참고" 이지 입력 동선이 아닙니다. */
          valueHelp() +

          /* 왼쪽에 표, 오른쪽에 그 값으로 그린 그래프.

             옮겨 적는 사람이 자기가 적은 숫자를 눈으로 확인할 자리가
             없었습니다. 한 칸 밀려 적거나 자릿수를 틀려도 표 안에서는
             그냥 또 하나의 숫자라 티가 나지 않습니다. 선으로 보면 혼자
             튀어 바로 보입니다 — 적는 중에 보여야 그 자리에서 고칩니다. */
          '<div class="card-body ebr-split" style="padding-bottom:var(--s-4)">' +
            '<div id="grid-host"></div>' +
            '<aside id="live-host" class="ebr-live" aria-label="입력값 실시간 그래프"></aside>' +
          '</div>' +

          '<div class="card-body" style="border-top:1px solid var(--c-border);display:flex;' +
            'gap:var(--s-3);align-items:center;flex-wrap:wrap">' +
            '<button class="btn btn-accent" id="save-all">전체 저장</button>' +
            '<span id="pend-note" style="font-size:12px;color:var(--c-text-mute)"></span>' +
            '<span id="save-msg" style="font-size:12px;color:var(--c-ok);font-weight:600"></span>' +
          '</div>' +
        '</section>';

      mountGrid(groups);
      wireForm(groups);
      paintPendNote();
    }
  }

  /* 아직 저장하지 않은 칸이 몇 개인지 — 버튼 옆에서 늘 보여야 합니다.
     저장했다고 생각한 채 창을 닫는 것이 이 구조에서 가장 나쁜 실패입니다. */
  function paintPendNote() {
    const el = $("#pend-note");
    if (!el) return;
    const n = pendCount();
    el.innerHTML = n
      ? '<b style="color:var(--c-risk)">저장하지 않은 칸 ' + n + '개</b> — ' +
        '[전체 저장] 을 눌러야 기록됩니다 (적은 내용은 이 브라우저에 보관 중)'
      : '표에 적은 값은 [전체 저장] 을 눌러야 기록됩니다.';
  }

  function gate(msg) {
    $("#form-host").innerHTML = '<div class="gate">' +
      '<p style="font-size:13.5px;color:var(--c-text-mute);margin:0">' + esc(msg) + '</p></div>';
  }


  /* ══════════════════════════════════════════════════════════════════════
     신규 Study 등록

     ★ 여기 있던 [+ 새 Batch] · [시료 추가] · [분석 의뢰하기] · Batch/시료
       드롭다운을 모두 없앴습니다.

       단위를 버튼으로도 만들고 표에서도 만들 수 있으면, 같은 것을 만드는
       길이 둘이 됩니다. 두 길이 만드는 레코드의 모양이 조금만 달라도
       (이름 규칙 · 그릇 연결 · 팀 표시) 어느 쪽으로 만들었는지에 따라
       화면이 달라지고, 그 차이는 만든 사람만 압니다.

       지금은 길이 하나입니다 — 표에 적으면 생기고, 적지 않으면 생기지
       않습니다.
     ══════════════════════════════════════════════════════════════════════ */
  function entityBar() {
    const sel = window.Scope.get();
    if (!sel.scopeId) return "";
    return '<div class="entity-bar">' +
      '<span>목록에 없나요?</span>' +
      '<button class="btn btn-ghost btn-sm" id="new-study">+ 새 Study</button>' +
      '<span class="entity-hint">시료는 아래 표에서 [시료 추가 →] 로 만듭니다</span>' +
    '</div>';
  }
  function wireEntityBar() {
    const a = $("#new-study");
    if (a) a.addEventListener("click", () => openNewStudy());
  }

  function closeEntityModal() {
    const old = document.getElementById("entity-modal");
    if (old) old.remove();
  }

  function entityModal(title, sub, fieldsHTML, onSubmit) {
    closeEntityModal();
    const d = document.createElement("div");
    d.className = "modal";
    d.id = "entity-modal";
    d.setAttribute("role", "dialog");
    d.setAttribute("aria-modal", "true");
    d.setAttribute("aria-label", title);
    d.innerHTML =
      '<div class="modal-box" style="max-width:520px">' +
        '<div class="modal-head"><div>' +
          '<h2 class="card-title">' + esc(title) + '</h2>' +
          '<p class="card-sub">' + esc(sub) + '</p></div>' +
          '<button class="btn-icon" id="em-x" aria-label="닫기">✕</button>' +
        '</div>' +
        '<form class="modal-body" id="em-form"><div class="ebr-grid">' + fieldsHTML + '</div>' +
          '<p class="em-note">측정값은 비워 둡니다 — 값을 지어내지 않습니다. ' +
            '등록 뒤 왼쪽 표에서 직접 적으면 그 자리에서 대시보드와 데이터 조회에 반영됩니다.</p>' +
          '<p class="field-msg is-error" id="em-msg" style="display:none"></p>' +
        '</form>' +
        '<div class="modal-foot">' +
          '<button class="btn btn-ghost" id="em-cancel">취소</button>' +
          '<button class="btn btn-accent" id="em-ok">등록</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(d);

    const msg = t => {
      const p = d.querySelector("#em-msg");
      p.style.display = t ? "block" : "none";
      p.textContent = t || "";
    };
    const go = function () {
      const data = {};
      Array.prototype.forEach.call(d.querySelectorAll("[data-f]"), i => { data[i.dataset.f] = i.value.trim(); });
      const r = onSubmit(data);
      if (r && r.ok) { closeEntityModal(); render(); }
      else msg((r && r.reason) || "등록하지 못했습니다");
    };
    d.querySelector("#em-ok").addEventListener("click", go);
    d.querySelector("#em-form").addEventListener("submit", e => { e.preventDefault(); go(); });
    d.querySelector("#em-x").addEventListener("click", closeEntityModal);
    d.querySelector("#em-cancel").addEventListener("click", closeEntityModal);
    d.addEventListener("click", e => { if (e.target === d) closeEntityModal(); });
    document.addEventListener("keydown", function esc2(e) {
      if (e.key === "Escape") { closeEntityModal(); document.removeEventListener("keydown", esc2); }
    });
    const first = d.querySelector("[data-f]");
    if (first) setTimeout(() => first.focus(), 0);
  }

  function field(key, label, opts) {
    const o = opts || {};
    return '<label class="ebr-cell"><span>' + esc(label) + (o.req ? " *" : "") + '</span>' +
      (o.options
        ? '<select class="ebr-input" data-f="' + esc(key) + '">' +
            o.options.map(x => '<option value="' + esc(x[0]) + '"' +
              (x[0] === o.value ? " selected" : "") + '>' + esc(x[1]) + '</option>').join("") +
          '</select>'
        : '<input class="ebr-input" data-f="' + esc(key) + '" type="' + (o.type || "text") + '" ' +
          'value="' + esc(o.value || "") + '" placeholder="' + esc(o.ph || "") + '">') +
      (o.hint ? '<span class="ebr-hint">' + esc(o.hint) + '</span>' : "") +
    '</label>';
  }

  /* ★ '유형' 과 'Study ID' 칸을 없앴습니다.

     둘 다 비워 두는 칸이었습니다. 유형은 비우면 "직접 등록" 이 되고,
     ID 는 비우면 자동 생성이라 — 세 칸 중 둘이 "안 적어도 됩니다" 라는
     설명을 달고 있었습니다. 적을지 말지 매번 판단하게 만드는 칸은, 적어
     넣는 사람에게는 비용이고 읽는 사람에게는 들쭉날쭉한 값입니다.

     이름만 받습니다. ID 는 Dataset 이 만들고, 유형은 "직접 등록" 입니다. */
  function openNewStudy() {
    const sel = window.Scope.get();
    const prj = (window.DATA_PROJECTS || []).find(p => p.id === sel.scopeId);
    entityModal("새 Study 등록",
      (prj ? prj.label || prj.id : sel.scopeId) + " 아래에 만듭니다",
      field("name", "Study 이름", { req: true, ph: "예: Feed 조건 비교 2차" }),
      function (data) {
        const r = window.Dataset.addStudy({ projectId: sel.scopeId, name: data.name });
        if (r.ok) window.Scope.setStudy(r.study.id);
        return r;
      });
  }

  /* ── 시료 하나 만들기 ─────────────────────────────────────────────────
     표에 값이 적힌 열을 [전체 저장] 할 때만 불립니다. 시료 레코드와 그 값을
     담을 그릇을 **같이** 만듭니다 — 하나만 만들어 두면 값은 적혔는데 담을
     곳이 없거나, 담을 곳은 있는데 무엇의 값인지 알 수 없게 됩니다. */
  function materialize(studyId, team, name, sub) {
    const nb = window.Dataset.addBatch({
      studyId: studyId, team: team, expNo: name, hidden: true,
      initialDate: window.HubCalendar ? window.HubCalendar.today() : null
    });
    if (!nb.ok) return { ok: false, reason: nb.reason };
    const ns = E.addSample({
      batchId: nb.batch.id, studyId: studyId, team: team,
      name: name, stage: sub || null
    });
    if (!ns.ok) return { ok: false, reason: ns.reason };
    return { ok: true, bid: nb.batch.id, sid: ns.sample.id };
  }

  /* ── 값 타입 ────────────────────────────────────────────────────────────
     측정값은 숫자 하나가 아니라 "숫자 · 한정자(<1) · 결측 사유" 세 가지를
     담습니다 (value.js 참고). 날짜·자유 텍스트 필드는 예전 그대로입니다. */
  function isMeasure(f) { return f.type !== "date" && f.type !== "text"; }

  /* 입력 범위(lo/hi)와 누적 여부를 스키마에서 찾습니다.
     배양 항목은 스키마상 upstream / titer 두 그룹에 흩어져 있어 한 번 더 훑습니다. */
  function itemSchema(f) {
    if (!f.src) return null;
    if (f.src[0] === "titer") return window.DATA_TITER_ITEM;      // 일자별 Titer
    const g = window.DATA_ANALYTE_GROUPS.find(x => x.id === f.src[0]);
    let it = g && g.items.find(x => x.key === f.src[1]);
    if (!it) {
      window.DATA_ANALYTE_GROUPS.some(function (x) {
        const c = x.items.find(y => y.key === f.src[1]);
        if (c) { it = c; return true; }
        return false;
      });
    }
    return it || null;
  }

  /* ★ 칸에 **미리 채워 넣는 값이 없습니다.**

     예전에는 아무도 적지 않은 칸에 Excel 원본값이 떠 있었습니다. 적힌 것과
     보여 주는 것이 달라서, 사용자는 자기가 적은 줄 알고 넘어갔고 — 그 값을
     고치면 "원본 덮어쓰기" 로 사유를 요구했습니다. 적은 적도 없는 숫자에
     대해서요.

     빈 칸은 빈 칸입니다. 적힌 것만 보여 줍니다. 그래서 지킬 "화면에 보이던
     원본" 도 없어졌고, baseValue 를 들고 다닐 이유도 없어졌습니다. */
  function originLabel(f) {
    /* 정제 항목은 Excel 에 없는 컬럼이라 "Excel 원본" 이라고 쓰면 거짓말이 됩니다. */
    return (f && f.src && f.src[0] === "downstream") ? "초기값" : "Excel 원본";
  }

  /* 회의에서 이 값이 지적됐다면 입력 칸 옆에 남깁니다 — 값을 고치기 전에
     "회의에서 뭐라고 했는지"가 같은 자리에 보여야 합니다. */
  function pinMark(batch, f) {
    if (!window.Pins || !batch) return "";
    const list = window.Pins.forField(batch.id, f.k);
    if (!list.length) return "";
    const tip = list.map(x =>
      ((window.Pins.KIND[x.kind] || {}).ko || "핀") + ": " + x.text + " — " + x.createdBy).join(" / ");
    return '<span class="pin-mark" title="' + esc(tip) + '">◆ 회의 지적' +
      (list.length > 1 ? " " + list.length : "") + '</span> ';
  }


  /* ══════════════════════════════════════════════════════════════════════
     입력 표 — DataGrid 에 스키마와 콜백만 넘깁니다

     표를 그리는 일과 값을 다루는 일을 나눠 둡니다. 그리는 쪽(DataGrid)은
     어느 서식이든 같고, 값을 다루는 규칙(사유 필수 · 범위 검사 · 단위
     해석 · 감사 이력)은 이 화면의 것입니다. 저장까지 DataGrid 안으로
     넣으면 서식마다 다른 규칙이 그 안으로 새어 들어와 공통이 아니게
     됩니다.

  /* ── 이름 덧씌움 ──────────────────────────────────────────────────────
     Aliases 가 없어도 화면은 원래 이름으로 동작해야 합니다 — 이름을 고치는
     기능이 없는 것과 화면이 열리지 않는 것은 다릅니다. */
  const A = window.Aliases || {
    get: (k, v) => v, set: () => ({ ok: true }), historyOf: () => [],
    isHidden: () => false, hiddenInfo: () => null, hide: () => ({ ok: true }),
    unhide: () => ({ ok: true }), hiddenWithPrefix: () => [],
    originalOf: (o, p) => (o ? o[p] : null)
  };
  function colKey(team, bid, colId) { return "col:" + team + "|" + bid + "|" + colId; }
  function hideKey(team, bid, colId) { return "colhide:" + team + "|" + bid + "|" + colId; }

  /* 항목명이 어느 이름에 붙는가
       item:…   스키마 항목명 — 대시보드 · 데이터 조회 · AI 가 같이 씁니다
       field:…  이 화면에만 있는 항목 (Resin · 특이사항 · Harvest 일자) */
  function rowAliasKey(f, perDay) {
    if (perDay) return "item:titer";
    if (!f || !f.src) return "field:" + (f ? f.k : "");
    if (f.src[0] === "titer" && /^D\d+$/.test(String(f.src[1]))) return "item:titer";
    const g = (window.DATA_ANALYTE_GROUPS || []).find(x => x.id === f.src[0]);
    if (g && (g.items || []).some(it => it.key === f.src[1])) {
      return "item:" + f.src[0] + "." + f.src[1];
    }
    return "field:" + (f.k || "");
  }
  /* 원본에 적혀 있던 이름 — 고친 뒤에도 마우스를 올리면 보여야 합니다.
     스키마 항목은 Aliases.apply() 가 label 을 덧씌우므로 f.label 은 이미
     고친 이름입니다. 원래 이름은 스키마 객체에서 꺼냅니다. */
  function rowOrigLabel(f, perDay) {
    if (perDay) return A.originalOf(window.DATA_TITER_ITEM, "label") || "Titer";
    if (f && f.src) {
      if (f.src[0] === "titer" && /^D\d+$/.test(String(f.src[1]))) {
        return (A.originalOf(window.DATA_TITER_ITEM, "label") || "Titer") + " " + f.src[1];
      }
      const g = (window.DATA_ANALYTE_GROUPS || []).find(x => x.id === f.src[0]);
      const it = g && (g.items || []).find(x => x.key === f.src[1]);
      if (it) return A.originalOf(it, "label");
    }
    return f ? f.label : "";
  }
  function rowShownLabel(f, perDay) {
    if (perDay) return A.get("item:titer", "Titer");
    if (f && f.src && f.src[0] === "titer" && /^D\d+$/.test(String(f.src[1]))) {
      return A.get("item:titer", "Titer") + " " + f.src[1];
    }
    return A.get(rowAliasKey(f, perDay), f ? f.label : "");
  }
  /* ══════════════════════════════════════════════════════════════════════
     워크시트 — 행도 열도 사용자가 정하는 표

     ── 열 ────────────────────────────────────────────────────────────────
     열 하나가 시료 하나입니다. [시료 추가 →] 로 늘리고, 머리글을 눌러 이름을
     적습니다. 열 지우기는 그 시료를 비활성으로 돌립니다 (값·이력은 남습니다).

     ── 저장 키 규칙 ──────────────────────────────────────────────────────
     한 줄로: **모든 칸이 정본입니다.**

       스키마 행 × 아무 열     batch:<그릇id>|<f.k>        예: batch:C-7F2|seHPLC_hmw
       사용자 행 × 아무 열     batch:<그릇id>|ws_<행이름>

     예전에는 첫 열만 정본이고 나머지 열은 ws_<키>@<열id> 로 이 화면 안에만
     남았습니다. 열이 시료가 되면서 그 구분이 없어졌습니다 — 열마다 자기
     그릇이 있으므로, 둘째 열의 값도 조회 · 대시보드 · AI 가 똑같이 읽습니다.
     적어 놓고도 조회할 수 없는 숫자가 더 이상 생기지 않습니다.

     스키마 항목의 키는 이름을 고쳐도 바뀌지 않습니다. HMW 를 "응집체" 로
     바꿔도 값은 seHPLC_hmw 에 그대로 있고, 다른 화면이 계속 같은 값을
     봅니다. 반대로 사용자가 만든 행은 **이름이 곧 키**입니다 — 다른 화면이
     모르는 항목이라 맞출 기준이 없기 때문입니다. 대신 이름을 고치면 저장된
     값도 새 키로 옮겨 줍니다.
     ══════════════════════════════════════════════════════════════════════ */
  const CUSTOM_KEY = "hub.ws.rows";

  /* ── 사용자가 만든 행 ─────────────────────────────────────────────────
     k 가 곧 이름입니다. 이름을 고치면 k 도 바뀌고, 값도 함께 옮깁니다.

     행은 Study · 팀 단위입니다 (예전에는 Batch 단위였습니다). 같은 서식의
     열끼리 같은 행을 봐야 하니, 열마다 행 목록이 다르면 표가 아닙니다. */
  function customRows(studyId, team) {
    try {
      const m = window.Persist.getJSON(CUSTOM_KEY, {}) || {};
      return m[pairKey(studyId, team)] || [];
    } catch (e) { return []; }
  }
  function saveCustomRows(studyId, team, list) {
    const m = window.Persist.getJSON(CUSTOM_KEY, {}) || {};
    if (list && list.length) m[pairKey(studyId, team)] = list;
    else delete m[pairKey(studyId, team)];
    window.Persist.setJSON(CUSTOM_KEY, m);
  }

  /* 새 열 이름 — 겹치지 않는 번호를 찾습니다 */
  function nextColName(list) {
    let n = (list || []).length + 1, name = "시료 " + n;
    const taken = (list || []).map(c => String(c.name || "").toLowerCase());
    while (taken.indexOf(name.toLowerCase()) > -1) { n++; name = "시료 " + n; }
    return name;
  }

  /* ── 행 ───────────────────────────────────────────────────────────────
     스키마 항목 + 사용자가 만든 항목. 모든 행이 모든 열에 칸을 갖습니다.

     ★ 일자별 Titer 를 "한 줄이 일자 열을 가로지르는" 모양으로 접지 않습니다.
       그 모양은 열이 일자였을 때의 것입니다. 열이 시료가 된 지금은 일자마다
       한 줄입니다 (DATA_TITER_DAYS 가 비어 있으면 아예 나오지 않습니다). */
  function buildRows(studyId, team, groups) {
    const out = [];
    groups.forEach(function (grp) {
      (grp.items || []).forEach(function (f) {
        out.push({ k: f.k, label: rowShownLabel(f, false), orig: rowOrigLabel(f, false),
                   unit: f.unit, type: f.type, group: grp.g, field: f });
      });
    });
    customRows(studyId, team).forEach(function (c) {
      out.push({ k: "ws_" + c.k, name: c.k, label: c.k, orig: c.k,
                 unit: c.unit || "", type: "num",
                 group: "직접 추가한 항목", custom: true, field: null });
    });
    return out;
  }

  function rowKeyOf(row) { return row.custom ? ("ws_" + row.name) : row.field.k; }

  /* ── 한 칸이 어디로 가는가 ────────────────────────────────────────────
     아직 저장 전인 열은 담을 그릇이 없습니다 — 그 칸은 드래프트에만 있고,
     [전체 저장] 때 그릇이 만들어진 뒤에 자리를 얻습니다. */
  function cellTarget(row, col) {
    if (!col || !col.bid) return null;
    return { scope: "batch:" + col.bid, key: rowKeyOf(row), f: row.field };
  }
  /* ── 워크시트 그리기 ─────────────────────────────────────────────────── */
  function mountWorksheet(groups, host) {
    const sel = window.Scope.get();
    const team = sel.team, studyId = sel.studyId;

    const cols = allCols(studyId, team).map(function (c) {
      return { id: c.id, bid: c.bid, sid: c.sid, saved: !!c.saved,
               name: c.name, label: c.name, orig: c.name,
               sub: c.sub || "", origSub: c.sub || "" };
    });
    const rows = buildRows(studyId, team, groups);

    host.innerHTML = inactiveStrip(studyId, team) + '<div id="ws-host"></div>';
    $$("[data-revive]", host).forEach(b => b.addEventListener("click", function () {
      E.reactivateSample(b.dataset.revive);
      render();
    }));

    window.Worksheet.mount(host.querySelector("#ws-host"), {
      rows: rows, cols: cols,
      addRowLabel: "항목 추가 ↓", addColLabel: "시료 추가 →",

      /* ★ 빈 칸에 아무것도 미리 넣지 않습니다 — 적힌 것만 보여 줍니다.
         저장 전 값(드래프트)이 있으면 그것이, 없으면 저장된 값이,
         둘 다 없으면 빈 칸입니다. */
      cell: function (row, col) {
        const dk = col.id + "::" + rowKeyOf(row);
        const t = cellTarget(row, col);
        const rec = t ? E.getValue(t.scope, t.key) : null;
        const edited = !!(rec && E.hasHistory(rec));
        const n = rec && rec.history ? rec.history.length : 0;

        if (Object.prototype.hasOwnProperty.call(pend, dk)) {
          return { display: pend[dk], origin: "저장 전", draft: true,
                   missing: null, edited: edited, editCount: n };
        }
        if (rec) {
          return { display: wsDisplay(row, rec.value), origin: E.caption(rec),
                   missing: wsMissing(row, rec.value), edited: edited, editCount: n };
        }
        return { display: "", origin: null, missing: null, edited: false, editCount: 0 };
      },

      /* 칸을 벗어나거나 Enter — 검사만 하고 **드래프트에 담습니다.**
         저장은 [전체 저장] 에서만 일어납니다. */
      onCommit: function (row, col, raw) { return stage(row, col, raw, cols, rows); },

      onRevert: function (row, col) { unstage(row, col, cols, rows); },

      onHistory: function (anchor, row, col, sticky) {
        if (!anchor) { closeHoverHistory(); return; }
        const t = cellTarget(row, col);
        showHistory(anchor, t ? E.getValue(t.scope, t.key) : null,
          { label: row.label + " · " + col.label, type: row.type }, sticky);
      },

      onAddRow: function (label) {
        const name = String(label || "").trim();
        if (!name) return;
        const list = customRows(studyId, team);
        if (list.some(c => c.k.toLowerCase() === name.toLowerCase())) {
          window.alert("같은 이름의 항목이 이미 있습니다: " + name); return;
        }
        list.push({ k: name, label: name, unit: "" });
        saveCustomRows(studyId, team, list);
        render();
      },
      onDropRow: function (rk) {
        const list = customRows(studyId, team).filter(c => ("ws_" + c.k) !== rk);
        saveCustomRows(studyId, team, list);
        render();
      },

      /* 열 하나 더하기 = 시료 하나 더하기. 다만 **아직 만들지 않습니다** —
         값이 적힌 열만 [전체 저장] 때 레코드가 됩니다. */
      onAddCol: function () {
        const now = allCols(studyId, team);
        const list = newCols(studyId, team).map(c => ({ cid: c.id, name: c.name, sub: c.sub }));
        /* 표가 비어 있을 때 보이던 "시료 1" 은 아무 데도 적혀 있지 않습니다.
           여기서 먼저 실체를 만들어 둬야, 둘째 열을 더했을 때 첫 열이
           사라지지 않습니다. */
        if (!savedCols(studyId, team).length && !list.length) {
          list.push({ cid: "new-1", name: now[0] ? now[0].name : "시료 1", sub: "" });
        }
        list.push({ cid: "new-" + Date.now().toString(36), name: nextColName(now), sub: "" });
        saveNewCols(studyId, team, list);
        render();
      },

      onRenameCol: function (col, part, text) { renameCol(studyId, team, col, part, text); },
      onRenameRow: function (row, text) { renameRow(studyId, team, row, text); },
      onDropCol:   function (col) { dropCol(studyId, team, rows, col); },

      onEdit: function (row, col, raw) {
        typing = { rowKey: row.k, colId: col.id, raw: raw };
        schedulePaintLive(team, rows, cols);
      }
    });

    typing = null;
    paintLive(team, rows, cols);
  }

  /* ══════════════════════════════════════════════════════════════════════
     저장 전 단계 (드래프트)

     표에 적은 값은 여기 머물다가 [전체 저장] 에서 한 번에 기록됩니다.

     왜 그 자리에서 저장하지 않는가 —
     처음 옮겨 적는 동안의 오타까지 변경 이력에 쌓이면, 나중에 "이 값이
     왜 바뀌었나" 를 되짚을 때 진짜 정정 한 건이 오타 열 건에 묻힙니다.
     규제 대응상 필요한 것은 **기록된 값의 변경 이력**이고, 기록되기 전의
     타이핑은 그 대상이 아닙니다.

     적다 만 것은 이 브라우저에 보관합니다 — 저장 전이라고 창을 닫는 순간
     사라지면, 다시 적는 수밖에 없습니다.
     ══════════════════════════════════════════════════════════════════════ */
  function stage(row, col, raw, cols, rows) {
    const rk = rowKeyOf(row);
    const dk = col.id + "::" + rk;
    const txt = String(raw == null ? "" : raw).trim();

    /* 검사는 지금 합니다 — 저장할 때 한꺼번에 알리면, 어느 칸이 틀렸는지
       찾아 올라가야 합니다. 적는 자리에서 말해 주는 편이 고치기 쉽습니다. */
    if (txt !== "" && isMeasure(row.field || { type: row.type })) {
      const p = window.VAL.parse(txt);
      if (!p.ok) { wsMsgKey(row.k, col.id, "error", [p.error]); return "error"; }
      if (row.field) {
        const it = itemSchema(row.field);
        const rangeErr = window.VAL.checkRange(p.val, it);
        if (rangeErr) { wsMsgKey(row.k, col.id, "error", [rangeErr]); return "error"; }
        const warns = warningsFor(row.field, p.val, it);
        wsMsgKey(row.k, col.id, warns.length ? "warn" : null, warns);
      } else {
        wsMsgKey(row.k, col.id, null, []);
      }
    } else {
      wsMsgKey(row.k, col.id, null, []);
    }

    /* 저장된 값과 같아졌으면 드래프트를 들고 있을 이유가 없습니다 */
    const t = cellTarget(row, col);
    const rec = t ? E.getValue(t.scope, t.key) : null;
    const savedText = rec ? wsDisplay(row, rec.value) : "";
    if (txt === savedText) delete pend[dk];
    else pend[dk] = txt;

    savePend();
    markDraftCell(row, col, Object.prototype.hasOwnProperty.call(pend, dk));
    paintPendNote();
    schedulePaintLive(window.Scope.get().team, rows, cols);
    /* "saved" 를 돌려주지 않습니다 — 돌려주면 Worksheet 가 표를 다시 그리길
       기다리고, 다시 그리지 않는 우리 쪽과 어긋나 커서가 멈춥니다. */
    return "draft";
  }

  /* Esc — 이 칸의 저장 전 값을 버리고 저장된 값으로 되돌립니다 */
  function unstage(row, col, cols, rows) {
    const dk = col.id + "::" + rowKeyOf(row);
    delete pend[dk];
    savePend();
    const t = cellTarget(row, col);
    const rec = t ? E.getValue(t.scope, t.key) : null;
    const inp = document.querySelector('[data-r="' + cssq(row.k) + '"][data-c="' + cssq(col.id) + '"]');
    if (inp) inp.value = rec ? wsDisplay(row, rec.value) : "";
    wsMsgKey(row.k, col.id, null, []);
    markDraftCell(row, col, false);
    paintPendNote();
    schedulePaintLive(window.Scope.get().team, rows, cols);
  }

  /* 선택자에 넣을 값 — 열 id 와 항목명에는 사용자가 적은 글자가 들어갑니다 */
  function cssq(s) { return String(s).replace(/["\\]/g, "\\$&"); }

  function markDraftCell(row, col, on) {
    const cell = document.querySelector('[data-cell="' + cssq(row.k + "::" + col.id) + '"]');
    if (!cell) return;
    cell.classList.toggle("is-draft", !!on);
  }

  /* ── 전체 저장 ─────────────────────────────────────────────────────────
     1. 값이 적힌 "저장 전 열" 을 시료 + 그릇으로 만듭니다
     2. 처음 적는 칸은 사유 없이 기록합니다 (이력 없음)
     3. 이미 기록된 값을 바꾸는 칸만 사유를 받아 이력에 쌓습니다

     3번이 이 화면에서 Audit log 가 생기는 **유일한** 경우입니다. */
  function saveAll(groups) {
    const sel = window.Scope.get();
    const studyId = sel.studyId, team = sel.team;
    const msg = $("#save-msg");
    const say = function (t, bad) {
      if (!msg) return;
      msg.textContent = t;
      msg.style.color = bad ? "var(--c-risk)" : "var(--c-ok)";
      setTimeout(function () { if (msg) msg.textContent = ""; }, 5000);
    };

    const keys = Object.keys(pend);
    if (!keys.length) { say("저장할 값이 없습니다"); return; }

    const rows = buildRows(studyId, team, groups);
    const cols = allCols(studyId, team);
    const rowByKey = {};
    rows.forEach(function (r) { rowByKey[rowKeyOf(r)] = r; });

    /* ── 1. 열 실체화 ── */
    const colById = {};
    cols.forEach(function (c) { colById[c.id] = c; });
    const madeFor = {};
    let failed = null;

    keys.forEach(function (dk) {
      if (failed) return;
      const cut = dk.indexOf("::");
      const cid = dk.slice(0, cut);
      const col = colById[cid];
      if (!col || col.bid || madeFor[cid]) return;
      if (String(pend[dk] || "").trim() === "") return;   /* 빈 값만 있는 열은 만들지 않습니다 */
      const r = materialize(studyId, team, col.name, col.sub);
      if (!r.ok) { failed = col.name + ": " + r.reason; return; }
      madeFor[cid] = r;
    });
    if (failed) { say(failed, true); return; }

    /* 실체가 생긴 열은 저장 전 목록에서 내립니다 */
    if (Object.keys(madeFor).length) {
      const rest = newCols(studyId, team)
        .filter(c => !madeFor[c.id])
        .map(c => ({ cid: c.id, name: c.name, sub: c.sub }));
      saveNewCols(studyId, team, rest);
    }

    /* ── 2·3. 값 쓰기 ── */
    const plan = [];        /* 처음 적는 칸 */
    const edits = [];       /* 이미 기록된 값을 바꾸는 칸 — 사유 필요 */

    keys.forEach(function (dk) {
      const cut = dk.indexOf("::");
      const cid = dk.slice(0, cut), rk = dk.slice(cut + 2);
      const row = rowByKey[rk];
      const col = colById[cid];
      if (!row || !col) return;
      const bid = (madeFor[cid] && madeFor[cid].bid) || col.bid;
      if (!bid) return;                                  /* 값이 빈 미실체 열 */

      const scope = "batch:" + bid;
      const txt = String(pend[dk] == null ? "" : pend[dk]).trim();
      let val;
      if (isMeasure(row.field || { type: row.type })) {
        if (txt === "") val = null;
        else { const p = window.VAL.parse(txt); if (!p.ok) return; val = p.val; }
      } else {
        val = txt === "" ? null : txt;
      }

      const prev = E.getValue(scope, rk);
      const item = { dk: dk, scope: scope, key: rk, val: val, row: row, col: col };
      if (prev && !window.VAL.same(prev.value, val)) edits.push(item);
      else plan.push(item);
    });

    /* 처음 적는 칸부터 — 사유를 묻지 않습니다 */
    let wrote = 0, bad = 0;
    plan.forEach(function (it) {
      const r = window.Repo.setValue(it.scope, it.key, it.val, undefined,
        { baseValue: null, baseSource: null });
      if (r && r.ok) { wrote++; delete pend[it.dk]; }
      else bad++;
    });
    savePend();

    if (!edits.length) {
      render();
      say(wrote + "개 저장됨" + (bad ? " · " + bad + "개 실패" : ""), !!bad);
      return;
    }

    /* 기록을 고치는 칸 — 사유를 한 번 받아 함께 적습니다. 칸마다 따로
       물으면 열 칸을 고친 사람이 열 번 같은 문장을 적게 되고, 그러면
       "수정" 같은 한 단어만 남습니다. */
    askReason(edits, function (why) {
      let ok2 = 0, bad2 = 0;
      edits.forEach(function (it) {
        const r = window.Repo.setValue(it.scope, it.key, it.val, why,
          { baseValue: null, baseSource: null });
        if (r && r.ok) { ok2++; delete pend[it.dk]; }
        else bad2++;
      });
      savePend();
      render();
      say((wrote + ok2) + "개 저장됨 · " + ok2 + "개는 변경 이력에 기록", !!(bad + bad2));
    }, function () {
      render();
      say(wrote + "개 저장됨 · " + edits.length + "개는 사유가 없어 보류", true);
    });
  }

  /* 사유 한 번 받기 — 무엇을 고치는지 목록으로 보여 줍니다. 무엇을 고치는지
     모르는 채 사유를 적으면 그 사유는 아무것도 설명하지 못합니다. */
  function askReason(edits, onOk, onCancel) {
    const old = document.getElementById("bulk-reason");
    if (old) old.remove();
    const d = document.createElement("div");
    d.className = "modal";
    d.id = "bulk-reason";
    d.setAttribute("role", "dialog");
    d.setAttribute("aria-modal", "true");
    d.setAttribute("aria-label", "변경 사유 입력");
    d.innerHTML =
      '<div class="modal-box" style="max-width:560px">' +
        '<div class="modal-head"><div>' +
          '<h2 class="card-title">변경 사유</h2>' +
          '<p class="card-sub">이미 기록된 값 ' + edits.length + '건을 고칩니다 — ' +
            '이전 값은 지우지 않고 이력으로 남습니다</p></div></div>' +
        '<div class="modal-body">' +
          '<ul style="margin:0 0 var(--s-4);padding-left:18px;font-size:12.5px;' +
            'color:var(--c-text-mute);line-height:1.8">' +
            edits.slice(0, 8).map(it => '<li>' + esc(it.row.label) + ' · ' +
              esc(it.col.name) + '</li>').join("") +
            (edits.length > 8 ? '<li>그 밖 ' + (edits.length - 8) + '건</li>' : "") +
          '</ul>' +
          '<label class="ebr-cell"><span>사유 *</span>' +
            '<input class="ebr-input" id="br-why" list="reason-presets" ' +
              'placeholder="예: 오기 정정 (전사 오류)"></label>' +
          '<p class="field-msg is-error" id="br-msg" style="display:none"></p>' +
        '</div>' +
        '<div class="modal-foot">' +
          '<button class="btn btn-ghost" id="br-cancel">나중에</button>' +
          '<button class="btn btn-accent" id="br-ok">사유와 함께 저장</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(d);

    const input = d.querySelector("#br-why");
    setTimeout(() => input.focus(), 0);

    function close() { d.remove(); }
    function go() {
      const why = input.value.trim();
      if (why.length < 2) {
        const p = d.querySelector("#br-msg");
        p.style.display = "block";
        p.textContent = "사유를 2자 이상 입력하세요.";
        input.focus();
        return;
      }
      close();
      onOk(why);
    }
    d.querySelector("#br-ok").addEventListener("click", go);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); go(); }
    });
    d.querySelector("#br-cancel").addEventListener("click", function () { close(); onCancel(); });
  }

  /* ── 이름 고치기 ──────────────────────────────────────────────────────
     열 머리글은 그 시료의 이름 자체입니다 (별칭이 아닙니다). 부제는
     채취 단계를 적는 자리로 씁니다.

     아직 저장 전인 열은 이 브라우저의 목록에서만 이름이 바뀝니다. */
  function moveValues(scope, fromKey, toKey) {
    const rec = E.getValue(scope, fromKey);
    if (!rec) return;
    window.Repo.setValue(scope, toKey, rec.value, "항목 이름 변경에 따른 이동",
      { baseValue: null, baseSource: null });
  }

  function renameCol(studyId, team, col, part, text) {
    const txt = String(text == null ? "" : text).trim();

    if (!col.saved) {
      const list = newCols(studyId, team).map(c => ({ cid: c.id, name: c.name, sub: c.sub }));
      let hit = list.find(c => c.cid === col.id);
      if (!hit) {
        /* 표가 비어 있을 때 보이던 한 열 — 여기서 처음 실체가 생깁니다 */
        hit = { cid: col.id, name: col.name, sub: col.sub };
        list.push(hit);
      }
      if (part === "sub") hit.sub = txt;
      else if (!txt) { window.alert("시료 이름은 비울 수 없습니다."); render(); return; }
      else hit.name = txt;
      saveNewCols(studyId, team, list);
      render();
      return;
    }

    if (!col.sid) {
      /* 시료 레코드가 없는 옛 그릇 — 이름을 고치는 순간 시료로 만듭니다 */
      if (part === "sub") { render(); return; }
      if (!txt) { window.alert("시료 이름은 비울 수 없습니다."); render(); return; }
      const r = E.addSample({ batchId: col.bid, studyId: studyId, team: team, name: txt });
      if (!r.ok) { window.alert(r.reason); render(); return; }
      window.Dataset.patch("batch", col.bid, { expNo: txt });
      render();
      return;
    }

    const r = part === "sub"
      ? E.renameSample(col.sid, null, txt)
      : E.renameSample(col.sid, txt);
    if (!r.ok) { window.alert(r.reason); render(); return; }
    /* 그릇의 표시 이름도 맞춰 둡니다 — 대시보드·차트가 expNo 를 적습니다 */
    if (part !== "sub" && col.bid) window.Dataset.patch("batch", col.bid, { expNo: txt });
    render();
  }

  function renameRow(studyId, team, row, text) {
    const txt = String(text == null ? "" : text).trim();
    if (!txt) { window.alert("항목명은 비울 수 없습니다."); render(); return; }

    if (row.custom) {
      const list = customRows(studyId, team);
      const c = list.find(x => ("ws_" + x.k) === row.k);
      if (!c) { render(); return; }
      if (c.k === txt) { render(); return; }
      if (list.some(x => x !== c && x.k.toLowerCase() === txt.toLowerCase())) {
        window.alert("같은 이름의 항목이 이미 있습니다: " + txt); render(); return;
      }
      /* 이름이 곧 키라 저장된 값도 새 키로 옮깁니다 (옛 키의 기록은 남깁니다) */
      allCols(studyId, team).forEach(function (col) {
        if (!col.bid) return;
        moveValues("batch:" + col.bid, "ws_" + c.k, "ws_" + txt);
      });
      c.k = txt; c.label = txt;
      saveCustomRows(studyId, team, list);
      render();
      return;
    }

    /* 스키마 항목 — 이름만 바뀝니다. 키는 그대로라 다른 화면과 계속
       같은 값을 봅니다 (전사 공통 이름). */
    const r = A.set(rowAliasKey(row.field, false), txt, row.orig);
    if (!r.ok) window.alert(r.reason);
    render();
  }

  /* ── 열 지우기 = 시료 비활성 ───────────────────────────────────────────
     규제 대응상 기록은 삭제가 아닙니다. 값과 변경 이력은 그대로 두고
     시료만 비활성으로 돌립니다 — 표 위의 [되살리기] 로 돌아옵니다. */
  function colHasValues(rows, col) {
    if (!col.bid) return false;
    return (rows || []).some(function (row) {
      const t = cellTarget(row, col);
      return !!(t && E.getValue(t.scope, t.key));
    });
  }
  function dropCol(studyId, team, rows, col) {
    const all = allCols(studyId, team);
    if (all.length <= 1) { window.alert("마지막 열은 지울 수 없습니다."); return; }

    /* 저장 전 열 — 아무 기록도 없으니 그냥 내립니다 */
    if (!col.saved) {
      if (!window.confirm("‘" + col.name + "’ 열을 내립니다. 아직 저장된 값은 없습니다.\n계속할까요?")) return;
      saveNewCols(studyId, team, newCols(studyId, team)
        .filter(c => c.id !== col.id)
        .map(c => ({ cid: c.id, name: c.name, sub: c.sub })));
      Object.keys(pend).forEach(function (k) {
        if (k.indexOf(col.id + "::") === 0) delete pend[k];
      });
      savePend();
      render();
      return;
    }

    const used = colHasValues(rows, col);
    const why = used ? "이 시료에는 값이 적혀 있습니다." : "이 시료에는 아직 값이 없습니다.";
    if (!window.confirm("‘" + col.name + "’ — " + why + "\n\n" +
      "지우지 않고 비활성으로 돌립니다. 값과 변경 이력은 그대로 남고, " +
      "표 위의 [비활성 시료] 에서 되살릴 수 있습니다.\n계속할까요?")) return;

    if (col.sid) E.deactivateSample(col.sid, "Data 입력에서 열 내림");
    else window.Dataset.deactivate("batch", col.bid, "Data 입력에서 열 내림");
    render();
  }

  /* 비활성 시료 띠 — 되살릴 손잡이가 화면에 있어야 합니다 */
  function inactiveStrip(studyId, team) {
    const list = [];
    (window.DATA_BATCHES || []).forEach(function (b) {
      if (!b || b.studyId !== studyId || b.team !== team) return;
      E.inactiveSamples(b.id).forEach(function (s) { list.push(s); });
    });
    if (!list.length) return "";
    return '<div class="ws-hidden">' +
      '<b>비활성 시료 ' + list.length + '개</b>' +
      list.map(function (s) {
        return '<button class="ws-unhide" type="button" data-revive="' + esc(s.id) + '" ' +
          'title="' + esc((s.deactivatedBy || "—") + " · " +
            String(s.deactivatedAt || "").replace("T", " ") + " 에 비활성") + '">' +
          esc(s.name) + ' 되살리기</button>';
      }).join("") +
      '<span>값과 변경 이력은 그대로 있습니다 — 표에만 보이지 않습니다.</span>' +
    '</div>';
  }
  /* ══════════════════════════════════════════════════════════════════════
     범용 실시간 차트 — 표에 적힌 것만 그립니다

     예전에는 "Titer 일자별" · "배양 지표" 같은 그래프가 코드에 박혀 있었고,
     어느 것을 그릴지는 팀이 아니라 열 축이 정했습니다. 그래서 분석 서식을
     열어 놓고 배양 그래프를 보는 일이 생겼습니다.

     이제 그리는 대상이 코드에 없습니다.

       X축      표의 열 머리글 그대로 (일자든 시료든 차수든)
       계열     사용자가 고른 행의 값
       값       셀과 똑같은 경로(cellTarget → Entries → 원본)로 읽습니다

     표에 보이는 숫자와 그래프의 점이 다를 수 없습니다 — 같은 함수를
     지나기 때문입니다.

     ★ 치는 중인 값도 그립니다. 다만 아직 저장 전이라는 것은 밝힙니다.
     ══════════════════════════════════════════════════════════════════════ */
  const LIVE_KEY = "hub.ebr.live";
  let typing = null;       /* 지금 글자를 치고 있는 칸 { rowKey, colId, raw } */
  let liveTimer = null;
  let livePick = [];       /* 그릴 행 키 — 첫 번째가 주 계열 */
  let liveKind = "line";

  try {
    const s = window.Persist.getLocalJSON(LIVE_KEY, null);
    if (s) {
      liveKind = s.kind === "bar" ? "bar" : "line";
      livePick = Array.isArray(s.pick) ? s.pick : [];
    }
  } catch (e) {}

  function saveLive() {
    try {
      window.Persist.setLocalJSON(LIVE_KEY, { kind: liveKind, pick: livePick });
    } catch (e) {}
  }

  function schedulePaintLive(team, rows, cols) {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => paintLive(team, rows, cols), 120);
  }

  /* 한 칸의 숫자 — 셀과 같은 경로입니다.
     치는 중 > 저장 전 값 > 저장된 값 순으로 봅니다. 표에 보이는 것과
     그래프의 점이 다를 수 없어야 합니다. */
  function liveValue(row, col) {
    if (typing && typing.rowKey === row.k && typing.colId === col.id) {
      return num(typing.raw);
    }
    const dk = col.id + "::" + rowKeyOf(row);
    if (Object.prototype.hasOwnProperty.call(pend, dk)) return num(pend[dk]);
    const t = cellTarget(row, col);
    const rec = t ? E.getValue(t.scope, t.key) : null;
    if (!rec) return NaN;
    const n = window.VAL.numeric(window.VAL.coerce(rec.value));
    return (n === null || n === undefined) ? NaN : n;
  }
  function num(raw) {
    const p = window.VAL.parse(raw);
    if (!p.ok) return NaN;
    const n = window.VAL.numeric(p.val);
    return (n === null || n === undefined) ? NaN : n;
  }

  /* 숫자가 하나라도 있는 행만 고를 거리로 내놓습니다 — 날짜 · 자유 텍스트
     행은 선으로 그릴 수 없습니다. */
  function chartableRows(rows, cols) {
    return (rows || []).filter(function (row) {
      if (row.type === "date" || row.type === "text") return false;
      return (cols || []).some(c => isFinite(liveValue(row, c)));
    });
  }

  function paintLive(team, rows, cols) {
    const host = $("#live-host");
    if (!host || !window.Charts) return;
    const C = window.Charts;

    const pool = chartableRows(rows, cols);

    /* 고른 행이 사라졌으면(행 삭제 · 서식 전환) 정리합니다 */
    livePick = livePick.filter(k => pool.some(r => r.k === k));
    if (!livePick.length && pool.length) livePick = [pool[0].k];

    if (!pool.length) {
      host.innerHTML = liveToolbar(pool) +
        '<div class="live-empty">데이터를 입력하면 실시간 그래프가 표시됩니다.<br>' +
        '왼쪽 표의 아무 칸에나 숫자를 적어 보세요.</div>';
      wireLive(team, rows, cols, pool);
      return;
    }

    const picked = livePick.map(k => pool.find(r => r.k === k)).filter(Boolean);
    const x = cols.map(c => c.name);

    const series = picked.map(function (row, i) {
      return { name: row.label + (row.unit ? " (" + row.unit + ")" : ""),
               color: SERIES_COLOR[i % SERIES_COLOR.length],
               data: cols.map(c => liveValue(row, c)) };
    });

    /* ★ '같은 Study 겹쳐 보기' 를 없앴습니다.

       그 기능은 열이 일자였고 배치가 여럿일 때, 다른 배치의 같은 일자를
       덧그리는 것이었습니다. 이제 X축이 이 Study · 팀의 시료 전부라,
       덧그릴 "다른 배치" 가 곧 지금 그리고 있는 열들입니다 — 같은 선을
       한 번 더 그리게 됩니다. */

    const body = liveKind === "bar"
      ? C.bars({ cats: x, series: series, h: 210, w: 380 })
      : C.line({ x: x, series: series, h: 210, w: 380, aria: "입력값 실시간 그래프" });

    const nPend = pendCount();
    host.innerHTML = liveToolbar(pool) +
      '<section class="live-card">' +
        '<h3>' + esc(picked.map(r => r.label).join(" · ") || "선택한 항목 없음") + '</h3>' +
        '<p>X축은 시료(표의 열)입니다 · 값은 표와 같은 경로로 읽습니다</p>' +
        body +
        (series.length > 1 ? C.legend(series) : "") +
      '</section>' +
      '<p class="live-note">' +
        (nPend
          ? '<b>아직 저장하지 않은 값도 그래프에 함께 그립니다.</b> ' +
            '[전체 저장] 을 눌러야 기록됩니다.'
          : '행을 더 고르면 한 그래프에 겹쳐 그립니다. ' +
            '합이 맞아야 하는 항목끼리 나란히 두면 어긋난 것이 바로 보입니다.') +
      '</p>';

    wireLive(team, rows, cols, pool);
  }

  const SERIES_COLOR = ["var(--c-accent)", "#B45309", "#0F766E", "#6D28D9", "#B91C1C", "#1D4ED8"];

  function liveToolbar(pool) {
    const first = livePick[0] || "";
    const extras = livePick.slice(1);
    const opts = pool.map(r => '<option value="' + esc(r.k) + '"' +
      (r.k === first ? " selected" : "") + '>' + esc(r.label) + '</option>').join("");

    return '<div class="live-ctl">' +
      '<div class="live-row">' +
        '<label for="live-pick"><b>항목</b></label>' +
        '<select class="input" id="live-pick">' +
          (pool.length ? opts : '<option value="">— 없음 —</option>') +
        '</select>' +
        '<span class="live-seg" role="group" aria-label="그래프 모양">' +
          '<button type="button" class="live-segb' + (liveKind === "line" ? " is-on" : "") +
            '" data-kind="line" aria-pressed="' + (liveKind === "line") + '">선</button>' +
          '<button type="button" class="live-segb' + (liveKind === "bar" ? " is-on" : "") +
            '" data-kind="bar" aria-pressed="' + (liveKind === "bar") + '">막대</button>' +
        '</span>' +
      '</div>' +

      /* 겹쳐 그릴 행 — 기본은 하나, 필요하면 더합니다 */
      '<div class="live-adds">' +
        extras.map(k => {
          const r = pool.find(x => x.k === k);
          return '<span class="live-chip">' + esc(r ? r.label : k) +
            '<button type="button" data-unpick="' + esc(k) + '" aria-label="빼기">✕</button></span>';
        }).join("") +
        (pool.length > livePick.length
          ? '<select class="input live-add" id="live-add">' +
              '<option value="">+ 항목 추가</option>' +
              pool.filter(r => livePick.indexOf(r.k) === -1)
                  .map(r => '<option value="' + esc(r.k) + '">' + esc(r.label) + '</option>').join("") +
            '</select>'
          : "") +
      '</div>' +
    '</div>';
  }

  function wireLive(team, rows, cols, pool) {
    const host = $("#live-host");
    if (!host) return;
    const redraw = () => { saveLive(); paintLive(team, rows, cols); };

    const pick = host.querySelector("#live-pick");
    if (pick) pick.addEventListener("change", function () {
      livePick = [this.value].concat(livePick.slice(1).filter(k => k !== this.value));
      redraw();
    });
    const add = host.querySelector("#live-add");
    if (add) add.addEventListener("change", function () {
      if (this.value && livePick.indexOf(this.value) === -1) livePick.push(this.value);
      redraw();
    });
    $$("[data-unpick]", host).forEach(b => b.addEventListener("click", function () {
      livePick = livePick.filter(k => k !== b.dataset.unpick);
      redraw();
    }));
    $$("[data-kind]", host).forEach(b => b.addEventListener("click", function () {
      liveKind = b.dataset.kind; redraw();
    }));
  }

  /* 표 그리기 */
  function mountGrid(groups) {
    const host = $("#grid-host");
    if (!host) return;
    mountWorksheet(groups, host);
  }

  function wsDisplay(row, v) {
    if (v === null || v === undefined) return "";
    if (row.type === "date" || row.type === "text") return String(v);
    return window.VAL.format(v);
  }
  function wsMissing(row, v) {
    if (row.type === "date" || row.type === "text") return null;
    return window.VAL.missingInfo(window.VAL.coerce(v));
  }
  function wsMsgKey(rk, ck, kind, lines) {
    /* 항목명과 열 id 에는 사용자가 적은 글자가 들어갑니다 — 따옴표가 섞이면
       선택자가 깨지고, 깨진 선택자는 예외 없이 그냥 "못 찾음" 이 됩니다
       (오류 메시지가 조용히 안 뜨는 길입니다). */
    const id = cssq(rk + "::" + ck);
    const cell = document.querySelector('[data-cell="' + id + '"]');
    if (!cell) return;
    const p = cell.querySelector("[data-msg]");
    const inp = cell.querySelector(".ws-in");
    if (p) {
      p.className = "ws-msg" + (kind ? " is-" + kind : "");
      p.innerHTML = (lines || []).map(esc).join("<br>");
    }
    if (inp) {
      inp.classList.toggle("is-invalid", kind === "error");
      inp.classList.toggle("is-warned", kind === "warn");
    }
  }

  /* 사유 창의 자주 쓰는 문구 목록만 남깁니다 — 화면에는 아무것도 그리지 않습니다.

     ★ 값 칸의 추천값 목록(val-tokens)은 뺐습니다. 칸을 누를 때마다 창이
       열려 아래 칸을 가렸습니다 (worksheet.js 참고). 사유 창의 목록은
       그대로 둡니다 — 거기는 한 번 뜨고 마는 모달이라 가릴 것이 없고,
       문장을 매번 새로 짜게 하면 "수정" 같은 한 단어만 남습니다. */
  function valueHelp() {
    return '<datalist id="reason-presets">' +
        E.REASON_PRESETS.map(t => '<option value="' + esc(t) + '">').join("") +
      '</datalist>';
  }

  /* ── 저장 ─────────────────────────────────────────────────────────────
     이 화면에서 DB 로 값이 나가는 곳은 [전체 저장] 하나뿐입니다. */
  function wireForm(groups) {
    const btn = $("#save-all");
    if (btn) btn.addEventListener("click", function () { saveAll(groups); });
  }

  /* ══════════════════════════════════════════════════════════════════════
     분석 및 시료 관리 — 예전 '분석 의뢰' 화면을 EBR 안으로 옮긴 것

     시료를 넘기는 일은 데이터를 넣는 일과 이어져 있습니다. 배양 값을 적고
     그 자리에서 시료를 분석팀에 넘기는 흐름이라, 별도 메뉴로 떼어 놓으면
     화면을 옮겨 다니게 됩니다.

     의뢰 작성은 여기가 아니라 **입력 폼의 [분석 의뢰하기]** 에서 합니다 —
     어느 배치·시료를 넘기는지가 이미 정해진 자리에서 시작해야 실수가 없습니다.
     ══════════════════════════════════════════════════════════════════════ */
  const Q = window.Requests;
  const TEST_LABEL = {};
  window.DATA_ANALYTE_GROUPS.forEach(g => {
    if (g.team === "analytics" && !g.empty) TEST_LABEL[g.id] = g.label;
  });

  function sampleNames(r) {
    return (r.sampleIds || []).map(function (id) {
      const s = (window.DATA_SAMPLES || []).find(x => x.id === id);
      return s ? s.name : id;
    });
  }

  function dueBadge(r) {
    const d = Q.due(r);
    if (!d) return "";
    const txt = d.state === "over" ? "기한 " + (-d.days) + "일 초과"
              : d.days === 0 ? "오늘 마감" : "D-" + d.days;
    const tone = d.state === "over" ? "risk" : (d.state === "today" || d.state === "soon") ? "warn" : "";
    return '<span class="badge' + (tone ? " badge-" + tone : "") + '" style="font-size:10px">' +
      esc(txt) + '</span>';
  }

  function renderRequests() {
    const sel = window.Scope.get();
    $("#form-host").innerHTML =
      '<div class="track-tabs" style="grid-template-columns:none;display:flex;flex-wrap:wrap;' +
        'margin-bottom:var(--s-4)">' +
        [["queue", "의뢰 큐"], ["storage", "시료 보관"]].map(x =>
          '<button class="track-tab" data-rtab="' + x[0] + '" aria-selected="' + (reqTab === x[0]) + '" ' +
          'style="min-height:36px;padding:0 var(--s-5)">' + esc(x[1]) + '</button>').join("") +
      '</div>' +
      (reqTab === "queue" ? queueView(sel) : storageView(sel));
    wireRequests();
  }

  function queueView(sel) {
    let list = Q.forSelection(sel);
    if (reqFilter === "open") list = list.filter(Q.isOpen);
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
          (reqFilter === "open" ? "진행 중만 보는 중" : "전체 보는 중") + '</button>' +
      '</div>' +
      (list.length ? list.map(reqCard).join("")
        : '<div class="empty"><div class="empty-title">' + esc(L.noResult) + '</div>' +
          '<div class="empty-body">진행 중인 의뢰가 없습니다. ' +
          '팀 서식에서 시료를 고른 뒤 [분석 의뢰하기]로 만들 수 있습니다.</div></div>');
  }

  function reqCard(r) {
    const st = Q.STATUS[r.status];
    const open = reqOpen === r.id;
    const tone = st.tone === "accent" ? "accent" : st.tone === "risk" ? "risk"
               : st.tone === "ok" ? "ok" : "warn";
    return '<section class="card" style="margin-bottom:var(--s-3);border-left:3px solid var(--c-' + tone + ')">' +
      '<div class="card-head" style="flex-wrap:wrap;gap:var(--s-3);cursor:pointer" ' +
        'data-ropen="' + esc(r.id) + '"><div style="min-width:0">' +
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px">' +
          '<span class="mono" style="font-weight:700;font-size:13px">' + esc(r.id) + '</span>' +
          '<span class="badge badge-' + st.tone + '">' + esc(st.ko) + '</span>' +
          (r.priority === "urgent" ? '<span class="badge badge-risk">긴급</span>' : "") +
          dueBadge(r) +
        '</div>' +
        '<h2 class="card-title" style="font-size:14px">' + esc(r.purpose) + '</h2>' +
        '<p class="card-sub">시료 ' + sampleNames(r).map(esc).join(", ") +
          ' · 시험 ' + (r.tests || []).map(t => esc(TEST_LABEL[t] || t)).join(", ") +
          ' · 의뢰 ' + esc(r.requestedBy) + '</p></div>' +
        reqActions(r) +
      '</div>' +
      (open ? reqDetail(r) : "") + '</section>';
  }

  function reqActions(r) {
    const st = Q.STATUS[r.status];
    const btns = [];
    if (st.next) btns.push('<button class="btn btn-accent btn-sm" data-radv="' + esc(r.id) +
      '" data-to="' + st.next + '">' + esc(Q.STATUS[st.next].ko) + ' 처리</button>');
    if (Q.isOpen(r) && r.status !== "requested")
      btns.push('<button class="btn btn-ghost btn-sm" data-rrej="' + esc(r.id) + '">반려</button>');
    if (!btns.length) return "";
    return '<div style="display:flex;gap:var(--s-2);flex-wrap:wrap" onclick="event.stopPropagation()">' +
      btns.join("") + '</div>';
  }

  function reqDetail(r) {
    const kv = (k, v) => '<div class="ebr-cell"><span>' + esc(k) + '</span>' +
      '<div class="mono" style="font-size:13px;padding-top:4px">' + esc(v) + '</div></div>';
    const teamKo = id => { const t = window.DATA_TEAMS.find(x => x.id === id); return t ? t.ko : (id || "—"); };

    return '<div class="card-body" style="border-top:1px solid var(--c-border)">' +
      '<div class="ebr-grid" style="margin-bottom:var(--s-4)">' +
        kv("의뢰자", r.requestedBy + " · " + teamKo(r.requestedTeam)) +
        kv("의뢰일", String(r.requestedAt || "").replace("T", " ")) +
        kv("희망 기한", r.dueAt || "—") +
        kv("담당", r.assignedTo || "미배정") + '</div>' +
      (r.note ? '<p style="font-size:13px;line-height:1.75;margin:0 0 var(--s-4)">' + esc(r.note) + '</p>' : "") +

      '<div class="eyebrow" style="margin-bottom:var(--s-2)">시료</div>' +
      '<div style="display:grid;gap:var(--s-2);margin-bottom:var(--s-4)">' +
        (r.sampleIds || []).map(function (id) {
          const s = (window.DATA_SAMPLES || []).find(x => x.id === id);
          if (!s) return '<div class="drop-file"><span class="mono">' + esc(id) + '</span></div>';
          const st = s.storage;
          return '<div class="drop-file" style="justify-content:flex-start">' +
            '<span class="mono" style="font-weight:600">' + esc(s.name) + '</span>' +
            '<span style="color:var(--c-text-mute)">' + esc(s.stage || "") + '</span>' +
            (st ? '<span class="mono" style="margin-left:auto;color:var(--c-text-mute)">' +
              esc(st.freezer + " " + st.rack + " " + st.box + " " + st.pos) + '</span>' : "") +
            '<button class="btn btn-ghost btn-sm" data-rgo="' + esc(s.batchId) + '|' + esc(s.id) + '">' +
              '결과 입력</button></div>';
        }).join("") + '</div>' +

      '<div class="eyebrow" style="margin-bottom:var(--s-2)">처리 이력</div>' +
      (r.history || []).slice().reverse().map(function (h) {
        const st = Q.STATUS[h.status] || { ko: h.status };
        return '<div class="rail-event">' +
          '<span class="rail-event-bar" style="background:var(--c-accent)"></span>' +
          '<span style="min-width:0;flex:1">' +
            '<span style="display:block;font-size:12.5px;font-weight:500">' + esc(st.ko) + '</span>' +
            '<span class="mono" style="display:block;font-size:10.5px;color:var(--c-text-mute)">' +
              esc(h.by) + ' · ' + esc(String(h.at).replace("T", " ")) + '</span>' +
            (h.note ? '<span style="display:block;font-size:11.5px;color:var(--c-text-mute);' +
              'margin-top:2px">' + esc(h.note) + '</span>' : "") +
          '</span></div>';
      }).join("") + '</div>';
  }

  function storageView(sel) {
    const ids = sel.scopeId ? window.Repo.studiesInScope(sel).map(x => x.id) : null;
    const batches = window.DATA_BATCHES.filter(b => !ids || ids.indexOf(b.studyId) > -1);
    const rows = [];
    batches.forEach(b => window.Repo.samplesOfBatch(b.id).forEach(s => rows.push(s)));
    if (!rows.length) return '<div class="empty"><div class="empty-title">' + esc(L.noResult) + '</div></div>';

    const byFreezer = {};
    rows.forEach(function (s) {
      const f = s.storage ? s.storage.freezer : "미지정";
      (byFreezer[f] = byFreezer[f] || []).push(s);
    });

    return '<label class="ebr-cell" style="max-width:360px;margin-bottom:var(--s-4)">' +
        '<span>시료 · 위치 검색</span>' +
        '<input class="ebr-input" id="st-q" type="search" placeholder="예: B123-3, FR-01, R3, B07"></label>' +
      Object.keys(byFreezer).sort().map(function (f) {
        const list = byFreezer[f];
        return '<section class="card" style="margin-bottom:var(--s-4)">' +
          '<div class="card-head"><div><h2 class="card-title">' + esc(f) + '</h2>' +
          '<p class="card-sub">' + list.length + '개 시료 · -80 °C</p></div></div>' +
          '<div class="tbl-scroll"><table class="tbl"><thead><tr>' +
            '<th scope="col">시료</th><th scope="col">채취 시점</th><th scope="col">위치</th>' +
            '<th scope="col">분취</th><th scope="col">잔량</th><th scope="col">동결-해동</th>' +
            '<th scope="col">의뢰</th><th scope="col"></th></tr></thead><tbody>' +
          list.map(function (s) {
            const st = s.storage || {};
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
              '<td>' + (openReq.length ? '<span class="badge badge-warn" style="font-size:10px">' +
                esc(openReq[0].id) + '</span>' : "—") + '</td>' +
              '<td><button class="btn btn-ghost btn-sm" data-rgo="' + esc(s.batchId) + '|' + esc(s.id) + '">' +
                '결과 입력</button></td></tr>';
          }).join("") + '</tbody></table></div></section>';
      }).join("") +
      '<p style="font-size:11.5px;color:var(--c-text-mute);line-height:1.7">' +
        '동결-해동 2회 이상은 붉게 표시합니다 — 반복 해동은 응집체와 분해산물을 늘립니다.<br>' +
        '보관 위치·잔량은 원본 Excel에 없어 시료 ID에서 생성한 값입니다.</p>';
  }

  function wireRequests() {
    $$("[data-rtab]").forEach(b => b.addEventListener("click", function () {
      reqTab = b.dataset.rtab; render();
    }));
    const f = $("#q-filter");
    if (f) f.addEventListener("click", function () {
      reqFilter = reqFilter === "open" ? "all" : "open"; render();
    });
    $$("[data-ropen]").forEach(b => b.addEventListener("click", function () {
      reqOpen = reqOpen === b.dataset.ropen ? null : b.dataset.ropen; render();
    }));
    $$("[data-radv]").forEach(b => b.addEventListener("click", function (e) {
      e.stopPropagation();
      const r = Q.advance(b.dataset.radv, b.dataset.to, "");
      if (!r.ok) window.alert(r.reason);
      render();
    }));
    $$("[data-rrej]").forEach(b => b.addEventListener("click", function (e) {
      e.stopPropagation();
      const why = window.prompt("반려 사유를 입력하세요\n(사유 없이 돌려보내면 의뢰자가 손쓸 방법이 없습니다)");
      if (why === null) return;
      const r = Q.advance(b.dataset.rrej, "rejected", why);
      if (!r.ok) { window.alert(r.reason); return; }
      render();
    }));
    /* 시료에서 바로 결과 입력으로 — 분석팀의 실제 동선입니다.
       그 시료가 속한 Study 로 옮기고 분석 서식을 엽니다. 표에서 그 시료가
       어느 열인지는 머리글로 찾습니다 — 열을 고르는 드롭다운이 더 이상
       없으므로, 여기서 지정할 수 있는 것은 Study · 팀까지입니다. */
    $$("[data-rgo]").forEach(b => b.addEventListener("click", function (e) {
      e.stopPropagation();
      const bid = b.dataset.rgo.split("|")[0];
      const bat = (window.DATA_BATCHES || []).find(x => x.id === bid);
      mode = "form";
      location.hash = "";
      if (bat && bat.studyId) window.Scope.setStudy(bat.studyId);
      window.Scope.setTeam("analytics");
      render();
    }));
    const q = $("#st-q");
    if (q) q.addEventListener("input", function () {
      const term = this.value.trim().toLowerCase();
      $$("[data-strow]").forEach(function (tr) {
        tr.style.display = (!term || tr.dataset.strow.indexOf(term) > -1) ? "" : "none";
      });
    });
  }
  /* ── 급변 · 편차 경고 ───────────────────────────────────────────────────
     같은 Study · 팀의 다른 시료와 견줍니다. 자리수나 단위를 틀리면 혼자
     한참 떨어져 있어, 적는 자리에서 바로 보입니다.

     ★ 견주는 대상이 "같은 Study 의 다른 배치" 에서 "같은 Study · 팀의 다른
       시료" 로 바뀌었습니다. 열이 시료가 되면서 그 둘이 같은 것이 됐습니다.

     ★ 저장된 값만 견줍니다. 아직 저장 전인 옆 칸까지 끌어오면, 같은 오타를
       두 칸에 적었을 때 서로를 근거로 "정상" 이라고 말하게 됩니다. */
  function warningsFor(f, val, it) {
    const n = window.VAL.numeric(val);
    if (n === null || !it) return [];

    const sel = window.Scope.get();
    const ctx = { value: n, cumulative: !!it.cumulative, prev: null, peers: [] };

    ctx.peers = savedCols(sel.studyId, sel.team)
      .map(function (c) {
        const rec = E.getValue("batch:" + c.bid, f.k);
        return rec ? window.VAL.numeric(window.VAL.coerce(rec.value)) : null;
      })
      .filter(v => v !== null);

    return window.VAL.trendWarnings(ctx);
  }

  /* 떠 있는 창을 기준 요소 옆에 둡니다. 화면 밖으로 나가지 않게 접어 넣되,
     기준 요소를 가리지는 않도록 아래를 먼저 시도합니다. */
  function placePop(pop, anchor) {
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 10) {
      const above = r.top - h - 6;
      top = above > 10 ? above : Math.max(10, window.innerHeight - h - 10);
    }
    pop.style.top = top + "px";
    pop.style.left = Math.max(10, Math.min(r.left, window.innerWidth - w - 10)) + "px";
  }

  /* ── 변경 이력 팝오버 ───────────────────────────────────────────────── */
  /* 올려서 본 팝오버만 닫습니다 — 눌러서 고정한 것은 그대로 둡니다 */
  function closeHoverHistory() {
    const p = document.getElementById("hist-pop");
    if (p && p.dataset.sticky !== "1") p.remove();
  }

  function showHistory(anchor, rec, f, sticky) {
    const old = document.getElementById("hist-pop");
    /* 이미 고정된 창이 있으면 스쳐 지나가는 마우스로 갈아치우지 않습니다 */
    if (old && old.dataset.sticky === "1" && !sticky) return;
    if (old) old.remove();
    if (!rec) return;
    const label = f && f.label;
    const show = v => (v === null || v === undefined) ? L.empty
      : (isMeasure(f || {}) ? window.VAL.format(v) : String(v));

    const r = anchor.getBoundingClientRect();
    const pop = document.createElement("div");
    pop.className = "pop";
    pop.id = "hist-pop";
    pop.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--s-3)">' +
        '<strong style="font-size:12.5px">' + esc(label || "") + ' 변경 이력</strong>' +
        '<button class="btn-icon" id="hist-close" aria-label="닫기" style="width:24px;height:24px">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2.6"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>' +
      '<div class="pop-row"><span style="color:var(--c-text-mute)">현재 값</span>' +
        '<span class="pop-val">' + esc(show(rec.value)) + '</span>' +
        '<span style="color:var(--c-text-mute)">' + esc(E.caption(rec)) + '</span></div>' +
      rec.history.slice().reverse().map(h =>
        '<div class="pop-row">' +
          '<span><span class="pop-val">' + esc(show(h.previousValue)) + '</span>' +
          (h.previousSource
            ? ' <span style="font-size:10px;color:var(--c-text-mute)">(' + esc(h.previousSource) + ')</span>'
            : "") +
          ' <span class="pop-arrow">→</span> </span>' +
          '<span style="color:var(--c-text-mute)">' + esc(h.changedBy) + ' · ' +
          esc(E.stampHuman(h.changedAt)) + '</span>' +
          '<span style="color:var(--c-text-mute)">사유: ' +
            esc(h.reason || "(기록 없음 — 사유 필수화 이전 기록)") + '</span>' +
        '</div>').join("") +
      '<div style="font-size:10.5px;color:var(--c-text-mute);margin-top:var(--s-3);line-height:1.7">' +
        '원본 값은 삭제되지 않고 모두 보존됩니다. 값을 바꾸려면 사유가 필요합니다.</div>';

    pop.dataset.sticky = sticky ? "1" : "0";
    pop.classList.toggle("is-hover", !sticky);
    document.body.appendChild(pop);
    placePop(pop, anchor);

    /* 올려서 본 창은 닫기 버튼도 필요 없고, 창 위로 마우스를 옮기면
       읽는 중이라는 뜻이므로 닫지 않습니다. */
    const closeBtn = pop.querySelector("#hist-close");
    if (!sticky) {
      if (closeBtn) closeBtn.remove();
      pop.addEventListener("mouseenter", function () { pop.dataset.hoverIn = "1"; });
      pop.addEventListener("mouseleave", function () { pop.remove(); });
      return;
    }

    if (closeBtn) closeBtn.addEventListener("click", () => pop.remove());
    setTimeout(() => {
      document.addEventListener("click", function h(e) {
        if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener("click", h); }
      });
    }, 0);
  }

  /* ── 서브메뉴: 팀 전환 ──────────────────────────────────────────────── */
  function paintSubnav() {
    const sel = window.Scope.get();
    const openReq = window.Requests.forSelection(sel).filter(window.Requests.isOpen).length;
    window.Shell.subnav([
      { label: "팀 서식", items: window.DATA_TEAMS.map(t => ({
        key: t.id, ko: t.ko, active: mode === "form" && sel.team === t.id, color: t.color })) },
      { label: "인계", items: [
        { key: "__requests", ko: "분석 및 시료 관리",
          active: mode === "requests", count: openReq || null, color: "#0F766E" }
      ]},
      { label: "바로가기", items: [
        { ko: "대시보드", href: "dashboard.html" },
        { ko: "데이터 조회", href: "data.html" },
        { ko: "DoE & Intelligence", href: "hub.html" }
      ]}
    ], function (k) {
      if (k === "__requests") { mode = "requests"; location.hash = "requests"; render(); return; }
      mode = "form";
      if (location.hash) location.hash = "";
      /* ★ Study 가 없으면 팀을 정하지 않습니다.

         계층은 과제 → Study → 팀 → Sample 입니다. 그런데 이 사이드바는
         Study 를 거치지 않고 팀을 바로 세웠습니다. 그래서 Study 는 "전체"
         인데 팀만 '배양공정팀' 으로 켜진, 위 선택기(팀 드롭다운이 Study
         전에는 잠겨 있는)와 앞뒤가 안 맞는 상태가 만들어졌습니다.

         팀만 정해진 상태는 가리키는 대상이 없습니다 — 어느 Study 에
         기록할지가 비어 있으니까요. 그래서 고르지 않고 안내만 바꿉니다. */
      if (!window.Scope.get().studyId) { render(); return; }
      window.Scope.setTeam(k);
      render();
    });
  }

  /* ★ 조회 바가 아니라 기록 대상 선택만 둡니다.
     여기는 데이터를 찾는 화면이 아니라 기록하는 화면입니다. 검색어 ·
     기간 · 정렬 · 진행 상태 · 조회/초기화 · 조건 태그는 이 화면에서 할
     일이 없는데도 자리를 차지하고, 입력 폼을 화면 아래로 밀어냅니다.

     남겨 둔 것은 Study 와 팀 둘뿐입니다 — 계층이 Study → 팀 → Sample 이고,
     Sample 은 아래 표의 열이라 여기서 고를 것이 없습니다. */
  window.StudySelector.mount($("#selector"), { mode: "pick" });
  window.Scope.subscribe(function () { pendPair = null; render(); });
  window.Entries.subscribe(render);

  /* 다른 탭에서 바뀐 것 · 레코드가 늘어난 것도 받습니다 —
     값 변경은 Entries 가, Study·Batch 추가는 Repo 가 알려 줍니다. */
  if (window.Repo && window.Repo.subscribe) {
    window.Repo.subscribe(function (what) {
      if (what === "remote" || what === "dataset") render();
    });
  }
  window.Requests.subscribe(render);
  render();
})();
