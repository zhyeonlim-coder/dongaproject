/* ==========================================================================
   studies.js — Study 마스터 (중심 엔티티)  [P0-1]

   Excel "Study" 열 → 과제 / Study 분리 (수작업 매핑, 런타임 파싱 없음)

     "Media screening test"      → projectId null,      scope platform
     "DA-1234 DOE test"          → PRJ-1234 + "DOE test"
     "DA-4321 feasibility test"  → PRJ-4321 + "feasibility test"

   ── scope 값에 대한 설명 ─────────────────────────────────────────────────
   지시서는 scope 를 "project" | "platform" 두 값으로 정의했습니다. 그런데
   Excel 첫 행은 Study 열에 "Study" 라고만 적혀 있고 Exp. No.가 비어 있어
   어느 과제 소속인지 알 수 없습니다(원본 Notes에 기록됨).
   이 행을 project 로 넣으면 소속을 단정하는 것이고, platform 으로 넣으면
   기반 Study라고 거짓 주장을 하게 됩니다. 그래서 세 번째 값
   "unassigned" 를 두고 화면에는 "(미지정)"으로 표시합니다.
   소속이 확인되면 projectId 를 채우고 scope 를 "project" 로 바꾸면 됩니다.
   ========================================================================== */

window.DATA_STUDIES = [
  {
    id: "STD-0045",
    projectId: null,                 // 기반 Study — 특정 과제에 속하지 않음
    scope: "platform",
    name: "Media screening test",    // 과제 코드 없음 (원본 그대로)
    type: "Media screening",
    /* 어느 과제에 적용됐는지는 Excel에 없습니다. 지어내지 않고 빈 배열로 두며
       UI에서는 "적용 과제 미입력"으로 표시합니다. */
    appliedToProjects: [],
    startDate: "2024-11-01",
    endDate: "2024-11-15",
    status: "완료",
    objective: null,
    batchCount: 5
  },
  {
    id: "STD-0123",
    projectId: "PRJ-1234",
    scope: "project",
    name: "DOE test",                // "DA-1234" 제거됨
    type: "DOE",
    appliedToProjects: null,
    startDate: "2024-12-10",
    endDate: "2024-12-24",
    status: "완료",
    objective: null,
    batchCount: 12
  },
  {
    id: "STD-0321",
    projectId: "PRJ-4321",
    scope: "project",
    name: "feasibility test",        // "DA-4321" 제거됨
    type: "Feasibility",
    appliedToProjects: null,
    startDate: "2025-01-09",
    endDate: "2025-01-23",
    status: "완료",
    objective: null,
    batchCount: 10
  },
  {
    id: "STD-0000",
    projectId: null,
    scope: "unassigned",             // 소속 미확인 — 위 주석 참고
    name: "(미지정)",
    type: null,
    appliedToProjects: null,
    startDate: "2024-08-16",
    endDate: "2024-08-29",
    status: "확인 필요",
    objective: null,
    batchCount: 1
  }
];

/* ── 측정 항목 스키마 ───────────────────────────────────────────────────
   각 그룹에 team 을 붙여 팀 축을 만듭니다. Excel에 팀 컬럼은 없지만
   어느 그룹이 어느 팀 산출물인지는 컬럼 구조상 명확합니다.
   downstream(정제) 그룹은 원본에 데이터가 전혀 없어 정의만 두고 비웠습니다. */
window.DATA_ANALYTE_GROUPS = [
  { id: "upstream", team: "upstream", label: "배양", items: [
    { key: "ivcd",           label: "IVCD",            unit: "10⁶ cells/mL", dp: 1 },
    { key: "maxVCD",         label: "Max VCD",         unit: "10⁶ cells/mL", dp: 2 },
    { key: "finalVCD",       label: "Final VCD",       unit: "10⁶ cells/mL", dp: 2 },
    { key: "finalViability", label: "Final Viability", unit: "%",            dp: 1 }
  ]},
  { id: "titer", team: "upstream", label: "Titer & qP", items: [
    { key: "titerHCCF", label: "Titer HCCF", unit: "mg/L",        dp: 1 },
    { key: "qP",        label: "qP",         unit: "pg/cell·day", dp: 2 }
  ]},
  { id: "seHPLC", team: "analytics", label: "SE-HPLC", note: "간이정제(Protein A) 후", items: [
    { key: "hmw",  label: "HMW",  unit: "%", dp: 1 },
    { key: "main", label: "Main", unit: "%", dp: 1 },
    { key: "lmw",  label: "LMW",  unit: "%", dp: 1 }
  ]},
  { id: "ieHPLC", team: "analytics", label: "IE-HPLC", note: "간이정제(Protein A) 후", items: [
    { key: "acidic",       label: "Acidic",             unit: "%", dp: 1 },
    { key: "main",         label: "Main",               unit: "%", dp: 1 },
    { key: "basic",        label: "Basic",              unit: "%", dp: 1 },
    { key: "basicUnknown", label: "Basic Unknown Peak", unit: "%", dp: 1 }
  ]},
  { id: "nGlycan", team: "analytics", label: "N-glycan", items: [
    { key: "g0f",          label: "G0F",               unit: "%", dp: 1 },
    { key: "g1f",          label: "G1F",               unit: "%", dp: 1 },
    { key: "highMannose",  label: "High mannose",      unit: "%", dp: 1 },
    { key: "sialicAcid",   label: "Sialic acid",       unit: "%", dp: 1 },
    { key: "afucosylated", label: "Afucosylated form", unit: "%", dp: 1 }
  ]},
  { id: "ceSdsNR", team: "analytics", label: "CE-SDS NR", items: [
    { key: "monomer", label: "Monomer", unit: "%", dp: 1 },
    { key: "h2l1",    label: "2H1L",    unit: "%", dp: 1 }
  ]},
  { id: "ceSdsR", team: "analytics", label: "CE-SDS R", items: [
    { key: "lc",   label: "LC",    unit: "%", dp: 2 },
    { key: "hc",   label: "HC",    unit: "%", dp: 2 },
    { key: "lcHc", label: "LC+HC", unit: "%", dp: 2 },
    { key: "nghc", label: "NGHC",  unit: "%", dp: 2 }
  ]},
  /* 정제 — 원본 Excel에 해당 데이터가 없습니다. 구조만 유지하고 항목은 비움. */
  { id: "downstream", team: "downstream", label: "정제", items: [], empty: true,
    emptyReason: "원본 Excel에 정제 공정 데이터가 없습니다." }
];

window.DATA_TITER_DAYS = ["D10","D11","D12","D13","D14","D15","D16","D17","D18","D19","D20"];
