/* ==========================================================================
   api/health.js — Phase B 진입점 점검  ·  GET /api/health

   확인하는 것
     1. 이 라우트가 배포되어 있는가
     2. ANTHROPIC_API_KEY 를 서버가 인식하는가
     3. Claude 를 실제로 부를 수 있는가            (?deep=1)
     4. 정상적인 chat 응답이 오는가                (?deep=1)
     5. Tool 호출이 되는가                         (?deep=1)
     6. 키가 클라이언트 번들에 들어가 있지 않은가  (아래 참고)

   ★ 키 값을 절대 반환하지 않습니다.
     있는지 · 길이가 그럴듯한지까지만 봅니다. 점검 도구가 비밀을 흘리면
     점검하지 않느니만 못합니다.

   ★ 6번은 이 파일이 증명할 수 없습니다.
     서버가 "번들에 키가 없다" 고 말하는 것은 아무 근거가 없습니다.
     클라이언트 자산을 직접 훑어야 하고, 그건 tests/phase-b.js 가 합니다.
     여기서는 무엇을 확인해야 하는지만 알려 줍니다.

   deep=1 은 실제 API 를 호출하므로 요금이 발생합니다 (아주 적지만 0 은
   아닙니다). 그래서 기본은 호출하지 않는 얕은 점검입니다.
   ========================================================================== */

const AnthropicPkg = require("@anthropic-ai/sdk");
const Anthropic = AnthropicPkg.default || AnthropicPkg;
const S = require("./_shared");

const MODEL = "claude-opus-5";

const PING_TOOL = {
  name: "health_ping",
  description: "점검용 도구입니다. 사용자가 ping 이라고 하면 이 도구를 부르세요.",
  input_schema: {
    type: "object",
    properties: { note: { type: "string" } },
    required: [], additionalProperties: false
  },
  strict: true
};

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "GET 또는 POST 만 허용합니다." });
  }
  if (S.throttled(S.clientIp(req), 10)) {
    return res.status(429).json({ error: "rate-limit",
      message: "점검 요청이 너무 잦습니다." });
  }

  const checks = [];
  let allowedTools = [];          /* 서버 allowlist — 클라이언트와 대조용 */
  const add = (id, ok, note) => checks.push({ id: id, ok: !!ok, note: note || "" });

  /* 1. 라우트 */
  add("route", true, "/api/health 가 응답했습니다");

  /* 2. 키 인식 — 값은 보지 않습니다 */
  const key = S.keyStatus();
  add("apiKey", key.ok,
    key.ok ? "환경변수에서 키를 읽었습니다 (길이 " + key.length + "자, 값은 반환하지 않습니다)"
           : key.reason === "missing"
             ? "ANTHROPIC_API_KEY 가 설정되어 있지 않습니다"
             : "ANTHROPIC_API_KEY 형태가 올바르지 않습니다");

  /* 3. /api/chat 모듈이 로드되는가 — 배포 누락·문법 오류를 여기서 잡습니다 */
  let chatMod = null;
  try {
    chatMod = require("./chat.js");
    /* 개수만 알려 주면 "16 대 16 인데 이름이 하나 다르다" 를 잡지 못합니다.
       이름을 그대로 내보내 클라이언트 목록과 집합으로 대조하게 합니다.
       도구 이름은 비밀이 아닙니다 — 이미 클라이언트 자산에 들어 있습니다. */
    const allowed = chatMod.ALLOWED || [];
    add("chatRoute", typeof chatMod === "function",
      "chat.js 로드됨 · 허용 도구 " + allowed.length + "개");
    allowedTools = allowed.slice();
  } catch (e) {
    /* ★ 예외 원문을 응답에 넣지 않습니다.
       require 실패 메시지에는 서버의 파일 경로가 들어갑니다. 점검 도구가
       내부 구조를 흘리면 점검하지 않느니만 못합니다.
       디버깅에 필요한 것은 서버 로그에만 남깁니다. */
    console.error("[health] chat.js 로드 실패:", e);
    add("chatRoute", false, "chat.js 를 로드하지 못했습니다 (자세한 내용은 서버 로그)");
  }

  /* 4. 서버 이탈 차단(containment)이 동작하는가 — 호출 없이 확인.
     ★ 이것은 값의 진위를 보는 "검증" 이 아닙니다. 서버는 Repo 를 볼 수
       없습니다. 모델이 받은 값 집합 밖의 숫자를 썼는지만 봅니다. */
  if (chatMod && chatMod._unknownNumbers) {
    const bad = chatMod._unknownNumbers("평균은 9999 입니다", [981.4, 28]);
    const good = chatMod._unknownNumbers("평균은 981.4 입니다", [981.4, 28]);
    add("containment", bad.length === 1 && bad[0] === 9999 && good.length === 0,
      "받은 값 밖의 숫자를 잡고, 받은 값은 통과시킵니다 (값의 진위 판단은 브라우저 AskVerify)");
  }

  const deep = String((req.query && req.query.deep) || "") === "1";
  if (!deep) {
    return res.status(key.ok ? 200 : 503).json({
      ok: checks.every(c => c.ok),
      mode: "shallow",
      checks: checks,
      allowedTools: allowedTools,
      hint: key.ok
        ? "실제 Claude 호출까지 확인하려면 /api/health?deep=1 (요금이 발생합니다)"
        : "Vercel 프로젝트 설정 → Environment Variables 에 ANTHROPIC_API_KEY 를 넣고 재배포하세요.",
      clientBundleCheck:
        "키가 클라이언트에 노출되지 않았는지는 서버가 증명할 수 없습니다 — " +
        "tests/phase-b.html 이 실제 자산을 훑어 확인합니다."
    });
  }

  if (!key.ok) {
    return res.status(503).json({ ok: false, mode: "deep", checks: checks,
      allowedTools: allowedTools,
      message: "키가 없어 실제 호출은 건너뛰었습니다." });
  }

  /* ── 실제 호출 ───────────────────────────────────────────────────── */
  const client = new Anthropic();
  const t0 = Date.now();
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1000,
      system: "당신은 점검용 응답기입니다. 사용자가 ping 이라고 하면 health_ping 도구를 부르세요.",
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      tools: [PING_TOOL],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: "ping" }]
    });

    add("claudeCall", true,
      "모델 " + msg.model + " 응답 (" + (Date.now() - t0) + "ms)");
    add("chatResponse", Array.isArray(msg.content) && msg.content.length > 0,
      "stop_reason=" + msg.stop_reason);

    const call = (msg.content || []).find(b => b.type === "tool_use");
    add("toolCall", !!call && call.name === "health_ping",
      call ? "도구 " + call.name + " 호출됨" : "도구를 부르지 않았습니다 (모델 판단)");

    return res.status(200).json({
      ok: checks.every(c => c.ok),
      mode: "deep",
      model: msg.model,
      ms: Date.now() - t0,
      usage: { input: msg.usage && msg.usage.input_tokens,
               output: msg.usage && msg.usage.output_tokens },
      checks: checks
    });

  } catch (e) {
    const f = S.friendlyError(e);
    add("claudeCall", false, f.message + " (status " + ((e && e.status) || "?") + ")");
    return res.status(f.status).json({ ok: false, mode: "deep", checks: checks });
  }
};
