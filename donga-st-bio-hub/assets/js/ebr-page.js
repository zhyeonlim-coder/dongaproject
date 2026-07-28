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

  function excelValue(batch, src) {
    if (!src || !batch) return null;
    if (src[0] === "upstream")   return batch.upstream[src[1]];
    if (src[0] === "titer")      return batch.upstream.titer[src[1]];
    if (src[0] === "downstream") return batch.downstream ? batch.downstream[src[1]] : null;
    if (src[0] === "meta")       return batch[src[1]];
    const g = batch.analytics[src[0]];
    return g ? g[src[1]] : null;
  }

  function effective(batch, f) {
    const rec = E.getValue(scopeKey(), f.k);
    if (rec) return { value: rec.value, rec, fromExcel: false };
    /* Sample 단위 입력에서는 Excel 원본을 그대로 보여주지 않습니다 —
       Excel 값은 Batch 측정치이고 Sample 은 그 하위 분취라 다른 대상입니다. */
    if (sampleId) return { value: null, rec: null, fromExcel: false };
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
      if (!batches.length) { gate("이 범위에 배치가 없습니다."); return; }
      if (!batchId || !batches.some(b => b.id === batchId)) batchId = batches[0].id;
      const batch = batches.find(b => b.id === batchId);
      const samples = E.getSamples(batchId);
      if (sampleId && !samples.some(s => s.id === sampleId)) sampleId = null;

      const groups = FIELDS[sel.team]();
      const teamKo = (window.DATA_TEAMS.find(t => t.id === sel.team) || {}).ko || sel.team;

      $("#form-host").innerHTML =
        '<section class="card" style="border-top:3px solid ' +
          ((window.DATA_TEAMS.find(t => t.id === sel.team) || {}).color || "var(--c-accent)") + '">' +
          '<div class="card-head" style="flex-wrap:wrap;gap:var(--s-3)">' +
            '<div><h2 class="card-title">' + esc(teamKo) + ' 서식</h2>' +
            '<p class="card-sub">' + (sampleId ? esc(L.ui.sampleName) + " 단위 입력" : "Batch 단위 입력") +
            ' · 저장 시 작성자와 시각이 자동 기록됩니다</p></div>' +
            targetPicker(batches, samples) +
          '</div>' +

          (sel.team === "downstream"
            ? '<div class="card-body" style="padding-bottom:0"><div class="demo-note">' +
              '정제 공정 값은 Protein A → CEX → AEX 3-step 기준입니다. ' +
              '수정하면 기존 값을 덮어쓰지 않고 변경 이력으로 쌓입니다.</div></div>' : "") +

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

      wireForm(batch, groups);
    });
  }

  function gate(msg) {
    $("#form-host").innerHTML = '<div class="gate">' +
      '<p style="font-size:13.5px;color:var(--c-text-mute);margin:0">' + esc(msg) + '</p></div>';
  }

  /* Batch / Sample 선택 + Sample 생성 */
  function targetPicker(batches, samples) {
    return '<div style="display:flex;gap:var(--s-3);align-items:end;flex-wrap:wrap">' +
      '<label class="ebr-cell" style="min-width:130px"><span>Batch</span>' +
        '<select class="ebr-input" id="pick-batch">' +
          batches.map(b => '<option value="' + esc(b.id) + '"' +
            (b.id === batchId ? " selected" : "") + '>' + esc(b.id) + '</option>').join("") +
        '</select></label>' +
      '<label class="ebr-cell" style="min-width:170px"><span>' + esc(L.ui.sampleName) + '</span>' +
        '<select class="ebr-input" id="pick-sample">' +
          '<option value="">— Batch 단위 —</option>' +
          samples.map(s => '<option value="' + esc(s.id) + '"' +
            (s.id === sampleId ? " selected" : "") + '>' + esc(s.name) + '</option>').join("") +
        '</select></label>' +
      '<button class="btn btn-ghost btn-sm" id="new-sample">' + esc(L.ui.addSample) + '</button>' +
    '</div>';
  }

  function fieldMarkup(batch, f) {
    const eff = effective(batch, f);
    const v = eff.value;
    const rec = eff.rec;
    /* 초기값의 출처를 정확히 씁니다. 정제 항목은 Excel 에 없는 컬럼이라
       "Excel 원본" 이라고 쓰면 거짓말이 됩니다. */
    const origin = (f.src && f.src[0] === "downstream") ? "초기값" : "Excel 원본";
    const cap = rec ? E.caption(rec)
      : (eff.fromExcel && v !== null ? origin : null);

    return '<label class="ebr-cell">' +
      '<span>' + esc(f.label) + (f.unit ? ' <span style="font-weight:400;color:var(--c-text-soft)">(' +
        esc(f.unit) + ')</span>' : "") + '</span>' +
      '<input class="ebr-input" data-f="' + esc(f.k) + '" ' +
        'type="' + (f.type === "date" ? "date" : f.type === "text" ? "text" : "number") + '" ' +
        (f.type === "date" || f.type === "text" ? "" : 'step="any" ') +
        'value="' + (v === null || v === undefined ? "" : esc(v)) + '">' +
      '<span class="audit">' +
        (cap ? esc(cap) : '<span class="audit-none">미입력</span>') +
        (rec && E.hasHistory(rec)
          ? '<button class="audit-hist" data-hist="' + esc(f.k) + '" ' +
            'aria-label="' + esc(f.label) + ' 변경 이력 보기" title="변경 이력 ' +
            rec.history.length + '건">' +
            '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="2.6"><path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/></svg></button>'
          : "") +
      '</span>' +
    '</label>';
  }

  /* ── 저장 ───────────────────────────────────────────────────────────── */
  function wireForm(batch, groups) {
    $("#pick-batch").addEventListener("change", function () {
      batchId = this.value; sampleId = null; render();
    });
    $("#pick-sample").addEventListener("change", function () {
      sampleId = this.value || null; render();
    });
    $("#new-sample").addEventListener("click", function () {
      const name = window.prompt(L.ui.sampleName + " 이름을 입력하세요\n(예: " + batchId + "-S1, pH 6.0 조건군)");
      if (name === null) return;
      const r = E.addSample({ batchId, studyId: batch.studyId, name });
      if (!r.ok) { window.alert(r.reason); return; }
      sampleId = r.sample.id;
      render();
    });

    const all = groups.reduce((a, g) => a.concat(g.items), []);

    $$("[data-f]").forEach(function (inp) {
      inp.addEventListener("change", function () {
        const f = all.find(x => x.k === inp.dataset.f);
        commit(batch, f, inp.value);
      });
    });

    $("#save-all").addEventListener("click", function () {
      let n = 0;
      $$("[data-f]").forEach(function (inp) {
        const f = all.find(x => x.k === inp.dataset.f);
        if (commit(batch, f, inp.value, true)) n++;
      });
      const m = $("#save-msg");
      m.textContent = n ? n + "개 항목 저장됨" : "변경된 값이 없습니다";
      setTimeout(() => { m.textContent = ""; }, 2600);
      render();
    });

    $$("[data-hist]").forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.preventDefault();
        showHistory(b, E.getValue(scopeKey(), b.dataset.hist),
          (all.find(x => x.k === b.dataset.hist) || {}).label);
      });
    });
  }

  function commit(batch, f, raw, silent) {
    if (!f) return false;
    const isNum = f.type !== "date" && f.type !== "text";
    const val = raw === "" ? null : (isNum ? Number(raw) : raw);
    const eff = effective(batch, f);
    const cur = eff.value;
    if (String(cur === null ? "" : cur) === String(val === null ? "" : val)) return false;
    E.setValue(scopeKey(), f.k, val);
    if (!silent) render();
    return true;
  }

  /* ── 변경 이력 팝오버 ───────────────────────────────────────────────── */
  function showHistory(anchor, rec, label) {
    const old = document.getElementById("hist-pop");
    if (old) old.remove();
    if (!rec) return;

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
        '<span class="pop-val">' + esc(rec.value === null ? L.empty : rec.value) + '</span>' +
        '<span style="color:var(--c-text-mute)">' + esc(E.caption(rec)) + '</span></div>' +
      rec.history.slice().reverse().map(h =>
        '<div class="pop-row">' +
          '<span><span class="pop-val">' + esc(h.previousValue === null ? L.empty : h.previousValue) +
          '</span> <span class="pop-arrow">→</span> </span>' +
          '<span style="color:var(--c-text-mute)">' + esc(h.changedBy) + ' · ' +
          esc(E.stampHuman(h.changedAt)) + '</span>' +
          (h.reason ? '<span style="color:var(--c-text-mute)">사유: ' + esc(h.reason) + '</span>' : "") +
        '</div>').join("") +
      '<div style="font-size:10.5px;color:var(--c-text-mute);margin-top:var(--s-3)">' +
        '원본 값은 삭제되지 않고 모두 보존됩니다.</div>';

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
