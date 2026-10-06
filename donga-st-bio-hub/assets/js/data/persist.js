/* ==========================================================================
   persist.js — 저장 위치를 정하는 한 곳  ·  window.Persist

   ── 왜 이 사이에 한 겹을 두나 ───────────────────────────────────────────
   저장 위치가 브라우저에서 서버로 옮겨 갑니다. 그런데 저장을 부르는 곳은
   Entries · Dataset · Aliases · 워크시트 설정으로 흩어져 있고, 각자
   localStorage 를 직접 만지고 있었습니다. 그 상태로 서버 호출을 끼워 넣으면
   네 곳이 각자 다른 방식으로 실패하고, 한 곳만 옛 경로에 남아도 그 데이터만
   조용히 공유되지 않습니다.

   그래서 저장 위치를 아는 곳을 여기 하나로 모읍니다.

   ── 두 가지 모드 ────────────────────────────────────────────────────────
     server   서버 DB 가 정본입니다. **localStorage 를 한 글자도 쓰지 않습니다.**
     local    서버가 아직 설정되지 않았을 때. 지금까지처럼 동작합니다.

   ★ 왜 local 을 남겼나.
     서버는 환경변수(POSTGRES_URL · HUB_ACCESS_SECRET)가 있어야 삽니다. 그
     설정은 이 저장소의 주인이 직접 해야 합니다. 그때까지 localStorage 를
     통째로 걷어내면 사이트가 데이터 없이 멈춥니다 — 설정 한 줄이 늦어서
     전부 못 쓰게 되는 것은 바꿀 만한 거래가 아닙니다.

     서버가 켜지면 local 경로는 쓰이지 않습니다. 두 곳에 동시에 쓰는 일은
     없습니다 — 그러면 어느 쪽이 정본인지 알 수 없게 됩니다.
   ========================================================================== */

window.Persist = (function () {
  "use strict";

  let mode = "local";                    /* bootstrap 이 서버 확인 후 바꿉니다 */

  function setMode(m) { mode = (m === "server") ? "server" : "local"; }
  function isServer() { return mode === "server"; }

  /* ── 서버 사본이 아직 안 왔을 때 ────────────────────────────────────────
     setMode("server") 는 **받아오기 전에** 불립니다. 그 사이에는 메모리
     사본이 비어 있어서, 읽으면 "아무것도 없다" 가 나옵니다.

     그 상태에서 쓰면 어떻게 되는지가 문제였습니다 —

       1. 화면이 열리며 열 목록을 읽음  → (아직 안 옴) 비어 있음
       2. "없으니 기본값을 깔자" 며 **기본값을 서버에 씀**
       3. 잠시 뒤 서버 사본이 도착 → 하지만 서버에는 이미 2번이 덮어쓴
          기본값이 들어가 있음

     다른 PC 에서 만든 열이 **페이지를 열기만 해도 지워졌습니다.** 저장이
     안 된 것이 아니라, 저장된 것을 이쪽이 덮어쓴 것입니다.

     그래서 준비되기 전에는 —
       · 덩어리 설정(meta)은 **쓰지 않습니다.** 읽은 것이 가짜이므로
         그걸 바탕으로 쓴 것도 가짜입니다.
       · 값·레코드는 **모아 두었다가** 준비된 뒤 보냅니다. 이쪽은 키 단위라
         남의 것을 덮지 않고, 사용자가 방금 적은 것을 버리면 안 됩니다. */
  function ready() {
    if (mode !== "server") return true;
    return !!(window.HubServer && window.HubServer.isReady && window.HubServer.isReady());
  }

  const queued = [];
  function flush() {
    if (!queued.length || !ready()) return;
    const list = queued.splice(0, queued.length);
    list.forEach(function (p) {
      try { window.HubServer.push(p); } catch (e) {}
    });
  }
  /* 준비되는 순간 밀어 냅니다 */
  if (window.HubServer && window.HubServer.subscribe) {
    window.HubServer.subscribe(function () { flush(); });
  }

  /* ── 작은 설정 덩어리 (이름 덧씌움 · 워크시트 열·행 · 보기 설정) ──────
     local 모드에서는 localStorage 한 칸, server 모드에서는 meta 표 한 줄. */
  function getJSON(key, fallback) {
    if (mode === "server") {
      const v = window.HubServer ? window.HubServer.metaOf(key) : undefined;
      return (v === undefined || v === null) ? fallback : v;
    }
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }

  function setJSON(key, value) {
    if (mode === "server") {
      if (!window.HubServer) return false;
      /* ★ 서버 사본이 오기 전에는 쓰지 않습니다 — 위 설명 참고.
         빈 것을 읽고 만든 값을 쓰면 남의 설정을 지웁니다. */
      if (!ready()) {
        if (window.console && console.warn) {
          console.warn("[Persist] 서버 사본이 오기 전이라 저장하지 않았습니다: " + key);
        }
        return false;
      }
      /* 서버 응답을 기다리지 않습니다 — 메모리에는 즉시 반영되고, 실패하면
         HubServer 가 되돌리며 "error" 를 알립니다. 화면이 입력 중에 멈추지
         않게 하려는 것이고, 실패를 숨기려는 것이 아닙니다. */
      window.HubServer.push({ meta: { [key]: value } });
      return true;
    }
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  function remove(key) {
    if (mode === "server") {
      if (window.HubServer) window.HubServer.push({ meta: { [key]: null } });
      return;
    }
    try { localStorage.removeItem(key); } catch (e) {}
  }

  /* ── 값과 레코드 ──────────────────────────────────────────────────────
     이 둘은 meta 가 아니라 제 표를 씁니다 (entry_values · records).
     양이 많고, 나중에 "누가 언제 무엇을 고쳤나" 를 질의해야 하기 때문입니다. */
  function pushValues(map) {
    if (mode !== "server" || !window.HubServer) return Promise.resolve({ ok: true });
    /* 아직 사본이 안 왔으면 모아 둡니다 — 사용자가 방금 적은 값입니다.
       키 단위라 나중에 보내도 남의 것을 덮지 않습니다. */
    if (!ready()) { queued.push({ values: map }); return Promise.resolve({ ok: true, queued: true }); }
    return window.HubServer.push({ values: map });
  }
  function pushRecords(byKind) {
    if (mode !== "server" || !window.HubServer) return Promise.resolve({ ok: true });
    if (!ready()) { queued.push({ records: byKind }); return Promise.resolve({ ok: true, queued: true }); }
    return window.HubServer.push({ records: byKind });
  }

  /* ── 이 기기에만 두는 것 ──────────────────────────────────────────────
     보기 설정(열 너비 · 숨긴 열 · 콤팩트 · 차트에서 고른 계열)은 **데이터가
     아니라 그 사람이 지금 어떻게 보고 있는가**입니다.

     이것까지 서버에 두면, 한 사람이 열을 숨겼을 때 **다른 사람 화면에서도
     그 열이 사라집니다.** 받는 쪽에서는 데이터가 안 들어온 것처럼 보이고,
     실제로는 남이 숨긴 것입니다 — 원인을 찾기 아주 어렵습니다.

     그래서 서버 모드에서도 이 둘만은 브라우저에 둡니다. */
  function getLocalJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function setLocalJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  return { setMode, isServer, ready, mode: () => mode,
           getJSON, setJSON, remove, pushValues, pushRecords,
           getLocalJSON, setLocalJSON,
           pending: () => queued.length };
})();
