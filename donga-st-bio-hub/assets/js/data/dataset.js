/* ==========================================================================
   dataset.js — 레코드 저장소  ·  window.Dataset

   ── 무엇이 바뀌었나 ─────────────────────────────────────────────────────
   예전에는 Study · Batch · Sample 목록이 코드 안의 상수였습니다. 값만
   Entries 에 쌓이고 레코드 자체는 늘지도 줄지도 않아, 새 Study 나 Batch 를
   만들 길이 없었습니다.

   이제 Excel 에서 온 목록은 **최초 1회 씨앗**으로만 쓰고, 그 복사본이
   localStorage 에 들어갑니다. 그 뒤로는 저장본이 현재 목록입니다.

       batches.js · studies.js · samples.js   씨앗 (코드, 늘 같은 값)
                 ↓ 최초 1회 복사
       hub.dataset.v1                         현재 목록 (추가 · 수정 가능)
                 ↓ applyToGlobals
       DATA_STUDIES · DATA_BATCHES · DATA_SAMPLES

   전역 이름을 그대로 쓰는 것이 핵심입니다. 화면 · 조회 · 대시보드 · AI 가
   이미 이 세 배열을 읽고 있으므로, 여기서 갈아 끼우면 부르는 쪽을 한 줄도
   고치지 않고 저장소를 바꿀 수 있습니다. 새 이름을 만들면 "옛 배열을 읽는
   화면" 과 "새 저장소를 읽는 화면" 이 갈라지고, 둘 다 그럴듯해서 어느 쪽이
   틀렸는지 알 수 없게 됩니다.

   ── 원본은 그래도 남깁니다 ───────────────────────────────────────────────
   씨앗 모듈은 매번 실행되므로, 갈아 끼우기 **직전** 메모리에 있던 것이 곧
   원본입니다. 그것을 ORIGIN 에 따로 떠 둡니다 (저장하지 않습니다 — 코드에서
   매번 다시 만들어지므로).

   Dataset.originOf("batch", id) 로 "처음에 무엇이라고 적혀 있었나" 를
   언제든 되짚을 수 있습니다. 저장본을 고쳐도 이 값은 변하지 않습니다.
   규제 대응상 원본 대조가 필요하고, 나중에 Excel 을 다시 읽어 들일 때
   맞춰 볼 기준도 있어야 합니다.

   ── 사용자가 만든 레코드 ─────────────────────────────────────────────────
   Excel 에 없는 항목을 지어내지 않습니다. 새 Batch 의 측정값은 전부 null
   이고 화면에는 "미입력" 으로 나옵니다. 다만 **모양은 씨앗과 똑같이**
   만듭니다 — upstream.titer.D10 같은 키가 아예 없으면 그걸 읽는 화면이
   그 자리에서 멈춥니다. 키는 있고 값이 null 인 것과, 키가 없는 것은
   다릅니다.
   ========================================================================== */

window.Dataset = (function () {
  "use strict";

  const KEY = "hub.dataset.v1";
  const clone = o => JSON.parse(JSON.stringify(o));

  /* 검사 페이지가 올리는 깃발 — 아래 state 초기화에서 설명합니다 */
  const SEED_ONLY = !!window.HUB_DATASET_SEED_ONLY;

  /* ── 씨앗 = 지금 메모리에 있는 것 ─────────────────────────────────── */
  const SEED = {
    studies: clone(window.DATA_STUDIES || []),
    batches: clone(window.DATA_BATCHES || []),
    samples: clone(window.DATA_SAMPLES || [])
  };
  /* 원본 대조용 — 저장하지 않습니다 */
  const ORIGIN = {
    study: index(SEED.studies), batch: index(SEED.batches), sample: index(SEED.samples)
  };
  function index(list) {
    const m = {};
    (list || []).forEach(function (x) { if (x && x.id) m[x.id] = x; });
    return m;
  }

  /* ── 저장 · 불러오기 ──────────────────────────────────────────────── */
  function load() {
    try {
      const r = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!r || !Array.isArray(r.batches)) return null;
      return { studies: r.studies || [], batches: r.batches || [], samples: r.samples || [] };
    } catch (e) { return null; }
  }
  /* 마지막으로 서버와 맞춘 모습 — 무엇이 달라졌는지 견주는 기준입니다.
     hydrate 가 서버에서 받아올 때마다 새로 찍습니다. */
  let pushed = {};
  function fingerprint(list) {
    const m = {};
    (list || []).forEach(function (r) { if (r && r.id) m[r.id] = JSON.stringify(r); });
    return m;
  }
  function markSynced() {
    pushed = { study: fingerprint(state.studies), batch: fingerprint(state.batches), sample: fingerprint(state.samples) };
  }
  function diffFromPushed() {
    const out = {};
    let any = false;
    [["study", state.studies], ["batch", state.batches], ["sample", state.samples]]
      .forEach(function (p) {
        const kind = p[0], now = fingerprint(p[1]), was = pushed[kind] || {};
        const list = [];
        Object.keys(now).forEach(function (id) {
          if (was[id] !== now[id]) { list.push(JSON.parse(now[id])); }
        });
        if (list.length) { out[kind] = list; any = true; }
        pushed[kind] = now;
      });
    return any ? out : null;
  }

  function save() {
    if (SEED_ONLY) return true;          /* 검사 중에는 사용자 데이터를 건드리지 않습니다 */
    /* 어디에 저장할지는 Persist 가 압니다. 서버 모드에서는 records 표로
       나가고 localStorage 는 쓰지 않습니다. */
    if (window.Persist && window.Persist.isServer()) {
      /* ★ 바뀐 것만 보냅니다.
         예전에는 저장할 때마다 Study·Batch·시료 **전부**를 보냈습니다.
         값 하나 고쳐도 62개 레코드가 통째로 올라갔고, 요청이 무거워져
         실패하기 쉬웠습니다. 실패하면 메모리가 되돌아가 화면에서도 값이
         사라집니다 — 저장된 줄 알았는데 다른 PC 에 안 보이는 이유였습니다.

         그리고 전부 보내면, 이쪽 사본이 조금 낡았을 때 **남이 방금 고친
         레코드까지 옛 내용으로 되돌려 놓습니다.** */
      const changed = diffFromPushed();
      if (changed) window.Persist.pushRecords(changed);
      return true;
    }
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
    catch (e) {
      /* 용량을 넘기면 조용히 잃지 않고 알립니다 — 저장된 줄 알고 계속
         입력하는 것이 가장 나쁩니다. */
      if (window.console) console.warn("[Dataset] 저장 실패:", e && e.name);
      lastSaveError = e && e.name ? e.name : "unknown";
      return false;
    }
  }
  let lastSaveError = null;

  /* ★ 검사 페이지는 씨앗만 씁니다.

     레코드가 localStorage 로 옮겨 가면서, 검사 페이지가 같은 브라우저의
     사용자 데이터를 함께 보게 됐습니다. 사용자가 Batch 를 하나 만들면 그
     다음부터 "배치 28개" 를 세던 검사가 전부 29개를 보고 무너집니다 —
     코드는 멀쩡한데 검사만 빨개지는 것이라, 진짜 고장과 구분할 수 없습니다.

     검사는 늘 같은 입력에서 같은 답이 나와야 합니다. 그래서 검사 페이지는
     이 깃발을 올리고 씨앗만 읽습니다. 저장도 하지 않으므로 검사를 돌려도
     사용자 데이터가 바뀌지 않습니다. */
  let state = SEED_ONLY ? clone(SEED) : load();
  if (SEED_ONLY) {
    applyToGlobals();
  } else if (!state) {
    /* 최초 접속 — 씨앗을 그대로 복사해 저장합니다. 여기서 저장해 두지
       않으면 "저장본이 현재 목록" 이라는 규칙이 첫 실행에만 깨집니다. */
    state = clone(SEED);
    save();
  } else {
    /* 씨앗에 새 레코드가 생겼으면(원본 Excel 갱신) 더해 줍니다.
       이미 저장된 레코드는 덮지 않습니다 — 사용자가 고친 값이 날아갑니다. */
    let added = 0;
    ["studies", "batches", "samples"].forEach(function (k) {
      const have = {};
      state[k].forEach(function (x) { if (x && x.id) have[x.id] = true; });
      SEED[k].forEach(function (x) {
        if (x && x.id && !have[x.id]) { state[k].push(clone(x)); added++; }
      });
    });
    if (added) save();
  }

  /* ── 전역에 반영 ──────────────────────────────────────────────────────
     배열 객체 자체를 바꾸지 않고 **내용만** 갈아 끼웁니다. 다른 모듈이
     이미 window.DATA_BATCHES 를 지역 변수에 담아 둔 경우, 배열을 새로
     만들어 할당하면 그쪽은 계속 옛 배열을 봅니다. */
  function applyToGlobals() {
    swap(window.DATA_STUDIES, state.studies);
    swap(window.DATA_BATCHES, state.batches);
    swap(window.DATA_SAMPLES, state.samples);
  }
  function swap(target, next) {
    if (!Array.isArray(target)) return;
    target.length = 0;
    (next || []).forEach(x => target.push(x));
  }

  /* ── 통지 ─────────────────────────────────────────────────────────── */
  const subs = [];
  function subscribe(fn) {
    subs.push(fn);
    return function () { const i = subs.indexOf(fn); if (i > -1) subs.splice(i, 1); };
  }
  function emit(what) {
    const ok = save();
    applyToGlobals();
    /* 레코드가 늘면 표 캐시 · AI 가 들고 있는 목록도 옛것이 됩니다 */
    if (window.Repo && window.Repo.notify) window.Repo.notify("dataset");
    subs.slice().forEach(function (f) { try { f(what, ok); } catch (e) {} });
  }

  /* ── 빈 레코드 만들기 ─────────────────────────────────────────────────
     씨앗과 **같은 모양** 이어야 합니다. 키가 없으면 그걸 읽는 화면이
     그 자리에서 멈춥니다. 값은 전부 null — 지어내지 않습니다. */
  function emptyUpstream() {
    const titer = {};
    (window.DATA_TITER_DAYS || []).forEach(function (d) { titer[d] = null; });
    return { ivcd: null, maxVCD: null, finalVCD: null, finalViability: null,
             titer: titer, titerHCCF: null, qP: null };
  }
  function emptyDownstream() {
    const g = (window.DATA_ANALYTE_GROUPS || []).find(x => x.id === "downstream");
    const out = {};
    ((g && g.items) || []).forEach(function (it) { out[it.key] = null; });
    return out;
  }

  const uid = p => p + "-" + Date.now().toString(36).toUpperCase().slice(-5) +
                   Math.random().toString(36).slice(2, 4).toUpperCase();

  function who() {
    const u = window.Auth && window.Auth.current ? window.Auth.current() : null;
    return u ? u.name : "—";
  }
  function stamp() {
    const d = new Date(), p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      "T" + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  /* ── Study ────────────────────────────────────────────────────────── */
  function addStudy(input) {
    const name = String((input && input.name) || "").trim();
    if (!name) return { ok: false, reason: "Study 이름을 입력하세요" };
    const projectId = (input && input.projectId) || null;
    if (!projectId) return { ok: false, reason: "과제를 먼저 선택하세요" };
    const dup = state.studies.some(s => s.projectId === projectId &&
      String(s.name || "").toLowerCase() === name.toLowerCase());
    if (dup) return { ok: false, reason: "같은 과제에 동일한 이름의 Study 가 이미 있습니다" };

    const rec = {
      id: (input.id && String(input.id).trim()) || uid("STD"),
      projectId: projectId,
      name: name,
      type: (input.type || "").trim() || "직접 등록",
      status: input.status || "진행",
      /* 기간은 배치가 생기면 거기서 정해집니다 — 지금 지어내지 않습니다 */
      startDate: input.startDate || null,
      endDate: input.endDate || null,
      source: "user", createdBy: who(), createdAt: stamp()
    };
    if (state.studies.some(s => s.id === rec.id)) {
      return { ok: false, reason: "같은 ID 의 Study 가 이미 있습니다: " + rec.id };
    }
    state.studies.push(rec);
    emit("study");
    return { ok: true, study: rec };
  }

  /* ── Batch ────────────────────────────────────────────────────────── */
  function addBatch(input) {
    const studyId = (input && input.studyId) || null;
    if (!studyId) return { ok: false, reason: "Study 를 먼저 선택하세요" };
    const study = state.studies.find(s => s.id === studyId);
    if (!study) return { ok: false, reason: "없는 Study 입니다: " + studyId };

    const id = String((input && input.id) || "").trim() || uid("B");
    if (state.batches.some(b => b.id === id)) {
      return { ok: false, reason: "같은 Batch ID 가 이미 있습니다: " + id };
    }

    const rec = {
      id: id,
      expNo: (input.expNo || "").trim() || id,
      studyId: studyId,
      team: input.team || "upstream",
      /* ★ 담는 그릇 — 화면에는 나오지 않습니다.
         Data 입력의 열 하나가 Sample 하나이고, 그 Sample 의 값이 들어갈
         자리로 이 레코드를 하나 같이 만듭니다 (1:1). 값의 주소는 예전처럼
         batch:<id> 이므로, 대시보드 · 차트 · AI · CSV · DoE 가 지나는
         Repo.valueOf 를 한 줄도 고치지 않고 그대로 씁니다.

         hidden 인 레코드는 "Batch" 라는 말로 사용자에게 보이지 않습니다.
         사용자가 아는 단위는 Sample 하나뿐입니다. */
      hidden: !!input.hidden,
      initialDate: input.initialDate || null,
      endDate: input.endDate || null,
      cultureDays: days(input.initialDate, input.endDate),
      upstream: emptyUpstream(),
      downstream: emptyDownstream(),
      source: "user", createdBy: who(), createdAt: stamp()
    };
    state.batches.push(rec);
    emit("batch");
    return { ok: true, batch: rec };
  }

  function days(a, b) {
    if (!a || !b) return null;
    const d = (new Date(b) - new Date(a)) / 86400000;
    return isFinite(d) && d >= 0 ? Math.round(d) : null;
  }

  /* 레코드 속성 고치기 (측정값이 아니라 날짜 · 이름 같은 메타) */
  function patch(kind, id, fields) {
    const list = kind === "study" ? state.studies
               : kind === "batch" ? state.batches
               : state.samples;
    const rec = list.find(x => x.id === id);
    if (!rec) return { ok: false, reason: "없는 레코드입니다: " + id };
    Object.keys(fields || {}).forEach(function (k) {
      if (k === "id") return;                      /* 식별자는 바꾸지 않습니다 */
      rec[k] = fields[k];
    });
    if (kind === "batch") rec.cultureDays = days(rec.initialDate, rec.endDate);
    rec.updatedBy = who(); rec.updatedAt = stamp();
    emit(kind);
    return { ok: true, record: rec };
  }

  /* 삭제가 아니라 비활성 — 규제 대응상 기록은 지우지 않습니다 */
  function deactivate(kind, id, reason) {
    return patch(kind, id, { active: false, deactivateReason: reason || null });
  }

  /* ── 원본 대조 ────────────────────────────────────────────────────── */
  function originOf(kind, id) { return (ORIGIN[kind] || {})[id] || null; }
  function isUserMade(kind, id) { return !originOf(kind, id); }

  /* ── 되돌리기 ─────────────────────────────────────────────────────── */
  function resetToSeed() {
    state = clone(SEED);
    emit("reset");
    return { ok: true };
  }

  /* 저장소에서 다시 읽어 들입니다 — 다른 탭이 Study · Batch 를 만들었을 때
     씁니다. 쓰지 않고 읽기만 합니다 (방금 읽은 것을 되쓰면 그 탭의 더
     새로운 쓰기를 덮습니다). */
  function reload() {
    if (SEED_ONLY) return false;
    const next = load();
    if (!next) return false;
    state = next;
    applyToGlobals();
    subs.slice().forEach(function (f) { try { f("reload", true); } catch (e) {} });
    return true;
  }

  /* 서버에서 받은 레코드로 통째로 갈아 끼웁니다 (bootstrap · 폴링).
     쓰기를 유발하지 않습니다 — 방금 읽은 것을 되쓰면 남의 쓰기를 덮습니다. */
  function hydrate(records) {
    if (SEED_ONLY) return false;
    const r = records || {};
    /* ★ 레코드 모양이 아닌 것은 들이지 않습니다.
       서버에 한 줄이라도 이상한 것이 들어가면, 그대로 받아 화면 전체가
       그 위에서 돕니다 (이름 없는 Study 가 목록에 섞여 보였습니다).
       들어오는 자리에서 한 번 거릅니다 — 지우지는 않고, 쓰지만 않습니다. */
    const sane = list => (Array.isArray(list) ? list : [])
      .filter(x => x && typeof x === "object" && x.id);
    state = {
      studies: sane(r.study), batches: sane(r.batch), samples: sane(r.sample)
    };
    /* 방금 서버에서 받은 모습이 곧 "맞춰진 모습" 입니다. 여기서 찍어 두지
       않으면 다음 저장이 받은 것을 그대로 되쓰게 됩니다. */
    markSynced();
    applyToGlobals();
    if (window.Aliases && window.Aliases.apply) window.Aliases.apply();
    subs.slice().forEach(function (f) { try { f("hydrate", true); } catch (e) {} });
    return true;
  }

  /* ── 씨앗 한 벌 — 서버가 비어 있을 때 올려 보냅니다 ────────────────────
     ★ 2026-10 부터 **예시 엑셀을 심지 않습니다.** 빈 시스템으로 시작합니다.

     왜냐면 예시 수치가 실제 입력과 섞이면 둘을 구별할 방법이 없고, 예시의
     옛 범위 때문에 멀쩡한 입력에 범위 경고가 붙었습니다.

     엑셀 정의(batches.js · studies.js · samples.js)는 지웁니다가 아니라
     **그대로 둡니다** — 검사 스위트가 늘 같은 입력에서 돌아야 하고
     (HUB_DATASET_SEED_ONLY), 되돌리고 싶을 때 돌아올 자리이기 때문입니다.
     켜려면 화면을 열기 전에 window.HUB_SEED_EXCEL = true 를 두면 됩니다. */
  function seedPayload() {
    if (!window.HUB_SEED_EXCEL) return { study: [], batch: [], sample: [] };
    return { study: clone(SEED.studies), batch: clone(SEED.batches), sample: clone(SEED.samples) };
  }

  applyToGlobals();

  return {
    addStudy, addBatch, patch, deactivate,
    originOf, isUserMade, subscribe, resetToSeed, reload, hydrate, seedPayload,
    emptyUpstream, emptyDownstream,
    seed: () => clone(SEED),
    all: () => state,
    saveError: () => lastSaveError,
    /* 저장본 크기 — 용량 한계를 넘기기 전에 알 수 있어야 합니다 */
    bytes: function () {
      try { return (localStorage.getItem(KEY) || "").length; } catch (e) { return 0; }
    }
  };
})();
