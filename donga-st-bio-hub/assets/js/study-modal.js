/* ==========================================================================
   Study modal — one study, three departments, one screen

   Opens over the dashboard (no navigation) and lays the three teams' output
   side by side for a selected experimental arm:

     🧪 Upstream    VCD · Viability · Titer · DO/pH shift log
     🔬 Downstream  Step yield · DBC · SEC purity · HCP/HCD clearance
     📊 Analytics   CEX charge variants · Intact mass · K_D

   Every metric is taggable: hover a row, click the tag button, write a note.
   The note is bound to the study + arm + metric and persists through Store, so
   it survives the meeting and shows up in the study record — which is what
   replaces rebuilding a PPT each week.
   ========================================================================== */

window.StudyModal = (function () {
  "use strict";

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  let L, S, C;
  let studyId = null, armIdx = 0, tagging = null, lastFocus = null;
  let unsub = null;

  /* ── Open / close ───────────────────────────────────────────────────── */
  function open(id) {
    L = window.LAB; S = window.Store; C = window.Charts;
    studyId = id; armIdx = 0; tagging = null;
    lastFocus = document.activeElement;
    document.body.classList.add("modal-open");
    $("#study-scrim").classList.add("is-on");
    render();
    // live: any store change re-renders the open modal
    unsub = S.subscribe(() => { if (studyId) render(); });
    document.addEventListener("keydown", onKey, true);
    setTimeout(() => { const b = $("#sm-close"); if (b) b.focus(); }, 40);
  }

  function close() {
    studyId = null; tagging = null;
    document.body.classList.remove("modal-open");
    $("#study-scrim").classList.remove("is-on");
    document.removeEventListener("keydown", onKey, true);
    if (unsub) { unsub(); unsub = null; }
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function onKey(e) {
    if (!studyId) return;
    if (e.key === "Escape") {
      if (tagging) { tagging = null; render(); e.preventDefault(); return; }
      const t = e.target.tagName;
      if (t === "INPUT" || t === "TEXTAREA") { e.target.blur(); e.preventDefault(); return; }
      close(); e.preventDefault();
    }
  }

  /* ── Render ─────────────────────────────────────────────────────────── */
  function render() {
    const ds = S.studyDataset(studyId);
    if (!ds) return;
    const st = ds.study;
    if (armIdx >= ds.arms.length) armIdx = 0;
    const cur = ds.arms[armIdx];

    $("#sm-head").innerHTML =
      '<div style="min-width:0;flex:1">' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">' +
          '<span class="study-no">STUDY #' + st.no + ' · ' + esc(st.id) + '</span>' +
          '<span class="badge badge-' + (st.status === "진행중" ? "info" : st.status === "완료" ? "ok" : "warn") +
            '"><span class="badge-dot"></span>' + esc(st.status) + '</span>' +
          (ds.oos.length ? '<span class="spec spec-oos">OOS ' + ds.oos.length + '</span>'
                         : '<span class="spec spec-pass">전 항목 적합</span>') +
        '</div>' +
        '<h2 style="font-size:19px;letter-spacing:-.015em">' + esc(st.ko) + '</h2>' +
        '<p style="font-size:12px;color:var(--c-text-mute);margin:3px 0 0">' + esc(st.en) +
          ' · 주관 ' + esc(st.lead) + ' · ' + esc(st.start) + ' ~ ' + esc(st.end) + '</p>' +
      '</div>' +
      '<button class="btn-icon" id="sm-close" aria-label="닫기 (Esc)">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>';

    $("#sm-body").innerHTML =
      objectiveBlock(st, ds) +
      armTabs(ds) +
      '<div class="dept-grid">' +
        colUpstream(cur, st) + colDownstream(cur, st) + colAnalytics(cur, st) +
      '</div>' +
      (ds.oos.length ? oosBlock(ds) : "") +
      notesBlock();

    $("#sm-foot").innerHTML =
      '<span style="font-size:11.5px;color:var(--c-text-mute)">' +
        '지표에 마우스를 올리고 태그 버튼을 누르면 해당 수치에 피드백이 연결됩니다.</span>' +
      '<a class="btn btn-ghost btn-sm" href="ebr.html" style="margin-left:auto">EBR에서 데이터 입력</a>' +
      '<button class="btn btn-primary btn-sm" id="sm-done">닫기</button>';

    wire(ds);
  }

  function objectiveBlock(st, ds) {
    const chip = (dept) => {
      const d = L.DEPTS[dept];
      const involved = st.teams.indexOf(dept) > -1;
      if (!involved) return '<span class="team-chip" data-state="none">' + esc(d.short) + ' 미참여</span>';
      const e = ds.expect[dept] || 0, h = ds.have[dept] || 0;
      const state = h === 0 ? "none" : h >= e ? "full" : "part";
      return '<span class="team-chip" data-state="' + state + '">' +
        '<span class="team-chip-dot"></span>' + esc(d.short) + ' ' + h + '/' + e +
        (state === "full" ? " 완료" : state === "part" ? " 일부" : " 미제출") + '</span>';
    };

    return '<div class="card" style="margin-bottom:var(--s-5)"><div class="card-body">' +
      '<div style="display:grid;grid-template-columns:1fr auto;gap:var(--s-5);align-items:start">' +
        '<div>' +
          '<div class="eyebrow" style="margin-bottom:6px">연구 목적</div>' +
          '<p style="font-size:13.5px;line-height:1.75;margin:0 0 var(--s-3)">' + esc(st.objective) + '</p>' +
          '<div class="eyebrow" style="margin-bottom:4px">실험 인자</div>' +
          '<p style="font-size:12.5px;color:var(--c-text-mute);margin:0">' + esc(st.factors) + '</p>' +
        '</div>' +
        '<div style="text-align:right">' +
          '<div class="eyebrow" style="margin-bottom:6px">부서별 데이터 제출</div>' +
          '<div class="team-chips" style="justify-content:flex-end">' +
            chip("culture") + chip("purif") + chip("analysis") + '</div>' +
        '</div>' +
      '</div></div></div>';
  }

  function armTabs(ds) {
    if (!ds.arms.length) return "";
    return '<div class="eyebrow" style="margin-bottom:var(--s-2)">실험 조건 (Arm)</div>' +
      '<div class="arm-tabs" role="tablist">' +
      ds.arms.map((x, i) =>
        '<button class="arm-tab" role="tab" data-arm="' + i + '" aria-selected="' + (i === armIdx) + '">' +
          esc(x.arm.label) + '</button>').join("") + '</div>';
  }

  /* ── Column: Upstream ───────────────────────────────────────────────── */
  function colUpstream(cur, st) {
    const d = L.DEPTS.culture;
    const owns = st.teams.indexOf("culture") > -1;

    /* A downstream study doesn't run the culture, but the feed batch is still
       required context — showing "미참여" while a batch is linked would hide
       the very thing that explains the load. */
    if (!owns) {
      if (!cur || !cur.batch) return emptyCol(d, "🧪", "이 스터디에는 배양 데이터가 없습니다");
      const b = cur.batch;
      return '<section class="dept-col" style="--dept:' + d.color + '">' +
        '<div class="dept-col-head"><div style="min-width:0">' +
          '<div class="dept-col-name">🧪 ' + esc(d.ko) + '</div>' +
          '<div class="dept-col-role">원료 참조 (Feed) · ' + esc(b.id) + '</div></div>' +
          '<span class="badge" style="font-size:10px">참조</span></div>' +
        '<div class="dept-col-body">' +
          '<p style="font-size:11.5px;color:var(--c-text-mute);margin:0 0 var(--s-3)">' +
            '이 스터디가 수행한 실험은 아니지만, 정제 대상 원료의 배양 조건입니다.</p>' +
          kv("원료 Batch", b.id, "", "feedbatch") +
          kv("배양 Titer", b.titer, "g/L", "feedtiter") +
          kv("배양 pH", b.pH, "", "feedph") +
          kv("스케일", b.scale, "", "feedscale") +
        '</div></section>';
    }

    if (!cur || !cur.batch) return emptyCol(d, "🧪", "배양 데이터 미제출", true);

    const b = cur.batch, rows = cur.rows;
    const last = rows[rows.length - 1] || {};
    const peak = rows.reduce((m, r) => Math.max(m, r.vcd || 0), 0);
    const series = [
      { name: "VCD", color: d.color, data: rows.map(r => r.vcd) },
      { name: "Titer (우축)", color: "#6D28D9", right: true, data: rows.map(r => r.titer) }
    ];

    return '<section class="dept-col" style="--dept:' + d.color + '">' +
      colHead(d, "🧪", "Upstream", b.id) +
      '<div class="dept-col-body">' +
        kv("생세포도 VCD (peak)", peak.toFixed(1), "×10⁶/mL", "vcd") +
        kv("생존율 Viability", (last.via != null ? last.via : b.viability), "%", "via") +
        kv("생성 타이터 Titer", (last.titer != null ? last.titer : b.titer), "g/L", "titer") +
        kv("배양 pH", b.pH, "", "ph") +
        kv("DO 설정", b.do2, "%", "do") +

        '<div class="rule-hair" style="margin:var(--s-4) 0 var(--s-3)"></div>' +
        '<div class="eyebrow" style="margin-bottom:var(--s-2)">VCD · Titer 추이</div>' +
        C.legend(series) +
        '<div style="margin-top:6px">' +
          C.line({ x: rows.map(r => "D" + r.day), series, right: true, h: 150, w: 340,
                   aria: b.id + " VCD 및 Titer 추이" }) + '</div>' +

        '<div class="rule-hair" style="margin:var(--s-4) 0 var(--s-3)"></div>' +
        '<div class="eyebrow" style="margin-bottom:var(--s-2)">DO / pH 시프트 기록</div>' +
        (cur.shifts.length
          ? cur.shifts.map(s =>
              '<div style="display:flex;gap:8px;align-items:baseline;font-size:11.5px;padding:4px 0;' +
                'border-bottom:1px solid var(--c-paper-2)">' +
                '<span class="mono" style="font-weight:700;color:' + d.color + '">D' + s.day + '</span>' +
                '<span style="flex:1"><b>' + esc(s.param) + '</b> ' + s.from + ' → ' + s.to +
                  '<span style="color:var(--c-text-mute)"> · ' + esc(s.note) + '</span></span>' +
              '</div>').join("")
          : '<p style="font-size:11.5px;color:var(--c-text-mute);margin:0">시프트 기록 없음 (고정 조건)</p>') +
      '</div></section>';
  }

  /* ── Column: Downstream ─────────────────────────────────────────────── */
  function colDownstream(cur, st) {
    const d = L.DEPTS.purif;
    if (st.teams.indexOf("purif") === -1) return emptyCol(d, "🔬", "이 스터디에는 정제 데이터가 없습니다");
    if (!cur || !cur.purif) return emptyCol(d, "🔬", "정제 데이터 미제출", true);

    const p = cur.purif;
    const jDbc = L.judge("DBC", p.dbc);
    const jSec = L.judge("SEC_monomer", p.sec);
    const clear = (v0, v1) => v0 > 0 ? (((v0 - v1) / v0) * 100).toFixed(1) : "—";

    return '<section class="dept-col" style="--dept:' + d.color + '">' +
      colHead(d, "🔬", "Downstream", p.id) +
      '<div class="dept-col-body">' +
        kv("단계 수율 Step Yield", p.recovery, "%", "yield") +
        kvJudged("동적결합용량 DBC", p.dbc, "g/L", jDbc, "dbc") +
        kvJudged("SEC-HPLC 순도", p.sec, "%", jSec, "sec") +
        kv("체류시간 / 부하량", p.rt + " min / " + p.load + " g/L", "", "rtload") +
        kv("Resin", p.resin, "", "resin") +

        '<div class="rule-hair" style="margin:var(--s-4) 0 var(--s-3)"></div>' +
        '<div class="eyebrow" style="margin-bottom:var(--s-3)">불순물 제거</div>' +
        impurity("HCP", p.hcp, "ng/mg", 100, d.color) +
        impurity("잔류 DNA (HCD)", p.hcd, "pg/mg", 10, d.color) +
        '<p style="font-size:10.5px;color:var(--c-text-mute);margin:var(--s-2) 0 0">' +
          '막대는 규격 대비 여유도입니다 — 짧을수록 규격에 여유가 있습니다.</p>' +
      '</div></section>';
  }

  function impurity(label, v, unit, limit, color) {
    const pct = Math.min(100, (v / limit) * 100);
    const over = v > limit;
    return '<div style="margin-bottom:var(--s-3)">' +
      '<div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:4px">' +
        '<span>' + esc(label) + '</span>' +
        '<span class="mono" style="font-weight:600;color:' + (over ? "var(--c-risk)" : "inherit") + '">' +
          v + ' <span style="font-weight:400;color:var(--c-text-mute)">' + esc(unit) + ' / 규격 ≤ ' + limit + '</span></span>' +
      '</div>' +
      '<div style="height:7px;background:var(--c-paper-2);border-radius:4px;overflow:hidden">' +
        '<div style="height:100%;width:' + pct.toFixed(1) + '%;background:' +
        (over ? "var(--c-risk)" : color) + ';border-radius:4px"></div></div></div>';
  }

  /* ── Column: Analytics ──────────────────────────────────────────────── */
  function colAnalytics(cur, st) {
    const d = L.DEPTS.analysis;
    if (st.teams.indexOf("analysis") === -1) return emptyCol(d, "📊", "이 스터디에는 분석 데이터가 없습니다");
    if (!cur || !cur.judged.length) return emptyCol(d, "📊", "분석 데이터 미제출", true);

    const by = {};
    cur.judged.forEach(j => { (by[j.key] = by[j.key] || []).push(j); });
    const pick = k => (by[k] || [])[0];

    const cexMain = pick("CEX_main"), cexAcid = pick("CEX_acidic"), cexBasic = pick("CEX_basic");
    const mass = pick("Mass_obs"), massD = pick("Mass_delta"), kd = pick("KD");

    let html = '<section class="dept-col" style="--dept:' + d.color + '">' +
      colHead(d, "📊", "Analytics", cur.analyses.map(a => a.id).join(", ")) +
      '<div class="dept-col-body">';

    if (cexMain || cexAcid || cexBasic) {
      html += '<div class="eyebrow" style="margin-bottom:var(--s-2)">전하 이형체 (CEX)</div>';
      [cexAcid, cexMain, cexBasic].forEach(j => {
        if (j) html += kvJudged(j.ko, j.value, j.unit, { pass: j.pass, spec: j.spec }, j.key);
      });
      const total = [cexAcid, cexMain, cexBasic].filter(Boolean);
      if (total.length === 3) {
        html += '<div style="display:flex;height:12px;border-radius:6px;overflow:hidden;margin-top:var(--s-3)">' +
          '<span style="width:' + cexAcid.value + '%;background:#B45309" title="Acidic"></span>' +
          '<span style="width:' + cexMain.value + '%;background:' + d.color + '" title="Main"></span>' +
          '<span style="width:' + cexBasic.value + '%;background:#6D28D9" title="Basic"></span></div>' +
          '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--c-text-mute);margin-top:4px">' +
          '<span>Acidic</span><span>Main</span><span>Basic</span></div>';
      }
    }

    if (mass || massD) {
      html += '<div class="rule-hair" style="margin:var(--s-4) 0 var(--s-3)"></div>' +
        '<div class="eyebrow" style="margin-bottom:var(--s-2)">온전질량 (Intact Mass)</div>';
      if (mass) html += kv("실측 질량", Number(mass.value).toLocaleString(), "Da", "massobs");
      html += kv("이론 질량", L.MASS_REF.theoretical.toLocaleString(), "Da", "massref");
      if (massD) html += kvJudged("편차", massD.value, "ppm", { pass: massD.pass, spec: massD.spec }, "massdelta");
    }

    if (kd) {
      html += '<div class="rule-hair" style="margin:var(--s-4) 0 var(--s-3)"></div>' +
        '<div class="eyebrow" style="margin-bottom:var(--s-2)">결합 친화도</div>' +
        kvJudged("K_D", kd.value, kd.unit, { pass: kd.pass, spec: kd.spec }, "kd");
    }

    // anything else measured on this arm
    const shown = ["CEX_main","CEX_acidic","CEX_basic","Mass_obs","Mass_delta","KD"];
    const rest = cur.judged.filter(j => shown.indexOf(j.key) === -1);
    if (rest.length) {
      html += '<div class="rule-hair" style="margin:var(--s-4) 0 var(--s-3)"></div>' +
        '<div class="eyebrow" style="margin-bottom:var(--s-2)">기타 분석</div>' +
        rest.map(j => kvJudged(j.ko, j.value, j.unit, { pass: j.pass, spec: j.spec }, j.key)).join("");
    }

    return html + '</div></section>';
  }

  /* ── Small builders ─────────────────────────────────────────────────── */
  function colHead(d, icon, role, ref) {
    return '<div class="dept-col-head">' +
      '<div style="min-width:0"><div class="dept-col-name">' + icon + ' ' + esc(d.ko) + '</div>' +
      '<div class="dept-col-role">' + esc(role) + (ref ? ' · ' + esc(ref) : "") + '</div></div>' +
      '</div>';
  }

  function emptyCol(d, icon, msg, pending) {
    return '<section class="dept-col" style="--dept:' + (pending ? "var(--c-border-str)" : "var(--c-border)") + '">' +
      '<div class="dept-col-head"><div><div class="dept-col-name" style="color:var(--c-text-mute)">' +
        icon + ' ' + esc(d.ko) + '</div></div></div>' +
      '<div class="dept-col-body"><div style="text-align:center;padding:var(--s-6) 0">' +
        '<p style="font-size:12.5px;color:var(--c-text-mute);margin:0 0 var(--s-3)">' + esc(msg) + '</p>' +
        (pending ? '<a class="btn btn-ghost btn-sm" href="ebr.html">EBR에서 입력</a>' : "") +
      '</div></div></section>';
  }

  function kv(k, v, u, key) {
    const note = noteFor(key);
    return '<div class="kv" data-tagged="' + (note ? 1 : 0) + '">' +
      '<span class="kv-k">' + esc(k) + '</span>' +
      '<span style="display:flex;align-items:center;gap:4px">' +
        '<span class="kv-v">' + esc(v) + (u ? '<span class="kv-u">' + esc(u) + '</span>' : "") + '</span>' +
        tagBtn(k, key) +
      '</span>' +
      (note ? '<div class="tag-note" style="flex-basis:100%">' + esc(note.text) +
        '<span style="display:block;color:var(--c-text-mute);font-size:10px;margin-top:3px">' +
        esc(note.author) + '</span></div>' : "") +
    '</div>';
  }

  function kvJudged(k, v, u, j, key) {
    const note = noteFor(key);
    const badge = j && j.pass != null
      ? '<span class="spec ' + (j.pass ? "spec-pass" : "spec-oos") + '" title="규격 ' + esc(j.spec) + '">' +
        (j.pass ? "PASS" : "OOS") + '</span>' : "";
    return '<div class="kv" data-tagged="' + (note ? 1 : 0) + '">' +
      '<span class="kv-k">' + esc(k) + '</span>' +
      '<span style="display:flex;align-items:center;gap:6px">' +
        badge +
        '<span class="kv-v"' + (j && j.pass === false ? ' style="color:var(--c-risk)"' : "") + '>' +
          esc(v) + (u ? '<span class="kv-u">' + esc(u) + '</span>' : "") + '</span>' +
        tagBtn(k, key) +
      '</span>' +
      (note ? '<div class="tag-note" style="flex-basis:100%">' + esc(note.text) +
        '<span style="display:block;color:var(--c-text-mute);font-size:10px;margin-top:3px">' +
        esc(note.author) + '</span></div>' : "") +
    '</div>';
  }

  function tagBtn(label, key) {
    return '<button class="tag-btn" data-tag="' + esc(key) + '" data-label="' + esc(label) + '" ' +
      'aria-label="' + esc(label) + '에 피드백 남기기">' +
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></button>';
  }

  function armKey() {
    const ds = S.studyDataset(studyId);
    const a = ds && ds.arms[armIdx];
    return a ? a.arm.id : "";
  }
  function noteFor(metricKey) {
    return S.notesForStudy(studyId).filter(n => n.arm === armKey() && n.metric === metricKey)[0];
  }

  function oosBlock(ds) {
    return '<div class="card" style="margin-top:var(--s-5);border-left:3px solid var(--c-risk)">' +
      '<div class="card-head"><div><h3 class="card-title">규격 이탈 — 스터디 전체</h3>' +
      '<p class="card-sub">모든 실험 조건을 통틀어 ' + ds.oos.length + '건</p></div></div>' +
      '<div class="tbl-scroll"><table class="tbl"><thead><tr>' +
        ['실험 조건', '항목', '결과', '규격', '출처'].map(h => '<th scope="col">' + h + '</th>').join("") +
      '</tr></thead><tbody>' +
      ds.oos.map(o => '<tr><td>' + esc(o.arm) + '</td><td>' + esc(o.ko) + '</td>' +
        '<td class="mono" style="font-weight:600;color:var(--c-risk)">' + o.value + ' ' + esc(o.unit) + '</td>' +
        '<td class="mono" style="color:var(--c-text-mute)">' + esc(o.spec) + '</td>' +
        '<td class="mono">' + esc(o.analysis) + '</td></tr>').join("") +
      '</tbody></table></div></div>';
  }

  function notesBlock() {
    const notes = S.notesForStudy(studyId);
    return '<div class="card" style="margin-top:var(--s-5)">' +
      '<div class="card-head"><div><h3 class="card-title">피드백 태그</h3>' +
      '<p class="card-sub">지표에 연결된 메모 ' + notes.length + '건 — 회의 모드와 회의록에 함께 표시됩니다</p></div></div>' +
      '<div class="card-body">' +
      (notes.length
        ? '<div style="display:grid;gap:var(--s-3)">' + notes.slice().reverse().map(n =>
            '<div style="display:flex;gap:var(--s-3);align-items:flex-start;padding:var(--s-3);' +
              'background:var(--c-paper);border-left:3px solid var(--c-accent-mid);border-radius:var(--r-md)">' +
              '<span style="min-width:0;flex:1"><span style="display:block;font-size:12.5px">' + esc(n.text) + '</span>' +
              '<span style="display:block;font-size:10.5px;color:var(--c-text-mute);margin-top:4px">' +
                esc(n.metricLabel || n.metric || "") + ' · ' + esc(n.armLabel || "") + ' · ' + esc(n.author) + '</span></span>' +
              '<button class="btn-icon" data-delnote="' + n.id + '" aria-label="메모 삭제" style="width:26px;height:26px">' +
                '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
                'aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
            '</div>').join("") + '</div>'
        : '<p style="font-size:12.5px;color:var(--c-text-mute);margin:0">' +
          '아직 태그된 피드백이 없습니다. 위 지표 행에 마우스를 올리면 태그 버튼이 나타납니다.</p>') +
      '</div></div>';
  }

  /* ── Tag composer ───────────────────────────────────────────────────── */
  function openTagger(key, label) {
    const ds = S.studyDataset(studyId);
    const arm = ds.arms[armIdx];
    tagging = { key, label };

    const host = document.createElement("div");
    host.id = "tagger";
    host.style.cssText = "position:fixed;inset:0;z-index:170;background:rgba(10,25,47,.4);" +
      "display:flex;align-items:center;justify-content:center;padding:var(--s-5)";
    host.innerHTML =
      '<div class="card" style="max-width:420px;width:100%">' +
        '<div class="card-head"><div><h3 class="card-title">피드백 태그</h3>' +
          '<p class="card-sub">' + esc(label) + ' · ' + esc(arm ? arm.arm.label : "") + '</p></div></div>' +
        '<div class="card-body">' +
          '<label class="sr-only" for="tag-text">피드백 내용</label>' +
          '<textarea class="input" id="tag-text" rows="3" style="min-height:84px;padding:10px;font-size:13px;' +
            'resize:vertical" placeholder="이 수치에 대한 의견이나 확인 요청을 적어주세요"></textarea>' +
          '<div style="display:flex;gap:var(--s-2);margin-top:var(--s-4)">' +
            '<button class="btn btn-accent" id="tag-save">태그 저장</button>' +
            '<button class="btn btn-ghost" id="tag-cancel">취소</button>' +
          '</div>' +
        '</div></div>';
    document.body.appendChild(host);
    const ta = host.querySelector("#tag-text");
    ta.focus();

    const save = () => {
      const v = ta.value.trim();
      if (!v) { ta.focus(); return; }
      S.addNote({ prj: ds.study.prj, study: studyId, arm: arm ? arm.arm.id : "",
        armLabel: arm ? arm.arm.label : "", metric: key, metricLabel: label,
        section: "study", text: v, author: (window.Auth.current() || {}).name || "—" });
      document.body.removeChild(host);
      tagging = null;
      render();
    };
    host.querySelector("#tag-save").addEventListener("click", save);
    host.querySelector("#tag-cancel").addEventListener("click", () => {
      document.body.removeChild(host); tagging = null;
    });
    ta.addEventListener("keydown", e => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); save(); }
      if (e.key === "Escape") { e.preventDefault(); document.body.removeChild(host); tagging = null; }
    });
  }

  /* ── Wire ───────────────────────────────────────────────────────────── */
  function wire(ds) {
    $("#sm-close").addEventListener("click", close);
    const done = $("#sm-done"); if (done) done.addEventListener("click", close);
    $$("[data-arm]").forEach(b => b.addEventListener("click", () => { armIdx = +b.dataset.arm; render(); }));
    $$("[data-tag]").forEach(b => b.addEventListener("click", () => openTagger(b.dataset.tag, b.dataset.label)));
    $$("[data-delnote]").forEach(b => b.addEventListener("click", () => { S.removeNote(b.dataset.delnote); render(); }));
  }

  /* ── Install ────────────────────────────────────────────────────────── */
  function install() {
    if (document.getElementById("study-scrim")) return;
    const d = document.createElement("div");
    d.className = "modal-scrim";
    d.id = "study-scrim";
    d.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-label="스터디 통합 보기">' +
        '<div class="modal-head" id="sm-head"></div>' +
        '<div class="modal-body" id="sm-body"></div>' +
        '<div class="modal-foot" id="sm-foot"></div>' +
      '</div>';
    document.body.appendChild(d);
    d.addEventListener("click", e => { if (e.target === d) close(); });
  }

  return { install, open, close };
})();
