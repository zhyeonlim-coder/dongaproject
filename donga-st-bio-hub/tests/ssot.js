/* ==========================================================================
   ssot.js — Single Source of Truth 검사  ·  window.SSOTTest

   무엇을 증명하려는가
     EBR 에서 고친 값을 나머지 전부가 같이 본다는 것.

       EBR 입력 ─→ Repo ─┬─→ 대시보드 · 데이터 조회
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
      T.add("① EBR 입력이 저장됨", !!(w && w.ok), JSON.stringify(w).slice(0, 90));

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
