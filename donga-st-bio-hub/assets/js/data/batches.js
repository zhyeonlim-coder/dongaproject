/* ==========================================================================
   batches.js — 실제 공정 데이터 (Batch_Data_example.xlsx에서 생성)

   출처: Batch_Data_example.xlsx / "Batch Data" 시트 (28행 × 40열)
   생성: TSV → 스크립트 자동 변환 (수기 전사 없음)

   결측 처리 규칙 — 원본의 세 가지 표기를 모두 null로 통일했습니다:
     · 공란   → null   (예: B123-1의 날짜·VCD·Titer D10~D14)
     · "N/A"  → null   (예: LMW(%)는 전 행 N/A)
     · "-"    → null   (예: Titer D15~D20은 전 행 "-")
   UI에서는 null을 "미입력"으로 표시합니다. 값을 추정해 채우지 않습니다.

   단위 변환:
     · Final Viability는 원본이 소수(0.597)이므로 ×100 하여 % 로 저장 (59.7)
     · 그 외 값은 원본 그대로. 부동소수 잡음만 제거 (92.40000000000001 → 92.4)

   ⚠ 원본 Notes 시트 기록: 이 데이터는 스캔 이미지에서 전사되었으며
     판독 오차 가능성이 있습니다. 중요한 수치는 원본과 대조 확인이 필요합니다.
   ========================================================================== */

window.DATA_BATCHES = [  {
    id: "UNSPEC-01", studyId: "STD-0000", team: "upstream", expNo: null,
    initialDate: "2024-08-16", endDate: "2024-08-29", cultureDays: 13,
    upstream: {
      ivcd: 126.2, maxVCD: 19.7, finalVCD: 10.3, finalViability: 59.7,
      titer: {
      D10: 971,
      D11: 1161,
      D12: 1287,
      D13: 1452,
      D14: null,
      D15: null,
      D16: null,
      D17: null,
      D18: null,
      D19: null,
      D20: null
      },
      titerHCCF: 1414, qP: 11.12
    },
    analytics: {
      seHPLC:  { hmw: 0.3, main: 99.7, lmw: null },
      ieHPLC:  { acidic: 28.7, main: 57.8, basic: 13.5, basicUnknown: null },
      nGlycan: { g0f: null, g1f: null, highMannose: null, sialicAcid: null, afucosylated: null },
      ceSdsNR: { monomer: null, h2l1: null },
      ceSdsR:  { lc: null, hc: null, lcHc: null, nghc: null }
    }
  },
  {
    id: "B045-1", studyId: "STD-0045", team: "upstream", expNo: "B045-1",
    initialDate: "2024-11-01", endDate: "2024-11-15", cultureDays: 14,
    upstream: {
      ivcd: 92.4, maxVCD: 12.56, finalVCD: 7.57, finalViability: 63.5,
      titer: {
      D10: 563,
      D11: 597,
      D12: 647,
      D13: 667,
      D14: 678,
      D15: null,
      D16: null,
      D17: null,
      D18: null,
      D19: null,
      D20: null
      },
      titerHCCF: 700, qP: 7.47
    },
    analytics: {
      seHPLC:  { hmw: 0.5, main: 99.5, lmw: null },
      ieHPLC:  { acidic: 20.8, main: 61.9, basic: 17.3, basicUnknown: 9.4 },
      nGlycan: { g0f: null, g1f: null, highMannose: null, sialicAcid: null, afucosylated: null },
      ceSdsNR: { monomer: null, h2l1: null },
      ceSdsR:  { lc: null, hc: null, lcHc: null, nghc: null }
    }
  },
  {
    id: "B045-2", studyId: "STD-0045", team: "upstream", expNo: "B045-2",
    initialDate: "2024-11-01", endDate: "2024-11-15", cultureDays: 14,
    upstream: {
      ivcd: 100.6, maxVCD: 12.45, finalVCD: 10.7, finalViability: 96.1,
      titer: {
      D10: 696,
      D11: 808,
      D12: 966,
      D13: 1057,
      D14: 1171,
      D15: null,
      D16: null,
      D17: null,
      D18: null,
      D19: null,
      D20: null
      },
      titerHCCF: 1223, qP: 12.06
    },
    analytics: {
      seHPLC:  { hmw: 0.6, main: 99.5, lmw: null },
      ieHPLC:  { acidic: 20.5, main: 60.3, basic: 19.2, basicUnknown: 11.1 },
      nGlycan: { g0f: null, g1f: null, highMannose: null, sialicAcid: null, afucosylated: null },
      ceSdsNR: { monomer: null, h2l1: null },
      ceSdsR:  { lc: null, hc: null, lcHc: null, nghc: null }
    }
  },
  {
    id: "B045-3", studyId: "STD-0045", team: "upstream", expNo: "B045-3",
    initialDate: "2024-11-01", endDate: "2024-11-15", cultureDays: 14,
    upstream: {
      ivcd: 84.1, maxVCD: 10.57, finalVCD: 9.42, finalViability: 97.1,
      titer: {
      D10: 697,
      D11: 824,
      D12: 990,
      D13: 1139,
      D14: 1273,
      D15: null,
      D16: null,
      D17: null,
      D18: null,
      D19: null,
      D20: null
      },
      titerHCCF: 1298, qP: 15.31
    },
    analytics: {
      seHPLC:  { hmw: 0.6, main: 99.4, lmw: null },
      ieHPLC:  { acidic: 25.7, main: 56.8, basic: 17.6, basicUnknown: 11.6 },
      nGlycan: { g0f: null, g1f: null, highMannose: null, sialicAcid: null, afucosylated: null },
      ceSdsNR: { monomer: null, h2l1: null },
      ceSdsR:  { lc: null, hc: null, lcHc: null, nghc: null }
    }
  },
  {
    id: "B045-4", studyId: "STD-0045", team: "upstream", expNo: "B045-4",
    initialDate: "2024-11-01", endDate: "2024-11-10", cultureDays: 9,
    upstream: {
      ivcd: 58.6, maxVCD: 12.64, finalVCD: 12.64, finalViability: 95.5,
      titer: {
      D10: null,
      D11: null,
      D12: null,
      D13: null,
      D14: null,
      D15: null,
      D16: null,
      D17: null,
      D18: null,
      D19: null,
      D20: null
      },
      titerHCCF: 479, qP: 8.01
    },
    analytics: {
      seHPLC:  { hmw: null, main: null, lmw: null },
      ieHPLC:  { acidic: null, main: null, basic: null, basicUnknown: null },
      nGlycan: { g0f: null, g1f: null, highMannose: null, sialicAcid: null, afucosylated: null },
      ceSdsNR: { monomer: null, h2l1: null },
      ceSdsR:  { lc: null, hc: null, lcHc: null, nghc: null }
    }
  },
  {
    id: "B045-5", studyId: "STD-0045", team: "upstream", expNo: "B045-5",
    initialDate: "2024-11-01", endDate: "2024-11-15", cultureDays: 14,
    upstream: {
      ivcd: 70, maxVCD: 12.81, finalVCD: 9.64, finalViability: 76.8,
      titer: {
      D10: 384,
      D11: 536,
      D12: 689,
      D13: 770,
      D14: 841,
      D15: null,
      D16: null,
      D17: null,
      D18: null,
      D19: null,
      D20: null
      },
      titerHCCF: 845, qP: 11.93
    },
    analytics: {
      seHPLC:  { hmw: 0, main: 99.5, lmw: null },
      ieHPLC:  { acidic: 17.2, main: 61.5, basic: 21.4, basicUnknown: 13.9 },
      nGlycan: { g0f: null, g1f: null, highMannose: null, sialicAcid: null, afucosylated: null },
      ceSdsNR: { monomer: null, h2l1: null },
      ceSdsR:  { lc: null, hc: null, lcHc: null, nghc: null }
    }
  },
  {
    id: "B123-1", studyId: "STD-0123", team: "upstream", expNo: "B123-1",
    initialDate: null, endDate: null, cultureDays: null,
    upstream: {
      ivcd: null, maxVCD: null, finalVCD: null, finalViability: null,
      titer: {
      D10: null,
      D11: null,
      D12: null,
      D13: null,
      D14: null,
      D15: null,
      D16: null,
      D17: null,
      D18: null,
      D19: null,
      D20: null
      },
      titerHCCF: 89, qP: 9.8
    },
    analytics: {
      seHPLC:  { hmw: 0.2, main: 99.8, lmw: null },
      ieHPLC:  { acidic: 20.7, main: 57.6, basic: 21.7, basicUnknown: 14.5 },
      nGlycan: { g0f: 57.9, g1f: 31.8, highMannose: 1.9, sialicAcid: 0.3, afucosylated: 2.3 },
      ceSdsNR: { monomer: 94.3, h2l1: 4.1 },
      ceSdsR:  { lc: 33.13, hc: 66.38, lcHc: 98.51, nghc: 0.3 }
    }
  },
  {
    id: "B123-2", studyId: "STD-0123", team: "upstream", expNo: "B123-2",
    initialDate: "2024-12-10", endDate: "2024-12-24", cultureDays: 14,
    upstream: {
      ivcd: 2.4, maxVCD: 0.23, finalVCD: 0.13, finalViability: 72.8,
      titer: {
      D10: 14,
      D11: 15,
      D12: 15,
      D13: 17,
      D14: 18,
      D15: null,
      D16: null,
      D17: null,
      D18: null,
      D19: null,
      D20: null
      },
      titerHCCF: 18, qP: 3.34
    },
    analytics: {
      seHPLC:  { hmw: 0.2, main: 99.8, lmw: null },
      ieHPLC:  { acidic: 20.7, main: 57.6, basic: 21.7, basicUnknown: 14.5 },
      nGlycan: { g0f: 57.9, g1f: 31.8, highMannose: 1.9, sialicAcid: 0.3, afucosylated: 2.3 },
      ceSdsNR: { monomer: 94.3, h2l1: 4.1 },
      ceSdsR:  { lc: 33.13, hc: 66.38, lcHc: 98.51, nghc: 0.3 }
    }
  },
  {
    id: "B123-3", studyId: "STD-0123", team: "upstream", expNo: "B123-3",
    initialDate: "2024-12-10", endDate: "2024-12-24", cultureDays: 14,
    upstream: {
      ivcd: 3, maxVCD: 0.28, finalVCD: 0.18, finalViability: 86,
      titer: {
      D10: 18,
      D11: 20,
      D12: 21,
      D13: 23,
      D14: 24,
      D15: null,
      D16: null,
      D17: null,
      D18: null,
      D19: null,
      D20: null
      },
      titerHCCF: 24, qP: 4.71
    },
    analytics: {
      seHPLC:  { hmw: 0.4, main: 99.7, lmw: null },
      ieHPLC:  { acidic: 20.7, main: 57.6, basic: 21.7, basicUnknown: 14.5 },
      nGlycan: { g0f: 57.9, g1f: 31.8, highMannose: 1.9, sialicAcid: 0.3, afucosylated: 2.3 },
      ceSdsNR: { monomer: 94.3, h2l1: 4.1 },
      ceSdsR:  { lc: 33.13, hc: 66.38, lcHc: 98.51, nghc: 0.3 }
    }
  },
  {
    id: "B123-4", studyId: "STD-0123", team: "upstream", expNo: "B123-4",
    initialDate: "2024-12-10", endDate: "2024-12-24", cultureDays: 14,
    upstream: {
      ivcd: 17.8, maxVCD: 1.81, finalVCD: 1.43, finalViability: 90.6,
      titer: {
      D10: 241,
      D11: 289,
      D12: 313,
      D13: 348,
      D14: 368,
      D15: null,
      D16: null,
      D17: null,
      D18: null,
      D19: null,
      D20: null
      },
      titerHCCF: 368, qP: 20.06
    },
    analytics: {
      seHPLC:  { hmw: 0.1, main: 99.9, lmw: null },
      ieHPLC:  { acidic: 17.3, main: 60.9, basic: 21.7, basicUnknown: 15.2 },
      nGlycan: { g0f: 69, g1f: 23.9, highMannose: 1.7, sialicAcid: 0, afucosylated: 3.1 },
      ceSdsNR: { monomer: 88.4, h2l1: 7.4 },
      ceSdsR:  { lc: 33.18, hc: 66.3, lcHc: 99.48, nghc: 0.48 }
    }
  },
  {
    id: "B123-5", studyId: "STD-0123", team: "upstream", expNo: "B123-5",
    initialDate: "2024-12-10", endDate: "2024-12-24", cultureDays: 14,
    upstream: {
      ivcd: 75.6, maxVCD: 10.7, finalVCD: 7.83, finalViability: 96.9,
      titer: {
      D10: 662,
      D11: 870,
      D12: 941,
      D13: 1154,
      D14: 1270,
      D15: null,
      D16: null,
      D17: null,
      D18: null,
      D19: null,
      D20: null
      },
      titerHCCF: 1270, qP: 16.67
    },
    analytics: {
      seHPLC:  { hmw: 0.3, main: 99.7, lmw: null },
      ieHPLC:  { acidic: 26.8, main: 51.2, basic: 22, basicUnknown: 14.1 },
      nGlycan: { g0f: 72.4, g1f: 21.5, highMannose: 1.1, sialicAcid: 0, afucosylated: 2 },
      ceSdsNR: { monomer: 94.5, h2l1: 3.9 },
      ceSdsR:  { lc: 33.56, hc: 65.38, lcHc: 98.94, nghc: 0.68 }
    }
  },
  {
    id: "B123-6", studyId: "STD-0123", team: "upstream", expNo: "B123-6",
    initialDate: "2024-12-10", endDate: "2024-12-24", cultureDays: 14,
    upstream: {
      ivcd: 9.5, maxVCD: 0.87, finalVCD: 0.51, finalViability: 77.4,
      titer: {
      D10: 48,
      D11: 52,
      D12: 91,
      D13: 90,
      D14: 91,
      D15: null,
      D16: null,
      D17: null,
      D18: null,
      D19: null,
      D20: null
      },
      titerHCCF: 91, qP: 8.43
    },
    analytics: {
      seHPLC:  { hmw: 0.4, main: 99.6, lmw: null },
      ieHPLC:  { acidic: 20.7, main: 57.6, basic: 21.7, basicUnknown: 14.5 },
      nGlycan: { g0f: 57.9, g1f: 31.8, highMannose: 1.9, sialicAcid: 0.3, afucosylated: 2.3 },
      ceSdsNR: { monomer: 94.3, h2l1: 4.1 },
      ceSdsR:  { lc: 33.13, hc: 66.38, lcHc: 98.51, nghc: 0.3 }
    }
  },
  {
    id: "B123-7", studyId: "STD-0123", team: "upstream", expNo: "B123-7",
    initialDate: "2024-12-10", endDate: "2024-12-24", cultureDays: 14,
    upstream: {
      ivcd: 6.9, maxVCD: 0.67, finalVCD: 0.36, finalViability: 76.2,
      titer: {
      D10: 33,
      D11: 36,
      D12: 85,
      D13: 87,
      D14: 87,
      D15: null,
      D16: null,
      D17: null,
      D18: null,
      D19: null,
      D20: null
      },
      titerHCCF: 87, qP: 11.18
    },
    analytics: {
      seHPLC:  { hmw: 0.3, main: 99.6, lmw: null },
      ieHPLC:  { acidic: 20.7, main: 57.6, basic: 21.7, basicUnknown: 14.5 },
      nGlycan: { g0f: 57.9, g1f: 31.8, highMannose: 1.9, sialicAcid: 0.3, afucosylated: 2.3 },
      ceSdsNR: { monomer: 94.3, h2l1: 4.1 },
      ceSdsR:  { lc: 33.13, hc: 66.38, lcHc: 98.51, nghc: 0.3 }
    }
  },
  {
    id: "B123-8", studyId: "STD-0123", team: "upstream", expNo: "B123-8",
    initialDate: "2024-12-10", endDate: "2024-12-24", cultureDays: 14,
    upstream: {
      ivcd: 65.2, maxVCD: 7.48, finalVCD: 5.87, finalViability: 94.4,
      titer: {
      D10: 792,
      D11: 946,
      D12: 954,
      D13: 1045,
      D14: 1118,
      D15: null,
      D16: null,
      D17: null,
      D18: null,
      D19: null,
      D20: null
      },
      titerHCCF: 1118, qP: 16.98
    },
    analytics: {
      seHPLC:  { hmw: 0.4, main: 99.6, lmw: null },
      ieHPLC:  { acidic: 23.7, main: 48.8, basic: 27.6, basicUnknown: 17.4 },
      nGlycan: { g0f: 66.3, g1f: 24.7, highMannose: 1.2, sialicAcid: 0.6, afucosylated: 2.1 },
      ceSdsNR: { monomer: 94.2, h2l1: 4.1 },
      ceSdsR:  { lc: 33.57, hc: 65.15, lcHc: 98.72, nghc: 0.66 }
    }
  },
  {
    id: "B123-9", studyId: "STD-0123", team: "upstream", expNo: "B123-9",
    initialDate: "2024-12-10", endDate: "2024-12-24", cultureDays: 14,
    upstream: {
      ivcd: 83.2, maxVCD: 9.52, finalVCD: 6.13, finalViability: 96.5,
      titer: {
      D10: 909,
      D11: 1035,
      D12: 1086,
      D13: 1206,
      D14: 1400,
      D15: null,
      D16: null,
      D17: null,
      D18: null,
      D19: null,
      D20: null
      },
      titerHCCF: 1400, qP: 16.69
    },
    analytics: {
      seHPLC:  { hmw: 0.4, main: 99.6, lmw: null },
      ieHPLC:  { acidic: 35.5, main: 48, basic: 16.5, basicUnknown: 9.8 },
      nGlycan: { g0f: 68.5, g1f: 24.9, highMannose: 0.7, sialicAcid: 0, afucosylated: 1.3 },
      ceSdsNR: { monomer: 94.3, h2l1: 3.9 },
      ceSdsR:  { lc: 32.99, hc: 65.59, lcHc: 98.58, nghc: 0.49 }
    }
  },
  {
    id: "B123-10", studyId: "STD-0123", team: "upstream", expNo: "B123-10",
    initialDate: "2024-12-10", endDate: "2024-12-24", cultureDays: 14,
    upstream: {
      ivcd: 12, maxVCD: 1.14, finalVCD: 0.84, finalViability: 87.8,
      titer: {
      D10: 115,
      D11: 131,
      D12: 150,
      D13: 154,
      D14: 161,
      D15: null,
      D16: null,
      D17: null,
      D18: null,
      D19: null,
      D20: null
      },
      titerHCCF: 161, qP: 12.55
    },
    analytics: {
      seHPLC:  { hmw: 0.3, main: 99.7, lmw: null },
      ieHPLC:  { acidic: 27.2, main: 52, basic: 20.8, basicUnknown: 14.2 },
      nGlycan: { g0f: 54.6, g1f: 29, highMannose: 8, sialicAcid: 0.5, afucosylated: 8.7 },
      ceSdsNR: { monomer: 95.8, h2l1: 2.8 },
      ceSdsR:  { lc: 32.9, hc: 66.1, lcHc: 98.5, nghc: 0.8 }
    }
  },
  {
    id: "B123-11", studyId: "STD-0123", team: "upstream", expNo: "B123-11",
    initialDate: "2024-12-10", endDate: "2024-12-24", cultureDays: 14,
    upstream: {
      ivcd: 13.5, maxVCD: 1.4, finalVCD: 1.15, finalViability: 91.1,
      titer: {
      D10: 144,
      D11: 178,
      D12: 265,
      D13: 214,
      D14: 225,
      D15: null,
      D16: null,
      D17: null,
      D18: null,
      D19: null,
      D20: null
      },
      titerHCCF: 225, qP: 15.95
    },
    analytics: {
      seHPLC:  { hmw: 0.2, main: 99.8, lmw: null },
      ieHPLC:  { acidic: 20.7, main: 57.6, basic: 21.7, basicUnknown: 14.5 },
      nGlycan: { g0f: 57.9, g1f: 31.8, highMannose: 1.9, sialicAcid: 0.3, afucosylated: 2.3 },
      ceSdsNR: { monomer: 94.3, h2l1: 4.1 },
      ceSdsR:  { lc: 33.13, hc: 66.38, lcHc: 98.51, nghc: 0.3 }
    }
  },
  {
    id: "B123-12", studyId: "STD-0123", team: "upstream", expNo: "B123-12",
    initialDate: "2024-12-10", endDate: "2024-12-24", cultureDays: 14,
    upstream: {
      ivcd: 35, maxVCD: 4.41, finalVCD: 4.27, finalViability: 96.6,
      titer: {
      D10: 335,
      D11: 452,
      D12: 533,
      D13: 607,
      D14: 670,
      D15: null,
      D16: null,
      D17: null,
      D18: null,
      D19: null,
      D20: null
      },
      titerHCCF: 670, qP: 18.88
    },
    analytics: {
      seHPLC:  { hmw: 0.2, main: 99.8, lmw: null },
      ieHPLC:  { acidic: 20.7, main: 57.6, basic: 21.7, basicUnknown: 14.5 },
      nGlycan: { g0f: 57.9, g1f: 31.8, highMannose: 1.9, sialicAcid: 0.3, afucosylated: 2.3 },
      ceSdsNR: { monomer: 94.3, h2l1: 4.1 },
      ceSdsR:  { lc: 33.13, hc: 66.38, lcHc: 98.51, nghc: 0.3 }
    }
  },
  {
    id: "B321-1", studyId: "STD-0321", team: "upstream", expNo: "B321-1",
    initialDate: "2025-01-09", endDate: "2025-01-23", cultureDays: 14,
    upstream: {
      ivcd: 138.8, maxVCD: 14.05, finalVCD: 9.61, finalViability: 95.9,
      titer: {
      D10: 1257,
      D11: 1582.5,
      D12: 1803.5,
      D13: 1953.5,
      D14: 2126.5,
      D15: null,
      D16: null,
      D17: null,
      D18: null,
      D19: null,
      D20: null
      },
      titerHCCF: 2126.5, qP: 15.22
    },
    analytics: {
      seHPLC:  { hmw: 0.4, main: 99.6, lmw: null },
      ieHPLC:  { acidic: 33.7, main: 48.4, basic: 19.9, basicUnknown: 13.9 },
      nGlycan: { g0f: 51.3, g1f: 26.3, highMannose: 14.1, sialicAcid: 0.8, afucosylated: 15.2 },
      ceSdsNR: { monomer: 97.4, h2l1: 1.5 },
      ceSdsR:  { lc: 32.74, hc: 65.75, lcHc: 98.49, nghc: 1.32 }
    }
  },
  {
    id: "B321-2", studyId: "STD-0321", team: "upstream", expNo: "B321-2",
    initialDate: "2025-01-09", endDate: "2025-01-23", cultureDays: 14,
    upstream: {
      ivcd: 98.1, maxVCD: 10.4, finalVCD: 6.6, finalViability: 94.5,
      titer: {
      D10: 1000.5,
      D11: 1266.5,
      D12: 1438.5,
      D13: 1533,
      D14: 1650,
      D15: null,
      D16: null,
      D17: null,
      D18: null,
      D19: null,
      D20: null
      },
      titerHCCF: 1650, qP: 16.62
    },
    analytics: {
      seHPLC:  { hmw: 0.5, main: 99.5, lmw: null },
      ieHPLC:  { acidic: 32.8, main: 50.3, basic: 17, basicUnknown: 11.2 },
      nGlycan: { g0f: 50.5, g1f: 26.1, highMannose: 14.8, sialicAcid: 0.8, afucosylated: 15.9 },
      ceSdsNR: { monomer: 96.4, h2l1: 2.5 },
      ceSdsR:  { lc: 32.9, hc: 64.9, lcHc: 97.8, nghc: 0.7 }
    }
  },
  {
    id: "B321-3", studyId: "STD-0321", team: "upstream", expNo: "B321-3",
    initialDate: "2025-01-09", endDate: "2025-01-23", cultureDays: 14,
    upstream: {
      ivcd: 99.3, maxVCD: 10.5, finalVCD: 8.55, finalViability: 95.9,
      titer: {
      D10: 1158,
      D11: 1445,
      D12: 1560,
      D13: 1823,
      D14: 1866,
      D15: null,
      D16: null,
      D17: null,
      D18: null,
      D19: null,
      D20: null
      },
      titerHCCF: 1866, qP: 18.69
    },
    analytics: {
      seHPLC:  { hmw: 0.5, main: 99.5, lmw: null },
      ieHPLC:  { acidic: 37.5, main: 42.5, basic: 20, basicUnknown: 12.2 },
      nGlycan: { g0f: 58.7, g1f: 29.2, highMannose: 2.8, sialicAcid: 1.3, afucosylated: 4.4 },
      ceSdsNR: { monomer: 96.5, h2l1: 2.6 },
      ceSdsR:  { lc: 32.56, hc: 64.23, lcHc: 96.79, nghc: 0.96 }
    }
  },
  {
    id: "B321-4", studyId: "STD-0321", team: "upstream", expNo: "B321-4",
    initialDate: "2025-01-09", endDate: "2025-01-23", cultureDays: 14,
    upstream: {
      ivcd: 85.5, maxVCD: 9.02, finalVCD: 5.28, finalViability: 93.2,
      titer: {
      D10: 948,
      D11: 1069,
      D12: 1138,
      D13: 1259,
      D14: 1329,
      D15: null,
      D16: null,
      D17: null,
      D18: null,
      D19: null,
      D20: null
      },
      titerHCCF: 1329, qP: 15.42
    },
    analytics: {
      seHPLC:  { hmw: 0.4, main: 99.6, lmw: null },
      ieHPLC:  { acidic: 38.8, main: 44.1, basic: 17.2, basicUnknown: 13 },
      nGlycan: { g0f: 70.6, g1f: 20.5, highMannose: 0.8, sialicAcid: 0.7, afucosylated: 2.4 },
      ceSdsNR: { monomer: 90.9, h2l1: 5.7 },
      ceSdsR:  { lc: 32.76, hc: 64.69, lcHc: 97.45, nghc: 1.15 }
    }
  },
  {
    id: "B321-5", studyId: "STD-0321", team: "upstream", expNo: "B321-5",
    initialDate: "2025-01-09", endDate: "2025-01-23", cultureDays: 14,
    upstream: {
      ivcd: 69.2, maxVCD: 7.59, finalVCD: 4.91, finalViability: 89.2,
      titer: {
      D10: 849,
      D11: 921,
      D12: 1011,
      D13: 1081,
      D14: 1195,
      D15: null,
      D16: null,
      D17: null,
      D18: null,
      D19: null,
      D20: null
      },
      titerHCCF: 1195, qP: 17.13
    },
    analytics: {
      seHPLC:  { hmw: 0.4, main: 99.6, lmw: null },
      ieHPLC:  { acidic: 35.7, main: 43.8, basic: 20.5, basicUnknown: 15.1 },
      nGlycan: { g0f: 73.5, g1f: 18.2, highMannose: 1.2, sialicAcid: 0, afucosylated: 2.3 },
      ceSdsNR: { monomer: 90.2, h2l1: 6.3 },
      ceSdsR:  { lc: 32.79, hc: 64.93, lcHc: 97.72, nghc: 1 }
    }
  },
  {
    id: "B321-6", studyId: "STD-0321", team: "upstream", expNo: "B321-6",
    initialDate: "2025-01-09", endDate: "2025-01-23", cultureDays: 14,
    upstream: {
      ivcd: 116.6, maxVCD: 11.6, finalVCD: 7.92, finalViability: 95.2,
      titer: {
      D10: 1082,
      D11: 1278,
      D12: 1431,
      D13: 1580,
      D14: 1759,
      D15: null,
      D16: null,
      D17: null,
      D18: null,
      D19: null,
      D20: null
      },
      titerHCCF: 1759, qP: 15
    },
    analytics: {
      seHPLC:  { hmw: 0.4, main: 99.6, lmw: null },
      ieHPLC:  { acidic: 31.6, main: 49, basic: 19.4, basicUnknown: 12.7 },
      nGlycan: { g0f: 59.8, g1f: 30.7, highMannose: 1.3, sialicAcid: 1.1, afucosylated: 2 },
      ceSdsNR: { monomer: 96.4, h2l1: 2.6 },
      ceSdsR:  { lc: 33.32, hc: 64.89, lcHc: 98.21, nghc: 0.75 }
    }
  },
  {
    id: "B321-7", studyId: "STD-0321", team: "upstream", expNo: "B321-7",
    initialDate: "2025-01-09", endDate: "2025-01-23", cultureDays: 14,
    upstream: {
      ivcd: 161, maxVCD: 16.5, finalVCD: 11.3, finalViability: 96.6,
      titer: {
      D10: 1432,
      D11: 1887,
      D12: 2176,
      D13: 2327,
      D14: 2494,
      D15: null,
      D16: null,
      D17: null,
      D18: null,
      D19: null,
      D20: null
      },
      titerHCCF: 2494, qP: 15.43
    },
    analytics: {
      seHPLC:  { hmw: 0.5, main: 99.5, lmw: null },
      ieHPLC:  { acidic: 34, main: 51.5, basic: 14.5, basicUnknown: 9.7 },
      nGlycan: { g0f: 58.5, g1f: 32.7, highMannose: 1.2, sialicAcid: 1, afucosylated: 2.1 },
      ceSdsNR: { monomer: 96.5, h2l1: 2.4 },
      ceSdsR:  { lc: 32.57, hc: 64.85, lcHc: 97.42, nghc: 0.59 }
    }
  },
  {
    id: "B321-8", studyId: "STD-0321", team: "upstream", expNo: "B321-8",
    initialDate: "2025-01-09", endDate: "2025-01-23", cultureDays: 14,
    upstream: {
      ivcd: 44.7, maxVCD: 4.57, finalVCD: 3.49, finalViability: 92.3,
      titer: {
      D10: 569,
      D11: 646,
      D12: 701,
      D13: 739,
      D14: 806,
      D15: null,
      D16: null,
      D17: null,
      D18: null,
      D19: null,
      D20: null
      },
      titerHCCF: 806, qP: 17.82
    },
    analytics: {
      seHPLC:  { hmw: 0.4, main: 99.6, lmw: null },
      ieHPLC:  { acidic: 27.1, main: 47.5, basic: 25.4, basicUnknown: 16.3 },
      nGlycan: { g0f: 64.3, g1f: 25.4, highMannose: 1.9, sialicAcid: 1.2, afucosylated: 2.8 },
      ceSdsNR: { monomer: 87.5, h2l1: 7.8 },
      ceSdsR:  { lc: 32.86, hc: 65.75, lcHc: 98.61, nghc: 0.4 }
    }
  },
  {
    id: "B321-9", studyId: "STD-0321", team: "upstream", expNo: "B321-9",
    initialDate: "2025-01-09", endDate: "2025-01-23", cultureDays: 14,
    upstream: {
      ivcd: 100, maxVCD: 10.3, finalVCD: 6.98, finalViability: 96.4,
      titer: {
      D10: 1013,
      D11: 1162,
      D12: 1281,
      D13: 1600,
      D14: 1588,
      D15: null,
      D16: null,
      D17: null,
      D18: null,
      D19: null,
      D20: null
      },
      titerHCCF: 1588, qP: 15.78
    },
    analytics: {
      seHPLC:  { hmw: 0.6, main: 99.4, lmw: null },
      ieHPLC:  { acidic: 34.6, main: 45.2, basic: 20.2, basicUnknown: 13 },
      nGlycan: { g0f: 63.7, g1f: 26.4, highMannose: 1.1, sialicAcid: 1, afucosylated: 2.1 },
      ceSdsNR: { monomer: 95.9, h2l1: 2.9 },
      ceSdsR:  { lc: 32.92, hc: 64.49, lcHc: 97.41, nghc: 1.12 }
    }
  },
  {
    id: "B321-10", studyId: "STD-0321", team: "upstream", expNo: "B321-10",
    initialDate: "2025-01-09", endDate: "2025-01-23", cultureDays: 14,
    upstream: {
      ivcd: 96.3, maxVCD: 10.5, finalVCD: 6.15, finalViability: 69,
      titer: {
      D10: 950,
      D11: 1022,
      D12: 1158,
      D13: 1171,
      D14: 1187,
      D15: null,
      D16: null,
      D17: null,
      D18: null,
      D19: null,
      D20: null
      },
      titerHCCF: 1187, qP: 12.23
    },
    analytics: {
      seHPLC:  { hmw: 0.5, main: 99.5, lmw: null },
      ieHPLC:  { acidic: 31.1, main: 47, basic: 21.9, basicUnknown: 13.7 },
      nGlycan: { g0f: 56.5, g1f: 32.1, highMannose: 1.5, sialicAcid: 1.3, afucosylated: 2.4 },
      ceSdsNR: { monomer: 96.2, h2l1: 2.7 },
      ceSdsR:  { lc: 33.34, hc: 64.68, lcHc: 98.02, nghc: 1.63 }
    }
  }

];
