# API key 를 넣은 뒤 실행할 검증 절차

Phase C 시점에 `ANTHROPIC_API_KEY` 가 Vercel 에 설정되어 있지 않아, 아래
항목은 **확인하지 못한 상태(BLOCKED)** 로 남았습니다. 키를 넣고 재배포한
뒤 이 순서대로 실행하면 그 항목들이 실제로 되는지 판정할 수 있습니다.

키 값을 이 문서·코드·대화에 적지 마세요. Vercel 환경변수에만 둡니다.

---

## 0. 사전 확인 — 서버가 키를 인식하는가

```bash
curl -s "https://dongaproject-mvyo.vercel.app/api/health" | python -m json.tool
```

`apiKey.ok` 이 `true` 여야 합니다. `false` 면 재배포가 아직 반영되지 않은
것입니다 (환경변수 변경은 재배포가 필요합니다).

기대: `route` · `apiKey` · `chatRoute` · `containment` 모두 `ok: true`,
HTTP 200. `allowedTools` 가 17개.

## 1. 실제 Claude 호출 · Tool calling

```bash
curl -s "https://dongaproject-mvyo.vercel.app/api/health?deep=1" | python -m json.tool
```

요금이 발생합니다 (아주 적음). 기대:

| 항목 | 기대 |
|---|---|
| `claudeCall` | `ok: true`, `model` 이 claude-opus-5 계열 |
| `chatResponse` | `ok: true` |
| `toolCall` | `ok: true`, note 에 `health_ping` |

`claudeCall` 이 실패하면 키가 유효하지 않거나 조직 권한 문제입니다.
응답에 내부 경로·stack 이 없는지도 함께 봅니다.

## 2. plan 경로 — 모델이 도구를 고르는가

```bash
curl -s -X POST "https://dongaproject-mvyo.vercel.app/api/chat" \
  -H "Content-Type: application/json" \
  -d '{"mode":"plan","question":"이번 실험에서 뭔가 특이한 점이 있어?","context":{"pageKo":"DoE & Intelligence","describe":"화면에 28건"},"toolDefs":[{"name":"searchExperimentData","description":"사내 실험 데이터를 조회합니다","input_schema":{"type":"object","properties":{"question":{"type":"string"}},"required":[],"additionalProperties":false},"strict":true}],"history":[]}'
```

기대: `{"tool":"searchExperimentData","args":{...}}`.
`tool` 이 allowlist 안의 이름이어야 합니다. `not-allowed` · `no-tool` 이
나오면 그 이유를 그대로 기록하고 PASS 로 쓰지 않습니다.

## 3. 브라우저에서 전체 경로 — 규칙 / 폴백 분리

production 에 로그인한 뒤 콘솔에서:

```js
const seen = []; const real = window.fetch;
window.fetch = function (u, o) {
  if (String(u).indexOf("/api/chat") > -1) { try { seen.push(JSON.parse(o.body).mode); } catch (e) {} }
  return real.apply(this, arguments);
};
window.GlobalAI._setLlmState(null);
const a = await window.GlobalAI.ask("평균 Titer와 CV 알려줘");          // 규칙
const n1 = seen.length;
window.GlobalAI._setLlmState(null);
const b = await window.GlobalAI.ask("이번 실험에서 사람이 놓치기 쉬운 이상한 패턴이나 주의할 점을 찾아줘");
window.fetch = real;
({ ruleCalls: n1, fallbackCalls: seen.length - n1, aVia: a.via, bVia: b.via });
```

기대: `ruleCalls: 0` · `fallbackCalls: 1` · `aVia: "rule"` · **`bVia: "llm"`**.

`bVia` 가 `"llm"` 이 되는 것이 Phase C 에서 확인하지 못한 핵심입니다.
지금(키 없음)은 `"rule"` 로 떨어집니다.

## 4. Claude 가 수치를 만들지 못하는가

3번의 `b` 에 대해:

```js
const t = window.AskTables.internal();
b.answer.verified;                       // { ok: true, checked: N } 이어야 합니다
JSON.stringify(b).indexOf("99999");      // -1 (모델이 넣은 임의 값이 없어야)
```

기대: `verified.ok === true`. 수치는 도구가 만들고 AskVerify 가 데이터셋에서
다시 계산해 대조한 것이어야 합니다.

## 5. narrate — 스트리밍이 브라우저까지 오는가

`외부 AI 해설` 을 **켠 뒤** (패널 상단 [켜기]):

```js
const chunks = [];
const out = await window.GlobalAI.ask("Max VCD 평균 알려줘");
const r = await window.GlobalAI.narrate("이 결과를 연구원에게 설명하듯 알려줘",
                                        out, d => chunks.push(d));
({ chunkCount: chunks.length, blocked: r && r.blocked, text: r && r.text });
```

기대: `chunkCount > 1` (한 번에 오지 않고 흘러 들어옴), `text` 가 문장,
`blocked` 는 없음. `blocked` 가 있으면 모델이 받은 값 밖의 숫자를 써서
문장이 통째로 버려진 것이며, 그것도 정상 동작입니다 — 그 경우 어떤 숫자가
문제였는지 기록합니다.

화면에서는 수치·표가 먼저 확정 표시되고 그 **아래**에 해설이 흘러야 합니다.
순서가 뒤집히면 검증 전 숫자가 먼저 보이는 것이므로 결함입니다.

## 6. narrate OFF 계약이 여전히 지켜지는가

키가 있어도 OFF 는 OFF 여야 합니다. 반드시 다시 확인합니다.

```js
window.GlobalAI.setNarrate(false);
const seen = []; const real = window.fetch;
window.fetch = function (u, o) {
  if (String(u).indexOf("/api/chat") > -1) { try { seen.push(JSON.parse(o.body)); } catch (e) {} }
  return real.apply(this, arguments);
};
const out = await window.GlobalAI.ask("Max VCD 평균 알려줘");
const r = await window.GlobalAI.narrate("설명해줘", out, () => {});
window.fetch = real;
({ narrateCalls: seen.filter(x => x.mode === "narrate").length, result: r });
```

기대: `narrateCalls: 0` · `result: null`.
0 이 아니면 즉시 되돌려야 하는 회귀입니다.

## 7. 기존 검사 스위트

로컬 정적 서버에서 아래를 모두 돌립니다 (`tests/` 는 배포에 포함되지 않습니다).

| 파일 | 기대 |
|---|---|
| `tests/ask-regression.html` | 17 그룹 전부 통과 |
| `tests/ssot.html` | 25/25 |
| `tests/global-ai.html` | 12 그룹 전부 통과 |
| `tests/phase-b.html` | 9 그룹 전부 통과 |
| `tests/mutation.html` | 34/34 검출 · `restored: true` |
| `tests/llm-adversarial.html` | 키가 있을 때만 의미가 있습니다 — 여기서 처음 실측합니다 |

`llm-adversarial` 은 Phase C 까지 한 번도 실제 모델로 돌려 본 적이 없습니다.
키를 넣은 뒤 처음 돌리는 항목이므로, 결과를 그대로 기록하고 통과라고
미리 적지 마세요.

## 8. 판정 기록

각 항목을 PASS / FAIL 로만 적습니다. 실행하지 못한 것은 BLOCKED 로 남기고,
실행했지만 결과가 애매한 것은 FAIL 로 적고 무엇이 애매했는지 씁니다.
"동작해야 합니다" 같은 표현은 쓰지 않습니다.
