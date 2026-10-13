/* ==========================================================================
   ssot.js — Single Source of Truth 검사  ·  window.SSOTTest

   무엇을 증명하려는가
     EBR 에서 고친 값을 나머지 전부가 같이 본다는 것.

       Data 입력 ─→ Repo ─┬─→ 대시보드 · 데이터 조회
                         ├─→ Global AI
                         ├─→ 통계 Tool
                         └─→ DoE / CSV

     예전에는 Repo.valueOf() 가 EBR 값을 읽지 않아, EBR 화면은 99.9 를
     보여 주고 조회·AI 는 12.56 을 답했습니다. 둘 다 그럴듯해서 어느 쪽이
     틀렸는지 화면만 봐서는 알 수 없었습니다.

   ★ 검사는 원래 상태로 되돌려 놓고 끝납니다.
     사용자 데이터를 건드리는 검사이므로, 되돌리기가 실패하면 그것도
     실패로 봅니다 — 검사가 데이터를 오염시키면 안 됩니다.
   ========================================================================== */

window.SSOTTest = (function () {
  "use strict";

  /* 실측 컬럼 하나를 골라 씁니다. 생성값(정제)이나 검증 필요 행을 고르면
     제외 규칙과 얽혀 무엇 때문에 값이 달라졌는지 알기 어렵습니다. */
  const FIELD = { group: "upstream", key: "maxVCD", entry: "maxVCD",
                  col: "maxVCD", label: "Max VCD" };
  const DAY = { group: "titer", key: "D10", entry: "titer_D10", col: "titerDay_D10" };
  const TEST_VALUE = 77.7;
  const TEST_DAY_VALUE = 1234;

  function mk() {
    const out = [];
    return { out: out,
      add: (q, ok, note) => out.push({ q: q, pass: !!ok, fail: ok ? [] : [String(note || "")] }) };
  }

  function pickBatch() {
    const b = (window.DATA_BATCHES || []).find(x => x.expNo && x.upstream &&
      typeof x.upstream[FIELD.key] === "number");
    return b || (window.DATA_BATCHES || [])[0];
  }

  /* 검사 전 상태를 통째로 떠 놓고, 끝나면 그대로 되돌립니다 */
  function snapshot() {
    try { return localStorage.getItem("hub.entries.v1"); } catch (e) { return null; }
  }
  function restore(snap) {
    try {
      if (snap === null) localStorage.removeItem("hub.entries.v1");
      else localStorage.setItem("hub.entries.v1", snap);
    } catch (e) { /* */ }
  }

  function run() {
    const T = mk();
    const R = window.Repo;
    const b = pickBatch();
    const scope = "batch:" + b.id;
    const snap = snapshot();
    const pending = [];   /* 비동기 경로 검사 */

    if (!R || !R.setValue || !R.subscribe) {
      T.add("Repo 가 SSOT 표면을 갖고 있음", false,
        "get/set/update/valueOf/subscribe 중 일부 없음");
      return { pass: false, checks: [{ id: "SSOT", pass: false, detail: T.out[0].fail[0] }] };
    }

    /* 0) 저장소 독립 표면 */
    ["get", "set", "update", "valueOf", "subscribe"].forEach(function (n) {
      T.add("Repo." + n + "() 존재", typeof R[n] === "function", "없음");
    });
    T.add("저장소를 교체할 수 있음", typeof R.useStore === "function", "useStore 없음");

    /* 통지가 실제로 오는지 — 캐시 무효화가 여기 달려 있습니다 */
    let notified = 0;
    const off = R.subscribe(function (what) { if (what === "value") notified++; });

    const before = R.valueOf(b, FIELD.group, FIELD.key);
    const beforeTable = tableValue(b.id, FIELD.col);
    T.add("시작 상태 · 조회와 표가 같은 값",
      same(before, beforeTable), "Repo=" + before + " 표=" + beforeTable);

    try {
      /* ── 1) EBR 에서 값 입력 (EBR 이 쓰는 바로 그 경로) ────────────── */
      const w = R.setValue(scope, FIELD.entry, { num: TEST_VALUE }, "SSOT 검사", {
        baseValue: before, baseSource: "Excel 원본" });
      T.add("① Data 입력이 저장됨", !!(w && w.ok), JSON.stringify(w).slice(0, 90));

      /* ── 2) Repo 에 반영 ─────────────────────────────────────────── */
      T.add("② Repo.valueOf 가 새 값을 돌려줌",
        R.valueOf(b, FIELD.group, FIELD.key) === TEST_VALUE,
        "값=" + R.valueOf(b, FIELD.group, FIELD.key));
      T.add("② 변경 통지가 나감", notified > 0, "통지 " + notified + "회");

      /* ── 3) 대시보드·데이터 조회가 쓰는 표 ───────────────────────── */
      T.add("③ 조회 표(AskTables)가 같은 값",
        tableValue(b.id, FIELD.col) === TEST_VALUE,
        "표=" + tableValue(b.id, FIELD.col) + " (캐시가 갱신되지 않았을 수 있습니다)");

      /* ── 4) Global AI ────────────────────────────────────────────── */
      const t = window.AskTables.internal();
      const ai = window.AskEngine.answer(b.__label || b.expNo || b.id, { table: t });
      const said = (ai.facts || []).find(f => f.k === FIELD.label);
      T.add("④ Global AI 가 같은 값을 답함",
        !!said && String(said.v).indexOf(String(TEST_VALUE)) > -1,
        "AI=" + (said ? said.v : "(항목 없음)"));

      /* ── 5) 통계 Tool ────────────────────────────────────────────── */
      const rows = t.rows.filter(r => typeof r[FIELD.col] === "number");
      const mine = t.rows.find(r => r.__id === b.id);
      T.add("⑤ 통계 Tool 이 같은 값을 씀",
        !!mine && mine[FIELD.col] === TEST_VALUE,
        "표의 이 행=" + (mine ? mine[FIELD.col] : "?"));
      const max = Math.max.apply(null, rows.map(r => r[FIELD.col]));
      T.add("⑤ 집계에 새 값이 들어감", max >= TEST_VALUE,
        "최대=" + max + " (입력값 " + TEST_VALUE + " 이 반영되지 않음)");

      /* ── 6) DoE Tool 이 쓰는 경로 ────────────────────────────────
         DoE 는 화면 설계에 대해 돌지만, 응답값을 데이터에서 가져올 때
         같은 Repo 를 지나야 합니다. Repo.getMeasurementRows 로 확인합니다. */
      /* getMeasurementRows 는 Promise 를 돌려주고 행은 {group,key,value}
         모양입니다. 이 경로도 valueOf 를 지나므로 같은 값이어야 합니다. */
      pending.push(Promise.resolve(R.getMeasurementRows([b])).then(function (mr) {
        const list = Array.isArray(mr) ? mr : (mr && mr.rows) || [];
        const hit = list.find(x => x.batchId === b.id && x.key === FIELD.key);
        T.add("⑥ 측정값 행 조회(DoE·분석 경로)도 같은 값",
          !!hit && hit.value === TEST_VALUE,
          "행=" + (hit ? hit.value : "(항목 없음)"));
      }).catch(function (e) {
        T.add("⑥ 측정값 행 조회(DoE·분석 경로)도 같은 값", false, (e && e.message) || "실패");
      }));

      /* ── 7) 값을 다시 수정 ───────────────────────────────────────── */
      const w2 = R.setValue(scope, FIELD.entry, { num: TEST_VALUE + 1 }, "SSOT 재수정");
      T.add("⑦ 수정이 저장됨", !!(w2 && w2.ok), JSON.stringify(w2).slice(0, 80));
      T.add("⑦ 사유 없이 수정하면 거절",
        R.setValue(scope, FIELD.entry, { num: 5 }, "").ok === false, "사유 없이 통과함");

      /* ── 8) 수정이 모든 소비자에게 ───────────────────────────────── */
      const v2 = TEST_VALUE + 1;
      T.add("⑧ Repo 반영", R.valueOf(b, FIELD.group, FIELD.key) === v2, "");
      T.add("⑧ 조회 표 반영", tableValue(b.id, FIELD.col) === v2,
        "표=" + tableValue(b.id, FIELD.col));
      const t2 = window.AskTables.internal();
      const m2 = t2.rows.find(r => r.__id === b.id);
      T.add("⑧ AI·통계 반영", !!m2 && m2[FIELD.col] === v2, "표=" + (m2 ? m2[FIELD.col] : "?"));

      /* ── 일자별 Titer — 예전에 키가 어긋나 있던 자리 ──────────────
         일자축은 설정(DATA_TITER_DAYS)에 달려 있습니다. 쓰지 않기로 하면
         빈 배열이 되고, 그때는 확인할 대상 자체가 없습니다. 없는 것을
         "실패" 로 적으면, 고칠 것이 없는데 고장난 것처럼 보입니다.

         대신 **설정과 화면이 어긋나지 않는지**를 봅니다 — 일자축을 쓰면
         그 키로 읽히고, 쓰지 않으면 그 컬럼이 아예 없어야 합니다. */
      if ((window.DATA_TITER_DAYS || []).length) {
        const dBefore = R.valueOf(b, DAY.group, DAY.key);
        R.setValue(scope, DAY.entry, { num: TEST_DAY_VALUE }, "SSOT 일자별 검사",
          { baseValue: dBefore, baseSource: "Excel 원본" });
        T.add("일자별 Titer · Repo 반영",
          R.valueOf(b, DAY.group, DAY.key) === TEST_DAY_VALUE,
          "값=" + R.valueOf(b, DAY.group, DAY.key) + " (EBR 은 titer_D10 으로 저장합니다)");
        T.add("일자별 Titer · 조회 표 반영",
          tableValue(b.id, DAY.col) === TEST_DAY_VALUE,
          "표=" + tableValue(b.id, DAY.col));
      } else {
        const t0 = window.AskTables.internal();
        T.add("일자축 미사용 · 조회 표에도 일자 컬럼이 없음",
          !t0.columns.some(c => String(c.key).indexOf("titerDay_") === 0),
          "DATA_TITER_DAYS 가 비어 있는데 표에 일자 컬럼이 남아 있으면 설정과 화면이 어긋납니다");
      }

      /* ── 이력이 남는가 (기존 정책 유지) ─────────────────────────── */
      const rec = R.recordOf(scope, FIELD.entry);
      T.add("이력에 이전 값이 보존됨",
        !!(rec && rec.history && rec.history.length &&
           rec.history.some(h => h.previousValue != null)),
        "이력 " + (rec && rec.history ? rec.history.length : 0) + "건");
      T.add("작성자·시각이 기록됨",
        !!(rec && rec.updatedBy && rec.updatedAt), JSON.stringify(rec && {
          by: rec.updatedBy, at: rec.updatedAt }));

    } finally {
      off();
      /* ── 9) 초기화 동작이 기존 정책과 같은가 ─────────────────────── */
      restore(snap);
    }

    /* 되돌린 뒤 값이 원래대로인지 — 되돌리기 실패도 실패입니다.
       localStorage 를 되돌려도 Entries 는 메모리 사본을 들고 있으므로,
       실제 확인은 새로고침 뒤 페이지가 합니다. 여기서는 저장소 문자열이
       같은지만 봅니다. */
    T.add("⑨ 검사가 데이터를 남기지 않음", snapshot() === snap,
      "저장소가 검사 전과 다릅니다");

    /* ── 10) 이름을 고쳐도 값이 있던 자리는 그대로인가 ────────────────
       Data 입력 워크시트에서 항목명 · 시료명 · 열 머리글을 고칠 수 있습니다.
       여기서 지켜야 하는 것이 둘입니다.

         a) 이름은 전사 공통이어야 합니다. 대시보드 · 데이터 조회 · AI 가
            각자 다른 이름으로 같은 항목을 부르면, "Acidic 최대값" 을 물었을
            때 AI 의 답과 화면의 표가 어긋납니다.
         b) 저장 키는 따라 바뀌면 안 됩니다. 이름을 고쳤다고 titer_D10 이
            다른 키로 옮겨 가면 이미 적어 둔 값이 미아가 되고, 조회도
            대시보드도 그 값을 못 찾습니다.

       b 가 깨지는 쪽이 조용해서 더 위험합니다 — 화면에는 새 이름이 잘
       나오고, 값만 사라집니다. */
    (function renameChecks() {
      const A = window.Aliases;
      if (!A) { T.add("⑩ 이름 덧씌움 계층이 있음", false, "window.Aliases 없음"); return; }
      const aSnap = (function () {
        try { return localStorage.getItem("hub.aliases.v1"); } catch (e) { return null; }
      })();

      /* 뒷정리(finally)에서도 써야 하므로 try 밖에 둡니다 */
      const pickG = (window.DATA_ANALYTE_GROUPS || []).find(x => (x.items || []).length);
      const pickIt = pickG && pickG.items[0];
      const itemId = pickG && pickIt ? "item:" + pickG.id + "." + pickIt.key : null;

      try {
        /* a) 스키마 항목명은 원본 객체에 반영되고, 원래 이름은 남습니다 */
        /* 특정 항목을 이름으로 박아 두지 않습니다 — 지표 구성이 바뀌면
           그 항목이 사라져 검사만 깨집니다 (실제로 ieHPLC.acidic 이 그랬습니다).
           살아 있는 스키마에서 첫 항목을 집어 씁니다. */
        const g = pickG, it = pickIt;
        if (!it) { T.add("⑩ 검사 대상 항목이 있음", false, "스키마에 항목이 하나도 없음"); return; }
        const was = A.originalOf(it, "label");

        A.set(itemId, "검사용 산성", was);
        T.add("⑩ 항목명이 스키마에 반영됨", it.label === "검사용 산성",
          "DATA_ANALYTE_GROUPS 의 label 이 " + it.label);
        T.add("⑩ 원래 항목명이 보존됨", A.originalOf(it, "label") === was,
          "원래 이름이 " + A.originalOf(it, "label"));
        T.add("⑩ 이름 변경이 이력에 남음",
          A.historyOf(itemId).some(h => h.to === "검사용 산성" && h.by && h.at),
          "이력에 작성자·시각과 함께 남지 않았습니다");

        /* 이름을 고쳐도 값을 읽는 키는 그대로여야 합니다 */
        const before = R.valueOf(b, FIELD.group, FIELD.key);
        A.set("item:upstream.maxVCD", "검사용 VCD", "Max VCD");
        T.add("⑩ 이름을 고쳐도 값이 그대로 읽힘",
          same(R.valueOf(b, FIELD.group, FIELD.key), before),
          "valueOf 가 " + R.valueOf(b, FIELD.group, FIELD.key) + " (기대 " + before + ")");

        /* 빈 문자열은 덧씌움을 걷어 냅니다 — 되돌릴 길이 있어야 합니다 */
        A.set(itemId, "", was);
        T.add("⑩ 빈 이름을 넣으면 원래대로 돌아옴", it.label === was,
          "되돌린 뒤 label 이 " + it.label);

        /* b) 숨김은 삭제가 아닙니다 */
        const hk = "colhide:upstream|" + b.id + "|D10";
        A.hide(hk, "검사");
        const hidValue = R.valueOf(b, DAY.group, DAY.key);
        T.add("⑩ 열을 숨겨도 값은 지워지지 않음",
          A.isHidden(hk) && same(hidValue, R.valueOf(b, DAY.group, DAY.key)),
          "숨김 상태=" + A.isHidden(hk) + " · 값=" + hidValue);
        T.add("⑩ 누가 언제 숨겼는지 남음",
          !!(A.hiddenInfo(hk) && A.hiddenInfo(hk).by && A.hiddenInfo(hk).at),
          "숨김 기록에 작성자·시각이 없습니다");
        A.unhide(hk);
        T.add("⑩ 숨긴 열을 되살릴 수 있음", !A.isHidden(hk), "되살린 뒤에도 숨김 상태입니다");
      } finally {
        /* 메모리 사본까지 걷어 냅니다. localStorage 만 되돌리면 이 페이지가
           살아 있는 동안 스키마 label 이 "검사용 …" 으로 남습니다. */
        if (itemId) A.set(itemId, "", was0(pickG.id, pickIt.key));
        A.set("item:upstream.maxVCD", "", was0("upstream", "maxVCD"));
        try {
          if (aSnap === null) localStorage.removeItem("hub.aliases.v1");
          else localStorage.setItem("hub.aliases.v1", aSnap);
        } catch (e) { /* */ }
      }
      function was0(gid, key) {
        const gg = (window.DATA_ANALYTE_GROUPS || []).find(x => x.id === gid);
        const ii = gg && (gg.items || []).find(x => x.key === key);
        return ii ? A.originalOf(ii, "label") : "";
      }
    })();

    /* ── 11) 팀 선택이 Study·과제 전환에 살아남는가 ───────────────────
       팀은 Study 아래에 있는 값이 아니라 "지금 어느 공정을 보는 사람인가"
       입니다. 여기서 team 을 비우면 대시보드가 팀 없는 상태를 보고 첫 팀을
       집어, 바이오분석팀 화면에서 Study 만 바꿨는데 배양공정팀으로 튕겨
       나갑니다 — 고른 적도 없는 팀의 그래프를 보게 되는 것이라 조용히
       틀린 값을 읽습니다.

       한 줄만 되돌아가도 되살아나는 버그라 여기서 붙잡습니다. */
    (function scopeChecks() {
      const S = window.Scope;
      if (!S) { T.add("⑪ Scope 가 있음", false, "window.Scope 없음"); return; }
      const keep = S.get();
      try {
        const study = (window.DATA_STUDIES || [])[0];
        const other = (window.DATA_STUDIES || []).find(x => x.id !== (study || {}).id);
        if (!study || !other) { T.add("⑪ 검사할 Study 가 둘 이상", false, "Study 부족"); return; }

        S.setScope("study", study.projectId);
        S.setStudy(study.id);
        S.setTeam("analytics");
        T.add("⑪ 팀이 선택됨", S.get().team === "analytics", "team=" + S.get().team);

        S.setStudy(other.id);
        T.add("⑪ Study 를 바꿔도 팀이 유지됨", S.get().team === "analytics",
          "Study 전환 뒤 team=" + S.get().team);

        const otherProject = (window.DATA_PROJECTS || [])
          .find(p => p.id !== study.projectId);
        if (otherProject) {
          S.setScope("study", otherProject.id);
          T.add("⑪ 과제를 바꿔도 팀이 유지됨", S.get().team === "analytics",
            "과제 전환 뒤 team=" + S.get().team);
        }

        /* 팀을 바꾸는 길은 setTeam 하나뿐이어야 합니다 */
        S.setTeam("upstream");
        T.add("⑪ setTeam 으로는 바뀜", S.get().team === "upstream", "team=" + S.get().team);
      } finally {
        S.setScope(keep.scopeKind, keep.scopeId);
        S.setStudy(keep.studyId);
        S.setTeam(keep.team);
      }
    })();

    /* ── 12) 새로 만든 레코드가 씨앗과 같은 모양인가 ─────────────────
       Study · Batch 가 코드 상수에서 localStorage 로 옮겨 오면서, 이제
       사용자가 Batch 를 직접 만들 수 있습니다. 여기서 모양이 어긋나면
       그 배치를 여는 화면이 **그 자리에서 멈춥니다** — upstream.titer.D10
       을 읽는 코드가 열 곳이 넘는데, 키가 아예 없으면 전부 터집니다.

       "값이 null" 과 "키가 없음" 은 다릅니다. 측정값은 지어내지 않으므로
       null 이 맞지만, 키는 씨앗과 똑같이 있어야 합니다. */
    (function datasetChecks() {
      const D = window.Dataset;
      if (!D) { T.add("⑫ Dataset 이 있음", false, "window.Dataset 없음"); return; }

      const beforeStore = (function () {
        try { return localStorage.getItem("hub.dataset.v1"); } catch (e) { return null; }
      })();
      /* ★ 이 그룹은 Entries 에도 값을 하나 씁니다 (완성도 전제 확인용).
         바깥 검사의 restore 는 이미 지나간 뒤라, 여기서 따로 떠 놓고
         되돌리지 않으면 1234 가 저장소에 남습니다. 실제로 남겼고, 그
         숫자가 다음 검사(Phase B 유출 탐지)에 걸려 엉뚱한 실패가 났습니다.
         검사가 저장소를 더럽히면 그 다음 검사 결과를 믿을 수 없습니다. */
      const beforeEntries = (function () {
        try { return localStorage.getItem("hub.entries.v1"); } catch (e) { return null; }
      })();
      const study = (window.DATA_STUDIES || [])[0];
      const madeId = "ZZTEST-" + Date.now().toString(36);

      try {
        const r = D.addBatch({ studyId: study.id, id: madeId,
                               initialDate: "2026-01-01", endDate: "2026-01-14" });
        T.add("⑫ 새 Batch 를 만들 수 있음", r.ok, r.reason || "");
        if (!r.ok) return;
        const nb = r.batch;

        /* 씨앗 배치와 키 집합이 같아야 합니다 */
        const seedB = (window.DATA_BATCHES || []).find(b => b.id !== madeId && b.upstream);
        /* 씨앗이 아니라 **지금 설정**과 맞는지 봅니다. 씨앗과 견주면,
           일자축을 바꾼 순간 씨앗이 옛 설정을 들고 있어서 검사만 깨집니다.
           새 배치의 모양은 언제나 DATA_TITER_DAYS 를 따라야 맞습니다. */
        const wantDays = (window.DATA_TITER_DAYS || []).length;
        const newDays = Object.keys((nb.upstream && nb.upstream.titer) || {});
        T.add("⑫ 일자 키가 지금 설정과 같음", newDays.length === wantDays,
          "설정 " + wantDays + "개 · 새 배치 " + newDays.length + "개");

        const seedUp = Object.keys((seedB && seedB.upstream) || {}).sort().join(",");
        const newUp = Object.keys(nb.upstream || {}).sort().join(",");
        T.add("⑫ 배양 항목 키가 씨앗과 같음", seedUp === newUp, "새 배치: " + newUp);

        /* 값은 전부 비어 있어야 합니다 — 지어내지 않습니다 */
        const anyValue = Object.keys(nb.upstream).some(function (k) {
          if (k === "titer") return Object.keys(nb.upstream.titer).some(d => nb.upstream.titer[d] !== null);
          return nb.upstream[k] !== null;
        });
        T.add("⑫ 새 Batch 의 측정값은 전부 비어 있음", !anyValue, "값이 채워져 있습니다");

        /* 읽는 경로가 터지지 않아야 합니다 */
        let read = "throw";
        try { read = String(R.valueOf(nb, "titer", newDays[0])); } catch (e) { read = "throw: " + e.message; }
        T.add("⑫ 새 Batch 를 Repo 로 읽어도 터지지 않음", read === "null", "valueOf → " + read);

        /* 사용자가 만든 것과 Excel 에서 온 것을 구분할 수 있어야 합니다 */
        T.add("⑫ 사용자가 만든 레코드임을 알 수 있음",
          D.isUserMade("batch", madeId) && !D.isUserMade("batch", seedB.id),
          "새 배치 user=" + D.isUserMade("batch", madeId) +
          " · 씨앗 user=" + D.isUserMade("batch", seedB.id));

        /* 저장본을 고쳐도 원본 대조값은 그대로여야 합니다 */
        const origEnd = D.originOf("batch", seedB.id).endDate;
        D.patch("batch", seedB.id, { endDate: "2099-12-31" });
        T.add("⑫ 저장본을 고쳐도 원본은 그대로",
          D.originOf("batch", seedB.id).endDate === origEnd,
          "원본이 " + D.originOf("batch", seedB.id).endDate + " 로 바뀌었습니다");
        D.patch("batch", seedB.id, { endDate: origEnd });

        /* 검사 페이지는 사용자 데이터를 건드리지 않아야 합니다 */
        const afterStore = (function () {
          try { return localStorage.getItem("hub.dataset.v1"); } catch (e) { return null; }
        })();
        T.add("⑫ 검사가 사용자 레코드를 바꾸지 않음", afterStore === beforeStore,
          "hub.dataset.v1 이 검사 전과 다릅니다");

        /* ★ 일자별 Titer 만 있는 배치도 "값이 있는" 배치입니다.

           완성도(completeness)는 스키마 항목이 몇 칸 찼나를 세는데 일자별
           Titer 는 그 분모에 없습니다. 그래서 완성도로 "데이터가 있나" 를
           판단하면, 일자별 Titer 만 적은 배치가 0/6 으로 나와 대시보드가
           그릴 선이 멀쩡히 있는데도 "데이터가 없습니다" 를 띄웁니다.
           실제로 그랬고, 그릴 값이 있는지는 Repo 로 직접 봐야 합니다. */
        const day = newDays[0];
        R.setValue("batch:" + madeId, R.entryKey("titer", day), 1234, null,
          { baseValue: null, baseSource: null });
        const c = R.completeness([nb], (window.DATA_ANALYTE_GROUPS || [])
          .filter(g => g.team === "upstream" && !g.empty));
        T.add("⑫ 완성도는 일자별 Titer 를 세지 않음", c.filled === 0,
          "완성도가 " + c.filled + "/" + c.total + " — 이 전제가 바뀌면 아래 판단도 바꿔야 합니다");
        T.add("⑫ 그래도 Repo 로는 값이 읽힘", R.valueOf(nb, "titer", day) === 1234,
          "valueOf → " + R.valueOf(nb, "titer", day));
      } finally {
        /* Entries 를 검사 전으로 되돌립니다 — 메모리 사본까지 비워야
           이 페이지가 살아 있는 동안에도 남지 않습니다. */
        try {
          if (beforeEntries === null) localStorage.removeItem("hub.entries.v1");
          else localStorage.setItem("hub.entries.v1", beforeEntries);
        } catch (e) { /* */ }
        if (window.Entries && window.Entries.reset) {
          window.Entries.reset();
          try {
            if (beforeEntries === null) localStorage.removeItem("hub.entries.v1");
            else localStorage.setItem("hub.entries.v1", beforeEntries);
          } catch (e) { /* */ }
        }

        /* 메모리 상태만 되돌립니다 (검사 페이지는 저장하지 않습니다) */
        const list = D.all().batches;
        const i = list.findIndex(b => b.id === madeId);
        if (i > -1) list.splice(i, 1);
        const arr = window.DATA_BATCHES;
        const j = arr.findIndex(b => b.id === madeId);
        if (j > -1) arr.splice(j, 1);
      }
    })();

    /* ══════════════════════════════════════════════════════════════════
       ⑬ 방금 만든 시료를 AI 가 바로 보는가

       이 검사는 실제로 놓친 사고에서 나왔습니다. AI 가 보는 표
       (AskTables)는 캐시인데, 캐시를 버리는 신호를 세 가지만 듣고
       있었습니다 — 값 · 저장소 · 라벨. 그래서 **서버에서 한 벌 받아와도
       (remote), 새 시료를 만들어도(dataset/sample) 표가 그대로였습니다.**

       화면을 먼저 그리고 서버 데이터는 나중에 도착하는 구조라, 로드
       중에 캐시가 한 번 만들어지면 그 뒤로 AI 는 끝까지 0행을 봤습니다.
       "TA1 알려줘" → "조건에 맞는 데이터가 0건입니다". 화면에는 보이는
       데이터를 AI 만 못 보는 상태이고, 화면만 봐서는 알 수 없습니다.
       ══════════════════════════════════════════════════════════════════ */
    (function liveTableChecks() {
      const D = window.Dataset, E = window.Entries, AT = window.AskTables;
      if (!D || !E || !AT) { T.add("⑬ 모듈 있음", false, "Dataset·Entries·AskTables 중 없음"); return; }

      const beforeStore = (function () {
        try { return localStorage.getItem("hub.dataset.v1"); } catch (e) { return null; }
      })();
      const beforeEntries = (function () {
        try { return localStorage.getItem("hub.entries.v1"); } catch (e) { return null; }
      })();
      const study = (window.DATA_STUDIES || [])[0];
      const madeId = "ZZLIVE-" + Date.now().toString(36);
      const NAME = "ZZ-LIVE-1";

      try {
        /* 캐시를 먼저 한 번 만들어 둡니다 — 사고가 났던 순서 그대로입니다 */
        const n0 = AT.internal().rows.length;

        const r = D.addBatch({ studyId: study.id, id: madeId, team: "upstream",
                               expNo: NAME, hidden: true, initialDate: "2026-01-01" });
        T.add("⑬ 시료 그릇을 만들 수 있음", r.ok, r.reason || "");
        if (!r.ok) return;
        const s = E.addSample({ batchId: madeId, studyId: study.id,
                                team: "upstream", name: NAME });
        T.add("⑬ 시료를 만들 수 있음", s.ok, s.reason || "");

        const n1 = AT.internal().rows.length;
        T.add("⑬ 새 시료가 AI 표에 바로 올라옴", n1 === n0 + 1,
          "전 " + n0 + " → 후 " + n1 + " (캐시가 버려지지 않았습니다)");

        const row = AT.internal().rows.find(x => x.__id === madeId);
        T.add("⑬ 행 이름이 시료 이름", row && row.__label === NAME,
          "라벨 → " + (row ? row.__label : "행 없음"));

        /* 이름을 고치면 따라와야 합니다 — expNo 에 머무르면 조회 화면은
           새 이름, AI 는 옛 이름을 쓰게 됩니다 */
        if (s.ok && E.renameSample) {
          const rn = E.renameSample(s.sample.id, NAME + "-R");
          const row2 = AT.internal().rows.find(x => x.__id === madeId);
          T.add("⑬ 시료 이름을 고치면 AI 표도 따라옴",
            rn && rn.ok && row2 && row2.__label === NAME + "-R",
            "라벨 → " + (row2 ? row2.__label : "행 없음"));
        }

        /* ⑭ 이름 맞추기 — 대소문자 · 공백 · 붙임표는 무시하고, 뒤에 글자가
           더 붙은 다른 이름은 구별해야 합니다. 느슨함과 엄격함을 한 쌍으로
           봅니다 — 한쪽만 보면 "전부 걸리게" 고치고 끝낼 수 있습니다. */
        const H = window.AskEngine && window.AskEngine._labelHit;
        if (H) {
          const want = [
            ["TA1에 대한 데이터를 알려줘", "TA1", true],
            ["ta1 titer 알려줘", "TA1", true],
            ["TA-1 알려줘", "TA1", true],
            ["시료A maxvcd 알려줘", "시료 A", true],
            ["TA10 알려줘", "TA1", false],
            ["ta1b 알려줘", "TA1", false],
            ["data1 평균", "A1", false]
          ];
          const bad = want.filter(x => H(x[0], x[1]) !== x[2]);
          T.add("⑭ 이름 맞추기 — 조사·대소문자는 같게, 뒷글자는 다르게",
            !bad.length, bad.map(x => "\"" + x[0] + "\"~" + x[1]).join(" / "));
        }

        /* ⑮ 범위를 제대로 잡았으면 "못 읽은 조건" 경고가 붙지 않아야
           합니다. 제대로 답하면서 경고를 함께 띄우면 사용자는 답이 반쪽
           이라고 읽습니다. */
        const ans = window.AskEngine.answer(NAME + "-R 에 대한 데이터를 알려줘");
        T.add("⑮ 범위를 잡았으면 못 읽은 조건 경고가 없음",
          ans.kind !== "no-rows" && !/조건으로 읽지 못/.test(String(ans.note || "")),
          "kind=" + ans.kind + " note=" + String(ans.note || "").slice(0, 80));
      } finally {
        /* 메모리와 저장소를 검사 전으로 되돌립니다 */
        try {
          const list = D.all().batches;
          const i = list.findIndex(b => b.id === madeId);
          if (i > -1) list.splice(i, 1);
          const arr = window.DATA_BATCHES || [];
          const j = arr.findIndex(b => b.id === madeId);
          if (j > -1) arr.splice(j, 1);
        } catch (e) { /* */ }
        if (E.reset) E.reset();
        restore(beforeEntries);
        try {
          if (beforeStore === null) localStorage.removeItem("hub.dataset.v1");
          else localStorage.setItem("hub.dataset.v1", beforeStore);
        } catch (e) { /* */ }
        AT.invalidate();
        const after = AT.internal().rows.some(x => x.__id === madeId);
        T.add("⑬ 검사가 데이터를 남기지 않음", !after, "검사용 시료가 남아 있습니다");
      }
    })();

    /* ══════════════════════════════════════════════════════════════════
       ㉑ 통합 입력 시트 — 한 시료에 세 팀 값이 함께 쌓이는가

       Data 입력이 팀별 시트에서 통합 시트로 바뀌었습니다. 화면 코드는
       검사 페이지에서 띄울 수 없으므로, **저장 모양**만 확인합니다 —
       같은 이름으로 팀마다 그릇이 하나씩 생기고, 그 셋이 한 시료로
       묶여 읽히는가. 이게 깨지면 통합 시트가 세 줄로 갈라집니다.
       ══════════════════════════════════════════════════════════════════ */
    (function masterSheetShape() {
      const D = window.Dataset, E2 = window.Entries, AT2 = window.AskTables;
      if (!D || !E2 || !AT2) { T.add("㉑ 모듈 있음", false, "없음"); return; }
      const study = (window.DATA_STUDIES || [])[0];
      if (!study) { T.add("㉑ 검사할 Study 있음", false, "Study 없음"); return; }

      const bStore = (function () {
        try { return localStorage.getItem("hub.dataset.v1"); } catch (e) { return null; }
      })();
      const eStore = (function () {
        try { return localStorage.getItem("hub.entries.v1"); } catch (e) { return null; }
      })();
      const made = [];
      const NAME = "ZZMASTER-" + Date.now().toString(36);

      try {
        /* 팀마다 같은 이름으로 하나씩 — 통합 시트가 저장하는 모양 그대로 */
        const plan = [["upstream", "maxVCD", 11.1],
                      ["downstream", "downstream_totalYield", 22.2],
                      ["analytics", "seHPLC_main", 33.3]];
        plan.forEach(function (p, i) {
          const id = "ZZMB-" + i + "-" + Date.now().toString(36);
          const r = D.addBatch({ studyId: study.id, id: id, team: p[0],
                                 expNo: NAME, hidden: true, initialDate: "2026-01-01" });
          if (!r.ok) return;
          made.push(id);
          E2.addSample({ batchId: id, studyId: study.id, team: p[0], name: NAME });
          window.Repo.setValue("batch:" + id, p[1], p[2], null, { action: "Create" });
        });
        T.add("㉑ 팀마다 그릇이 하나씩 생김", made.length === 3, "만든 그릇 " + made.length + "개");

        AT2.invalidate();
        const t3 = AT2.internal();
        const mine = t3.rows.filter(r => String(r.__label) === NAME);
        T.add("㉑ 그릇은 팀 수만큼, 이름은 하나", mine.length === 3,
          "행 " + mine.length + "개 / 이름 " +
          Array.from(new Set(mine.map(r => r.__label))).join(","));

        /* 조회·챗봇이 이것을 한 시료로 모아 세 팀 값을 함께 보여 주는가 */
        const ans = window.AskEngine.answer(NAME + " 어때?");
        const txt = JSON.stringify(ans.facts || []);
        const got = ["11.1", "22.2", "33.3"].filter(v => txt.indexOf(v) > -1);
        T.add("㉑ 한 시료로 묶여 세 팀 값이 함께 읽힘",
          got.length === 3 && ans.kind === "overview",
          "kind=" + ans.kind + " 찾은 값=" + got.join(",") );
      } finally {
        try {
          made.forEach(function (id) {
            const l = D.all().batches; const i = l.findIndex(b => b.id === id);
            if (i > -1) l.splice(i, 1);
            const arr = window.DATA_BATCHES || []; const j = arr.findIndex(b => b.id === id);
            if (j > -1) arr.splice(j, 1);
          });
        } catch (e) {}
        if (E2.reset) E2.reset();
        restore(eStore);
        try {
          if (bStore === null) localStorage.removeItem("hub.dataset.v1");
          else localStorage.setItem("hub.dataset.v1", bStore);
        } catch (e) {}
        AT2.invalidate();
        const left = AT2.internal().rows.some(r => String(r.__label) === NAME);
        T.add("㉑ 검사가 데이터를 남기지 않음", !left, "검사용 시료가 남아 있습니다");
      }
    })();

    /* ══════════════════════════════════════════════════════════════════
       ㉒ 그래프 화면 — 팀을 가로질러 겹쳐 볼 수 있는가 · 파일로 내보내는가

       그래프 확인은 세 팀 지표를 한 화면에 겹쳐 보려고 만든 자리입니다.
       그런데 위쪽 [팀] 선택이 그대로 걸리면 그 팀 시료만 내려와, 겹칠
       상대가 화면에 없게 됩니다 — 겹쳐 보려고 들어온 화면이 겹치기를
       막습니다. 화면 코드는 검사 페이지에서 띄울 수 없으므로 그 화면이
       기대는 **두 가지**를 봅니다: 팀 없이 부르면 세 팀이 다 오는가,
       그리고 엑셀 내보내기가 막혀도 CSV 로 내려가는가.
       ══════════════════════════════════════════════════════════════════ */
    (function chartAcrossTeams() {
      const R = window.Repo;
      if (!R || !R.resolveBatches) { T.add("㉒ Repo.resolveBatches 있음", false, "없음"); return; }
      const prj = (window.DATA_PROJECTS || [])[0];
      if (!prj) { T.add("㉒ 검사할 과제 있음", false, "과제 없음"); return; }
      const sel = { scopeKind: "project", scopeId: prj.id };

      const teamIds = (window.DATA_TEAMS || []).map(t => t.id);
      pending.push(Promise.all(
        [R.resolveBatches(sel)].concat(
          teamIds.map(id => R.resolveBatches(Object.assign({}, sel, { team: id }))))
      ).then(function (res) {
        const all = res[0] || [];
        const allIds = all.map(b => b.id);
        const missed = [];
        teamIds.forEach(function (id, i) {
          const one = res[i + 1] || [];
          /* 팀을 주면 그 팀만 — 다른 화면의 규칙은 그대로여야 합니다 */
          if (one.some(b => b.team !== id)) missed.push(id + ": 다른 팀 섞임");
          /* 팀 없이 부르면 **어느 팀 것도 빠지지 않습니다** — 그래야
             배양 지표와 정제 지표를 한 화면에서 겹칠 수 있습니다 */
          one.forEach(function (b) {
            if (allIds.indexOf(b.id) === -1) missed.push(id + ": " + b.id + " 누락");
          });
        });
        T.add("㉒ 팀 없이 부르면 어느 팀 시료도 빠지지 않음",
          !missed.length, missed.slice(0, 4).join(" · ") + " (전체 " + all.length + "건)");
      }));

      const X = window.XlsxOut;
      if (!X) { T.add("㉒ XlsxOut 있음", false, "없음"); return; }
      T.add("㉒ CSV 는 쉼표·따옴표를 감쌈",
        X.csvOf([["a,b", 'c"d'], [1, null]]) === '"a,b","c""d"\r\n1,',
        JSON.stringify(X.csvOf([["a,b", 'c"d'], [1, null]])));

      /* 엑셀 라이브러리를 못 받아 오는 상황 — 내보내기가 **실패로 끝나지
         않고** CSV 로 내려가야 합니다. 사내망에서 CDN 이 막히면 이 길만
         남습니다. 실제 다운로드 대신 save 자리를 바꿔 끼워 확인합니다. */
      const keep = window.AskTables ? window.AskTables.loadXLSX : null;
      const got = [];
      let why = null;
      try {
        if (window.AskTables) window.AskTables.loadXLSX = null;
        X.write([{ name: "데이터", aoa: [["a"], [1]] }], "zz_test", {
          save: function (blob, name) { got.push({ name: name, size: blob.size }); },
          onFallback: function (w) { why = w; }
        });
      } finally {
        if (window.AskTables) window.AskTables.loadXLSX = keep;
      }
      T.add("㉒ 엑셀을 못 만들면 CSV 로 내려감",
        got.length === 1 && /\.csv$/.test(got[0].name) && why,
        "저장=" + JSON.stringify(got) + " 사유=" + why);

      /* 빈 내보내기는 빈 파일을 만들지 않습니다 — 받는 사람이 0행짜리
         파일을 보고 "데이터가 없다" 가 아니라 "내가 잘못 눌렀나" 로 읽습니다 */
      let none = null;
      X.write([], "zz_test", { save: function () { none = "saved"; },
                               onFallback: function (w) { none = w; } });
      T.add("㉒ 내보낼 것이 없으면 파일을 만들지 않음",
        none && none !== "saved", String(none));

      /* 단위가 달라도 한 장에 겹칩니다 — 쪼개지 않고 축을 둘로 둡니다.
         선·막대 **둘 다** 오른쪽 축을 그려야 합니다. 막대만 못 그리면
         [막대] 를 누른 사람은 작은 쪽이 바닥에 깔린 그림을 봅니다. */
      const G = window.Charts;
      if (G) {
        const two = { cats: ["a", "b"],
                      series: [{ name: "큰 값", color: "#000", data: [100, 150] },
                               { name: "작은 값", color: "#111", data: [1.2, 1.8], right: true }] };
        const svgBar = G.bars(Object.assign({ w: 400, h: 200 }, two));
        const svgLine = G.line({ x: two.cats, series: two.series, w: 400, h: 200 });
        /* 오른쪽 축 눈금이 실제로 찍혔는가 — 그림 **오른쪽 끝**에 숫자가
           서 있어야 합니다. 글자 안의 "1.5" 를 찾는 식으로 보면 좌표
           문자열에도 걸려 거짓 통과가 됩니다. */
        function rightTicks(svg) {
          const d = new DOMParser().parseFromString(svg, "image/svg+xml");
          return Array.prototype.slice.call(d.querySelectorAll("text"))
            .filter(t => parseFloat(t.getAttribute("x")) > 400 * 0.8)
            .map(t => t.textContent)
            .filter(s => /^[\d.]+$/.test(s));
        }
        T.add("㉒ 막대도 단위가 둘이면 오른쪽 축을 그림",
          rightTicks(svgBar).length >= 3, "오른쪽 눈금 " + rightTicks(svgBar).join(","));
        T.add("㉒ 선도 단위가 둘이면 오른쪽 축을 그림",
          rightTicks(svgLine).length >= 3, "오른쪽 눈금 " + rightTicks(svgLine).join(","));
        /* 눕혀 그린(상대값) 그래프에서 손에 닿는 숫자는 **실제 값**이어야
           합니다. 그림의 0~100 만 보이면, 화면에서 본 모양이 어느 값이었는지
           알 길이 표밖에 없습니다. */
        const rel = { name: "눕힌 값", color: "#000", data: [0, 100], raw: [1.2, 9.9] };
        function tips(svg) {
          const d = new DOMParser().parseFromString(svg, "image/svg+xml");
          return Array.prototype.slice.call(d.querySelectorAll("title")).map(t => t.textContent);
        }
        const relBar = tips(G.bars({ cats: ["a", "b"], series: [rel], w: 400, h: 200 }));
        const relLine = tips(G.line({ x: ["a", "b"], series: [rel], w: 400, h: 200 }));
        T.add("㉒ 눕혀 그린 막대도 올리면 실제 값을 보여 줌",
          relBar.some(s => s.indexOf("9.9") > -1) && !relBar.some(s => /\b100\b/.test(s)),
          relBar.join(" / "));
        T.add("㉒ 눕혀 그린 선도 올리면 실제 값을 보여 줌",
          relLine.some(s => s.indexOf("9.9") > -1), relLine.join(" / "));

        /* 막대 두 개가 모두 제 키로 서는가 — 한쪽이 바닥에 깔리면 실패 */
        const hs = (svgBar.match(/height="([\d.]+)"/g) || [])
          .map(s => parseFloat(s.replace(/\D*([\d.]+).*/, "$1")))
          .filter(h => h > 0);
        T.add("㉒ 작은 단위 막대가 바닥에 깔리지 않음",
          hs.length >= 4 && Math.min.apply(null, hs) > Math.max.apply(null, hs) * 0.2,
          "막대 높이 " + hs.join(","));
      }

      /* 그래프를 그림으로 떠서 엑셀에 같이 넣습니다. 떠내는 자리에서 색과
         글꼴이 CSS 변수로 적혀 있는데, 그 변수를 풀지 않으면 그림이
         **통째로 뜨지 않습니다** (글꼴 값에 들어 있는 따옴표가 XML 을
         깨뜨립니다). 한 번 겪은 고장이라 검사로 묶어 둡니다. */
      if (X && X.svgToPng && typeof document !== "undefined") {
        /* 검사 페이지는 app.css 를 싣지 않아 변수가 비어 있습니다. 실제
           화면과 같은 조건을 만들어 둡니다 — 글꼴 값에 **따옴표가 든** 그
           상태가 이 고장의 원인이었습니다. */
        const root = document.documentElement;
        root.style.setProperty("--font-data", '"IBM Plex Mono", "SFMono-Regular", monospace');
        root.style.setProperty("--c-accent", "#0369A1");
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 60 40");
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", 2); rect.setAttribute("y", 2);
        rect.setAttribute("width", 50); rect.setAttribute("height", 30);
        rect.setAttribute("fill", "var(--c-accent)");
        const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
        t.setAttribute("x", 4); t.setAttribute("y", 20);
        t.setAttribute("font-family", "var(--font-data)");   /* 따옴표가 든 값 */
        t.textContent = "12.3";
        svg.appendChild(rect); svg.appendChild(t);
        const restoreVars = function () {
          root.style.removeProperty("--font-data");
          root.style.removeProperty("--c-accent");
        };
        pending.push(X.svgToPng(svg, 1).then(function (r) {
          restoreVars();
          T.add("㉒ 그래프를 그림(PNG)으로 뜰 수 있음",
            !!r && /^data:image\/png;base64,/.test(r.png || ""), "png 아님");
        }).catch(function (e) {
          restoreVars();
          T.add("㉒ 그래프를 그림(PNG)으로 뜰 수 있음", false, (e && e.message) || "실패");
        }));
      }

      /* 챗봇의 화면 이름이 메뉴와 같은가 — 메뉴를 바꾸면 여기도 바뀌어야
         "그래프 확인으로 가줘" 가 길을 찾습니다 */
      const C = window.AICommands;
      if (C && C._sections) {
        const S2 = C._sections;
        const dataKeys = (S2.data || []).map(x => x.key);
        const hubKeys = (S2.hub || []).map(x => x.key);
        T.add("㉒ 챗봇이 아는 조회 화면 = 전체 조회 · 비교 · 그래프",
          dataKeys.indexOf("chart") > -1 && dataKeys.indexOf("compare") > -1,
          dataKeys.join(","));
        T.add("㉒ 내린 메뉴(Wiki)는 챗봇도 더 이상 안내하지 않음",
          hubKeys.indexOf("wiki") === -1, hubKeys.join(","));
      }
    })();

    /* ══════════════════════════════════════════════════════════════════
       ㉓ 회의 기록 — 회의록이 남는가 · 조치 기한이 달력에 오르는가

       회의에서 정한 것은 회의가 끝난 뒤부터 쓰입니다. 그래서 세 가지를
       봅니다: ① 만든 회의록이 저장되는가 ② 저장본이 **새로고침 뒤에도**
       남는가(= local 저장이 통째로 보존되는가) ③ 조치의 기한이 달력에
       오르고, 조치를 지우면 그 일정도 내려가는가.
       ══════════════════════════════════════════════════════════════════ */
    (function meetingRecords() {
      const P = window.Pins;
      if (!P || !P.saveMinutes) { T.add("㉓ Pins.saveMinutes 있음", false, "없음"); return; }
      const KEY = "hub.pins.v1";
      const keep = (function () {
        try { return localStorage.getItem(KEY); } catch (e) { return null; }
      })();
      const ctx = { projectId: "ZZPRJ", projectCode: "ZZ-TEST" };
      const made = [];
      try {
        const dec = P.addNote({ kind: "decision", text: "ZZ 검사용 결정", context: ctx });
        T.add("㉓ 결정을 기록할 수 있음", dec.ok, dec.reason || "");
        if (!dec.ok) return;
        made.push(dec.note.id);

        const act = P.addNote({ kind: "action", text: "ZZ 검사용 조치",
                                assignee: "검사자", due: "2026-12-24", context: ctx });
        T.add("㉓ 조치를 기록할 수 있음", act.ok, act.reason || "");

        /* ② 조치 기한이 달력에 올라갔는가 */
        if (act.ok) {
          made.push(act.note.id);
          const H = window.HubCalendar;
          /* all() 로 봅니다 — eventsOn() 은 지금 고른 과제로 한 번 거르는데,
             검사용 일정은 검사용 과제(ZZPRJ)에 붙어 있어 걸러집니다. */
          const onDay = H ? H.all().filter(e => e.date === "2026-12-24") : [];
          const hit = onDay.filter(e => String(e.ko || "").indexOf("ZZ 검사용 조치") > -1);
          T.add("㉓ 조치 기한이 달력에 오름", hit.length === 1,
            "달력에 " + hit.length + "건");
        }

        /* ★ 적지 않은 것은 채우지 않습니다 — 제목 · 기한 · 회의록 문구 */
        const cur0 = P.currentMeeting();
        T.add("㉓ 회의 제목을 지어내지 않음",
          !!cur0 && !cur0.title, "제목=" + (cur0 ? String(cur0.title) : "회의 없음"));
        T.add("㉓ 제목이 없으면 과제 · 날짜로 가리킴",
          !!(cur0 && /\d{4}-\d{2}-\d{2}/.test(P.meetingLabel(cur0))),
          cur0 ? P.meetingLabel(cur0) : "");

        /* 기한을 비운 조치는 To-Do 기한도 비어 있어야 합니다 (오늘로 채우지 않음) */
        const noDue = P.addNote({ kind: "action", text: "ZZ 기한 없는 조치",
                                  assignee: "검사자", context: ctx });
        if (noDue.ok) {
          made.push(noDue.note.id);
          const tl = (window.Todos && window.Todos.state) ? (window.Todos.state().list || []) : [];
          const td = tl.find(t => t.id === noDue.note.todoId);
          T.add("㉓ 기한을 비우면 To-Do 기한도 비어 있음",
            !!td && !td.due, td ? "기한=" + String(td.due) : "To-Do 없음");
          T.add("㉓ 기한이 없으면 달력에도 올리지 않음", !noDue.note.calId,
            "calId=" + String(noDue.note.calId));
        }

        /* 제목을 적으면 회의록 머리글이 그 제목이 됩니다 */
        const st = P.setMeetingTitle("ZZ 오늘 회의 제목", ctx);
        T.add("㉓ 회의 제목을 사람이 적을 수 있음", st.ok, st.reason || "");

        /* 안건 및 논의 메모 — 적은 그대로(줄바꿈까지) 회의록에 들어갑니다 */
        const memo = "ZZ 첫째 줄\nZZ 둘째 줄";
        const mn = P.setMeetingNote(memo, ctx);
        T.add("㉓ 안건 · 논의 메모를 적을 수 있음", mn.ok, mn.reason || "");
        const curN = P.currentMeeting();
        const txtN = P.minutesText(curN ? curN.id : null);
        T.add("㉓ 회의록에 [안건 및 논의 내용] 절이 생김",
          txtN.indexOf("## 안건 및 논의 내용") > -1, txtN.slice(0, 60));
        T.add("㉓ 메모의 줄 나눔이 그대로 남음",
          txtN.indexOf("ZZ 첫째 줄\nZZ 둘째 줄") > -1, "줄이 합쳐졌습니다");

        /* 메모를 비우면 그 절도 사라집니다 — 빈 제목만 남기지 않습니다 */
        P.setMeetingNote("", ctx);
        const txtC = P.minutesText(curN ? curN.id : null);
        T.add("㉓ 메모를 비우면 그 절도 사라짐",
          txtC.indexOf("## 안건 및 논의 내용") === -1, "빈 절이 남았습니다");
        P.setMeetingNote(memo, ctx);

        /* ① 회의록 저장 */
        const cur = P.currentMeeting();
        const txt = P.minutesText(cur ? cur.id : null);
        T.add("㉓ 회의록 머리글이 적은 제목 그대로",
          txt.indexOf("# ZZ 오늘 회의 제목") === 0, txt.slice(0, 40));
        T.add("㉓ 회의록에 자동 문구가 섞이지 않음",
          !/- 없음|Batch_Data_example|±2SD|데이터 리뷰 회의/.test(txt),
          txt.split("\n").filter(l => /없음|Batch_Data|2SD/.test(l)).join(" / "));
        const sv = P.saveMinutes(cur ? cur.id : null);
        T.add("㉓ 회의록이 저장됨", sv.ok, sv.reason || "");
        const list = P.savedMinutes ? P.savedMinutes() : [];
        T.add("㉓ 저장된 회의록을 다시 찾을 수 있음",
          list.some(m => cur && m.id === cur.id && (m.minutes || "").length > 20),
          "저장본 " + list.length + "건");
        const mine = list.find(m => cur && m.id === cur.id);
        T.add("㉓ 회의록에 결정 · 조치 건수가 함께 적힘",
          !!(mine && mine.counts && mine.counts.decisions >= 1),
          mine && mine.counts ? JSON.stringify(mine.counts) : "없음");

        /* 저장해 둔 회의록을 지금 형식으로 다시 만들기 —
           만든 시각 · 만든 사람은 그대로 두어야 합니다 (누가 언제 정리했는지는
           표기를 바꿨다고 달라지지 않습니다) */
        if (mine) {
          const keepAt = mine.minutesAt, keepBy = mine.minutesBy;
          mine.minutes = mine.minutes + "\n- 없음\n— 값은 Batch_Data_example.xlsx 원본에서 조회한 것입니다.";
          const rf = P.refreshMinutes(mine.id);
          T.add("㉓ 옛 형식 회의록을 지금 형식으로 다시 만들 수 있음",
            rf.ok && rf.changed && !/- 없음|Batch_Data_example/.test(mine.minutes),
            rf.reason || (rf.changed ? "문구가 남았습니다" : "바뀌지 않았습니다"));
          T.add("㉓ 다시 만들어도 만든 시각 · 사람은 그대로",
            mine.minutesAt === keepAt && mine.minutesBy === keepBy,
            mine.minutesAt + " / " + mine.minutesBy);
        }

        /* 제목 지우기 — 잘못 적었을 때, 그리고 예전 자동 제목을 걷어낼 때 */
        const rc = P.clearMeetingTitle(cur ? cur.id : null);
        T.add("㉓ 회의 제목을 비울 수 있음",
          rc.ok && !rc.meeting.title, rc.reason || "제목이 남았습니다");
        T.add("㉓ 제목을 비우면 과제 · 날짜로 돌아감",
          /\d{4}-\d{2}-\d{2}/.test(P.meetingLabel(rc.meeting || {})),
          P.meetingLabel(rc.meeting || {}));

        /* ③ local 저장이 통째로 남는가 — 네 묶음이 같은 키를 쓰면서 마지막
           묶음이 빈 목록으로 덮으면, 새로고침 때 회의 기록이 통째로 사라집니다 */
        if (!(window.Persist && window.Persist.isServer && window.Persist.isServer())) {
          let raw = null;
          try { raw = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) {}
          T.add("㉓ 저장본에 회의 · 결정이 모두 들어 있음 (새로고침해도 남음)",
            !!(raw && raw.meetings && raw.meetings.length && raw.notes && raw.notes.length),
            raw ? "키=" + Object.keys(raw).join(",") : "저장본 없음");
        }

        /* 조치를 지우면 달력 일정도 내려간다 */
        if (act.ok) {
          P.removeNote(act.note.id);
          const H2 = window.HubCalendar;
          const left = (H2 ? H2.all().filter(e => e.date === "2026-12-24") : [])
            .filter(e => String(e.ko || "").indexOf("ZZ 검사용 조치") > -1);
          T.add("㉓ 조치를 지우면 달력 일정도 내려감", left.length === 0,
            "남은 일정 " + left.length + "건");
        }
      } finally {
        made.forEach(function (id) { try { P.removeNote(id); } catch (e) {} });
        try {
          if (keep === null) localStorage.removeItem(KEY);
          else localStorage.setItem(KEY, keep);
        } catch (e) {}
      }
    })();

    /* ══════════════════════════════════════════════════════════════════
       ㉔ 복합 질의 — "A 가 가장 높은 시료의 B 는?"

       한 문장에 **고르는 기준**과 **보고 싶은 값**이 따로 들어 있습니다.
       예전에는 둘을 한 바구니에 담아 먼저 걸린 쪽으로 최고값만 답했고,
       물어본 값은 "비슷한 항목" 으로 흘렸습니다 — 답이 아니라 다른 답을
       준 것입니다. 여기서는 **그 시료의 값이 맞는지**까지 봅니다.
       ══════════════════════════════════════════════════════════════════ */
    (function relationalQueries() {
      const AE = window.AskEngine, AT = window.AskTables;
      if (!AE || !AT) { T.add("㉔ 엔진 있음", false, "없음"); return; }
      const t = AT.internal();
      const has = k => t.columns.some(c => c.key === k);
      if (!has("titerHCCF") || !has("maxVCD")) { T.add("㉔ 검사할 항목 있음", false, "항목 없음"); return; }

      const r = AE.answer("Titer가 가장 높은 샘플의 Max VCD는 어때?", { table: t });
      T.add("㉔ 복합 질의를 복합으로 읽음", r.kind === "relational",
        "kind=" + r.kind + " / " + String(r.headline).slice(0, 60));

      /* 답이 **그 시료의** 값인지 직접 대조합니다 */
      const withT = t.rows.filter(x => typeof x.titerHCCF === "number");
      const top = withT.slice().sort((a, b) => b.titerHCCF - a.titerHCCF)[0];
      if (top && r.kind === "relational") {
        const head = String(r.headline || "");
        T.add("㉔ 기준 시료를 바르게 지목함", head.indexOf(top.__label) > -1,
          "지목=" + head.slice(0, 60) + " / 실제=" + top.__label);
        const v = top.maxVCD;
        T.add("㉔ 답이 그 시료의 값",
          v === null || v === undefined
            ? /기록돼 있지 않/.test(head)
            : head.indexOf(String(v)) > -1 || head.indexOf(String(Number(v).toFixed(1))) > -1 ||
              head.indexOf(String(Number(v).toFixed(2))) > -1,
          "그 시료의 Max VCD=" + v + " / 문장=" + head.slice(0, 80));
        T.add("㉔ 묻지 않은 시료의 값을 섞지 않음",
          !!(r.sortMetric && r.sortMetric.key === "titerHCCF" && r.metric && r.metric.key === "maxVCD"),
          JSON.stringify({ sort: r.sortMetric, target: r.metric }));
      }

      /* 기준이 일반어("수율")여도 읽어야 합니다 — 일반어는 단일 질문에서는
         버려지지만, 복합 질의에서는 그 말이 고르는 기준입니다 */
      if (has("downstream_totalYield")) {
        const r2 = AE.answer("가장 낮은 수율을 보인 배치의 titer는?", { table: t });
        T.add("㉔ 일반어가 기준일 때도 복합으로 읽음",
          r2.kind === "relational" && r2.sortMetric && r2.sortMetric.key === "downstream_totalYield",
          "kind=" + r2.kind + " sort=" + (r2.sortMetric ? r2.sortMetric.key : "-"));
      }

      /* 지표가 하나뿐인 질문은 **예전 그대로** 최고값 경로로 가야 합니다 */
      const r3 = AE.answer("Titer 가장 높은 배치", { table: t });
      T.add("㉔ 단일 지표 질문은 그대로 최고값", r3.kind === "extreme",
        "kind=" + r3.kind);

      /* 이름을 조금 다르게 써도 — 되묻거나(가까운 이름) 바로 알아듣거나 */
      const r4 = AE.answer("titor 평균 알려줘", { table: t });
      T.add("㉔ 비슷한 이름이면 되물어 고르게 함",
        (r4.suggestions || []).some(s => /titer/i.test(s)) || /혹시/.test(String(r4.headline)),
        "제안=" + (r4.suggestions || []).join(", "));

      const r5 = AE.answer("바이어빌리티는?", { table: t });
      T.add("㉔ 음차 표기도 같은 항목으로 읽음",
        !!(r5.metric && r5.metric.key === "finalViability"),
        "metric=" + (r5.metric ? r5.metric.key : "-"));
    })();

    /* ══════════════════════════════════════════════════════════════════
       ⑯ 화면 조작 명령 — 읽는 것과 읽지 않는 것

       실행은 여기서 하지 않습니다 (화면을 옮기면 검사 페이지가 사라집니다).
       확인하는 것은 **경계** 하나입니다 — 값을 묻는 말을 조작으로 읽으면
       사용자는 답 대신 화면이 바뀌는 것을 보게 되고, 되돌릴 말을 또 찾아야
       합니다. 그 경계가 무너지는 쪽이 더 나쁩니다.
       ══════════════════════════════════════════════════════════════════ */
    (function commandChecks() {
      const C = window.AICommands;
      if (!C) { T.add("⑯ AICommands 있음", false, "window.AICommands 없음"); return; }
      const cases = [
        ["대시보드 보여줘", "navigate"],
        /* 탭 이름이 집계어와 겹쳐도 조회로 새지 않아야 합니다 (반대쪽) */
        ["TA1 과 TA2 비교해줘", null],
        ["데이터 조회로 이동", "navigate"],
        ["배양공정팀 선택해줘", "team"],
        ["새 스터디 창 열어줘", "newStudy"],
        ["DB 비워줘", "refuse"],
        ["전체 삭제해줘", "refuse"],
        /* 값을 묻는 말은 조작이 아닙니다 — 지금까지처럼 조회로 가야 합니다 */
        ["정제 데이터 보여줘", null],
        ["정제공정팀 수율 평균", null],
        ["TA1에 대한 데이터를 알려줘", null],
        ["Max VCD 가장 높은 시료는?", null]
      ];
      const bad = cases.filter(function (c) {
        const p = C.detect(c[0]);
        return (p ? p.kind : null) !== c[1];
      });
      T.add("⑯ 조작 명령만 조작으로 읽음", !bad.length,
        bad.map(function (c) {
          const p = C.detect(c[0]);
          return "\"" + c[0] + "\" → " + (p ? p.kind : "null") + " (기대 " + (c[1] || "null") + ")";
        }).join(" / "));

      /* ★ 탭 전환은 **그 화면에 있을 때만** 뜻이 있습니다. 검사 페이지는
         데이터 조회가 아니므로 화면을 그렇다고 알려 주고 봅니다.

         이 자리에서 한 번 깨졌습니다 — "시료 비교" 탭 이름의 "비교" 를
         값을 묻는 말로 보고 탭을 열지 않았습니다. 탭 이름과 집계어가
         겹치는 유일한 곳이라 고정해 둡니다. */
      if (window.AIContext && window.AIContext.setPage) {
        const keep = (window.AIContext.get() || {}).page || null;
        window.AIContext.setPage("data");
        const secCases = [["시료 비교 보여줘", "section"],
                          ["시료별로 돌아가", "section"],
                          ["TA1 과 TA2 비교해줘", null]];
        const secBad = secCases.filter(function (c) {
          const p = C.detect(c[0]);
          return (p ? p.kind : null) !== c[1];
        });
        window.AIContext.setPage(keep);
        T.add("⑯ 탭 이름이 집계어와 겹쳐도 탭을 엶", !secBad.length,
          secBad.map(function (c) {
            const p = C.detect(c[0]);
            return "\"" + c[0] + "\" → " + (p ? p.kind : "null");
          }).join(" / "));
      }
    })();

    /* ══════════════════════════════════════════════════════════════════
       ⑰ 넓게 물어도 막지 않되, 없는 것은 없다고 말하는가

       "항목을 특정하지 못했습니다" 경고를 없애면서 반대쪽으로 넘어가기
       쉬운 자리입니다 — 무엇을 물어도 요약을 내놓으면, **없는 시료를
       물어도 다른 시료의 표가 답처럼 보입니다.** 0건 경고보다 나쁩니다.

       그래서 셋을 한 쌍으로 봅니다.
         · 넓은 질문 → 경고 없이 요약 (반영 못 함 이 비어 있어야 함)
         · 없는 이름 → 머리말에서 "없는 이름" 이라고 말해야 함
         · 원본에 없는 항목(pH) → "컬럼이 없어" 를 말해야 함
       ══════════════════════════════════════════════════════════════════ */
    (function conversationalChecks() {
      const AE = window.AskEngine, AT = window.AskTables;
      if (!AE || !AT) { T.add("⑰ 엔진 있음", false, "AskEngine·AskTables 없음"); return; }
      const t = AT.internal();
      const anyName = t.rows.length ? t.rows[0].__label : null;
      if (!anyName) { T.add("⑰ 검사할 시료 있음", false, "표가 비었습니다"); return; }

      /* 넓은 질문 — 경고 없이 요약으로 답해야 합니다 */
      const wide = AE.answer(anyName + " 어때?");
      T.add("⑰ 넓게 물으면 경고 없이 요약으로 답함",
        (wide.kind === "overview" || wide.kind === "entity") &&
        !(wide.unhandled || []).length &&
        !/특정하지 못/.test(String(wide.note || "") + String(wide.headline || "")),
        "kind=" + wide.kind + " unhandled=" + JSON.stringify(wide.unhandled || []));
      T.add("⑰ 요약에 이어 묻는 한마디가 붙음",
        !!wide.followUp && /지표|이름/.test(String(wide.followUp)),
        "followUp=" + String(wide.followUp || "").slice(0, 60));

      /* 없는 이름 — 조용히 전체 요약만 내놓으면 안 됩니다.
         ★ 숫자가 섞인 이름(ZZNOPE9)만 잡고 순 영문(ZZNOPE)은 놓치던
           구멍이 있었습니다. 그리고 "TA1" 이 있을 때 "TA10" 을 물으면
           앞부분이 걸려 아는 이름 취급을 했습니다 — 둘 다 "없는 시료를
           물었는데 다른 시료의 표가 답처럼 나오는" 같은 사고입니다. */
      const ghosts = ["ZZNOPE9 어때?", "ZZNOPE 어때?",
                      anyName + "ZZ 어때?", anyName + "99 어때?"];
      const ghostBad = ghosts.filter(function (q) {
        const g = AE.answer(q);
        return !/없는 이름|기록에 없/.test(String(g.headline || ""));
      });
      T.add("⑰ 없는 이름은 없다고 머리말에서 말함 (영문 · 숫자 · 앞부분 겹침)",
        !ghostBad.length, ghostBad.join(" / "));

      /* ⑱ Study 이름이 시료 이름 안에 들어 있을 때.

         production 에 Study "Test" 와 시료 "Test-New" 가 있었습니다.
         "Test-New 데이터 보여줘" 가 Study "Test" 와 시료 "Test-New" 를
         둘 다 범위로 잡고 둘을 함께 적용해(AND) 0건이 됐습니다 — 방금
         입력한 값을 두고 "찾지 못했습니다" 라고 답했습니다. */
      (function nestedNameCheck() {
        const D = window.Dataset, E = window.Entries;
        if (!D || !E) return;
        const prj = (window.DATA_PROJECTS || [])[0];
        if (!prj) return;
        const bStore = (function () {
          try { return localStorage.getItem("hub.dataset.v1"); } catch (e) { return null; }
        })();
        const eStore = (function () {
          try { return localStorage.getItem("hub.entries.v1"); } catch (e) { return null; }
        })();
        const sid = "ZZS-" + Date.now().toString(36);
        const bid = "ZZB-" + Date.now().toString(36);
        try {
          const outer = D.addStudy({ projectId: prj.id, name: "ZZOUTER" });
          const inner = D.addStudy({ projectId: prj.id, name: "ZZOTHER", id: sid });
          if (!outer.ok || !inner.ok) { T.add("⑱ 검사용 Study 생성", false, "생성 실패"); return; }
          D.addBatch({ studyId: inner.study.id, id: bid, team: "upstream",
                       expNo: "ZZOUTER-SUB", hidden: true, initialDate: "2026-01-01" });
          E.addSample({ batchId: bid, studyId: inner.study.id, team: "upstream",
                        name: "ZZOUTER-SUB" });
          window.Repo.setValue("batch:" + bid, "maxVCD", 42.5, null, { action: "Create" });
          AT.invalidate();
          const a = AE.answer("ZZOUTER-SUB 어때?");
          T.add("⑱ 시료 이름에 든 Study 이름이 범위를 비우지 않음",
            a.kind !== "no-rows" && /ZZOUTER-SUB/.test(String(a.scopeLabel || "")) &&
            !/ZZOUTER\b(?!-)/.test(String(a.scopeLabel || "").replace("ZZOUTER-SUB", "")),
            "scope=" + a.scopeLabel + " kind=" + a.kind);
        } finally {
          try {
            [bid].forEach(function (id) {
              const l = D.all().batches; const i = l.findIndex(b => b.id === id);
              if (i > -1) l.splice(i, 1);
              const arr = window.DATA_BATCHES || []; const j = arr.findIndex(b => b.id === id);
              if (j > -1) arr.splice(j, 1);
            });
            const st = window.DATA_STUDIES || [];
            for (let i = st.length - 1; i >= 0; i--) {
              if (st[i] && /^ZZO/.test(String(st[i].name))) st.splice(i, 1);
            }
          } catch (e) {}
          if (E.reset) E.reset();
          restore(eStore);
          try {
            if (bStore === null) localStorage.removeItem("hub.dataset.v1");
            else localStorage.setItem("hub.dataset.v1", bStore);
          } catch (e) {}
          AT.invalidate();
        }
      })();

      /* ⑲ 인사 · 사용법은 표가 아니라 말로 받습니다.

         "안녕?" 에 시료 표가 나오면 사람은 이 창을 대화창으로 보지 않게
         됩니다. 반대로 짧은 질문이 인사로 삼켜지면 답을 못 받습니다 —
         두 방향을 한 쌍으로 봅니다. */
      const toneCases = [
        ["안녕?", "greet"], ["하이", "greet"],
        /* "뭐 할 수 있어?" 는 인사보다 사용법이 맞는 답입니다 — 질문 유형과
           조회 가능한 항목을 실제로 세어 알려 줍니다 */
        ["뭐 할 수 있어?", "help"], ["어떤 기능이 있어?", "help"], ["사용법", "help"],
        /* 아래는 인사로 삼켜지면 안 되는 짧은 질문들 */
        ["데이터 있어?", null], ["시작일?", null], [anyName + " 있어?", null]
      ];
      const toneBad = toneCases.filter(function (c) {
        const k = AE.answer(c[0]).kind;
        return c[1] ? k !== c[1] : (k === "greet");
      });
      T.add("⑲ 인사·사용법은 말로, 짧은 질문은 질문으로",
        !toneBad.length,
        toneBad.map(c => "\"" + c[0] + "\" → " + AE.answer(c[0]).kind).join(" / "));

      /* ⑳ 용어 설명 — 뜻을 물으면 뜻을, 값을 물으면 값을.

         "IVCD가 뭐야?" 가 문헌 검색으로 가고 있었습니다. 우리 표에 있는
         컬럼인데도요. 고치면서 반대쪽이 위험해집니다 — 설명이 값을
         가로채면 "IVCD 평균" 처럼 매일 쓰는 질문이 망가집니다. */
      if (window.HubTerms) {
        const defCases = [
          ["IVCD가 뭐야?", "define"], ["IVCD 무슨 뜻이야", "define"],
          ["Total Yield이란?", "define"], ["CQA 설명해줘", "define"],
          ["시료가 뭐야?", "define"],
          /* 값을 묻는 질문은 그대로 값으로 — "뭐야" 가 섞여도 계산이
             먼저입니다 ("제일 최근에 한 실험이 뭐야" 가 용어 설명으로
             끌려가 28건을 답한 적이 있습니다) */
          ["IVCD 평균", "stat"], ["IVCD 가장 높은 시료는?", "extreme"],
          ["IVCD 제일 높은 게 뭐야", "extreme"]
        ];
        const defBad = defCases.filter(c => AE.answer(c[0]).kind !== c[1]);
        T.add("⑳ 뜻을 물으면 뜻을, 값을 물으면 값을",
          !defBad.length,
          defBad.map(c => "\"" + c[0] + "\" → " + AE.answer(c[0]).kind +
            " (기대 " + c[1] + ")").join(" / "));

        /* 용어집에 없는 말은 지어내지 않습니다.
           ★ "무슨 뜻" 처럼 뜻을 분명히 물을 때입니다 — "뭐야" 는 값을
             묻는 말로도 쓰여 그쪽은 기록 조회로 갑니다 (의도된 경계). */
        const none = AE.answer("ZZTERM이 무슨 뜻이야?");
        T.add("⑳ 모르는 용어는 없다고 말함",
          none.kind === "define-none" || /용어집에 없/.test(String(none.headline || "")),
          "kind=" + none.kind + " head=" + String(none.headline || "").slice(0, 60));

        /* 설명 안에는 기준값이 없어야 합니다 — 설명의 숫자가 규격처럼
           읽히면, 등록된 규격과 어긋나는 순간 어느 쪽이 맞는지 알 수
           없게 됩니다. 숫자는 데이터에서 읽은 범위만 붙습니다. */
        const numInText = window.HubTerms.all().filter(function (x) {
          return /\d/.test(String(x.what || "")) || /\d/.test(String(x.why || ""));
        }).map(x => x.ko);
        T.add("⑳ 용어 설명 본문에 숫자를 적지 않음",
          !numInText.length, numInText.join(" · "));

        /* 스키마 항목과 연결된 용어는 실제 컬럼을 가리켜야 합니다 —
           스키마가 바뀌면 끊긴 연결이 조용히 남습니다. */
        const t2 = AT.internal();
        const broken = window.HubTerms.all().filter(function (x) {
          if (!x.group || !x.key) return false;
          const k = window.Repo.fieldKey(x.group, x.key);
          return !t2.columns.some(c => c.key === k);
        }).map(x => x.ko);
        T.add("⑳ 용어가 가리키는 항목이 스키마에 있음",
          !broken.length, broken.join(" · "));
      }

      /* 원본에 컬럼이 없는 항목 — 값을 만들지도, 조용히 넘어가지도 않습니다 */
      const ph = AE.answer("pH 평균 알려줘");
      T.add("⑰ 기록 없는 항목은 없다고 먼저 말함",
        /컬럼이 없어/.test(String(ph.headline || "") + String(ph.note || "")),
        "headline=" + String(ph.headline || "").slice(0, 80));

      /* 팀별로 나눠 적은 같은 이름의 시료는 한 줄로 모읍니다 —
         데이터 조회 화면과 같은 규칙이어야 합니다 */
      const names = {};
      t.rows.forEach(function (r) {
        const k = String(r.study || "") + "|" + String(r.__label || "").toLowerCase();
        names[k] = (names[k] || 0) + 1;
      });
      const dupKey = Object.keys(names).find(k => names[k] > 1);
      if (dupKey) {
        const label = dupKey.split("|")[1];
        const merged = AE.answer(label + " 어때?");
        T.add("⑰ 같은 이름의 팀별 시료를 한 줄로 모음",
          merged.kind === "overview" &&
          (!merged.rows || merged.rows.length < names[dupKey] ||
           /들어 있는 값을 모아/.test(String(merged.headline || ""))),
          "rows=" + (merged.rows ? merged.rows.length : "facts") +
          " (원본 " + names[dupKey] + "행)");
      }
    })();

    return Promise.all(pending).then(function () {
    const bad = T.out.filter(x => !x.pass);
    return {
      pass: !bad.length,
      checks: [{ id: "S. Single Source of Truth", pass: !bad.length,
        detail: (T.out.length - bad.length) + "/" + T.out.length + " 통과" +
          (bad.length ? " · 실패: " + bad.map(x => "\"" + x.q + "\"(" + x.fail.join(",") + ")").join(" ; ") : "") }],
      items: T.out
    };
    });
  }

  function tableValue(batchId, col) {
    const t = window.AskTables.internal();
    const r = t.rows.find(x => x.__id === batchId);
    return r ? r[col] : undefined;
  }
  function same(a, b) {
    if (a == null && b == null) return true;
    return a === b;
  }

  function text(res) {
    let s = "";
    (res.items || []).forEach(function (x) {
      s += (x.pass ? " OK  " : "★NG  ") + x.q + (x.pass ? "" : "  — " + x.fail.join(",")) + "\n";
    });
    return s;
  }

  return { run: run, text: text };
})();
