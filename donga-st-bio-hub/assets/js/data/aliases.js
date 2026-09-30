/* ==========================================================================
   aliases.js — 사용자가 고친 이름  ·  window.Aliases

   ── 왜 별도 계층인가 ───────────────────────────────────────────────────
   원본 Excel 에서 온 이름(항목명 · 시료명 · 일자 코드)은 지울 수 없습니다.
   규제 대응상 "처음에 무엇이라고 적혀 있었는지"가 남아야 하고, 나중에
   원본을 다시 읽어 들일 때 맞춰 볼 기준이 필요하기 때문입니다.

   그래서 이름을 덮어쓰지 않고 위에 덧씌웁니다.

     원본        DATA_ANALYTE_GROUPS · DATA_SAMPLES     (건드리지 않습니다)
     덧씌움      Aliases.labels[key]                    사용자가 고친 이름
     이력        Aliases.history[key]                   누가 언제 무엇을 무엇으로

   apply() 가 원본 객체의 label 자리에 덧씌운 이름을 써 넣고, 원래 이름은
   같은 객체의 _label0 에 보관합니다. 이렇게 하면 대시보드 · 데이터 조회 ·
   Global AI 가 쓰는 코드를 한 줄도 고치지 않고 새 이름을 보게 됩니다 —
   그쪽은 전부 label 을 읽기 때문입니다. 화면마다 이름이 다르게 보이는 일도
   생기지 않습니다.

   ── 키 규칙 ─────────────────────────────────────────────────────────────
     item:<groupId>.<itemKey>   스키마 항목명   (모든 화면 공통)
     item:titer                 일자별 Titer 항목명
     field:<fieldKey>           Data 입력 화면에만 있는 항목 (Resin · 특이사항)
     smp:<sampleId>.name        시료 이름       (모든 화면 공통)
     smp:<sampleId>.stage       시료 채취 시점
     col:<team>|<batch>|<colId>.name   워크시트에서 늘린 열의 이름
     col:<team>|<batch>|<colId>.sub    그 열의 부제

   ── 숨김 ────────────────────────────────────────────────────────────────
   값이 적힌 열은 지우지 않고 숨깁니다. hidden[key] 에 누가 언제 왜 숨겼는지
   남고, 되살리면 그 기록도 이력에 남습니다. 삭제가 아니라 비활성화입니다.
   ========================================================================== */

window.Aliases = (function () {
  "use strict";

  const KEY = "hub.aliases.v1";
  const blank = () => ({ labels: {}, hidden: {}, history: {} });

  let state = load();

  function load() {
    try {
      const r = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!r || typeof r !== "object") return blank();
      return { labels: r.labels || {}, hidden: r.hidden || {}, history: r.history || {} };
    } catch (e) { return blank(); }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  /* 시각은 초 단위 지역시로 남깁니다 — UTC 로 바꾸면 "몇 시에 고쳤나"를
     읽는 사람이 매번 환산해야 합니다 (entries.js 와 같은 규칙). */
  function stamp() {
    const d = new Date(), p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      "T" + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }
  function who() {
    const u = window.Auth && window.Auth.current ? window.Auth.current() : null;
    return u ? u.name : "—";
  }

  const subs = [];
  function subscribe(fn) {
    subs.push(fn);
    return function () { const i = subs.indexOf(fn); if (i > -1) subs.splice(i, 1); };
  }
  function emit(what) {
    save();
    apply();
    /* 이름이 바뀌면 AI 와 통계가 쓰는 표 캐시도 옛 이름을 들고 있습니다 */
    if (window.Repo && window.Repo.notify) window.Repo.notify("label");
    subs.slice().forEach(function (f) { try { f(what, state); } catch (e) {} });
  }

  /* ── 읽기 ─────────────────────────────────────────────────────────────── */
  function get(key, fallback) {
    const v = state.labels[key];
    return (v === undefined || v === null || v === "") ? (fallback == null ? "" : fallback) : v;
  }
  function has(key) { const v = state.labels[key]; return !(v === undefined || v === null || v === ""); }
  function historyOf(key) { return (state.history[key] || []).slice(); }

  /* ── 쓰기 ─────────────────────────────────────────────────────────────
     빈 문자열을 주면 덧씌움을 걷어 내고 원래 이름으로 돌아갑니다 —
     "되돌리기" 를 위해 따로 함수를 두지 않아도 됩니다. */
  function set(key, text, originalLabel) {
    const next = String(text == null ? "" : text).trim();
    const from = get(key, originalLabel);
    if (next === from) return { ok: true, action: "None" };
    if (next.length > 60) return { ok: false, reason: "이름은 60자까지 넣을 수 있습니다" };

    if (next === "" || next === String(originalLabel == null ? "" : originalLabel).trim()) {
      delete state.labels[key];
    } else {
      state.labels[key] = next;
    }
    (state.history[key] = state.history[key] || []).push({
      from: from, to: next === "" ? (originalLabel || "") : next,
      by: who(), at: stamp(), original: originalLabel == null ? null : String(originalLabel)
    });
    emit("label");
    return { ok: true, action: "Rename" };
  }

  /* ── 숨김 · 되살림 ──────────────────────────────────────────────────── */
  function isHidden(key) { return !!state.hidden[key]; }
  function hiddenInfo(key) { return state.hidden[key] || null; }
  function hide(key, note) {
    if (state.hidden[key]) return { ok: true, action: "None" };
    state.hidden[key] = { by: who(), at: stamp(), note: note || null };
    (state.history[key] = state.history[key] || []).push({
      from: "표시", to: "숨김", by: who(), at: stamp(), note: note || null });
    emit("hidden");
    return { ok: true, action: "Hide" };
  }
  function unhide(key) {
    if (!state.hidden[key]) return { ok: true, action: "None" };
    delete state.hidden[key];
    (state.history[key] = state.history[key] || []).push({
      from: "숨김", to: "표시", by: who(), at: stamp() });
    emit("hidden");
    return { ok: true, action: "Unhide" };
  }
  /* 접두어로 묶어 셉니다 — "이 배치 · 이 팀에서 숨긴 열" 을 세려면 필요합니다 */
  function hiddenWithPrefix(prefix) {
    return Object.keys(state.hidden).filter(k => k.indexOf(prefix) === 0);
  }

  /* ── 원본 객체에 반영 ─────────────────────────────────────────────────
     처음 한 번 원래 label 을 _label0 에 옮겨 두고, 그 뒤로는 _label0 를
     기준으로 다시 씁니다. 기준을 옮겨 두지 않으면 두 번째 apply() 가
     "고친 이름" 을 원본으로 착각해 원래 이름이 사라집니다. */
  function base(obj, prop) {
    const memo = "_" + prop + "0";
    if (obj[memo] === undefined) obj[memo] = obj[prop];
    return obj[memo];
  }
  function stamped(obj, prop, key) {
    const orig = base(obj, prop);
    obj[prop] = get(key, orig);
  }

  function apply() {
    (window.DATA_ANALYTE_GROUPS || []).forEach(function (g) {
      (g.items || []).forEach(function (it) {
        stamped(it, "label", "item:" + g.id + "." + it.key);
      });
    });
    if (window.DATA_TITER_ITEM) stamped(window.DATA_TITER_ITEM, "label", "item:titer");
    (window.DATA_SAMPLES || []).forEach(function (s) {
      stamped(s, "name", "smp:" + s.id + ".name");
      stamped(s, "stage", "smp:" + s.id + ".stage");
    });
  }

  /* 원래 이름 — 툴팁에 "원래 무엇이었나" 를 보여 줄 때 씁니다 */
  function originalOf(obj, prop) {
    const memo = "_" + prop + "0";
    return obj && obj[memo] !== undefined ? obj[memo] : (obj ? obj[prop] : null);
  }

  apply();

  return {
    get, has, set, historyOf,
    isHidden, hiddenInfo, hide, unhide, hiddenWithPrefix,
    apply, originalOf, subscribe,
    _state: () => state,
    reset: function () { state = blank(); emit("reset"); }
  };
})();
