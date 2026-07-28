/* ==========================================================================
   R&D workflow dataset — projects, batches, materials, process data

   ⚠ ALL DATA IS FICTIONAL. Batch numbers, titers, HCP/HCD values, yields and
   dates are invented for design demonstration. Value ranges were chosen to be
   plausible for CHO fed-batch mAb production so the charts read realistically;
   they describe no real Dong-A ST process.

   Workflow modelled:
     계획서 → 배양(Batch) → 정제(물질) → DS/DP → 바이오분석 → 보고서/QA EDMS
   ========================================================================== */

window.RND = (function () {
  "use strict";

  /* -- Projects (과제) ---------------------------------------------------- */
  const PROJECTS = [
    { id: "PRJ-2024-011", ko: "DA-1809 제2형 당뇨 병용요법", en: "T2DM combination",
      area: "Metabolic", lead: "김준호", stage: "임상 2상", start: "2024-03", end: "2026-12" },
    { id: "PRJ-2025-003", ko: "DB-3115 바이오시밀러 (자가면역)", en: "Biosimilar",
      area: "Biosimilar", lead: "이하은", stage: "허가신청", start: "2025-01", end: "2026-09" },
    { id: "PRJ-2025-014", ko: "DA-2255 비만 치료 후보", en: "Obesity candidate",
      area: "Metabolic", lead: "박서연", stage: "임상 1상", start: "2025-06", end: "2027-06" }
  ];

  /* -- Plans (계획서) / Reports (보고서) — Track A ------------------------ */
  const PLANS = [
    { id: "PLN-24-0112", prj: "PRJ-2024-011", ko: "생산 배양 공정 최적화 계획서", ver: "v2.1", status: "승인", date: "2024-04-02", author: "김준호" },
    { id: "PLN-24-0118", prj: "PRJ-2024-011", ko: "정제 공정 스케일업 계획서",     ver: "v1.3", status: "승인", date: "2024-07-15", author: "정민우" },
    { id: "PLN-25-0031", prj: "PRJ-2025-003", ko: "유사성 평가 배양 계획서",       ver: "v3.0", status: "승인", date: "2025-02-10", author: "이하은" },
    { id: "PLN-25-0044", prj: "PRJ-2025-003", ko: "DS 안정성 시험 계획서",         ver: "v1.0", status: "검토중", date: "2025-11-28", author: "최지훈" },
    { id: "PLN-25-0141", prj: "PRJ-2025-014", ko: "초기 배양 조건 확립 계획서",    ver: "v1.2", status: "승인", date: "2025-07-03", author: "박서연" }
  ];

  const REPORTS = [
    { id: "RPT-24-0087", prj: "PRJ-2024-011", ko: "배양 공정 최적화 결과 보고서", status: "EDMS 등록", date: "2025-02-19", author: "김준호", edms: "EDMS-24-1183" },
    { id: "RPT-25-0012", prj: "PRJ-2024-011", ko: "정제 스케일업 결과 보고서",     status: "QA 검토", date: "2026-06-30", author: "정민우", edms: "—" },
    { id: "RPT-25-0058", prj: "PRJ-2025-003", ko: "유사성 평가 종합 보고서",       status: "EDMS 등록", date: "2026-03-11", author: "이하은", edms: "EDMS-26-0342" },
    { id: "RPT-26-0007", prj: "PRJ-2025-014", ko: "초기 배양 조건 확립 보고서",    status: "작성중", date: "—", author: "박서연", edms: "—" }
  ];

  /* -- Batches (배양) — Track B ------------------------------------------ */
  const BATCHES = [
    { id: "B2508-01", prj: "PRJ-2025-003", scale: "200 L", mode: "Fed-batch", cell: "CHO-K1",
      start: "2026-05-12", days: 14, titer: 4.12, peakVCD: 17.4, status: "완료", team: "배양공정팀" },
    { id: "B2509-03", prj: "PRJ-2025-003", scale: "200 L", mode: "Fed-batch", cell: "CHO-K1",
      start: "2026-06-08", days: 14, titer: 3.86, peakVCD: 16.1, status: "완료", team: "배양공정팀" },
    { id: "B2606-02", prj: "PRJ-2024-011", scale: "50 L",  mode: "Fed-batch", cell: "CHO-DG44",
      start: "2026-06-22", days: 14, titer: 3.41, peakVCD: 14.8, status: "완료", team: "배양공정팀" },
    { id: "B2607-01", prj: "PRJ-2025-014", scale: "5 L",   mode: "Fed-batch", cell: "CHO-K1",
      start: "2026-07-14", days: 12, titer: 2.94, peakVCD: 13.2, status: "진행중", team: "배양공정팀" }
  ];

  /* -- Materials (정제 물질 / DS·DP) ------------------------------------- */
  const MATERIALS = [
    { id: "P2508-01A", batch: "B2508-01", type: "DS", ko: "정제 원액", steps: 5,
      yield: 68.4, hcp: 6.2, hcd: 0.8, monomer: 99.24, date: "2026-05-30", status: "분석완료", team: "정제공정팀" },
    { id: "P2509-03A", batch: "B2509-03", type: "DS", ko: "정제 원액", steps: 5,
      yield: 65.1, hcp: 8.7, hcd: 1.1, monomer: 98.91, date: "2026-06-26", status: "분석완료", team: "정제공정팀" },
    { id: "D2509-03B", batch: "B2509-03", type: "DP", ko: "완제 의약품", steps: 2,
      yield: 96.2, hcp: 8.9, hcd: 1.1, monomer: 98.85, date: "2026-07-02", status: "분석완료", team: "정제공정팀" },
    { id: "P2606-02A", batch: "B2606-02", type: "DS", ko: "정제 원액", steps: 5,
      yield: 61.8, hcp: 11.4, hcd: 1.6, monomer: 98.42, date: "2026-07-10", status: "분석중", team: "정제공정팀" }
  ];

  /* -- Daily culture data ------------------------------------------------
     Generated from a logistic growth + decline profile so the curves are
     internally consistent rather than hand-typed noise. */
  function cultureSeries(peakVCD, finalTiter, days) {
    const rows = [];
    for (let d = 0; d <= days; d++) {
      const g = peakVCD / (1 + Math.exp(-0.72 * (d - 6.2)));
      const decline = d > 9 ? Math.pow(0.93, d - 9) : 1;
      const vcd = +(g * decline).toFixed(2);
      const via = +Math.max(52, 98.5 - Math.pow(Math.max(0, d - 6), 2.05) * 0.62).toFixed(1);
      const titer = +(finalTiter / (1 + Math.exp(-0.62 * (d - 8.4)))).toFixed(2);
      const glc = +Math.max(1.1, 5.8 - d * 0.42 + (d % 3 === 0 ? 1.6 : 0)).toFixed(2);
      const lac = +Math.min(2.6, 0.28 + d * 0.17 - (d > 8 ? (d - 8) * 0.12 : 0)).toFixed(2);
      rows.push({
        day: d, vcd, via, titer, glc, lac,
        ph: +(7.02 - (d > 7 ? (d - 7) * 0.012 : 0)).toFixed(2),
        do2: +(41 + Math.sin(d * 1.1) * 2.4).toFixed(1)
      });
    }
    return rows;
  }

  const CULTURE = {};
  BATCHES.forEach(b => { CULTURE[b.id] = cultureSeries(b.peakVCD, b.titer, b.days); });

  /* -- Purification step data -------------------------------------------- */
  const PURIF = {
    "P2508-01A": [
      { step: "Protein A",            ko: "친화 크로마토그래피", yieldPct: 92.4, hcp: 842,  hcd: 118,  monomer: 96.2 },
      { step: "Low pH inactivation",  ko: "바이러스 불활화",     yieldPct: 98.8, hcp: 838,  hcd: 96,   monomer: 96.0 },
      { step: "CEX",                  ko: "양이온 교환",         yieldPct: 88.1, hcp: 47,   hcd: 12,   monomer: 98.4 },
      { step: "AEX",                  ko: "음이온 교환",         yieldPct: 95.3, hcp: 9.1,  hcd: 2.1,  monomer: 99.1 },
      { step: "UF/DF",                ko: "한외여과/정용여과",   yieldPct: 96.7, hcp: 6.2,  hcd: 0.8,  monomer: 99.24 }
    ],
    "P2509-03A": [
      { step: "Protein A",           ko: "친화 크로마토그래피", yieldPct: 90.8, hcp: 1024, hcd: 141, monomer: 95.7 },
      { step: "Low pH inactivation", ko: "바이러스 불활화",     yieldPct: 98.2, hcp: 1011, hcd: 122, monomer: 95.6 },
      { step: "CEX",                 ko: "양이온 교환",         yieldPct: 86.4, hcp: 62,   hcd: 15,  monomer: 98.1 },
      { step: "AEX",                 ko: "음이온 교환",         yieldPct: 94.1, hcp: 12.4, hcd: 2.8, monomer: 98.8 },
      { step: "UF/DF",               ko: "한외여과/정용여과",   yieldPct: 95.9, hcp: 8.7,  hcd: 1.1, monomer: 98.91 }
    ],
    "P2606-02A": [
      { step: "Protein A",           ko: "친화 크로마토그래피", yieldPct: 89.2, hcp: 1186, hcd: 163, monomer: 95.1 },
      { step: "Low pH inactivation", ko: "바이러스 불활화",     yieldPct: 97.9, hcp: 1174, hcd: 140, monomer: 95.0 },
      { step: "CEX",                 ko: "양이온 교환",         yieldPct: 84.7, hcp: 78,   hcd: 19,  monomer: 97.6 },
      { step: "AEX",                 ko: "음이온 교환",         yieldPct: 93.2, hcp: 15.8, hcd: 3.4, monomer: 98.3 },
      { step: "UF/DF",               ko: "한외여과/정용여과",   yieldPct: 95.1, hcp: 11.4, hcd: 1.6, monomer: 98.42 }
    ],
    "D2509-03B": [
      { step: "제형화 · Formulation", ko: "제형화",   yieldPct: 98.4, hcp: 8.8, hcd: 1.1, monomer: 98.88 },
      { step: "무균 충전 · Fill",     ko: "무균 충전", yieldPct: 97.8, hcp: 8.9, hcd: 1.1, monomer: 98.85 }
    ]
  };

  /* -- Bioanalysis results ----------------------------------------------- */
  const ANALYSIS = {
    "P2508-01A": [
      { item: "SEC — Monomer",      val: "99.24", unit: "%",     spec: "≥ 95.0",     pass: true },
      { item: "CE-SDS (NR) — Purity", val: "98.1", unit: "%",    spec: "≥ 95.0",     pass: true },
      { item: "icIEF — Main peak",  val: "62.4",  unit: "%",     spec: "55.0–70.0",  pass: true },
      { item: "HCP",                val: "6.2",   unit: "ng/mg", spec: "≤ 100",      pass: true },
      { item: "Residual DNA",       val: "0.8",   unit: "pg/mg", spec: "≤ 10",       pass: true },
      { item: "Potency (상대역가)",  val: "104",   unit: "%",     spec: "80–125",     pass: true },
      { item: "Endotoxin",          val: "< 0.05", unit: "EU/mg", spec: "≤ 0.5",     pass: true },
      { item: "Bioburden",          val: "0",     unit: "CFU/10mL", spec: "≤ 1",     pass: true }
    ],
    "P2509-03A": [
      { item: "SEC — Monomer",      val: "98.91", unit: "%",     spec: "≥ 95.0",     pass: true },
      { item: "CE-SDS (NR) — Purity", val: "97.6", unit: "%",    spec: "≥ 95.0",     pass: true },
      { item: "icIEF — Main peak",  val: "60.1",  unit: "%",     spec: "55.0–70.0",  pass: true },
      { item: "HCP",                val: "8.7",   unit: "ng/mg", spec: "≤ 100",      pass: true },
      { item: "Residual DNA",       val: "1.1",   unit: "pg/mg", spec: "≤ 10",       pass: true },
      { item: "Potency (상대역가)",  val: "97",    unit: "%",     spec: "80–125",     pass: true },
      { item: "Endotoxin",          val: "< 0.05", unit: "EU/mg", spec: "≤ 0.5",     pass: true },
      { item: "Bioburden",          val: "0",     unit: "CFU/10mL", spec: "≤ 1",     pass: true }
    ],
    "P2606-02A": [
      { item: "SEC — Monomer",      val: "98.42", unit: "%",     spec: "≥ 95.0",     pass: true },
      { item: "CE-SDS (NR) — Purity", val: "96.4", unit: "%",    spec: "≥ 95.0",     pass: true },
      { item: "icIEF — Main peak",  val: "53.8",  unit: "%",     spec: "55.0–70.0",  pass: false },
      { item: "HCP",                val: "11.4",  unit: "ng/mg", spec: "≤ 100",      pass: true },
      { item: "Residual DNA",       val: "1.6",   unit: "pg/mg", spec: "≤ 10",       pass: true },
      { item: "Potency (상대역가)",  val: "91",    unit: "%",     spec: "80–125",     pass: true },
      { item: "Endotoxin",          val: "< 0.05", unit: "EU/mg", spec: "≤ 0.5",     pass: true },
      { item: "Bioburden",          val: "0",     unit: "CFU/10mL", spec: "≤ 1",     pass: true }
    ],
    "D2509-03B": [
      { item: "SEC — Monomer",      val: "98.85", unit: "%",     spec: "≥ 95.0",  pass: true },
      { item: "함량 · Content",      val: "50.4",  unit: "mg/mL", spec: "45–55",   pass: true },
      { item: "pH",                 val: "6.02",  unit: "—",     spec: "5.8–6.2", pass: true },
      { item: "삼투압 · Osmolality", val: "302",   unit: "mOsm/kg", spec: "270–330", pass: true },
      { item: "가시이물 · Visible particles", val: "적합", unit: "—", spec: "적합", pass: true },
      { item: "Endotoxin",          val: "< 0.05", unit: "EU/mg", spec: "≤ 0.5",  pass: true }
    ]
  };

  /* -- Schedule ----------------------------------------------------------- */
  const GANTT = [
    { prj: "PRJ-2025-003", ko: "유사성 평가 배양 (200L ×3)", start: 0.0, end: 3.2, color: "var(--c-accent)" },
    { prj: "PRJ-2025-003", ko: "정제 및 DS 생산",            start: 2.8, end: 5.4, color: "#6D28D9" },
    { prj: "PRJ-2025-003", ko: "바이오분석 (전항목)",         start: 5.0, end: 7.1, color: "#0F766E" },
    { prj: "PRJ-2025-003", ko: "종합 보고서 · QA EDMS",       start: 6.8, end: 8.4, color: "#15803D" },
    { prj: "PRJ-2024-011", ko: "정제 스케일업 (50L)",         start: 3.4, end: 6.6, color: "var(--c-accent)" },
    { prj: "PRJ-2024-011", ko: "안정성 시험 (6개월)",         start: 6.2, end: 12.0, color: "#B45309" },
    { prj: "PRJ-2025-014", ko: "초기 배양 조건 확립",         start: 7.0, end: 10.2, color: "var(--c-accent)" },
    { prj: "PRJ-2025-014", ko: "IND 제출 준비",              start: 9.8, end: 12.0, color: "#B91C1C" }
  ];
  const GANTT_MONTHS = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
  const GANTT_TODAY = 6.83;   // late July

  const TASKS_TODAY = [
    { ko: "B2607-01 Day 12 시료 채취 및 Titer 측정", due: "오늘 14:00", done: false, kind: "배양" },
    { ko: "P2606-02A icIEF 재분석 의뢰 (규격 이탈)",  due: "오늘 17:00", done: false, kind: "분석" },
    { ko: "DB-3115 EMA 보완자료 초안 검토",           due: "오늘",       done: true,  kind: "규제" },
    { ko: "주간 공정개발 회의 자료 준비",             due: "내일 10:00", done: false, kind: "회의" }
  ];

  const TASKS_SHORT = [
    { ko: "B2607-01 배양 종료 예정",       date: "2026-07-28", kind: "배양", color: "var(--c-accent-mid)" },
    { ko: "P2607-01A 정제 착수",           date: "2026-07-29", kind: "정제", color: "#6D28D9" },
    { ko: "공정개발팀 주간 회의",          date: "2026-07-30", kind: "회의", color: "var(--c-text-mute)" },
    { ko: "P2606-02A 분석 결과 리뷰",      date: "2026-07-31", kind: "분석", color: "#0F766E" },
    { ko: "8월 배양 스케줄 확정",          date: "2026-08-01", kind: "계획", color: "#B45309" }
  ];

  /* -- AI canned responses ------------------------------------------------
     Keyword-matched, not generated. See ai.js. */
  const AI_ANSWERS = [
    {
      match: ["titer", "3.5", "ph", "do", "배양", "조건"],
      q: "2024년 이후 배양 중 Titer 3.5 g/L 이상 나온 pH/DO 조건 요약",
      answer: "조건을 만족하는 배치는 <b>3건</b>입니다 (B2508-01 4.12, B2509-03 3.86, B2606-02 3.41 g/L — B2606-02는 기준 미달).\n\n3.5 g/L 이상 2건의 공통 조건은 <b>pH 7.00±0.02, DO 40±3%</b>이며, 두 배치 모두 Day 6–7에 피크 VCD에 도달했습니다. Titer가 가장 높았던 B2508-01은 피크 VCD가 17.4×10⁶ cells/mL로 가장 높았고, 생존율 80% 도달 시점이 다른 배치보다 1.5일 늦었습니다.",
      cites: ["B2508-01", "B2509-03", "B2606-02"]
    },
    {
      match: ["hcp", "정제", "불순물", "impurity"],
      q: "정제 공정별 HCP 제거 성능 비교",
      answer: "HCP 제거는 <b>CEX 단계</b>에서 가장 크게 일어납니다 (평균 94.2% 감소, 1017 → 62 ng/mg).\n\n최종 HCP는 P2508-01A 6.2, P2509-03A 8.7, P2606-02A 11.4 ng/mg로 모두 규격(≤100) 이내이나, <b>P2606-02A는 Protein A 부하량이 높아</b> 초기 HCP가 1186 ng/mg로 가장 높았고 이것이 최종값 차이로 이어졌습니다.",
      cites: ["P2508-01A", "P2509-03A", "P2606-02A"]
    },
    {
      match: ["규격", "이탈", "ooS", "실패", "부적합"],
      q: "최근 규격 이탈 항목",
      answer: "최근 분석에서 규격을 벗어난 항목은 <b>1건</b>입니다.\n\n<b>P2606-02A · icIEF Main peak 53.8%</b> (규격 55.0–70.0%). 동일 물질의 다른 항목은 모두 적합이며, 상대역가도 91%로 규격 내입니다. 산성 변이체 증가가 원인일 가능성이 있어 재분석이 의뢰된 상태입니다.",
      cites: ["P2606-02A"]
    }
  ];

  const AI_RECS = [
    { score: 94, ko: "B2308 배치와 공정 조건 유사", detail: "pH·DO·Feed 프로파일이 현재 진행 중인 B2607-01과 94% 일치. 해당 배치는 Day 14 Titer 3.78 g/L 달성.", target: "B2508-01" },
    { score: 88, ko: "P2606-02A와 유사한 icIEF 이탈 사례", detail: "2025년 P2411-02A에서 동일 항목이 54.1%로 이탈했으며, CEX 용출 pH를 5.6 → 5.8로 조정해 해소됨.", target: "P2606-02A" },
    { score: 81, ko: "DoE 재사용 가능 설계", detail: "PRJ-2024-011의 Box-Behnken 설계(pH·Temp·Feed)가 현재 과제 요인과 동일. Run Table 재사용 가능.", target: "doe" }
  ];

  return {
    PROJECTS, PLANS, REPORTS, BATCHES, MATERIALS,
    CULTURE, PURIF, ANALYSIS,
    GANTT, GANTT_MONTHS, GANTT_TODAY, TASKS_TODAY, TASKS_SHORT,
    AI_ANSWERS, AI_RECS
  };
})();
