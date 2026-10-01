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

      /* ── 일자별 Titer — 예전에 키가 어긋나 있던 자리 ────────────── */
      const dBefore = R.valueOf(b, DAY.group, DAY.key);
      R.setValue(scope, DAY.entry, { num: TEST_DAY_VALUE }, "SSOT 일자별 검사",
        { baseValue: dBefore, baseSource: "Excel 원본" });
      T.add("일자별 Titer · Repo 반영",
        R.valueOf(b, DAY.group, DAY.key) === TEST_DAY_VALUE,
        "값=" + R.valueOf(b, DAY.group, DAY.key) + " (EBR 은 titer_D10 으로 저장합니다)");
      T.add("일자별 Titer · 조회 표 반영",
        tableValue(b.id, DAY.col) === TEST_DAY_VALUE,
        "표=" + tableValue(b.id, DAY.col));

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

      try {
        /* a) 스키마 항목명은 원본 객체에 반영되고, 원래 이름은 남습니다 */
        const g = (window.DATA_ANALYTE_GROUPS || []).find(x => x.id === "ieHPLC");
        const it = g && (g.items || []).find(x => x.key === "acidic");
        if (!it) { T.add("⑩ 검사 대상 항목이 있음", false, "ieHPLC.acidic 없음"); return; }
        const was = A.originalOf(it, "label");

        A.set("item:ieHPLC.acidic", "검사용 산성", was);
        T.add("⑩ 항목명이 스키마에 반영됨", it.label === "검사용 산성",
          "DATA_ANALYTE_GROUPS 의 label 이 " + it.label);
        T.add("⑩ 원래 항목명이 보존됨", A.originalOf(it, "label") === was,
          "원래 이름이 " + A.originalOf(it, "label"));
        T.add("⑩ 이름 변경이 이력에 남음",
          A.historyOf("item:ieHPLC.acidic").some(h => h.to === "검사용 산성" && h.by && h.at),
          "이력에 작성자·시각과 함께 남지 않았습니다");

        /* 이름을 고쳐도 값을 읽는 키는 그대로여야 합니다 */
        const before = R.valueOf(b, FIELD.group, FIELD.key);
        A.set("item:upstream.maxVCD", "검사용 VCD", "Max VCD");
        T.add("⑩ 이름을 고쳐도 값이 그대로 읽힘",
          same(R.valueOf(b, FIELD.group, FIELD.key), before),
          "valueOf 가 " + R.valueOf(b, FIELD.group, FIELD.key) + " (기대 " + before + ")");

        /* 빈 문자열은 덧씌움을 걷어 냅니다 — 되돌릴 길이 있어야 합니다 */
        A.set("item:ieHPLC.acidic", "", was);
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
        A.set("item:ieHPLC.acidic", "", was0("ieHPLC", "acidic"));
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
        const seedDays = Object.keys((seedB && seedB.upstream && seedB.upstream.titer) || {});
        const newDays = Object.keys((nb.upstream && nb.upstream.titer) || {});
        T.add("⑫ 일자 키가 씨앗과 같음", seedDays.length > 0 && newDays.length === seedDays.length,
          "씨앗 " + seedDays.length + "개 · 새 배치 " + newDays.length + "개");

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
      } finally {
        /* 메모리 상태만 되돌립니다 (검사 페이지는 저장하지 않습니다) */
        const list = D.all().batches;
        const i = list.findIndex(b => b.id === madeId);
        if (i > -1) list.splice(i, 1);
        const arr = window.DATA_BATCHES;
        const j = arr.findIndex(b => b.id === madeId);
        if (j > -1) arr.splice(j, 1);
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
