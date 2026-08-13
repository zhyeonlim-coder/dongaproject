/* ==========================================================================
   people.js — 팀별 연구원 명부  ·  window.People

   ⚠ 이 명부는 **생성한 데이터**입니다. Batch_Data_example.xlsx 에는 담당자
     컬럼이 없고, 로그인용 데모 계정 3명(박서연 · 김준호 · 이하은)은
     신약연구소 · 메디컬본부 · 개발본부 소속이라 배양 · 정제 · 바이오분석
     공정팀 회의의 담당자가 될 수 없습니다.

     회의에서 Action Item 에 담당자를 지정하려면 사람 목록이 반드시 있어야
     하므로, 팀별 3명씩 가상 명부를 둡니다. 이름은 기존 화면에 이미 등장하는
     작성자(김민수 · 이정호 · 정하은)를 팀장으로 삼아 서로 어긋나지 않게 했습니다.

     실제 시스템에서는 이 파일을 사내 인사 · 조직도 API 로 교체하면 됩니다.
   ========================================================================== */

window.People = (function () {
  "use strict";

  const LIST = [
    /* 배양공정팀 — 기존 할 일 시드의 작성자 김민수를 팀장으로 */
    { id: "P-U1", name: "김민수", team: "upstream",   role: "팀장",   initials: "김" },
    { id: "P-U2", name: "박지훈", team: "upstream",   role: "선임",   initials: "박" },
    { id: "P-U3", name: "최유진", team: "upstream",   role: "연구원", initials: "최" },

    /* 정제공정팀 — 이정호 */
    { id: "P-D1", name: "이정호", team: "downstream", role: "팀장",   initials: "이" },
    { id: "P-D2", name: "한소영", team: "downstream", role: "선임",   initials: "한" },
    { id: "P-D3", name: "오세훈", team: "downstream", role: "연구원", initials: "오" },

    /* 바이오분석팀 — 정하은 */
    { id: "P-A1", name: "정하은", team: "analytics",  role: "팀장",   initials: "정" },
    { id: "P-A2", name: "윤가람", team: "analytics",  role: "선임",   initials: "윤" },
    { id: "P-A3", name: "서동현", team: "analytics",  role: "연구원", initials: "서" }
  ];

  function teamKo(id) {
    const t = (window.DATA_TEAMS || []).find(x => x.id === id);
    return t ? t.ko : id;
  }
  function teamShort(id) {
    const t = (window.DATA_TEAMS || []).find(x => x.id === id);
    return t ? t.short : id;
  }

  function all() { return LIST.slice(); }
  function byTeam(team) { return LIST.filter(p => !team || p.team === team); }
  function get(name) { return LIST.find(p => p.name === name || p.id === name) || null; }

  /* @멘션 자동완성 — 이름 · 팀 · 역할 어디에 걸려도 찾습니다 */
  function search(term) {
    const t = String(term || "").trim().toLowerCase();
    if (!t) return all();
    return LIST.filter(p =>
      (p.name + " " + teamKo(p.team) + " " + teamShort(p.team) + " " + p.role).toLowerCase().indexOf(t) > -1);
  }

  /* 팀 단위로 묶은 목록 — select 의 optgroup 용 */
  function grouped() {
    return (window.DATA_TEAMS || []).map(t => ({
      team: t.id, ko: t.ko, people: byTeam(t.id)
    })).filter(g => g.people.length);
  }

  return { all, byTeam, get, search, grouped, teamKo, teamShort, GENERATED: true };
})();
