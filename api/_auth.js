/* ==========================================================================
   api/_auth.js — 공유 비밀값 로그인과 쿠키 세션

   ── 무엇을 지키나 ───────────────────────────────────────────────────────
   데이터가 서버로 옮겨 가면 주소를 아는 사람은 누구나 읽고 쓸 수 있게
   됩니다. 공개 URL 이고 실험 데이터입니다. 그래서 요청마다 쿠키를 봅니다.

   ── 어떻게 ──────────────────────────────────────────────────────────────
   팀이 공유하는 비밀값 하나(HUB_ACCESS_SECRET)를 환경변수에 둡니다.
   로그인하면 서버가 서명된 쿠키를 발급하고, 그 뒤 모든 요청은 쿠키만
   봅니다. 비밀값 자체는 쿠키에 넣지 않습니다 — 쿠키는 브라우저에 평문으로
   남고, 거기 비밀값이 있으면 한 사람의 브라우저가 털리는 순간 전부
   털립니다.

   쿠키에 담는 것은 "언제까지 유효한가" 뿐이고, 그 값을 비밀값으로 서명해
   위조를 막습니다. 서명 검증은 timingSafeEqual 로 합니다 — 일반 비교는
   앞에서 몇 글자가 맞았는지가 응답 시간에 새어 나옵니다.

   ★ 이것은 "팀이 같은 암호를 나눠 쓰는" 수준입니다. 누가 고쳤는지를
     서버가 증명하지는 못합니다 (화면에 적히는 작성자는 클라이언트가 보낸
     값입니다). 사람별 계정이 필요해지면 그때 올려야 합니다.
   ========================================================================== */

const crypto = require("crypto");

const COOKIE = "hub_session";
const MAX_AGE = 60 * 60 * 12;          /* 12시간 — 하루 일과보다 조금 깁니다 */

const MIN_SECRET = 16;

function secret() {
  const s = process.env.HUB_ACCESS_SECRET;
  if (!s || typeof s !== "string" || s.length < MIN_SECRET) return null;
  return s;
}

/* 설정 여부만 돌려줍니다 — 값은 어디로도 나가지 않습니다 */
function configured() { return !!secret(); }

/* 왜 꺼져 있는가 — 설정한 사람이 스스로 고칠 수 있도록.

   ★ 값도, 실제 길이도 내보내지 않습니다. "없음" 과 "너무 짧음" 둘 중
     하나만 구분합니다. 이 구분이 없으면 환경변수를 넣고도 왜 안 되는지
     알 방법이 없어, 결국 기능을 꺼 둔 채 끝납니다. */
function why() {
  const s = process.env.HUB_ACCESS_SECRET;
  if (!s || typeof s !== "string" || !s.length) return "secret-missing";
  if (s.length < MIN_SECRET) return "secret-too-short";
  return null;
}

function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

function makeToken() {
  const exp = String(Date.now() + MAX_AGE * 1000);
  return exp + "." + sign(exp);
}

function validToken(token) {
  if (!token || typeof token !== "string") return false;
  const i = token.lastIndexOf(".");
  if (i < 1) return false;
  const exp = token.slice(0, i), mac = token.slice(i + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const want = Buffer.from(sign(exp));
  const got = Buffer.from(mac);
  if (want.length !== got.length) return false;
  try { return crypto.timingSafeEqual(want, got); } catch (e) { return false; }
}

function readCookie(req, name) {
  const raw = req.headers && req.headers.cookie;
  if (!raw) return null;
  const parts = String(raw).split(";");
  for (let i = 0; i < parts.length; i++) {
    const kv = parts[i].trim();
    const eq = kv.indexOf("=");
    if (eq > 0 && kv.slice(0, eq) === name) return decodeURIComponent(kv.slice(eq + 1));
  }
  return null;
}

function setCookie(res, token) {
  res.setHeader("Set-Cookie",
    COOKIE + "=" + encodeURIComponent(token) +
    "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + MAX_AGE);
}
function clearCookie(res) {
  res.setHeader("Set-Cookie", COOKIE + "=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
}

/* 비밀값 맞춰 보기 — 길이가 달라도 같은 시간이 걸리도록 해시를 견줍니다 */
function secretMatches(given) {
  const s = secret();
  if (!s || typeof given !== "string") return false;
  const a = crypto.createHash("sha256").update(s).digest();
  const b = crypto.createHash("sha256").update(given).digest();
  return crypto.timingSafeEqual(a, b);
}

/* ══════════════════════════════════════════════════════════════════════
   ★ 읽기와 쓰기는 더 이상 막지 않습니다 (2026-10, 소유자 결정)

   예전에는 /api/data 전체가 이 문을 지났습니다. 주소를 아는 사람은 누구나
   읽고 쓸 수 있으니 막아야 한다는 판단이었습니다. 지금은 반대로, 매번
   비밀값을 넣고 12시간마다 끊기는 비용이 더 크다고 보고 열어 두기로
   했습니다.

   그래서 지금 이 파일이 지키는 것은 **전체 삭제 하나뿐**입니다.

     GET  /api/data   누구나
     POST /api/data   누구나
     DELETE /api/data 비밀값을 아는 사람만   ← guardDestructive

   읽기·쓰기가 열려 있어도 삭제만은 막아 둡니다. 쓰기는 틀려도 이력이
   남고 되짚을 수 있지만, 전체 삭제는 한 번의 요청으로 전부 사라지고
   되돌릴 것이 없습니다. 둘은 같은 위험이 아닙니다.

   ⚠ 이 설정에서 데이터는 주소를 아는 사람에게 공개됩니다. 배포 주소를
     아무 데나 올리지 않는 것이 유일한 울타리입니다.
   ══════════════════════════════════════════════════════════════════════ */

/* 되돌릴 수 없는 길만 막습니다 (지금은 DELETE 하나).
   통과하면 true, 아니면 응답을 이미 보낸 상태로 false 를 돌려줍니다. */
function guardDestructive(req, res) {
  if (!configured()) {
    res.status(503).json({
      error: "not-configured",
      reason: why(),
      message: why() === "secret-too-short"
        ? "HUB_ACCESS_SECRET 이 너무 짧습니다 (" + MIN_SECRET + "자 이상). 전체 삭제가 꺼져 있습니다."
        : "HUB_ACCESS_SECRET 환경변수가 없습니다. 전체 삭제가 꺼져 있습니다."
    });
    return false;
  }
  if (!validToken(readCookie(req, COOKIE))) {
    res.status(401).json({
      error: "unauthorized",
      message: "전체 삭제에는 서버 접속 비밀값이 필요합니다."
    });
    return false;
  }
  return true;
}

module.exports = {
  COOKIE, MAX_AGE, MIN_SECRET, configured, why, makeToken, validToken,
  readCookie, setCookie, clearCookie, secretMatches, guardDestructive
};
