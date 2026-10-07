/* ==========================================================================
   excel-studies.js — 검사용 Study 세 개  ★ 검사 페이지에서만 싣습니다

   예전에는 assets/js/data/studies.js 에 박혀 있었습니다. 그래서 DB 를 비워도
   "Feasibility test" 가 드롭다운에 남아, 사용자가 만든 Study 와 섞였습니다.

   검사는 늘 같은 입력에서 같은 답이 나와야 하므로 이 한 벌은 필요합니다.
   다만 **화면을 띄우는 페이지는 싣지 않습니다.** tests/ 는 배포에서도
   제외되므로(.vercelignore) 이 파일은 production 에 올라가지 않습니다.

   출처: Batch_Data_example.xlsx 의 "Study" 열을 과제 / Study 로 분리한 것.

     "Media screening test"      → PRJ-1234 + "Media screening test"
     "DA-1234 DOE test"          → PRJ-1234 + "DoE test"
     "DA-4321 feasibility test"  → PRJ-4321 + "Feasibility test"

   소속을 알 수 없던 배치(UNSPEC-01, Exp. No. 공란)는 DA-1234 의
   Media screening test 로 편입했습니다 — 그래서 이 Study 의 시작일이
   2024-08-16 까지 앞당겨지고 배치가 5건 → 6건입니다.
   ========================================================================== */

window.DATA_STUDIES = [
  {
    id: "STD-0045",
    projectId: "PRJ-1234",
    name: "Media screening test",
    type: "Media screening",
    /* 시작일이 11-01 이 아니라 08-16 인 이유는 위 편입 기록 참고 */
    startDate: "2024-08-16",
    endDate: "2024-11-15",
    status: "완료",
    objective: null,
    batchCount: 6
  },
  {
    id: "STD-0123",
    projectId: "PRJ-1234",
    name: "DoE test",                // 원본 "DA-1234 DOE test" 에서 과제 코드 제거
    type: "DOE",
    startDate: "2024-12-10",
    endDate: "2024-12-24",
    status: "완료",
    objective: null,
    batchCount: 12
  },
  {
    id: "STD-0321",
    projectId: "PRJ-4321",
    name: "Feasibility test",        // 원본 "DA-4321 feasibility test"
    type: "Feasibility",
    startDate: "2025-01-09",
    endDate: "2025-01-23",
    status: "완료",
    objective: null,
    batchCount: 10
  }
];
