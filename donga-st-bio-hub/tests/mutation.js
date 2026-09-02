/* ==========================================================================
   mutation.js — 회귀 스위트가 실제로 무언가를 지키는지 검사  ·  window.AskMutation

   왜 필요한가
     회귀 테스트가 전부 통과했다는 사실만으로는 아무것도 증명되지 않습니다.
     검사가 느슨하면 코드를 망가뜨려도 여전히 전부 통과합니다. 그러면
     "249건 통과" 는 안심의 근거가 아니라 착시입니다.

   무엇을 하는가
     의도적으로 코드를 한 군데씩 망가뜨리고, 회귀 스위트가 그것을 잡아내는지
     봅니다. 잡지 못한 변이가 하나라도 있으면 그 지점에는 검사가 없는 것이며,
     그 자리에 진짜 버그가 들어와도 아무도 모릅니다.

   어떻게 망가뜨리는가
     모듈 교체로 되는 것은 교체하고, 엔진 내부(클로저 안)는 소스 텍스트를
     바꿔 다시 평가합니다. "테스트용 스위치" 를 제품 코드에 심지 않습니다 —
     그런 스위치는 실제 코드 경로가 아니라 스위치를 검사하게 됩니다.
   ========================================================================== */

window.AskMutation = (function () {
  "use strict";

  const SRC = {};   /* 원본 소스 텍스트 보관 */

  function load(paths) {
    return Promise.all(paths.map(p =>
      fetch(p, { cache: "no-store" }).then(r => r.text()).then(t => { SRC[p] = t; })));
  }

  function evalScript(text) { (0, eval)(text); }

  /* 소스 한 군데를 바꾼 상태로 fn 을 돌리고, 끝나면 반드시 원상복구합니다.
     복구가 새는 줄 모르고 다음 검사를 하면 그때부터 결과 전체를 믿을 수
     없으므로, 복구는 finally 에 둡니다. */
  function withMutatedSource(path, from, to, fn) {
    const orig = SRC[path];
    if (orig == null) throw new Error("소스를 불러오지 않았습니다: " + path);
    const mutated = orig.replace(from, to);
    if (mutated === orig) throw new Error("변이가 소스에 적용되지 않았습니다 (패턴 불일치)");
    try {
      evalScript(mutated);
      window.AskTables.invalidate();
      return fn();
    } finally {
      evalScript(orig);
      window.AskTables.invalidate();
    }
  }

  /* 모듈 함수 하나를 갈아 끼운 상태로 fn 을 돌립니다 */
  function withPatch(obj, key, value, fn) {
    const orig = obj[key];
    obj[key] = value;
    try {
      window.AskTables.invalidate();
      return fn();
    } finally {
      obj[key] = orig;
      window.AskTables.invalidate();
    }
  }

  const ENG = "../assets/js/ask-engine.js";
  const VER = "../assets/js/ask-verify.js";
  const TBL = "../assets/js/data/tables.js";
  const PRV = "../assets/js/data/provenance.js";
  const SPC = "../assets/js/data/specs.js";

  /* ── 변이 목록 ────────────────────────────────────────────────────────
     expect: 이 변이를 잡아야 하는 검사 그룹. 다른 그룹이 우연히 잡은 것은
     그 지점에 검사가 있다는 뜻이 아니므로 따로 표시합니다. */
  const MUTANTS = [
    /* ── 이번에 새로 추가한 검사 3종 (F1 기간 · F5 생성값 · F10 검증 필요) ── */
    { id: "M1  기간: 연도 두 번 파싱 제거",
      why: "F1. \"2024년 11월부터 2025년 1월까지\" 가 다시 5건으로 줄어드는가",
      expect: "Q",
      run: fn => withMutatedSource(ENG,
        "if (!c.period) eat(/(20\\d{2}|\\d{2})\\s*년\\s*(\\d{1,2})\\s*월\\s*(?:~|-|—|부터|에서)",
        "if (false) eat(/(20\\d{2}|\\d{2})\\s*년\\s*(\\d{1,2})\\s*월\\s*(?:~|-|—|부터|에서)", fn) },

    { id: "M2  기간: 종료 연도를 시작 연도로",
      why: "F1. 연도를 넘는 기간의 끝이 조용히 앞당겨지는가",
      expect: "Q",
      run: fn => withMutatedSource(ENG,
        "c.period = { from: iso(y1, a, 1), to: iso(y2, b, lastDay(y2, b)) };",
        "c.period = { from: iso(y1, a, 1), to: iso(y1, b, lastDay(y1, b)) };", fn) },

    /* 없는 달 검사는 기간 파싱 분기마다 따로 있습니다. 하나로 뭉뚱그려
       변이시키면 한 분기만 검사돼 있어도 "잡힘" 이 나옵니다 — 분기별로
       따로 망가뜨려야 어디에 검사가 없는지 드러납니다. */
    { id: "M3a 기간: 13월 통과 (연도 반복 분기)",
      why: "\"2024년 13월부터 2025년 1월\" 이 조용히 기간이 되는가",
      expect: "Q",
      run: fn => withMutatedSource(ENG,
        "const a = +m[2], b = +m[4];\n      if (a < 1 || a > 12) return badMonth(a);\n      if (b < 1 || b > 12) return badMonth(b);",
        "const a = +m[2], b = +m[4];", fn) },

    { id: "M3b 기간: 13월 통과 (연도 한 번 분기)",
      why: "\"2024년 1월부터 13월까지\" 가 조용히 기간이 되는가",
      expect: "Q",
      run: fn => withMutatedSource(ENG,
        "const a = +m[2], b = +m[3], endY = b >= a ? y : y + 1;\n      if (a < 1 || a > 12) return badMonth(a);\n      if (b < 1 || b > 12) return badMonth(b);",
        "const a = +m[2], b = +m[3], endY = b >= a ? y : y + 1;", fn) },

    { id: "M3c 기간: 13월 통과 (단일 연-월 분기)",
      why: "\"2024년 13월\" 이 조용히 기간이 되는가",
      expect: "Q",
      run: fn => withMutatedSource(ENG,
        "const y = m[1].length === 2 ? 2000 + +m[1] : +m[1], a = +m[2];\n      if (a < 1 || a > 12) return badMonth(a);",
        "const y = m[1].length === 2 ? 2000 + +m[1] : +m[1], a = +m[2];", fn) },

    { id: "M3d 기간: 13월 통과 (구분자 변형 분기)",
      why: "\"2024-13\" 이 조용히 버려지거나 기간이 되는가",
      expect: "Q",
      run: fn => withMutatedSource(ENG,
        "const y = +m[1], a = +m[2];\n      if (a < 1 || a > 12) return badMonth(a);",
        "const y = +m[1], a = +m[2];", fn) },

    { id: "M4  생성값: generated 표식 제거",
      why: "F5. 생성값이 실측과 구별되지 않게 되는가",
      expect: "Q",
      run: fn => withPatch(window.Provenance, "isGeneratedColumn", () => false, fn) },

    { id: "M5  생성값: 왜 생성했는지를 제거",
      why: "F5. \"생성된 값\" 이라고만 하고 이유를 빼도 잡히는가 — " +
           "이유가 없으면 읽는 사람은 그 값을 어떻게 취급할지 모릅니다",
      expect: "Q",
      run: fn => withPatch(window.Provenance, "GENERATED_WHY", "", fn) },

    { id: "M6  검증 필요: 탐지 자체를 무력화",
      why: "F10. 동일값 7개 배치가 다시 통계에 섞여 들어가는가",
      expect: "Q",
      run: fn => withPatch(window.Provenance, "detectUnverified", () => [], fn) },

    { id: "M7  검증 필요: 통계에서 제외하지 않음",
      why: "F10. 표시는 하되 평균에는 넣는, 가장 조용한 형태의 오답",
      expect: "Q",
      run: fn => withMutatedSource(ENG,
        "return rows.filter(r => !(r.__unverified && r.__unverified[key]))",
        "return rows.filter(r => true)", fn) },

    { id: "M8  출처: 고지 줄 제거",
      why: "F4. 스캔 전사본이라는 사실이 응답에서 사라지는가",
      expect: "Q",
      run: fn => withPatch(window.Provenance, "LINE", "", fn) },

    { id: "M9  못 읽은 토큰: 승격 제거",
      why: "조건으로 못 읽은 말이 조용히 버려지는가 (조용한 오답 금지)",
      expect: "Q",
      run: fn => withMutatedSource(ENG,
        "if (c.ignoredTokens.length) {",
        "if (false) {", fn) },

    /* ── 기존 검사가 여전히 살아 있는지 ──────────────────────────────── */
    { id: "M10 수치 검증: 문장에서 숫자를 못 찾게",
      why: "검증기가 아무 숫자도 못 보면 무엇이든 통과합니다",
      expect: "O",
      run: fn => withPatch(window.AskVerify._parts, "numbersIn",
        () => ({ nums: [], dates: [] }), fn) },

    { id: "M11 수치 검증: 검사 대상 문장을 비움",
      why: "볼 문장이 없으면 위반도 없습니다 — 범위 축소형 무력화",
      expect: "O",
      run: fn => withPatch(window.AskVerify._parts, "visibleStrings", () => [], fn) },

    { id: "M12 수치 검증: 걸려도 문장을 안 바꿈",
      why: "검증만 하고 그대로 내보내면 오답이 사용자에게 그대로 도달합니다",
      expect: "O",
      run: fn => withPatch(window.AskVerify, "enforce",
        r => { r.verified = { ok: true, checked: 0 }; return r; }, fn) },

    { id: "M13 조건 해석: 임계값을 무시",
      why: "\"1000 이상\" 이 걸러지지 않고 전체가 나오는가",
      expect: "B",
      run: fn => withMutatedSource(ENG,
        "const thList = U ? U.parseThresholds(t) : [];",
        "const thList = [];", fn) },

    { id: "M14 규격: 생성값도 판정 대상에 넣음",
      why: "가장 위험한 응답 — 실측이 아닌 값을 규격 판정 결과로 답하는가",
      expect: "Q",
      run: fn => withMutatedSource(SPC,
        "if (c.generated) {",
        "if (false) {", fn) },

    { id: "M5b 생성값: 집계 포함 건수를 뺌",
      why: "F5. \"이 항목은 생성값\" 만 있고 28건 중 몇 건인지 없으면 " +
           "전부인지 일부인지 알 수 없습니다",
      expect: "Q",
      run: fn => withMutatedSource(ENG,
        '(n ? " 이 응답의 집계에는 생성값 " + n + "건이 포함되어 있습니다." : "")',
        '""', fn) },

    { id: "M5c 생성값: count 경로 고지 제거",
      why: "F5. 건수를 세는 것도 집계입니다 — 생성값 28건이 실측 건수로 읽히는가",
      expect: "Q",
      run: fn => withMutatedSource(ENG,
        "      note: qualityNote(metric, rows)\n    });\n  }\n\n  /* ── 비교",
        "      note: \"\"\n    });\n  }\n\n  /* ── 비교", fn) },

    { id: "M5d 생성값: missing 경로 고지 제거",
      why: "F5. 생성값은 전 행이 차 있어 늘 \"모두 입력됨\" 으로 나옵니다 — " +
           "실측이 하나도 없는데 완비된 것처럼 읽히는가",
      expect: "Q",
      run: fn => withMutatedSource(ENG,
        "const genAllCols = cols.filter(c => c.generated).map(c => c.label);",
        "const genAllCols = [];", fn) },

    { id: "M5e 생성값: 미입력 목록에 없는 것을 안 밝힘",
      why: "F5. 생성값은 미입력 0건이라 목록에서 빠집니다 — 빠진 쪽이 " +
           "완비된 항목으로 읽히는데 아무 말도 하지 않는가",
      expect: "Q",
      run: fn => withMutatedSource(ENG,
        "const genHidden = genAllCols.filter(l => shown.indexOf(l) === -1);",
        "const genHidden = [];", fn) },

    { id: "M23 추이: 항목 바꿔 답하고 말하지 않음",
      why: "\"Total Yield 추이\" 에 Titer 그래프를 주면서 아무 말도 하지 않는가",
      expect: "Q",
      run: fn => withMutatedSource(ENG,
        "const swapped = (metric && metric.key !== \"titer\" &&",
        "const swapped = (false && metric.key !== \"titer\" &&", fn) },

    /* ── 파일럿 전 수정분 (저장 위치 · 권한 · 동점 · D-day · 마스킹) ─── */
    { id: "M15 권한: 저장소 가드를 통과시킴",
      why: "화면만 막고 저장소는 아무나 쓸 수 있는 상태로 되돌아가는가",
      expect: "R",
      run: fn => withMutatedSource(SPC,
        'if (window.Auth.can("spec:write")) return null;',
        "if (true) return null;", fn) },

    { id: "M16 규격: 원본 소실을 \"없음\"처럼 답함",
      why: "규격이 있는데 파일이 빠진 상황을 규격이 없는 것처럼 말하는가",
      expect: "R",
      run: fn => withMutatedSource(ENG,
        "if (S && !src.ok) {",
        "if (false) {", fn) },

    { id: "M17 규격: 소실 탐지를 무력화",
      why: "파일이 없어도 정상으로 보고하면 근거 없는 판정이 나갑니다",
      expect: "R",
      run: fn => withPatch(window.Specs, "source", () => ({ ok: true, reason: "file", count: 0 }), fn) },

    { id: "M18 동점: 한 건만 지목",
      why: "F2. 25건이 동점인데 \"가장 높은 것은 B045-1\" 이라고 말하는가",
      expect: "R",
      run: fn => withMutatedSource(ENG,
        "const tied = sorted.filter(r => r[metric.key] === topVal);",
        "const tied = [top];", fn) },

    { id: "M19 D-day: 조회 대상에서 제외",
      why: "F3. \"Titer D14\" 가 다시 Titer HCCF 값을 답으로 내는가",
      expect: "R",
      run: fn => withMutatedSource(TBL,
        '(window.DATA_TITER_DAYS || []).forEach(function (d) {\n      columns.push({',
        '[].forEach(function (d) {\n      columns.push({', fn) },

    { id: "M20 라벨: 겹치는 이름을 구분하지 않음",
      why: "F8. 표에 \"Main\" 이 두 번 나와 어느 쪽 값인지 알 수 없게 되는가",
      expect: "R",
      run: fn => withMutatedSource("../assets/js/data/tables.js",
        "if (labelCount[c.label] > 1 && c.groupLabel) {",
        "if (false) {", fn) },

    { id: "M21 로그: 마스킹 무력화",
      why: "F12. \"개인정보를 담지 않는다\" 는 선언이 다시 거짓이 되는가",
      expect: "R",
      run: fn => withPatch(window.AskLog, "_mask", t => ({ text: String(t), removed: [] }), fn) },

    /* 성능 때문에 고친 자리는 "허용 기준이 그대로인가" 로 지킵니다.
       비교를 Set 조회로 바꾸면서 반올림 허용을 빠뜨리면, 맞는 답이 차단되고
       사용자는 표만 보게 됩니다 — 빨라진 대신 답을 잃는 회귀입니다.

       ※ 같은 자리에서 sameScope 축약도 시도해 봤지만, 그 변이는 어떤
         응답의 결과도 바꾸지 않습니다. 좁은 범위일 때는 축약이 걸리지 않고
         (scoped ≠ allRows), 전체 범위일 때 두 집합은 증명 가능하게 같기
         때문입니다. 동작이 같은 변이는 "검사가 없다" 는 증거가 아니라
         변이가 잘못 만들어진 것이라 목록에 넣지 않았습니다. */
    { id: "M22 성능: 반올림 허용을 빠뜨림",
      why: "Set 으로 바꾸면서 허용 기준이 좁아졌는가 — 맞는 답이 차단되면 " +
           "속도 개선이 아니라 회귀입니다",
      expect: "O",
      run: fn => withMutatedSource(VER,
        "      for (let dp = 0; dp <= 3; dp++) set.add(Number(v.toFixed(dp)));\n      set.add(Math.floor(v)); set.add(Math.ceil(v));",
        "", fn) }
  ];

  /* ── 실행 ─────────────────────────────────────────────────────────────
     변이 없이 한 번 돌려 기준선을 잡고(전부 통과해야 합니다), 변이마다
     스위트를 다시 돌려 실패가 생기는지 봅니다. */
  function run() {
    const R = window.AskRegression;
    const baseline = R.run(window.AskTables.internal());
    if (!baseline.pass) {
      return { ok: false, baselineFailed: true,
        failed: baseline.checks.filter(c => !c.pass).map(c => c.id + ": " + c.detail) };
    }

    const results = MUTANTS.map(function (m) {
      let caught = [], error = null;
      try {
        m.run(function () {
          const res = R.run(window.AskTables.internal());
          caught = res.checks.filter(c => !c.pass)
            .map(c => ({ id: c.id, detail: String(c.detail).slice(0, 200) }));
        });
      } catch (e) {
        error = (e && e.message) || String(e);
      }
      const byExpected = caught.some(c => c.id.indexOf(m.expect + ".") === 0);
      return {
        id: m.id, why: m.why, expect: m.expect, error: error,
        caught: caught.length > 0, byExpected: byExpected,
        by: caught.map(c => c.id.split(".")[0]).join(","),
        detail: caught.length ? caught[0].detail : ""
      };
    });

    /* 변이를 다 돌린 뒤 원래대로 돌아왔는지 확인합니다 */
    const after = R.run(window.AskTables.internal());

    const missed = results.filter(r => !r.caught && !r.error);
    const errored = results.filter(r => r.error);
    return {
      ok: !missed.length && !errored.length && after.pass,
      total: results.length,
      caught: results.filter(r => r.caught).length,
      missed: missed, errored: errored,
      wrongGuard: results.filter(r => r.caught && !r.byExpected),
      restored: after.pass,
      results: results
    };
  }

  function text(res) {
    if (res.baselineFailed) return "기준선 실패 — 변이 검사 이전에 회귀부터 고쳐야 합니다\n" +
      res.failed.join("\n");
    const pad = (s, n) => { s = String(s); return s + " ".repeat(Math.max(0, n - s.length)); };
    let out = pad("변이", 36) + pad("잡힘", 8) + pad("잡은 검사", 12) + "기대\n";
    out += "-".repeat(80) + "\n";
    res.results.forEach(function (r) {
      out += pad(r.id, 36) +
        pad(r.error ? "오류" : (r.caught ? "예" : "★아니오"), 8) +
        pad(r.error ? "-" : (r.by || "-"), 12) + r.expect + "\n";
      out += "    " + r.why + "\n";
      if (r.error) out += "    오류: " + r.error + "\n";
      else if (r.caught) out += "    → " + r.detail + "\n";
      else out += "    → 스위트가 전부 통과했습니다. 이 지점에는 검사가 없습니다.\n";
    });
    out += "-".repeat(80) + "\n";
    out += "검출 " + res.caught + "/" + res.total +
      " · 변이 해제 후 복구 " + (res.restored ? "정상" : "★실패") + "\n";
    if (res.wrongGuard.length) {
      out += "\n기대한 검사가 아닌 곳에서 잡힌 변이 (검사 배치를 다시 볼 것):\n";
      res.wrongGuard.forEach(r => {
        out += "  · " + r.id + " — 기대 " + r.expect + ", 실제 " + r.by + "\n"; });
    }
    return out;
  }

  return { load: load, run: run, text: text, MUTANTS: MUTANTS,
           SOURCES: [ENG, PRV, SPC, VER, TBL],
           _withMutatedSource: withMutatedSource, _withPatch: withPatch };
})();
