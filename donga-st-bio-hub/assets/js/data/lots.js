/* ==========================================================================
   lots.js — 원부자재 로트 추적

   이상이 생겼을 때 현업의 첫 질문은 늘 같습니다.
     "어느 배지 lot 썼어?"  "그 컬럼 몇 사이클째야?"  "표준품 언제 거야?"

   그리고 반대 방향 — **"이 lot 쓴 배치 전부"** 를 뽑을 수 있어야 조사가
   끝납니다. 한 lot 이 문제였다면 영향 범위가 곧 그 목록이기 때문입니다.
   그래서 lot 은 단순 메모가 아니라 배치·시료와 이어진 축입니다.

   ⚠ 원본 Excel 에는 로트 정보가 없습니다. 아래 로트 마스터와 배치 연결은
     배치 ID·Study·날짜에서 **결정론적으로 생성**한 값입니다. 새로고침해도
     같은 값이 나오며, 실제 자재 이력이 아닙니다.
     연결 규칙은 현업 관행을 따랐습니다:
       · 배지·피드 lot 은 한 Study 안에서 잘 바뀌지 않습니다 (묶어서 씁니다)
       · resin cycle 은 배치가 진행될수록 쌓입니다
       · 표준품은 유효기간이 지나면 다음 lot 으로 넘어갑니다
   ========================================================================== */

(function () {
  "use strict";

  if (!window.DATA_BATCHES) return;
  if (window.DATA_LOTS) return;           // 중복 실행 방지 (samples.js 와 같은 이유)

  /* ── 두 종류의 로트 ──────────────────────────────────────────────────────
     retired  2024~25 배치가 실제로 썼던 로트. 이미 소진됐거나 기한이 지났고,
              "그때 유효했나"를 따지는 대상입니다 (판정 기준은 오늘이 아니라
              **배치 날짜**). 오늘 챙길 자재 목록에는 올리지 않습니다.
     현재 재고 오늘 기준으로 살아 있는 로트. 유효기간 경고가 의미를 가지려면
              오늘에 걸린 자재가 있어야 합니다.

     둘을 섞으면 "전부 기한 지남"만 뜨는 쓸모없는 경고가 됩니다. */

  const T = window.HubCalendar ? window.HubCalendar.today() : "2026-01-01";
  const shift = (n) => window.HubCalendar ? window.HubCalendar.addDays(T, n) : T;

  /* 공급사명은 실제 업체를 가리키지 않도록 일반화했습니다 */
  const LOTS = [
    /* ── 배양: 배지 · 피드 ── */
    { id: "LOT-MED-A", kind: "media", team: "upstream", name: "무혈청 배지 (기본)",
      vendor: "공급사 A", lotNo: "MED-2408-11", receivedAt: "2024-08-05", expiryAt: "2025-08-04" },
    { id: "LOT-MED-B", kind: "media", team: "upstream", name: "무혈청 배지 (개선형)",
      vendor: "공급사 A", lotNo: "MED-2411-03", receivedAt: "2024-11-02", expiryAt: "2025-11-01" },
    { id: "LOT-MED-C", kind: "media", team: "upstream", name: "무혈청 배지 (고밀도용)",
      vendor: "공급사 B", lotNo: "MED-2501-07", receivedAt: "2025-01-06", expiryAt: "2026-01-05" },
    { id: "LOT-FEED-A", kind: "feed", team: "upstream", name: "농축 피드 배지",
      vendor: "공급사 A", lotNo: "FD-2408-02", receivedAt: "2024-08-05", expiryAt: "2025-08-04" },
    { id: "LOT-FEED-B", kind: "feed", team: "upstream", name: "농축 피드 배지",
      vendor: "공급사 A", lotNo: "FD-2412-01", receivedAt: "2024-12-02", expiryAt: "2025-12-01" },

    /* ── 정제: resin (cycle 관리 대상) ── */
    { id: "LOT-RES-PA1", kind: "resin", team: "downstream", name: "Protein A resin",
      vendor: "공급사 C", lotNo: "PA-2401-05", packedAt: "2024-07-15",
      cycles: 0, cycleLimit: 100 },
    { id: "LOT-RES-PA2", kind: "resin", team: "downstream", name: "Protein A resin",
      vendor: "공급사 C", lotNo: "PA-2412-02", packedAt: "2024-12-05",
      cycles: 0, cycleLimit: 100 },
    { id: "LOT-RES-CEX", kind: "resin", team: "downstream", name: "CEX resin",
      vendor: "공급사 C", lotNo: "CEX-2409-01", packedAt: "2024-09-01",
      cycles: 0, cycleLimit: 150 },
    { id: "LOT-RES-AEX", kind: "resin", team: "downstream", name: "AEX membrane",
      vendor: "공급사 D", lotNo: "AEX-2410-04", packedAt: "2024-10-10",
      cycles: 0, cycleLimit: 1, note: "일회용 — 배치마다 교체" },

    /* ── 분석: 표준품 · 컬럼 ── */
    { id: "LOT-STD-1", kind: "standard", team: "analytics", name: "참조표준품 (대조약)",
      vendor: "사내 표준품", lotNo: "RS-2024-02", receivedAt: "2024-06-01", expiryAt: "2024-12-31" },
    { id: "LOT-STD-2", kind: "standard", team: "analytics", name: "참조표준품 (대조약)",
      vendor: "사내 표준품", lotNo: "RS-2025-01", receivedAt: "2024-12-15", expiryAt: "2025-12-14" },
    { id: "LOT-COL-SEC", kind: "column", team: "analytics", name: "SEC 컬럼",
      vendor: "공급사 E", lotNo: "SEC-0091", installedAt: "2024-07-01",
      injections: 0, injectionLimit: 2000 },
    { id: "LOT-COL-IEX", kind: "column", team: "analytics", name: "IEX 컬럼",
      vendor: "공급사 E", lotNo: "IEX-0044", installedAt: "2024-08-20",
      injections: 0, injectionLimit: 1500 },

    /* ── 현재 재고 (오늘 기준) ── */
    { id: "LOT-MED-NOW", kind: "media", team: "upstream", name: "무혈청 배지 (기본)",
      vendor: "공급사 A", lotNo: "MED-CUR-01", current: true,
      receivedAt: shift(-120), expiryAt: shift(240) },
    { id: "LOT-FEED-NOW", kind: "feed", team: "upstream", name: "농축 피드 배지",
      vendor: "공급사 A", lotNo: "FD-CUR-02", current: true,
      receivedAt: shift(-200), expiryAt: shift(18) },          // 곧 만료 — 경고 대상
    { id: "LOT-RES-NOW", kind: "resin", team: "downstream", name: "Protein A resin",
      vendor: "공급사 C", lotNo: "PA-CUR-03", current: true,
      packedAt: shift(-90), cycles: 86, cycleLimit: 100 },     // 한도 임박 — 경고 대상
    { id: "LOT-STD-NOW", kind: "standard", team: "analytics", name: "참조표준품 (대조약)",
      vendor: "사내 표준품", lotNo: "RS-CUR-01", current: true,
      receivedAt: shift(-300), expiryAt: shift(-5) }           // 막 지남 — 경고 대상
  ];

  /* 배치에 물린 로트는 과거 것입니다 */
  LOTS.forEach(l => { if (!l.current) l.retired = true; });

  const byId = {};
  LOTS.forEach(l => { byId[l.id] = l; });

  /* ── 배치 → 로트 연결 ────────────────────────────────────────────────
     Study 별로 배지·피드를 묶고, resin 은 시간 순으로 cycle 을 쌓습니다. */
  const MEDIA_BY_STUDY = {
    "STD-0045": "LOT-MED-A",     // Media screening — 기본 배지로 시작
    "STD-0123": "LOT-MED-B",     // DoE — 개선형 배지
    "STD-0321": "LOT-MED-C"      // Feasibility — 고밀도용
  };
  const FEED_BY_STUDY = {
    "STD-0045": "LOT-FEED-A",
    "STD-0123": "LOT-FEED-B",
    "STD-0321": "LOT-FEED-B"
  };

  /* 날짜 순으로 훑으며 resin cycle 과 컬럼 주입 횟수를 누적합니다 —
     "몇 사이클째였나"가 배치마다 달라야 추적이 의미를 갖습니다. */
  const ordered = window.DATA_BATCHES.slice().sort(function (a, b) {
    const da = a.initialDate || a.endDate || "";
    const db = b.initialDate || b.endDate || "";
    return da.localeCompare(db) || String(a.id).localeCompare(String(b.id));
  });

  window.DATA_BATCH_LOTS = {};

  ordered.forEach(function (b) {
    const date = b.endDate || b.initialDate || "";
    const paLot = date && date >= "2024-12-05" ? "LOT-RES-PA2" : "LOT-RES-PA1";
    const stdLot = date && date > "2024-12-31" ? "LOT-STD-2" : "LOT-STD-1";

    byId[paLot].cycles += 1;
    byId["LOT-RES-CEX"].cycles += 1;
    /* SEC·IEX 는 배치당 시료 1건 x 2회 주입(검체+시스템적합성)으로 잡았습니다 */
    byId["LOT-COL-SEC"].injections += 2;
    byId["LOT-COL-IEX"].injections += 2;

    window.DATA_BATCH_LOTS[b.id] = {
      media:    MEDIA_BY_STUDY[b.studyId] || "LOT-MED-A",
      feed:     FEED_BY_STUDY[b.studyId] || "LOT-FEED-A",
      resinPA:  paLot,
      resinCEX: "LOT-RES-CEX",
      resinAEX: "LOT-RES-AEX",
      standard: stdLot,
      columnSEC: "LOT-COL-SEC",
      columnIEX: "LOT-COL-IEX",
      /* 이 배치를 돌릴 때 그 resin 이 몇 사이클째였는지 */
      paCycleAt:  byId[paLot].cycles,
      cexCycleAt: byId["LOT-RES-CEX"].cycles
    };
  });

  window.DATA_LOTS = LOTS;

  /* ── 조회 도우미 ─────────────────────────────────────────────────────── */
  window.Lots = {
    all: function (kind) { return kind ? LOTS.filter(l => l.kind === kind) : LOTS.slice(); },
    /* 오늘 챙길 자재 — 이미 소진된 과거 로트는 뺍니다 */
    current: function () { return LOTS.filter(l => l.current); },
    get: function (id) { return byId[id] || null; },

    /* 한 배치가 쓴 로트 목록 (화면에 그대로 뿌릴 수 있는 형태) */
    forBatch: function (batchId) {
      const map = window.DATA_BATCH_LOTS[batchId];
      if (!map) return [];
      const rows = [
        { role: "배지",          lot: byId[map.media],     extra: null },
        { role: "피드",          lot: byId[map.feed],      extra: null },
        { role: "Protein A resin", lot: byId[map.resinPA], extra: map.paCycleAt + " cycle째" },
        { role: "CEX resin",     lot: byId[map.resinCEX],  extra: map.cexCycleAt + " cycle째" },
        { role: "AEX membrane",  lot: byId[map.resinAEX],  extra: "일회용" },
        { role: "참조표준품",     lot: byId[map.standard],  extra: null },
        { role: "SEC 컬럼",      lot: byId[map.columnSEC], extra: null },
        { role: "IEX 컬럼",      lot: byId[map.columnIEX], extra: null }
      ];
      return rows.filter(r => r.lot);
    },

    /* 역추적 — 이 로트를 쓴 배치 전부. 이상 조사의 영향 범위입니다. */
    batchesOf: function (lotId) {
      return Object.keys(window.DATA_BATCH_LOTS).filter(function (bid) {
        const m = window.DATA_BATCH_LOTS[bid];
        return Object.keys(m).some(k => m[k] === lotId);
      });
    },

    /* 사용 한도 대비 소진율 — resin cycle · 컬럼 주입 횟수 */
    usage: function (lot) {
      if (!lot) return null;
      if (lot.cycleLimit) return { used: lot.cycles, limit: lot.cycleLimit, unit: "cycle" };
      if (lot.injectionLimit) return { used: lot.injections, limit: lot.injectionLimit, unit: "회 주입" };
      return null;
    },

    /* 유효기간 상태. 기준일을 넘길 수 있습니다 —
       배치 화면에서는 **그 배치를 돌린 날** 기준으로 봐야 맞습니다.
       "지금 기한이 지났다"가 아니라 "쓸 때 유효했나"가 질문이기 때문입니다. */
    expiry: function (lot, refDate) {
      if (!lot || !lot.expiryAt) return null;
      const t = refDate || (window.HubCalendar ? window.HubCalendar.today() : null);
      if (!t) return null;
      const days = Math.round((new Date(lot.expiryAt + "T00:00:00") - new Date(t + "T00:00:00")) / 86400000);
      return { expiryAt: lot.expiryAt, refDate: t, days: days,
               state: days < 0 ? "expired" : days <= 30 ? "soon" : "ok" };
    }
  };
})();
