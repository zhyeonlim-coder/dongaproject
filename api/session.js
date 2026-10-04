/* ==========================================================================
   api/session.js — 로그인 · 로그아웃 · 상태 확인

     POST   /api/session   { secret }   → 쿠키 발급
     GET    /api/session               → 지금 로그인 상태인가
     DELETE /api/session               → 쿠키 지우기

   ★ 비밀값을 응답에 담지 않습니다. 맞았는지 여부만 돌려줍니다.
   ★ 틀린 비밀값은 일부러 조금 느리게 답합니다 — 빠른 반복 시도를 줄입니다.
     (완전한 방어는 아니고, 아래 레이트리밋과 함께 쓰는 완충입니다.)
   ========================================================================== */

const A = require("./_auth");
const S = require("./_shared");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    return res.status(200).json({
      configured: A.configured(),
      signedIn: A.configured() && A.validToken(A.readCookie(req, A.COOKIE))
    });
  }

  if (req.method === "DELETE") {
    A.clearCookie(res);
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "method-not-allowed" });
  }

  if (!A.configured()) {
    return res.status(503).json({
      error: "not-configured",
      message: "HUB_ACCESS_SECRET 환경변수가 없습니다."
    });
  }

  /* 비밀번호를 때려 맞히는 시도를 늦춥니다 */
  const ip = S.clientIp(req);
  if (S.throttled("login:" + ip, 10)) {
    return res.status(429).json({ error: "too-many", message: "잠시 후 다시 시도하세요." });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const given = body && body.secret;

  if (!A.secretMatches(given)) {
    await new Promise(r => setTimeout(r, 400));
    return res.status(401).json({ error: "bad-secret", message: "접속 비밀값이 맞지 않습니다." });
  }

  A.setCookie(res, A.makeToken());
  return res.status(200).json({ ok: true, maxAgeSeconds: A.MAX_AGE });
};
