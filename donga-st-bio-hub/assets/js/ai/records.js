/* ==========================================================================
   records.js — 목록형 기록 조회  ·  window.AIRecords

   이슈 · 의뢰 · 일정 · 할 일 · 장비 예약을 AI 가 읽을 수 있게 합니다.
   이것들은 이번에 중앙 DB 로 옮겨 갔는데, AI 쪽에는 들어오는 길이 없었습니다.

   ── 왜 급했나 ───────────────────────────────────────────────────────────
   길이 없는 것만으로 끝나지 않았습니다. "열린 이슈 몇 건이야" 라고 물으면
   질문이 측정 데이터 엔진으로 흘러가 **배치 개수인 28건을 답했습니다.**
   모르는 것을 모른다고 하지 않고 다른 숫자를 댄 것이라, 화면만 봐서는
   틀렸다는 것을 알 수 없었습니다.

   ── 이 파일이 지키는 것 ─────────────────────────────────────────────────
   · 읽기만 합니다. 이슈를 닫거나 예약을 잡지 않습니다.
   · 저장소에 있는 것만 셉니다. 없으면 없다고 답하지, 추정하지 않습니다.
   · 저장소가 그 화면에 없으면 "이 화면에서는 못 본다" 고 말합니다
     (화면마다 싣는 스크립트가 다릅니다).
   ========================================================================== */

window.AIRecords = (function () {
  "use strict";

  /* 무엇을 묻는 말인가 — 겹치는 말은 더 좁은 쪽에 둡니다 */
  const KINDS = [
    { id: "issue",   ko: "이슈",      words: ["이슈", "issue", "트러블", "사례집", "lesson", "불량", "일탈"] },
    { id: "request", ko: "시험 의뢰", words: ["의뢰", "request", "시험 요청", "분석 요청", "접수"] },
    { id: "booking", ko: "장비 예약", words: ["예약", "booking", "장비 사용", "장비예약"] },
    { id: "todo",    ko: "할 일",     words: ["할 일", "할일", "todo", "to-do", "작업 목록"] },
    { id: "event",   ko: "일정",      words: ["일정", "스케줄", "schedule", "캘린더", "calendar"] }
  ];

  const OPEN_WORDS = ["열린", "미해결", "진행", "남은", "open", "미완료", "안 끝난"];
  const DONE_WORDS = ["닫힌", "완료", "끝난", "closed", "done", "해결"];

  function norm(q) { return String(q || "").toLowerCase().replace(/\s+/g, " ").trim(); }
  function has(t, w) { return t.indexOf(String(w).toLowerCase()) > -1; }

  /* 이 질문이 목록형을 묻고 있는가 */
  function detect(q) {
    const t = norm(q);
    for (let i = 0; i < KINDS.length; i++) {
      if (KINDS[i].words.some(w => has(t, w))) return KINDS[i];
    }
    return null;
  }

  function live(list) {
    return (window.Collections ? window.Collections.live(list) : (list || []));
  }

  /* ── 저장소에서 꺼내기 ────────────────────────────────────────────────
     없으면 null 을 돌려줍니다 — 빈 배열과 구별해야 합니다.
     빈 배열은 "0건", null 은 "이 화면에서는 볼 수 없음" 입니다. */
  function pull(kind) {
    try {
      if (kind === "issue")   return window.Issues   ? window.Issues.all() : null;
      if (kind === "request") return window.Requests ? window.Requests.all() : null;
      if (kind === "todo")    return window.Todos
        ? live(window.Todos.state().list) : null;
      if (kind === "event")   return window.HubCalendar && window.HubCalendar.userEvents
        ? window.HubCalendar.userEvents() : null;
      if (kind === "booking") return window.Store && window.Store.bookings
        ? window.Store.bookings() : null;
    } catch (e) { return null; }
    return null;
  }

  /* 열림/닫힘 — 저장소마다 판정이 다릅니다 */
  function isOpen(kind, r) {
    if (kind === "issue")   return r.status !== "closed" && r.status !== "resolved";
    if (kind === "request") return r.status !== "closed" && r.status !== "rejected";
    if (kind === "todo")    return !r.done;
    return true;                       /* 일정 · 예약은 열림 개념이 없습니다 */
  }

  /* 한 줄로 어떻게 보일 것인가 */
  function rowOf(kind, r) {
    if (kind === "issue") {
      const sev = (window.Issues && window.Issues.SEVERITY[r.severity]) || {};
      const st = (window.Issues && window.Issues.STATUS[r.status]) || {};
      return { 제목: r.title || "—", 심각도: sev.ko || r.severity || "—",
               상태: st.ko || r.status || "—", 팀: teamKo(r.team), 등록: r.createdAt || "—" };
    }
    if (kind === "request") {
      const st = (window.Requests && window.Requests.STATUS[r.status]) || {};
      return { 의뢰번호: r.id, 목적: r.purpose || "—", 상태: st.ko || r.status || "—",
               시료: (r.sampleIds || []).length + "건", 기한: r.dueAt || "—" };
    }
    if (kind === "todo") {
      return { 할일: r.text || "—", 팀: teamKo(r.team), 담당: r.assignee || "—",
               기한: r.due || "—", 상태: r.done ? "완료" : "진행" };
    }
    if (kind === "event") {
      return { 날짜: r.date || "—", 내용: r.ko || r.title || "—", 종류: r.kind || "—" };
    }
    if (kind === "booking") {
      return { 장비: r.equip || "—", 날짜: r.date || "—",
               시간: (r.start || "?") + "–" + (r.end || "?"),
               사용자: r.who || "—", 용도: r.purpose || "—" };
    }
    return {};
  }

  function teamKo(id) {
    const t = (window.HUB && window.HUB.TEAMS ? window.HUB.TEAMS : [])
      .concat(window.DATA_TEAMS || []).find(x => x && x.id === id);
    return (t && (t.ko || t.label)) || id || "—";
  }

  /* ── 답 만들기 ───────────────────────────────────────────────────────── */
  function answer(q) {
    const kind = detect(q);
    if (!kind) return null;

    const list = pull(kind.id);
    if (list === null) {
      return { kind: "records", ok: false, recordKind: kind.id,
        headline: kind.ko + " 기록을 이 화면에서는 읽을 수 없습니다.",
        note: "이 화면에는 " + kind.ko + " 저장소가 실려 있지 않습니다. " +
              "대시보드에서 다시 물어보시면 답할 수 있습니다.",
        rows: [], facts: [], suggestions: [] };
    }

    const t = norm(q);
    const wantOpen = OPEN_WORDS.some(w => has(t, w));
    const wantDone = DONE_WORDS.some(w => has(t, w));

    let rows = list.slice();
    let filterKo = "전체";
    if (wantOpen && !wantDone) { rows = rows.filter(r => isOpen(kind.id, r)); filterKo = "열린 것만"; }
    else if (wantDone && !wantOpen) { rows = rows.filter(r => !isOpen(kind.id, r)); filterKo = "닫힌 것만"; }

    const facts = [
      { k: "대상", v: kind.ko },
      { k: "조건", v: filterKo },
      { k: "건수", v: rows.length + "건" }
    ];
    if (kind.id === "issue" || kind.id === "request" || kind.id === "todo") {
      facts.push({ k: "열린 것", v: list.filter(r => isOpen(kind.id, r)).length + "건" });
    }

    const headline = rows.length
      ? kind.ko + " " + (filterKo === "전체" ? "" : filterKo + " ") + rows.length + "건입니다."
      : kind.ko + " 기록이 " + (filterKo === "전체" ? "" : filterKo + " ") + "없습니다.";

    const shown = rows.slice(0, 15).map(r => rowOf(kind.id, r));
    const cols = shown.length ? Object.keys(shown[0]).map(k => ({ key: k, label: k })) : [];

    return {
      kind: "records", ok: true, recordKind: kind.id,
      headline: headline,
      facts: facts,
      rows: shown, evidenceCols: cols,
      note: (rows.length > 15 ? "앞의 15건만 표시했습니다 (전체 " + rows.length + "건). " : "") +
        "이 숫자는 저장된 기록을 그대로 센 것입니다 — 측정 데이터와는 다른 표입니다.",
      source: kind.ko,
      suggestions: suggestFor(kind.id)
    };
  }

  function suggestFor(id) {
    if (id === "issue")   return ["열린 이슈만", "이슈 전체 보여줘"];
    if (id === "request") return ["열린 의뢰만", "의뢰 전체 보여줘"];
    if (id === "todo")    return ["남은 할 일", "할 일 전체"];
    if (id === "booking") return ["장비 예약 전체"];
    if (id === "event")   return ["일정 전체 보여줘"];
    return [];
  }

  return { detect, answer, KINDS };
})();
