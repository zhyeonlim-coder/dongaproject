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
    return { ok: true, user: session };
  }

  function signOut() {
    sessionStorage.removeItem(KEY);
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

  return { current, role, signIn, signOut, requireSession, switchRole };
})();
