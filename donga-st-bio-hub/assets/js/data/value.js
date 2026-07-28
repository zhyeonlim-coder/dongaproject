/* ==========================================================================
   value.js — 측정값 표현 (VAL)

   숫자 하나로는 실험 결과를 다 담지 못합니다. 현업에서 한 칸에 들어가는
   값은 최소 세 종류입니다.

     1. 숫자            12.3
     2. 한정자 붙은 값   <1 ppm  ·  >200 ppm
        정량한계(LOQ) 아래라 "정확히 얼마"는 모르지만 경계는 아는 값입니다.
        HCP · 잔류 DNA 는 이 표기가 표준이라 숫자 칸에 넣을 수 없습니다.
     3. 값이 없는 이유   미측정 / 해당 없음 / 불검출 / 시험 무효
        전부 "빈칸"으로 뭉개면 완성도 집계가 틀리고, 무효인 값이 유효한
        값처럼 평균에 섞입니다.

   ── 불검출(ND)과 <LOQ 를 나눈 이유 ──────────────────────────────────────
   ND 는 "검출 자체가 안 됨"이고 <LOQ 는 "검출은 됐으나 정량 범위 밖"입니다.
   전자는 숫자가 없고 후자는 경계 숫자가 있습니다. 실무에서 섞어 쓰기도
   하지만, 데이터로 남길 때는 나눠야 나중에 되살릴 수 있습니다.

   ── 저장 형태 ───────────────────────────────────────────────────────────
     { num: 12.3, qual: "",  miss: "" }     숫자
     { num: 1,    qual: "<", miss: "" }     <1
     { num: null, qual: "",  miss: "nd" }   불검출

   ⚠ 여기서 다루는 lo/hi 는 **물리적으로 가능한 입력 범위**이지 규격이
     아닙니다. 규격(합격 기준)은 아직 없습니다 — Pass/Fail 판정은 규격표가
     들어온 뒤에 붙습니다.
   ========================================================================== */

window.VAL = (function () {
  "use strict";

  /* ── 결측 사유 ──────────────────────────────────────────────────────── */
  const MISSING = {
    nm:  { code: "nm",  label: "미측정",   short: "미측정",   hint: "아직 측정하지 않음",
           tone: "mute" },
    na:  { code: "na",  label: "해당 없음", short: "해당없음", hint: "이 공정·시료에는 존재하지 않는 항목",
           tone: "mute" },
    nd:  { code: "nd",  label: "불검출",   short: "불검출",   hint: "검출되지 않음 (Not Detected)",
           tone: "ok" },
    inv: { code: "inv", label: "시험 무효", short: "무효",     hint: "시험이 유효하지 않아 재시험 대상",
           tone: "warn" }
  };
  const MISSING_ORDER = ["nm", "na", "nd", "inv"];

  /* 입력창에 칠 수 있는 표기. 한글·영문 모두 받습니다 —
     실험실에서 실제로 쓰는 표기가 사람마다 달라서입니다. */
  const TOKENS = {
    "":            "nm",
    "미측정":       "nm",
    "nm":          "nm",
    "-":           "na",
    "na":          "na",
    "n/a":         "na",
    "해당없음":     "na",
    "해당 없음":    "na",
    "nd":          "nd",
    "n.d.":        "nd",
    "불검출":       "nd",
    "inv":         "inv",
    "invalid":     "inv",
    "무효":         "inv"
  };

  function make(num, qual, miss) {
    return {
      num: (num === null || num === undefined || num === "") ? null : +num,
      qual: qual || "",
      miss: miss || ""
    };
  }

  const EMPTY = () => make(null, "", "nm");

  /* ── 파싱 ───────────────────────────────────────────────────────────── */
  function parse(raw) {
    if (raw && typeof raw === "object" && ("num" in raw || "miss" in raw)) {
      return { ok: true, val: make(raw.num, raw.qual, raw.miss) };
    }
    const s = String(raw === null || raw === undefined ? "" : raw).trim();
    const low = s.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(TOKENS, low)) {
      return { ok: true, val: make(null, "", TOKENS[low]) };
    }
    const m = /^([<>])?\s*(-?\d+(?:\.\d+)?)$/.exec(s);
    if (!m) {
      return { ok: false, error: "숫자, 한정자(<1 · >200), 또는 ND · NA · INV 로 입력하세요" };
    }
    return { ok: true, val: make(+m[2], m[1] || "", "") };
  }

  /* 저장된 값 → 항상 정상 객체로. 예전에 문자열로 저장된 값도 살립니다. */
  function coerce(v) {
    if (v === null || v === undefined) return EMPTY();
    if (typeof v === "object" && ("num" in v || "miss" in v)) return make(v.num, v.qual, v.miss);
    const p = parse(v);
    return p.ok ? p.val : make(null, "", "nm");
  }

  /* ── 표시 ───────────────────────────────────────────────────────────── */

  /* 입력창에 되돌려 넣을 문자열 (사용자가 친 것과 같은 형태) */
  function toInput(v) {
    const x = coerce(v);
    if (x.miss) return x.miss === "nm" ? "" : MISSING[x.miss].label;
    if (x.num === null) return "";
    return x.qual + String(x.num);
  }

  /* 읽기용 문자열. dp 를 주면 숫자를 그 자리수로 맞춥니다. */
  function format(v, dp) {
    const x = coerce(v);
    if (x.miss) return MISSING[x.miss].label;
    if (x.num === null) return MISSING.nm.label;
    const n = (dp === null || dp === undefined) ? String(x.num) : Number(x.num).toFixed(dp);
    return x.qual + n;
  }

  /* 계산에 쓸 숫자. 결측은 null, 한정자 값은 경계값을 돌려줍니다.
     경계값을 그대로 쓰면 평균이 살짝 보수적으로 잡히는데, LOQ/2 같은
     대체값을 쓰면 그건 이미 통계적 가정이라 데이터가 아닙니다.
     가정은 규격·통계 방침이 정해진 뒤에 한곳에서 적용해야 합니다. */
  function numeric(v) {
    const x = coerce(v);
    if (x.miss) return null;
    return (x.num === null || !isFinite(x.num)) ? null : x.num;
  }

  function isMissing(v) { return !!coerce(v).miss; }
  function isBounded(v) { return !!coerce(v).qual; }
  function missingInfo(v) {
    const x = coerce(v);
    return x.miss ? MISSING[x.miss] : null;
  }

  /* 완성도 집계용 — "해당 없음"은 분모에서 빼야 맞습니다.
     없는 항목을 미입력으로 세면 영원히 100%가 되지 않습니다. */
  function countsTowardCompleteness(v) {
    return coerce(v).miss !== "na";
  }
  function isFilled(v) {
    const x = coerce(v);
    if (x.miss === "nd") return true;      // 불검출도 시험을 수행한 결과입니다
    if (x.miss) return false;
    return x.num !== null && isFinite(x.num);
  }

  /* ── 입력 범위 검증 ─────────────────────────────────────────────────────
     항목 스키마의 lo/hi 를 씁니다. 없으면 단위로 유추합니다 (% 는 0~100).
     여기서 막는 건 "물리적으로 나올 수 없는 값"뿐입니다 — 규격 이탈이
     아니라 오타·단위 착각을 잡는 그물입니다. */
  const UNIT_RANGE = {
    "%": [0, 100]
  };

  function boundsOf(item) {
    if (!item) return null;
    if (item.lo !== undefined && item.hi !== undefined) return [item.lo, item.hi];
    const u = UNIT_RANGE[item.unit];
    return u || null;
  }

  function checkRange(v, item) {
    const x = coerce(v);
    if (x.miss || x.num === null) return null;
    const b = boundsOf(item);
    if (!b) return null;
    if (x.num < b[0] || x.num > b[1]) {
      return (item.label || "값") + "은(는) " + b[0] + " ~ " + b[1] +
             (item.unit ? " " + item.unit : "") + " 범위에서만 입력할 수 있습니다 " +
             "(입력값 " + x.num + "). 단위나 자리수를 확인하세요.";
    }
    return null;
  }

  /* ── 급변 경고 ──────────────────────────────────────────────────────────
     오류가 아니라 경고입니다. 실제로 그런 일이 일어날 수 있으므로 저장은
     막지 않고, 저장 전에 한 번 눈에 띄게만 합니다.

     o = { value, prev: { label, value } | null, peers: [숫자], cumulative: true|false }
       prev        같은 배치의 전일 값 (Titer 처럼 일자별 항목)
       peers       같은 Study 안 다른 배치들의 같은 항목 값
       cumulative  누적 지표인지 (Titer HCCF 는 배양이 진행되며 쌓입니다) */
  const JUMP_RATIO = 1.8;      // 전일 대비 80% 초과 증가
  const PEER_DEV = 0.5;        // 동일 Study 중앙값 대비 ±50%

  function median(a) {
    const s = a.filter(v => v !== null && isFinite(v)).slice().sort((x, y) => x - y);
    if (!s.length) return null;
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function trendWarnings(o) {
    const out = [];
    const v = o && o.value;
    if (v === null || v === undefined || !isFinite(v)) return out;

    if (o.prev && isFinite(o.prev.value)) {
      if (o.cumulative && v < o.prev.value) {
        out.push("전일(" + o.prev.label + " " + o.prev.value + ") 보다 낮습니다. " +
                 "누적 지표라 보통 감소하지 않습니다 — 입력값을 확인하세요.");
      } else if (o.prev.value > 0 && v > o.prev.value * JUMP_RATIO) {
        out.push("전일(" + o.prev.label + " " + o.prev.value + ") 대비 " +
                 Math.round((v / o.prev.value - 1) * 100) + "% 급증했습니다.");
      }
    }

    if (o.peers && o.peers.length >= 3) {
      const med = median(o.peers);
      if (med !== null && med !== 0) {
        const dev = Math.abs(v - med) / Math.abs(med);
        if (dev > PEER_DEV) {
          out.push("같은 Study 다른 배치 중앙값(" + round(med) + ") 대비 " +
                   Math.round(dev * 100) + "% 차이가 납니다.");
        }
      }
    }
    return out;
  }

  function round(n) {
    const a = Math.abs(n);
    return a >= 100 ? Math.round(n) : a >= 1 ? +n.toFixed(1) : +n.toFixed(3);
  }

  function isVal(v) {
    return !!(v && typeof v === "object" && ("num" in v || "miss" in v));
  }

  /* 값이 같은지 — 이력을 남길지 판단할 때 씁니다.
     측정값(VAL 객체)뿐 아니라 날짜·자유 텍스트 필드에도 쓰이므로,
     한쪽이라도 VAL 객체가 아니면 문자열로 비교합니다. */
  function same(a, b) {
    if (isVal(a) || isVal(b)) {
      const x = coerce(a), y = coerce(b);
      return x.miss === y.miss && x.qual === y.qual && x.num === y.num;
    }
    const s = v => (v === null || v === undefined) ? "" : String(v);
    return s(a) === s(b);
  }

  return {
    MISSING, MISSING_ORDER, TOKENS,
    parse, coerce, make, EMPTY,
    toInput, format, numeric, same, isVal,
    isMissing, isBounded, missingInfo, isFilled, countsTowardCompleteness,
    boundsOf, checkRange, trendWarnings
  };
})();
