/* ==========================================================================
   api/_shared.js — 서버리스 함수 공용 부품

   extract.js · narrate.js · chat.js 가 같은 규칙을 쓰도록 한 곳에 모읍니다.
   함수마다 레이트리밋을 따로 적어 두면 한 곳만 고쳐지고 나머지는 뒤처집니다.
   ========================================================================== */

/* ── 레이트리밋 ──────────────────────────────────────────────────────────
   서버리스는 인스턴스가 여러 개라 이 카운터는 인스턴스마다 따로입니다.
   정확한 제한이 아니라 "실수로 폭주하는 것"을 막는 완충입니다 —
   정확한 제한이 필요하면 외부 저장소가 있어야 합니다. */
const WINDOW_MS = 60 * 1000;
const hits = new Map();

function throttled(ip, max) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  /* 오래된 항목 정리 — 없으면 메모리가 계속 늡니다 */
  if (hits.size > 500) {
    for (const [k, v] of hits) {
      if (!v.length || now - v[v.length - 1] > WINDOW_MS) hits.delete(k);
    }
  }
  return arr.length > (max || 40);
}

function clientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
         req.socket && req.socket.remoteAddress || "unknown";
}

/* ── 키 확인 ─────────────────────────────────────────────────────────────
   ★ 키 값을 반환하지 않습니다. 있는지 여부와 형태만 봅니다.
     실수로 로그나 응답에 실리는 경로를 아예 만들지 않기 위해서입니다. */
function keyStatus() {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return { ok: false, reason: "missing" };
  if (typeof k !== "string" || k.length < 20) return { ok: false, reason: "malformed" };
  return { ok: true, length: k.length };
}

function notConfigured(res) {
  return res.status(503).json({
    error: "not-configured",
    message: "ANTHROPIC_API_KEY 가 설정되지 않아 규칙 매칭만 사용합니다."
  });
}

/* ── 본문 크기 제한 ──────────────────────────────────────────────────────
   질문과 카탈로그만 받습니다. 실험 데이터가 통째로 올라오는 일이 없도록
   상한을 둡니다 — 상한이 없으면 언젠가 누군가 통째로 보냅니다. */
function tooBig(body, maxBytes) {
  try {
    return JSON.stringify(body || {}).length > (maxBytes || 60000);
  } catch (e) { return true; }
}

function clip(s, n) {
  const t = String(s == null ? "" : s);
  return t.length > n ? t.slice(0, n) : t;
}

/* ── 오류를 사용자에게 보여도 되는 문장으로 ─────────────────────────────
   SDK 예외 메시지를 그대로 내보내면 내부 사정이 새고, 사용자는 무엇을
   해야 할지 모릅니다. 상태코드별로 할 일을 적어 줍니다. */
function friendlyError(e) {
  const status = (e && (e.status || e.statusCode)) || 500;
  if (status === 401 || status === 403) {
    return { status: 503, error: "auth",
      message: "AI 인증에 실패했습니다. 관리자에게 알려 주세요. 규칙 검색은 계속 사용하실 수 있습니다." };
  }
  if (status === 429) {
    return { status: 429, error: "rate-limit",
      message: "요청이 몰려 잠시 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  if (status >= 500) {
    return { status: 502, error: "upstream",
      message: "AI 응답을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  return { status: 400, error: "bad-request",
    message: "요청을 처리하지 못했습니다." };
}

module.exports = {
  throttled, clientIp, keyStatus, notConfigured, tooBig, clip, friendlyError,
  WINDOW_MS
};
