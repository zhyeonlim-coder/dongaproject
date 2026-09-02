/* ==========================================================================
   Bio Knowledge Hub — sample dataset

   ⚠ ALL DATA BELOW IS ILLUSTRATIVE AND FICTIONAL.
   Compound codes, trial numbers, enrolment figures and submission dates are
   invented for design demonstration. They do not describe Dong-A ST's real
   pipeline, and must be replaced with a real data source before any use
   beyond design review.
   ========================================================================== */

window.HUB = (function () {
  "use strict";

  /* -- Roles ------------------------------------------------------------- */
  /* perms — 무엇을 바꿀 수 있는가.

     규격(spec:write)은 Pass/Fail 판정의 기준이고 그 판정은 규제 문서에
     실립니다. 로그인한 누구나 고칠 수 있으면 기준 자체에 근거가 없어집니다.
     그래서 읽기는 전원, 쓰기는 규제업무만입니다.

     ⚠ 이것은 화면 통제입니다. 서버가 없으므로 실제 접근 통제가 아닙니다 —
       auth.js 와 같은 한계이고, 서버를 붙일 때 함께 옮겨야 합니다. */
  const ROLES = {
    research: {
      id: "research",
      ko: "연구개발", en: "R&D Scientist",
      scope: ["pipeline", "literature", "assays"],
      perms: ["spec:read"],
      landing: "연구 중심 뷰"
    },
    medical: {
      id: "medical",
      ko: "메디컬 어페어스", en: "Medical Affairs",
      scope: ["trials", "literature", "publications"],
      perms: ["spec:read"],
      landing: "임상 중심 뷰"
    },
    regulatory: {
      id: "regulatory",
      ko: "규제업무", en: "Regulatory Affairs",
      scope: ["submissions", "dossiers", "pipeline"],
      perms: ["spec:read", "spec:write"],
      landing: "허가 중심 뷰"
    }
  };

  /* -- Demo accounts ----------------------------------------------------- */
  const USERS = [
    { email: "s.park@donga-st.demo",  name: "박서연", nameEn: "Seoyeon Park",  initials: "박", role: "research",   dept: "신약연구소 · Discovery Biology" },
    { email: "j.kim@donga-st.demo",   name: "김준호", nameEn: "Junho Kim",     initials: "김", role: "medical",    dept: "메디컬본부 · Medical Affairs" },
    { email: "h.lee@donga-st.demo",   name: "이하은", nameEn: "Haeun Lee",     initials: "이", role: "regulatory", dept: "개발본부 · Regulatory Affairs" }
  ];

  const DEMO_PASSWORD = "hub2026";

  /* -- Pipeline gates ---------------------------------------------------- */
  /* `abbr` keeps the gate meta on a single line at narrow column widths —
     a wrapped label staggers every chip in that column. */
  const GATES = [
    { id: "discovery", ko: "탐색",     en: "Discovery",   abbr: "DISC",   color: "var(--p-discovery)" },
    { id: "preclin",   ko: "비임상",   en: "Preclinical", abbr: "PRECL",  color: "var(--p-preclin)" },
    { id: "ph1",       ko: "임상 1상", en: "Phase 1",     abbr: "PH 1",   color: "var(--p-ph1)" },
    { id: "ph2",       ko: "임상 2상", en: "Phase 2",     abbr: "PH 2",   color: "var(--p-ph2)" },
    { id: "ph3",       ko: "임상 3상", en: "Phase 3",     abbr: "PH 3",   color: "var(--p-ph3)" },
    { id: "filed",     ko: "허가신청", en: "Filed",       abbr: "FILED",  color: "var(--p-filed)" },
    { id: "market",    ko: "시판",     en: "Marketed",    abbr: "MARKET", color: "var(--p-market)" }
  ];

  /* -- Compounds (fictional) --------------------------------------------- */
  const COMPOUNDS = [
    { code: "DA-4417", ko: "대사질환 후보물질",   en: "Metabolic candidate",     gate: "discovery", area: "Metabolic",  updated: "2026-07-22", lead: "박서연" },
    { code: "DA-4402", ko: "섬유증 후보물질",     en: "Fibrosis candidate",      gate: "discovery", area: "Fibrosis",   updated: "2026-07-18", lead: "박서연" },
    { code: "DA-3908", ko: "항암 표적물질",       en: "Oncology target",         gate: "preclin",   area: "Oncology",   updated: "2026-07-24", lead: "정민우" },
    { code: "DA-3871", ko: "면역조절 후보",       en: "Immunomodulator",         gate: "preclin",   area: "Immunology", updated: "2026-07-11", lead: "정민우" },
    { code: "DA-2255", ko: "비만 치료 후보",      en: "Obesity candidate",       gate: "ph1",       area: "Metabolic",  updated: "2026-07-25", lead: "김준호" },
    { code: "DA-2130", ko: "신경병증성 통증",     en: "Neuropathic pain",        gate: "ph1",       area: "CNS",        updated: "2026-06-30", lead: "김준호" },
    { code: "DA-1809", ko: "제2형 당뇨 병용요법", en: "T2DM combination",        gate: "ph2",       area: "Metabolic",  updated: "2026-07-21", lead: "김준호" },
    { code: "DA-1642", ko: "만성 신질환",         en: "Chronic kidney disease",  gate: "ph2",       area: "Renal",      updated: "2026-07-09", lead: "이하은" },
    { code: "DA-1205", ko: "골관절염 주사제",     en: "Osteoarthritis inject.",  gate: "ph3",       area: "Musculo.",   updated: "2026-07-23", lead: "이하은" },
    { code: "DB-3115", ko: "바이오시밀러 (자가면역)", en: "Biosimilar (autoimmune)", gate: "filed", area: "Biosimilar", updated: "2026-07-19", lead: "이하은" },
    { code: "DA-0977", ko: "성장호르몬 제제",     en: "Growth hormone",          gate: "market",    area: "Endocrine",  updated: "2026-05-14", lead: "—" },
    { code: "DA-0812", ko: "항생제 정제",         en: "Antibiotic tablet",       gate: "market",    area: "Anti-infect.", updated: "2026-04-02", lead: "—" }
  ];

  /* -- KPIs -------------------------------------------------------------- */
  const KPIS = [
    { label_ko: "활성 프로그램",   label_en: "Active programmes", value: "12",   delta: "+2",    dir: "up",   note: "지난 분기 대비" },
    { label_ko: "진행 중 임상",    label_en: "Ongoing trials",    value: "7",    delta: "+1",    dir: "up",   note: "3개 기관 신규" },
    { label_ko: "신규 문헌",       label_en: "New literature",    value: "148",  delta: "+31",   dir: "up",   note: "최근 7일" },
    { label_ko: "허가 대응 건",    label_en: "Open submissions",  value: "4",    delta: "-1",    dir: "down", note: "1건 승인 완료" }
  ];

  /* -- Trial enrolment (12 months, fictional) ---------------------------- */
  const ENROLMENT = {
    months: ["8월","9월","10월","11월","12월","1월","2월","3월","4월","5월","6월","7월"],
    target: [40, 80, 130, 180, 240, 300, 360, 420, 470, 520, 570, 620],
    actual: [32, 71, 118, 165, 229, 284, 351, 402, 461, 498, 553, 601]
  };

  /* -- Therapeutic split ------------------------------------------------- */
  const AREAS = [
    { ko: "대사질환", en: "Metabolic",   n: 4, color: "var(--p-ph2)" },
    { ko: "항암",     en: "Oncology",    n: 2, color: "var(--p-ph3)" },
    { ko: "면역",     en: "Immunology",  n: 2, color: "var(--p-preclin)" },
    { ko: "신경계",   en: "CNS",         n: 1, color: "var(--p-ph1)" },
    { ko: "기타",     en: "Other",       n: 3, color: "var(--p-discovery)" }
  ];

  /* -- Literature feed --------------------------------------------------- */
  const LITERATURE = [
    { title_ko: "GLP-1/GIP 이중작용제의 대사 지표 개선 효과", title_en: "Dual GLP-1/GIP agonism and metabolic endpoints",
      src: "Nature Metabolism", date: "2026-07-25", tag: "Metabolic", tagType: "info", saved: true },
    { title_ko: "간 섬유증 바이오마커의 임상적 유용성 검토",   title_en: "Clinical utility of hepatic fibrosis biomarkers",
      src: "J Hepatology", date: "2026-07-24", tag: "Fibrosis", tagType: "warn", saved: false },
    { title_ko: "바이오시밀러 상호교환성 규제 동향 (FDA)",     title_en: "FDA interchangeability guidance update",
      src: "Regulatory Focus", date: "2026-07-23", tag: "Regulatory", tagType: "risk", saved: true },
    { title_ko: "만성 신질환 환자의 신기능 저하 예측 모델",     title_en: "Predicting eGFR decline in CKD",
      src: "Kidney Int", date: "2026-07-22", tag: "Renal", tagType: "info", saved: false },
    { title_ko: "골관절염 국소 주사요법 메타분석",             title_en: "Intra-articular therapy: a meta-analysis",
      src: "Osteoarthr Cartil", date: "2026-07-21", tag: "Musculo.", tagType: "ok", saved: false }
  ];

  /* -- Regulatory submissions -------------------------------------------- */
  const SUBMISSIONS = [
    { code: "DB-3115", region_ko: "유럽", region_en: "EMA",  type: "MAA",       status: "심사 중",   statusEn: "Under review", badge: "warn", due: "2026-09-30", owner: "이하은", pct: 68 },
    { code: "DB-3115", region_ko: "미국", region_en: "FDA",  type: "351(k) BLA", status: "보완 요청", statusEn: "Info request", badge: "risk", due: "2026-08-14", owner: "이하은", pct: 42 },
    { code: "DA-1205", region_ko: "국내", region_en: "MFDS", type: "품목허가",   status: "제출 준비", statusEn: "Preparing",    badge: "info", due: "2026-10-21", owner: "최지훈", pct: 25 },
    { code: "DA-1809", region_ko: "국내", region_en: "MFDS", type: "IND 변경",   status: "승인 완료", statusEn: "Approved",     badge: "ok",   due: "2026-07-08", owner: "최지훈", pct: 100 }
  ];

  /* -- Knowledge collections --------------------------------------------- */
  const COLLECTIONS = [
    { ko: "대사질환 연구 아카이브", en: "Metabolic archive", n: 412, icon: "layers" },
    { ko: "임상시험 프로토콜",      en: "Trial protocols",   n: 87,  icon: "file" },
    { ko: "규제 가이드라인",        en: "Regulatory guides", n: 156, icon: "shield" },
    { ko: "내부 실험 리포트",       en: "Internal reports",  n: 1204, icon: "flask" }
  ];

  return {
    ROLES, USERS, DEMO_PASSWORD, GATES, COMPOUNDS,
    KPIS, ENROLMENT, AREAS, LITERATURE, SUBMISSIONS, COLLECTIONS
  };
})();
