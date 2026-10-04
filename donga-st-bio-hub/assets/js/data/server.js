/* ==========================================================================
   server.js — 중앙 서버 저장소  ·  window.HubServer

   ── 무엇이 바뀌었나 ─────────────────────────────────────────────────────
   데이터가 브라우저(localStorage)에서 서버 DB 로 옮겨 갔습니다. 다른 PC 나
   동료가 같은 데이터를 봅니다.

   ── 왜 메모리 사본을 두나 ───────────────────────────────────────────────
   화면이 수백 군데에서 값을 **동기적으로** 읽습니다 (Repo.valueOf ·
   Entries.getValue). 그 자리를 전부 비동기로 바꾸면 고칠 곳이 수백 군데이고,
   한 곳만 빠뜨려도 그 화면만 조용히 옛 값을 보여 줍니다.

   그래서 화면을 열 때 서버에서 한 벌 받아 메모리에 두고, 읽기는 거기서
   동기적으로 합니다. 쓰기는 메모리에 먼저 반영하고 서버로 보냅니다.

   ★ 메모리 사본은 캐시가 아니라 **이번 방문 동안의 작업본**입니다.
     localStorage 에 쓰지 않으므로 창을 닫으면 사라지고, 다음에 열면 서버에서
     다시 받습니다. 정본은 언제나 서버입니다.

   ★ 서버 저장에 실패하면 되돌립니다.
     화면에만 남겨 두면 "저장된 줄 알고" 계속 입력하게 됩니다. 실패는
     그 자리에서 보여야 합니다.

   ── 다른 사람이 바꾼 것 ─────────────────────────────────────────────────
   일정 주기로, 그리고 창에 다시 돌아올 때 서버를 다시 읽습니다. 내가 보고
   있는 화면이 남이 고친 값을 모른 채 떠 있으면, 두 사람이 서로 다른 숫자를
   근거로 이야기하게 됩니다.
   ========================================================================== */

window.HubServer = (function () {
  "use strict";

  const API = "/api/data";
  const SESSION = "/api/session";
  const POLL_MS = 20000;

  /* 이번 방문 동안의 작업본 — localStorage 에 쓰지 않습니다 */
  let mem = { records: { study: [], batch: [], sample: [] }, values: {}, meta: {} };
  let ready = false;
  let lastError = null;
  let polling = null;

  const subs = [];
  function subscribe(fn) {
    subs.push(fn);
    return function () { const i = subs.indexOf(fn); if (i > -1) subs.splice(i, 1); };
  }
  function emit(what) {
    subs.slice().forEach(function (f) { try { f(what); } catch (e) {} });
  }

  async function call(url, opts) {
    const r = await fetch(url, Object.assign({
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" }
    }, opts || {}));
    let body = null;
    try { body = await r.json(); } catch (e) {}
    if (!r.ok) {
      const err = new Error((body && body.message) || ("HTTP " + r.status));
      err.status = r.status;
      err.code = body && body.error;
      throw err;
    }
    return body;
  }

  /* ── 로그인 ──────────────────────────────────────────────────────────── */
  async function status() {
    try { return await call(SESSION, { method: "GET" }); }
    catch (e) { return { configured: false, signedIn: false, offline: true }; }
  }
  async function signIn(secret) {
    try {
      await call(SESSION, { method: "POST", body: JSON.stringify({ secret: secret }) });
      return { ok: true };
    } catch (e) {
      /* status 까지 돌려줍니다 — 로그인 화면이 "비밀값이 틀렸다"(401) 와
         "서버에 닿지 못했다"(그 밖) 를 구분해 안내해야 합니다. */
      return { ok: false, reason: e.message, code: e.code, status: e.status };
    }
  }
  async function signOut() {
    try { await call(SESSION, { method: "DELETE" }); } catch (e) {}
  }

  /* ── 받아 오기 ───────────────────────────────────────────────────────── */
  async function pull(quiet) {
    try {
      const snap = await call(API, { method: "GET" });
      mem = {
        records: snap.records || { study: [], batch: [], sample: [] },
        values: snap.values || {},
        meta: snap.meta || {}
      };
      ready = true;
      lastError = null;
      if (!quiet) emit("pull");
      return { ok: true, empty: !!snap.empty, counts: snap.counts };
    } catch (e) {
      lastError = e;
      return { ok: false, reason: e.message, code: e.code, status: e.status };
    }
  }

  /* ── 보내기 ──────────────────────────────────────────────────────────
     메모리에 먼저 반영하고 보냅니다. 실패하면 되돌립니다 — 화면에만 남은
     값은 저장된 값과 구분되지 않습니다. */
  async function push(patch) {
    const undo = [];
    const vals = (patch && patch.values) || {};
    Object.keys(vals).forEach(function (k) {
      undo.push([k, mem.values[k]]);
      if (vals[k] === null) delete mem.values[k];
      else mem.values[k] = vals[k];
    });
    const recs = (patch && patch.records) || {};
    Object.keys(recs).forEach(function (kind) {
      mem.records[kind] = mem.records[kind] || [];
      (recs[kind] || []).forEach(function (rec) {
        const i = mem.records[kind].findIndex(x => x && x.id === rec.id);
        undo.push(["rec:" + kind + ":" + rec.id, i > -1 ? mem.records[kind][i] : undefined]);
        if (i > -1) mem.records[kind][i] = rec; else mem.records[kind].push(rec);
      });
    });
    const metas = (patch && patch.meta) || {};
    Object.keys(metas).forEach(function (k) {
      undo.push(["meta:" + k, mem.meta[k]]);
      if (metas[k] === null) delete mem.meta[k]; else mem.meta[k] = metas[k];
    });

    emit("local");

    try {
      await call(API, { method: "POST", body: JSON.stringify(patch) });
      lastError = null;
      return { ok: true };
    } catch (e) {
      /* 되돌립니다 — 저장되지 않은 것을 저장된 것처럼 두지 않습니다 */
      undo.forEach(function (pair) {
        const k = pair[0], was = pair[1];
        if (k.indexOf("rec:") === 0) {
          const p = k.split(":"), kind = p[1], id = p[2];
          const i = mem.records[kind].findIndex(x => x && x.id === id);
          if (was === undefined) { if (i > -1) mem.records[kind].splice(i, 1); }
          else if (i > -1) mem.records[kind][i] = was;
        } else if (k.indexOf("meta:") === 0) {
          const mk = k.slice(5);
          if (was === undefined) delete mem.meta[mk]; else mem.meta[mk] = was;
        } else {
          if (was === undefined) delete mem.values[k]; else mem.values[k] = was;
        }
      });
      lastError = e;
      emit("error");
      return { ok: false, reason: e.message, code: e.code, status: e.status };
    }
  }

  async function seed(patch) {
    try { return await call(API + "?seed=1", { method: "POST", body: JSON.stringify(patch) }); }
    catch (e) { return { seeded: false, reason: e.message }; }
  }
  async function wipe() {
    try { await call(API, { method: "DELETE" }); return { ok: true }; }
    catch (e) { return { ok: false, reason: e.message }; }
  }

  /* ── 남이 바꾼 것 따라가기 ──────────────────────────────────────────── */
  function startPolling() {
    if (polling) return;
    polling = setInterval(function () {
      if (document.hidden) return;        /* 안 보는 창은 두드리지 않습니다 */
      pull();
    }, POLL_MS);
    /* 창으로 돌아올 때는 주기를 기다리지 않습니다 — 자리를 비웠던 동안
       누가 고쳤을 가능성이 제일 큰 순간입니다. */
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) pull();
    });
    window.addEventListener("focus", function () { pull(); });
  }
  function stopPolling() { if (polling) { clearInterval(polling); polling = null; } }

  return {
    status, signIn, signOut,
    pull, push, seed, wipe,
    startPolling, stopPolling, subscribe,
    isReady: () => ready,
    error: () => lastError,
    mem: () => mem,
    /* 읽기는 전부 여기를 지납니다 — 메모리 사본에서 동기적으로 */
    valueOf: (scope, field) => mem.values[scope + "|" + field],
    recordsOf: kind => (mem.records[kind] || []).slice(),
    metaOf: k => mem.meta[k],
    POLL_MS
  };
})();
