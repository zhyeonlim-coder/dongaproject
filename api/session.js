/* ==========================================================================
   api/session.js — 서버 상태 확인 · (전체 삭제용) 비밀값 로그인

     GET    /api/session               → 서버·DB 가 쓸 수 있는 상태인가
     POST   /api/session   { secret }  → 쿠키 발급 (전체 삭제에만 필요)
     DELETE /api/session               → 쿠키 지우기

   ★ 데이터를 읽고 쓰는 데는 로그인이 필요 없습니다 (2026-10). 화면은 이
     응답의 db 만 보고 서버 모드로 들어갑니다. 여기 남은 로그인은 오직
     전체 삭제(DELETE /api/data) 한 곳을 위한 것입니다.

   ★ 비밀값을 응답에 담지 않습니다. 맞았는지 여부만 돌려줍니다.
   ★ 틀린 비밀값은 일부러 조금 느리게 답합니다 — 빠른 반복 시도를 줄입니다.
     (완전한 방어는 아니고, 아래 레이트리밋과 함께 쓰는 완충입니다.)
   ========================================================================== */

const A = require("./_auth");
const DB = require("./_db");
const S = require("./_shared");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    /* 진단까지 함께 돌려줍니다. 설정한 사람이 "넣었는데 왜 안 되지" 에서
       멈추지 않도록, 무엇이 비어 있는지는 알려 줍니다.
       ★ 비밀값도 그 길이도 담지 않습니다 — 없음 / 너무 짧음 구분까지입니다.
       ★ db 는 Postgres 가 붙었는지 여부(참·거짓)일 뿐 접속 정보가 아닙니다. */
    /* ★ configured 는 이제 "데이터를 쓸 수 있는가" 입니다 — 곧 DB 가
       붙었는가입니다. 예전에는 "비밀값이 설정됐는가" 였고, 화면은 그걸
       보고 서버 모드로 들어갈지 정했습니다. 읽기·쓰기에 비밀값이 필요
       없어진 지금 그 기준을 그대로 두면, 비밀값을 지운 순간 화면이
       통째로 로컬 모드로 떨어집니다.

       canWipe 는 전체 삭제가 가능한 상태인지 — 그 한 곳만 비밀값을 봅니다. */
    const out = {
      configured: DB.configured(),
      db: DB.configured(),
      signedIn: A.configured() && A.validToken(A.readCookie(req, A.COOKIE)),
      canWipe: A.configured()
    };
    if (!DB.configured()) out.reason = "db-missing";
    return res.status(200).json(out);
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
      reason: A.why(),
      message: A.why() === "secret-too-short"
        ? "HUB_ACCESS_SECRET 이 너무 짧습니다 (" + A.MIN_SECRET + "자 이상)."
        : "HUB_ACCESS_SECRET 환경변수가 없습니다."
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
