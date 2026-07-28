/* ==========================================================================
   samples.js — 시료(Sample) 계층

   ── 왜 분석값을 배치에서 시료로 옮겼나 ─────────────────────────────────
   SE-HPLC · IE-HPLC · N-glycan · CE-SDS 는 배치를 측정하는 게 아니라
   그 배치에서 채취해 정제한 **특정 시료**를 측정합니다. 값이 배치에 붙어
   있으면 한 배치에서 두 시료를 다른 시점에 시험했을 때 넣을 자리가 없고,
   "어느 시료의 값인가"를 영영 되짚을 수 없습니다.

     Batch  배양의 산물          — IVCD · VCD · Viability · Titer (배치 속성)
     Sample 배치에서 채취한 시료  — SE-HPLC · IE-HPLC · N-glycan · CE-SDS
     정제   배치 단위 공정        — Step Yield · HCP · 잔류 DNA (현재 구조 유지)

   ── 이 파일이 만드는 것 ─────────────────────────────────────────────────
   원본 Excel 은 배치당 분석값이 한 벌뿐입니다. 그래서 배치마다 그 한 벌을
   담은 기본 시료를 하나씩 만들고, batch.analytics 는 지웁니다.
   analytics 객체는 **같은 참조를 옮기는 것**이라 값이 복제되지 않습니다.

   추가로 몇 개 배치에는 "채취했으나 분석 전"인 시료를 하나 더 둡니다.
   분석값을 지어내지 않고도 다중 시료 구조가 화면에 드러나야 하기 때문입니다.
   그 시료의 분석 항목은 전부 비어 있고 화면에는 "미측정"으로 표시됩니다.
   ========================================================================== */

(function () {
  "use strict";

  if (!window.DATA_BATCHES) return;

  /* 두 번 실행되면 안 됩니다.
     이 파일은 batch.analytics 를 시료로 **옮기고 원본을 지웁니다**. 두 번째
     실행에서는 옮길 것이 이미 없어, 시료의 분석값이 전부 빈 값으로 덮여
     데이터가 통째로 사라집니다. 스크립트 태그가 중복되거나 개발 중 다시
     불러오는 것만으로 그렇게 되므로 여기서 한 번 막아 둡니다. */
  if (window.DATA_SAMPLES) return;

  const EMPTY_ANALYTICS = () => ({
    seHPLC:  { hmw: null, main: null, lmw: null },
    ieHPLC:  { acidic: null, main: null, basic: null, basicUnknown: null },
    nGlycan: { g0f: null, g1f: null, highMannose: null, sialicAcid: null, afucosylated: null },
    ceSdsNR: { monomer: null, h2l1: null },
    ceSdsR:  { lc: null, hc: null, lcHc: null, nghc: null }
  });

  /* 분석 전 시료를 하나 더 둘 배치.
     Study 마다 하나씩 골라 어느 화면에서 봐도 다중 시료가 보이게 했습니다. */
  const SECOND_SAMPLE = {
    "B045-2": { suffix: "S2", stage: "AEX 용출 후",       note: "정제 조건 비교용 — 분석 의뢰 완료, 결과 대기" },
    "B123-3": { suffix: "S2", stage: "CEX 용출 후",       note: "중간 단계 시료 — 분석 진행 중" },
    "B321-5": { suffix: "S2", stage: "Protein A 용출 후", note: "재시험용 분취" }
  };

  window.DATA_SAMPLES = [];

  window.DATA_BATCHES.forEach(function (b) {
    /* 1. 원본 분석값을 담은 기본 시료 */
    window.DATA_SAMPLES.push({
      id: "SMP-" + b.id + "-01",
      batchId: b.id,
      studyId: b.studyId,
      name: b.id + "-S1",
      /* 원본 SE-HPLC · IE-HPLC 컬럼에 "간이정제(Protein A) 후" 라고 적혀 있어
         채취 시점을 그대로 옮겼습니다 — 지어낸 값이 아닙니다. */
      stage: "Protein A 간이정제 후",
      collectedAt: b.endDate,
      source: "excel",
      primary: true,
      active: true,
      note: null,
      analytics: b.analytics || EMPTY_ANALYTICS()
    });

    /* 2. 분석 전 시료 (값 없음) */
    const extra = SECOND_SAMPLE[b.id];
    if (extra) {
      window.DATA_SAMPLES.push({
        id: "SMP-" + b.id + "-02",
        batchId: b.id,
        studyId: b.studyId,
        name: b.id + "-" + extra.suffix,
        stage: extra.stage,
        collectedAt: b.endDate,
        source: "derived",
        primary: false,
        active: true,
        note: extra.note,
        analytics: EMPTY_ANALYTICS()
      });
    }

    /* 3. 배치에서 분석값을 떼어 냅니다.
       남겨 두면 "배치에도 있고 시료에도 있는" 두 갈래가 생겨,
       어느 쪽을 고쳤는지 알 수 없게 됩니다. */
    delete b.analytics;
  });
})();
