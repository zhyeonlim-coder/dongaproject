/* ==========================================================================
   Shared store — the one place mutable state lives

   Why this exists: the brief requires EBR saves to update the dashboard and
   the mini-calendar. Without a shared layer each page would hold its own copy
   and they would drift. Pages read through Store and subscribe to changes.

   Persistence is localStorage, namespaced per user. INTEGRATION: replace
   read()/write() with API calls and keep the same shape — subscribers do not
   care where the data came from.
   ========================================================================== */

window.Store = (function () {
  "use strict";

  const VERSION = 3;
  let KEY = "hub.store.v" + VERSION;

  const EMPTY = {
    cultureRows: {},   // batchId -> [{day, ph, do2, temp, glc, vcd, titer}]
    purifRuns: [],     // user-added purification runs
    analyses: [],      // user-added analyses
    batches: [],       // user-created batches
    bookings: [],      // {id, equip, date, start, end, who, purpose, study}
    events: [],        // calendar events {date, ko, kind, status, ref}
    notes: [],         // meeting notes {id, section, prj, text, author, ts, anchor}
    actions: []        // action items {id, text, owner, due, done, from}
  };

  let state = null;
  const subs = [];

  function init(user) {
    KEY = "hub.store.v" + VERSION + "." + (user && user.email ? user.email : "anon");
    state = read();
    if (!state.events.length) seedEvents();
    return state;
  }

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return JSON.parse(JSON.stringify(EMPTY));
      const parsed = JSON.parse(raw);
      return Object.assign(JSON.parse(JSON.stringify(EMPTY)), parsed);
    } catch (e) {
      return JSON.parse(JSON.stringify(EMPTY));
    }
  }

  function write() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { /* private mode / quota — state still works for this session */ }
  }

  function emit(what) {
    write();
    subs.forEach(fn => { try { fn(what, state); } catch (e) { /* keep other subscribers alive */ } });
  }

  function subscribe(fn) { subs.push(fn); return () => { const i = subs.indexOf(fn); if (i > -1) subs.splice(i, 1); }; }

  const uid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* ── Seed calendar from reference data ───────────────────────────────── */
  function seedEvents() {
    const L = window.LAB;
    state.events = [];
    /* refs are composite (`B2401#inoc`) so a daily record can never collide
       with — and overwrite — the inoculation or harvest entry. */
    L.BATCHES.forEach(b => {
      state.events.push({ id: uid("ev"), date: b.inoc, ko: b.id + " 접종", kind: "culture",
        status: "완료", ref: b.id + "#inoc" });
      state.events.push({ id: uid("ev"), date: addDays(b.inoc, b.days), ko: b.id + " 수확 예정",
        kind: "culture", status: b.status === "완료" ? "완료" : "진행중", ref: b.id + "#harvest" });
    });
    L.PURIF_RUNS.forEach(p => {
      state.events.push({ id: uid("ev"), date: p.date, ko: p.id + " 정제", kind: "purif",
        status: "완료", ref: p.id });
    });
    L.ANALYSES.forEach(a => {
      state.events.push({ id: uid("ev"), date: a.date, ko: a.id + " " + a.method + " 분석",
        kind: "analysis", status: "완료", ref: a.id });
    });
    state.events.push({ id: uid("ev"), date: "2026-07-31", ko: "ST-01 중간 보고", kind: "milestone", status: "예정" });
    state.events.push({ id: uid("ev"), date: "2026-08-14", ko: "ST-01 종료 예정", kind: "milestone", status: "예정" });
    write();
  }

  /* Local calendar date, NOT toISOString(). toISOString converts to UTC, so a
     KST (UTC+9) user gets yesterday's date for the first nine hours of every
     day — wrong on an EBR entry. */
  function localISO(d) {
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function addDays(iso, n) {
    const d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + n);
    return localISO(d);
  }

  /* ── Merged views: reference data + user entries ─────────────────────── */
  function batches() { return window.LAB.BATCHES.concat(state.batches); }

  function cultureRows(batchId) {
    const seeded = window.LAB.CULTURE[batchId] || [];
    const added = state.cultureRows[batchId] || [];
    const byDay = {};
    seeded.forEach(r => { byDay[r.day] = r; });
    added.forEach(r => { byDay[r.day] = Object.assign({}, byDay[r.day] || {}, r); });
    return Object.keys(byDay).map(Number).sort((a, b) => a - b).map(d => byDay[d]);
  }

  function purifRuns() { return window.LAB.PURIF_RUNS.concat(state.purifRuns); }
  function analyses()  { return window.LAB.ANALYSES.concat(state.analyses); }

  function eventsOn(dateIso) { return state.events.filter(e => e.date === dateIso); }
  function eventsBetween(a, b) { return state.events.filter(e => e.date >= a && e.date <= b); }

  /* ── Mutations ───────────────────────────────────────────────────────── */

  function saveCultureRow(batchId, row) {
    const list = state.cultureRows[batchId] || (state.cultureRows[batchId] = []);
    const i = list.findIndex(r => r.day === row.day);
    if (i > -1) list[i] = Object.assign({}, list[i], row); else list.push(row);
    touchEvent(batchId + "#d" + row.day, "culture", batchId + " Day " + row.day + " 기록", row.date);
    emit("culture");
  }

  function addBatch(b) {
    state.batches.push(b);
    state.events.push({ id: uid("ev"), date: b.inoc, ko: b.id + " 접종", kind: "culture",
      status: "완료", ref: b.id + "#inoc" });
    emit("batch");
  }

  /* Harvest flips the seeded 수확 예정 entry to 완료 — the 진행 중 → 완료
     transition the brief asks for. */
  function completeHarvest(batchId) {
    const ev = state.events.find(e => e.ref === batchId + "#harvest");
    if (ev) { ev.status = "완료"; ev.ko = batchId + " 수확 완료"; }
    else state.events.push({ id: uid("ev"), date: today(), ko: batchId + " 수확 완료",
      kind: "culture", status: "완료", ref: batchId + "#harvest" });
    const b = state.batches.find(x => x.id === batchId);
    if (b) b.status = "완료";
    emit("harvest");
  }

  function savePurifRun(run) {
    const i = state.purifRuns.findIndex(r => r.id === run.id);
    if (i > -1) state.purifRuns[i] = run; else state.purifRuns.push(run);
    touchEvent(run.id, "purif", run.id + " 정제", run.date);
    emit("purif");
  }

  function saveAnalysis(a) {
    const i = state.analyses.findIndex(x => x.id === a.id);
    if (i > -1) state.analyses[i] = a; else state.analyses.push(a);
    touchEvent(a.id, "analysis", a.id + " " + a.method + " 분석", a.date);
    emit("analysis");
  }

  /* An EBR save flips the matching calendar entry to 완료, or creates one.
     This is the "저장 시 일정 자동 업데이트" behaviour in the brief. */
  function touchEvent(ref, kind, label, date) {
    const ev = state.events.find(e => e.ref === ref && e.kind === kind);
    if (ev) { ev.status = "완료"; if (date) ev.date = date; return; }
    state.events.push({ id: uid("ev"), date: date || today(), ko: label, kind, status: "완료", ref });
  }

  /* ── Bookings ────────────────────────────────────────────────────────── */

  function bookings(equipId, date) {
    return state.bookings.filter(b =>
      (!equipId || b.equip === equipId) && (!date || b.date === date));
  }

  // Overlap test: [aStart, aEnd) vs [bStart, bEnd) on the same equipment+date.
  function conflict(equip, date, start, end, ignoreId) {
    return state.bookings.find(b =>
      b.equip === equip && b.date === date && b.id !== ignoreId &&
      start < b.end && end > b.start) || null;
  }

  function book(b) {
    const c = conflict(b.equip, b.date, b.start, b.end);
    if (c) return { ok: false, conflict: c };
    const rec = Object.assign({ id: uid("bk") }, b);
    state.bookings.push(rec);
    state.events.push({ id: uid("ev"), date: b.date, ko: b.equip + " 예약 (" + b.start + "–" + b.end + ")",
      kind: "booking", status: "예정", ref: rec.id });
    emit("booking");
    return { ok: true, booking: rec };
  }

  function cancelBooking(id) {
    state.bookings = state.bookings.filter(b => b.id !== id);
    state.events = state.events.filter(e => e.ref !== id);
    emit("booking");
  }

  /* ── Meeting notes & actions ─────────────────────────────────────────── */

  function addNote(n) {
    const rec = Object.assign({ id: uid("nt"), ts: Date.now() }, n);
    state.notes.push(rec);
    emit("note");
    return rec;
  }
  function removeNote(id) { state.notes = state.notes.filter(n => n.id !== id); emit("note"); }
  function notesFor(prj, section) {
    return state.notes.filter(n => n.prj === prj && (!section || n.section === section));
  }

  function addAction(a) {
    const rec = Object.assign({ id: uid("ac"), done: false, ts: Date.now() }, a);
    state.actions.push(rec);
    emit("action");
    return rec;
  }
  function toggleAction(id) {
    const a = state.actions.find(x => x.id === id);
    if (a) { a.done = !a.done; emit("action"); }
  }
  function removeAction(id) { state.actions = state.actions.filter(a => a.id !== id); emit("action"); }
  function actionsFor(prj) { return state.actions.filter(a => a.prj === prj); }

  /* ── Study dataset — the cross-department integration ──────────────────
     Walks study → arms → batch / purification run / analyses and returns one
     object holding every department's contribution for that study, plus a
     completeness read so a missing column shows as "미제출" rather than blank.

     This is the whole point of the study-centric model: nobody has to ask
     another team for their numbers. */
  function studyDataset(studyId) {
    const L = window.LAB;
    const study = L.STUDIES.find(s => s.id === studyId);
    if (!study) return null;

    const allBatches = batches(), allPurif = purifRuns(), allAnalyses = analyses();
    const arms = L.ARMS.filter(a => a.study === studyId).map(a => {
      const batch = a.batch ? allBatches.find(b => b.id === a.batch) : null;
      const purif = a.purif ? allPurif.find(p => p.id === a.purif) : null;
      const rows = batch ? cultureRows(batch.id) : [];
      const shifts = batch ? (L.SHIFTS || []).filter(s => s.batch === batch.id) : [];
      /* When an arm lists its analyses explicitly, that list is authoritative.
         Falling back to "everything measured on this sample" would smear all
         fractions of a shared sample across every arm. Only arms with no
         explicit list fall back to sample matching. */
      const anas = (a.analyses && a.analyses.length)
        ? a.analyses.map(id => allAnalyses.find(x => x.id === id)).filter(Boolean)
        : allAnalyses.filter(x => x.study === studyId && a.purif && x.sample === a.purif);

      const judged = [];
      anas.forEach(an => Object.keys(an.results || {}).forEach(k => {
        const j = L.judge(k, an.results[k]);
        judged.push({ analysis: an.id, method: an.method, fraction: an.fraction,
          key: k, ko: (L.SPECS[k] || {}).ko || k, value: an.results[k],
          unit: j ? j.unit : (L.SPECS[k] || {}).unit || "", spec: j ? j.spec : "—",
          pass: j ? j.pass : null, date: an.date });
      }));

      return { arm: a, batch, rows, shifts, purif, analyses: anas, judged };
    });

    // Completeness per department, counted only over arms that should have it
    const expect = { culture: 0, purif: 0, analysis: 0 };
    const have = { culture: 0, purif: 0, analysis: 0 };
    arms.forEach(x => {
      if (x.arm.batch !== null) { expect.culture++; if (x.batch && x.rows.length) have.culture++; }
      if (study.teams.indexOf("purif") > -1) { expect.purif++; if (x.purif) have.purif++; }
      if (study.teams.indexOf("analysis") > -1) { expect.analysis++; if (x.judged.length) have.analysis++; }
    });

    const oos = [];
    arms.forEach(x => x.judged.forEach(j => { if (j.pass === false) oos.push(Object.assign({ arm: x.arm.label }, j)); }));

    /* Purification specs count as this study's findings only when the study
       actually owns downstream work. An analytics-only study that merely uses
       an earlier run as source material must not be charged with that run's
       DBC failure — that finding belongs to the study that ran the column. */
    arms.forEach(x => {
      if (!x.purif || study.teams.indexOf("purif") === -1) return;
      [["DBC", x.purif.dbc], ["SEC_monomer", x.purif.sec]].forEach(([k, v]) => {
        const j = L.judge(k, v);
        if (j && !j.pass) oos.push({ arm: x.arm.label, analysis: x.purif.id, key: k,
          ko: (L.SPECS[k] || {}).ko || k, value: v, unit: j.unit, spec: j.spec, pass: false,
          date: x.purif.date, method: "정제" });
      });
    });

    return { study, arms, expect, have, oos };
  }

  function notesForStudy(studyId) { return state.notes.filter(n => n.study === studyId); }
  function actionsForStudy(studyId) { return state.actions.filter(a => a.study === studyId); }

  /* ── Derived: OOS detection across all analyses ──────────────────────── */
  function oosItems(prj) {
    const L = window.LAB;
    const studies = L.STUDIES.filter(s => s.prj === prj).map(s => s.id);
    const out = [];
    analyses().forEach(a => {
      if (prj && studies.indexOf(a.study) === -1) return;
      Object.keys(a.results || {}).forEach(k => {
        const j = L.judge(k, a.results[k]);
        if (j && !j.pass) {
          out.push({ analysis: a.id, sample: a.sample, method: a.method, key: k,
            ko: L.SPECS[k].ko, value: a.results[k], spec: j.spec, unit: j.unit, date: a.date });
        }
      });
    });
    return out;
  }

  function today() { return localISO(new Date()); }

  function reset() {
    state = JSON.parse(JSON.stringify(EMPTY));
    seedEvents();
    emit("reset");
  }

  return {
    init, subscribe, state: () => state,
    batches, cultureRows, purifRuns, analyses,
    eventsOn, eventsBetween,
    saveCultureRow, addBatch, completeHarvest, savePurifRun, saveAnalysis,
    bookings, conflict, book, cancelBooking,
    addNote, removeNote, notesFor, notesForStudy,
    addAction, toggleAction, removeAction, actionsFor, actionsForStudy,
    studyDataset,
    oosItems, addDays, today, localISO, reset, uid
  };
})();
