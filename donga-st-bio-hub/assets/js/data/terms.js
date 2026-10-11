/* ==========================================================================
   terms.js — 용어 설명  ·  window.HubTerms

   "IVCD 가 뭐야?" 에 답하기 위한 사전입니다. 예전에는 이 질문이 **문헌
   검색**으로 갔습니다 — 우리 표에 IVCD 라는 컬럼이 있는데도, 뜻을 묻는
   말은 "값을 묻는 질문" 이 아니라 밖으로 나갔습니다. 새로 온 사람이 가장
   먼저 묻는 종류의 질문이 가장 엉뚱하게 처리되고 있었습니다.

   ── 여기 적는 것과 적지 않는 것 ────────────────────────────────────────
   적는 것: 그 항목이 **무엇을 재는 값인가** · **왜 보는가** · 단위.
            공정·분석 분야에서 통용되는 설명만 적습니다.
   적지 않는 것: 수치, 기준값, 합격 범위, "보통 ○○ 정도" 같은 말.

   ★ 기준값을 적지 않는 이유 ─ 규격은 제품마다 다르고, 이 시스템에는
     규격을 등록하는 자리가 따로 있습니다(Specs). 설명에 숫자를 적어 두면
     그것이 기준처럼 읽히고, 등록된 규격과 어긋나는 순간 어느 쪽이 맞는지
     알 수 없게 됩니다. 그래서 설명은 글로만 하고, 숫자는 **이 데이터에
     실제로 기록된 범위**를 그때그때 읽어 붙입니다 (ask-engine 이 합니다).

   ★ col 은 스키마의 항목 키입니다. 이것으로 "그래서 지금 값이 얼마인가"
     까지 이어 줍니다. 스키마에서 사라진 항목은 설명만 남고 값은 붙지
     않습니다 — 틀린 연결을 만들지 않으려고 키를 확인한 뒤 붙입니다.
   ========================================================================== */

window.HubTerms = (function () {
  "use strict";

  /* group/key 는 DATA_ANALYTE_GROUPS 의 것과 같아야 합니다 */
  const TERMS = [
    /* ── 배양 ──────────────────────────────────────────────────────────── */
    { ko: "IVCD", full: "Integral of Viable Cell Density",
      aliases: ["ivcd", "적산 세포", "적산세포", "누적 세포", "적분 세포"],
      group: "upstream", key: "ivcd",
      what: "배양하는 동안의 생세포 농도를 시간에 대해 적분한 값입니다. " +
            "어느 한 시점의 세포 수가 아니라, 배양 기간 전체에 걸쳐 " +
            "\"세포가 얼마나 오래, 얼마나 많이 있었는가\" 를 하나의 수로 나타냅니다.",
      why: "생산량은 세포 수와 배양 기간에 함께 좌우되므로, 최대 세포농도만으로는 " +
           "설명되지 않는 배치 간 차이를 보는 데 씁니다." },

    { ko: "Max VCD", full: "Maximum Viable Cell Density",
      aliases: ["max vcd", "maxvcd", "최대 세포농도", "최대세포농도", "피크 vcd"],
      group: "upstream", key: "maxVCD",
      what: "배양 기간 중 생세포 농도가 가장 높았던 시점의 값입니다.",
      why: "세포가 얼마나 잘 자랐는지를 가장 간단하게 보는 지표입니다. " +
           "언제 그 값에 닿았는지는 이 값만으로는 알 수 없습니다." },

    { ko: "Final VCD", full: "Final Viable Cell Density",
      aliases: ["final vcd", "finalvcd", "최종 세포농도", "최종세포농도"],
      group: "upstream", key: "finalVCD",
      what: "배양을 끝내는(harvest) 시점의 생세포 농도입니다.",
      why: "Max VCD 와 함께 보면 배양 후반에 세포가 얼마나 줄었는지 가늠할 수 있습니다." },

    { ko: "VCD", full: "Viable Cell Density",
      aliases: ["vcd", "생세포", "생세포 농도", "세포농도", "세포 농도"],
      what: "살아 있는 세포의 농도입니다. 단위 부피에 생세포가 몇 개인지를 셉니다.",
      why: "이 시스템에는 VCD 를 Max · Final · IVCD 세 가지로 나눠 기록합니다 — " +
           "각각 \"가장 높았을 때\" · \"끝낼 때\" · \"기간 전체\" 를 봅니다." },

    { ko: "Viability", full: "Cell Viability",
      aliases: ["viability", "생존율", "생존도", "세포 생존", "final viability"],
      group: "upstream", key: "finalViability",
      what: "전체 세포 중 살아 있는 세포의 비율입니다.",
      why: "세포 수가 많아도 생존율이 떨어지면 배양 상태가 나빠지고 있다는 신호이고, " +
           "죽은 세포에서 나오는 물질이 뒤쪽 정제 공정에 부담이 됩니다." },

    { ko: "Titer", full: "Product Titer (HCCF)",
      aliases: ["titer", "타이터", "역가", "생산량", "hccf", "titer hccf"],
      group: "upstream", key: "titerHCCF",
      what: "배양액에 들어 있는 목적 단백질의 농도입니다. 이 시스템에 기록되는 Titer 는 " +
            "HCCF(Harvested Cell Culture Fluid) — 세포를 걸러 낸 배양액 — 기준입니다.",
      why: "배양 단계의 생산성을 직접 나타내는 값입니다. 정제 수율과 곱해 보면 " +
           "최종적으로 얼마를 얻을 수 있는지로 이어집니다." },

    { ko: "HCCF", full: "Harvested Cell Culture Fluid",
      aliases: ["hccf", "하베스트 배양액", "수확 배양액"],
      what: "배양이 끝난 뒤 세포와 부유물을 걸러 낸 배양액입니다.",
      why: "정제 공정이 시작되는 지점이라, 배양의 성적을 재는 기준점으로 씁니다." },

    /* ── 정제 ──────────────────────────────────────────────────────────── */
    { ko: "Step Yield", full: "단위 공정 수율",
      aliases: ["step yield", "단계 수율", "공정 수율", "스텝 수율"],
      what: "한 정제 단계에 넣은 양 대비 그 단계에서 회수한 양의 비율입니다.",
      why: "어느 단계에서 손실이 생기는지를 단계별로 짚을 수 있습니다. " +
           "이 시스템에는 Protein A · CEX · AEX 세 단계로 기록합니다." },

    { ko: "Protein A Step Yield", full: "Protein A Affinity Chromatography",
      aliases: ["protein a", "proteina", "프로틴 a", "프로테인 a", "단백질 a"],
      group: "downstream", key: "proteinAYield",
      what: "항체의 Fc 영역에 결합하는 Protein A 리간드로 목적 단백질만 붙잡아 " +
            "분리하는 첫 정제 단계의 수율입니다.",
      why: "불순물을 한 번에 크게 줄이는 단계라, 정제 전체의 출발점이 됩니다." },

    { ko: "CEX Step Yield", full: "Cation Exchange Chromatography",
      aliases: ["cex", "양이온교환", "양이온 교환"],
      group: "downstream", key: "cexYield",
      what: "전하 차이를 이용해 분리하는 양이온 교환 단계의 수율입니다.",
      why: "전하가 다른 변이체와 응집체를 걸러 내는 데 씁니다." },

    { ko: "AEX Step Yield", full: "Anion Exchange Chromatography",
      aliases: ["aex", "음이온교환", "음이온 교환"],
      group: "downstream", key: "aexYield",
      what: "음이온 교환 단계의 수율입니다. 보통 흘려보내며(flow-through) 불순물만 붙잡습니다.",
      why: "숙주세포 유래 단백질과 DNA 같은 음전하 불순물을 줄이는 단계입니다." },

    { ko: "Total Yield", full: "전체 정제 수율",
      aliases: ["total yield", "totalyield", "총 수율", "총수율", "전체 수율", "최종 수율"],
      group: "downstream", key: "totalYield",
      what: "정제 공정 전체를 지난 뒤의 누적 수율입니다. 각 단계 수율을 곱한 값에 해당합니다.",
      why: "배양에서 만든 것 중 실제로 손에 남는 비율이라, 공정 경제성과 직접 이어집니다." },

    /* ── 분석 ──────────────────────────────────────────────────────────── */
    { ko: "SE-HPLC", full: "Size Exclusion HPLC",
      aliases: ["se-hplc", "se hplc", "sec", "크기배제", "크기 배제"],
      what: "분자 크기에 따라 분리하는 크로마토그래피입니다. 큰 것이 먼저, 작은 것이 나중에 나옵니다.",
      why: "목적 단백질이 뭉쳤는지(HMW) 쪼개졌는지(LMW)를 한 번에 봅니다." },

    { ko: "HMW", full: "High Molecular Weight species",
      aliases: ["hmw", "고분자량", "응집체", "aggregate"],
      group: "seHPLC", key: "hmw",
      what: "목적 단백질보다 큰 분자 — 주로 응집체(aggregate)의 비율입니다.",
      why: "응집체는 체내에서 면역반응을 일으킬 수 있어 품질특성으로 관리합니다." },

    { ko: "Monomer", full: "SE-HPLC Main Peak (monomer)",
      aliases: ["monomer", "단량체", "메인 피크", "main peak"],
      group: "seHPLC", key: "main",
      what: "뭉치지도 쪼개지지도 않은 단량체 형태의 비율입니다. SE-HPLC 의 주 피크입니다.",
      why: "목적한 형태가 얼마나 온전히 남아 있는지를 나타냅니다." },

    { ko: "LMW", full: "Low Molecular Weight species",
      aliases: ["lmw", "저분자량", "분해물", "fragment"],
      group: "seHPLC", key: "lmw",
      what: "목적 단백질보다 작은 분자 — 주로 분해물(fragment)의 비율입니다.",
      why: "보관·공정 중 분해가 일어났는지를 봅니다." },

    { ko: "Potency", full: "역가 (생물학적 활성)",
      aliases: ["potency", "활성", "생물활성", "효력"],
      group: "potency", key: "potency",
      what: "목적 단백질이 실제로 제 기능을 하는 정도를 기준품과 견준 상대값입니다.",
      why: "양이 같아도 활성이 떨어지면 약으로서의 효과가 달라집니다 — " +
           "농도(Titer)와는 다른 것을 재는 값입니다." },

    { ko: "CQA", full: "Critical Quality Attribute",
      aliases: ["cqa", "핵심품질특성", "중요품질특성", "품질특성"],
      what: "최종 제품의 안전성·유효성에 직접 영향을 주어, 정해진 범위 안에서 " +
            "관리해야 하는 품질 특성입니다.",
      why: "이 시스템의 분석 항목(SE-HPLC · Potency 등)이 대개 여기에 해당합니다." },

    /* ── 이 시스템의 말 ────────────────────────────────────────────────── */
    { ko: "과제", full: "Project",
      aliases: ["과제", "project", "프로젝트"],
      what: "이 시스템의 가장 바깥 단위입니다. 과제 아래에 Study 가, Study 아래에 " +
            "팀별 시료가 놓입니다.",
      why: "상단 선택기에서 과제를 먼저 고르는 이유이고, 과제를 바꾸면 아래 선택이 비워집니다." },

    { ko: "Study", full: "Study",
      aliases: ["study", "스터디"],
      what: "하나의 실험 묶음입니다. 과제 아래에 만들고, 그 안에서 팀별로 시료를 적습니다.",
      why: "계층이 과제 → Study → 팀 → 시료 이므로, Study 를 고르기 전에는 입력 표가 열리지 않습니다." },

    { ko: "시료", full: "Sample",
      aliases: ["시료", "sample", "샘플"],
      what: "측정값을 담는 단위입니다. Data 입력 표의 **열 하나가 시료 하나**입니다.",
      why: "같은 이름의 시료를 팀마다 적으면, 데이터 조회와 챗봇은 그것을 한 줄로 모아 " +
           "배양·정제·분석 값을 나란히 보여 줍니다." },

    { ko: "완성도", full: "입력 완성도",
      aliases: ["완성도", "입력률", "채움률"],
      what: "그 팀 서식의 칸 중 값이 적힌 칸의 비율입니다. " +
            "해당 없음으로 표시한 칸은 분모에서 빠집니다.",
      why: "무엇이 아직 안 들어왔는지를 한 수로 보는 값입니다 — 품질 판정이 아닙니다." },

    { ko: "생성값", full: "생성값 (실측 아님)",
      aliases: ["생성값", "생성 값", "◇"],
      what: "실제로 측정한 값이 아니라, 화면을 구성하려고 만들어 넣은 값입니다. " +
            "수치 옆에 ◇ 로 표시합니다.",
      why: "실측과 섞여 읽히면 안 되기 때문에 표시하고, 통계에 들어갈 때도 그렇다고 밝힙니다." },

    { ko: "DoE", full: "Design of Experiments",
      aliases: ["doe", "실험계획", "실험계획법"],
      what: "여러 인자를 한 번에 체계적으로 바꿔 가며 실험해, 각 인자의 영향과 " +
            "인자 사이의 상호작용을 적은 실험 횟수로 알아내는 방법입니다.",
      why: "한 번에 한 인자만 바꾸는 방식보다 적은 실험으로 더 많은 것을 알 수 있습니다. " +
           "이 시스템의 DoE 화면에서 설계와 분석을 합니다." },

    { ko: "규격", full: "Specification",
      aliases: ["규격", "스펙", "spec", "합격기준", "판정기준"],
      what: "항목마다 정해 둔 합격 범위입니다. 등록된 규격이 있을 때만 Pass/Fail 을 판정합니다.",
      why: "규격이 없으면 판정하지 않습니다 — 기준을 지어내 합격·불합격을 말하지 않습니다." }
  ];

  function squash(s) {
    return String(s === null || s === undefined ? "" : s)
      .toLowerCase().replace(/[\s\-_.·]/g, "");
  }

  /* 질문에서 용어 하나 — 가장 긴 별칭이 걸린 것을 고릅니다.
     "max vcd" 와 "vcd" 가 함께 걸리면 긴 쪽이 사용자가 말한 것입니다. */
  function find(text) {
    const t = squash(text);
    if (!t) return null;
    let best = null, len = 0;
    TERMS.forEach(function (term) {
      [term.ko].concat(term.aliases || []).forEach(function (a) {
        const s = squash(a);
        if (!s || s.length < 2) return;
        const i = t.indexOf(s);
        if (i === -1) return;
        /* 앞뒤에 영문·숫자가 붙어 있으면 다른 낱말의 일부입니다 */
        const before = i > 0 ? t.charAt(i - 1) : "";
        const after = t.charAt(i + s.length);
        if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) return;
        if (s.length > len) { best = term; len = s.length; }
      });
    });
    return best;
  }

  /* 스키마 항목 키(group/key)로 찾기 — 조회 엔진이 항목을 먼저 알아낸
     경우에 씁니다 ("IVCD 가 뭐야" 의 IVCD 는 이미 컬럼으로 인식됩니다). */
  function byColumn(group, key) {
    return TERMS.find(t => t.group === group && t.key === key) || null;
  }

  function all() { return TERMS.slice(); }

  return { find: find, byColumn: byColumn, all: all, _squash: squash };
})();
