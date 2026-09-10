/* ==========================================================================
   ai/ui.js — 어느 화면에서나 뜨는 AI 패널  ·  window.GlobalAIUI

   화면마다 복사하지 않습니다. shell2.js 가 한 번 mount() 하면 8개 페이지에
   같은 것이 붙습니다.

   상태 7가지를 모두 그립니다.
     닫힘 · 열림 · 입력 중 · 답변 만드는 중 · 도구 실행 중 · 데이터 조회 중 · 오류

   ★ 수치는 검증이 끝난 뒤에 한 번에 그립니다.
     "만드는 중" 동안 화면에는 진행 표시만 있고 숫자는 없습니다.
     검증 전 숫자를 잠깐이라도 보여주면 사용자는 그것을 이미 읽습니다.
   ========================================================================== */

window.GlobalAIUI = (function () {
  "use strict";

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  let root = null, panel = null, body = null, input = null, fab = null;
  let open = false, busy = false, full = false;
  let lastProposal = null;

  /* ── 마운트 ──────────────────────────────────────────────────────────── */
  function mount() {
    if (root) return;
    if (!window.AIContext || !window.GlobalAI) return;   /* 모듈이 없으면 조용히 안 붙습니다 */

    root = document.createElement("div");
    root.className = "gai-root";
    root.innerHTML =
      '<button class="gai-fab" id="gai-fab" aria-expanded="false" aria-controls="gai-panel">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1' +
        'M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="3.2"/></svg>' +
        '<span>질문하기</span><kbd>Ctrl K</kbd></button>' +

      '<aside class="gai-panel" id="gai-panel" role="dialog" aria-modal="false" ' +
        'aria-label="AI 어시스턴트" hidden>' +
        '<div class="gai-head">' +
          '<div style="min-width:0">' +
            '<div class="gai-title">AI 어시스턴트</div>' +
            '<div class="gai-ctx" id="gai-ctx"></div>' +
          '</div>' +
          '<div class="gai-head-actions">' +
            '<button class="btn btn-ghost btn-sm" id="gai-full" title="전체 화면으로">⤢</button>' +
            '<button class="btn btn-ghost btn-sm" id="gai-clear" title="대화 비우기">비우기</button>' +
            '<button class="btn btn-ghost btn-sm" id="gai-close" aria-label="닫기">✕</button>' +
          '</div>' +
        '</div>' +
        /* 지금 어느 모드인지 항상 보입니다 — 사용자가 모르는 채로 켜져
           있으면 안 되고, 모르는 채로 꺼져 있어도 안 됩니다 */
        '<div class="gai-mode" id="gai-mode"></div>' +
        '<div class="gai-body" id="gai-body"></div>' +
        '<div class="gai-foot">' +
          '<form class="gai-form" id="gai-form">' +
            '<label class="sr-only" for="gai-input">질문</label>' +
            '<textarea class="gai-input" id="gai-input" rows="1" ' +
              'placeholder="예: 이 화면에서 가장 높은 값은?"></textarea>' +
            '<button class="btn btn-accent btn-sm" type="submit" id="gai-send">보내기</button>' +
          '</form>' +
        '</div>' +
      "</aside>";

    document.body.appendChild(root);
    panel = root.querySelector("#gai-panel");
    body  = root.querySelector("#gai-body");
    input = root.querySelector("#gai-input");
    fab   = root.querySelector("#gai-fab");

    fab.addEventListener("click", toggle);
    root.querySelector("#gai-close").addEventListener("click", close);
    root.querySelector("#gai-clear").addEventListener("click", function () {
      window.GlobalAI.reset(); body.innerHTML = ""; welcome();
    });
    root.querySelector("#gai-full").addEventListener("click", function () {
      full = !full; panel.classList.toggle("is-full", full);
      this.setAttribute("title", full ? "패널로 줄이기" : "전체 화면으로");
    });
    root.querySelector("#gai-form").addEventListener("submit", function (e) {
      e.preventDefault(); send(input.value);
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input.value); }
    });
    input.addEventListener("input", function () {
      this.style.height = "auto";
      this.style.height = Math.min(120, this.scrollHeight) + "px";
    });

    document.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault(); open ? close() : show();
      }
      if (e.key === "Escape" && open) close();
    });

    /* 화면 상태가 바뀌면 머리말도 따라 바뀝니다 */
    window.AIContext.on(paintCtx);
    paintCtx();
    welcome();
  }

  function paintCtx() {
    const el = root && root.querySelector("#gai-ctx");
    if (!el) return;
    const d = window.AIContext.describe();
    el.textContent = d || "현재 화면 기준으로 답합니다";
    el.title = d;
    paintMode();
  }

  /* ── 외부 AI 해설 상태 ───────────────────────────────────────────────
     기본은 꺼짐이고, 켜는 것은 명시적 선택입니다. 켜면 무엇이 나가는지
     그 자리에 적습니다 — 켜고 나서 알게 되면 늦습니다.

     경고창을 띄우지 않습니다. 매번 막아 세우면 사람은 읽지 않고 누릅니다.
     대신 상태를 늘 보이게 두고, 켤 때 한 번 확인을 받습니다. */
  function paintMode() {
    const el = root && root.querySelector("#gai-mode");
    if (!el) return;
    const on = window.GlobalAI.narrateEnabled();
    el.innerHTML =
      '<span class="gai-mode-tag' + (on ? " is-on" : "") + '">' +
        (on ? "외부 AI 해설 ON" : "외부 AI 해설 OFF") + "</span>" +
      '<span class="gai-mode-why">' +
        (on
          ? "질문과 분석 결과 요약(평균·최소·최대 등)이 외부 AI 서비스로 전송됩니다."
          : "조회·계산·검증은 이 브라우저에서만 하고, 실험 데이터를 외부로 보내지 않습니다.") +
      "</span>" +
      '<button class="gai-mode-btn" id="gai-mode-toggle" type="button">' +
        (on ? "끄기" : "켜기") + "</button>";

    const b = el.querySelector("#gai-mode-toggle");
    if (b) b.addEventListener("click", function () {
      if (!on) {
        const okd = window.confirm(
          "외부 AI 해설을 켜면 질문 및 일부 분석 결과(평균 · 최소 · 최대 등 " +
          "요약 수치)가 외부 AI 서비스로 전송될 수 있습니다.\n\n" +
          "표와 수치 자체는 지금도 이 브라우저에서 계산·검증합니다. " +
          "켜면 그 결과를 설명하는 문장이 추가됩니다.\n\n켜시겠습니까?");
        if (!okd) return;
      }
      window.GlobalAI.setNarrate(!on);
      paintMode();
    });
  }

  /* ── 열고 닫기 ───────────────────────────────────────────────────────── */
  function show() {
    if (!root) mount();
    open = true;
    panel.hidden = false;
    /* transform 전환이 먹도록 한 프레임 뒤에 클래스를 겁니다 */
    requestAnimationFrame(() => panel.classList.add("is-open"));
    fab.setAttribute("aria-expanded", "true");
    fab.hidden = true;
    paintCtx();
    /* 아직 대화가 없으면 첫 화면을 다시 그립니다 — 추천 질문은 지금 보고
       있는 화면에 따라 달라야 하는데, 마운트 시점(대개 대시보드)에 한 번
       그리고 말면 다른 화면에서도 그 목록이 그대로 남습니다. */
    if (!body.querySelector(".gai-msg")) welcome();
    setTimeout(() => input && input.focus(), 60);
  }
  function close() {
    open = false;
    panel.classList.remove("is-open");
    fab.hidden = false;
    fab.setAttribute("aria-expanded", "false");
    setTimeout(() => { if (!open) panel.hidden = true; }, 200);
  }
  function toggle() { open ? close() : show(); }

  /* ── 첫 화면 ─────────────────────────────────────────────────────────── */
  function welcome() {
    const s = window.GlobalAI.suggestions();
    body.innerHTML =
      '<div class="gai-empty">무엇을 도와드릴까요?<br>' +
      '지금 보고 계신 화면을 기준으로 답합니다. 답에 쓰인 수치는 모두 ' +
      '실제 데이터에서 계산한 뒤 다시 대조합니다 — 없는 값은 만들지 않습니다.</div>' +
      suggHTML(s);
    wireSugg();
  }
  function suggHTML(list) {
    if (!list || !list.length) return "";
    return '<div class="gai-sugg">' +
      list.map(q => '<button type="button" data-q="' + esc(q) + '">' + esc(q) + "</button>").join("") +
      "</div>";
  }
  function wireSugg() {
    Array.prototype.forEach.call(body.querySelectorAll("[data-q]"), function (b) {
      b.addEventListener("click", () => send(b.dataset.q));
    });
  }

  /* ── 질문 보내기 ─────────────────────────────────────────────────────── */
  function send(q) {
    const question = String(q || "").trim();
    if (!question || busy) return;
    busy = true;
    input.value = ""; input.style.height = "auto";

    const msg = document.createElement("div");
    msg.className = "gai-msg";
    msg.innerHTML = '<div class="gai-q">' + esc(question) + "</div>" +
      '<div class="gai-a" data-slot>' + statusHTML("질문을 해석하는 중…") + "</div>";
    body.appendChild(msg);
    scroll();

    const slot = msg.querySelector("[data-slot]");
    /* 도구 실행 단계를 알려 줍니다 — 무엇을 하고 있는지 보여야 기다립니다.
       단계는 GlobalAI 가 알려 줍니다. 화면에서 route() 를 다시 부르면
       실제로 실행되는 도구와 어긋납니다 (문헌 후속처럼 안에서 계획이
       바뀌는 경우가 있습니다). */
    let sawLlm = false;
    window.GlobalAI.ask(question, function (info) {
      if (info.stage === "llm") {
        sawLlm = true;
        slot.innerHTML = statusHTML("규칙으로 읽지 못해 Claude 에게 도구 선택을 묻는 중…");
      } else if (info.stage === "tool") {
        slot.innerHTML = statusHTML(info.ko + " 실행 중…" +
          (info.via === "llm" ? " (Claude 가 고른 도구)" : ""));
      }
      scroll();
    }).then(function (out) {
      if (sawLlm && out) out.sawLlm = true;
      /* ★ 여기서 그리는 수치는 전부 검증을 통과한 것입니다.
         표·통계·핵심 결과를 먼저 확정 표시하고, 그 다음에야 해설을
         흘려보냅니다. 순서가 뒤집히면 검증 안 된 숫자가 먼저 보입니다. */
      slot.innerHTML = answerHTML(out) + pathHTML(out);
      wireAnswer(slot, out);
      busy = false; scroll();
      streamNarration(slot, question, out);
    }).catch(function (e) {
      slot.innerHTML = '<div class="gai-err">답변을 만들지 못했습니다 — ' +
        esc((e && e.message) || "알 수 없는 오류") +
        '<br>화면의 다른 기능은 그대로 사용하실 수 있습니다.</div>';
      busy = false; scroll();
    });
  }

  function statusHTML(t) {
    return '<div class="gai-status"><span class="gai-dot"></span>' + esc(t) + "</div>";
  }

  /* ── 해설 스트리밍 ───────────────────────────────────────────────────
     수치와 표가 이미 확정 표시된 뒤에만 불립니다. 흐르는 것은 설명
     문장뿐이고, 서버가 그 문장을 막으면 아무것도 남기지 않습니다 —
     반쯤 나온 문장을 두면 그게 곧 검증 안 된 답이 됩니다.

     키가 없으면(Phase A 상태) 조용히 아무 일도 하지 않습니다. 엔진이
     만든 결정론적 문장이 이미 위에 있으므로 답변은 온전합니다. */
  function streamNarration(slot, question, out) {
    if (!window.GlobalAI.narrate) return;
    if (out.kind === "error" || out.kind === "empty" ||
        out.kind === "action-proposal" || out.kind === "no-data" ||
        out.kind === "unsupported" || out.kind === "literature-one") return;

    const box = document.createElement("div");
    box.className = "gai-narr";
    box.innerHTML = '<div class="gai-status"><span class="gai-dot"></span>해설을 쓰는 중…</div>';
    slot.appendChild(box);
    let started = false;

    window.GlobalAI.narrate(question, out, function (delta) {
      if (!started) { box.innerHTML = '<div class="gai-narr-text"></div>'; started = true; }
      const el = box.querySelector(".gai-narr-text");
      el.textContent += delta;
      scroll();
    }).then(function (r) {
      if (!r) { box.remove(); return; }          /* 키 없음 · 실패 — 조용히 */
      if (r.blocked) {
        /* 문장을 통째로 버립니다. 부분 노출이 없어야 합니다. */
        box.innerHTML = '<div class="gai-warn">' +
          esc(r.blocked.message || "설명 문장을 사용하지 않았습니다.") +
          (r.blocked.numbers && r.blocked.numbers.length
            ? " (근거 없는 수치: " + esc(r.blocked.numbers.join(", ")) + ")" : "") +
          " 위 결과는 엔진이 계산한 값 그대로입니다.</div>";
        return;
      }
      if (!r.text || !r.text.trim()) { box.remove(); return; }
      box.innerHTML = '<div class="gai-narr-text">' + esc(r.text) + "</div>" +
        '<div class="gai-narr-tag">AI 해설 — 위 표와 수치는 엔진이 데이터에서 계산하고 ' +
        '대조한 값이고, 이 문단은 그것을 설명한 것입니다.</div>';
      /* 경로 요약에도 "해설은 Claude" 를 더합니다. 해설이 실제로 붙은
         뒤에만 더해야 합니다 — 미리 적어 두면 해설이 실패했을 때
         있지도 않은 문장을 Claude 가 썼다고 표시하게 됩니다. */
      const srcRows = slot.querySelectorAll(".gai-src");
      const last = srcRows[srcRows.length - 1];
      if (last && !last.querySelector("[data-narr-tag]")) {
        const s = document.createElement("span");
        s.className = "gai-src-tag is-external";
        s.setAttribute("data-narr-tag", "");
        s.textContent = "🤖 해설 문장 · Claude";
        last.appendChild(s);
      }
      scroll();
    }).catch(function () { box.remove(); });
  }
  function scroll() { body.scrollTop = body.scrollHeight; }

  /* ── 답변 그리기 ─────────────────────────────────────────────────────
     여기 오는 값은 이미 검증을 통과했습니다. 그리는 쪽에서 숫자를 만들지
     않습니다 — 있는 것만 옮깁니다. */
  function answerHTML(out) {
    if (out.kind === "error") {
      return '<div class="gai-err">' + esc(out.headline) +
        (out.note ? "<br>" + esc(out.note) : "") + "</div>" + suggHTML(out.suggestions);
    }
    if (out.kind === "unsupported") {
      return '<div class="gai-a"><div class="gai-headline">' + esc(out.headline) + "</div>" +
        (out.note ? '<div class="gai-note">' + esc(out.note) + "</div>" : "") +
        "</div>" + suggHTML(out.suggestions);
    }
    if (out.kind === "no-data") {
      return '<div class="gai-a"><div class="gai-headline">' + esc(out.headline) + "</div>" +
        srcHTML(out.meta) + "</div>" + suggHTML(out.suggestions);
    }
    if (out.kind === "action-proposal") return actionHTML(out);
    if (out.kind === "formatted") return formattedHTML(out);
    if (out.kind === "literature") return litHTML(out);
    if (out.kind === "literature-one") return litOneHTML(out);
    if (out.kind === "compare-rows") return compareHTML(out);
    if (out.kind === "doe-anova") return anovaHTML(out);
    if (out.kind === "doe-fit") return fitHTML(out);
    if (out.kind === "doe-optimum") return optHTML(out);
    if (out.kind === "engine") return engineHTML(out);
    if (out.kind === "doe-plan") return doePlanHTML(out);
    if (out.kind === "calc") return calcHTML(out);
    if (out.kind === "context") return contextHTML(out);
    if (out.kind === "empty") {
      return '<div class="gai-empty">' + esc(out.headline) + "</div>" + suggHTML(out.suggestions);
    }
    /* ★ 마지막 갈래에서 내부 payload 를 그대로 찍지 않습니다.
       예전에는 여기서 JSON 을 그대로 보여 줬고, "어느 인자가 가장 영향이
       커?" 에 {"kind":"doe-plan",...} 이 화면에 나왔습니다. 사용자에게
       내부 구조를 보여 주는 것은 답이 아니고, 그 안의 숫자를 실측으로
       읽을 위험도 있습니다. 못 그리는 모양이면 못 그린다고 말합니다. */
    if (window.console && console.warn) {
      console.warn("[GlobalAIUI] 그릴 수 없는 응답 모양입니다: " + out.kind, out);
    }
    return '<div class="gai-a"><div class="gai-headline">' +
      "이 결과를 표시할 방법이 아직 없습니다.</div>" +
      '<div class="gai-note">답을 만들기는 했지만 화면에 옮길 서식이 없어, ' +
      "내부 값을 그대로 보여 주지 않았습니다. 다르게 물어봐 주시면 " +
      "표시할 수 있는 형태로 답합니다.</div></div>" + suggHTML(window.GlobalAI.suggestions());
  }

  /* 결과가 반쪽일 때 — 그리려다 죽지 않고, 내부 값을 흘리지도 않습니다 */
  function incompleteHTML(what, out) {
    if (window.console && console.warn) {
      console.warn("[GlobalAIUI] " + what + " 결과에 필요한 항목이 없습니다", out);
    }
    return '<div class="gai-a"><div class="gai-headline">' + esc(what) +
      " 결과를 표시할 수 없습니다.</div>" +
      '<div class="gai-note">계산 결과에 필요한 항목이 빠져 있어, 있는 값만 골라 ' +
      "보여 주는 대신 표시하지 않았습니다. 응답값을 입력한 뒤 다시 물어봐 주세요.</div></div>";
  }

  /* DoE 설계 요약 — 화면에 있는 설계를 그대로 옮깁니다 */
  function doePlanHTML(out) {
    const d = out.data;
    return '<div class="gai-headline">' + esc(d.design || "DoE 설계") + " 설계</div>" +
      '<div class="gai-tbl-wrap"><table class="gai-tbl"><tbody>' +
        "<tr><th>설계</th><td>" + esc(d.design || "—") + "</td></tr>" +
        "<tr><th>Run 수</th><td class=\"mono\">" + esc(d.runs == null ? "—" : d.runs) + "</td></tr>" +
        (d.centers != null ? "<tr><th>중심점</th><td class=\"mono\">" + esc(d.centers) + "</td></tr>" : "") +
        (Array.isArray(d.factors)
          ? d.factors.map((f, i) => "<tr><th>인자 " + (i + 1) + "</th><td>" + esc(f) + "</td></tr>").join("")
          : "") +
      "</tbody></table></div>" +
      '<div class="gai-note">어느 인자가 실제로 영향이 큰지는 응답값을 입력한 뒤 ' +
      "회귀·ANOVA 로 판정합니다. 설계만 보고 영향 크기를 말하지 않았습니다.</div>" +
      srcHTML(out.meta);
  }

  /* 공정 계산 — 계산기가 돌려준 값만 옮깁니다 */
  const CALC_KO = { massBalance: "물질수지", feedVolume: "Feed 량",
                    seedVolume: "Seed 량", dilution: "희석" };
  function calcHTML(out) {
    const d = out.data, r = d.result;
    const rows = (r && typeof r === "object")
      ? Object.keys(r).filter(k => typeof r[k] !== "object").slice(0, 12)
      : [];
    return '<div class="gai-headline">' + esc(CALC_KO[d.type] || d.type) + " 계산 결과</div>" +
      (rows.length
        ? '<div class="gai-tbl-wrap"><table class="gai-tbl"><tbody>' +
            rows.map(k => "<tr><th>" + esc(k) + '</th><td class="mono">' +
              esc(r[k] == null ? "—" : r[k]) + "</td></tr>").join("") +
          "</tbody></table></div>"
        : '<div class="gai-note">계산기가 돌려준 값이 없습니다.</div>') +
      '<div class="gai-note">입력값을 주지 않으셨으면 계산기 기본값으로 계산된 것입니다 — ' +
      "숫자를 확인해 주세요.</div>" +
      srcHTML(out.meta);
  }

  /* 현재 화면 상태 — 값이 아니라 "무엇을 보고 있는가" 입니다 */
  function contextHTML(out) {
    const d = out.data, c = d.context || {};
    const rows = [
      ["화면", c.pageKo], ["구역", c.section],
      ["조건", (c.scope && c.scope.active.length)
        ? c.scope.active.map(a => a.k + " " + a.v).join(" · ") : "없음"],
      ["화면에 보이는 배치", c.visibleCount == null ? "확인 불가" : c.visibleCount + "건"],
      ["지목된 배치", c.currentExperiment || "없음"],
      ["문헌 검색어", c.currentLiteratureQuery || "없음"]
    ].filter(r => r[1] != null);
    return '<div class="gai-headline">' + esc(d.describe || "현재 화면 상태") + "</div>" +
      '<div class="gai-tbl-wrap"><table class="gai-tbl"><tbody>' +
        rows.map(r => "<tr><th>" + esc(r[0]) + "</th><td>" + esc(r[1]) + "</td></tr>").join("") +
      "</tbody></table></div>" + srcHTML(out.meta);
  }

  /* 엔진 응답 — 조건 · 미처리 · 핵심 수치 · 표 · 근거 */
  function engineHTML(out) {
    const r = out.answer;
    let h = "";

    const chips = (r.applied || []).map(a => '<span class="gai-chip">' + esc(a) + "</span>")
      .concat((r.unhandled || []).map(u =>
        '<span class="gai-chip is-unhandled">반영 못 함: ' + esc(String(u).split(" — ")[0]) + "</span>"));
    if (chips.length) h += '<div class="gai-cond">' + chips.join("") + "</div>";

    h += '<div class="gai-headline">' + esc(r.headline) + "</div>";

    /* 가리키는 대상이 여럿일 때 — 아무거나 고르지 않고 누르게 합니다.
       버튼은 그 배치명으로 다시 묻는 것이므로, 눌러도 새로운 해석이
       끼어들지 않습니다. */
    /* 순위 방향·항목이 불분명할 때 — 후보 문장을 그대로 다시 묻습니다 */
    if (r.kind === "ambiguous-rank" && r.choices && r.choices.length) {
      h += '<div class="gai-sugg">' +
        r.choices.map(function (c) {
          return '<button type="button" data-q="' + esc(c + "은?") + '">' + esc(c) + "</button>";
        }).join("") + "</div>";
    }

    if (r.kind === "ambiguous-ref" && r.choices && r.choices.length) {
      const metricLabel = r.metric ? r.metric.label : null;
      h += '<div class="gai-sugg">' +
        r.choices.slice(0, 8).map(function (c) {
          const q = metricLabel ? c + " 의 " + metricLabel + "은?" : c + " 알려줘";
          return '<button type="button" data-q="' + esc(q) + '">' + esc(c) + "</button>";
        }).join("") +
        (r.choices.length > 8
          ? '<button type="button" data-q="그 중 전부 알려줘">전부 ' + esc(r.choices.length) + "건</button>"
          : "") +
        "</div>";
    }

    if (r.stats && r.metric) {
      h += '<div class="gai-stat"><div class="gai-stat-k">' + esc(r.metric.label) + " 평균</div>" +
        '<div class="gai-stat-v">' + esc(fmtNum(r.stats.mean)) +
        (r.metric.unit ? " " + esc(r.metric.unit) : "") + "</div>" +
        '<div class="gai-stat-sub">' + esc(r.stats.n) + "건 · 범위 " +
        esc(fmtNum(r.stats.min)) + "~" + esc(fmtNum(r.stats.max)) +
        (r.stats.cv != null ? " · CV " + esc(r.stats.cv.toFixed(1)) + "%" : "") + "</div></div>";
    }

    if (r.facts && r.facts.length) {
      h += '<div class="gai-tbl-wrap"><table class="gai-tbl"><tbody>' +
        r.facts.slice(0, 14).map(f => "<tr><th>" + esc(f.k) + '</th><td class="mono">' +
          esc(f.v) + "</td></tr>").join("") + "</tbody></table></div>";
    }

    if (r.rows && r.rows.length && r.evidenceCols) {
      const cols = r.evidenceCols;
      h += '<div class="gai-tbl-wrap"><table class="gai-tbl"><thead><tr>' +
        cols.map(c => "<th>" + esc(c.label) + "</th>").join("") + "</tr></thead><tbody>" +
        r.rows.slice(0, 12).map(row => "<tr>" + cols.map(c =>
          '<td class="mono">' + esc(row[c.key] == null ? "—" : row[c.key]) + "</td>").join("") +
          "</tr>").join("") + "</tbody></table></div>";
      if (r.rows.length > 12) {
        h += '<div class="gai-note">표에는 상위 12행만 표시했습니다 (전체 ' + esc(r.rows.length) + "행).</div>";
      }
    }

    if (r.note) h += '<div class="gai-note">' + esc(r.note) + "</div>";
    (r.warnings || []).forEach(w => { h += '<div class="gai-warn">' + esc(w) + "</div>"; });
    if (r.source) h += '<div class="gai-note">' + esc(r.source) + "</div>";

    h += srcHTML(out.meta, r);

    /* 답을 받은 다음에 하는 행동을 그 자리에 둡니다 — 표를 자세히 보거나,
       이 결과를 다른 모양으로 바꾸거나, 이어서 묻는 것입니다. */
    const acts = [];
    if (r.rows && r.rows.length) {
      acts.push('<button class="gai-mode-btn" data-evidence>근거 데이터 보기 (' +
        esc(r.rows.length) + "행)</button>");
    }
    if (r.stats) {
      acts.push('<button class="gai-mode-btn" data-q="이 결과를 표로 정리해줘">표로 정리</button>');
      acts.push('<button class="gai-mode-btn" data-q="이 결과를 보고서 문장으로 만들어줘">보고서 문장</button>');
    }
    if (acts.length) h += '<div class="gai-followup">' + acts.join("") + "</div>";

    if (r.suggestions && r.suggestions.length) h += suggHTML(r.suggestions.slice(0, 4));
    return h;
  }

  function fmtNum(v) {
    if (typeof v !== "number" || !isFinite(v)) return "—";
    return Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2).replace(/\.?0+$/, "");
  }

  /* 근거 카드 — 무엇을 보고 답했는가 */
  function srcHTML(meta, r) {
    if (!meta) return "";
    const tags = [];
    if (meta.source) {
      tags.push('<span class="gai-src-tag' + (meta.external ? " is-external" : "") + '">' +
        (meta.external ? "📄 " : "📊 ") + esc(meta.source) +
        (meta.rows != null ? " · " + esc(meta.rows) + "건" : "") + "</span>");
    }
    if (r && r.verified && r.verified.ok) {
      tags.push('<span class="gai-src-tag is-verified">✓ 수치 ' +
        esc(r.verified.checked) + "개 대조 완료</span>");
    }
    if (meta.scope) tags.push('<span class="gai-src-tag">범위 ' + esc(meta.scope) + "</span>");
    if (!tags.length) return "";
    return '<div class="gai-src">' + tags.join("") + "</div>";
  }

  /* ── 어느 경로로 답했는가 ─────────────────────────────────────────────
     규칙이 읽었는지, Claude 가 도구를 골랐는지 밝힙니다. 어느 쪽이든
     수치는 이 브라우저가 계산하고 대조하지만, 도구 선택을 외부 모델이
     했다는 사실은 사용자가 알아야 합니다 — 답이 어긋났을 때 어디를
     의심해야 하는지가 달라집니다. */
  /* 세 칸으로 나눠 보여 줍니다 — 도구를 고른 것, 값을 만든 것, 문장을 쓴 것.
     사용자가 알아야 하는 것은 "이 숫자를 누가 만들었나" 입니다. 조회한
     값인지, 계산한 값인지, 모델이 해석만 한 것인지 구분되지 않으면
     연구원은 해석 문장의 숫자도 실측처럼 인용합니다. */
  const TOOL_ROLE = {
    searchExperimentData: "조회", getExperiment: "조회",
    calculateStatistics: "계산", calculateCV: "계산", compareExperiments: "계산",
    calculateProcess: "계산", runDoE: "분석", runRegression: "분석",
    runANOVA: "분석", optimizeExperiment: "분석",
    searchLiterature: "외부 검색", literatureFollowUp: "직전 검색 재사용",
    getCurrentPageContext: "화면 상태", formatResult: "재정리",
    proposeFilter: "화면 제안", proposeSort: "화면 제안", proposeSelect: "화면 제안"
  };
  function pathHTML(out) {
    if (!out || out.kind === "empty") return "";
    const parts = [];
    const llm = out.via === "llm";

    /* 1) 도구를 고른 주체 */
    parts.push('<span class="gai-src-tag' + (llm ? " is-external" : "") + '">' +
      (llm ? "🤖 도구 선택 · Claude" : "도구 선택 · 규칙") + "</span>");

    /* 2) 값을 만든 주체 */
    const role = TOOL_ROLE[out.tool] || null;
    const rows = (out.meta && out.meta.rows != null) ? out.meta.rows
               : (out.answer && out.answer.scopeRows != null) ? out.answer.scopeRows : null;
    if (role) {
      parts.push('<span class="gai-src-tag">' + esc(role) + " · " +
        (out.kind === "literature" || out.kind === "literature-one"
          ? "논문 " + esc(rows == null ? "?" : rows) + "건"
          : rows == null ? "이 브라우저" : esc(rows) + "건 · 이 브라우저") + "</span>");
    }

    /* 3) 해설 문장은 실제로 붙은 뒤 streamNarration 이 여기에 더합니다.
          미리 적으면 해설이 실패했을 때 없는 문장을 표시하게 됩니다. */

    if (out.sawLlm && !llm) {
      parts.push('<span class="gai-src-tag">규칙이 읽지 못해 Claude 에게 물었지만, ' +
        "결국 규칙 경로로 답했습니다</span>");
    }
    return '<div class="gai-src">' + parts.join("") + "</div>";
  }

  /* 화면 조작 — 제안만 하고 사용자가 누를 때만 실행 */
  const ACTION_KO = { filter: "필터를 적용", sort: "정렬을 적용", select: "배치를 선택" };
  function actionHTML(out) {
    lastProposal = out.data;
    const what = ACTION_KO[out.data.action] || "이 동작을 실행";
    return '<div class="gai-action"><div class="gai-action-q">' +
      esc(out.data.label) + " 로 " + what + "할까요?</div>" +
      '<div class="gai-action-btns">' +
      '<button class="btn btn-accent btn-sm" data-apply>적용</button>' +
      '<button class="btn btn-ghost btn-sm" data-cancel>취소</button></div></div>' +
      '<div class="gai-note">현재 보고 계신 화면은 [적용] 을 누르기 전까지 바뀌지 않습니다.</div>';
  }

  /* 직전 결과를 표·보고서 문장으로 다시 정리한 것.
     ★ 새로 조회한 값이 아니라 이미 나온 값을 옮긴 것이라, 그 사실을
       적어 둡니다 — 새 조회 결과로 읽으면 시점이 헷갈립니다. */
  function formattedHTML(out) {
    const d = out.data;
    let h = '<div class="gai-headline">' + esc(d.title) + "</div>";
    if (d.style === "table" && d.rows) {
      h += '<div class="gai-tbl-wrap"><table class="gai-tbl"><thead><tr>' +
        "<th>항목</th><th>값</th></tr></thead><tbody>" +
        d.rows.map(r => "<tr><td>" + esc(r["항목"]) + '</td><td class="mono">' +
          esc(r["값"]) + "</td></tr>").join("") + "</tbody></table></div>";
    } else if (d.text) {
      h += '<div class="gai-narr-text" style="white-space:pre-wrap">' + esc(d.text) + "</div>" +
        '<button class="gai-mode-btn" data-copy style="margin-top:var(--s-2)">문장 복사</button>';
    }
    h += '<div class="gai-note">직전 조회 결과를 다시 정리한 것입니다 — ' +
      "새로 조회하거나 새 수치를 만들지 않았습니다." +
      (d.scope ? " (범위 " + esc(d.scope) + ")" : "") + "</div>";
    if (d.source) h += '<div class="gai-note">' + esc(d.source) + "</div>";
    h += srcHTML(out.meta);
    return h;
  }

  /* 문헌 후속 답변 — 논문 한 편.
     DOI 가 없으면 없다고 적습니다. 초록은 출처가 준 문장을 그대로 옮기고,
     그렇다고 밝힙니다 — 우리가 읽고 요약한 것이 아닙니다. */
  function litOneHTML(out) {
    const d = out.data, p = d.paper;
    const head = ({
      doi: "DOI", abstract: "초록 (출처 원문)", cited: "가장 많이 인용된 논문",
      select: "선택한 논문", latest: "가장 최근 논문", oldest: "가장 오래된 논문",
      authors: "저자", journal: "저널", published: "발행연도", title: "제목"
    })[d.aspect] || "선택한 논문";

    let h = '<div class="gai-headline">' + esc(head) +
      (d.query ? ' · "' + esc(d.query) + '" 검색 결과 ' + esc(d.total) + "건 중" : "") + "</div>";

    /* 물어본 항목을 맨 위에 그대로 놓습니다 — 카드에서 찾게 하지 않습니다 */
    const FIELD = { authors: ["저자", p.authors], journal: ["저널", p.journal],
                    published: ["발행연도", p.year], title: ["제목", p.title],
                    doi: ["DOI", p.doi] };
    if (FIELD[d.aspect] && FIELD[d.aspect][1]) {
      h += '<div class="gai-stat"><div class="gai-stat-k">' + esc(FIELD[d.aspect][0]) +
        "</div>" + '<div class="gai-stat-v" style="font-size:15px;line-height:1.5">' +
        esc(FIELD[d.aspect][1]) + "</div></div>";
    }

    if (d.tied > 1) {
      h += '<div class="gai-warn">같은 조건인 논문이 ' + esc(d.tied) +
        "편입니다 — 한 편만 지목하지 않고 첫 편을 보여 드립니다. " +
        "번호로 골라 주시면 그 논문으로 이어서 답합니다.</div>";
    }

    h += '<div class="gai-stat" style="padding:var(--s-3)">' +
      '<div style="font-weight:600;font-size:12.5px">' + esc(p.title) + "</div>" +
      '<div class="gai-stat-sub">' +
        esc([p.authors, p.journal, p.year].filter(Boolean).join(" · ")) + "</div>" +
      (p.doi
        ? '<div class="gai-stat-sub">DOI: <a href="https://doi.org/' + esc(p.doi) +
          '" target="_blank" rel="noopener">' + esc(p.doi) + "</a></div>"
        : '<div class="gai-stat-sub">DOI 가 검색 결과에 없습니다 — 만들지 않았습니다. ' +
          "원문 링크로 확인하세요.</div>") +
      (p.url ? '<div class="gai-stat-sub"><a href="' + esc(p.url) +
        '" target="_blank" rel="noopener">원문 보기</a></div>' : "") +
      (typeof p.cites === "number" ? '<div class="gai-stat-sub">인용 ' + esc(p.cites) + "회</div>" : "") +
      "</div>";

    if (d.aspect === "abstract") {
      h += p.abstract
        ? '<div class="gai-a" style="white-space:pre-wrap">' + esc(p.abstract) + "</div>" +
          '<div class="gai-note">출처가 제공한 초록을 그대로 옮긴 것입니다. ' +
          "우리가 읽고 요약한 것이 아니며, 본문의 결론은 원문에서 확인하세요.</div>"
        : '<div class="gai-note">이 논문은 검색 결과에 초록이 포함되어 있지 않습니다. ' +
          "내용을 지어내지 않았습니다 — 원문 링크에서 확인해 주세요.</div>";
    }

    h += '<div class="gai-note">직전 검색 결과 안에서만 답했습니다 — 다시 검색하지 않았습니다.</div>';
    return h + srcHTML(out.meta);
  }

  function litHTML(out) {
    const items = out.data.items;
    return '<div class="gai-headline">"' + esc(out.data.query) + '" 검색 결과 ' +
      esc(items.length) + "건</div>" +
      items.slice(0, 8).map(function (p) {
        return '<div class="gai-stat" style="padding:var(--s-3)">' +
          '<div style="font-weight:600;font-size:12.5px">' + esc(p.title) + "</div>" +
          '<div class="gai-stat-sub">' + esc([p.authors, p.journal, p.year].filter(Boolean).join(" · ")) +
          "</div>" +
          (p.doi ? '<div class="gai-stat-sub">DOI: <a href="https://doi.org/' + esc(p.doi) +
            '" target="_blank" rel="noopener">' + esc(p.doi) + "</a></div>"
            : '<div class="gai-stat-sub">DOI 없음 — 원문 링크로 확인하세요</div>') +
          (p.url ? '<div class="gai-stat-sub"><a href="' + esc(p.url) +
            '" target="_blank" rel="noopener">원문 보기</a></div>' : "") +
          "</div>";
      }).join("") +
      '<div class="gai-note">검색 결과에 나온 논문만 표시합니다. 목록에 없는 논문이나 DOI 는 만들지 않습니다.</div>' +
      srcHTML(out.meta);
  }

  function compareHTML(out) {
    const d = out.data;
    return '<div class="gai-headline">' + esc(d.a) + " vs " + esc(d.b) + "</div>" +
      '<div class="gai-tbl-wrap"><table class="gai-tbl"><thead><tr><th>항목</th><th>' +
      esc(d.a) + "</th><th>" + esc(d.b) + "</th></tr></thead><tbody>" +
      d.rows.map(r => "<tr><td>" + esc(r["항목"]) + '</td><td class="mono">' +
        esc(r[d.a]) + '</td><td class="mono">' + esc(r[d.b]) + "</td></tr>").join("") +
      "</tbody></table></div>" + srcHTML(out.meta);
  }

  function anovaHTML(out) {
    const a = out.data.anova, m = out.data.model;
    if (!a) return incompleteHTML("분산분석", out);
    const rows = (a.rows || a.terms || []);
    return '<div class="gai-headline">분산분석 (Type I 순차제곱합)</div>' +
      '<div class="gai-tbl-wrap"><table class="gai-tbl"><thead><tr>' +
      "<th>항</th><th>SS</th><th>df</th><th>MS</th><th>F</th><th>p</th>" +
      "</tr></thead><tbody>" +
      rows.map(r => "<tr><td>" + esc(r.name || r.term) + '</td><td class="mono">' +
        esc(fmtNum(r.ss)) + '</td><td class="mono">' + esc(r.df) +
        '</td><td class="mono">' + esc(fmtNum(r.ms)) +
        '</td><td class="mono">' + esc(fmtNum(r.f)) +
        '</td><td class="mono">' + esc(r.p == null || isNaN(r.p) ? "—" : r.p.toFixed(4)) +
        "</td></tr>").join("") + "</tbody></table></div>" +
      '<div class="gai-note">R² ' + esc(fmtNum(m.r2)) + " · 수정 R² " + esc(fmtNum(m.r2adj)) +
      " · n " + esc(m.n) + "。 항을 넣는 순서(선형 → 교호작용 → 2차)에 따라 값이 달라지는 " +
      "순차제곱합입니다. p 가 —인 항은 잔차 자유도가 부족해 계산하지 않았습니다.</div>" +
      srcHTML(out.meta);
  }

  function fitHTML(out) {
    const m = out.data.model;
    /* 모형이 없으면 그리려다 죽는 대신 없다고 말합니다. 도구가 계약을
       어긴 경우이므로 값을 추측해 채우지 않습니다. */
    if (!m || !m.ts || !m.beta) return incompleteHTML("회귀모형", out);
    return '<div class="gai-headline">회귀모형 — ' + esc(out.data.response || "응답") + "</div>" +
      '<div class="gai-stat"><div class="gai-stat-k">R²</div>' +
      '<div class="gai-stat-v">' + esc(fmtNum(m.r2)) + "</div>" +
      '<div class="gai-stat-sub">수정 R² ' + esc(fmtNum(m.r2adj)) +
      " · RMSE " + esc(fmtNum(m.rmse)) + " · n " + esc(m.n) + "</div></div>" +
      '<div class="gai-tbl-wrap"><table class="gai-tbl"><thead><tr>' +
      "<th>항</th><th>계수</th><th>표준오차</th><th>t</th><th>p</th></tr></thead><tbody>" +
      m.ts.map(function (t, i) {
        return "<tr><td>" + esc(t.label || t.name || String(t)) + '</td><td class="mono">' +
          esc(fmtNum(m.beta[i])) + '</td><td class="mono">' +
          esc(m.se ? fmtNum(m.se[i]) : "—") + '</td><td class="mono">' +
          esc(m.tval ? fmtNum(m.tval[i]) : "—") + '</td><td class="mono">' +
          esc(m.pval && m.pval[i] != null && !isNaN(m.pval[i]) ? m.pval[i].toFixed(4) : "—") +
          "</td></tr>";
      }).join("") + "</tbody></table></div>" + srcHTML(out.meta);
  }

  function optHTML(out) {
    const d = out.data;
    return '<div class="gai-headline">' + (d.goal === "min" ? "최소" : "최대") + " 예측 조건</div>" +
      '<div class="gai-stat"><div class="gai-stat-k">예측 ' + esc(d.response || "응답") + "</div>" +
      '<div class="gai-stat-v">' + esc(fmtNum(d.predicted)) + "</div>" +
      '<div class="gai-stat-sub">모형이 예측한 값입니다 — 측정값이 아닙니다</div></div>' +
      (d.actual ? '<div class="gai-tbl-wrap"><table class="gai-tbl"><tbody>' +
        d.actual.map(a => "<tr><th>" + esc(a.name) + '</th><td class="mono">' +
          esc(fmtNum(a.value)) + " " + esc(a.unit || "") + "</td></tr>").join("") +
        "</tbody></table></div>" : "") +
      '<div class="gai-note">이 조건은 모형에서 계산한 예측이며, 실제로 실험해 확인해야 합니다.</div>' +
      srcHTML(out.meta);
  }

  function wireAnswer(slot, out) {
    wireSuggIn(slot);

    /* 근거 데이터 보기 — 표를 접었다 폈다 합니다. 새로 조회하지 않고
       이미 그려 둔 표를 보여 줍니다. */
    const ev = slot.querySelector("[data-evidence]");
    if (ev) ev.addEventListener("click", function () {
      const w = slot.querySelector(".gai-tbl-wrap");
      if (!w) return;
      const hidden = w.style.display === "none";
      w.style.display = hidden ? "" : "none";
      this.textContent = (hidden ? "근거 데이터 숨기기" : "근거 데이터 보기");
    });

    const cp = slot.querySelector("[data-copy]");
    if (cp) cp.addEventListener("click", function () {
      const el = slot.querySelector(".gai-narr-text");
      if (!el) return;
      const b = this;
      const done = () => { b.textContent = "복사됨"; setTimeout(() => { b.textContent = "문장 복사"; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(el.textContent).then(done).catch(function () {
          b.textContent = "복사하지 못했습니다";
        });
      } else { b.textContent = "이 브라우저에서는 복사할 수 없습니다"; }
    });
    const ap = slot.querySelector("[data-apply]");
    if (ap) {
      ap.addEventListener("click", function () {
        const res = window.GlobalAI.applyAction(lastProposal);
        /* 무엇을 적용했는지 그대로 적습니다 — 정렬을 눌렀는데 "필터를
           적용했습니다" 라고 나오면 화면에서 일어난 일과 글이 어긋납니다. */
        const did = { filter: "필터", sort: "정렬", select: "배치 선택" }[
          lastProposal && lastProposal.action] || "요청한 변경";
        slot.querySelector(".gai-action").outerHTML = res.ok
          ? '<div class="gai-note">' + esc(did) + "을(를) 적용했습니다. 화면이 갱신됩니다.</div>"
          : '<div class="gai-warn">' + esc(res.why) + "</div>";
      });
    }
    const cx = slot.querySelector("[data-cancel]");
    if (cx) {
      cx.addEventListener("click", function () {
        slot.querySelector(".gai-action").outerHTML =
          '<div class="gai-note">적용하지 않았습니다. 화면은 그대로입니다.</div>';
      });
    }
  }
  function wireSuggIn(el) {
    Array.prototype.forEach.call(el.querySelectorAll("[data-q]"), function (b) {
      b.addEventListener("click", () => send(b.dataset.q));
    });
  }

  return { mount: mount, open: show, close: close, toggle: toggle, ask: send,
           /* 검사용 — 어떤 응답 모양이 와도 내부 payload 가 화면에 나오지
              않는지 확인합니다. 제품 코드에서는 부르지 않습니다. */
           _answerHTML: answerHTML };
})();
