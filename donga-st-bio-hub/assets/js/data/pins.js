/* ==========================================================================
   pins.js — 의사결정 핀 · 회의 노트 · 회의 세션  ·  window.Pins

   회의에서 "이 값" 을 짚어 남긴 기록입니다.

     핀(pin)    데이터 한 칸에 묶입니다 — 배치 + 측정 항목(+ Day).
                회의가 끝나도 남고, EBR · 데이터 조회에서도 같은 칸에 보입니다.
     노트(note) 회의에서 결정된 사항. 유형이 두 가지입니다.
                  · decision — "다음 DoE 시 2번 배지 조건 채택" 같은 결정
                  · action   — 담당자 · 마감일이 붙는 조치. To-Do 로 등록됩니다.
     회의(meeting) 핀 · 노트를 묶는 단위. 회의록을 만드는 그릇입니다.

   ── 항목 식별을 groupId + itemKey 로 저장하는 이유 ────────────────────────
   화면마다 키 표기가 다릅니다. 회의 모드는 "seHPLC.main", EBR · 데이터 조회는
   Repo.fieldKey() 가 만드는 "seHPLC_main" 을 씁니다. 둘 중 하나로 저장하면
   다른 화면에서 핀을 찾지 못합니다. 그래서 원재료(groupId, itemKey)를 두고
   각 화면이 필요한 모양으로 바꿔 쓰게 합니다.

   회의 세션은 첫 핀 · 노트가 생길 때 게으르게 시작합니다 — 회의 모드를 열기만
   하고 닫으면 빈 회의 기록이 쌓입니다.
   ========================================================================== */

window.Pins = (function () {
  "use strict";

  const KEY = "hub.pins.v1";

  /* 핀 유형 — 색만으로 구분하지 않도록 기호를 함께 둡니다 */
  const KIND = {
    decision: { ko: "결정",   mark: "◆", tone: "accent" },
    issue:    { ko: "확인 필요", mark: "▲", tone: "warn" },
    question: { ko: "질문",   mark: "?", tone: "mute" }
  };

  let state = { pins: [], notes: [], meetings: [] };
  const subs = [];

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null");
      if (raw && raw.pins && raw.notes && raw.meetings) return raw;
    } catch (e) { /* 저장본이 깨졌으면 빈 상태로 시작합니다 */ }
    return null;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }
  function emit() { save(); subs.slice().forEach(f => { try { f(); } catch (e) {} }); }
  function subscribe(fn) {
    subs.push(fn);
    return () => { const i = subs.indexOf(fn); if (i > -1) subs.splice(i, 1); };
  }

  const now = () => window.Entries ? window.Entries.stamp() : new Date().toISOString().slice(0, 19);
  const who = () => window.Entries ? window.Entries.who() : "—";
  const today = () => window.HubCalendar ? window.HubCalendar.today() : now().slice(0, 10);

  let seq = 0;
  const uid = (p) => p + "-" + Date.now().toString(36) + "-" + (++seq);

  const stored = load();
  if (stored) state = stored;

  /* ══════════════════════════════════════════════════════════════════════
     회의 세션
     ══════════════════════════════════════════════════════════════════════ */
  let openId = null;          // 지금 열려 있는 회의 (메모리에만 둡니다)

  function currentMeeting() {
    return openId ? state.meetings.find(m => m.id === openId) || null : null;
  }

  /* 첫 기록이 생길 때 호출됩니다 — 빈 회의를 만들지 않기 위해 */
  function ensureMeeting(ctx) {
    const cur = currentMeeting();
    if (cur) return cur;
    const c = ctx || {};
    const rec = {
      id: uid("MT"),
      startedAt: now(),
      endedAt: null,
      projectId: c.projectId || null,
      projectCode: c.projectCode || null,
      studyId: c.studyId || null,
      studyName: c.studyName || null,
      by: who(),
      title: c.title || ((c.projectCode ? c.projectCode + " " : "") + "데이터 리뷰 회의")
    };
    state.meetings.push(rec);
    openId = rec.id;
    return rec;
  }

  function endMeeting() {
    const cur = currentMeeting();
    if (cur && !cur.endedAt) { cur.endedAt = now(); emit(); }
    openId = null;
    return cur;
  }

  /* 회의 모드를 다시 열었을 때 방금 전 회의를 이어서 씁니다 (30분 이내) */
  function resumeRecent(ctx) {
    const last = state.meetings.slice().sort((a, b) =>
      String(b.startedAt).localeCompare(String(a.startedAt)))[0];
    if (!last) return null;
    const t = Date.parse(String(last.endedAt || last.startedAt).replace(" ", "T"));
    if (isFinite(t) && Date.now() - t < 30 * 60 * 1000) {
      openId = last.id;
      last.endedAt = null;
      return last;
    }
    return null;
  }

  function meetings() {
    return state.meetings.slice().sort((a, b) =>
      String(b.startedAt).localeCompare(String(a.startedAt)));
  }

  /* ══════════════════════════════════════════════════════════════════════
     핀
     ══════════════════════════════════════════════════════════════════════ */
  function add(o) {
    const input = o || {};
    if (!input.batchId) return { ok: false, reason: "어느 배치의 값인지 알 수 없습니다" };
    if (!input.groupId || !input.itemKey) return { ok: false, reason: "어느 항목인지 알 수 없습니다" };
    const text = String(input.text || "").trim();
    if (text.length < 2) return { ok: false, reason: "핀에 남길 내용을 2자 이상 입력하세요" };

    const m = ensureMeeting(input.context);
    const rec = {
      id: uid("PIN"),
      meetingId: m.id,
      batchId: input.batchId,
      batchLabel: input.batchLabel || input.batchId,
      sampleId: input.sampleId || null,
      groupId: input.groupId,
      itemKey: input.itemKey,
      metricLabel: input.metricLabel || input.itemKey,
      unit: input.unit || "",
      value: (typeof input.value === "number" && isFinite(input.value)) ? input.value : null,
      day: input.day || null,
      team: input.team || null,
      projectId: input.projectId || null,
      studyId: input.studyId || null,
      kind: KIND[input.kind] ? input.kind : "decision",
      text: text,
      createdBy: who(),
      createdAt: now(),
      resolved: false
    };
    state.pins.push(rec);
    emit();
    return { ok: true, pin: rec, meeting: m };
  }

  function all() { return state.pins.slice(); }
  function get(id) { return state.pins.find(p => p.id === id) || null; }
  function forBatch(batchId) { return state.pins.filter(p => p.batchId === batchId); }

  /* 회의 모드용 — "그룹id.항목key" */
  function metricId(p) { return p.groupId + "." + p.itemKey; }
  /* EBR · 데이터 조회용 — Repo.fieldKey 와 같은 모양 */
  function fieldKeyOf(p) {
    return window.Repo ? window.Repo.fieldKey(p.groupId, p.itemKey)
                       : ((p.groupId === "upstream" || p.groupId === "titer") ? p.itemKey : p.groupId + "_" + p.itemKey);
  }

  function forCell(batchId, groupId, itemKey) {
    return state.pins.filter(p =>
      p.batchId === batchId && p.groupId === groupId && p.itemKey === itemKey);
  }
  /* 화면이 fieldKey 밖에 모를 때 (EBR · 데이터 조회) */
  function forField(batchId, fieldKey) {
    return state.pins.filter(p => p.batchId === batchId && fieldKeyOf(p) === fieldKey);
  }

  function remove(id) {
    const n = state.pins.length;
    state.pins = state.pins.filter(p => p.id !== id);
    if (state.pins.length !== n) { emit(); return true; }
    return false;
  }
  function resolve(id, on) {
    const p = get(id);
    if (!p) return false;
    p.resolved = on === undefined ? !p.resolved : !!on;
    p.resolvedAt = p.resolved ? now() : null;
    p.resolvedBy = p.resolved ? who() : null;
    emit();
    return true;
  }

  /* ══════════════════════════════════════════════════════════════════════
     노트 — 결정 / 조치
     ══════════════════════════════════════════════════════════════════════ */
  function addNote(o) {
    const input = o || {};
    const text = String(input.text || "").trim();
    if (text.length < 2) return { ok: false, reason: "내용을 2자 이상 입력하세요" };
    const kind = input.kind === "action" ? "action" : "decision";
    if (kind === "action" && !input.assignee)
      return { ok: false, reason: "조치는 담당자를 지정해야 합니다" };

    const m = ensureMeeting(input.context);
    const rec = {
      id: uid("NOTE"),
      meetingId: m.id,
      kind: kind,
      text: text,
      assignee: input.assignee || null,
      team: input.team || null,
      due: input.due || null,
      pinId: input.pinId || null,
      todoId: null,
      createdBy: who(),
      createdAt: now()
    };

    /* 조치는 그 자리에서 프로젝트 To-Do 로 넘어갑니다 —
       회의록에만 남고 아무도 안 보는 액션이 되지 않도록. */
    if (kind === "action" && window.Todos && window.Todos.add) {
      const r = window.Todos.add({
        text: text,
        team: rec.team,
        due: rec.due || today(),
        assignee: rec.assignee,
        source: "meeting",
        meetingId: m.id
      });
      if (r && r.ok) rec.todoId = r.todo.id;
      else return { ok: false, reason: (r && r.reason) || "To-Do 등록에 실패했습니다" };
    }

    state.notes.push(rec);
    emit();
    return { ok: true, note: rec, meeting: m };
  }

  function notes() { return state.notes.slice(); }
  function notesOf(meetingId) { return state.notes.filter(n => n.meetingId === meetingId); }
  function removeNote(id) {
    const n = state.notes.find(x => x.id === id);
    state.notes = state.notes.filter(x => x.id !== id);
    /* To-Do 로 넘어간 조치는 To-Do 쪽에서 지워야 실제로 사라집니다 */
    if (n && n.todoId && window.Todos && window.Todos.remove) window.Todos.remove(n.todoId);
    emit();
    return !!n;
  }

  /* 지난 회의에서 나온 조치 중 아직 안 끝난 것 —
     회의를 열면 이것부터 보여 줍니다. */
  function openActions(exceptMeetingId) {
    /* Todos 는 직접 추가한 목록을 state().list 로 내놓습니다 (userTodos 는
       내부 함수라 밖에서 부를 수 없습니다). 여기를 잘못 부르면 완료 여부를
       읽지 못해 끝난 조치가 계속 미완료로 남습니다. */
    const todos = (window.Todos && window.Todos.state && window.Todos.state().list) || [];
    const byId = {};
    todos.forEach(t => { byId[t.id] = t; });
    return state.notes
      .filter(n => n.kind === "action" && n.meetingId !== exceptMeetingId)
      .map(function (n) {
        const t = n.todoId ? byId[n.todoId] : null;
        return Object.assign({}, n, { done: t ? !!t.done : false, missing: !t });
      })
      .filter(n => !n.done)
      .sort((a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999")));
  }

  /* ══════════════════════════════════════════════════════════════════════
     회의록
     ══════════════════════════════════════════════════════════════════════ */
  function minutes(meetingId) {
    const m = state.meetings.find(x => x.id === meetingId) || currentMeeting();
    if (!m) return null;
    const ns = notesOf(m.id);
    return {
      meeting: m,
      pins: state.pins.filter(p => p.meetingId === m.id),
      decisions: ns.filter(n => n.kind === "decision"),
      actions: ns.filter(n => n.kind === "action")
    };
  }

  /* 회의록 텍스트 — 클립보드 · 파일로 그대로 내보낼 수 있는 형태 */
  function minutesText(meetingId) {
    const d = minutes(meetingId);
    if (!d) return "";
    const L = [];
    L.push("# " + d.meeting.title);
    L.push("");
    L.push("- 일시: " + String(d.meeting.startedAt).replace("T", " ") +
      (d.meeting.endedAt ? " ~ " + String(d.meeting.endedAt).slice(11) : ""));
    if (d.meeting.projectCode) L.push("- 과제: " + d.meeting.projectCode +
      (d.meeting.studyName ? " · " + d.meeting.studyName : ""));
    L.push("- 작성: " + d.meeting.by);
    L.push("");

    L.push("## 검토 중 지적된 값 (" + d.pins.length + "건)");
    if (!d.pins.length) L.push("- 없음");
    d.pins.forEach(function (p) {
      L.push("- [" + KIND[p.kind].ko + "] " + p.batchLabel + " · " + p.metricLabel +
        (p.value !== null ? " " + p.value + (p.unit ? " " + p.unit : "") : " (미입력)") +
        (p.day ? " · " + p.day : "") + " — " + p.text + " (" + p.createdBy + ")");
    });
    L.push("");

    L.push("## 결정 사항 (" + d.decisions.length + "건)");
    if (!d.decisions.length) L.push("- 없음");
    d.decisions.forEach(n => L.push("- " + n.text + " (" + n.createdBy + ")"));
    L.push("");

    L.push("## 조치 사항 (" + d.actions.length + "건)");
    if (!d.actions.length) L.push("- 없음");
    d.actions.forEach(function (n) {
      L.push("- " + n.text + " — 담당 " + (n.assignee || "미지정") +
        (n.due ? " · 기한 " + n.due : "") + (n.todoId ? " · To-Do 등록됨" : ""));
    });
    L.push("");
    L.push("— 값은 Batch_Data_example.xlsx 원본과 생성된 정제 데이터에서 조회한 것입니다.");
    return L.join("\n");
  }

  return {
    subscribe, KIND,
    add, all, get, forBatch, forCell, forField, remove, resolve,
    metricId, fieldKeyOf,
    addNote, notes, notesOf, removeNote, openActions,
    ensureMeeting, endMeeting, currentMeeting, resumeRecent, meetings,
    minutes, minutesText
  };
})();
