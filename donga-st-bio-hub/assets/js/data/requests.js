/* ==========================================================================
   requests.js — 분석 의뢰 (Test Request)

   배양·정제팀은 시료를 넘기고 분석팀은 받아서 시험합니다. 지금 이 인계는
   구두·메신저·메일로 이뤄지고 시스템에는 흔적이 없습니다. 그래서
     · 분석팀은 "오늘 뭐가 들어왔지"를 볼 곳이 없고
     · 의뢰한 쪽은 "언제 나오지"를 물어봐야 하며
     · 몇 달 뒤에는 "이 값 누가 언제 왜 시험했나"가 남지 않습니다

   세 팀이 실제로 만나는 지점이라, 여기가 비어 있으면 분석팀에게 이 시스템은
   남의 대시보드입니다.

   ── 상태 흐름 ───────────────────────────────────────────────────────────
     의뢰(requested) → 접수(accepted) → 시험중(inProgress)
                    → 결과 등록(reported) → 확인(closed)

     되돌리기: 접수 이후 아무 단계에서나 반려(rejected) 가능 — 사유 필수.
     되돌아가면 의뢰 상태로 돌아가고, 그 사실이 이력에 남습니다.

   상태를 바꾼 사람과 시각은 항상 이력으로 쌓입니다 (덮어쓰지 않습니다).
   ========================================================================== */

window.Requests = (function () {
  "use strict";

  const KEY = "hub.requests.v1";

  const FLOW = ["requested", "accepted", "inProgress", "reported", "closed"];

  const STATUS = {
    requested:  { ko: "의뢰",      next: "accepted",  actor: "analytics", tone: "warn",
                  hint: "분석팀 접수 대기" },
    accepted:   { ko: "접수",      next: "inProgress", actor: "analytics", tone: "info",
                  hint: "분석팀이 받았습니다" },
    inProgress: { ko: "시험 중",   next: "reported",  actor: "analytics", tone: "info",
                  hint: "시험 진행 중" },
    reported:   { ko: "결과 등록", next: "closed",    actor: "requester", tone: "accent",
                  hint: "의뢰자 확인 대기" },
    closed:     { ko: "확인 완료", next: null,        actor: null,        tone: "ok",
                  hint: "종료" },
    rejected:   { ko: "반려",      next: null,        actor: "requester", tone: "risk",
                  hint: "사유 확인 후 재의뢰" }
  };

  const PRIORITY = { normal: "일반", urgent: "긴급" };

  const subs = [];
  let state;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function emit() { save(); subs.slice().forEach(fn => { try { fn(state); } catch (e) {} }); }
  function subscribe(fn) {
    subs.push(fn);
    return () => { const i = subs.indexOf(fn); if (i > -1) subs.splice(i, 1); };
  }

  const now = () => window.Entries ? window.Entries.stamp() : new Date().toISOString().slice(0, 19);
  const who = () => window.Entries ? window.Entries.who() : "—";
  const today = () => window.HubCalendar ? window.HubCalendar.today() : now().slice(0, 10);
  const addDays = (d, n) => window.HubCalendar ? window.HubCalendar.addDays(d, n) : d;

  let seq = 0;
  function newId() {
    seq++;
    const y = today().slice(0, 4);
    const n = state.list.filter(r => r.id.indexOf("TR-" + y) === 0).length + seq;
    return "TR-" + y + "-" + String(n).padStart(3, "0");
  }

  /* ── 시연용 초기 의뢰 ──────────────────────────────────────────────────
     화면을 처음 열었을 때 큐가 비어 있으면 무엇을 하는 화면인지 알 수
     없어서, 상태가 서로 다른 의뢰 몇 건을 만들어 둡니다.
     실제 시료(DATA_SAMPLES)를 가리키므로 클릭하면 그 시료로 이어집니다. */
  function seed() {
    const S = window.DATA_SAMPLES || [];
    const pick = (batchId, idx) => {
      const list = S.filter(s => s.batchId === batchId);
      return list[idx || 0] || null;
    };
    const t = today();
    const mk = (o) => {
      const base = {
        id: o.id, sampleIds: o.sampleIds, batchId: o.batchId, studyId: o.studyId,
        tests: o.tests, purpose: o.purpose, note: o.note || null,
        priority: o.priority || "normal",
        requestedBy: o.requestedBy, requestedTeam: o.requestedTeam,
        requestedAt: o.requestedAt, dueAt: o.dueAt,
        assignedTo: o.assignedTo || null,
        status: o.status,
        history: o.history
      };
      return base;
    };

    const out = [];
    const s1 = pick("B123-3", 1);      // 분석 전 시료 — 의뢰 대기 상태로 딱 맞습니다
    if (s1) out.push(mk({
      id: "TR-" + t.slice(0, 4) + "-001", sampleIds: [s1.id], batchId: s1.batchId, studyId: s1.studyId,
      tests: ["seHPLC", "ieHPLC"], purpose: "CEX 용출 조건 비교 — 중간 단계 순도 확인",
      priority: "urgent",
      requestedBy: "이정호", requestedTeam: "downstream",
      requestedAt: addDays(t, -1) + "T09:20:00", dueAt: addDays(t, 3),
      status: "requested",
      history: [{ status: "requested", by: "이정호", at: addDays(t, -1) + "T09:20:00", note: null }]
    }));

    const s2 = pick("B045-2", 1);
    if (s2) out.push(mk({
      id: "TR-" + t.slice(0, 4) + "-002", sampleIds: [s2.id], batchId: s2.batchId, studyId: s2.studyId,
      tests: ["nGlycan"], purpose: "배지 조건별 당쇄 프로파일 비교",
      requestedBy: "김민수", requestedTeam: "upstream",
      requestedAt: addDays(t, -3) + "T14:05:00", dueAt: addDays(t, 2),
      assignedTo: "정하은",
      status: "inProgress",
      history: [
        { status: "requested", by: "김민수", at: addDays(t, -3) + "T14:05:00", note: null },
        { status: "accepted",  by: "정하은", at: addDays(t, -2) + "T10:10:00", note: "시료 수령 확인" },
        { status: "inProgress", by: "정하은", at: addDays(t, -1) + "T13:00:00", note: "전처리 완료" }
      ]
    }));

    const s3 = pick("B321-5", 1);
    if (s3) out.push(mk({
      id: "TR-" + t.slice(0, 4) + "-003", sampleIds: [s3.id], batchId: s3.batchId, studyId: s3.studyId,
      tests: ["ceSdsNR", "ceSdsR"], purpose: "재시험 — 이전 결과 시스템 적합성 미달",
      requestedBy: "이정호", requestedTeam: "downstream",
      requestedAt: addDays(t, -6) + "T11:40:00", dueAt: addDays(t, -1),
      assignedTo: "정하은",
      status: "reported",
      history: [
        { status: "requested", by: "이정호", at: addDays(t, -6) + "T11:40:00", note: null },
        { status: "accepted",  by: "정하은", at: addDays(t, -5) + "T09:00:00", note: null },
        { status: "inProgress", by: "정하은", at: addDays(t, -4) + "T09:30:00", note: null },
        { status: "reported",  by: "정하은", at: addDays(t, -2) + "T16:20:00",
          note: "CE-SDS NR/R 결과 등록 완료. 시스템 적합성 통과." }
      ]
    }));

    return out;
  }

  const stored = load();
  state = stored && stored.list ? stored : { list: seed() };
  if (!stored) save();

  /* ── 조회 ───────────────────────────────────────────────────────────── */
  function all() { return state.list.slice(); }

  function get(id) { return state.list.find(r => r.id === id) || null; }

  /* 선택 범위로 거르기 — 다른 과제 의뢰가 섞이면 큐의 의미가 없습니다 */
  function forSelection(sel) {
    const s = sel || {};
    const studies = window.Repo ? window.Repo.studiesInScope(s).map(x => x.id) : null;
    return state.list.filter(function (r) {
      if (studies && studies.length && studies.indexOf(r.studyId) === -1) return false;
      return true;
    }).sort(function (a, b) {
      /* 열린 것 먼저, 그 안에서는 기한이 급한 것 먼저 */
      const oa = isOpen(a) ? 0 : 1, ob = isOpen(b) ? 0 : 1;
      if (oa !== ob) return oa - ob;
      return String(a.dueAt || "9999").localeCompare(String(b.dueAt || "9999"));
    });
  }

  function isOpen(r) { return r.status !== "closed" && r.status !== "rejected"; }

  /* 기한 상태 — 큐에서 무엇부터 손댈지 정하는 기준입니다 */
  function due(r) {
    if (!r.dueAt || !isOpen(r)) return null;
    const t = today();
    const days = Math.round((new Date(r.dueAt + "T00:00:00") - new Date(t + "T00:00:00")) / 86400000);
    return { dueAt: r.dueAt, days: days,
             state: days < 0 ? "over" : days === 0 ? "today" : days <= 2 ? "soon" : "ok" };
  }

  /* 특정 시료에 걸린 의뢰 */
  function forSample(sampleId) {
    return state.list.filter(r => (r.sampleIds || []).indexOf(sampleId) > -1);
  }

  /* ── 변경 ───────────────────────────────────────────────────────────── */
  function create(input) {
    const ids = (input.sampleIds || []).filter(Boolean);
    if (!ids.length) return { ok: false, reason: "시료를 하나 이상 선택하세요" };
    if (!(input.tests || []).length) return { ok: false, reason: "시험 항목을 하나 이상 선택하세요" };
    if (!String(input.purpose || "").trim()) return { ok: false, reason: "의뢰 목적을 입력하세요" };

    const first = (window.DATA_SAMPLES || []).find(s => s.id === ids[0]);
    const rec = {
      id: newId(),
      sampleIds: ids,
      batchId: first ? first.batchId : (input.batchId || null),
      studyId: first ? first.studyId : (input.studyId || null),
      tests: input.tests.slice(),
      purpose: String(input.purpose).trim(),
      note: input.note ? String(input.note).trim() : null,
      priority: input.priority === "urgent" ? "urgent" : "normal",
      requestedBy: who(),
      requestedTeam: input.requestedTeam || null,
      requestedAt: now(),
      dueAt: input.dueAt || addDays(today(), 5),
      assignedTo: null,
      status: "requested",
      history: [{ status: "requested", by: who(), at: now(), note: null }]
    };
    state.list.push(rec);
    emit();
    return { ok: true, request: rec };
  }

  /* 상태 전환. 반려는 사유가 없으면 거부합니다 —
     "왜 반려됐는지" 없이 돌아온 의뢰는 의뢰자가 손쓸 방법이 없습니다. */
  function advance(id, to, note) {
    const r = get(id);
    if (!r) return { ok: false, reason: "의뢰를 찾을 수 없습니다" };
    const why = String(note || "").trim();

    if (to === "rejected" && why.length < 2) {
      return { ok: false, needNote: true, reason: "반려 사유를 입력하세요" };
    }
    if (to !== "rejected") {
      const expect = STATUS[r.status] ? STATUS[r.status].next : null;
      if (to !== expect) return { ok: false, reason: "이 단계에서는 넘어갈 수 없습니다" };
    }

    r.status = to;
    if (to === "accepted" && !r.assignedTo) r.assignedTo = who();
    r.history.push({ status: to, by: who(), at: now(), note: why || null });
    emit();
    return { ok: true, request: r };
  }

  function reset() { state = { list: seed() }; emit(); }

  return {
    FLOW, STATUS, PRIORITY,
    all, get, forSelection, forSample, isOpen, due,
    create, advance, subscribe, reset,
    state: () => state
  };
})();
