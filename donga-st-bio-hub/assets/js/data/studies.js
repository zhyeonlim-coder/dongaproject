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

/* ★ 예시 Study 를 여기서 **지웠습니다** (2026-10).

   Media screening test · DoE test · Feasibility test 세 개가 이 파일에
   박혀 있었습니다. DB 가 비어 있어도 — 비운 직후에도 — 드롭다운에 나타났고,
   사용자가 만든 Study 와 섞여서 어느 것이 진짜 자기 데이터인지 구분할 수
   없었습니다.

   이제 Study 는 **사용자가 만든 것만** 있습니다. 빈 시스템은 비어 보입니다.

   예시 엑셀 한 벌(3 Study · 28 Batch · 31 시료)은 검사 스위트의 고정 입력
   으로 tests/fixtures/ 에 남아 있습니다. 검사는 늘 같은 입력에서 같은 답이
   나와야 하므로 그쪽에는 있어야 합니다. 화면을 띄우는 페이지는 그 파일을
   싣지 않습니다 — tests/ 는 배포에서도 제외됩니다(.vercelignore). */
window.DATA_STUDIES = [];

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
/* ── 기본 지표 (2026-10 재설정) ──────────────────────────────────────────
   세 팀이 실제로 쓰는 항목만 남겼습니다. 예시 엑셀을 그대로 옮기면서 생긴
   항목들(IE-HPLC · N-glycan · CE-SDS · HCP · Residual DNA · qP)은 뺐습니다 —
   쓰지 않는 칸이 많으면 "미입력" 이 기본 상태가 되고, 그러면 미입력이
   신호가 아니라 배경이 됩니다.

   ★ 여기 없는 항목도 쓸 수 있습니다. Data 입력에서 열을 더하면 조회 ·
     대시보드 · AI 가 코드 수정 없이 따라옵니다. 이 목록은 "처음부터 있는
     것" 이지 "쓸 수 있는 전부" 가 아닙니다. */
window.DATA_ANALYTE_GROUPS = [
  { id: "upstream", team: "upstream", label: "배양", items: [
    { key: "ivcd",           label: "IVCD",            unit: "10⁶ cells/mL", dp: 1, lo: 0, hi: 5000, cumulative: true },
    /* peak: 요약에서 평균이 아니라 **최고값**을 적는 항목입니다. 배양이
       진행되며 올라가는 값이라 평균은 중간 시점이 섞여 뜻이 흐려집니다.
       (cumulative 와 달리 입력 경고에는 쓰이지 않습니다 — 표시 규칙입니다) */
    { key: "maxVCD",         label: "Max VCD",         unit: "10⁶ cells/mL", dp: 2, lo: 0, hi: 200, peak: true },
    { key: "finalVCD",       label: "Final VCD",       unit: "10⁶ cells/mL", dp: 2, lo: 0, hi: 200 },
    /* 키는 titerHCCF 그대로 둡니다 — 이미 저장된 값과 별칭이 이 키를 가리킵니다.
       화면에 보이는 이름만 "Titer" 로 바꿉니다. */
    { key: "titerHCCF",      label: "Titer",           unit: "mg/L",         dp: 1, lo: 0, hi: 20000, peak: true },
    { key: "finalViability", label: "Final Viability", unit: "%",            dp: 1, lo: 0, hi: 100 }
  ]},

  { id: "downstream", team: "downstream", label: "정제",
    note: "Protein A → CEX → AEX 3-step 정제", items: [
    { key: "proteinAYield", label: "Protein A Step Yield", unit: "%", dp: 1, lo: 0, hi: 100 },
    { key: "cexYield",      label: "CEX Step Yield",       unit: "%", dp: 1, lo: 0, hi: 100 },
    { key: "aexYield",      label: "AEX Step Yield",       unit: "%", dp: 1, lo: 0, hi: 100 },
    { key: "totalYield",    label: "Total Yield",          unit: "%", dp: 1, lo: 0, hi: 100 }
  ]},

  { id: "seHPLC", team: "analytics", label: "SE-HPLC", note: "간이정제(Protein A) 후", items: [
    { key: "hmw",  label: "HMW",     unit: "%", dp: 1, lo: 0, hi: 100 },
    /* 키는 main 그대로 — SE-HPLC 주피크가 곧 단량체입니다. 이름만 Monomer 로. */
    { key: "main", label: "Monomer", unit: "%", dp: 1, lo: 0, hi: 100 },
    { key: "lmw",  label: "LMW",     unit: "%", dp: 1, lo: 0, hi: 100 }
  ]},
  { id: "potency", team: "analytics", label: "Potency", items: [
    /* lo/hi 는 합격 기준이 아니라 오타·단위 착각을 잡는 그물입니다.
       0.95 (소수를 % 로 잘못 넣음) 와 1850 을 걸러냅니다. */
    { key: "potency", label: "Potency", unit: "%", dp: 1, lo: 50, hi: 200 }
  ]}
];

/* 일자별 Titer 입력 범위 — 배양이 진행되며 쌓이는 누적값입니다.
   ★ 일자축은 쓰지 않기로 했습니다 (DATA_TITER_DAYS = []). Titer 는 배치당
     한 값입니다. 정의 자체는 남겨 둡니다 — 일자축이 다시 필요해지면 여기
     배열만 채우면 화면·차트·AI 가 그대로 따라옵니다. */
window.DATA_TITER_ITEM = { label: "Titer", unit: "mg/L", dp: 0, lo: 0, hi: 20000, cumulative: true };

window.DATA_TITER_DAYS = [];

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
