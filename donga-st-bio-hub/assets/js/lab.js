/* ==========================================================================
   Lab reference data — projects, studies, equipment, specs, literature

   ⚠ ALL DATA IS FICTIONAL. Project codes, batch numbers, equipment IDs and
   analytical values are invented for design demonstration. Value ranges are
   plausible for CHO fed-batch mAb work so charts read realistically; they
   describe no real Dong-A ST process.
   ========================================================================== */

window.LAB = (function () {
  "use strict";

  /* ── Projects ────────────────────────────────────────────────────────── */
  const PROJECTS = [
    { id: "DA-3880", ko: "DA-3880 바이오시밀러 (자가면역)", en: "Biosimilar",
      area: "Biosimilar", lead: "이하은", stage: "공정개발", molecule: "IgG1 mAb" },
    { id: "DA-2255", ko: "DA-2255 비만 치료 후보", en: "Obesity candidate",
      area: "Metabolic", lead: "박서연", stage: "임상 1상", molecule: "Fc-fusion" },
    { id: "DA-1809", ko: "DA-1809 제2형 당뇨 병용요법", en: "T2DM combination",
      area: "Metabolic", lead: "김준호", stage: "임상 2상", molecule: "Peptide" }
  ];

  /* ── Studies ──────────────────────────────────────────────────────────
     A study is the unit of integration. `teams` declares which departments
     contribute, so the dashboard knows which of the three columns to expect
     data in — an empty column then reads as "아직 미제출", not "해당 없음". */
  const STUDIES = [
    { id: "ST-01", prj: "DA-3880", no: 1,
      ko: "pH Range & Shift 스터디", en: "pH Range & Shift Study",
      lead: "배양공정팀", teams: ["culture", "purif", "analysis"],
      objective: "배양 pH 설정값과 시프트 시점이 역가·전하 이형체에 미치는 영향을 규명하고 설계공간(Design Space)을 정의한다.",
      factors: "pH 설정값 (6.8 / 7.0 / 7.2), 시프트 시점 (없음 / Day 5)",
      start: "2026-05-04", end: "2026-08-14", status: "진행중" },

    { id: "ST-02", prj: "DA-3880", no: 2,
      ko: "Column 결합용량 최적화", en: "Column Binding Capacity Optimization",
      lead: "정제공정팀", teams: ["purif", "analysis"],
      objective: "Protein A 체류시간과 부하량에 따른 동적결합용량(DBC)과 불순물 제거 성능의 균형점을 찾는다.",
      factors: "체류시간 (4 / 6 / 8 min), 부하량 (40 / 50 / 60 g/L resin)",
      start: "2026-06-15", end: "2026-09-05", status: "진행중" },

    { id: "ST-03", prj: "DA-3880", no: 3,
      ko: "전하 이형체 특성분석", en: "Charge Variant Characterisation",
      lead: "바이오분석팀", teams: ["analysis"],
      objective: "CEX 전하 이형체 분획의 온전질량과 결합친화도를 확인해 유사성 평가 근거를 확보한다.",
      factors: "분획 (Acidic / Main / Basic)",
      start: "2026-07-06", end: "2026-10-16", status: "진행중" },

    { id: "ST-04", prj: "DA-2255", no: 1,
      ko: "초기 배양 조건 확립", en: "Initial Culture Conditions",
      lead: "배양공정팀", teams: ["culture"],
      objective: "후보물질 초기 배양 조건을 확립한다.",
      factors: "온도, Feed 전략",
      start: "2026-06-01", end: "2026-09-30", status: "진행중" },

    { id: "ST-05", prj: "DA-1809", no: 1,
      ko: "정제 스케일업", en: "Purification Scale-up",
      lead: "정제공정팀", teams: ["purif"],
      objective: "50 L 규모 정제 공정을 확립한다.",
      factors: "컬럼 직경, 유속",
      start: "2026-04-13", end: "2026-08-28", status: "진행중" }
  ];

  /* ── Study arms — the actual integration spine ─────────────────────────
     One arm = one experimental condition, carrying its own batch → purification
     run → analyses. This is what lets the dashboard show all three teams'
     results for a single condition side by side without anyone being asked. */
  const ARMS = [
    // ST-01 pH Range & Shift
    { id: "ST-01-A", study: "ST-01", label: "pH 6.8 고정", cond: { pH: "6.8", shift: "없음" },
      batch: "B2401", purif: "P2401-A", analyses: ["A2401-01", "A2401-03"] },
    { id: "ST-01-B", study: "ST-01", label: "pH 7.0 고정", cond: { pH: "7.0", shift: "없음" },
      batch: "B2402", purif: "P2402-A", analyses: ["A2402-01", "A2402-04"] },
    { id: "ST-01-C", study: "ST-01", label: "pH 7.0 → 6.8 (D5)", cond: { pH: "7.0→6.8", shift: "Day 5" },
      batch: "B2403", purif: null, analyses: [] },

    // ST-02 Column Binding Capacity — same feed (B2402), varying column conditions
    { id: "ST-02-A", study: "ST-02", label: "RT 4 min · 40 g/L", cond: { rt: "4 min", load: "40 g/L" },
      batch: "B2402", purif: "P2402-B", analyses: ["A2402-02", "A2402-03"] },
    { id: "ST-02-B", study: "ST-02", label: "RT 6 min · 50 g/L", cond: { rt: "6 min", load: "50 g/L" },
      batch: "B2402", purif: "P2402-C", analyses: ["A2402-07"] },
    { id: "ST-02-C", study: "ST-02", label: "RT 8 min · 60 g/L", cond: { rt: "8 min", load: "60 g/L" },
      batch: "B2402", purif: "P2402-D", analyses: ["A2402-08"] },

    // ST-03 Charge Variant Characterisation — fractions of one CEX separation
    { id: "ST-03-A", study: "ST-03", label: "Acidic 분획", cond: { fraction: "Acidic" },
      batch: null, purif: "P2402-B", analyses: ["A2402-05", "A2402-09"] },
    { id: "ST-03-B", study: "ST-03", label: "Main 분획", cond: { fraction: "Main" },
      batch: null, purif: "P2402-B", analyses: ["A2402-06", "A2402-10"] }
  ];

  /* ── Departments ─────────────────────────────────────────────────────── */
  const DEPTS = {
    culture:  { id: "culture",  ko: "배양공정팀", en: "Cultivation",  color: "var(--c-accent)",  short: "배양" },
    purif:    { id: "purif",    ko: "정제공정팀", en: "Purification", color: "#6D28D9",          short: "정제" },
    analysis: { id: "analysis", ko: "바이오분석팀", en: "Bioanalysis", color: "#0F766E",         short: "분석" }
  };

  /* ── Specifications — drives the PASS / OOS badge ────────────────────── */
  const SPECS = {
    // key: [min, max, unit, label]  (null = unbounded)
    "SEC_monomer":  { min: 95.0, max: null, unit: "%",     ko: "SEC-HPLC Monomer",  en: "SEC monomer" },
    "SEC_hmw":      { min: null, max: 4.0,  unit: "%",     ko: "SEC-HPLC HMW",      en: "High MW species" },
    "CEX_main":     { min: 55.0, max: 70.0, unit: "%",     ko: "CEX Main Peak",     en: "CEX main peak" },
    "CEX_acidic":   { min: null, max: 30.0, unit: "%",     ko: "CEX Acidic",        en: "Acidic variants" },
    "SDS_purity":   { min: 95.0, max: null, unit: "%",     ko: "SDS-PAGE Purity",   en: "SDS-PAGE purity" },
    "HCP":          { min: null, max: 100,  unit: "ng/mg", ko: "HCP",               en: "Host cell protein" },
    "HCD":          { min: null, max: 10,   unit: "pg/mg", ko: "잔류 DNA (HCD)",    en: "Residual DNA" },
    "Potency":      { min: 80,   max: 125,  unit: "%",     ko: "상대역가",           en: "Relative potency" },
    "G0F":          { min: 35.0, max: 55.0, unit: "%",     ko: "N-glycan G0F",      en: "G0F" },
    "G1F":          { min: 25.0, max: 45.0, unit: "%",     ko: "N-glycan G1F",      en: "G1F" },
    "Afucosylation":{ min: null, max: 8.0,  unit: "%",     ko: "Afucosylation",     en: "Afucosylation" },

    /* Analytics package requested in the brief */
    "CEX_basic":    { min: null, max: 15.0, unit: "%",     ko: "CEX Basic",         en: "Basic variants" },
    "Mass_delta":   { min: null, max: 30,   unit: "ppm",   ko: "Intact Mass 편차",  en: "Intact mass Δ" },
    "Mass_obs":     { min: null, max: null, unit: "Da",    ko: "Intact Mass 실측",  en: "Observed mass" },
    "KD":           { min: 0.8,  max: 2.5,  unit: "nM",    ko: "결합친화도 K_D",     en: "Binding affinity" },
    "DBC":          { min: 35,   max: null, unit: "g/L",   ko: "동적결합용량 DBC",   en: "Dynamic binding capacity" }
  };

  function judge(key, value) {
    const s = SPECS[key];
    if (!s || value === "" || value == null || !isFinite(+value)) return null;
    const v = +value;
    const okMin = s.min == null || v >= s.min;
    const okMax = s.max == null || v <= s.max;
    return { pass: okMin && okMax, spec: specText(key), unit: s.unit };
  }

  function specText(key) {
    const s = SPECS[key];
    if (!s) return "—";
    if (s.min != null && s.max != null) return s.min + "–" + s.max;
    if (s.min != null) return "≥ " + s.min;
    if (s.max != null) return "≤ " + s.max;
    return "—";
  }

  /* ── Equipment ───────────────────────────────────────────────────────── */
  const EQUIPMENT = [
    { id: "BR-101",  dept: "culture",  ko: "5L Bioreactor",       model: "Sartorius Biostat B", loc: "배양실 A", slotMin: 60 },
    { id: "BR-102",  dept: "culture",  ko: "10L Bioreactor",      model: "Sartorius Biostat B", loc: "배양실 A", slotMin: 60 },
    { id: "BR-103",  dept: "culture",  ko: "10L Bioreactor",      model: "Applikon ez-Control", loc: "배양실 B", slotMin: 60 },
    { id: "AKTA-201", dept: "purif",   ko: "AKTA Avant 25",       model: "Cytiva",              loc: "정제실",   slotMin: 60 },
    { id: "AKTA-202", dept: "purif",   ko: "AKTA Pure",           model: "Cytiva",              loc: "정제실",   slotMin: 60 },
    { id: "BT3035", dept: "analysis",  ko: "SEC-HPLC",            model: "Agilent 1260",        loc: "분석실 1", slotMin: 60 },
    { id: "BT3036", dept: "analysis",  ko: "CEX-HPLC",            model: "Agilent 1260",        loc: "분석실 1", slotMin: 60 },
    { id: "MS-401", dept: "analysis",  ko: "Mass Spectrometer",   model: "Thermo Q Exactive",   loc: "분석실 2", slotMin: 120 }
  ];

  /* ── Seed batches for DA-3880 ────────────────────────────────────────── */
  const BATCHES = [
    { id: "B2401", prj: "DA-3880", study: "ST-01", scale: "5 L",  cell: "CHO-K1", inoc: "2026-07-08",
      days: 14, titer: 3.62, peakVCD: 16.8, viability: 78.4, status: "완료", equip: "BR-101",
      pH: 6.8, do2: 40, temp: 36.5, shift: null },
    { id: "B2402", prj: "DA-3880", study: "ST-01", scale: "5 L",  cell: "CHO-K1", inoc: "2026-07-14",
      days: 14, titer: 4.05, peakVCD: 18.1, viability: 81.2, status: "완료", equip: "BR-102",
      pH: 7.0, do2: 40, temp: 36.5, shift: null },
    { id: "B2403", prj: "DA-3880", study: "ST-01", scale: "10 L", cell: "CHO-K1", inoc: "2026-07-21",
      days: 7,  titer: 1.84, peakVCD: 12.9, viability: 94.1, status: "진행중", equip: "BR-102",
      pH: 7.0, do2: 40, temp: 36.5, shift: { day: 5, to: 6.8, what: "pH" } }
  ];

  /* DO / pH shift log — discrete process events, kept separate from the daily
     trend because they are operator actions, not measurements. */
  const SHIFTS = [
    { batch: "B2403", day: 5, param: "pH",   from: 7.0,  to: 6.8,  by: "박서연", note: "계획된 시프트" },
    { batch: "B2403", day: 6, param: "DO",   from: 40,   to: 35,   by: "박서연", note: "산소 요구량 감소 대응" },
    { batch: "B2402", day: 7, param: "Temp", from: 36.5, to: 34.0, by: "정민우", note: "온도 시프트 (생존율 유지)" }
  ];

  /* Daily culture profile — logistic growth so curves stay self-consistent. */
  function cultureSeries(peakVCD, finalTiter, days) {
    const rows = [];
    for (let d = 0; d <= days; d++) {
      const g = peakVCD / (1 + Math.exp(-0.72 * (d - 6.2)));
      const decline = d > 9 ? Math.pow(0.93, d - 9) : 1;
      rows.push({
        day: d,
        vcd: +(g * decline).toFixed(2),
        via: +Math.max(52, 98.5 - Math.pow(Math.max(0, d - 6), 2.05) * 0.62).toFixed(1),
        titer: +(finalTiter / (1 + Math.exp(-0.62 * (d - 8.4)))).toFixed(2),
        glc: +Math.max(1.1, 5.8 - d * 0.42 + (d % 3 === 0 ? 1.6 : 0)).toFixed(2),
        ph: +(7.02 - (d > 7 ? (d - 7) * 0.012 : 0)).toFixed(2),
        do2: +(41 + Math.sin(d * 1.1) * 2.4).toFixed(1),
        temp: 36.5
      });
    }
    return rows;
  }

  const CULTURE = {};
  BATCHES.forEach(b => { CULTURE[b.id] = cultureSeries(b.peakVCD, b.titer, b.days); });

  /* ── Purification runs ───────────────────────────────────────────────── */
  /* ST-01 holds the column conditions constant (RT 6 / 50 g/L) so that pH is
     the only variable. ST-02 does the reverse: one feed (B2402), three column
     conditions. Mixing the two would confound both studies. */
  const PURIF_RUNS = [
    // ST-01 — fixed column, different upstream pH
    { id: "P2401-A", batch: "B2401", study: "ST-01", resin: "MabSelect PrismA", cv: 20, flow: 300,
      rt: 6, load: 50, dbc: 42.1, recovery: 92.4, hcp: 842, hcd: 118, sec: 96.2,
      date: "2026-07-24", equip: "AKTA-201", status: "완료" },
    { id: "P2402-A", batch: "B2402", study: "ST-01", resin: "MabSelect PrismA", cv: 20, flow: 300,
      rt: 6, load: 50, dbc: 44.6, recovery: 95.1, hcp: 611, hcd: 84, sec: 97.1,
      date: "2026-07-25", equip: "AKTA-201", status: "완료" },

    // ST-02 — one feed (B2402), three column conditions
    { id: "P2402-B", batch: "B2402", study: "ST-02", resin: "MabSelect PrismA", cv: 20, flow: 450,
      rt: 4, load: 40, dbc: 31.2, recovery: 88.6, hcp: 1180, hcd: 149, sec: 94.8,
      date: "2026-07-26", equip: "AKTA-202", status: "완료" },
    { id: "P2402-C", batch: "B2402", study: "ST-02", resin: "MabSelect PrismA", cv: 20, flow: 300,
      rt: 6, load: 50, dbc: 44.6, recovery: 94.2, hcp: 638, hcd: 91, sec: 97.0,
      date: "2026-07-26", equip: "AKTA-202", status: "완료" },
    { id: "P2402-D", batch: "B2402", study: "ST-02", resin: "MabSelect PrismA", cv: 20, flow: 220,
      rt: 8, load: 60, dbc: 38.4, recovery: 91.3, hcp: 742, hcd: 108, sec: 96.4,
      date: "2026-07-27", equip: "AKTA-202", status: "완료" }
  ];

  /* ── Analysis results ────────────────────────────────────────────────── */
  const ANALYSES = [
    // ST-01 arm A (pH 6.8)
    { id: "A2401-01", sample: "P2401-A", study: "ST-01", method: "SEC", date: "2026-07-25", equip: "BT3035",
      results: { SEC_monomer: 98.72, SEC_hmw: 1.05 } },
    { id: "A2401-03", sample: "P2401-A", study: "ST-01", method: "CEX", date: "2026-07-26", equip: "BT3036",
      results: { CEX_main: 61.2, CEX_acidic: 26.4, CEX_basic: 12.4 } },
    // ST-01 arm B (pH 7.0)
    { id: "A2402-01", sample: "P2402-A", study: "ST-01", method: "SEC", date: "2026-07-26", equip: "BT3035",
      results: { SEC_monomer: 99.14, SEC_hmw: 0.72 } },
    { id: "A2402-04", sample: "P2402-A", study: "ST-01", method: "CEX", date: "2026-07-26", equip: "BT3036",
      results: { CEX_main: 58.6, CEX_acidic: 28.9, CEX_basic: 12.5 } },

    // ST-02 arms — RT 4 (worst), RT 6, RT 8
    { id: "A2402-02", sample: "P2402-B", study: "ST-02", method: "CEX", date: "2026-07-26", equip: "BT3036",
      results: { CEX_main: 53.8, CEX_acidic: 31.4, CEX_basic: 14.8 } },
    { id: "A2402-03", sample: "P2402-B", study: "ST-02", method: "SDS", date: "2026-07-27", equip: "BT3035",
      results: { SDS_purity: 97.6 } },
    { id: "A2402-07", sample: "P2402-C", study: "ST-02", method: "CEX", date: "2026-07-27", equip: "BT3036",
      results: { CEX_main: 59.4, CEX_acidic: 28.1, CEX_basic: 12.5 } },
    { id: "A2402-08", sample: "P2402-D", study: "ST-02", method: "CEX", date: "2026-07-27", equip: "BT3036",
      results: { CEX_main: 57.8, CEX_acidic: 29.0, CEX_basic: 13.2 } },

    // ST-03 charge-variant fractions — intact mass + binding affinity per fraction
    { id: "A2402-05", sample: "P2402-B", study: "ST-03", method: "Mass", date: "2026-07-27", equip: "MS-401",
      fraction: "Acidic", results: { Mass_obs: 148253, Mass_delta: 128 } },
    { id: "A2402-09", sample: "P2402-B", study: "ST-03", method: "Binding", date: "2026-07-27", equip: "MS-401",
      fraction: "Acidic", results: { KD: 2.84 } },
    { id: "A2402-06", sample: "P2402-B", study: "ST-03", method: "Mass", date: "2026-07-27", equip: "MS-401",
      fraction: "Main", results: { Mass_obs: 148236, Mass_delta: 13 } },
    { id: "A2402-10", sample: "P2402-B", study: "ST-03", method: "Binding", date: "2026-07-27", equip: "MS-401",
      fraction: "Main", results: { KD: 1.42 } }
  ];

  /* Reference values for the intact-mass comparison */
  const MASS_REF = { theoretical: 148234, ko: "이론 질량 (탈당쇄 기준)" };

  /* N-glycan profile (DA-3880 vs reference product) */
  const GLYCAN = [
    { key: "G0F",  ko: "G0F",  sample: 46.2, ref: 44.8 },
    { key: "G1F",  ko: "G1F",  sample: 33.1, ref: 35.6 },
    { key: "G2F",  ko: "G2F",  sample: 8.4,  ref: 9.1 },
    { key: "Man5", ko: "Man5", sample: 4.6,  ref: 3.9 },
    { key: "Afucosylation", ko: "Afuco.", sample: 6.2, ref: 5.4 }
  ];

  /* ── Literature & patents ────────────────────────────────────────────── */
  const LITERATURE = [
    { id: "L-001", kind: "논문", title_ko: "CHO 유가식 배양에서 pH 시프트가 역가와 당쇄에 미치는 영향",
      title_en: "pH shift strategy in CHO fed-batch: impact on titer and glycosylation",
      src: "Biotechnol Bioeng", year: 2025, authors: "Kim H, Lee J, et al.", cited: 42, tag: "배양",
      summary: "Day 5에 pH를 7.05에서 6.90으로 낮추는 2단계 시프트가 최종 역가를 18% 높이고 G0F 비율을 3.2%p 증가시켰다. 온도 시프트(36.5→33°C)와 병용 시 생존율 유지 기간이 2일 연장되었다.",
      link: "#" },
    { id: "L-002", kind: "논문", title_ko: "Protein A 리간드 종류에 따른 HCP 제거 성능 비교",
      title_en: "HCP clearance across Protein A ligand chemistries",
      src: "J Chromatogr A", year: 2024, authors: "Park S, Choi M, et al.", cited: 87, tag: "정제",
      summary: "PrismA 리간드가 SuRe 대비 초기 HCP를 27% 더 제거했으며, 알칼리 세정 내구성에서 100 사이클 후에도 결합용량 92%를 유지했다. 다만 용출 pH가 낮아 응집체 형성 위험이 증가했다.",
      link: "#" },
    { id: "L-003", kind: "특허", title_ko: "항체 정제를 위한 다중모드 크로마토그래피 공정",
      title_en: "Multimodal chromatography process for antibody purification",
      src: "KR 10-2024-0087***", year: 2024, authors: "출원인: (주)***바이오", cited: 0, tag: "정제",
      summary: "Protein A 이후 다중모드 수지를 단일 단계로 적용해 HCP와 응집체를 동시에 제거하는 공정. 청구항 1은 pH 6.0–6.5, 전도도 8–12 mS/cm 조건을 한정한다. 당사 ST-02 조건과 일부 중첩 가능성이 있어 검토가 필요하다.",
      link: "#" },
    { id: "L-004", kind: "내부보고서", title_ko: "DA-3880 세포주 안정성 평가 결과 (60 PDL)",
      title_en: "DA-3880 cell line stability at 60 PDL",
      src: "RPT-25-0112", year: 2025, authors: "배양공정팀", cited: 0, tag: "배양",
      summary: "60 PDL까지 역가 변화 5% 이내, 당쇄 프로파일 변화 유의미하지 않음. 다만 45 PDL 이후 Man5 비율이 완만히 증가하는 경향이 관찰되어 상업 생산 시 PDL 상한 설정 근거로 활용 가능하다.",
      link: "#" },
    { id: "L-005", kind: "논문", title_ko: "바이오시밀러 유사성 평가에서 CEX 전하 변이체의 임상적 의미",
      title_en: "Clinical relevance of charge variants in biosimilar comparability",
      src: "MAbs", year: 2026, authors: "Tanaka Y, Weber K, et al.", cited: 11, tag: "분석",
      summary: "산성 변이체 비율이 30%를 초과해도 FcRn 결합과 PK에 유의한 차이가 없었다는 다기관 분석. 규제 제출 시 전하 변이체 규격 설정 근거로 인용 가능하나, 각 제품별 기능 평가가 선행되어야 한다.",
      link: "#" }
  ];

  /* ── Meeting agenda template ─────────────────────────────────────────── */
  const AGENDA = [
    { id: "overview", ko: "과제 개요", en: "Overview",      mins: 5 },
    { id: "culture",  ko: "배양공정",  en: "Cultivation",   mins: 10 },
    { id: "purif",    ko: "정제공정",  en: "Purification",  mins: 10 },
    { id: "analysis", ko: "바이오분석", en: "Bioanalysis",  mins: 10 },
    { id: "issues",   ko: "이슈 & 액션", en: "Issues & Actions", mins: 10 }
  ];

  const TEAM = ["이하은", "박서연", "김준호", "정민우", "최지훈"];

  return {
    PROJECTS, STUDIES, ARMS, DEPTS, SPECS, judge, specText,
    EQUIPMENT, BATCHES, SHIFTS, CULTURE, PURIF_RUNS, ANALYSES, GLYCAN, MASS_REF,
    LITERATURE, AGENDA, TEAM, cultureSeries
  };
})();
