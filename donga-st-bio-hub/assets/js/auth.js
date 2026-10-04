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
  function signIn(email, password) {
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
       봅니다. 여기서 같은 비밀번호를 서버에도 보내 쿠키를 받아 둡니다.

       그래서 HUB_ACCESS_SECRET 은 **팀이 쓰는 이 비밀번호와 같은 값**으로
       넣으면 됩니다. 입력란을 둘로 늘리지 않으려는 것입니다.

       기다리지 않습니다. 서버가 없거나 비밀값이 다르면 화면은 그대로 열리고
       (이 브라우저 저장으로) 동작합니다 — 로그인 자체가 막히지는 않습니다.
       서버에 붙었는지는 각 화면이 HubBoot.note() 로 알 수 있습니다. */
    if (window.HubBoot && window.HubBoot.signIn) {
      try { window.HubBoot.signIn(password); } catch (e) {}
    } else if (window.HubServer && window.HubServer.signIn) {
      try { window.HubServer.signIn(password); } catch (e) {}
    }

    return { ok: true, user: session };
  }

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

  return { current, role, can, denial, signIn, signOut, requireSession, switchRole };
})();
