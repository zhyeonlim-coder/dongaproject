/* ==========================================================================
   ai/guard.js — 서버가 돌려준 도구 지시를 실행 전에 거릅니다  ·  window.AIPlanGuard

   왜 클라이언트에서 또 보는가
     서버에도 allowlist 가 있습니다. 그런데 이 가드는 "서버가 틀렸을 때"
     를 위한 것입니다 — 응답이 조작됐거나, 중간에 다른 것이 끼어들었거나,
     서버 코드에 버그가 있을 때. 실행 직전이 마지막 방어선입니다.

     실행하는 쪽이 스스로 확인하지 않으면, 확인은 어딘가 다른 곳의
     책임이 되고 그 다른 곳은 언젠가 바뀝니다.

   무엇을 보는가
     1) 도구 이름이 이 브라우저에 실제로 있는 도구인가
     2) 이 화면에서 그 도구를 쓸 수 있는가 (DoE 는 DoE 화면에서만)
     3) 인자가 그 도구의 스키마에 있는 키인가
     4) 인자 값이 터무니없이 크거나 이상한 형태가 아닌가
   ========================================================================== */

window.AIPlanGuard = (function () {
  "use strict";

  const MAX_STRING = 500;

  function reject(why, detail) {
    return { ok: false, why: why, detail: detail || null };
  }

  function check(plan) {
    if (!plan || typeof plan !== "object") return reject("응답이 비어 있습니다.");
    if (plan.error) {
      return reject(plan.message || "AI 해석을 받지 못했습니다.", plan.error);
    }
    const name = plan.tool;
    if (typeof name !== "string" || !name) return reject("도구 이름이 없습니다.");

    /* 1) 이 브라우저에 실제로 있는 도구인가 — 서버 목록이 아니라
          여기 로드된 SPEC 을 기준으로 봅니다 */
    const spec = (window.AITools.SPEC || []).find(s => s.name === name);
    if (!spec) return reject("허용되지 않은 도구입니다: " + name, "not-in-spec");

    /* 2) 이 화면에서 쓸 수 있는가 */
    if (!window.AIContext.allows(name)) {
      return reject(window.AIContext.whyNot(name) || "이 화면에서는 쓸 수 없는 도구입니다.",
        "not-allowed-here");
    }

    /* 3) 인자 키 — 스키마에 없는 것은 버립니다 */
    const allowed = Object.keys(spec.params || {});
    const args = {};
    const dropped = [];
    Object.keys(plan.args || {}).forEach(function (k) {
      if (allowed.indexOf(k) === -1) { dropped.push(k); return; }
      args[k] = plan.args[k];
    });

    /* 4) 값 모양 — 긴 문자열·이상한 타입은 자르거나 버립니다 */
    const bad = [];
    Object.keys(args).forEach(function (k) {
      const want = spec.params[k];
      const v = args[k];
      if (v === null || v === undefined) { delete args[k]; return; }
      if (want === "number") {
        const n = Number(v);
        if (!isFinite(n)) { bad.push(k); delete args[k]; return; }
        args[k] = n;
        return;
      }
      if (want === "object") {
        if (typeof v !== "object" || Array.isArray(v)) { bad.push(k); delete args[k]; }
        return;
      }
      /* 문자열 */
      if (typeof v === "object") { bad.push(k); delete args[k]; return; }
      const s = String(v);
      args[k] = s.length > MAX_STRING ? s.slice(0, MAX_STRING) : s;
    });

    return { ok: true, tool: name, args: args, dropped: dropped, badTypes: bad };
  }

  return { check: check };
})();
