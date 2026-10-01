/* ==========================================================================
   Data 입력  [지시서 §1 §3 §5]

   대상 지정 순서: 과제 → Study → 팀 → Batch → Sample
     · 네 단계를 모두 지정해야 폼이 열립니다
     · 팀을 고르기 전에는 폼이 열리지 않습니다 (저장 불가)

   팀에 따라 입력 필드 세트가 자동 전환됩니다.
   모든 필드는 저장 시 작성자·시각(초 단위)이 함께 기록되며, 수정해도 이전 값을
   덮어쓰지 않고 이력으로 쌓입니다 (Entries).

   값의 우선순위: 사용자가 입력한 값(Entries) > Excel 원본 값
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

  let batchId = null;
  let sampleId = null;      // null = Batch 단위 입력


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
      if (!batchId) return null;
      const b = (window.DATA_BATCHES || []).find(x => x.id === batchId);
      return b ? (b.expNo || b.id) : batchId;
    });
    window.AIContext.provide("ebr", function () {
      return { batchId: batchId, sampleId: sampleId, mode: mode,
               입력중: !!batchId };
    });
  }
  let reqTab = "queue";     // "queue" | "storage"
  let reqOpen = null;
  let reqFilter = "open";

  /* ── 팀별 필드 세트 ─────────────────────────────────────────────────── */
  const FIELDS = {
    upstream: function () {
      const days = window.DATA_TITER_DAYS.filter(d =>
        window.DATA_BATCHES.some(b => (b.upstream?.titer?.[d] ?? null) !== null));
      return [
        { g: "배양 지표", items: [
          { k: "ivcd",           label: "IVCD",            unit: "10⁶ cells/mL", dp: 1, src: ["upstream","ivcd"] },
          { k: "maxVCD",         label: "Max VCD",         unit: "10⁶ cells/mL", dp: 2, src: ["upstream","maxVCD"] },
          { k: "finalVCD",       label: "Final VCD",       unit: "10⁶ cells/mL", dp: 2, src: ["upstream","finalVCD"] },
          { k: "finalViability", label: "Final Viability", unit: "%",            dp: 1, src: ["upstream","finalViability"] }
        ]},
        { g: "Titer (일자별)", items: days.map(d => ({
            k: "titer_" + d, label: "Titer " + d, unit: "mg/L", dp: 0, src: ["titer", d] })) },
        { g: "Harvest", items: [
          { k: "titerHCCF", label: "Titer HCCF", unit: "mg/L",        dp: 1, src: ["upstream","titerHCCF"] },
          { k: "qP",        label: "qP",         unit: "pg/cell·day", dp: 2, src: ["upstream","qP"] },
          { k: "harvestDate", label: "Harvest 일자", unit: "", type: "date", src: ["meta","endDate"] }
        ]}
      ];
    },
    /* 정제 항목은 studies.js 의 downstream 그룹 스키마를 그대로 씁니다.
       화면마다 필드를 따로 적어 두면 대시보드 · 데이터 조회 · EBR 이
       서로 다른 항목을 보여주게 됩니다. */
    downstream: function () {
      const g = window.DATA_ANALYTE_GROUPS.find(x => x.id === "downstream");
      if (!g || !g.items.length) return [];
      const pick = keys => g.items.filter(it => keys.indexOf(it.key) > -1).map(it => ({
        k: "downstream_" + it.key, label: it.label, unit: it.unit, dp: it.dp,
        src: ["downstream", it.key]
      }));
      return [
        { g: "단계별 수율",   items: pick(["proteinAYield", "cexYield", "aexYield", "totalYield"]) },
        { g: "순도 · 불순물", items: pick(["monomerPurity", "hcp", "residualDNA"]) },
        { g: "정제 기록", items: [
          { k: "dsResin", label: "Resin",       unit: "", type: "text" },
          { k: "dsNote",  label: "특이사항",    unit: "", type: "text" }
        ]}
      ];
    },
    analytics: function () {
      return window.DATA_ANALYTE_GROUPS
        .filter(g => g.team === "analytics" && !g.empty)
        .map(g => ({ g: g.label, items: g.items.map(it => ({
          k: g.id + "_" + it.key, label: it.label, unit: it.unit, dp: it.dp,
          src: [g.id, it.key], spec: true
        })) }));
    }
  };

  /* ── 값 조회 — Entries 우선, 없으면 Excel ───────────────────────────── */
  function scopeKey() { return sampleId ? "sample:" + sampleId : "batch:" + batchId; }

  function currentSample() {
    if (!sampleId) return null;
    return window.Repo.samplesOfBatch(batchId).find(s => s.id === sampleId) || null;
  }

  function excelValue(batch, src) {
    if (!src || !batch) return null;
    if (src[0] === "upstream")   return batch.upstream?.[src[1]] ?? null;
    if (src[0] === "titer")      return batch.upstream?.titer?.[src[1]] ?? null;
    if (src[0] === "downstream") return batch.downstream?.[src[1]] ?? null;
    if (src[0] === "meta")       return batch[src[1]];
    /* 분석 항목 — 값은 시료에 붙습니다 */
    const s = currentSample();
    if (!s || !s.analytics) return null;
    const g = s.analytics[src[0]];
    return g ? g[src[1]] : null;
  }

  function effective(batch, f) {
    const rec = E.getValue(scopeKey(), f.k);
    if (rec) return { value: rec.value, rec, fromExcel: false };
    /* 배양·정제는 배치 속성이라 Sample 을 골랐어도 배치 값을 물려받지 않습니다.
       분석은 시료 속성이므로 고른 시료의 원본 값을 보여줍니다. */
    const isAnalytics = f.src && ["upstream", "titer", "downstream", "meta"].indexOf(f.src[0]) === -1;
    if (sampleId && !isAnalytics) return { value: null, rec: null, fromExcel: false };
    if (!sampleId && isAnalytics) return { value: null, rec: null, fromExcel: false };
    return { value: excelValue(batch, f.src), rec: null, fromExcel: true };
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
    paintSubnav();

    $("#crumb").innerHTML = desc.path.length
      ? desc.path.map((p, i) => (i ? '<span class="crumb-sep">›</span>' : "") +
          '<span>' + esc(p.label) + '</span>').join("") +
        (batchId ? '<span class="crumb-sep">›</span><span class="mono">' + esc(batchId) + '</span>' : "") +
        (sampleId ? '<span class="crumb-sep">›</span><span>' +
          esc((E.getSamples(batchId).find(s => s.id === sampleId) || {}).name || "") + '</span>' : "")
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
      gate("좌측 필터에서 Study를 선택하세요."); return;
    }
    if (!sel.team) {
      gate("팀을 선택해야 입력 폼이 열립니다. (팀 미지정 상태에서는 저장할 수 없습니다)"); return;
    }

    window.Scope.batches().then(function (batches) {
      if (my !== renderSeq) return;          // 더 최근 렌더가 이미 그렸습니다
      /* 새로 만든 Study 에는 아직 배치가 없습니다. 막다른 안내로 끝내지 않고
         바로 만들 수 있게 합니다 — 여기서 길이 끊기면 방금 만든 Study 가
         쓸 수 없는 채로 남습니다. */
      if (!batches.length) {
        gate("이 Study 에는 아직 Batch 가 없습니다. 위 [+ 새 Batch] 로 만들면 " +
             "입력 표가 열립니다.");
        return;
      }
      if (!batchId || !batches.some(b => b.id === batchId)) batchId = batches[0].id;
      const batch = batches.find(b => b.id === batchId);
      const samples = window.Repo.samplesOfBatch(batchId);
      if (sampleId && !samples.some(s => s.id === sampleId)) sampleId = null;

      /* 분석 서식은 시료를 골라야 열립니다 — 분석값은 배치가 아니라
         특정 시료의 측정 결과라, 배치에 저장하면 어느 시료 값인지 잃습니다.
         시료가 하나뿐이면 자동으로 그것을 잡아 클릭 한 번을 아낍니다. */
      const isAnalyticsTeam = sel.team === "analytics";
      if (isAnalyticsTeam && !sampleId && samples.length === 1) sampleId = samples[0].id;
      if (isAnalyticsTeam && !sampleId) {
        gateSample(batches, samples);
        return;
      }

      const groups = FIELDS[sel.team]();
      const teamKo = (window.DATA_TEAMS.find(t => t.id === sel.team) || {}).ko || sel.team;
      const smp = currentSample();

      $("#form-host").innerHTML =
        '<section class="card" style="border-top:3px solid ' +
          ((window.DATA_TEAMS.find(t => t.id === sel.team) || {}).color || "var(--c-accent)") + '">' +
          '<div class="card-head" style="flex-wrap:wrap;gap:var(--s-3)">' +
            '<div><h2 class="card-title">' + esc(teamKo) + ' 서식</h2>' +
            '<p class="card-sub">' +
              (isAnalyticsTeam
                ? '시료 <b>' + esc(smp ? smp.name : "") + '</b> 단위 입력' +
                  (smp && smp.stage ? ' · ' + esc(smp.stage) : "")
                : sampleId ? esc(L.ui.sampleName) + " 단위 입력" : "Batch 단위 입력") +
            ' · 저장 시 작성자와 시각이 자동 기록됩니다</p></div>' +
            targetPicker(batches, samples) +
          '</div>' +

          (isAnalyticsTeam
            ? '<div class="card-body" style="padding-bottom:0"><div class="demo-note">' +
              '분석 결과는 <b>시료</b>에 기록됩니다. 같은 배치에서 채취한 다른 시료는 ' +
              '위 시료 선택으로 전환하세요 — 배치 하나에 여러 시료의 값을 나란히 남길 수 있습니다.' +
              '</div></div>' : "") +

          (sel.team === "downstream"
            ? '<div class="card-body" style="padding-bottom:0"><div class="demo-note">' +
              '정제 공정 값은 Protein A → CEX → AEX 3-step 기준입니다. ' +
              '수정하면 기존 값을 덮어쓰지 않고 변경 이력으로 쌓입니다.</div></div>' : "") +

          valueHelp() +
          window.Calc.panel(sel.team) +
          lotStrip(batch) +

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
            '<span style="font-size:12px;color:var(--c-text-mute)">' +
              '값을 바꾸고 필드를 벗어나면 즉시 저장됩니다. 이 버튼은 일괄 저장용입니다.</span>' +
            '<span id="save-msg" style="font-size:12px;color:var(--c-ok);font-weight:600"></span>' +
          '</div>' +
        '</section>';

      mountGrid(batch, groups);
      wireForm(batch, groups, batches);
    });
  }

  function gate(msg) {
    $("#form-host").innerHTML = '<div class="gate">' +
      '<p style="font-size:13.5px;color:var(--c-text-mute);margin:0">' + esc(msg) + '</p></div>';
  }

  /* 분석 서식 진입 전 시료 선택 — 시료가 여럿일 때만 나옵니다 */
  function gateSample(batches, samples) {
    $("#form-host").innerHTML =
      '<section class="card"><div class="card-head"><div>' +
        '<h2 class="card-title">시료를 선택하세요</h2>' +
        '<p class="card-sub">분석 결과는 배치가 아니라 시료에 기록됩니다 — ' +
        '어느 시료를 측정한 값인지 남기기 위해서입니다</p></div>' +
        targetPicker(batches, samples) + '</div>' +
      '<div class="card-body">' +
        (samples.length
          ? '<div style="display:grid;gap:var(--s-2)">' + samples.map(s =>
              '<button class="selector-result" data-smp="' + esc(s.id) + '">' +
                '<span style="flex:1;min-width:0">' +
                  '<span class="selector-result-name">' + esc(s.name) + '</span>' +
                  '<span class="selector-result-meta">' +
                    esc(s.stage || "채취 시점 미입력") +
                    (s.collectedAt ? " · " + esc(s.collectedAt) : "") +
                    (s.note ? " · " + esc(s.note) : "") + '</span></span>' +
                '<span class="badge' + (s.source === "user" ? " badge-accent" : "") + '" ' +
                  'style="font-size:10px">' +
                  (s.source === "user" ? "직접 등록" : s.primary ? "기본 시료" : "추가 시료") +
                '</span></button>').join("") + '</div>'
          : '<div class="empty"><div class="empty-title">이 배치에 등록된 시료가 없습니다</div>' +
            '<div class="empty-body">위 [' + esc(L.ui.addSample) + '] 로 시료를 먼저 만드세요.</div></div>') +
      '</div></section>';

    wireTarget(batches);
    $$("[data-smp]", $("#form-host")).forEach(b => b.addEventListener("click", function () {
      sampleId = b.dataset.smp;
      render();
    }));
  }

  /* Batch / Sample 선택 + Sample 생성 */
  function targetPicker(batches, samples) {
    const analytics = window.Scope.get().team === "analytics";
    return '<div style="display:flex;gap:var(--s-3);align-items:end;flex-wrap:wrap">' +
      '<label class="ebr-cell" style="min-width:130px"><span>Batch</span>' +
        '<select class="ebr-input" id="pick-batch">' +
          batches.map(b => '<option value="' + esc(b.id) + '"' +
            (b.id === batchId ? " selected" : "") + '>' + esc(b.id) + '</option>').join("") +
        '</select></label>' +
      '<label class="ebr-cell" style="min-width:190px"><span>시료 (' + samples.length + '건)</span>' +
        '<select class="ebr-input" id="pick-sample">' +
          /* 분석 서식에서는 "Batch 단위" 선택지를 주지 않습니다 —
             고를 수 있게 두면 시료에 붙어야 할 값이 배치로 새어 들어갑니다. */
          (analytics ? '<option value="">— 시료 선택 —</option>' : '<option value="">— Batch 단위 —</option>') +
          samples.map(s => '<option value="' + esc(s.id) + '"' +
            (s.id === sampleId ? " selected" : "") + '>' + esc(s.name) +
            (s.stage ? " · " + esc(s.stage) : "") + '</option>').join("") +
        '</select></label>' +
      '<button class="btn btn-ghost btn-sm" id="new-batch">+ 새 Batch</button>' +
      '<button class="btn btn-ghost btn-sm" id="new-sample">' + esc(L.ui.addSample) + '</button>' +
      /* 시료를 넘기는 동작은 어느 배치·시료인지 정해진 이 자리에서 시작해야
         실수가 없습니다. 그래서 별도 화면이 아니라 여기 모달로 둡니다. */
      '<button class="btn btn-ghost btn-sm" id="req-open" style="border-color:#0F766E;color:#0F766E">' +
        '분석 의뢰하기</button>' +
    '</div>';
  }

  /* Batch·Sample 선택은 폼이 있든 없든 같은 방식으로 동작해야 합니다 */
  function wireTarget(batches) {
    const pb = $("#pick-batch");
    if (pb) pb.addEventListener("change", function () {
      batchId = this.value; sampleId = null; render();
    });
    const ps = $("#pick-sample");
    if (ps) ps.addEventListener("change", function () {
      sampleId = this.value || null; render();
    });
    const nb = $("#new-batch");
    if (nb) nb.addEventListener("click", () => openNewBatch());
    const ns = $("#new-sample");
    if (ns) ns.addEventListener("click", function () {
      const batch = batches.find(b => b.id === batchId);
      const name = window.prompt("시료 이름을 입력하세요\n(예: " + batchId + "-S2, AEX 용출 후)");
      if (name === null) return;
      const r = E.addSample({ batchId, studyId: batch ? batch.studyId : null, name });
      if (!r.ok) { window.alert(r.reason); return; }
      sampleId = r.sample.id;
      render();
    });
    const ro = $("#req-open");
    if (ro) ro.addEventListener("click", function () {
      const batch = batches.find(b => b.id === batchId);
      if (!batch) return;
      openRequestModal(batch, window.Repo.samplesOfBatch(batchId));
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     신규 Study · Batch 등록

     드롭다운에 없는 것을 고르려다 없는 걸 알게 되는 자리가 여기입니다.
     그 자리에서 바로 만들 수 있어야 화면을 옮겨 다니지 않습니다.

     ★ 측정값은 지어내지 않습니다. 새 Batch 의 모든 항목은 null 이고 화면에
       "미입력" 으로 나옵니다. 다만 키는 씨앗과 똑같이 채워 둡니다 —
       upstream.titer.D10 이 아예 없으면 그걸 읽는 화면이 멈춥니다.

     ★ 어디서 온 레코드인지 남깁니다 (source: "user"). Excel 에서 온 것과
       사람이 만든 것을 구분할 수 없으면, 나중에 원본과 대조할 때 무엇을
       맞춰 봐야 하는지 알 수 없습니다.
     ══════════════════════════════════════════════════════════════════════ */
  function entityBar() {
    const sel = window.Scope.get();
    if (!sel.scopeId) return "";
    return '<div class="entity-bar">' +
      '<span>드롭다운에 없나요?</span>' +
      '<button class="btn btn-ghost btn-sm" id="new-study">+ 새 Study</button>' +
      (sel.studyId
        ? '<button class="btn btn-ghost btn-sm" id="new-batch-2">+ 새 Batch</button>'
        : '<span class="entity-hint">Study 를 고르면 Batch 도 만들 수 있습니다</span>') +
    '</div>';
  }
  function wireEntityBar() {
    const a = $("#new-study");
    if (a) a.addEventListener("click", () => openNewStudy());
    const b = $("#new-batch-2");
    if (b) b.addEventListener("click", () => openNewBatch());
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

  function openNewStudy() {
    const sel = window.Scope.get();
    const prj = (window.DATA_PROJECTS || []).find(p => p.id === sel.scopeId);
    entityModal("새 Study 등록",
      (prj ? prj.label || prj.id : sel.scopeId) + " 아래에 만듭니다",
      field("name", "Study 이름", { req: true, ph: "예: Feed 조건 비교 2차" }) +
      field("type", "유형", { ph: "예: Media screening · DoE", hint: "비워 두면 '직접 등록'" }) +
      field("id", "Study ID", { ph: "비워 두면 자동 생성", hint: "사내 번호가 있으면 적으세요" }),
      function (data) {
        const r = window.Dataset.addStudy({
          projectId: sel.scopeId, name: data.name, type: data.type, id: data.id });
        if (r.ok) window.Scope.setStudy(r.study.id);
        return r;
      });
  }

  function openNewBatch() {
    const sel = window.Scope.get();
    if (!sel.studyId) { window.alert("Study 를 먼저 선택하세요."); return; }
    const study = (window.DATA_STUDIES || []).find(s => s.id === sel.studyId);
    const today = window.HubCalendar ? window.HubCalendar.today() : "";
    entityModal("새 Batch 등록",
      (study ? study.name : sel.studyId) + " 아래에 만듭니다",
      field("id", "Batch ID", { req: true, ph: "예: B123-13", hint: "비워 두면 자동 생성" }) +
      field("expNo", "Exp. No.", { ph: "비워 두면 Batch ID 와 같게" }) +
      field("team", "팀", { value: sel.team || "upstream",
        options: (window.DATA_TEAMS || []).map(t => [t.id, t.ko]) }) +
      field("initialDate", "Initial Date", { type: "date", value: today }) +
      field("endDate", "End Date", { type: "date" }),
      function (data) {
        const r = window.Dataset.addBatch({
          studyId: sel.studyId, id: data.id, expNo: data.expNo, team: data.team,
          initialDate: data.initialDate || null, endDate: data.endDate || null });
        if (r.ok) batchId = r.batch.id;
        return r;
      });
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

  /* 화면에 보이던 초기값 — 이걸 바꾸려면 사유가 필요하고,
     바뀌면 이 값이 이력 첫 항목으로 보존됩니다. */
  /* ★ 화면이 "Excel 원본" 이라고 보여 준 값은 바꿀 때 사유를 받아야 합니다.

     예전에는 시료를 고른 상태면 무조건 null 을 돌려줬습니다. 배양·정제
     항목은 배치 속성이라 그게 맞지만, 분석 항목은 시료 속성이고 effective()
     가 그 시료의 Excel 값을 보여 줍니다. 그래서 화면에는 0.2 가 "Excel 원본"
     으로 떠 있는데, 고쳐도 사유를 묻지 않고 이력도 남지 않은 채 새 값으로
     저장됐습니다 — 원본이 조용히 사라지는 경로였습니다.

     effective() 와 같은 기준으로 판단합니다. 두 곳이 다른 기준을 쓰면
     "보여 주는 값" 과 "지켜야 할 값" 이 어긋납니다. */
  function isSampleScoped(f) {
    return !!(f.src && ["upstream", "titer", "downstream", "meta"].indexOf(f.src[0]) === -1);
  }
  function baseValueOf(batch, f) {
    /* 시료를 골랐는데 배치 항목이면 물려받지 않습니다 */
    if (sampleId && !isSampleScoped(f)) return null;
    /* 시료를 안 골랐는데 시료 항목이면 볼 원본이 없습니다 */
    if (!sampleId && isSampleScoped(f)) return null;
    const raw = excelValue(batch, f.src);
    if (raw === null || raw === undefined) return null;
    return isMeasure(f) ? window.VAL.coerce(raw) : raw;
  }

  function originLabel(f) {
    /* 정제 항목은 Excel 에 없는 컬럼이라 "Excel 원본" 이라고 쓰면 거짓말이 됩니다. */
    return (f.src && f.src[0] === "downstream") ? "초기값" : "Excel 원본";
  }

  function displayValue(f, v) {
    if (!isMeasure(f)) return (v === null || v === undefined) ? "" : String(v);
    return window.VAL.toInput(v);
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

     한 행이 한 셀입니다 — data-cell 이 행에 붙습니다. setMsg · openReason ·
     revert · closeReason 이 모두 cellOf(k) 로 이 행을 찾으므로, 기존 저장
     경로는 그대로입니다.
     ══════════════════════════════════════════════════════════════════════ */
  /* ══════════════════════════════════════════════════════════════════════
     워크시트 — 원본 엑셀과 같은 배열

     항목이 왼쪽에 세로로 서고 오른쪽으로 시점(또는 시료)이 늘어납니다.
     열이 무엇인가는 팀마다 다릅니다.

       배양   배양 경과 일자 (D10 · D11 …)   하루에 한 번 재는 값
       분석   시료 (SMP-…)                    시료마다 한 번 재는 값
       정제   단일 열                          배치당 한 번 재는 값

     사용자가 축을 바꿀 수 있습니다 — 실제 실험이 늘 이 셋으로 떨어지지는
     않습니다.

     ★ 저장 경로는 그대로입니다.
       기존 스키마 항목은 원래 쓰던 키로 저장합니다 (일자별 Titer 는
       titer_D10 …, 분석은 시료 범위의 seHPLC_hmw …). 그래야 조회 ·
       대시보드 · AI 가 같은 값을 봅니다.
       사용자가 행추가로 만든 항목만 ws_<행>@<열> 로 따로 담고, 그 값은
       이 화면 안에서만 씁니다 — 다른 화면이 모르는 항목이기 때문입니다.
     ══════════════════════════════════════════════════════════════════════ */
  const AXIS_KEY = "hub.ws.axis";
  const CUSTOM_KEY = "hub.ws.rows";

  function axisFor(team) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(AXIS_KEY) || "{}")[team]; } catch (e) {}
    if (saved) return saved;
    return team === "upstream" ? "day" : team === "analytics" ? "sample" : "single";
  }
  function setAxis(team, v) {
    let m = {};
    try { m = JSON.parse(localStorage.getItem(AXIS_KEY) || "{}"); } catch (e) {}
    m[team] = v;
    try { localStorage.setItem(AXIS_KEY, JSON.stringify(m)); } catch (e) {}
  }
  /* 사용자가 만든 행 — 배치·팀별로 따로 둡니다 */
  function customRows(team, bid) {
    try {
      const m = JSON.parse(localStorage.getItem(CUSTOM_KEY) || "{}");
      return m[team + "|" + bid] || [];
    } catch (e) { return []; }
  }
  function saveCustomRows(team, bid, list) {
    let m = {};
    try { m = JSON.parse(localStorage.getItem(CUSTOM_KEY) || "{}"); } catch (e) {}
    m[team + "|" + bid] = list;
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(m)); } catch (e) {}
  }
  /* 사용자가 늘린 열 (기본 열 뒤에 붙습니다)

     ★ 예전에는 개수만 담았습니다. 열을 지울 수 있게 되면서 개수로는 "셋 중
       둘째를 지웠다"를 담을 수 없어 목록으로 바꿨습니다. 이미 저장된 개수는
       X1 … Xn 목록으로 읽어 들여, 앞서 적어 둔 값이 미아가 되지 않게 합니다.

     새 열의 id 는 시각에서 만듭니다. X1 처럼 자리 번호를 id 로 쓰면 X1 을
     지우고 다시 만든 열이 지워진 열의 값과 이름을 물려받습니다. */
  function extraCols(team, bid) {
    try {
      const m = JSON.parse(localStorage.getItem(CUSTOM_KEY + ".cols") || "{}");
      const v = m[team + "|" + bid];
      if (Array.isArray(v)) return v.slice();
      const out = [];
      for (let i = 0; i < (typeof v === "number" ? v : 0); i++) out.push("X" + (i + 1));
      return out;
    } catch (e) { return []; }
  }
  function saveExtraCols(team, bid, list) {
    let m = {};
    try { m = JSON.parse(localStorage.getItem(CUSTOM_KEY + ".cols") || "{}"); } catch (e) {}
    m[team + "|" + bid] = list;
    try { localStorage.setItem(CUSTOM_KEY + ".cols", JSON.stringify(m)); } catch (e) {}
  }
  function addExtraCol(team, bid) {
    const list = extraCols(team, bid);
    const id = "x" + Date.now().toString(36);
    list.push(id);
    saveExtraCols(team, bid, list);
    return id;
  }

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

  function mountGrid(batch, groups) {
    const host = $("#grid-host");
    if (!host) return;
    if (window.Worksheet) { mountWorksheet(batch, groups, host); return; }
    if (!window.DataGrid) return;

    window.DataGrid.mount(host, {
      groups: groups,

      /* 한 칸을 그리는 데 필요한 것만 넘깁니다 — 값·표시문자열·출처·결측·
         수정 여부. 저장소 구조는 DataGrid 가 알 필요가 없습니다. */
      cell: function (f) {
        const eff = effective(batch, f);
        const v = eff.value;
        const rec = eff.rec;
        const measure = isMeasure(f);
        const cur = measure ? window.VAL.coerce(v) : null;
        return {
          display: displayValue(f, v),
          origin: rec ? E.caption(rec)
                : (eff.fromExcel && v !== null && v !== undefined ? originLabel(f) : null),
          missing: measure ? window.VAL.missingInfo(cur) : null,
          bounded: measure && window.VAL.isBounded(cur),
          edited: !!(rec && E.hasHistory(rec)),
          editCount: rec && rec.history ? rec.history.length : 0,
          pin: pinMark(batch, f)
        };
      },

      onCommit: function (f, raw) {
        const r = commit(batch, f, raw);
        if (r === "saved") render();
        return r;
      },
      onRevert: function (f) { revert(batch, f); },

      /* anchor 가 null 이면 "닫아 달라" 는 뜻입니다 (마우스가 벗어남) */
      onHistory: function (anchor, f, sticky) {
        if (!anchor) { closeHoverHistory(); return; }
        showHistory(anchor, E.getValue(scopeKey(), f.k), f, sticky);
      }
    });
  }

  /* ── 워크시트 축 만들기 ──────────────────────────────────────────────
     열은 { id, label, sub, scope, dayKey } 입니다.
       scope  이 열의 값이 어느 저장 범위에 들어가는가 ("batch:…"/"sample:…")
       dayKey 일자 축일 때 기존 스키마의 일자 코드 (D10 …) */
  /* 원본에 적혀 있던 시료 이름 · 채취 시점.
     Excel 유래 시료는 Aliases.apply() 가 객체에 덧씌우므로 원본을 객체에서
     꺼냅니다. 사용자가 만든 시료는 부를 때마다 새 객체라 Entries 에서
     직접 읽습니다 — 둘을 같은 함수 뒤에 두어 부르는 쪽이 구분하지 않게 합니다. */
  function sampleOrig(s, prop) {
    const d = (window.DATA_SAMPLES || []).find(x => x.id === s.id);
    if (d) return A.originalOf(d, prop);
    const u = (E.getSamples(s.batchId) || []).find(x => x.id === s.id);
    if (!u) return s[prop];
    return prop === "name" ? u.name : null;
  }

  function buildCols(team, batch, samples, axis) {
    const bid = batch.id;
    const shown = id => !A.isHidden(hideKey(team, bid, id));

    /* 사용자가 늘린 열 — 이름은 고칠 수 있고, 기본 이름은 자리 번호입니다 */
    function extras(startIdx) {
      return extraCols(team, bid).filter(shown).map(function (id, i) {
        const ck = colKey(team, bid, id);
        const defName = "X" + (startIdx + i + 1);
        return { id: id, label: A.get(ck + ".name", defName), orig: defName,
                 sub: A.get(ck + ".sub", "추가 열"), origSub: "추가 열",
                 scope: "batch:" + bid, dayKey: null, extra: true };
      });
    }

    if (axis === "day") {
      const cols = (window.DATA_TITER_DAYS || []).filter(shown).map(function (d) {
        const ck = colKey(team, bid, d);
        const defSub = "배양 " + d.slice(1) + "일차";
        return { id: d, label: A.get(ck + ".name", d), orig: d,
                 sub: A.get(ck + ".sub", defSub), origSub: defSub,
                 scope: "batch:" + bid, dayKey: d };
      });
      return cols.concat(extras(cols.length));
    }
    if (axis === "sample") {
      /* 열이 곧 시료입니다 — 머리글을 고치면 시료 이름이 바뀝니다 */
      const cols = (samples || []).filter(s => shown(s.id)).map(s => ({
        id: s.id, sampleId: s.id,
        label: s.name || s.id, orig: sampleOrig(s, "name") || s.id,
        sub: s.stage || "", origSub: sampleOrig(s, "stage") || "",
        scope: "sample:" + s.id, dayKey: null
      }));
      if (!cols.length) {
        cols.push({ id: "none", label: "시료 없음", sub: "[열추가 →] 로 시료를 만드세요",
                    scope: "batch:" + bid, dayKey: null, fixed: true });
      }
      return cols;
    }
    /* 단일 — 배치당 한 번 재는 값 */
    const cols = [{ id: "v", label: A.get(colKey(team, bid, "v") + ".name", "값"), orig: "값",
                    sub: A.get(colKey(team, bid, "v") + ".sub", "배치 단위"), origSub: "배치 단위",
                    scope: "batch:" + bid, dayKey: null }];
    return cols.concat(extras(cols.length));
  }

  /* 행 — 스키마 항목 + 사용자가 만든 항목.
     scalar 인 행은 배치당 하나뿐인 값이라 첫 열에만 칸을 둡니다. */
  function buildRows(team, groups, axis, bid) {
    const out = [];
    let dayRowDone = false;
    groups.forEach(function (grp) {
      (grp.items || []).forEach(function (f) {
        const perDay = !!(f.src && f.src[0] === "titer");
        const perSample = isSampleScoped(f);

        /* ★ 일자별 항목은 한 행으로 접습니다.
           스키마에는 Titer D10 · D11 … 이 항목마다 하나씩 있지만, 워크시트
           에서는 "Titer" 한 줄이 D 열을 가로지르는 것이 원본 시트의 모양
           입니다. 펼쳐 두면 11줄이 생기고 열도 11개라 같은 값을 표 안에서
           두 번 찾게 됩니다. */
        if (axis === "day" && perDay) {
          if (dayRowDone) return;
          dayRowDone = true;
          out.push({ k: "titer", label: rowShownLabel(f, true),
                     orig: rowOrigLabel(f, true), unit: f.unit, type: f.type,
                     group: grp.g, scalar: false, field: f, perDay: true });
          return;
        }

        /* 축과 성격이 맞는 항목만 열마다 칸을 둡니다 */
        const spread = (axis === "sample" && perSample) || (axis === "single");
        out.push({ k: f.k, label: rowShownLabel(f, false), orig: rowOrigLabel(f, false),
                   unit: f.unit, type: f.type, group: grp.g, scalar: !spread, field: f,
                   /* 일자별 항목이 펼쳐진 상태 — 이름을 고치면 뒤의 D10 은
                      떼고 Titer 항목명만 바꿉니다 (item:titer 는 공통이라
                      "역가 D10" 을 그대로 넣으면 대시보드가 그렇게 됩니다) */
                   dayTag: !!(f.src && f.src[0] === "titer" && /^D\d+$/.test(String(f.src[1]))) });
      });
    });
    customRows(team, bid).forEach(function (c) {
      out.push({ k: "ws_" + c.k, label: c.label, orig: c.label0 || c.label,
                 unit: c.unit || "", type: "num",
                 group: "직접 추가한 항목", custom: true, field: null });
    });
    return out;
  }

  /* 한 칸이 어디에 저장되는가 — 기존 스키마 키를 최대한 그대로 씁니다 */
  function cellTarget(row, col) {
    if (row.custom) {
      return { scope: col.scope, key: row.k + "@" + col.id, schema: false };
    }
    const f = row.field;
    /* 일자별 행은 열이 곧 일자입니다 — 원래 키가 titer_D10 입니다.
       추가한 열(X1 …)에는 대응하는 스키마 키가 없으므로 따로 담습니다. */
    if (row.perDay) {
      if (!col.dayKey) {
        return { scope: "batch:" + (currentBatchId() || ""),
                 key: "ws_titer@" + col.id, schema: false };
      }
      return { scope: "batch:" + (currentBatchId() || ""),
               key: "titer_" + col.dayKey, schema: true, f: f };
    }
    if (row.scalar) {
      /* 배치·시료 단위 값 — 원래 쓰던 범위와 키 그대로 */
      return { scope: isSampleScoped(f) ? col.scope : ("batch:" + (currentBatchId() || "")),
               key: f.k, schema: true, f: f };
    }
    /* 시료 축에서 분석 항목 — 열이 곧 시료 범위입니다 */
    return { scope: col.scope, key: f.k, schema: true, f: f };
  }
  function currentBatchId() { return batchId; }

  function mountWorksheet(batch, groups, host) {
    const team = window.Scope.get().team;
    const axis = axisFor(team);

    /* ★ 사용자가 만든 시료도 열이 되어야 합니다. 예전에는 Excel 유래
       시료(DATA_SAMPLES)만 봤습니다 — 그래서 [열추가 →] 로 시료를 만들어도
       열이 생기지 않았습니다. Repo 가 두 출처를 합쳐 줍니다. */
    const samples = window.Repo.samplesOfBatch(batch.id);
    const cols = buildCols(team, batch, samples, axis);
    const rows = buildRows(team, groups, axis, batch.id);

    host.innerHTML =
      '<div class="ws-axis">' +
        '<label for="ws-axis-sel"><b>열 기준</b></label>' +
        '<select class="input" id="ws-axis-sel">' +
          ['<option value="day">배양 경과 일자 (Day)</option>',
           '<option value="sample">시료 (Sample)</option>',
           '<option value="single">단일 (배치당 한 값)</option>'].join("") +
        '</select>' +
        '<span>이 서식에 맞지 않으면 기준을 바꿔 주세요. 선택은 팀별로 기억합니다.</span>' +
      '</div>' +
      hiddenStrip(team, batch, axis, samples) +
      '<div id="ws-host"></div>';
    const sel = host.querySelector("#ws-axis-sel");
    sel.value = axis;
    sel.addEventListener("change", function () { setAxis(team, this.value); render(); });
    $$("[data-unhide]", host).forEach(b => b.addEventListener("click", function () {
      A.unhide(hideKey(team, batch.id, b.dataset.unhide));
      render();
    }));

    window.Worksheet.mount(host.querySelector("#ws-host"), {
      rows: rows, cols: cols,

      cell: function (row, col) {
        const t = cellTarget(row, col);
        const rec = E.getValue(t.scope, t.key);
        if (rec) {
          return { display: wsDisplay(row, rec.value), origin: E.caption(rec),
                   missing: wsMissing(row, rec.value),
                   edited: E.hasHistory(rec),
                   editCount: rec.history ? rec.history.length : 0 };
        }
        /* 원본 Excel 값 — 일자별 Titer 와 배치·시료 스키마 항목이 여기 옵니다 */
        const base = t.schema ? wsBaseValue(batch, t, col) : null;
        return { display: wsDisplay(row, base),
                 origin: (base !== null && base !== undefined) ? originLabel(t.f || {}) : null,
                 missing: wsMissing(row, base), edited: false, editCount: 0 };
      },

      onCommit: function (row, col, raw) {
        const r = wsCommit(batch, row, col, raw);
        if (r === "saved") render();
        return r;
      },
      onRevert: function (row, col) { wsRevert(batch, row, col); },
      onHistory: function (anchor, row, col, sticky) {
        if (!anchor) { closeHoverHistory(); return; }
        const t = cellTarget(row, col);
        showHistory(anchor, E.getValue(t.scope, t.key),
          { label: row.label + " · " + col.label, type: row.type }, sticky);
      },

      onAddRow: function (label) {
        const list = customRows(team, batch.id);
        list.push({ k: "c" + Date.now().toString(36), label: label, label0: label, unit: "" });
        saveCustomRows(team, batch.id, list);
        render();
      },
      onDropRow: function (rk) {
        const list = customRows(team, batch.id).filter(c => ("ws_" + c.k) !== rk);
        saveCustomRows(team, batch.id, list);
        render();
      },

      /* 열추가 — 시료 축에서는 진짜 시료를 만듭니다. 화면 전용 열로 두면
         거기 적은 값이 데이터 조회 · 분석 의뢰 · AI 에게는 없는 값이 되고,
         입력한 사람만 보이는 기록이 생깁니다. */
      onAddCol: function () {
        if (axis === "sample") { addSampleCol(batch, samples); return; }
        addExtraCol(team, batch.id);
        render();
      },

      onRenameCol: function (col, part, text) { renameCol(team, batch, axis, samples, col, part, text); },
      onRenameRow: function (row, text) { renameRow(team, batch, row, text); },
      onDropCol:   function (col) { dropCol(team, batch, axis, rows, col); },

      /* 치는 동안 옆 그래프만 다시 그립니다. 표까지 다시 그리면 커서가
         사라져 글자를 이어 칠 수 없습니다. */
      onEdit: function (row, col, raw) {
        draft = { rowKey: row.k, colId: col.id, raw: raw };
        schedulePaintLive(batch, team, axis);
      }
    });

    draft = null;
    paintLive(batch, team, axis);
  }

  /* ══════════════════════════════════════════════════════════════════════
     실시간 그래프 — 왼쪽 표에 적는 값을 바로 선으로 보여 줍니다

     ★ 저장 전 값도 그립니다. 저장한 뒤에만 보여 주면 "적는 중에 확인한다"
       가 되지 않습니다. 다만 아직 저장되지 않았다는 것은 화면에 밝힙니다 —
       그래프에 보이니 기록된 줄 알면 안 됩니다.

     범위는 고를 수 있습니다. 기본은 입력 중인 배치 하나이고, 같은 Study 의
     다른 배치를 겹쳐 볼 수도 있습니다. 옆줄과 견주면 한 칸 밀려 적은 것이
     바로 드러나기 때문입니다.
     ══════════════════════════════════════════════════════════════════════ */
  const LIVE_KEY = "hub.ebr.live";
  let draft = null;        /* 아직 저장 전인 칸 { rowKey, colId, raw } */
  let liveTimer = null;

  function liveScope() {
    try { return localStorage.getItem(LIVE_KEY) || "batch"; } catch (e) { return "batch"; }
  }
  function setLiveScope(v) {
    try { localStorage.setItem(LIVE_KEY, v); } catch (e) {}
  }

  function schedulePaintLive(batch, team, axis) {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => paintLive(batch, team, axis), 120);
  }

  /* 한 배치의 일자별 값 — 저장값(Repo) 우선, 치는 중이면 그 값을 얹습니다 */
  function daySeriesOf(b, days, metricKey, isCurrent) {
    return days.map(function (d) {
      if (isCurrent && draft && draft.colId === d && draft.rowKey === metricKey) {
        const p = window.VAL.parse(draft.raw);
        if (p.ok) {
          const n = window.VAL.numeric(p.val);
          return (n === null || n === undefined) ? NaN : n;
        }
        return NaN;
      }
      const v = window.Repo.valueOf(b, "titer", d);
      return (v === null || v === undefined) ? NaN : v;
    });
  }

  function paintLive(batch, team, axis) {
    const host = $("#live-host");
    if (!host || !window.Charts) return;
    const C = window.Charts;
    const scopeMode = liveScope();

    /* 겹쳐 볼 배치 — 기본은 입력 중인 것 하나 */
    let peers = [];
    if (scopeMode === "study") {
      peers = (window.DATA_BATCHES || [])
        .filter(b => b.studyId === batch.studyId && b.id !== batch.id)
        .slice(0, 8);
    }

    const picker =
      '<div class="live-scope">' +
        '<label for="live-range"><b>범위</b></label>' +
        '<select class="input" id="live-range">' +
          '<option value="batch"' + (scopeMode === "batch" ? " selected" : "") + '>' +
            '이 배치만</option>' +
          '<option value="study"' + (scopeMode === "study" ? " selected" : "") + '>' +
            '같은 Study 겹쳐 보기</option>' +
        '</select>' +
      '</div>';

    let body = "";

    if (axis === "day") {
      const days = (window.DATA_TITER_DAYS || []);
      const mine = daySeriesOf(batch, days, "titer", true);
      const series = [{ name: batch.id + " (입력 중)", data: mine, color: "var(--c-accent)" }];
      peers.forEach(function (b, i) {
        series.push({ name: b.id, data: daySeriesOf(b, days, "titer", false),
                      color: PEER[i % PEER.length], thin: true });
      });
      const any = mine.some(v => isFinite(v));

      body =
        liveCard("Titer 일자별", "적는 즉시 선이 움직입니다 · 단위 mg/L",
          any || peers.length
            ? C.line({ x: days.map(d => d.slice(1)), series: series, h: 190, w: 380,
                       aria: "일자별 Titer 추이" })
            : liveEmpty("Titer 를 한 칸이라도 적으면 선이 그려집니다")) +
        liveCard("배양 지표", "IVCD · Max VCD · Final VCD · Viability",
          upstreamBars(batch, C));
    } else if (axis === "sample") {
      body = liveCard("시료별 분석값", "열(시료)마다 한 묶음 · 단위 %",
        sampleBars(batch, C));
    } else {
      body = liveCard("정제 단계별", "수율과 순도 · 단위 %", downstreamBars(batch, C));
    }

    host.innerHTML = picker + body +
      '<p class="live-note">' +
        (draft
          ? '<b>치는 중인 값이 그래프에 먼저 반영됩니다.</b> 아직 저장된 것은 아닙니다 — ' +
            'Enter 를 누르거나 칸을 벗어나야 기록됩니다.'
          : '왼쪽 표에 값을 적으면 그 자리에서 선이 움직입니다. ' +
            '옆 배치와 견주려면 위 범위를 바꾸세요.') +
      '</p>';

    const sel = host.querySelector("#live-range");
    if (sel) sel.addEventListener("change", function () {
      setLiveScope(this.value);
      paintLive(batch, team, axis);
    });
  }

  const PEER = ["#94A3B8", "#A5B4C4", "#B6C2D0", "#8FA2BB", "#AAB8C8", "#9FB0C2", "#C0CAD6", "#8C9CB0"];

  function liveCard(title, sub, inner) {
    return '<section class="live-card">' +
      '<h3>' + esc(title) + '</h3>' +
      '<p>' + esc(sub) + '</p>' + inner + '</section>';
  }
  function liveEmpty(msg) {
    return '<div class="live-empty">' + esc(msg) + '</div>';
  }

  /* 배치 단위 지표 — 막대 하나가 항목 하나입니다 */
  function upstreamBars(batch, C) {
    const items = [["ivcd", "IVCD"], ["maxVCD", "Max VCD"],
                   ["finalVCD", "Final VCD"], ["finalViability", "Viability"]];
    return metricBars(batch, C, "upstream", items);
  }
  function downstreamBars(batch, C) {
    const g = (window.DATA_ANALYTE_GROUPS || []).find(x => x.id === "downstream");
    const items = ((g && g.items) || []).map(it => [it.key, it.label]);
    return metricBars(batch, C, "downstream", items);
  }
  function metricBars(batch, C, groupId, items) {
    const data = items.map(function (it) {
      if (draft && draft.rowKey === keyFor(groupId, it[0])) {
        const p = window.VAL.parse(draft.raw);
        if (p.ok) {
          const n = window.VAL.numeric(p.val);
          if (n !== null && n !== undefined) return n;
        }
        return NaN;
      }
      const v = window.Repo.valueOf(batch, groupId, it[0]);
      return (v === null || v === undefined) ? NaN : v;
    });
    if (!data.some(v => isFinite(v))) return liveEmpty("아직 적힌 값이 없습니다");
    return C.bars({ cats: items.map(x => x[1]),
                    series: [{ name: "값", data: data, color: "var(--c-accent)" }],
                    h: 190, w: 380 });
  }
  /* 워크시트의 행 키 규칙과 맞춥니다 (upstream 은 맨키, 그 외는 그룹_키) */
  function keyFor(groupId, key) {
    return (groupId === "upstream" || groupId === "titer") ? key : groupId + "_" + key;
  }

  function sampleBars(batch, C) {
    const samples = window.Repo.samplesOfBatch(batch.id);
    if (!samples.length) return liveEmpty("시료를 먼저 만드세요");
    const metrics = [["seHPLC", "main", "SE Main"], ["ieHPLC", "acidic", "IE Acidic"],
                     ["nGlycan", "g0f", "G0F"], ["ceSdsNR", "monomer", "CE Mono"]];
    const series = metrics.map(function (m, i) {
      return { name: m[2], color: i === 0 ? "var(--c-accent)" : PEER[i],
        data: samples.map(function (s) {
          const v = window.Repo.valueOfSample(s, m[0], m[1]);
          return (v === null || v === undefined) ? NaN : v;
        }) };
    });
    if (!series.some(s => s.data.some(v => isFinite(v)))) {
      return liveEmpty("아직 적힌 분석값이 없습니다");
    }
    return C.bars({ cats: samples.map(s => s.name || s.id), series: series, h: 200, w: 380 });
  }

  /* ── 열 늘리기 (시료 축) ──────────────────────────────────────────────
     이름은 기존 시료를 이어 B123-2-S2 · S3 … 으로 짓고, 이미 있으면 다음
     번호로 넘어갑니다. 사용자는 머리글에서 바로 고칠 수 있습니다. */
  function addSampleCol(batch, samples) {
    const taken = samples.map(s => String(s.name || "").toLowerCase());
    let n = samples.length + 1, name = batch.id + "-S" + n;
    while (taken.indexOf(name.toLowerCase()) > -1) { n++; name = batch.id + "-S" + n; }
    const r = E.addSample({ batchId: batch.id, studyId: batch.studyId, name: name });
    if (!r.ok) { window.alert(r.reason); return; }
    render();
  }

  /* ── 머리글 이름 고치기 ───────────────────────────────────────────────
     시료 축의 머리글은 시료 그 자체입니다 — 고치면 데이터 조회 · 분석
     의뢰 · 시료 보관 화면에서도 새 이름으로 보입니다. 원래 이름은 지우지
     않고 이력에 남습니다. */
  function renameCol(team, batch, axis, samples, col, part, text) {
    const txt = String(text == null ? "" : text).trim();

    if (col.sampleId) {
      if (part === "name") {
        if (!txt) { window.alert("시료 이름은 비울 수 없습니다."); render(); return; }
        const dup = samples.some(s => s.id !== col.sampleId &&
          String(s.name || "").toLowerCase() === txt.toLowerCase());
        if (dup) { window.alert("같은 Batch에 동일한 시료 이름이 이미 있습니다."); render(); return; }
      }
      const r = A.set("smp:" + col.sampleId + "." + (part === "name" ? "name" : "stage"),
        txt, part === "name" ? col.orig : col.origSub);
      if (!r.ok) window.alert(r.reason);
      render();
      return;
    }

    /* 일자 열의 이름은 보이는 이름만 바뀝니다 — 값은 계속 titer_D10 에
       들어갑니다. 저장 키까지 따라 바뀌면 이미 적어 둔 값이 미아가 되고,
       데이터 조회와 대시보드가 그 값을 못 찾습니다. */
    const r = A.set(colKey(team, batch.id, col.id) + "." + part, txt,
      part === "name" ? col.orig : col.origSub);
    if (!r.ok) window.alert(r.reason);
    render();
  }

  /* ── 항목명 고치기 ────────────────────────────────────────────────────
     스키마 항목명은 전사 공통입니다 — 대시보드 · 데이터 조회 · Global AI 가
     같은 이름을 씁니다. 화면마다 다른 이름으로 부르면 "Acidic 최대값" 을
     물었을 때 AI 의 답과 화면의 표가 어긋납니다. */
  function renameRow(team, batch, row, text) {
    const txt = String(text == null ? "" : text).trim();
    if (!txt) { window.alert("항목명은 비울 수 없습니다."); render(); return; }

    if (row.custom) {
      const list = customRows(team, batch.id);
      const c = list.find(x => ("ws_" + x.k) === row.k);
      if (c) { if (c.label0 === undefined) c.label0 = c.label; c.label = txt; }
      saveCustomRows(team, batch.id, list);
      render();
      return;
    }
    /* 일자별 항목이 펼쳐진 상태에서는 뒤의 D10 을 떼고 항목명만 바꿉니다 */
    const clean = row.dayTag ? txt.replace(/\s*D\d+\s*$/, "").trim() || txt : txt;
    const r = A.set(rowAliasKey(row.field, row.perDay), clean,
      row.dayTag ? (A.originalOf(window.DATA_TITER_ITEM, "label") || "Titer") : row.orig);
    if (!r.ok) window.alert(r.reason);
    render();
  }

  /* ── 열 지우기 ────────────────────────────────────────────────────────
     값이 적힌 열과 원본에서 온 열은 지우지 않습니다. 규제 대응상 기록은
     삭제가 아니라 비활성화이고, 지워 버리면 "무엇이 있었는지" 조차 남지
     않습니다. 그래서 화면에서만 감추고 누가 언제 감췄는지 남깁니다.
     비어 있고 사용자가 만든 열이면 그냥 없앱니다 — 지킬 기록이 없습니다. */
  function colHasValues(rows, col) {
    return (rows || []).some(function (row) {
      /* 배치 단위 값은 열에 속하지 않습니다 — 첫 열에만 칸이 있고, 그 값은
         열을 없애도 그대로 남습니다. 세면 값이 하나라도 있는 배치에서는
         어떤 열도 지울 수 없게 됩니다. */
      if (row.scalar) return false;
      const t = cellTarget(row, col);
      return !!E.getValue(t.scope, t.key);
    });
  }
  function dropCol(team, batch, axis, rows, col) {
    const used = colHasValues(rows, col);
    const extras = extraCols(team, batch.id);
    const isExtra = extras.indexOf(col.id) > -1;
    const isUserSample = !!col.sampleId &&
      (E.getSamples(batch.id) || []).some(s => s.id === col.sampleId);

    if (!used && isExtra) {
      if (!window.confirm("‘" + col.label + "’ 열을 지웁니다. 적힌 값은 없습니다.\n계속할까요?")) return;
      saveExtraCols(team, batch.id, extras.filter(x => x !== col.id));
      render();
      return;
    }
    if (!used && isUserSample) {
      if (!window.confirm("‘" + col.label + "’ 시료를 지웁니다. 측정값은 아직 없습니다.\n" +
        "시료 기록은 비활성 처리되어 이력에는 남습니다. 계속할까요?")) return;
      E.deactivateSample(col.sampleId, "Data 입력 워크시트에서 빈 열 삭제");
      render();
      return;
    }

    const why = used
      ? "이 열에는 값이 적혀 있습니다."
      : "이 열은 원본에서 온 열입니다.";
    if (!window.confirm("‘" + col.label + "’ — " + why + "\n\n" +
      "지우지 않고 이 화면에서만 감춥니다. 값과 이력은 그대로 남고, " +
      "표 위의 [숨긴 열] 에서 다시 꺼낼 수 있습니다.\n계속할까요?")) return;
    A.hide(hideKey(team, batch.id, col.id), col.label);
    render();
  }

  /* 숨긴 열 되살리기 — 감춘 것을 되돌릴 자리가 화면에 없으면 감추기가
     사실상 삭제가 됩니다 */
  function hiddenStrip(team, batch, axis, samples) {
    const pre = "colhide:" + team + "|" + batch.id + "|";
    const keys = A.hiddenWithPrefix(pre);
    if (!keys.length) return "";
    const nameOf = function (id) {
      const s = (samples || []).find(x => x.id === id);
      if (s) return s.name || id;
      const ck = colKey(team, batch.id, id);
      return A.get(ck + ".name", id);
    };
    return '<div class="ws-hidden">' +
      '<b>숨긴 열 ' + keys.length + '개</b>' +
      keys.map(function (k) {
        const id = k.slice(pre.length);
        const info = A.hiddenInfo(k) || {};
        return '<button class="ws-unhide" type="button" data-unhide="' + esc(id) + '" ' +
          'title="' + esc((info.by || "—") + " · " + (info.at || "").replace("T", " ") +
            " 에 숨김") + '">' + esc(nameOf(id)) + ' 되살리기</button>';
      }).join("") +
      '<span>값과 변경 이력은 그대로 있습니다 — 화면에만 보이지 않습니다.</span>' +
    '</div>';
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
  /* 원본값 — 일자별은 batch.upstream.titer[D], 그 밖은 기존 excelValue 경로 */
  function wsBaseValue(batch, t, col) {
    const f = t.f;
    if (!f) return null;
    if (col.dayKey && f.src && f.src[0] === "titer") {
      const tt = batch.upstream && batch.upstream.titer;
      const v = tt ? tt[col.dayKey] : null;
      return v === undefined ? null : v;
    }
    if (isSampleScoped(f)) {
      const sid = String(t.scope).indexOf("sample:") === 0 ? t.scope.slice(7) : null;
      const s = sid ? (window.DATA_SAMPLES || []).find(x => x.id === sid) : null;
      return s ? window.Repo.valueOfSample(s, f.src[0], f.src[1]) : null;
    }
    return excelValue(batch, f.src);
  }

  /* 저장 — 스키마 항목은 기존 commit() 을 그대로 지납니다. 사용자가 만든
     항목만 여기서 직접 저장합니다 (다른 화면이 모르는 항목이라 검증할
     규격도 없습니다 — 숫자 형식만 봅니다). */
  function wsCommit(batch, row, col, raw) {
    const t = cellTarget(row, col);
    if (t.schema && row.field) {
      /* ★ row 를 함께 넘깁니다. 접힌 일자 행은 행 키("titer")와 스키마
         항목 키("titer_D10")가 다릅니다 — 항목 키로 셀을 찾으면 못 찾고,
         사유 창이 뜨지 않은 채 조용히 지나갑니다. */
      return commitAt(t.scope, t.key, batch, row.field, raw, col, row);
    }
    const p = window.VAL.parse(raw);
    if (!p.ok) { wsMsg(row, col, "error", [p.error]); return "error"; }
    wsMsg(row, col, null, []);
    const prev = E.getValue(t.scope, t.key);
    const r = window.Repo.setValue(t.scope, t.key, p.val, undefined,
      { baseValue: prev ? prev.value : null, baseSource: null });
    if (!r.ok && r.needReason) { wsReason(batch, row, col, raw, r.reason); return "needReason"; }
    if (!r.ok) { wsMsg(row, col, "error", [r.reason || "저장하지 못했습니다"]); return "error"; }
    if (r.action === "None") return "none";
    return "saved";
  }

  /* 스키마 항목 저장 — 기존 commit() 과 같은 규칙(범위 검사 · 경고 · 사유
     필수)을 쓰되, 범위(scope)와 키를 워크시트가 정한 것으로 씁니다.
     시료 축에서는 열마다 범위가 다르기 때문입니다. */
  function commitAt(scope, key, batch, f, raw, col, row) {
    const rk = row ? row.k : f.k;
    const measure = isMeasure(f);
    let val;
    if (measure) {
      const p = window.VAL.parse(raw);
      if (!p.ok) { wsMsgKey(rk, col.id, "error", [p.error]); return "error"; }
      val = p.val;
      const it = itemSchema(f);
      const rangeErr = window.VAL.checkRange(val, it);
      if (rangeErr) { wsMsgKey(rk, col.id, "error", [rangeErr]); return "error"; }
      const warns = warningsFor(batch, f, val, it);
      wsMsgKey(rk, col.id, warns.length ? "warn" : null, warns);
    } else {
      val = raw === "" ? null : raw;
      wsMsgKey(rk, col.id, null, []);
    }

    const prev = E.getValue(scope, key);
    /* 화면이 "Excel 원본" 이라고 보여 준 값은 바꿀 때 사유를 받아야 합니다 */
    const base = prev ? null : wsBaseValue(batch, { f: f, scope: scope }, col);

    const r = window.Repo.setValue(scope, key, val, undefined,
      { baseValue: prev ? prev.value : (base === undefined ? null : base),
        baseSource: originLabel(f) });

    if (!r.ok && r.needReason) {
      wsReasonAt(scope, key, batch, f, raw, col, r.reason, row);
      return "needReason";
    }
    if (!r.ok) { wsMsgKey(rk, col.id, "error", [r.reason || "저장하지 못했습니다"]); return "error"; }
    if (r.action === "None") return "none";
    return "saved";
  }

  function wsMsg(row, col, kind, lines) { wsMsgKey(row.k, col.id, kind, lines); }
  function wsMsgKey(rk, ck, kind, lines) {
    const id = rk + "::" + ck;
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

  /* 사유 popover — 칸에 붙습니다. 저장은 사유를 받은 뒤에만 일어납니다. */
  function wsReason(batch, row, col, raw, note) {
    const t = cellTarget(row, col);
    wsReasonAt(t.scope, t.key, batch, row.field, raw, col, note, row);
  }
  function wsReasonAt(scope, key, batch, f, raw, col, note, rowOpt) {
    const rk = rowOpt ? rowOpt.k : f.k;
    const id = rk + "::" + col.id;
    const cell = document.querySelector('[data-cell="' + id + '"]');
    if (!cell) return;
    closeReason(id);
    cell.classList.add("is-asking");

    const pop = document.createElement("div");
    pop.className = "pop reason-pop";
    pop.id = "reason-pop";
    const label = (rowOpt ? rowOpt.label : f.label) + " · " + col.label;
    pop.innerHTML =
      '<div class="reason-head">' + esc(label) + ' — ' +
        esc(note || "변경 사유를 입력하세요") + '</div>' +
      '<div class="reason-ctl">' +
        '<input class="ebr-input" id="ws-rsn" list="reason-presets" ' +
          'placeholder="예: 오기 정정 (전사 오류)">' +
        '<button class="btn btn-accent btn-sm" id="ws-rsave">사유 저장</button>' +
        '<button class="btn btn-ghost btn-sm" id="ws-rcancel">취소</button>' +
      '</div>' +
      '<div class="reason-foot">사유를 저장해야 값이 반영됩니다. ' +
        '취소하면(Esc) 저장된 값으로 되돌립니다.</div>';
    document.body.appendChild(pop);
    placePop(pop, cell.querySelector(".ws-box") || cell);

    const input = pop.querySelector("input");
    setTimeout(() => input.focus(), 0);

    function submit() {
      const why = input.value.trim();
      if (why.length < 2) { wsMsgKey(rk, col.id, "error", ["사유를 2자 이상 입력하세요."]); input.focus(); return; }
      const measure = f ? isMeasure(f) : true;
      let val;
      if (measure) { const p = window.VAL.parse(raw); if (!p.ok) return; val = p.val; }
      else val = raw === "" ? null : raw;
      const prev = E.getValue(scope, key);
      const base = prev ? null : (f ? wsBaseValue(batch, { f: f, scope: scope }, col) : null);
      const r = window.Repo.setValue(scope, key, val, why,
        { baseValue: prev ? prev.value : (base === undefined ? null : base),
          baseSource: f ? originLabel(f) : null });
      if (r.ok) { closeReason(id); render(); }
      else wsMsgKey(rk, col.id, "error", [r.reason || "저장하지 못했습니다"]);
    }
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); submit(); }
      if (e.key === "Escape") { e.preventDefault(); closeReason(id); render(); }
    });
    pop.querySelector("#ws-rsave").addEventListener("click", submit);
    pop.querySelector("#ws-rcancel").addEventListener("click", function () { closeReason(id); render(); });
  }

  function wsRevert(batch, row, col) {
    closeReason(row.k + "::" + col.id);
    wsMsgKey(row.k, col.id, null, []);
    render();
  }

  /* 이 배치가 쓴 자재 — 이상이 생겼을 때 첫 질문에 바로 답하도록
     입력 화면 안에 둡니다. 조사할 때 다른 화면을 열지 않아도 됩니다. */
  function lotStrip(batch) {
    if (!window.Lots || !batch) return "";
    const rows = window.Lots.forBatch(batch.id);
    if (!rows.length) return "";
    /* 유효기간은 오늘이 아니라 **이 배치를 돌린 날** 기준으로 봅니다.
       질문은 "지금 기한이 지났나"가 아니라 "쓸 때 유효했나"입니다. */
    const ref = batch.endDate || batch.initialDate || null;
    const warn = rows.filter(function (r) {
      const ex = window.Lots.expiry(r.lot, ref);
      const u = window.Lots.usage(r.lot);
      return (ex && ex.state !== "ok") || (u && u.limit && u.used / u.limit >= 0.8);
    });
    return '<details class="disclose" style="margin:0 var(--s-5) var(--s-4)"' +
        (warn.length ? " open" : "") + '>' +
      '<summary>이 배치가 쓴 자재 (' + rows.length + ')' +
        '<span class="disclose-note">' +
          (warn.length ? "확인 필요 " + warn.length + "건" : "유효기간·사용 한도 이상 없음") +
        '</span></summary>' +
      '<div style="padding:0 var(--s-4) var(--s-4)"><div class="tbl-scroll"><table class="tbl">' +
      '<thead><tr><th scope="col">역할</th><th scope="col">Lot</th>' +
      '<th scope="col">사용 이력</th><th scope="col">유효기간</th></tr></thead><tbody>' +
      rows.map(function (r) {
        const u = window.Lots.usage(r.lot);
        const ex = window.Lots.expiry(r.lot, ref);
        const heavy = u && u.limit && u.used / u.limit >= 0.8;
        return '<tr><td>' + esc(r.role) + '</td>' +
          '<td class="mono">' + esc(r.lot.lotNo) +
            '<span style="display:block;font-size:10px;color:var(--c-text-mute)">' +
            esc(r.lot.name) + '</span></td>' +
          '<td class="mono"' + (heavy ? ' style="color:#8A4308;font-weight:600"' : "") + '>' +
            esc(r.extra || (u ? u.used + " / " + u.limit + " " + u.unit : "—")) + '</td>' +
          '<td class="mono"' + (ex && ex.state !== "ok" ? ' style="color:var(--c-risk);font-weight:600"' : "") + '>' +
            (ex ? esc(ex.expiryAt) + (ex.state === "expired" ? " (지남)" : ex.state === "soon" ? " (D-" + ex.days + ")" : "") : "—") +
          '</td></tr>';
      }).join("") + '</tbody></table></div>' +
      '<p style="font-size:11.5px;color:var(--c-text-mute);margin:var(--s-3) 0 0;line-height:1.7">' +
        '유효기간은 <b>' + esc(ref || "배치 일자 미상") + '</b> 기준입니다 — ' +
        '오늘이 아니라 이 배치를 돌린 날에 유효했는지가 질문이기 때문입니다.<br>' +
        '이상이 있으면 <a href="hub.html#wiki">연구 지식</a>에 기록해 두세요 — ' +
        '같은 lot 을 쓴 다른 배치에서 같은 일이 생겼을 때 바로 찾을 수 있습니다.</p>' +
      '</div></details>';
  }

  /* 입력 표기 안내 — 매번 설명하지 않아도 되도록 폼 위에 한 번만 둡니다 */
  function valueHelp() {
    const M = window.VAL.MISSING;
    return '<datalist id="val-tokens">' +
        ['<1', '>200', 'ND', 'NA', 'INV'].map(t => '<option value="' + t + '">').join("") +
      '</datalist>' +
      '<datalist id="reason-presets">' +
        E.REASON_PRESETS.map(t => '<option value="' + esc(t) + '">').join("") +
      '</datalist>' +
      '<details class="disclose" style="margin:0 var(--s-5) var(--s-4)">' +
        '<summary>값 입력 표기<span class="disclose-note">숫자 외에 한정자와 결측 사유도 넣을 수 있습니다</span></summary>' +
        '<div style="padding:0 var(--s-4) var(--s-4)"><div class="tbl-scroll">' +
        '<table class="tbl"><thead><tr><th scope="col">입력</th><th scope="col">의미</th>' +
        '<th scope="col">언제 쓰나</th></tr></thead><tbody>' +
        '<tr><td class="mono">12.3</td><td>숫자</td><td>정량된 결과</td></tr>' +
        '<tr><td class="mono">&lt;1</td><td>정량한계 미만</td>' +
          '<td>검출은 됐으나 정량 범위 밖 (HCP · 잔류 DNA 에서 흔함)</td></tr>' +
        '<tr><td class="mono">&gt;200</td><td>정량한계 초과</td><td>상한을 넘어 정량 불가</td></tr>' +
        '<tr><td class="mono">ND</td><td>' + esc(M.nd.label) + '</td><td>' + esc(M.nd.hint) + '</td></tr>' +
        '<tr><td class="mono">NA</td><td>' + esc(M.na.label) + '</td><td>' + esc(M.na.hint) +
          ' — 완성도 집계에서 제외됩니다</td></tr>' +
        '<tr><td class="mono">INV</td><td>' + esc(M.inv.label) + '</td><td>' + esc(M.inv.hint) + '</td></tr>' +
        '<tr><td class="mono">(빈칸)</td><td>' + esc(M.nm.label) + '</td><td>' + esc(M.nm.hint) + '</td></tr>' +
        '</tbody></table></div>' +
        '<p style="font-size:11.5px;color:var(--c-text-mute);margin:var(--s-3) 0 0;line-height:1.8">' +
        '불검출(ND)과 정량한계 미만(&lt;1)은 다릅니다 — ND 는 검출 자체가 안 된 것이고, ' +
        '&lt;1 은 검출은 됐지만 정량 범위 밖이라 경계값만 아는 것입니다. ' +
        '나중에 되짚을 수 있도록 나눠 기록합니다.</p>' +
        '</div></details>';
  }

  /* ── 저장 ───────────────────────────────────────────────────────────── */
  function wireForm(batch, groups, batches) {
    wireTarget(batches);

    const all = groups.reduce((a, g) => a.concat(g.items), []);

    /* 계산 결과를 필드에 넣을 때, 계산에 쓴 식이 그대로 변경 사유가 됩니다.
       엑셀에서 계산해 숫자만 옮겨 적으면 남지 않던 근거입니다. */
    window.Calc.wire(document.getElementById("form-host"), function (fieldKey, value, basis) {
      const f = all.find(x => x.k === fieldKey);
      if (!f) { window.alert("이 서식에는 해당 항목이 없습니다: " + fieldKey); return; }
      const inp = cellOf(fieldKey) && cellOf(fieldKey).querySelector("[data-f]");
      if (inp) inp.value = String(value);
      const r = commit(batch, f, String(value), { reason: basis });
      if (r === "saved") render();
      else if (r === "needReason") {
        /* 사유가 이미 basis 로 들어갔는데도 막혔다면 값이 같다는 뜻입니다 */
        setMsg(fieldKey, "warn", ["현재 값과 같아 저장할 것이 없습니다."]);
      }
    });

    /* 폼 안으로 범위를 좁힙니다 — 좌측 StudySelector 도 [data-f] 를 쓰기 때문에
       문서 전체를 훑으면 그 드롭다운까지 저장 대상으로 잡힙니다. */
    const host = $("#form-host");
    const fieldInputs = () => $$("[data-f]", host);

    /* 표 안의 칸은 DataGrid 가 붙입니다 (change · 키보드 · 이력 표식).
       여기서 또 붙이면 한 번 고칠 때 저장이 두 번 돕니다. */

    $("#save-all").addEventListener("click", function () {
      let saved = 0, asking = 0, bad = 0;
      fieldInputs().forEach(function (inp) {
        const f = all.find(x => x.k === inp.dataset.f);
        const r = commit(batch, f, inp.value, { quiet: true });
        if (r === "saved") saved++;
        else if (r === "needReason") asking++;
        else if (r === "error") bad++;
      });
      const m = $("#save-msg");
      const parts = [];
      if (saved) parts.push(saved + "개 저장됨");
      if (asking) parts.push(asking + "개는 변경 사유 입력 필요");
      if (bad) parts.push(bad + "개는 입력값 오류");
      m.textContent = parts.length ? parts.join(" · ") : "변경된 값이 없습니다";
      m.style.color = (asking || bad) ? "var(--c-risk)" : "var(--c-ok)";
      setTimeout(() => { m.textContent = ""; }, 4000);
      if (saved && !asking && !bad) render();
    });

  }


  /* ── 필드 메시지 ────────────────────────────────────────────────────── */
  function cellOf(k) { return document.querySelector('[data-cell="' + k + '"]'); }

  function setMsg(k, kind, lines) {
    const cell = cellOf(k);
    if (!cell) return;
    const p = cell.querySelector("[data-msg]");
    const inp = cell.querySelector("[data-f]");
    p.className = "field-msg" + (kind ? " is-" + kind : "");
    p.innerHTML = (lines || []).map(esc).join("<br>");
    if (inp) {
      inp.classList.toggle("is-invalid", kind === "error");
      inp.classList.toggle("is-warned", kind === "warn");
    }
  }

  /* ── 저장 ───────────────────────────────────────────────────────────────
     반환값: "saved" | "none" | "error" | "needReason"
     오류(범위 이탈·형식 오류)는 저장을 막고, 경고(급변·편차)는 막지 않습니다.
     경고는 "그럴 수도 있는 일"이라 차단하면 진짜 값을 못 넣게 됩니다. */
  function commit(batch, f, raw, opts) {
    if (!f) return "none";
    const o = opts || {};
    const measure = isMeasure(f);
    let val;

    if (measure) {
      const p = window.VAL.parse(raw);
      if (!p.ok) { setMsg(f.k, "error", [p.error]); return "error"; }
      val = p.val;

      const it = itemSchema(f);
      const rangeErr = window.VAL.checkRange(val, it);
      if (rangeErr) { setMsg(f.k, "error", [rangeErr]); return "error"; }

      const warns = warningsFor(batch, f, val, it);
      setMsg(f.k, warns.length ? "warn" : null, warns);
    } else {
      val = raw === "" ? null : raw;
      setMsg(f.k, null, []);
    }

    const base = baseValueOf(batch, f);
    /* ★ 저장은 Repo 를 지납니다.

       화면의 입력칸이 데이터의 원본이 되면 안 됩니다. 여기서 저장소를
       직접 부르면 값은 저장되지만 아무도 그 사실을 모르고, 대시보드 ·
       조회 · AI 는 예전에 읽어 둔 값을 계속 보여 줍니다.
       Repo 를 지나면 저장과 함께 통지가 나가 모두가 같은 값을 봅니다. */
    const r = (window.Repo && window.Repo.setValue ? window.Repo : E)
      .setValue(scopeKey(), f.k, val, o.reason, {
        baseValue: base, baseSource: originLabel(f)
      });

    if (!r.ok && r.needReason) { openReason(batch, f, raw, r.reason); return "needReason"; }
    if (!r.ok) { setMsg(f.k, "error", [r.reason || "저장하지 못했습니다"]); return "error"; }
    if (r.action === "None") return "none";

    closeReason(f.k);
    return "saved";
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
    /* 시료에서 바로 결과 입력으로 — 분석팀의 실제 동선입니다 */
    $$("[data-rgo]").forEach(b => b.addEventListener("click", function (e) {
      e.stopPropagation();
      const p = b.dataset.rgo.split("|");
      batchId = p[0]; sampleId = p[1];
      mode = "form";
      location.hash = "";
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

  /* ══════════════════════════════════════════════════════════════════════
     [분석 의뢰하기] 모달 — 입력 폼 안에서 시료를 바로 넘깁니다
     ══════════════════════════════════════════════════════════════════════ */
  function openRequestModal(batch, samples) {
    const old = document.getElementById("req-modal");
    if (old) old.remove();

    const today = window.HubCalendar ? window.HubCalendar.today() : "";
    const due = window.HubCalendar ? window.HubCalendar.addDays(today, 5) : "";
    const team = window.Scope.get().team;

    const d = document.createElement("div");
    d.className = "modal";
    d.id = "req-modal";
    d.setAttribute("role", "dialog");
    d.setAttribute("aria-modal", "true");
    d.setAttribute("aria-label", "분석 의뢰하기");
    d.innerHTML =
      '<div class="modal-box">' +
        '<div class="modal-head">' +
          '<div><h2 class="card-title">분석 의뢰하기</h2>' +
          '<p class="card-sub">' + esc(batch.id) + ' 의 시료를 분석팀에 넘깁니다</p></div>' +
          '<button class="btn-icon" id="rm-x" aria-label="닫기" style="margin-left:auto">' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="2.4"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
        '</div>' +
        '<form class="modal-body" id="rm-form">' +
          '<div class="eyebrow" style="margin-bottom:var(--s-2)">시료 (' + samples.length + '건)</div>' +
          (samples.length
            ? '<div class="req-samples" style="max-height:190px">' + samples.map(function (s) {
                const openReq = Q.forSample(s.id).filter(Q.isOpen).length;
                return '<label class="req-sample">' +
                  '<input type="checkbox" data-msmp="' + esc(s.id) + '"' +
                    (s.id === sampleId ? " checked" : "") + '>' +
                  '<span style="min-width:0;flex:1">' +
                    '<span class="mono" style="font-weight:600;font-size:12.5px">' + esc(s.name) + '</span>' +
                    '<span style="display:block;font-size:11px;color:var(--c-text-mute)">' +
                      esc(s.stage || "채취 시점 미입력") +
                      (s.storage ? " · " + esc(s.storage.freezer + " " + s.storage.rack + " " +
                        s.storage.box + " " + s.storage.pos) : "") + '</span></span>' +
                  (openReq ? '<span class="badge badge-warn" style="font-size:10px">의뢰 중</span>' : "") +
                '</label>';
              }).join("") + '</div>'
            : '<p style="font-size:12.5px;color:var(--c-text-mute)">이 배치에 시료가 없습니다. ' +
              '먼저 [+ 새 Sample 추가]로 시료를 만드세요.</p>') +

          '<div class="eyebrow" style="margin:var(--s-4) 0 var(--s-2)">시험 항목</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
            Object.keys(TEST_LABEL).map(k =>
              '<label class="mm-chip" style="cursor:pointer">' +
                '<input type="checkbox" data-mtest="' + esc(k) + '" style="margin-right:6px">' +
                esc(TEST_LABEL[k]) + '</label>').join("") + '</div>' +

          '<div class="ebr-grid" style="margin-top:var(--s-4)">' +
            '<label class="ebr-cell" style="grid-column:1/-1"><span>의뢰 목적 (필수)</span>' +
              '<input class="ebr-input" id="rm-purpose" ' +
                'placeholder="예: CEX 용출 조건 비교 — 중간 단계 순도 확인"></label>' +
            '<label class="ebr-cell"><span>희망 기한</span>' +
              '<input class="ebr-input mono" id="rm-due" type="date" value="' + esc(due) + '"></label>' +
            '<label class="ebr-cell"><span>우선순위</span>' +
              '<select class="ebr-input" id="rm-priority">' +
                '<option value="normal">일반</option><option value="urgent">긴급</option></select></label>' +
            '<label class="ebr-cell" style="grid-column:1/-1"><span>전달 사항</span>' +
              '<input class="ebr-input" id="rm-note" ' +
                'placeholder="예: 이 배치는 Harvest 생존율이 낮았습니다 — 불순물 확인 필요"></label>' +
          '</div>' +
          '<p class="field-error" id="rm-err" role="alert" style="margin-top:var(--s-3)"></p>' +
        '</form>' +
        '<div class="modal-foot">' +
          '<button class="btn btn-ghost" id="rm-cancel">취소</button>' +
          '<button class="btn btn-accent" id="rm-submit">의뢰 등록</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(d);
    document.body.classList.add("modal-open");

    const close = function () {
      d.remove();
      document.body.classList.remove("modal-open");
      document.removeEventListener("keydown", onKey, true);
    };
    function onKey(e) {
      if (e.key !== "Escape") return;
      const t = (e.target.tagName || "");
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(t)) { e.target.blur(); e.preventDefault(); return; }
      close(); e.preventDefault();
    }
    document.addEventListener("keydown", onKey, true);

    d.querySelector("#rm-x").addEventListener("click", close);
    d.querySelector("#rm-cancel").addEventListener("click", close);
    d.addEventListener("click", function (e) { if (e.target === d) close(); });

    d.querySelector("#rm-submit").addEventListener("click", function () {
      const err = d.querySelector("#rm-err");
      const res = Q.create({
        sampleIds: $$("[data-msmp]", d).filter(c => c.checked).map(c => c.dataset.msmp),
        tests: $$("[data-mtest]", d).filter(c => c.checked).map(c => c.dataset.mtest),
        purpose: d.querySelector("#rm-purpose").value,
        note: d.querySelector("#rm-note").value,
        dueAt: d.querySelector("#rm-due").value,
        priority: d.querySelector("#rm-priority").value,
        requestedTeam: team === "analytics" ? "downstream" : team
      });
      if (!res.ok) { err.textContent = res.reason; err.classList.add("is-shown"); return; }
      close();
      reqOpen = res.request.id;
      reqTab = "queue";
      mode = "requests";
      location.hash = "requests";
      render();
    });

    setTimeout(() => { const p = d.querySelector("#rm-purpose"); if (p) p.focus(); }, 40);
  }

  /* ── 급변 · 편차 경고 ───────────────────────────────────────────────────
     일자별 Titer 는 전일 값과, 그 외 항목은 같은 Study 다른 배치와 견줍니다.
     원본이 스캔본 전사라 자리수·단위 오타가 실제로 들어올 수 있는 데이터입니다. */
  function warningsFor(batch, f, val, it) {
    const num = window.VAL.numeric(val);
    if (num === null || !it) return [];

    const ctx = { value: num, cumulative: !!it.cumulative, prev: null, peers: [] };

    if (f.src && f.src[0] === "titer") {
      const days = window.DATA_TITER_DAYS;
      const i = days.indexOf(f.src[1]);
      for (let j = i - 1; j >= 0; j--) {
        const pv = dayValue(batch, days[j]);
        if (pv !== null) { ctx.prev = { label: days[j], value: pv }; break; }
      }
    }

    if (f.src) {
      ctx.peers = window.DATA_BATCHES
        .filter(b => b.studyId === batch.studyId && b.id !== batch.id)
        .map(b => window.VAL.numeric(window.VAL.coerce(excelValue(b, f.src))))
        .filter(v => v !== null);
    }

    return window.VAL.trendWarnings(ctx);
  }

  /* 전일 값 — 방금 입력한 값(Entries)이 있으면 그쪽이 먼저입니다 */
  function dayValue(batch, day) {
    const rec = E.getValue(scopeKey(), "titer_" + day);
    if (rec) return window.VAL.numeric(rec.value);
    const raw = batch.upstream && batch.upstream.titer ? batch.upstream.titer[day] : null;
    return (raw === null || raw === undefined) ? null : +raw;
  }

  /* ── 변경 사유 입력 ─────────────────────────────────────────────────────
     값이 바뀌는 저장은 사유 없이 통과시키지 않습니다. 팝업 대신 그 필드
     아래에 열어, 무엇을 왜 바꾸는지가 한 화면에 보이게 했습니다. */
  /* ── 변경 사유 입력 (셀에 붙는 popover) ───────────────────────────────
     표 안에 행을 펼치면 아래 행들이 밀려 내려가고, 방금 고친 셀이 화면
     밖으로 나가기도 합니다. 그래서 그 셀에 붙는 떠 있는 창으로 둡니다.

     사유를 저장할 때까지 값은 반영되지 않습니다 — commit() 이 Repo 에서
     needReason 을 받아 여기로 오고, 여기서 사유와 함께 다시 commit 합니다. */
  function openReason(batch, f, raw, note) {
    const cell = cellOf(f.k);
    if (!cell) return;
    closeReason(f.k);
    cell.classList.add("is-asking");

    const anchor = cell.querySelector(".ebr-cellbox") || cell;
    const row = document.createElement("div");
    row.className = "pop reason-pop";
    row.id = "reason-pop";
    row.setAttribute("data-reason-for", f.k);
    row.innerHTML =
      '<div class="reason-head">' + esc(f.label) + ' — ' +
        esc(note || "변경 사유를 입력하세요") + '</div>' +
      '<div class="reason-ctl">' +
        '<label class="sr-only" for="rsn-' + esc(f.k) + '">' + esc(f.label) + ' 변경 사유</label>' +
        '<input class="ebr-input" id="rsn-' + esc(f.k) + '" list="reason-presets" ' +
          'placeholder="예: 오기 정정 (전사 오류)">' +
        '<button class="btn btn-accent btn-sm" data-rsave="' + esc(f.k) + '">사유 저장</button>' +
        '<button class="btn btn-ghost btn-sm" data-rcancel="' + esc(f.k) + '">취소</button>' +
      '</div>' +
      '<div class="reason-foot">사유를 저장해야 값이 반영됩니다. ' +
        '취소하면(Esc) 저장된 값으로 되돌립니다.</div>';

    document.body.appendChild(row);
    placePop(row, anchor);

    const input = row.querySelector("input");
    setTimeout(() => input.focus(), 0);

    function submit() {
      const why = input.value.trim();
      if (why.length < 2) {
        setMsg(f.k, "error", ["사유를 2자 이상 입력하세요."]);
        input.focus();
        return;
      }
      const r = commit(batch, f, raw, { reason: why });
      if (r === "saved") render();
    }

    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); submit(); }
      if (e.key === "Escape") { e.preventDefault(); revert(batch, f); }
    });
    row.querySelector("[data-rsave]").addEventListener("click", submit);
    row.querySelector("[data-rcancel]").addEventListener("click", () => revert(batch, f));
  }

  function revert(batch, f) {
    const cell = cellOf(f.k);
    if (!cell) return;
    const inp = cell.querySelector("[data-f]");
    if (inp) inp.value = displayValue(f, effective(batch, f).value);
    setMsg(f.k, null, []);
    closeReason(f.k);
    if (inp) inp.focus();
  }

  function closeReason(k) {
    const cell = cellOf(k);
    if (cell) cell.classList.remove("is-asking");
    const row = document.getElementById("reason-pop");
    if (row) row.remove();
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
      window.Scope.setTeam(k);
      render();
    });
  }

  /* ★ 조회 바가 아니라 기록 대상 선택만 둡니다.
     여기는 데이터를 찾는 화면이 아니라 기록하는 화면입니다. 검색어 ·
     기간 · 정렬 · 진행 상태 · 조회/초기화 · 조건 태그는 이 화면에서 할
     일이 없는데도 자리를 차지하고, 입력 폼을 화면 아래로 밀어냅니다.

     그래도 선택기를 완전히 없애지는 못합니다 — render() 가 studyId 와
     팀이 정해져야 폼을 그리기 때문입니다(위 169행 부근). 통째로 없애면
     폼이 영구히 "Study 를 선택하세요" 에서 멈춥니다. 엑셀형 입력으로
     재설계할 때 이 선택기까지 함께 교체하면 됩니다. */
  window.StudySelector.mount($("#selector"), { mode: "pick" });
  window.Scope.subscribe(function () { batchId = null; sampleId = null; render(); });
  window.Entries.subscribe(render);
  window.Requests.subscribe(render);
  render();
})();
