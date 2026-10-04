/* ==========================================================================
   collections.js — 목록형 저장소를 중앙 DB 와 맞추는 한 곳  ·  window.Collections

   일정 · 이슈 · 의뢰 · 할 일 · 회의 핀 · 장비 예약은 모두 같은 모양입니다.
   id 를 가진 레코드의 목록이고, 각자 localStorage 한 칸에 통째로 들어
   있었습니다. 그것을 이 한 겹을 통해 서버와 맞춥니다.

   ── 왜 통째로(blob) 저장하지 않나 ───────────────────────────────────────
   측정값처럼 meta 표에 JSON 한 덩어리로 넣는 쪽이 훨씬 짧게 끝납니다.
   하지만 이것들은 **여러 사람이 동시에 추가하는 큐**입니다.

     A 가 이슈를 추가 → 올림
     B 가 (A 것을 아직 못 받은 채) 이슈를 추가 → 올림

   덩어리로 올리면 B 의 목록이 A 의 목록을 통째로 덮어써서 **A 의 이슈가
   아무 소리 없이 사라집니다.** 오류도 안 납니다. 그래서 레코드 한 줄씩
   넣습니다 — id 가 다르면 서로 섞이지, 덮이지 않습니다.

   records(kind, id, data) 표를 그대로 씁니다. 이미 종류를 가리지 않게
   되어 있어서 **표를 새로 만들 필요가 없습니다.** kind 만 늘어납니다.

   ── 왜 지우지 않고 표시만 하나 ──────────────────────────────────────────
   레코드 단위로 맞추면, 진짜로 지워 버린 것과 "이 브라우저가 아직 못 받은
   것" 을 구별할 방법이 없습니다. A 가 지운 할 일을 B 가 아직 들고 있으면
   B 의 다음 저장이 그것을 **되살립니다.**

   그래서 지우는 대신 deleted 를 세웁니다. 뜻이 분명해지고, 원본도 남습니다
   (이 시스템의 다른 곳과 같은 규칙입니다 — 지우지 않고 비활성화).

   ── 왜 바뀐 것만 올리나 ─────────────────────────────────────────────────
   저장할 때마다 목록 전체를 올리면, 내가 들고 있는 낡은 사본이 남이 방금
   지운 것을 되살립니다. 그래서 마지막으로 주고받은 모습을 기억해 두고
   **달라진 레코드만** 올립니다.
   ========================================================================== */

window.Collections = (function () {
  "use strict";

  const bound = [];                 /* 등록된 저장소들 */

  function server() {
    return window.Persist && window.Persist.isServer() && window.HubServer;
  }

  function clone(v) { try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; } }

  /* 레코드 목록을 id → JSON 문자열 로 — 무엇이 달라졌는지 견주기 위해서 */
  function fingerprint(list) {
    const m = {};
    (list || []).forEach(function (r) {
      if (r && r.id != null) m[r.id] = JSON.stringify(r);
    });
    return m;
  }

  /* ──────────────────────────────────────────────────────────────────────
     spec = {
       kind      서버에서 쓸 종류 이름 ("todo" · "issue" · …)
       key       local 모드에서 쓰던 localStorage 키 (그대로 둡니다)
       list()    지금 목록 꺼내기
       setList() 목록 갈아 끼우기
       whole()   local 모드에서 통째로 저장할 상태 (없으면 목록만)
       setWhole()
       seed()    처음 한 번 심을 목록
     }
     ────────────────────────────────────────────────────────────────────── */
  function bind(spec) {
    let pushed = {};                /* 마지막으로 서버와 맞춘 모습 */

    const api = {
      kind: spec.kind,

      /* 처음 읽기 — 서버 모드면 서버에서, 아니면 지금까지처럼 */
      load: function () {
        if (server()) {
          const recs = window.HubServer.recordsOf(spec.kind) || [];
          pushed = fingerprint(recs);
          return recs.length ? recs : null;
        }
        /* localNoop: 이 목록은 local 모드에서 **다른 곳이** 이미 저장하고
           있습니다 (예: 장비 예약은 Store 의 덩어리 안에 들어 있습니다).
           여기서 또 쓰면 같은 것을 두 군데에 두게 됩니다. */
        if (spec.localNoop) return null;
        try {
          const raw = localStorage.getItem(spec.key);
          return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
      },

      /* 저장 — 서버 모드면 **달라진 레코드만** 올립니다 */
      save: function () {
        if (!server()) {
          if (spec.localNoop) return;
          try {
            const whole = spec.whole ? spec.whole() : { list: spec.list() };
            localStorage.setItem(spec.key, JSON.stringify(whole));
          } catch (e) {}
          return;
        }
        const now = fingerprint(spec.list());
        const changed = [];
        Object.keys(now).forEach(function (id) {
          if (pushed[id] !== now[id]) changed.push(JSON.parse(now[id]));
        });
        /* 내 목록에서 빠진 것 — 지운 것으로 보고 표시만 남깁니다.
           실제로 지우면 남이 들고 있는 사본이 되살립니다. */
        Object.keys(pushed).forEach(function (id) {
          if (now[id] === undefined) {
            let was = null;
            try { was = JSON.parse(pushed[id]); } catch (e) {}
            if (was && !was.deleted) {
              was.deleted = true;
              was.deletedAt = window.Entries ? window.Entries.stamp()
                                             : new Date().toISOString().slice(0, 19);
              changed.push(was);
            }
          }
        });
        if (!changed.length) return;
        pushed = now;
        changed.forEach(function (r) { pushed[r.id] = JSON.stringify(r); });
        window.Persist.pushRecords({ [spec.kind]: changed });
      },

      /* 서버에서 받은 한 벌로 갈아 끼웁니다 (bootstrap · 폴링).
         ★ 쓰기를 유발하지 않습니다 — 방금 읽은 것을 되쓰면 남의 쓰기를
           덮습니다. */
      hydrate: function (records) {
        if (!records) return false;
        const list = records.slice();
        pushed = fingerprint(list);
        if (spec.setWhole) spec.setWhole({ list: list });
        else spec.setList(list);
        return true;
      },

      /* 씨앗 — 그 종류가 서버에 아직 하나도 없을 때만 올립니다 */
      seedRecords: function () {
        return spec.seed ? clone(spec.seed()) : [];
      }
    };

    bound.push(api);
    return api;
  }

  /* bootstrap 이 부릅니다 — 받아온 레코드를 등록된 저장소마다 꽂습니다 */
  function hydrateAll(records) {
    const r = records || {};
    bound.forEach(function (c) {
      if (r[c.kind]) c.hydrate(r[c.kind]);
    });
  }

  /* 아직 씨앗이 들어가지 않은 종류만 골라 한 벌 만듭니다.

     ★ "레코드가 하나도 없음" 이 아니라 meta 의 표시를 봅니다. 개수로 보면,
       누가 씨앗을 전부 지운 다음 날 다시 들어왔을 때 지운 것이 되살아납니다. */
  function seedPayload(serverMeta) {
    const done = (serverMeta && serverMeta["collections.seeded"]) || [];
    const out = {};
    const marked = done.slice();
    bound.forEach(function (c) {
      if (done.indexOf(c.kind) > -1) return;
      const recs = c.seedRecords();
      marked.push(c.kind);
      if (recs && recs.length) out[c.kind] = recs;
    });
    return { records: out, seededKinds: marked };
  }

  function kinds() { return bound.map(function (c) { return c.kind; }); }

  /* 지워진 것은 화면에 내보내지 않습니다 — 각 저장소가 목록을 꺼낼 때 씁니다 */
  function live(list) {
    return (list || []).filter(function (r) { return r && !r.deleted; });
  }

  return { bind, hydrateAll, seedPayload, kinds, live };
})();
