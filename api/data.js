/* ==========================================================================
   api/data.js — 중앙 데이터 읽기 · 쓰기

     GET    /api/data            전체 스냅샷 (레코드 · 값 · meta)   누구나
     POST   /api/data            변경 적용   { values, records, meta }  누구나
     POST   /api/data?seed=1     비어 있을 때만 씨앗 심기             누구나
     DELETE /api/data            전부 비우기                       비밀값 필요

   ★ 읽기·쓰기는 열려 있습니다 (2026-10, 소유자 결정). 삭제만 막습니다 —
     쓰기는 틀려도 이력이 남지만 전체 삭제는 되돌릴 것이 없습니다.
     자세한 배경은 _auth.js 머리말에 있습니다.

   ── 왜 전체를 한 번에 주고받나 ──────────────────────────────────────────
   화면이 수백 군데에서 값을 **동기적으로** 읽습니다 (Repo.valueOf). 칸마다
   서버를 왕복하면 화면이 멈춥니다. 28배치 규모에서는 전체가 수백 KB 라
   한 번에 받아 메모리에 두고 읽는 편이 빠르고 단순합니다.

   쓰기도 묶어 보냅니다. 칸 하나 고칠 때마다 왕복하면 표에 값을 줄줄이 적는
   동안 요청이 수십 개가 됩니다.

   ★ 본문 상한을 둡니다. 상한이 없으면 언젠가 누군가 통째로 올립니다.
   ========================================================================== */

const A = require("./_auth");
const DB = require("./_db");
const S = require("./_shared");

const MAX_BODY = 4 * 1024 * 1024;      /* 4MB — 씨앗 전체가 들어올 수 있습니다 */

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!DB.configured()) return DB.notConfigured(res);

  const ip = S.clientIp(req);
  if (S.throttled("data:" + ip, 120)) {
    return res.status(429).json({ error: "too-many" });
  }

  try {
    if (req.method === "GET") {
      const snap = await DB.snapshot();
      return res.status(200).json(snap);
    }

    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") {
        if (body.length > MAX_BODY) return res.status(413).json({ error: "too-large" });
        try { body = JSON.parse(body); } catch (e) {
          return res.status(400).json({ error: "bad-json" });
        }
      }
      if (!body || typeof body !== "object") {
        return res.status(400).json({ error: "bad-body" });
      }

      const seeding = String(req.query && req.query.seed || "") === "1";
      if (seeding) {
        const r = await DB.seedIfEmpty(body);
        return res.status(200).json(r);
      }

      const n = await DB.apply(body);
      return res.status(200).json({ ok: true, written: n });
    }

    if (req.method === "DELETE") {
      /* ★ 되돌릴 수 없는 유일한 길 — 여기서만 비밀값을 봅니다.
         읽기·쓰기가 열려 있어도 이건 막아 둡니다. */
      if (!A.guardDestructive(req, res)) return;
      await DB.wipe();
      return res.status(200).json({ ok: true, wiped: true });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "method-not-allowed" });

  } catch (e) {
    /* ★ 바깥으로 내부 오류 원문을 내보내지 않습니다.
       스택과 SQL 에는 표 이름 · 파일 경로가 섞여 있습니다. 서버 로그에만
       남기고, 호출한 쪽에는 무엇을 해야 하는지만 알려 줍니다. */
    console.error("[api/data]", e && e.message, e && e.code);
    return res.status(500).json({
      error: "server-error",
      message: "데이터베이스 작업에 실패했습니다. 잠시 후 다시 시도하세요."
    });
  }
};
