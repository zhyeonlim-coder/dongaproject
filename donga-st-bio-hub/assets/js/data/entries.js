/* ==========================================================================
   entries.js — Sample 계층 + Audit Trail 저장소

   Excel에는 Batch까지만 있고 Sample 개념이 없습니다. Sample은 연구원이
   Batch 하위에 자유롭게 만드는 단위이며(예: B123-1-S1, "pH 6.0 조건군"),
   여기에 Data 입력값이 붙습니다.

   ── Audit Trail 원칙 (ALCOA+) ──────────────────────────────────────────
   값을 덮어쓰지 않습니다. 수정하면 이전 값이 history 에 쌓이고 현재 값만
   바뀝니다. 삭제도 물리 삭제가 아니라 active=false 로 비활성화합니다.
   시각은 초 단위까지 로컬 시간으로 기록합니다 (UTC 변환 금지 — KST 사용자가
   오전에 전날 날짜를 보게 됩니다).

   ── 수정 사유는 필수입니다 ─────────────────────────────────────────────
   "무엇이 언제 누구에 의해 바뀌었나"만 남기고 "왜"가 비어 있으면 이력은
   반쪽입니다. 값이 실제로 바뀌는 저장은 사유 없이는 거부합니다.

     최초 입력            사유 불필요
     기존 값 수정          사유 필수
     Excel 원본 덮어쓰기    사유 필수 + 원본 값을 이력 첫 항목으로 보존
                          (그러지 않으면 원본이 조용히 사라집니다)

     Entries.addSample({ batchId, name })   → 중복 검증 + 작성자/일시 기록
     Entries.setValue(scope, field, value, reason, opts)
        opts = { baseValue }  Excel 등 화면에 보이던 원본 값
     Entries.getValue(scope, field)         → { value, createdBy, createdAt, history }

   값은 VAL 형식({num,qual,miss})으로 저장합니다 — 자세한 건 value.js 참고.
   ========================================================================== */

window.Entries = (function () {
  "use strict";

  const KEY = "hub.entries.v1";
  /* 서버 모드에서 시료·묶음을 담는 설정 키 */
  const AUX_KEY = "hub.entries.aux";
  const EMPTY = { samples: [], values: {}, groups: [] };
  const subs = [];
  let state;

  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? Object.assign({}, EMPTY, JSON.parse(raw)) : JSON.parse(JSON.stringify(EMPTY));
  } catch (e) { state = JSON.parse(JSON.stringify(EMPTY)); }

  /* ── 저장 ─────────────────────────────────────────────────────────────
     어디에 저장할지는 Persist 가 압니다 (서버 DB 또는 이 브라우저).

     서버 모드에서는 **바뀐 칸만** 보냅니다. 통째로 보내면 칸 하나 고칠
     때마다 전체 값 표가 올라가고, 배치가 늘수록 한 번의 입력이 점점
     무거워집니다. 어느 칸이 바뀌었는지는 setValue 가 적어 둡니다. */
  let dirty = {};
  function markDirty(k) { dirty[k] = true; }

  function save() {
    if (window.Persist && window.Persist.isServer()) {
      const keys = Object.keys(dirty);
      if (keys.length) {
        const map = {};
        keys.forEach(function (k) { map[k] = state.values[k] || null; });
        dirty = {};
        /* ★ 실패하면 다시 보낼 목록에 돌려놓습니다.
           예전에는 보내기 전에 dirty 를 비우고 끝이라, 전송이 실패하면
           그 값은 **어디에도 남지 않았습니다.** 화면에는 적혀 있는데
           서버에는 없는 상태가 되고, 다음 저장 때도 보내지 않습니다. */
        Promise.resolve(window.Persist.pushValues(map)).then(function (r) {
          if (r && r.ok) return;
          keys.forEach(function (k) { dirty[k] = true; });
          if (window.console && console.warn) {
            console.warn("[Entries] 저장에 실패해 " + keys.length + "건을 다시 보낼 목록에 두었습니다");
          }
        }).catch(function () { keys.forEach(function (k) { dirty[k] = true; }); });
      }
      /* 시료와 묶음은 값 표가 아니라 설정 쪽에 둡니다 — 양이 적고
         (scope,field) 모양이 아니기 때문입니다. */
      window.Persist.setJSON(AUX_KEY, { samples: state.samples, groups: state.groups });
      return;
    }
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }
  function emit(what) { save(); subs.slice().forEach(fn => { try { fn(what, state); } catch (e) {} }); }

  /* 서버에서 받은 한 벌로 통째로 갈아 끼웁니다 (bootstrap · 폴링이 부릅니다).
     쓰기를 유발하지 않습니다 — 방금 읽은 것을 되쓰면 남의 더 새로운 쓰기를
     덮습니다. */
  function hydrate(values, aux) {
    state.values = values || {};
    state.samples = (aux && aux.samples) || [];
    state.groups = (aux && aux.groups) || [];
    dirty = {};
    subs.slice().forEach(fn => { try { fn("hydrate", state); } catch (e) {} });
  }
  function subscribe(fn) { subs.push(fn); return () => { const i = subs.indexOf(fn); if (i > -1) subs.splice(i, 1); }; }

  const uid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* 로컬 시각 (초 단위) — toISOString() 은 UTC 로 바꿔버리므로 쓰지 않습니다. */
  function stamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      "T" + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }
  function stampHuman(iso) {
    if (!iso) return "";
    return iso.replace("T", " ");
  }

  function who() {
    const u = window.Auth && window.Auth.current ? window.Auth.current() : null;
    return u ? u.name : "—";
  }

  /* ── Sample ─────────────────────────────────────────────────────────── */

  function getSamples(batchId) {
    return state.samples.filter(s => s.active !== false && (!batchId || s.batchId === batchId));
  }

  function getSamplesByStudy(studyId) {
    const ids = window.DATA_BATCHES.filter(b => b.studyId === studyId).map(b => b.id);
    return state.samples.filter(s => s.active !== false && ids.indexOf(s.batchId) > -1);
  }

  function addSample(input) {
    const name = String(input.name || "").trim();
    if (!name) return { ok: false, reason: "이름을 입력하세요" };

    // 중복 검증 — 같은 Batch 안에서 같은 이름 금지 (대소문자 무시)
    const dup = state.samples.some(s => s.active !== false &&
      s.batchId === input.batchId && s.name.toLowerCase() === name.toLowerCase());
    if (dup) return { ok: false, reason: "같은 Batch에 동일한 이름이 이미 있습니다" };

    const rec = {
      id: uid("SMP"), batchId: input.batchId, studyId: input.studyId || null,
      /* 어느 팀이 만든 시료인가 — 계층이 Study → 팀 → Sample 이라
         시료도 팀에 매달립니다. 배양팀이 만든 시료가 정제 서식에 섞여
         나오면, 두 팀이 서로의 열에 값을 적게 됩니다. */
      team: input.team || null,
      name: name, note: input.note || null, stage: input.stage || null, active: true,
      createdBy: who(), createdAt: stamp()
    };
    state.samples.push(rec);
    emit("sample");
    return { ok: true, sample: rec };
  }

  /* 물리 삭제 대신 비활성화 (규제 대응) */
  function deactivateSample(id, reason) {
    const s = state.samples.find(x => x.id === id);
    if (!s) return false;
    s.active = false;
    s.deactivatedBy = who();
    s.deactivatedAt = stamp();
    s.deactivateReason = reason || null;
    emit("sample");
    return true;
  }

  /* 되살리기 — 값과 이력은 비활성화해도 그대로 남아 있으므로, 되살리면
     적어 둔 것이 다시 보입니다. 이 길이 없으면 열을 잘못 지운 사람에게는
     사실상 삭제와 같습니다. */
  function reactivateSample(id) {
    const s = state.samples.find(x => x.id === id);
    if (!s) return false;
    s.active = true;
    s.reactivatedBy = who();
    s.reactivatedAt = stamp();
    emit("sample");
    return true;
  }

  /* 비활성 시료 — 되살리기 목록에 씁니다 */
  function inactiveSamples(batchId) {
    return state.samples.filter(s => s.active === false && (!batchId || s.batchId === batchId));
  }

  /* 한 건 찾기 (활성 여부 무관) */
  function findSample(id) { return state.samples.find(s => s.id === id) || null; }

  /* 이름 · 설명 고치기 — 시료는 Data 입력 표의 열 머리글이 곧 이름입니다.
     Aliases 로 덧씌우지 않고 레코드를 직접 고칩니다. 열 머리글은 "같은 것을
     다르게 부르는 별칭" 이 아니라 그 시료의 이름 자체이기 때문입니다. */
  function renameSample(id, name, stage) {
    const s = state.samples.find(x => x.id === id);
    if (!s) return { ok: false, reason: "없는 시료입니다" };
    const nm = String(name == null ? s.name : name).trim();
    if (!nm) return { ok: false, reason: "이름을 비울 수 없습니다" };
    const dup = state.samples.some(x => x !== s && x.active !== false &&
      x.batchId === s.batchId && String(x.name).toLowerCase() === nm.toLowerCase());
    if (dup) return { ok: false, reason: "같은 이름이 이미 있습니다: " + nm };
    s.name = nm;
    if (stage !== undefined) s.stage = String(stage || "").trim() || null;
    s.updatedBy = who(); s.updatedAt = stamp();
    emit("sample");
    return { ok: true, sample: s };
  }

  /* ── Sample 그룹 (묶음 조회용) ──────────────────────────────────────── */
  function getGroups(studyId) {
    return state.groups.filter(g => g.active !== false && (!studyId || g.studyId === studyId));
  }
  function addGroup(input) {
    const name = String(input.name || "").trim();
    if (!name) return { ok: false, reason: "그룹 이름을 입력하세요" };
    if (!input.sampleIds || !input.sampleIds.length)
      return { ok: false, reason: "Sample을 하나 이상 선택하세요" };
    const rec = {
      id: uid("GRP"), name, studyId: input.studyId || null,
      sampleIds: input.sampleIds.slice(), active: true,
      createdBy: who(), createdAt: stamp()
    };
    state.groups.push(rec);
    emit("group");
    return { ok: true, group: rec };
  }
  function removeGroup(id) {
    const g = state.groups.find(x => x.id === id);
    if (g) { g.active = false; emit("group"); }
  }

  /* ── 값 + Audit Trail ───────────────────────────────────────────────── */

  /* scope 예: "batch:B123-1", "sample:SMP-xxxx" */
  function keyOf(scope, field) { return scope + "|" + field; }

  function getValue(scope, field) {
    return state.values[keyOf(scope, field)] || null;
  }

  function getScopeValues(scope) {
    const out = {};
    const prefix = scope + "|";
    Object.keys(state.values).forEach(k => {
      if (k.indexOf(prefix) === 0) out[k.slice(prefix.length)] = state.values[k];
    });
    return out;
  }

  const MIN_REASON = 2;

  /* 사유가 필요한 저장인지 미리 알려 줍니다 — 화면이 사유 입력창을
     띄울지 판단할 때 씁니다. 규칙을 화면에 복사하지 않기 위해 여기 둡니다. */
  function needsReason(scope, field, value, opts) {
    const prev = state.values[keyOf(scope, field)];
    if (prev) return !window.VAL.same(prev.value, value);
    const base = opts && opts.baseValue;
    if (base === null || base === undefined) return false;
    return !window.VAL.same(base, value);        // Excel 원본을 바꾸는 경우
  }

  /* 저장. 기존 값이 있으면 덮어쓰지 않고 history 에 누적합니다. */
  function setValue(scope, field, value, reason, opts) {
    const k = keyOf(scope, field);
    const now = stamp(), user = who();
    const prev = state.values[k];
    /* 값의 모양은 부르는 쪽이 정합니다 — 측정값은 VAL 객체, 날짜·자유 텍스트는
       그대로. 여기서 일괄 변환하면 날짜가 "미측정"으로 바뀌어 버립니다. */
    const val = value;
    const why = String(reason || "").trim();
    const o = opts || {};

    /* ── 최초 입력 ── */
    if (!prev) {
      const base = (o.baseValue === undefined) ? null : o.baseValue;
      const overwritesBase = base !== null && !window.VAL.same(base, val);

      if (overwritesBase && why.length < MIN_REASON) {
        return { ok: false, action: "Update", needReason: true,
                 reason: "원본 값을 바꾸려면 사유를 입력해야 합니다." };
      }

      markDirty(k);
      state.values[k] = {
        value: val,
        createdBy: user, createdAt: now,
        updatedBy: overwritesBase ? user : null,
        updatedAt: overwritesBase ? now : null,
        action: overwritesBase ? "Update" : "Create",
        /* 원본을 이력 0번으로 남겨 둡니다 — 이렇게 해야 나중에
           "원래 Excel 값이 무엇이었나"를 되짚을 수 있습니다. */
        history: overwritesBase
          ? [{ previousValue: base, previousSource: o.baseSource || "원본",
               changedBy: user, changedAt: now, reason: why }]
          : []
      };
      emit("value");
      return { ok: true, action: state.values[k].action, record: state.values[k] };
    }

    /* ── 같은 값 재저장은 무시 ── */
    if (window.VAL.same(prev.value, val)) return { ok: true, action: "None", record: prev };

    /* ── 값 변경 — 사유 필수 ── */
    if (why.length < MIN_REASON) {
      return { ok: false, action: "Update", needReason: true,
               reason: "값을 바꾸려면 변경 사유를 입력해야 합니다." };
    }

    prev.history.push({
      previousValue: prev.value,
      changedBy: user,
      changedAt: now,
      reason: why
    });
    prev.value = val;
    prev.updatedBy = user;
    prev.updatedAt = now;
    prev.action = "Update";
    markDirty(k);
    emit("value");
    return { ok: true, action: "Update", record: prev };
  }

  /* 자주 쓰는 사유 — 매번 문장을 새로 짜게 하면 "수정"처럼 무의미한
     한 단어만 남습니다. 고르고 필요하면 덧붙이는 편이 낫습니다. */
  const REASON_PRESETS = [
    "오기 정정 (전사 오류)",
    "재측정 결과 반영",
    "단위 환산 오류 정정",
    "시험 무효 처리 후 재시험",
    "장비 재보정 후 재산출"
  ];

  /* 입력 필드 옆에 붙일 캡션 문자열 */
  function caption(rec) {
    if (!rec) return null;
    const last = rec.updatedAt ? { by: rec.updatedBy, at: rec.updatedAt } : { by: rec.createdBy, at: rec.createdAt };
    return last.by + " · " + stampHuman(last.at);
  }

  function hasHistory(rec) { return !!(rec && rec.history && rec.history.length); }

  function reset() { state = JSON.parse(JSON.stringify(EMPTY)); emit("reset"); }

  /* 저장소에서 다시 읽어 들입니다 — 다른 탭이 값을 바꿨을 때 씁니다.
     메모리 사본을 그대로 두면 그 탭은 자기가 들고 있던 옛 값을 계속
     보여 주고, 두 화면이 서로 다른 숫자를 띄운 채 둘 다 그럴듯합니다. */
  function reload() {
    try {
      const raw = localStorage.getItem(KEY);
      state = raw ? Object.assign({}, EMPTY, JSON.parse(raw)) : JSON.parse(JSON.stringify(EMPTY));
    } catch (e) { return false; }
    /* save() 를 부르지 않고 구독자에게만 알립니다 — 방금 읽은 것을
       되쓰면 다른 탭의 더 새로운 쓰기를 덮을 수 있습니다. */
    subs.slice().forEach(fn => { try { fn("reload", state); } catch (e) {} });
    return true;
  }

  return {
    getSamples, getSamplesByStudy, addSample, deactivateSample,
    reactivateSample, inactiveSamples, findSample, renameSample,
    getGroups, addGroup, removeGroup,
    getValue, getScopeValues, setValue, needsReason, REASON_PRESETS,
    caption, hasHistory, stamp, stampHuman, who,
    subscribe, reset, reload, hydrate,
    state: () => state
  };
})();
