/* ==========================================================================
   projects.js — 과제(Project) 마스터  [P0-1]

   Excel의 Study 열에는 "DA-1234 DOE test" 처럼 과제 코드와 Study 명이 한 셀에
   합쳐져 있습니다. 이 분리는 **데이터 소스 단계에서 사람이 명시적으로 수행**
   합니다 — 런타임에 문자열을 파싱해 과제를 추출하지 않습니다.

   이유: "Media screening test" 처럼 과제 코드가 없는 기반 Study가 존재하고,
   과제 코드 표기 규칙도 바뀔 수 있어 파싱은 반드시 깨집니다.
   과제 여부는 접두어("DA-")가 아니라 Study.scope 필드로 판별합니다.
   ========================================================================== */

window.DATA_PROJECTS = [
  { id: "PRJ-1234", code: "DA-1234", name: "DA-1234" },
  { id: "PRJ-4321", code: "DA-4321", name: "DA-4321" }
];

/* 팀 축 — Excel에 팀 컬럼은 없지만 측정 항목이 어느 팀 산출물인지는
   컬럼 그룹으로 명확히 구분됩니다. 그 매핑을 여기서 정의합니다. */
window.DATA_TEAMS = [
  { id: "upstream",   ko: "배양공정팀",   short: "배양", en: "Upstream",   color: "var(--c-accent)" },
  { id: "downstream", ko: "정제공정팀",   short: "정제", en: "Downstream", color: "#6D28D9" },
  { id: "analytics",  ko: "바이오분석팀", short: "분석", en: "Analytics",  color: "#0F766E" }
];
