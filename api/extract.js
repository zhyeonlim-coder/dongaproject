/* ==========================================================================
   api/extract.js — 자연어 질문 → 슬롯(JSON) 추출 Vercel Serverless Function

   역할이 좁습니다. 여기서 하는 일은 "질문을 구조로 바꾸는 것" 하나뿐입니다.

     · 조회 · 필터 · 집계 · 통계 : 브라우저의 ask-engine.js 가 전담
     · 질문 → 슬롯               : 여기(Claude)가 전담
     · 결과 → 문장               : api/narrate.js 가 전담

   원본 데이터는 보내지 않습니다. 보내는 것은 스키마 카탈로그(컬럼 이름 ·
   단위 · 값 범위 · 과제/Study 목록)와 질문뿐입니다. 모델은 값을 볼 수 없고,
   따라서 수치를 지어낼 수도 없습니다.

   출력은 strict 도구 호출로 받습니다. 프리필은 Opus 5 에서 400 이고,
   "JSON 만 출력하라"는 지시는 지켜지지 않을 때가 있어 스키마로 강제합니다.

   키가 없으면 503 을 돌려주고, 화면은 규칙 매칭 결과를 그대로 씁니다 —
   키가 없어도 서비스는 규칙 엔진만으로 정상 동작합니다.
   ========================================================================== */

const AnthropicPkg = require("@anthropic-ai/sdk");
const Anthropic = AnthropicPkg.default || AnthropicPkg;

const MODEL = "claude-opus-5";

const MAX_QUESTION = 500;
const MAX_CATALOG = 20000;      /* 카탈로그는 데이터셋에서 생성되므로 상한만 둡니다 */
const MAX_HISTORY = 2;

const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 40;
const hits = new Map();

function throttled(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 500) hits.clear();
  return arr.length > MAX_PER_WINDOW;
}

/* 슬롯 스키마 — 규칙 매칭이 만드는 것과 같은 모양이어야 합니다.
   그래야 이후 코드가 "규칙에서 왔는지 LLM 에서 왔는지" 몰라도 됩니다. */
const SLOT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "target", "filters", "sortBy", "limit",
             "qualitativeBasis", "refersToPrevious", "confidence", "unhandled"],
  properties: {
    intent: {
      type: "string",
      enum: ["max", "min", "stat", "trend", "compare", "count", "missing",
             "list", "meta", "help", "unsupported", "ambiguous"]
    },
    target: {
      type: "object",
      additionalProperties: false,
      required: ["type", "keys"],
      properties: {
        type: { type: "string", enum: ["metric", "group", "entity", "meta", "date"] },
        keys: { type: "array", items: { type: "string" } }
      }
    },
    filters: {
      type: "object",
      additionalProperties: false,
      required: ["dateRange", "projectIds", "studyIds", "batchIds", "team", "conditions", "exclude"],
      properties: {
        dateRange: {
          type: "object",
          additionalProperties: false,
          required: ["field", "from", "to"],
          properties: {
            field: { type: ["string", "null"] },
            from: { type: ["string", "null"] },
            to: { type: ["string", "null"] }
          }
        },
        projectIds: { type: "array", items: { type: "string" } },
        studyIds: { type: "array", items: { type: "string" } },
        batchIds: { type: "array", items: { type: "string" } },
        team: { type: ["string", "null"] },
        conditions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["field", "op", "value", "unit"],
            properties: {
              field: { type: ["string", "null"] },
              op: { type: ["string", "null"], enum: ["gte", "gt", "lte", "lt", "between", null] },
              value: { type: ["number", "array", "null"], items: { type: "number" } },
              unit: { type: ["string", "null"] }
            }
          }
        },
        exclude: { type: "array", items: { type: "string" } }
      }
    },
    sortBy: {
      type: "object",
      additionalProperties: false,
      required: ["field", "order"],
      properties: {
        field: { type: ["string", "null"] },
        order: { type: "string", enum: ["asc", "desc"] }
      }
    },
    limit: { type: ["number", "null"] },
    qualitativeBasis: { type: ["string", "null"] },
    refersToPrevious: { type: "boolean" },
    confidence: { type: "number" },
    unhandled: { type: "array", items: { type: "string" } }
  }
};

const SYSTEM = [
  "당신은 바이오의약품 공정개발 데이터에 대한 한국어 질문을 조회 슬롯으로 바꾸는 파서입니다.",
  "당신은 데이터를 조회하지도, 계산하지도, 답을 쓰지도 않습니다. 오직 질문의 구조만 읽습니다.",
  "",
  "반드시 지킬 것:",
  "1. extract_slots 도구를 정확히 한 번 호출하십시오. 다른 형태로 답하지 마십시오.",
  "2. 컬럼 · 과제 · Study · 배치는 <catalog> 에 있는 key 만 사용하십시오. 없는 이름을 만들지 마십시오.",
  "3. 질문에 없는 조건은 채우지 마십시오. 없으면 null 또는 빈 배열로 두십시오.",
  "4. 숫자 조건의 단위는 사용자가 쓴 그대로 담으십시오. 안 썼으면 unit 은 null 입니다.",
  "   단위를 추측해 환산하지 마십시오 — 환산은 서버가 실측 범위와 대조해 처리합니다.",
  "5. 해석하지 못한 표현은 unhandled 에 원문 그대로 넣으십시오. 빠뜨리면 사용자가 조건이",
  "   반영된 줄 착각합니다.",
  "6. <catalog> 의 unsupportedFeatures 에 해당하는 질문이면 intent 를 \"unsupported\" 로 하고,",
  "   무엇을 요구했는지 unhandled 에 적으십시오. 그럴듯하게 다른 조회로 바꾸지 마십시오.",
  "7. 확신이 없으면 confidence 를 낮추십시오(0~1). 추측해서 채우는 것보다 낮은 confidence 가 낫습니다.",
  "   서로 다르게 읽힐 수 있는 질문이면 intent 를 \"ambiguous\" 로 하십시오.",
  "8. \"좋다/나쁘다\" 처럼 기준이 없는 정성 표현은 qualitativeBasis 에 그 표현을 담고,",
  "   임의로 특정 항목을 고르지 마십시오.",
  "9. 지시어(\"그거\", \"아까 그\")나 생략형(\"그럼 정제는?\")이면 refersToPrevious 를 true 로 하십시오.",
  "",
  "이 데이터는 규제 문서에 인용됩니다. 그럴듯한 오답이 정직한 \"모르겠다\" 보다 훨씬 해롭습니다."
].join("\n");

function clip(s, n) {
  const t = String(s == null ? "" : s);
  return t.length > n ? t.slice(0, n) : t;
}

function buildPrompt(body) {
  const hist = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY) : [];
  const histText = hist.length
    ? hist.map((h, i) =>
        "[" + (i + 1) + "] 질문: " + clip(h.question, 200) + "\n" +
        "    슬롯: " + clip(JSON.stringify(h.slots || {}), 600) + "\n" +
        "    결과: " + clip(h.summary, 300)).join("\n")
    : "(없음)";

  return [
    "<catalog>", clip(JSON.stringify(body.catalog), MAX_CATALOG), "</catalog>",
    "",
    "<recent_turns>", histText, "</recent_turns>",
    "",
    "<question>", clip(body.question, MAX_QUESTION), "</question>",
    "",
    "이 질문을 슬롯으로 바꾸십시오."
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
    /* 화면은 이 응답을 받으면 규칙 매칭 결과를 그대로 씁니다 */
    return res.status(503).json({
      error: "not-configured",
      message: "ANTHROPIC_API_KEY 가 설정되지 않아 규칙 매칭만 사용합니다."
    });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== "object" || !body.question || !body.catalog) {
    return res.status(400).json({ error: "question 과 catalog 가 필요합니다." });
  }

  try {
    /* 재시도는 끄고 짧은 타임아웃을 둡니다 — 브라우저가 3초에 끊고 규칙으로
       되돌아가므로, 여기서 오래 매달려 있어 봐야 의미가 없습니다.
       (TypeScript SDK 의 timeout 단위는 밀리초입니다) */
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: 8000,
      maxRetries: 0
    });

    const msg = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      /* 구조만 읽는 일이라 깊게 생각할 필요가 없습니다 — 지연을 줄입니다 */
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system: SYSTEM,
      tools: [{
        name: "extract_slots",
        description: "질문에서 읽어 낸 조회 슬롯. 질문에 없는 것은 채우지 않는다.",
        strict: true,
        input_schema: SLOT_SCHEMA
      }],
      tool_choice: { type: "tool", name: "extract_slots" },
      messages: [{ role: "user", content: buildPrompt(body) }]
    });

    if (msg.stop_reason === "refusal") {
      return res.status(200).json({
        error: "refusal",
        message: "모델이 이 질문의 해석을 거절했습니다. 규칙 매칭 결과를 사용합니다."
      });
    }

    const call = (msg.content || []).find(b => b.type === "tool_use" && b.name === "extract_slots");
    if (!call) {
      return res.status(200).json({ error: "empty", message: "슬롯을 받지 못했습니다." });
    }

    return res.status(200).json({
      slots: call.input,
      model: msg.model,
      usage: msg.usage
        ? { input: msg.usage.input_tokens, output: msg.usage.output_tokens }
        : null
    });
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      error: "upstream",
      message: (err && err.message) || "Claude API 호출에 실패했습니다."
    });
  }
};
