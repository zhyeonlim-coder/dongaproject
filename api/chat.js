/* ==========================================================================
   api/chat.js — Global AI Assistant 서버  ·  POST /api/chat

   두 가지 일만 합니다.

     mode="plan"      질문 + 도구 목록 → 어떤 도구를 어떤 인자로 부를지
     mode="narrate"   이미 확정된 조회 결과 → 사람이 읽을 설명 (SSE 스트리밍)

   ★ 무엇이 서버로 오는가 — 단계마다 다릅니다. 정확히 적습니다.

     plan 단계    질문 · 도구 이름/설명/인자 형태 · 현재 화면 상태 문장.
                  실험 측정값은 오지 않습니다. 모델은 값을 본 적이 없으므로
                  이 단계에서는 값을 지어낼 재료가 없습니다.

     narrate 단계 <b>이미 검증을 마친 조회 결과의 일부가 옵니다.</b>
                  headline · stats(n·평균·중앙값·표준편차·최소·최대·CV) ·
                  note. 즉 실제 측정에서 나온 수치가 모델에게 갑니다.
                  설명을 쓰려면 무엇을 설명할지 알아야 하기 때문입니다.

     "데이터를 서버로 보내지 않는다" 는 plan 단계에만 참입니다.
     narrate 까지 그렇게 말하면 거짓입니다.

   ★ 도구는 allowlist 입니다.
     클라이언트가 보낸 도구 목록을 그대로 믿지 않고, 이 파일에 박힌
     ALLOWED 와 교집합만 모델에게 줍니다. 모델이 목록 밖 이름을 돌려주면
     버립니다. 임의의 함수·URL 을 부를 수 있는 경로를 만들지 않습니다.

   ★ narrate 단계의 서버 검사는 "검증" 이 아니라 "이탈 차단" 입니다.

     서버는 Repo 를 볼 수 없습니다. 그러니 어떤 숫자가 실제 데이터와
     맞는지 서버가 독립적으로 판단할 방법이 없습니다.
     서버가 실제로 하는 일은 이것입니다 —
       "모델이 <b>받은 값 집합 밖의 숫자</b>를 문장에 넣었는가"

     값이 옳은지 판단하는 것(진짜 검증)은 브라우저의 AskVerify 입니다.
     그쪽은 결과 객체가 아니라 데이터셋에서 다시 계산한 값과 대조하므로
     독립적입니다. 서버 검사는 그 뒤에 오는 이탈 차단 한 겹입니다.

     이 둘을 같은 이름으로 부르면, 서버가 하지 않는 일을 한다고 믿게
     됩니다. 그래서 이름을 나눠 둡니다.
   ========================================================================== */

const AnthropicPkg = require("@anthropic-ai/sdk");
const Anthropic = AnthropicPkg.default || AnthropicPkg;
const S = require("./_shared");

const MODEL = "claude-opus-5";
const MAX_QUESTION = 500;
const MAX_HISTORY = 3;
const MAX_PER_WINDOW = 30;

/* ── 도구 allowlist ──────────────────────────────────────────────────────
   클라이언트가 보낸 정의를 그대로 쓰지 않습니다. 이름이 여기 없으면
   모델에게 보여 주지도 않고, 모델이 돌려줘도 실행 지시를 만들지 않습니다.
   ai/tools.js 의 SPEC 과 이름이 맞아야 합니다. 클라이언트에 도구를 더하고
   이 목록을 잊으면, 규칙이 놓친 질문에서 그 도구만 조용히 못 쓰게 됩니다 —
   화면에서는 "LLM 이 이해하지 못했다" 처럼 보여 원인을 찾기 어렵습니다.
   실제로 화면 조작 3종 중 proposeFilter 만 여기 있었습니다.

   /api/health 가 이 목록을 이름째로 돌려주고, tests/phase-b.js 가 클라이언트
   목록과 집합으로 대조합니다 — 하나라도 어긋나면 그 검사가 실패합니다. */
/* 이름 목록은 한 파일에만 적습니다. 서버가 여기서 읽고, 브라우저 검사도
   같은 파일을 읽어 클라이언트 SPEC 과 대조합니다. 목록을 두 곳에 적으면
   한쪽만 고쳐지고, 그 어긋남은 증상이 없어서 오래 남습니다.
   배포 시점에 함수 번들에 포함되므로 요청으로는 바꿀 수 없습니다. */
const ALLOWED = require("../donga-st-bio-hub/assets/js/ai/tool-allowlist.json").tools;

const SYSTEM_PLAN = [
  "당신은 동아에스티 Bio Knowledge Hub 의 연구지원 AI 입니다.",
  "사용자의 자연어 질문을 읽고, 어떤 도구를 어떤 인자로 불러야 하는지만 정합니다.",
  "",
  "반드시 지킬 것",
  "1. 당신은 실험 데이터를 볼 수 없습니다. 수치를 답에 쓰지 마세요.",
  "2. 계산·조회는 전부 도구가 합니다. 당신이 값을 추정하거나 계산하지 마세요.",
  "3. 주어진 도구 목록에 없는 도구를 부르지 마세요.",
  "4. 어떤 도구를 불러야 할지 모르겠으면 searchExperimentData 에 사용자의",
  "   질문을 그대로 넘기세요. 그 도구가 조건을 스스로 해석합니다.",
  "5. '이것' '여기' '그 값' 같은 말은 함께 주어지는 현재 화면 정보로 해석하세요.",
  "6. 문헌을 찾는 질문이면 searchLiterature 를 쓰고, 검색어는 논문 검색에",
  "   적합한 형태로 다듬으세요. 논문 제목·저자·DOI 를 지어내지 마세요.",
  "7. 화면의 필터·정렬을 바꾸는 요청이면 proposeFilter 로 제안만 만드세요.",
  "   실제 적용은 사용자가 버튼을 눌러야 일어납니다.",
  "",
  "도구를 하나 고르고 tool_use 로 호출하세요. 설명 문장은 쓰지 마세요."
].join("\n");

const SYSTEM_NARRATE = [
  "당신은 연구지원 AI 입니다. 이미 확정된 조회 결과를 연구원에게 설명합니다.",
  "",
  "반드시 지킬 것",
  "1. 주어진 결과에 있는 수치만 쓰세요. 다른 수치를 쓰면 문장 전체가 버려집니다.",
  "2. 새로 계산하지 마세요. 합계·비율·차이도 결과에 있는 것만 씁니다.",
  "3. 결과에 없는 것은 '기록 없음' 이라고 하세요. 일반 지식으로 채우지 마세요.",
  "4. '대략' '일반적으로' '아마' 같은 표현으로 추정하지 마세요.",
  "5. 규격 적합/부적합(Pass/Fail)은 판정 결과일 때만 말하세요.",
  "6. 2~4문장으로 짧게. 표에 이미 있는 숫자를 나열하지 말고, 무엇을 보아야",
  "   하는지를 설명하세요.",
  "7. 값이 실측이 아니라 생성값(◇ 표시)이면 그 사실을 함께 적으세요."
].join("\n");

/* ── 클라이언트가 보낸 도구 정의를 안전한 형태로 다시 만듭니다 ─────────
   설명 문구는 클라이언트에서 오지만, 이름과 스키마 뼈대는 서버가 정합니다.
   그래야 조작된 정의로 모델을 흔드는 경로가 막힙니다. */
function safeTools(sent) {
  const byName = {};
  (Array.isArray(sent) ? sent : []).forEach(function (t) {
    if (t && typeof t.name === "string") byName[t.name] = t;
  });
  const out = [];
  ALLOWED.forEach(function (name) {
    const t = byName[name];
    if (!t) return;                      /* 이 화면에서 못 쓰는 도구 */
    const props = {};
    const schema = (t.input_schema && t.input_schema.properties) || {};
    Object.keys(schema).slice(0, 8).forEach(function (k) {
      const ty = schema[k] && schema[k].type;
      props[k] = { type: ty === "number" || ty === "object" ? ty : "string" };
    });
    out.push({
      name: name,
      description: S.clip(t.description || name, 400),
      input_schema: { type: "object", properties: props,
                      required: [], additionalProperties: false },
      /* 인자가 스키마를 정확히 지키도록 — 프리필이 없는 모델에서
         JSON 형태를 강제하는 문서화된 방법입니다 */
      strict: true
    });
  });
  return out;
}

/* 현재 화면 정보 — 값이 아니라 "무엇을 보고 있는가" 만 */
function contextLine(ctx) {
  if (!ctx || typeof ctx !== "object") return "현재 화면 정보 없음";
  const bits = [];
  if (ctx.pageKo) bits.push("화면: " + ctx.pageKo);
  if (ctx.section) bits.push("구역: " + ctx.section);
  if (ctx.describe) bits.push("상태: " + ctx.describe);
  if (ctx.doe && ctx.doe.hasPlan) {
    bits.push("DoE 설계 있음 (" + ctx.doe.runs + " run, 응답값 " + ctx.doe.filled + "개 입력)");
  }
  return S.clip(bits.join(" · ") || "현재 화면 정보 없음", 500);
}

/* ── plan — 어떤 도구를 부를지 ──────────────────────────────────────── */
async function plan(client, body, res) {
  const tools = safeTools(body.toolDefs);
  if (!tools.length) {
    return res.status(200).json({ error: "no-tools",
      message: "이 화면에서 쓸 수 있는 도구가 없습니다." });
  }

  const history = (Array.isArray(body.history) ? body.history : [])
    .slice(-MAX_HISTORY)
    .filter(h => h && typeof h.q === "string")
    .map(h => ({ role: "user", content: S.clip(h.q, 300) }));

  const t0 = Date.now();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM_PLAN,
    /* 어려운 해석에서만 깊게 생각하도록 — 대부분의 질문은 즉시 끝납니다 */
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    tools: tools,
    /* 강제하지 않습니다. 도구가 필요 없다고 판단하면 그렇게 답하게 두고,
       그 경우 규칙 경로가 이어받습니다. */
    tool_choice: { type: "auto" },
    messages: history.concat([{
      role: "user",
      content: "[현재 화면] " + contextLine(body.context) + "\n\n" +
               "[질문] " + S.clip(body.question, MAX_QUESTION)
    }])
  });

  /* 안전 정지 — 거절이면 도구를 만들지 않습니다 */
  if (msg.stop_reason === "refusal") {
    return res.status(200).json({ error: "refused",
      message: "이 질문에는 답하지 않았습니다.",
      category: msg.stop_details && msg.stop_details.category || null });
  }

  const call = (msg.content || []).find(b => b.type === "tool_use");
  if (!call) {
    return res.status(200).json({ error: "no-tool",
      message: "부를 도구를 고르지 못했습니다.",
      ms: Date.now() - t0, usage: usageOf(msg) });
  }

  /* ★ 두 번째 allowlist 대조 — 모델이 목록 밖 이름을 돌려줄 수 있습니다 */
  if (ALLOWED.indexOf(call.name) === -1) {
    return res.status(200).json({ error: "not-allowed",
      message: "허용되지 않은 도구를 골랐습니다: " + String(call.name).slice(0, 40) });
  }

  /* 인자에서 스키마에 없는 키를 떨어뜨립니다 */
  const spec = tools.find(t => t.name === call.name);
  const allowedKeys = Object.keys(spec.input_schema.properties);
  const args = {};
  const dropped = [];
  Object.keys(call.input || {}).forEach(function (k) {
    if (allowedKeys.indexOf(k) > -1) args[k] = call.input[k];
    else dropped.push(k);
  });

  return res.status(200).json({
    tool: call.name, args: args, dropped: dropped,
    model: msg.model, ms: Date.now() - t0, usage: usageOf(msg)
  });
}

/* ── narrate — 확정된 결과를 설명 (SSE 스트리밍) ────────────────────────
   ★ 여기 오는 시점에 수치는 이미 확정·검증돼 화면에 그려져 있습니다.
     스트리밍되는 것은 설명 문장뿐이라, 검증 안 된 숫자가 먼저 보이는
     일이 구조적으로 생기지 않습니다. */
async function narrate(client, body, res) {
  const facts = S.clip(JSON.stringify(body.result || {}), 6000);
  /* 결과에서 뽑아 온 허용 수치 — 문장에 이 밖의 수치가 있으면 버립니다 */
  const allowed = Array.isArray(body.allowedNumbers)
    ? body.allowedNumbers.slice(0, 400).filter(n => typeof n === "number") : [];

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const send = (ev, data) => {
    res.write("event: " + ev + "\n");
    res.write("data: " + JSON.stringify(data) + "\n\n");
  };

  let text = "";
  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 1000,
      system: SYSTEM_NARRATE,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      messages: [{
        role: "user",
        content: "[질문] " + S.clip(body.question, MAX_QUESTION) + "\n\n" +
                 "[확정된 조회 결과]\n" + facts + "\n\n" +
                 "이 결과를 연구원에게 2~4문장으로 설명해 주세요."
      }]
    });

    stream.on("text", function (delta) {
      text += delta;
      send("delta", { text: delta });
    });

    const final = await stream.finalMessage();

    if (final.stop_reason === "refusal") {
      send("blocked", { reason: "refused",
        message: "이 결과에 대한 설명은 생성하지 않았습니다." });
      return res.end();
    }

    /* ★ 서버측 수치 재대조 — 브라우저 AskVerify 와 같은 검사를 한 번 더 */
    const bad = unknownNumbers(text, allowed);
    if (bad.length) {
      send("blocked", {
        reason: "unverified-number", numbers: bad.slice(0, 6),
        message: "설명 문장에 조회 결과로 확인되지 않는 수치가 있어 문장을 쓰지 않았습니다."
      });
    } else {
      send("done", { text: text, usage: usageOf(final), model: final.model });
    }
    return res.end();

  } catch (e) {
    const f = S.friendlyError(e);
    send("error", { message: f.message });
    return res.end();
  }
}

/* 문장에서 결과에 없는 수치를 찾습니다.
   식별자(B045-1 · DA-1234)는 숫자가 아니므로 먼저 걷어냅니다 —
   그러지 않으면 멀쩡한 문장이 전부 막힙니다. */
function unknownNumbers(text, allowed) {
  let t = String(text || "");
  t = t.replace(/\d{4}-\d{2}-\d{2}/g, " ");
  t = t.replace(/[A-Za-z]+[-_]?\d+(?:-\d+)*/g, " ");
  t = t.replace(/(\d),(?=\d{3}\b)/g, "$1");
  const set = new Set();
  allowed.forEach(function (v) {
    set.add(v);
    for (let dp = 0; dp <= 3; dp++) set.add(Number(v.toFixed(dp)));
    set.add(Math.floor(v)); set.add(Math.ceil(v));
  });
  const out = [];
  const re = /-?\d+(?:\.\d+)?/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const n = Number(m[0]);
    if (isFinite(n) && !set.has(n)) out.push(n);
  }
  return Array.from(new Set(out));
}

function usageOf(msg) {
  const u = (msg && msg.usage) || {};
  return { input: u.input_tokens, output: u.output_tokens,
           cacheRead: u.cache_read_input_tokens };
}

/* ── 진입점 ──────────────────────────────────────────────────────────── */
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST 만 허용합니다." });
  }
  if (S.throttled(S.clientIp(req), MAX_PER_WINDOW)) {
    return res.status(429).json({ error: "rate-limit",
      message: "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요." });
  }
  const key = S.keyStatus();
  if (!key.ok) return S.notConfigured(res);

  const body = req.body || {};
  if (S.tooBig(body, 80000)) {
    return res.status(413).json({ error: "too-big",
      message: "요청이 너무 큽니다. 실험 데이터는 서버로 보내지 않습니다." });
  }
  if (!body.question || typeof body.question !== "string") {
    return res.status(400).json({ error: "bad-request", message: "question 이 필요합니다." });
  }

  const client = new Anthropic();   /* 키는 환경변수에서만 읽습니다 */

  try {
    if (body.mode === "narrate") return await narrate(client, body, res);
    return await plan(client, body, res);
  } catch (e) {
    const f = S.friendlyError(e);
    if (res.headersSent) { try { res.end(); } catch (x) {} return; }
    return res.status(f.status).json({ error: f.error, message: f.message });
  }
};

/* 검사에서 재사용합니다 */
module.exports.ALLOWED = ALLOWED;
module.exports._unknownNumbers = unknownNumbers;
module.exports._safeTools = safeTools;
