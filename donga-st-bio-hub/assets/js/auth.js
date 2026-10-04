/* ==========================================================================
   Mock session layer

   ⚠ THIS IS NOT AUTHENTICATION.
   Credentials are compared in the browser against a constant in data.js, and
   the "session" is a sessionStorage key. There is no server, no token, no
   verification. It exists so the logged-out → logged-in flow can be demoed.

   Replacing it: every real integration point is marked INTEGRATION below.
   The UI reads only from Auth.current() / Auth.role(), so swapping in real
   SSO (e.g. Azure AD / SAML) means reimplementing this file and nothing else.
   ========================================================================== */

window.Auth = (function () {
  "use strict";

  const KEY = "hub.session";

  /* INTEGRATION: replace with a real session lookup (cookie, token, /me call). */
  function current() {
    try {
      const raw = sessionStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function role() {
    const u = current();
    return u ? window.HUB.ROLES[u.role] : null;
  }

  /* 이 세션이 무엇을 할 수 있는가.

     ⚠ 화면 통제일 뿐 접근 통제가 아닙니다. 콘솔에서 sessionStorage 를
       고치면 우회됩니다. 서버를 붙이기 전까지의 한계이며, 우회를 막는
       것이 아니라 "권한 없는 사람이 실수로 판정 기준을 바꾸는 것" 을
       막는 것이 목적입니다. 그 한계를 화면에도 적어 둡니다. */
  function can(action) {
    const r = role();
    return !!(r && (r.perms || []).indexOf(action) > -1);
  }
  /* 왜 안 되는지까지 — 화면이 이유를 보여 줄 수 있어야 합니다 */
  function denial(action) {
    const u = current();
    if (!u) return "로그인이 필요합니다.";
    const r = role();
    if (can(action)) return null;
    return (r ? r.ko : "현재 권한") + " 계정에는 이 권한이 없습니다 (" + action + ").";
  }

  /* INTEGRATION: replace with an identity-provider redirect + callback. */
  function signIn(email, password, serverSecret) {
    const e = String(email || "").trim().toLowerCase();
    const user = window.HUB.USERS.find(u => u.email.toLowerCase() === e);

    if (!user) {
      return { ok: false, field: "email", msg: "등록되지 않은 계정입니다 · Account not recognised" };
    }
    if (password !== window.HUB.DEMO_PASSWORD) {
      return { ok: false, field: "password", msg: "비밀번호가 일치하지 않습니다 · Incorrect password" };
    }

    const session = {
      email: user.email, name: user.name, nameEn: user.nameEn,
      initials: user.initials, role: user.role, dept: user.dept,
      since: Date.now()
    };
    sessionStorage.setItem(KEY, JSON.stringify(session));

    /* ── 서버 세션도 함께 엽니다 ────────────────────────────────────────
       데이터가 서버에 있으면 화면 로그인만으로는 부족합니다 — 서버는 쿠키를
       봅니다.

       ★ 위 비밀번호를 보내지 않습니다. 그 값은 data.js 안에 있고 data.js 는
         누구에게나 내려가는 파일입니다. 그것으로 서버를 지키면 페이지 소스를
         열어 본 사람 누구나 데이터에 닿습니다. 그래서 서버 비밀값은 따로
         받습니다 (로그인 화면의 '서버 접속 비밀값').

       호출한 쪽이 결과를 기다릴 수 있도록 약속을 함께 돌려줍니다. 서버가
       켜져 있는데 비밀값이 틀렸다면, 로그인 화면이 통과시키지 않고 되묻습니다
       — 틀린 채 들어가면 이 브라우저의 옛 데이터를 서버 데이터로 착각합니다. */
    let server = Promise.resolve({ ok: true, skipped: true });
    if (serverSecret && window.HubBoot && window.HubBoot.signIn) {
      try { server = Promise.resolve(window.HubBoot.signIn(serverSecret)); }
      catch (e) { server = Promise.resolve({ ok: false, reason: "모듈 오류" }); }
    } else if (serverSecret && window.HubServer && window.HubServer.signIn) {
      try { server = Promise.resolve(window.HubServer.signIn(serverSecret)); }
      catch (e) { server = Promise.resolve({ ok: false, reason: "모듈 오류" }); }
    }

    return { ok: true, user: session, server: server };
  }

  /* 화면 세션만 되돌립니다 — 서버 비밀값이 틀려 로그인을 취소할 때 씁니다.
     signOut() 과 달리 페이지를 옮기지 않습니다 (로그인 화면에 그대로 남아
     비밀값을 다시 묻기 위해서). */
  function signOutLocal() { sessionStorage.removeItem(KEY); }

  function signOut() {
    sessionStorage.removeItem(KEY);
    /* 서버 쿠키도 같이 내립니다 — 화면만 나가고 쿠키가 남으면, 같은
       브라우저를 쓰는 다음 사람이 로그인 없이 데이터에 닿습니다. */
    if (window.HubServer && window.HubServer.signOut) { try { window.HubServer.signOut(); } catch (e) {} }
    window.location.href = "index.html";
  }

  /* Redirects to login when no session exists. Client-side only — this
     hides the UI, it does not protect data. */
  function requireSession() {
    const u = current();
    if (!u) { window.location.replace("index.html"); return null; }
    return u;
  }

  function switchRole(roleId) {
    const u = current();
    if (!u || !window.HUB.ROLES[roleId]) return null;
    u.role = roleId;
    sessionStorage.setItem(KEY, JSON.stringify(u));
    return u;
  }

  return { current, role, can, denial, signIn, signOut, signOutLocal, requireSession, switchRole };
})();
