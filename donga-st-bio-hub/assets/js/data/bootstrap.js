/* ==========================================================================
   bootstrap.js — 서버가 있으면 서버에서, 없으면 지금까지처럼

   ── 순서 ────────────────────────────────────────────────────────────────
     1. 서버에 물어봅니다. 설정되어 있나 · 로그인되어 있나
     2. 아니면 local 모드로 둡니다 (지금까지와 똑같이 동작)
     3. 맞으면 server 모드로 바꾸고 한 벌 받아옵니다
     4. 서버가 비어 있으면 씨앗을 한 번 올립니다
     5. Entries · Dataset · Aliases 를 받아온 것으로 갈아 끼우고 화면에 알립니다

   ── 왜 화면을 기다리게 하지 않나 ────────────────────────────────────────
   화면 스크립트는 서로 이어서 동기적으로 돕니다. 여기서 기다리게 하려면
   모든 화면의 시작점을 비동기로 바꿔야 하고, 한 군데만 빠뜨리면 그 화면만
   옛 데이터로 떠 있게 됩니다.

   그래서 화면은 먼저 그리고, 서버에서 받아오면 Repo 를 통해 "다시 그려라"
   고 알립니다. 이미 세 화면이 그 신호를 듣고 있습니다. 잠깐 씨앗이 보였다가
   서버 값으로 바뀌는 깜빡임이 있지만, 틀린 값이 남아 있는 것보다 낫습니다.

   ── 씨앗을 서버에서 만들지 않는 이유 ────────────────────────────────────
   씨앗은 batches.js · studies.js · samples.js 가 만듭니다. 이미 있고 검증도
   되어 있습니다. 서버에서 다시 만들면 두 벌이 되고, 언젠가 한쪽만 고쳐집니다.
   그래서 처음 들어온 브라우저가 자기가 만든 씨앗을 한 번 올립니다.
   ========================================================================== */

window.HubBoot = (function () {
  "use strict";

  let state = { mode: "local", reason: "init", signedIn: false, serverReady: false };

  function note() { return Object.assign({}, state); }

  function tell(what) {
    if (window.Repo && window.Repo.notify) window.Repo.notify(what || "remote");
  }

  /* 서버에서 받은 한 벌을 각 모듈에 꽂습니다 */
  function adopt() {
    const S = window.HubServer;
    if (!S) return;
    if (window.Entries && window.Entries.hydrate) {
      window.Entries.hydrate(S.mem().values, S.metaOf("hub.entries.aux"));
    }
    if (window.Dataset && window.Dataset.hydrate) {
      window.Dataset.hydrate(S.mem().records);
    }
    if (window.Aliases && window.Aliases.hydrate) window.Aliases.hydrate();
    tell("remote");
  }

  async function start() {
    const S = window.HubServer;
    if (!S || !window.Persist) { state.reason = "모듈 없음"; return note(); }

    const st = await S.status();
    state.signedIn = !!st.signedIn;

    if (!st.configured) {
      /* 서버가 아직 설정되지 않았습니다 — 지금까지처럼 이 브라우저에 둡니다.
         여기서 localStorage 를 걷어내면 설정 전까지 사이트가 멈춥니다. */
      window.Persist.setMode("local");
      state.mode = "local";
      state.reason = st.offline ? "서버에 닿지 못함" : "서버 미설정";
      return note();
    }

    if (!st.signedIn) {
      window.Persist.setMode("local");
      state.mode = "local";
      state.reason = "로그인 필요";
      return note();
    }

    /* ★ 여기서부터 localStorage 는 쓰지 않습니다 */
    window.Persist.setMode("server");
    state.mode = "server";

    const got = await S.pull(true);
    if (!got.ok) {
      /* 서버는 있는데 읽지 못했습니다. 틀린 값을 보여 주느니 그렇다고
         말하는 편이 낫습니다 — local 로 되돌리면 남의 데이터가 아니라
         이 브라우저의 옛 데이터를 보여 주게 됩니다. */
      state.reason = "서버에서 읽지 못함: " + (got.reason || "");
      state.serverReady = false;
      tell("remote");
      return note();
    }

    if (got.empty && window.Dataset && window.Dataset.seedPayload) {
      await S.seed({ records: window.Dataset.seedPayload(), values: {}, meta: {} });
      await S.pull(true);
    }

    adopt();
    state.serverReady = true;
    state.reason = "서버";

    /* 남이 바꾼 것 따라가기 */
    S.subscribe(function (what) { if (what === "pull") adopt(); });
    S.startPolling();
    return note();
  }

  /* 로그인 화면이 부릅니다 — 비밀값이 맞으면 쿠키를 받고 바로 붙습니다 */
  async function signIn(secret) {
    const S = window.HubServer;
    if (!S) return { ok: false, reason: "서버 모듈 없음" };
    const r = await S.signIn(secret);
    if (!r.ok) return r;
    await start();
    return { ok: true, mode: state.mode };
  }

  const ready = start();

  return { ready, start, signIn, note, adopt };
})();
