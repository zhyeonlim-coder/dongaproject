/* ==========================================================================
   누가 적었는가 — 이름표 한 장

   ⚠ 인증이 아닙니다. 막는 것이 하나도 없습니다.

   2026-10 부터 이 사이트에는 문이 없습니다. 비밀번호도, 서버 접속 비밀값도
   없습니다. 주소를 아는 사람은 누구나 읽고 씁니다 (소유자 결정 — 배경은
   api/_auth.js 머리말에 있습니다).

   그래서 이 파일이 하는 일은 하나뿐입니다: **모든 기록에 붙는 작성자
   이름을 들고 있는 것.** 측정값마다 작성자와 시각이 함께 저장되고
   (ALCOA+), 이름이 비면 그 기록이 반쪽이 됩니다.

   이름은 비밀번호 없이 고르고, 이 브라우저가 기억하고, 상단에서 바꿉니다.
   고르지 않으면 "미지정" 입니다 — 막지 않습니다.

   사람별 계정과 진짜 인증이 필요해지면 이 파일 하나를 갈아 끼우면 됩니다.
   화면은 Auth.current() / Auth.role() 만 읽습니다.
   ========================================================================== */

window.Auth = (function () {
  "use strict";

  const KEY = "hub.session";

  /* localStorage 를 먼저 봅니다 — 탭을 닫아도 이름이 남아야 합니다.
     예전 sessionStorage 사본도 계속 읽습니다 (쓰던 탭이 그대로 이어지도록). */
  function current() {
    for (const store of [localStorage, sessionStorage]) {
      try {
        const raw = store.getItem(KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) { /* 저장소가 막힌 브라우저 — 다음 것을 봅니다 */ }
    }
    return null;
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

  /* ══════════════════════════════════════════════════════════════════════
     ★ 비밀번호와 '서버 접속 비밀값' 을 없앴습니다 (2026-10, 소유자 결정)

     둘 다 지키는 것이 없거나, 지키는 값에 비해 비용이 컸습니다.

       로그인 비밀번호   data.js 안에 있고 로그인 화면에 인쇄돼 있었습니다.
                        누구나 읽을 수 있으니 애초에 문이 아니었습니다.
       서버 접속 비밀값  진짜 문이었지만 12시간마다 끊겼고, 끊긴 뒤에는
                        조용히 이 브라우저에만 저장됐습니다.

     그래서 데이터는 열고, 되돌릴 수 없는 전체 삭제 한 곳만 비밀값으로
     막았습니다 (api/_auth.js 참고).

     ── 그래도 이름은 남깁니다 ──────────────────────────────────────────
     문을 없앴다고 **누가 적었는지**까지 없애지는 않았습니다. 모든 측정값에
     작성자와 시각이 함께 기록되고(ALCOA+), 이름이 비면 그 기록이 반쪽이
     됩니다. 비밀번호 없이 이름만 고릅니다 — 한 번 고르면 이 브라우저가
     기억하고, 상단에서 언제든 바꿉니다.

     이것은 신원 증명이 아닙니다. 누가 고쳤는지를 서버가 증명하지는
     못합니다. 사람별 계정이 필요해지면 그때 올려야 합니다.
     ══════════════════════════════════════════════════════════════════════ */
  function signIn(email) {
    const e = String(email || "").trim().toLowerCase();
    const user = window.HUB.USERS.find(u => u.email.toLowerCase() === e);

    if (!user) {
      return { ok: false, field: "email", msg: "목록에 없는 이름입니다 · Name not in the list" };
    }

    const session = {
      email: user.email, name: user.name, nameEn: user.nameEn,
      initials: user.initials, role: user.role, dept: user.dept,
      since: Date.now()
    };
    /* ★ 세션이 아니라 이 브라우저에 남깁니다.

       sessionStorage 는 탭을 닫으면 사라집니다. 비밀번호가 있던 시절에는
       그게 맞았지만, 이제는 "내 이름" 일 뿐이라 매번 다시 고르게 할 이유가
       없습니다. 상단에서 언제든 바꿉니다. */
    save(session);

    /* 서버에 보낼 것이 없습니다 — 읽기·쓰기에 비밀값이 필요 없어졌습니다.
       약속 모양은 그대로 둡니다 (부르는 쪽이 .server 를 기다립니다). */
    return { ok: true, user: session, server: Promise.resolve({ ok: true, skipped: true }) };
  }

  function save(session) {
    try { localStorage.setItem(KEY, JSON.stringify(session)); } catch (e) {}
    try { sessionStorage.setItem(KEY, JSON.stringify(session)); } catch (e) {}
  }

  function signOutLocal() { forget(); }

  function forget() {
    try { localStorage.removeItem(KEY); } catch (e) {}
    try { sessionStorage.removeItem(KEY); } catch (e) {}
  }

  /* '이름 바꾸기' — 나가는 문이 아니라 이름을 다시 고르는 길입니다.
     서버 쿠키는 건드리지 않습니다. 그 쿠키는 전체 삭제 전용이고,
     이름과 아무 관계가 없습니다. */
  function signOut() {
    forget();
    window.location.href = "index.html";
  }

  /* ★ 더 이상 막지 않습니다.

     예전에는 세션이 없으면 로그인 화면으로 돌려보냈습니다. 이제 문이
     없으므로 돌려보낼 이유도 없습니다 — 이름을 아직 안 골랐으면 "미지정"
     으로 두고 그대로 들여보냅니다. 이름은 상단에서 고릅니다.

     이름이 비어 있어도 기록은 남습니다. 비어 있다는 사실 자체가 기록이고,
     나중에 누구였는지 되짚을 때 "이름을 고르지 않은 브라우저" 라는 단서가
     "작성자 없음" 보다 낫습니다. */
  function requireSession() {
    return current() || GUEST;
  }

  const GUEST = {
    email: null, name: "미지정", nameEn: "Unassigned",
    initials: "—", role: "rnd", dept: "—", guest: true
  };

  function switchRole(roleId) {
    const u = current();
    if (!u || !window.HUB.ROLES[roleId]) return null;
    u.role = roleId;
    save(u);
    return u;
  }

  return { current, role, can, denial, signIn, signOut, signOutLocal, requireSession, switchRole };
})();
