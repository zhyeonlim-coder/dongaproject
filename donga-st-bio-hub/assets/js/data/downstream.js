/* ==========================================================================
   downstream.js — 정제공정 데이터 생성기

   ⚠ 이 파일이 만드는 값은 실측이 아닙니다.
     원본 Batch_Data_example.xlsx 에는 정제 공정 컬럼이 전혀 없습니다.
     정제공정팀 화면(대시보드 그래프 · 데이터 조회 · 회의 모드 · CSV)을
     구성하기 위해 현업에서 쓰는 지표 체계에 맞춰 값을 생성합니다.

   생성 원칙 — "그럴듯한 난수"가 아니라 공정 논리를 따릅니다
     1. 결정론적       배치 ID 해시를 시드로 쓰므로 새로고침해도 값이 같습니다.
                       (렌더할 때마다 숫자가 바뀌면 회의 중에 신뢰를 잃습니다)
     2. Study 성격 반영 DoE 는 조건을 넓게 흔들어 산포가 크고, Feasibility 는
                       공정을 고정해 산포가 좁습니다.
     3. 배양 결과 연동  Titer 가 높고 Harvest 시점 Viability 가 낮을수록
                       세포 파쇄가 늘어 HCP · DNA 부하가 커집니다.
                       Protein A 컬럼 부하가 커지면 단계 수율은 조금 떨어집니다.

   지표
     Protein A / CEX / AEX Step Yield (%)  → 3-step 정제 각 단계 회수율
     Total Yield (%)                        → 세 단계 곱
     SEC-HPLC Monomer (%)                   → 정제 후 단량체 순도
     HCP (ppm) · Residual DNA (pg/mg)       → 잔류 불순물

   스키마(라벨·단위·소수점)는 studies.js 의 DATA_ANALYTE_GROUPS 에 있습니다.
   ========================================================================== */

(function () {
  "use strict";

  if (!window.DATA_BATCHES) return;

  /* ── 결정론적 난수 ──────────────────────────────────────────────────── */

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /* mulberry32 — 짧고 분포가 고른 시드 난수 */
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Box-Muller — 정규분포. 공정 데이터는 균등분포가 아닙니다. */
  function gauss(rand) {
    const u = Math.max(1e-9, rand()), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const round = (v, dp) => Number(v.toFixed(dp));

  /* ── Study 성격별 프로파일 ──────────────────────────────────────────────
     [평균, 표준편차]. 표준편차가 그 Study 의 "실험 폭"입니다. */
  const PROFILE = {
    /* 배지 스크리닝 — 배지 조성이 바뀌므로 불순물 부하 변동이 큽니다.
       정제 공정 자체는 플랫폼 조건이라 수율 산포는 중간. */
    "STD-0045": { pa: [92.0, 2.4], cex: [88.0, 3.0], aex: [94.0, 1.8],
                  mono: [98.5, 0.45], hcp: [30, 0.55], dna: [0.90, 0.50] },

    /* DoE — 공정 조건을 의도적으로 넓게 흔든 설계라 수율 산포가 가장 큽니다. */
    "STD-0123": { pa: [93.5, 3.4], cex: [89.0, 5.2], aex: [94.5, 3.0],
                  mono: [98.9, 0.60], hcp: [20, 0.70], dna: [0.60, 0.55] },

    /* Feasibility — 공정을 고정하고 재현성을 확인하는 단계. 산포가 좁습니다. */
    "STD-0321": { pa: [95.2, 1.3], cex: [92.0, 1.7], aex: [96.0, 1.1],
                  mono: [99.2, 0.22], hcp: [12, 0.35], dna: [0.38, 0.30] }
  };

  const DEFAULT_PROFILE = PROFILE["STD-0045"];

  /* ── 배양 결과와의 연동 기준값 ──────────────────────────────────────── */
  const titers = window.DATA_BATCHES
    .map(b => (b.upstream ? b.upstream.titerHCCF : null))
    .filter(v => v !== null && isFinite(v));
  const meanTiter = titers.length
    ? titers.reduce((a, c) => a + c, 0) / titers.length
    : 1;

  /* Harvest 시점 Viability 기준선. 이보다 낮으면 파쇄가 늘었다고 봅니다. */
  const VIAB_REF = 65;

  /* ── 생성 ───────────────────────────────────────────────────────────── */
  window.DATA_BATCHES.forEach(function (b) {
    const p = PROFILE[b.studyId] || DEFAULT_PROFILE;
    const rand = rng(hash("ds|" + b.id + "|" + b.studyId));

    const titer = b.upstream ? b.upstream.titerHCCF : null;
    const viab  = b.upstream ? b.upstream.finalViability : null;

    /* 평균 대비 Titer 편차 (-1 ~ +1 근방). 부하 지표로 씁니다. */
    const tf = (titer !== null && isFinite(titer) && meanTiter)
      ? clamp((titer - meanTiter) / meanTiter, -0.8, 1.2) : 0;

    /* Viability 가 기준선보다 낮은 만큼만 파쇄 가중 (높다고 좋아지진 않음) */
    const vf = (viab !== null && isFinite(viab))
      ? clamp((VIAB_REF - viab) / VIAB_REF, 0, 0.6) : 0;

    /* 단계 수율 — 부하가 크면 Protein A 회수율이 조금 떨어집니다 */
    const proteinAYield = clamp(p.pa[0] + gauss(rand) * p.pa[1] - tf * 1.6, 80, 99);
    const cexYield      = clamp(p.cex[0] + gauss(rand) * p.cex[1] - vf * 2.0, 76, 98.5);
    const aexYield      = clamp(p.aex[0] + gauss(rand) * p.aex[1], 85, 99.5);
    const totalYield    = (proteinAYield * cexYield * aexYield) / 10000;

    /* 순도 — CEX/AEX 가 잘 돌수록 단량체가 남습니다 */
    const monomerPurity = clamp(
      p.mono[0] + gauss(rand) * p.mono[1] + (cexYield - p.cex[0]) * 0.03, 95, 99.95);

    /* 불순물 — 로그정규. 잔류량은 한쪽으로 긴 꼬리를 갖습니다. */
    const hcp = clamp(
      p.hcp[0] * Math.exp(gauss(rand) * p.hcp[1]) * (1 + tf * 0.35 + vf * 0.60), 1, 250);
    const residualDNA = clamp(
      p.dna[0] * Math.exp(gauss(rand) * p.dna[1]) * (1 + vf * 0.50), 0.02, 12);

    b.downstream = {
      proteinAYield: round(proteinAYield, 1),
      cexYield:      round(cexYield, 1),
      aexYield:      round(aexYield, 1),
      totalYield:    round(totalYield, 1),
      monomerPurity: round(monomerPurity, 2),
      hcp:           round(hcp, 1),
      residualDNA:   round(residualDNA, 2)
    };
  });
})();
