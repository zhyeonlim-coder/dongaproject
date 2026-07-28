/* ==========================================================================
   labels.js — 라벨 상수 (명세서 §5 용어 정비)

   원칙: 하나의 개념에는 하나의 표기만.
     · 수확 → Harvest
     · OOS  → Fail        (판정은 Pass / Fail 로 통일, "적합/부적합" 혼용 금지)
     · 공정명(배양·정제·분석)은 한글, 지표명(Titer·HCP·VCD)은 영문

   화면에 나가는 문자열은 가능한 한 이 파일을 거치도록 합니다.
   ========================================================================== */

window.LABELS = (function () {
  "use strict";

  const L = {
    /* 판정 — Pass / Fail 로 통일 */
    verdict: {
      pass: "Pass",
      fail: "Fail",
      none: "미판정"
    },

    /* 결측 — Excel의 공란 / N/A / "-" 는 모두 null 이며 화면에는 이 표기.
       EBR에서 연구원이 이유를 밝혀 남긴 결측(미측정·해당없음·불검출·무효)은
       value.js 의 MISSING 표기를 씁니다 — 이유를 아는 결측과 모르는 결측은
       다른 것이라 표기도 나눕니다. */
    empty: "미입력",

    /* 조회 결과가 없을 때 — 화면마다 다른 문장을 쓰면 같은 상황인지 알 수 없습니다 */
    noResult: "선택한 조건에 해당하는 데이터가 없습니다.",
    noResultHint: "조건을 넓히거나 [초기화]를 눌러 전체 데이터를 다시 보세요.",

    /* 공정 단계 (한글) */
    process: {
      culture: "배양",
      harvest: "Harvest",          // 기존 "수확" 전면 대체
      purification: "정제",
      analysis: "분석",
      report: "보고서"
    },

    /* 부서 */
    team: {
      culture:  "배양공정팀",
      purif:    "정제공정팀",
      analysis: "바이오분석팀"
    },

    /* 진행 상태 */
    status: {
      planned:    "예정",
      inProgress: "진행중",
      done:       "완료",
      review:     "검토 필요"
    },

    /* 지표 (영문 유지) */
    metric: {
      titer: "Titer", vcd: "VCD", ivcd: "IVCD", viability: "Viability",
      qp: "qP", hccf: "Titer HCCF", hcp: "HCP", hcd: "HCD",
      dbc: "DBC", yield: "Step Yield", monomer: "Monomer"
    },

    /* 화면 명칭 */
    ui: {
      sampleName:   "Sample Name",   // 기존 "시료(정제 Run)" 전면 대체
      study:        "스터디",
      batch:        "배치",
      appliedFilters: "적용된 검색조건",
      resetAll:     "전체 초기화",
      addSample:    "+ 새 Sample 추가",
      export:       "내보내기",
      auditCreated: "최초 입력",
      auditUpdated: "수정",
      auditHistory: "변경 이력"
    }
  };

  /* 판정 뱃지 CSS 클래스 — Pass/Fail 표기와 색을 한곳에서 묶어 관리 */
  L.verdictClass = function (pass) {
    if (pass === null || pass === undefined) return "spec spec-none";
    return pass ? "spec spec-pass" : "spec spec-oos";
  };
  L.verdictText = function (pass) {
    if (pass === null || pass === undefined) return L.verdict.none;
    return pass ? L.verdict.pass : L.verdict.fail;
  };

  /* 값 표시 — null 이면 "미입력". 숫자는 지정 소수점으로 반올림. */
  L.fmt = function (v, dp) {
    if (v === null || v === undefined || v === "") return L.empty;
    if (typeof v === "number") {
      if (!isFinite(v)) return L.empty;
      return dp == null ? String(v) : v.toFixed(dp);
    }
    return String(v);
  };
  L.isEmpty = function (v) { return v === null || v === undefined || v === ""; };

  return L;
})();
