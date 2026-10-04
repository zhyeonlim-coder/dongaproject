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

function secret() {
  const s = process.env.HUB_ACCESS_SECRET;
  if (!s || typeof s !== "string" || s.length < 16) return null;
  return s;
}

/* 설정 여부만 돌려줍니다 — 값은 어디로도 나가지 않습니다 */
function configured() { return !!secret(); }

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

/* 모든 데이터 라우트가 첫 줄에서 부릅니다.
   통과하면 true, 아니면 응답을 이미 보낸 상태로 false 를 돌려줍니다. */
function guard(req, res) {
  if (!configured()) {
    res.status(503).json({
      error: "not-configured",
      message: "HUB_ACCESS_SECRET 환경변수가 없습니다. 서버 데이터 기능이 꺼져 있습니다."
    });
    return false;
  }
  if (!validToken(readCookie(req, COOKIE))) {
    res.status(401).json({ error: "unauthorized", message: "로그인이 필요합니다." });
    return false;
  }
  return true;
}

module.exports = {
  COOKIE, MAX_AGE, configured, makeToken, validToken,
  readCookie, setCookie, clearCookie, secretMatches, guard
};
