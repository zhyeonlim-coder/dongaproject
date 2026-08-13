/* ==========================================================================
   api/narrate.js — 조회 결과를 자연어 문장으로 다듬는 Vercel Serverless Function

   역할 분담이 이 파일의 전부입니다.

     · 숫자 계산 · 데이터 조회 : 브라우저의 ask-engine.js 가 전담
     · 문장 작성              : 여기(Claude)가 전담

   그래서 이 함수는 "이미 계산이 끝난 값"만 받습니다. 원본 데이터셋을 통째로
   보내지 않으므로 외부로 나가는 정보가 최소화되고, 모델이 수치를 지어낼
   여지도 없습니다. 답변의 숫자는 언제나 브라우저에서 계산된 값과 같습니다.

   ANTHROPIC_API_KEY 가 없으면 503 을 돌려주고, 화면은 엔진이 만든
   결정론적 문장을 그대로 씁니다 — 키가 없어도 서비스는 정상 동작합니다.

   설정: Vercel 프로젝트 → Settings → Environment Variables → ANTHROPIC_API_KEY
   ========================================================================== */

const AnthropicPkg = require("@anthropic-ai/sdk");
const Anthropic = AnthropicPkg.default || AnthropicPkg;

const MODEL = "claude-opus-5";

/* 입력 상한 — 공개 엔드포인트이므로 페이로드를 좁게 제한합니다 */
const MAX_QUESTION = 500;
const MAX_HEADLINE = 1200;
const MAX_FACTS = 40;
const MAX_FACT_LEN = 200;

/* 인스턴스 단위 초당 요청 제한. 서버리스라 인스턴스마다 따로 세어지므로
   완전한 방어가 아니라 폭주를 늦추는 턱입니다. 실제 상한이 필요하면
   Vercel WAF 나 별도 저장소 기반 리미터를 붙여야 합니다. */
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 30;
const hits = new Map();

function throttled(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 500) hits.clear();          // 메모리 누수 방지
  return arr.length > MAX_PER_WINDOW;
}

const SYSTEM = [
  "당신은 바이오의약품 공정개발 데이터 조회 결과를 한국어 실무 문장으로 다듬는 역할입니다.",
  "",
  "반드시 지켜야 할 규칙:",
  "1. <facts> 와 <headline> 안에 있는 숫자·이름만 사용하십시오. 어떤 수치도 새로 만들거나 추정하지 마십시오.",
  "2. 계산을 다시 하지 마십시오. 값은 이미 실제 데이터에서 계산된 결과입니다.",
  "3. <facts> 에 없는 항목·배치·과제를 언급하지 마십시오.",
  "4. <note> 에 적힌 한계(원본에 기록 없음, 생성한 값, 계산 제외 건수 등)는 반드시 문장에 그대로 담으십시오. 빠뜨리면 답변이 틀린 것으로 간주합니다.",
  "5. 일반적인 배경지식이나 해석을 덧붙이지 마십시오. 데이터가 말하는 것까지만 쓰십시오.",
  "",
  "형식: 2~4문장, 존댓말, 마크다운·목록·표 없이 평문으로만. 군더더기 없는 보고 톤."
].join("\n");

function clip(s, n) {
  const t = String(s == null ? "" : s);
  return t.length > n ? t.slice(0, n) : t;
}

function buildPrompt(body) {
  const facts = Array.isArray(body.facts) ? body.facts.slice(0, MAX_FACTS) : [];
  const lines = facts
    .filter(f => f && (f.k !== undefined))
    .map(f => "- " + clip(f.k, 80) + ": " + clip(f.v, MAX_FACT_LEN));

  return [
    "<question>", clip(body.question, MAX_QUESTION), "</question>",
    "",
    "<headline>", clip(body.headline, MAX_HEADLINE), "</headline>",
    "",
    "<facts>", lines.length ? lines.join("\n") : "(없음)", "</facts>",
    "",
    "<note>", clip(body.note, 800) || "(없음)", "</note>",
    "",
    "위 조회 결과를 사용자에게 전달할 문장으로 다듬어 주십시오."
  ].join("\n");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST 만 허용합니다." });
  }

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (throttled(ip)) {
    return res.status(429).json({ error: "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요." });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    /* 화면은 이 응답을 받으면 엔진이 만든 문장을 그대로 씁니다 */
    return res.status(503).json({
      error: "not-configured",
      message: "ANTHROPIC_API_KEY 가 설정되지 않아 문장 다듬기를 건너뜁니다."
    });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== "object" || !body.headline) {
    return res.status(400).json({ error: "headline 이 필요합니다." });
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const msg = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      /* 안전 분류기가 요청을 거절하면 다른 모델로 자동 재시도합니다 */
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      /* 문장 다듬기라 깊게 생각할 일이 없습니다 — 낮은 effort 로 지연을 줄입니다 */
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [{ role: "user", content: buildPrompt(body) }]
    });

    if (msg.stop_reason === "refusal") {
      return res.status(200).json({
        error: "refusal",
        message: "모델이 이 요청에 답하지 않았습니다. 조회 결과는 그대로 유효합니다."
      });
    }

    const text = (msg.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("")
      .trim();

    if (!text) {
      return res.status(200).json({ error: "empty", message: "빈 응답을 받았습니다." });
    }

    return res.status(200).json({
      text,
      model: msg.model,
      usage: msg.usage
        ? { input: msg.usage.input_tokens, output: msg.usage.output_tokens }
        : null
    });
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    /* 키·요금·한도 문제는 화면에서 구분해 안내할 수 있게 상태를 그대로 전달 */
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      error: "upstream",
      message: (err && err.message) || "Claude API 호출에 실패했습니다."
    });
  }
};
