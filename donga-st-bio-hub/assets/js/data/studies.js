/* ==========================================================================
   studies.js — Study 마스터 (중심 엔티티)

   계층: 과제(Project) → Study → 팀(Team) → Batch → Sample

   Excel "Study" 열 → 과제 / Study 분리 (수작업 매핑, 런타임 파싱 없음)

     "Media screening test"      → PRJ-1234 + "Media screening test"
     "DA-1234 DOE test"          → PRJ-1234 + "DoE test"
     "DA-4321 feasibility test"  → PRJ-4321 + "Feasibility test"

   ── 구조 개편 기록 ────────────────────────────────────────────────────────
   이전 버전에는 과제에 속하지 않는 "기반 Study(platform)" 와 소속을 알 수
   없는 "(미지정)" Study 가 따로 있었습니다. 두 개념 모두 폐지하고 모든
   Study 를 두 과제 중 하나에 소속시켰습니다.

   · Media screening test 는 기반 Study → DA-1234 하위로 이동
   · 소속 미확인 배치(UNSPEC-01, Exp. No. 공란) 는 DA-1234 의
     Media screening test 로 편입 — 그래서 이 Study 의 기간이
     2024-08-16 까지 앞당겨지고 배치가 5건 → 6건이 되었습니다.

   과제 여부는 접두어("DA-")가 아니라 projectId 로 판별합니다.
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

/* ── 측정 항목 스키마 ───────────────────────────────────────────────────
   각 그룹에 team 을 붙여 팀 축을 만듭니다. Excel에 팀 컬럼은 없지만
   어느 그룹이 어느 팀 산출물인지는 컬럼 구조상 명확합니다.

   순서 = 화면의 컬럼 순서입니다. 공정 흐름대로 배양 → 정제 → 분석.

   정제(downstream) 그룹의 값은 원본 Excel 에 없어 downstream.js 가
   Study 성격에 맞춰 생성합니다. 스키마는 여기 한 곳에만 둡니다.

   ── lo / hi 는 규격이 아닙니다 ──────────────────────────────────────────
   **물리적으로 나올 수 있는 입력 범위**입니다. 오타와 단위 착각을 잡는
   그물이지, 합격 여부를 가르는 기준이 아닙니다.
     예) Viability 597% → 소수(0.597)를 % 로 잘못 넣은 것
         Titer 1.4 mg/L → g/L 값을 mg/L 칸에 넣은 것
   합격 기준(규격)은 아직 없으며, 들어오면 별도 필드로 붙습니다.

   cumulative: true 인 항목은 배양이 진행되며 쌓이는 값이라 전일보다
   낮아지면 경고합니다. */
window.DATA_ANALYTE_GROUPS = [
  { id: "upstream", team: "upstream", label: "배양", items: [
    { key: "ivcd",           label: "IVCD",            unit: "10⁶ cells/mL", dp: 1, lo: 0, hi: 5000, cumulative: true },
    { key: "maxVCD",         label: "Max VCD",         unit: "10⁶ cells/mL", dp: 2, lo: 0, hi: 200 },
    { key: "finalVCD",       label: "Final VCD",       unit: "10⁶ cells/mL", dp: 2, lo: 0, hi: 200 },
    { key: "finalViability", label: "Final Viability", unit: "%",            dp: 1, lo: 0, hi: 100 }
  ]},
  { id: "titer", team: "upstream", label: "Titer & qP", items: [
    { key: "titerHCCF", label: "Titer HCCF", unit: "mg/L",        dp: 1, lo: 0, hi: 20000 },
    { key: "qP",        label: "qP",         unit: "pg/cell·day", dp: 2, lo: 0, hi: 500 }
  ]},

  { id: "downstream", team: "downstream", label: "정제",
    note: "Protein A → CEX → AEX 3-step 정제", items: [
    { key: "proteinAYield", label: "Protein A Step Yield", unit: "%",     dp: 1, lo: 0, hi: 100 },
    { key: "cexYield",      label: "CEX Step Yield",       unit: "%",     dp: 1, lo: 0, hi: 100 },
    { key: "aexYield",      label: "AEX Step Yield",       unit: "%",     dp: 1, lo: 0, hi: 100 },
    { key: "totalYield",    label: "Total Yield",          unit: "%",     dp: 1, lo: 0, hi: 100 },
    { key: "monomerPurity", label: "SEC-HPLC Monomer",     unit: "%",     dp: 2, lo: 0, hi: 100 },
    { key: "hcp",           label: "HCP",                  unit: "ppm",   dp: 1, lo: 0, hi: 1000000 },
    { key: "residualDNA",   label: "Residual DNA",         unit: "pg/mg", dp: 2, lo: 0, hi: 100000 }
  ]},

  { id: "seHPLC", team: "analytics", label: "SE-HPLC", note: "간이정제(Protein A) 후", items: [
    { key: "hmw",  label: "HMW",  unit: "%", dp: 1, lo: 0, hi: 100 },
    { key: "main", label: "Main", unit: "%", dp: 1, lo: 0, hi: 100 },
    { key: "lmw",  label: "LMW",  unit: "%", dp: 1, lo: 0, hi: 100 }
  ]},
  { id: "ieHPLC", team: "analytics", label: "IE-HPLC", note: "간이정제(Protein A) 후", items: [
    { key: "acidic",       label: "Acidic",             unit: "%", dp: 1, lo: 0, hi: 100 },
    { key: "main",         label: "Main",               unit: "%", dp: 1, lo: 0, hi: 100 },
    { key: "basic",        label: "Basic",              unit: "%", dp: 1, lo: 0, hi: 100 },
    { key: "basicUnknown", label: "Basic Unknown Peak", unit: "%", dp: 1, lo: 0, hi: 100 }
  ]},
  { id: "nGlycan", team: "analytics", label: "N-glycan", items: [
    { key: "g0f",          label: "G0F",               unit: "%", dp: 1, lo: 0, hi: 100 },
    { key: "g1f",          label: "G1F",               unit: "%", dp: 1, lo: 0, hi: 100 },
    { key: "highMannose",  label: "High mannose",      unit: "%", dp: 1, lo: 0, hi: 100 },
    { key: "sialicAcid",   label: "Sialic acid",       unit: "%", dp: 1, lo: 0, hi: 100 },
    { key: "afucosylated", label: "Afucosylated form", unit: "%", dp: 1, lo: 0, hi: 100 }
  ]},
  { id: "ceSdsNR", team: "analytics", label: "CE-SDS NR", items: [
    { key: "monomer", label: "Monomer", unit: "%", dp: 1, lo: 0, hi: 100 },
    { key: "h2l1",    label: "2H1L",    unit: "%", dp: 1, lo: 0, hi: 100 }
  ]},
  { id: "ceSdsR", team: "analytics", label: "CE-SDS R", items: [
    { key: "lc",   label: "LC",    unit: "%", dp: 2, lo: 0, hi: 100 },
    { key: "hc",   label: "HC",    unit: "%", dp: 2, lo: 0, hi: 100 },
    { key: "lcHc", label: "LC+HC", unit: "%", dp: 2, lo: 0, hi: 100 },
    { key: "nghc", label: "NGHC",  unit: "%", dp: 2, lo: 0, hi: 100 }
  ]}
];

/* 일자별 Titer 입력 범위 — 배양이 진행되며 쌓이는 누적값입니다 */
window.DATA_TITER_ITEM = { label: "Titer", unit: "mg/L", dp: 0, lo: 0, hi: 20000, cumulative: true };

window.DATA_TITER_DAYS = ["D10","D11","D12","D13","D14","D15","D16","D17","D18","D19","D20"];

/* ── Data 분류 ──────────────────────────────────────────────────────────
   검색·필터에서 쓰는 "무엇을 측정한 값인가" 축입니다. Study 유형(DOE ·
   Feasibility …)을 대체합니다 — 연구자가 실제로 찾는 건 Study 의 성격이
   아니라 측정 항목이기 때문입니다.

     keys      : 컬럼 키 정확히 일치 (배양 지표처럼 batch 직속인 값)
     prefixes  : 컬럼 키 접두어 일치 (그룹 전체 · 일자별 Titer)
     alias     : 검색어 매칭용 별칭 (라벨 외에 추가로 걸리게 할 단어)
   ────────────────────────────────────────────────────────────────────── */
window.DATA_CLASSES = [
  { id: "vcd",       label: "Max VCD",     team: "upstream",
    keys: ["ivcd", "maxVCD", "finalVCD"], prefixes: [], alias: ["VCD", "생세포", "IVCD"] },
  { id: "viability", label: "Viability",   team: "upstream",
    keys: ["finalViability"], prefixes: [], alias: ["생존율"] },
  { id: "titer",     label: "Titer",       team: "upstream",
    keys: ["titerHCCF", "qP"], prefixes: ["titer."], alias: ["HCCF", "생산량", "역가"] },

  { id: "stepYield", label: "Step Yield",  team: "downstream",
    keys: ["downstream.proteinAYield", "downstream.cexYield", "downstream.aexYield"],
    prefixes: [], alias: ["수율", "Protein A", "CEX", "AEX"] },
  { id: "totalYield", label: "Total Yield", team: "downstream",
    keys: ["downstream.totalYield"], prefixes: [], alias: ["총수율", "전체 수율"] },
  { id: "monomer",   label: "SEC-HPLC Monomer", team: "downstream",
    keys: ["downstream.monomerPurity"], prefixes: [], alias: ["순도", "Purity", "SEC"] },
  { id: "impurity",  label: "HCP / Residual DNA", team: "downstream",
    keys: ["downstream.hcp", "downstream.residualDNA"], prefixes: [], alias: ["불순물", "숙주단백"] },

  { id: "seHPLC",    label: "SE-HPLC",     team: "analytics",
    keys: [], prefixes: ["seHPLC."], alias: ["HMW", "LMW", "응집체"] },
  { id: "ieHPLC",    label: "IE-HPLC",     team: "analytics",
    keys: [], prefixes: ["ieHPLC."], alias: ["Acidic", "Basic", "전하변이"] },
  { id: "nGlycan",   label: "N-glycan",    team: "analytics",
    keys: [], prefixes: ["nGlycan."], alias: ["당쇄", "시알산", "Sialic", "G0F", "Glycan"] },
  { id: "ceSds",     label: "CE-SDS",      team: "analytics",
    keys: [], prefixes: ["ceSdsNR.", "ceSdsR."], alias: ["Monomer", "LC", "HC"] }
];
