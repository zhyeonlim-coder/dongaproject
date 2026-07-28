/* ==========================================================================
   EBR 입력  [지시서 §1 §3 §5]

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

  /* ── 팀별 필드 세트 ─────────────────────────────────────────────────── */
  const FIELDS = {
    upstream: function () {
      const days = window.DATA_TITER_DAYS.filter(d =>
        window.DATA_BATCHES.some(b => b.upstream.titer[d] !== null));
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
    if (src[0] === "upstream")   return batch.upstream[src[1]];
    if (src[0] === "titer")      return batch.upstream.titer[src[1]];
    if (src[0] === "downstream") return batch.downstream ? batch.downstream[src[1]] : null;
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

  /* ── 렌더 ───────────────────────────────────────────────────────────── */
  function render() {
    const sel = window.Scope.get();
    const desc = window.Scope.describe();

    $("#crumb").innerHTML = desc.path.length
      ? desc.path.map((p, i) => (i ? '<span class="crumb-sep">›</span>' : "") +
          '<span>' + esc(p.label) + '</span>').join("") +
        (batchId ? '<span class="crumb-sep">›</span><span class="mono">' + esc(batchId) + '</span>' : "") +
        (sampleId ? '<span class="crumb-sep">›</span><span>' +
          esc((E.getSamples(batchId).find(s => s.id === sampleId) || {}).name || "") + '</span>' : "")
      : '<span style="color:var(--c-text-mute)">과제를 선택하세요</span>';

    if (!sel.scopeId) { gate("상단에서 과제를 선택하세요."); return; }
    if (!window.Scope.skipsStudyStep() && !sel.studyId) {
      gate("좌측 필터에서 Study를 선택하세요."); return;
    }
    if (!sel.team) {
      gate("팀을 선택해야 입력 폼이 열립니다. (팀 미지정 상태에서는 저장할 수 없습니다)"); return;
    }

    window.Scope.batches().then(function (batches) {
      if (!batches.length) { gate(L.noResult + " " + L.noResultHint); return; }
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

          groups.map(function (grp) {
            return '<div class="card-body" style="padding-bottom:var(--s-4)">' +
              '<div class="eyebrow" style="margin-bottom:var(--s-3)">' + esc(grp.g) + '</div>' +
              '<div class="ebr-grid">' + grp.items.map(f => fieldMarkup(batch, f)).join("") + '</div>' +
            '</div>';
          }).join("") +

          '<div class="card-body" style="border-top:1px solid var(--c-border);display:flex;' +
            'gap:var(--s-3);align-items:center;flex-wrap:wrap">' +
            '<button class="btn btn-accent" id="save-all">전체 저장</button>' +
            '<span style="font-size:12px;color:var(--c-text-mute)">' +
              '값을 바꾸고 필드를 벗어나면 즉시 저장됩니다. 이 버튼은 일괄 저장용입니다.</span>' +
            '<span id="save-msg" style="font-size:12px;color:var(--c-ok);font-weight:600"></span>' +
          '</div>' +
        '</section>';

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
      '<button class="btn btn-ghost btn-sm" id="new-sample">' + esc(L.ui.addSample) + '</button>' +
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
  function baseValueOf(batch, f) {
    if (sampleId) return null;                    // Sample 은 Batch 값을 물려받지 않습니다
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

  function fieldMarkup(batch, f) {
    const eff = effective(batch, f);
    const v = eff.value;
    const rec = eff.rec;
    const cap = rec ? E.caption(rec)
      : (eff.fromExcel && v !== null && v !== undefined ? originLabel(f) : null);

    const measure = isMeasure(f);
    const cur = measure ? window.VAL.coerce(v) : null;
    const miss = measure ? window.VAL.missingInfo(cur) : null;

    return '<div class="ebr-field" data-cell="' + esc(f.k) + '">' +
      '<label class="ebr-cell">' +
        '<span>' + esc(f.label) + (f.unit ? ' <span style="font-weight:400;color:var(--c-text-soft)">(' +
          esc(f.unit) + ')</span>' : "") + '</span>' +
        '<input class="ebr-input' + (miss ? " is-missing" : "") +
          (measure && window.VAL.isBounded(cur) ? " is-bounded" : "") + '" ' +
          'data-f="' + esc(f.k) + '" ' +
          (measure
            ? 'type="text" inputmode="decimal" autocomplete="off" list="val-tokens" ' +
              'placeholder="숫자 · <1 · ND"'
            : 'type="' + (f.type === "date" ? "date" : "text") + '" ') +
          ' value="' + esc(displayValue(f, v)) + '">' +
      '</label>' +
      '<span class="audit">' +
        (miss ? '<span class="miss-tag miss-' + miss.code + '" title="' + esc(miss.hint) + '">' +
                esc(miss.label) + '</span> ' : "") +
        (cap ? esc(cap) : '<span class="audit-none">미측정</span>') +
        (rec && E.hasHistory(rec)
          ? '<button class="audit-hist" data-hist="' + esc(f.k) + '" ' +
            'aria-label="' + esc(f.label) + ' 변경 이력 보기" title="변경 이력 ' +
            rec.history.length + '건">' +
            '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="2.6"><path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/></svg></button>'
          : "") +
      '</span>' +
      '<p class="field-msg" data-msg="' + esc(f.k) + '" role="alert"></p>' +
      '<div class="reason-row" data-reason="' + esc(f.k) + '" hidden></div>' +
    '</div>';
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

    /* 폼 안으로 범위를 좁힙니다 — 좌측 StudySelector 도 [data-f] 를 쓰기 때문에
       문서 전체를 훑으면 그 드롭다운까지 저장 대상으로 잡힙니다. */
    const host = $("#form-host");
    const fieldInputs = () => $$("[data-f]", host);

    fieldInputs().forEach(function (inp) {
      inp.addEventListener("change", function () {
        const f = all.find(x => x.k === inp.dataset.f);
        const r = commit(batch, f, inp.value);
        if (r === "saved") render();
      });
    });

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

    $$("[data-hist]", host).forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.preventDefault();
        showHistory(b, E.getValue(scopeKey(), b.dataset.hist),
          (all.find(x => x.k === b.dataset.hist) || {}));
      });
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
    const r = E.setValue(scopeKey(), f.k, val, o.reason, {
      baseValue: base, baseSource: originLabel(f)
    });

    if (!r.ok && r.needReason) { openReason(batch, f, raw, r.reason); return "needReason"; }
    if (!r.ok) { setMsg(f.k, "error", [r.reason || "저장하지 못했습니다"]); return "error"; }
    if (r.action === "None") return "none";

    closeReason(f.k);
    return "saved";
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
  function openReason(batch, f, raw, note) {
    const cell = cellOf(f.k);
    if (!cell) return;
    const row = cell.querySelector("[data-reason]");
    cell.classList.add("is-asking");
    row.hidden = false;
    row.innerHTML =
      '<div class="reason-head">' + esc(note || "변경 사유를 입력하세요") + '</div>' +
      '<div class="reason-ctl">' +
        '<label class="sr-only" for="rsn-' + esc(f.k) + '">' + esc(f.label) + ' 변경 사유</label>' +
        '<input class="ebr-input" id="rsn-' + esc(f.k) + '" list="reason-presets" ' +
          'placeholder="예: 오기 정정 (전사 오류)">' +
        '<button class="btn btn-accent btn-sm" data-rsave="' + esc(f.k) + '">사유 저장</button>' +
        '<button class="btn btn-ghost btn-sm" data-rcancel="' + esc(f.k) + '">취소</button>' +
      '</div>';

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
    if (!cell) return;
    cell.classList.remove("is-asking");
    const row = cell.querySelector("[data-reason]");
    row.hidden = true;
    row.innerHTML = "";
  }

  /* ── 변경 이력 팝오버 ───────────────────────────────────────────────── */
  function showHistory(anchor, rec, f) {
    const old = document.getElementById("hist-pop");
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

    document.body.appendChild(pop);
    const top = Math.min(r.bottom + 6, window.innerHeight - pop.offsetHeight - 10);
    const left = Math.min(r.left, window.innerWidth - pop.offsetWidth - 10);
    pop.style.top = Math.max(10, top) + "px";
    pop.style.left = Math.max(10, left) + "px";

    pop.querySelector("#hist-close").addEventListener("click", () => pop.remove());
    setTimeout(() => {
      document.addEventListener("click", function h(e) {
        if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener("click", h); }
      });
    }, 0);
  }

  /* ── 서브메뉴: 팀 전환 ──────────────────────────────────────────────── */
  function paintSubnav() {
    const sel = window.Scope.get();
    window.Shell.subnav([
      { label: "팀 서식", items: window.DATA_TEAMS.map(t => ({
        key: t.id, ko: t.ko, active: sel.team === t.id, color: t.color })) },
      { label: "바로가기", items: [
        { ko: "대시보드", href: "dashboard.html" },
        { ko: "데이터 조회", href: "data.html" }
      ]}
    ], k => window.Scope.setTeam(k));
  }

  window.StudySelector.mount($("#selector"));
  window.Scope.subscribe(function () { batchId = null; sampleId = null; paintSubnav(); render(); });
  window.Entries.subscribe(render);
  paintSubnav();
  render();
})();
