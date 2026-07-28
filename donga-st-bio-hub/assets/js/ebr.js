/* ==========================================================================
   EBR data entry — electronic batch record style forms

   Three department forms behind one 과제 → Study selector. Analysis values are
   judged against LAB.SPECS as you type, so PASS / OOS is visible before save
   rather than after. Saving writes through Store, which updates the dashboard
   and the mini-calendar (진행 중 → 완료).
   ========================================================================== */

(function () {
  "use strict";

  const user = window.Shell.mount({ page: "ebr" });
  if (!user) return;

  const L = window.LAB, S = window.Store;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  let dept = (location.hash || "").replace("#", "") || "culture";
  if (["culture", "purif", "analysis"].indexOf(dept) === -1) dept = "culture";
  let study = null;
  let batchId = null;

  function studies() { return L.STUDIES.filter(s => s.prj === window.Shell.project()); }
  function batches() { return S.batches().filter(b => b.prj === window.Shell.project()); }

  function ensureSelections() {
    const ss = studies();
    if (!study || !ss.some(s => s.id === study)) study = ss.length ? ss[0].id : null;
    const bs = batches();
    if (!batchId || !bs.some(b => b.id === batchId)) batchId = bs.length ? bs[bs.length - 1].id : null;
  }

  /* ── Sub-menu ───────────────────────────────────────────────────────── */
  function paintSubnav() {
    window.Shell.subnav([
      { label: "부서 서식", items: [
        { key: "culture",  ko: "배양공정 서식", active: dept === "culture",  color: L.DEPTS.culture.color },
        { key: "purif",    ko: "정제공정 서식", active: dept === "purif",    color: L.DEPTS.purif.color },
        { key: "analysis", ko: "바이오분석 서식", active: dept === "analysis", color: L.DEPTS.analysis.color }
      ]},
      { label: "바로가기", items: [
        { ko: "대시보드", href: "dashboard.html" },
        { ko: "장비 예약", href: "booking.html" }
      ]}
    ], key => { dept = key; location.hash = key; paint(); });
  }

  /* ── Toast ──────────────────────────────────────────────────────────── */
  function toast(msg, kind) {
    const t = $("#toast");
    t.innerHTML = '<div class="card" style="border-left:3px solid ' +
      (kind === "err" ? "var(--c-risk)" : "var(--c-ok)") + ';padding:var(--s-3) var(--s-4);font-size:13px">' +
      esc(msg) + '</div>';
    t.style.display = "block";
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.style.display = "none"; }, 3200);
  }

  /* ── 1. Cultivation form ────────────────────────────────────────────── */
  function cultureForm() {
    const bs = batches();
    if (!bs.length) return newBatchBlock();

    const b = bs.find(x => x.id === batchId) || bs[bs.length - 1];
    batchId = b.id;
    const rows = S.cultureRows(b.id);
    const nextDay = rows.length ? Math.max.apply(null, rows.map(r => r.day)) + 1 : 0;

    return '<div class="card-body">' +
      '<div style="display:flex;flex-wrap:wrap;gap:var(--s-4);align-items:end;margin-bottom:var(--s-5)">' +
        field("배치 선택", '<select class="ebr-input" id="c-batch">' +
          bs.map(x => '<option value="' + esc(x.id) + '"' + (x.id === b.id ? " selected" : "") + '>' +
            esc(x.id) + ' · ' + esc(x.scale) + '</option>').join("") + '</select>') +
        field("접종일", '<input class="ebr-input" value="' + esc(b.inoc) + '" readonly>') +
        field("세포주", '<input class="ebr-input" value="' + esc(b.cell) + '" readonly>') +
        field("장비", '<input class="ebr-input" value="' + esc(b.equip || "—") + '" readonly>') +
        '<button class="btn btn-ghost btn-sm" id="c-new">+ 새 배치</button>' +
      '</div>' +

      '<div class="eyebrow" style="margin-bottom:var(--s-3)">일자별 공정 데이터 입력</div>' +
      '<div class="day-row day-row-head">' +
        ['Day', 'pH', 'DO (%)', 'Temp (°C)', 'Glucose (g/L)', 'VCD (×10⁶)', 'Titer (g/L)']
          .map(h => '<span>' + h + '</span>').join("") +
      '</div>' +
      '<div id="c-rows">' +
        rows.map(r =>
          '<div class="day-row">' +
            '<span class="day-tag">D' + r.day + '</span>' +
            ['ph', 'do2', 'temp', 'glc', 'vcd', 'titer'].map(k =>
              '<span class="mono" style="font-size:12.5px;padding-left:4px">' +
                (r[k] == null ? "—" : r[k]) + '</span>').join("") +
          '</div>').join("") +
      '</div>' +

      '<div class="rule-hair" style="margin:var(--s-5) 0"></div>' +
      '<div class="eyebrow" style="margin-bottom:var(--s-3)">Day ' + nextDay + ' 기록 추가</div>' +
      '<form id="c-form">' +
        '<div class="day-row" style="border:0">' +
          '<span class="day-tag">D' + nextDay + '</span>' +
          ['ph', 'do2', 'temp', 'glc', 'vcd', 'titer'].map((k, i) =>
            '<span><label class="sr-only" for="c-' + k + '">' +
              ['pH', 'DO', 'Temp', 'Glucose', 'VCD', 'Titer'][i] + '</label>' +
              '<input class="ebr-input" id="c-' + k + '" type="number" step="any" placeholder="' +
              ['7.00', '40', '36.5', '5.0', '0.3', '0.0'][i] + '"></span>').join("") +
        '</div>' +
        '<div style="display:flex;gap:var(--s-3);margin-top:var(--s-4);align-items:center;flex-wrap:wrap">' +
          '<button class="btn btn-accent" type="submit">Day ' + nextDay + ' 저장</button>' +
          '<button class="btn btn-ghost" type="button" id="c-harvest">수확 완료 · 정제팀 전달</button>' +
          '<span style="font-size:12px;color:var(--c-text-mute)">저장 시 대시보드와 캘린더가 즉시 갱신됩니다.</span>' +
        '</div>' +
        '<p class="field-error" id="c-err" role="alert" style="margin-top:var(--s-3)"></p>' +
      '</form>' +
    '</div>';
  }

  function newBatchBlock() {
    return '<div class="card-body">' +
      '<div class="empty" style="padding:var(--s-8) var(--s-4)">' +
        '<div class="empty-title">이 과제에 배양 배치가 없습니다</div>' +
        '<div class="empty-body">배치를 생성하면 일자별 공정 데이터를 기록할 수 있습니다.</div>' +
      '</div>' + newBatchForm() + '</div>';
  }

  function newBatchForm() {
    const ss = studies();
    return '<form id="nb-form" style="max-width:760px;margin:0 auto">' +
      '<div class="ebr-grid">' +
        field("Batch ID", '<input class="ebr-input" id="nb-id" placeholder="B2404">') +
        field("스터디", '<select class="ebr-input" id="nb-study">' +
          ss.map(s => '<option value="' + s.id + '">Study #' + s.no + ' ' + esc(s.ko) + '</option>').join("") + '</select>') +
        field("접종일", '<input class="ebr-input" id="nb-inoc" type="date" value="' + S.today() + '">') +
        field("스케일", '<select class="ebr-input" id="nb-scale"><option>5 L</option><option>10 L</option>' +
          '<option>50 L</option><option>200 L</option></select>') +
        field("세포주", '<select class="ebr-input" id="nb-cell"><option>CHO-K1</option><option>CHO-DG44</option></select>') +
        field("장비", '<select class="ebr-input" id="nb-equip">' +
          L.EQUIPMENT.filter(e => e.dept === "culture").map(e =>
            '<option value="' + e.id + '">' + esc(e.id) + ' · ' + esc(e.ko) + '</option>').join("") + '</select>') +
      '</div>' +
      '<button class="btn btn-accent" type="submit" style="margin-top:var(--s-4)">배치 생성</button>' +
      '<p class="field-error" id="nb-err" role="alert" style="margin-top:var(--s-3)"></p>' +
    '</form>';
  }

  /* ── 2. Purification form ───────────────────────────────────────────── */
  function purifForm() {
    const bs = batches();
    const runs = S.purifRuns().filter(r => bs.some(b => b.id === r.batch));
    return '<div class="card-body">' +
      '<form id="p-form">' +
        '<div class="ebr-grid" style="margin-bottom:var(--s-4)">' +
          field("Run ID", '<input class="ebr-input" id="p-id" placeholder="P2404-A">') +
          field("연계 배양 Batch", '<select class="ebr-input" id="p-batch">' +
            (bs.length ? bs.map(b => '<option value="' + esc(b.id) + '">' + esc(b.id) + '</option>').join("")
                       : '<option value="">배치 없음</option>') + '</select>') +
          field("Resin 종류", '<select class="ebr-input" id="p-resin">' +
            ["MabSelect SuRe", "MabSelect PrismA", "Capto S ImpAct", "Capto Q", "Capto adhere"]
              .map(r => '<option>' + r + '</option>').join("") + '</select>') +
          field("Column Volume (CV)", '<input class="ebr-input" id="p-cv" type="number" step="any" placeholder="20">') +
          field("Flow Rate (cm/h)", '<input class="ebr-input" id="p-flow" type="number" step="any" placeholder="300">') +
          field("수행일", '<input class="ebr-input" id="p-date" type="date" value="' + S.today() + '">') +
          field("체류시간 (min)", '<input class="ebr-input" id="p-rt" type="number" step="any" placeholder="6">') +
          field("부하량 (g/L resin)", '<input class="ebr-input" id="p-load" type="number" step="any" placeholder="50">') +
          field("DBC (g/L)", '<input class="ebr-input" id="p-dbc" type="number" step="any" data-spec="DBC" placeholder="42">' +
            '<span class="spec spec-none" data-badge="DBC" style="margin-top:5px">규격 ≥ 35</span>') +
          field("SEC 순도 (%)", '<input class="ebr-input" id="p-sec" type="number" step="any" data-spec="SEC_monomer" placeholder="97.0">' +
            '<span class="spec spec-none" data-badge="SEC_monomer" style="margin-top:5px">규격 ≥ 95</span>') +
          field("Recovery (%)", '<input class="ebr-input" id="p-rec" type="number" step="any" placeholder="92.0">') +
          field("HCP (ng/mg)", '<input class="ebr-input" id="p-hcp" type="number" step="any" data-spec="HCP" placeholder="45">' +
            '<span class="spec spec-none" data-badge="HCP" style="margin-top:5px">규격 ≤ 100</span>') +
          field("잔류 DNA (pg/mg)", '<input class="ebr-input" id="p-hcd" type="number" step="any" data-spec="HCD" placeholder="5">' +
            '<span class="spec spec-none" data-badge="HCD" style="margin-top:5px">규격 ≤ 10</span>') +
        '</div>' +
        '<div style="display:flex;gap:var(--s-3);align-items:center;flex-wrap:wrap">' +
          '<button class="btn btn-accent" type="submit">정제 기록 저장</button>' +
          '<button class="btn btn-ghost" type="button" id="p-request">분석 의뢰 등록</button>' +
        '</div>' +
        '<p class="field-error" id="p-err" role="alert" style="margin-top:var(--s-3)"></p>' +
      '</form>' +

      (runs.length ? '<div class="rule-hair" style="margin:var(--s-6) 0 var(--s-4)"></div>' +
        '<div class="eyebrow" style="margin-bottom:var(--s-3)">기록된 정제 런</div>' +
        '<div class="tbl-scroll"><table class="tbl"><thead><tr>' +
          ['Run', '배양 Batch', 'Resin', 'CV', 'Flow', 'Recovery', 'HCP', 'DNA', '일자']
            .map(h => '<th scope="col">' + h + '</th>').join("") + '</tr></thead><tbody>' +
        runs.map(r => '<tr><td class="mono" style="font-weight:600">' + esc(r.id) + '</td>' +
          '<td class="mono">' + esc(r.batch) + '</td><td>' + esc(r.resin) + '</td>' +
          '<td class="mono">' + r.cv + '</td><td class="mono">' + r.flow + '</td>' +
          '<td class="mono">' + r.recovery + '%</td><td class="mono">' + r.hcp + '</td>' +
          '<td class="mono">' + r.hcd + '</td><td class="mono">' + esc(r.date) + '</td></tr>').join("") +
        '</tbody></table></div>' : "") +
    '</div>';
  }

  /* ── 3. Analysis form ───────────────────────────────────────────────── */
  /* Mirrors the analytics package in the brief:
     전하 이형체(CEX) · 질량 분석(Intact Mass) · 결합 친화도(K_D) */
  const METHOD_ITEMS = {
    SEC:     ["SEC_monomer", "SEC_hmw"],
    CEX:     ["CEX_main", "CEX_acidic", "CEX_basic"],
    SDS:     ["SDS_purity"],
    Mass:    ["Mass_obs", "Mass_delta"],
    Binding: ["KD"],
    Glycan:  ["G0F", "G1F", "Afucosylation"],
    Potency: ["Potency"]
  };

  let method = "SEC";

  function analysisForm() {
    const bs = batches();
    const runs = S.purifRuns().filter(r => bs.some(b => b.id === r.batch));
    const items = METHOD_ITEMS[method];
    const done = S.analyses().filter(a => runs.some(r => r.id === a.sample));

    return '<div class="card-body">' +
      '<form id="a-form">' +
        '<div class="ebr-grid" style="margin-bottom:var(--s-4)">' +
          field("분석 ID", '<input class="ebr-input" id="a-id" placeholder="A2404-01">') +
          field("시료 (정제 Run)", '<select class="ebr-input" id="a-sample">' +
            (runs.length ? runs.map(r => '<option value="' + esc(r.id) + '">' + esc(r.id) + '</option>').join("")
                         : '<option value="">정제 런 없음</option>') + '</select>') +
          field("분석 항목", '<select class="ebr-input" id="a-method">' +
            Object.keys(METHOD_ITEMS).map(m => '<option' + (m === method ? " selected" : "") + '>' + m + '</option>').join("") +
            '</select>') +
          field("장비", '<select class="ebr-input" id="a-equip">' +
            L.EQUIPMENT.filter(e => e.dept === "analysis").map(e =>
              '<option value="' + e.id + '">' + esc(e.id) + ' · ' + esc(e.ko) + '</option>').join("") + '</select>') +
          field("분석일", '<input class="ebr-input" id="a-date" type="date" value="' + S.today() + '">') +
        '</div>' +

        '<div class="eyebrow" style="margin-bottom:var(--s-3)">결과 입력 · 입력 즉시 규격 판정</div>' +
        '<div class="ebr-grid" style="margin-bottom:var(--s-4)">' +
          items.map(k => {
            const sp = L.SPECS[k];
            return '<div class="ebr-cell">' +
              '<label for="a-' + k + '">' + esc(sp.ko) + ' (' + esc(sp.unit) + ')</label>' +
              '<input class="ebr-input" id="a-' + k + '" type="number" step="any" data-spec="' + k + '">' +
              '<span class="spec spec-none" data-badge="' + k + '">규격 ' + esc(L.specText(k)) + '</span>' +
            '</div>';
          }).join("") +
        '</div>' +

        '<button class="btn btn-accent" type="submit">분석 결과 저장</button>' +
        '<p class="field-error" id="a-err" role="alert" style="margin-top:var(--s-3)"></p>' +
      '</form>' +

      (done.length ? '<div class="rule-hair" style="margin:var(--s-6) 0 var(--s-4)"></div>' +
        '<div class="eyebrow" style="margin-bottom:var(--s-3)">기록된 분석 결과</div>' +
        '<div class="tbl-scroll"><table class="tbl"><thead><tr>' +
          ['분석 ID', '시료', '항목', '결과', '규격', '판정', '일자']
            .map(h => '<th scope="col">' + h + '</th>').join("") + '</tr></thead><tbody>' +
        done.reduce((acc, a) => acc.concat(Object.keys(a.results || {}).map(k => {
          const j = L.judge(k, a.results[k]);
          return '<tr><td class="mono">' + esc(a.id) + '</td><td class="mono">' + esc(a.sample) + '</td>' +
            '<td>' + esc(L.SPECS[k] ? L.SPECS[k].ko : k) + '</td>' +
            '<td class="mono" style="font-weight:600">' + a.results[k] + '</td>' +
            '<td class="mono" style="color:var(--c-text-mute)">' + esc(L.specText(k)) + '</td>' +
            '<td>' + (j ? '<span class="spec ' + (j.pass ? "spec-pass" : "spec-oos") + '">' +
              (j.pass ? "PASS" : "OOS") + '</span>' : "—") + '</td>' +
            '<td class="mono">' + esc(a.date) + '</td></tr>';
        })), []).join("") +
        '</tbody></table></div>' : "") +
    '</div>';
  }

  /* The cell IS the <label>, so the control inside is implicitly associated.
     A bare <label> with no `for` gives the input no accessible name. */
  function field(label, control) {
    return '<label class="ebr-cell"><span>' + esc(label) + '</span>' + control + '</label>';
  }

  /* ── Live spec judging ──────────────────────────────────────────────── */
  function wireSpecInputs(root) {
    $$("[data-spec]", root).forEach(inp => {
      const key = inp.dataset.spec;
      const badge = $('[data-badge="' + key + '"]', root);
      const judgeNow = () => {
        const j = L.judge(key, inp.value);
        inp.classList.remove("is-oos", "is-pass");
        if (!j) {
          badge.className = "spec spec-none";
          badge.textContent = "규격 " + L.specText(key);
          return;
        }
        inp.classList.add(j.pass ? "is-pass" : "is-oos");
        badge.className = "spec " + (j.pass ? "spec-pass" : "spec-oos");
        badge.textContent = (j.pass ? "PASS" : "OOS") + " · 규격 " + j.spec;
      };
      inp.addEventListener("input", judgeNow);
      judgeNow();
    });
  }

  /* ── Paint + wire ───────────────────────────────────────────────────── */
  function paint() {
    ensureSelections();
    paintSubnav();

    const p = L.PROJECTS.find(x => x.id === window.Shell.project());
    const ss = studies();
    const s = ss.find(x => x.id === study);

    $("#page-title").textContent = "EBR 데이터 입력 · " + (p ? p.id : "");
    $("#ebr-study").innerHTML = ss.map(x =>
      '<button class="track-tab" data-study="' + x.id + '" aria-selected="' + (x.id === study) + '" ' +
        'style="min-height:38px;padding:0 var(--s-4)">Study #' + x.no +
        '<span style="font-weight:400"> · ' + esc(x.ko) + '</span></button>').join("") ||
      '<span style="font-size:13px;color:var(--c-text-mute)">이 과제에는 스터디가 없습니다.</span>';
    $$("[data-study]").forEach(b => b.addEventListener("click", () => { study = b.dataset.study; paint(); }));

    const d = L.DEPTS[dept];
    $("#form-title").textContent = d.ko + " 서식";
    $("#form-sub").textContent = (s ? "Study #" + s.no + " " + s.ko + " · " : "") + d.en;
    $("#form-card").style.borderTop = "3px solid " + d.color;

    const host = $("#form-body");
    host.innerHTML = dept === "culture" ? cultureForm()
                   : dept === "purif" ? purifForm() : analysisForm();
    wireSpecInputs(host);
    wireForms();
  }

  function wireForms() {
    /* Cultivation */
    const cBatch = $("#c-batch");
    if (cBatch) cBatch.addEventListener("change", () => { batchId = cBatch.value; paint(); });

    const cNew = $("#c-new");
    if (cNew) cNew.addEventListener("click", () => {
      $("#form-body").innerHTML = '<div class="card-body">' + newBatchForm() + '</div>';
      wireForms();
    });

    const nb = $("#nb-form");
    if (nb) nb.addEventListener("submit", e => {
      e.preventDefault();
      const id = $("#nb-id").value.trim().toUpperCase();
      const err = $("#nb-err");
      if (!id) { err.textContent = "Batch ID를 입력하세요"; err.classList.add("is-shown"); $("#nb-id").focus(); return; }
      if (S.batches().some(b => b.id === id)) {
        err.textContent = "이미 존재하는 Batch ID입니다"; err.classList.add("is-shown"); $("#nb-id").focus(); return;
      }
      err.classList.remove("is-shown");
      S.addBatch({ id, prj: window.Shell.project(), study: $("#nb-study").value,
        scale: $("#nb-scale").value, cell: $("#nb-cell").value, inoc: $("#nb-inoc").value,
        days: 0, titer: 0, peakVCD: 0, viability: 0, status: "진행중", equip: $("#nb-equip").value });
      batchId = id;
      toast(id + " 배치를 생성했습니다. 캘린더에 접종 일정이 등록되었습니다.");
      paint();
    });

    const cf = $("#c-form");
    if (cf) cf.addEventListener("submit", e => {
      e.preventDefault();
      const err = $("#c-err");
      const vals = {};
      ["ph", "do2", "temp", "glc", "vcd", "titer"].forEach(k => {
        const v = $("#c-" + k).value;
        if (v !== "") vals[k] = +v;
      });
      if (!Object.keys(vals).length) {
        err.textContent = "최소 한 개 항목을 입력하세요"; err.classList.add("is-shown"); return;
      }
      err.classList.remove("is-shown");
      const rows = S.cultureRows(batchId);
      const day = rows.length ? Math.max.apply(null, rows.map(r => r.day)) + 1 : 0;
      vals.day = day;
      vals.date = S.addDays((S.batches().find(b => b.id === batchId) || {}).inoc || S.today(), day);
      S.saveCultureRow(batchId, vals);
      toast(batchId + " Day " + day + " 기록을 저장했습니다.");
      paint();
    });

    const harvest = $("#c-harvest");
    if (harvest) harvest.addEventListener("click", () => {
      const b = S.batches().find(x => x.id === batchId);
      if (!b) return;
      S.completeHarvest(batchId);
      S.savePurifRun({ id: batchId.replace(/^B/, "P") + "-A", batch: batchId, study: study,
        resin: "MabSelect PrismA", cv: 20, flow: 300, recovery: 0, hcp: 0, hcd: 0,
        date: S.today(), equip: "AKTA-201", status: "대기" });
      toast(batchId + " 수확 완료 — 정제팀 작업이 생성되었습니다.");
      dept = "purif"; location.hash = "purif"; paint();
    });

    /* Purification */
    const pf = $("#p-form");
    if (pf) pf.addEventListener("submit", e => {
      e.preventDefault();
      const err = $("#p-err");
      const id = $("#p-id").value.trim().toUpperCase();
      const batch = $("#p-batch").value;
      if (!id) { err.textContent = "Run ID를 입력하세요"; err.classList.add("is-shown"); $("#p-id").focus(); return; }
      if (!batch) { err.textContent = "연계할 배양 Batch가 없습니다"; err.classList.add("is-shown"); return; }
      err.classList.remove("is-shown");
      S.savePurifRun({ id, batch, study,
        resin: $("#p-resin").value, cv: +$("#p-cv").value || 0, flow: +$("#p-flow").value || 0,
        rt: +$("#p-rt").value || 0, load: +$("#p-load").value || 0,
        dbc: +$("#p-dbc").value || 0, sec: +$("#p-sec").value || 0,
        recovery: +$("#p-rec").value || 0, hcp: +$("#p-hcp").value || 0, hcd: +$("#p-hcd").value || 0,
        date: $("#p-date").value, equip: "AKTA-201", status: "완료" });
      toast(id + " 정제 기록을 저장했습니다. 대시보드가 갱신되었습니다.");
      paint();
    });

    const pReq = $("#p-request");
    if (pReq) pReq.addEventListener("click", () => {
      toast("분석 의뢰가 등록되었습니다. 바이오분석 서식으로 이동합니다.");
      dept = "analysis"; location.hash = "analysis"; paint();
    });

    /* Analysis */
    const am = $("#a-method");
    if (am) am.addEventListener("change", () => { method = am.value; paint(); });

    const af = $("#a-form");
    if (af) af.addEventListener("submit", e => {
      e.preventDefault();
      const err = $("#a-err");
      const id = $("#a-id").value.trim().toUpperCase();
      const sample = $("#a-sample").value;
      if (!id) { err.textContent = "분석 ID를 입력하세요"; err.classList.add("is-shown"); $("#a-id").focus(); return; }
      if (!sample) { err.textContent = "분석할 시료(정제 Run)가 없습니다"; err.classList.add("is-shown"); return; }

      const results = {};
      METHOD_ITEMS[method].forEach(k => {
        const v = $("#a-" + k).value;
        if (v !== "") results[k] = +v;
      });
      if (!Object.keys(results).length) {
        err.textContent = "최소 한 개 결과값을 입력하세요"; err.classList.add("is-shown"); return;
      }
      err.classList.remove("is-shown");

      S.saveAnalysis({ id, sample, study, method, date: $("#a-date").value,
        equip: $("#a-equip").value, results });

      const bad = Object.keys(results).filter(k => { const j = L.judge(k, results[k]); return j && !j.pass; });
      toast(bad.length
        ? id + " 저장 완료 — 규격 이탈 " + bad.length + "건이 감지되어 알림에 표시됩니다."
        : id + " 저장 완료 — 전 항목 규격 적합입니다.", bad.length ? "err" : "ok");
      paint();
    });
  }

  window.Shell.on("project", () => { study = null; batchId = null; paint(); });
  paint();
})();
