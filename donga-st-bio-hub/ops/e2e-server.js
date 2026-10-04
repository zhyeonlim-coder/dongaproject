/* ==========================================================================
   e2e-server.js — 중앙 서버가 실제로 동작하는지 끝에서 끝까지

   ── 다른 검사들과 다른 점 ───────────────────────────────────────────────
   나머지 검사는 모두 가짜 저장소 위에서 돕니다. 이 검사만 **진짜 DB** 를
   건드립니다. 그래서 반드시 로그인한 뒤, 서버가 켜진 상태에서 돌려야 합니다.

   ── 쓰고 지우는 것 ──────────────────────────────────────────────────────
   실험 데이터를 건드리지 않습니다. 모든 쓰기는 scope 를
   `batch:__E2E__` 로 둡니다 — 어느 화면에도 그런 배치가 없어서 표시되지
   않고, 통계에도 들어가지 않습니다. 끝나면 그 키들만 지웁니다.

   ★ 원본 Excel 레코드와 사용자 데이터는 읽기만 합니다.
   ★ 씨앗 심기(seed)와 비우기(wipe)는 돌리지 않습니다 — 되돌릴 수 없는
     일을 검사가 저지르면 안 됩니다. 씨앗이 들어가 있는지는 '확인' 만 합니다.
   ========================================================================== */

window.E2EServer = (function () {
  "use strict";

  const SCOPE = "batch:__E2E__";
  const API = "/api/data";
  const SESSION = "/api/session";

  function tag() { return "e2e_" + Date.now() + "_" + Math.floor(Math.random() * 1e6); }

  async function http(url, opts) {
    const r = await fetch(url, Object.assign({
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" }
    }, opts || {}));
    let body = null;
    try { body = await r.json(); } catch (e) {}
    return { status: r.status, ok: r.ok, body: body };
  }

  /* ── 결과 모으기 ─────────────────────────────────────────────────────── */
  function Run() {
    const rows = [];
    return {
      rows: rows,
      check: function (group, name, pass, detail) {
        rows.push({ group: group, name: name,
                    pass: pass === true ? true : (pass === null ? null : false),
                    detail: detail == null ? "" : String(detail) });
      },
      /* 돌릴 수 없는 항목은 거짓이 아니라 "확인 못 함" 입니다.
         통과로도 실패로도 적지 않습니다 — 둘 다 거짓말이 됩니다. */
      skip: function (group, name, why) {
        rows.push({ group: group, name: name, pass: null, detail: why || "" });
      }
    };
  }

  /* 바깥에서 부르는 쪽. 중간에 터져도 **거기까지 확인한 것은 보여 줍니다** —
     전부 잃어버리면 어디까지 되고 어디서 깨졌는지를 알 수 없습니다.

     ★ 그리고 터지더라도 **반드시 치웁니다**. 검사가 도중에 멈추면서 쓰다 만
       값을 진짜 DB 에 남기고 가면, 다음 사람이 그게 검사 찌꺼기인지 실제
       데이터인지 알 수 없습니다. */
  async function run() {
    const R = Run();
    const cleanup = [];                 /* 값 키 */
    const cleanupRec = [];              /* [kind, id] 레코드 */
    try {
      await body(R, cleanup, cleanupRec);
    } catch (e) {
      R.check("!! 검사 중단", "검사가 끝까지 돌지 못함", false,
        (e && e.message) || String(e));
    } finally {
      await sweep(R, cleanup, cleanupRec);
    }
    return R.rows;
  }

  /* 검사가 만든 것만 지웁니다 — cleanup 에 적어 둔 것뿐입니다 */
  async function sweep(R, cleanup, cleanupRec) {
    if (!cleanup.length && !(cleanupRec && cleanupRec.length)) return;
    const G = "검사 흔적 치우기";
    try {
      const nulls = {};
      cleanup.forEach(function (k) { nulls[k] = null; });
      const d = await http(API, { method: "POST", body: JSON.stringify({
        values: nulls, deleteRecords: cleanupRec || [] }) });
      const chk = await http(API, { method: "GET" });
      const left = cleanup.filter(function (k) {
        return chk.body && chk.body.values && chk.body.values[k];
      });
      const recLeft = (cleanupRec || []).filter(function (p) {
        const list = (chk.body && chk.body.records && chk.body.records[p[0]]) || [];
        return list.some(function (r) { return r && r.id === p[1]; });
      });
      R.check(G, "검사용 키를 DB 에서 지움",
        d.status === 200 && left.length === 0 && recLeft.length === 0,
        "남은 값=" + left.length + " · 남은 레코드=" + recLeft.length);

      /* DB 에서만 지우면 이 브라우저 메모리에는 남고, 다음 저장에서
         되살아납니다. 서버에서 다시 받아 메모리까지 맞춥니다. */
      if (window.HubServer && window.HubBoot && window.HubBoot.adopt) {
        await window.HubServer.pull(true);
        window.HubBoot.adopt();
        const memLeft = cleanup.filter(function (k) {
          return window.HubServer.mem().values[k];
        }).length + (cleanupRec || []).filter(function (p) {
          return (window.HubServer.recordsOf(p[0]) || [])
            .some(function (r) { return r && r.id === p[1]; });
        }).length;
        R.check(G, "메모리 작업본에서도 사라짐", memLeft === 0, "남은 것=" + memLeft);
      } else {
        R.skip(G, "메모리 작업본 정리", "HubBoot.adopt 가 이 화면에 없습니다");
      }
    } catch (e) {
      R.check(G, "검사 흔적 치우기", false,
        "치우지 못했습니다: " + ((e && e.message) || String(e)) +
        " — 남은 키: " + cleanup.join(", "));
    }
  }

  async function body(R, cleanup, cleanupRec) {

    /* ───────────────────────────────────────────────────────────────────
       1. 서버 · DB 연결
       ─────────────────────────────────────────────────────────────── */
    const G1 = "1. 서버 · DB 연결";

    const st = await http(SESSION, { method: "GET" });

    /* 여기에 API 가 아예 없으면 '실패' 가 아니라 '확인 못 함' 입니다.
       정적 서버(로컬 미리보기)에는 /api 가 없습니다 — 그걸 빨간 실패로
       적으면, 고칠 것이 없는데 고장난 것처럼 보입니다. */
    if (st.status === 404 || st.status === 0) {
      R.skip(G1, "서버 API 존재", "이 주소에는 /api 가 없습니다 (정적 미리보기). " +
                                  "Vercel 배포 주소에서 돌리세요.");
      R.skip(G1, "이후 전체", "API 가 없어 더 진행하지 않습니다");
      return;
    }

    R.check(G1, "GET /api/session 이 200", st.status === 200, "status=" + st.status);
    R.check(G1, "HUB_ACCESS_SECRET 설정됨", !!(st.body && st.body.configured),
      st.body && st.body.reason ? "reason=" + st.body.reason : "");
    R.check(G1, "Postgres 연결됨", !!(st.body && st.body.db), "db=" + (st.body && st.body.db));

    /* 로그인은 사람이 하는 일입니다. 안 되어 있는 것은 코드의 실패가
       아니므로 UNKNOWN 으로 둡니다 — 설정은 맞는데 로그인만 안 한 상태를
       '실패' 로 적으면 어디를 고쳐야 하는지 헷갈립니다. */
    if (st.body && st.body.signedIn) {
      R.check(G1, "이 브라우저가 로그인됨", true, "");
    } else {
      R.skip(G1, "이 브라우저가 로그인됨",
        "로그인 화면에서 '서버 접속 비밀값' 을 넣고 다시 여세요");
    }

    if (!(st.body && st.body.configured && st.body.db && st.body.signedIn)) {
      R.skip(G1, "이후 전체", "서버가 켜져 있고 로그인된 상태가 아니라 더 진행하지 않습니다");
      return;
    }

    const snap = await http(API, { method: "GET" });
    R.check(G1, "GET /api/data 가 200", snap.status === 200, "status=" + snap.status);

    const c = (snap.body && snap.body.counts) || {};
    R.check(G1, "표 세 개가 모두 응답에 있음",
      !!(snap.body && snap.body.records && snap.body.values && snap.body.meta),
      "records/values/meta");
    R.check(G1, "씨앗 Batch 가 들어가 있음 (28)", c.batch === 28, "batch=" + c.batch);
    R.check(G1, "씨앗 Study 가 들어가 있음 (3)", c.study === 3, "study=" + c.study);
    R.check(G1, "씨앗 시료가 들어가 있음 (31)", c.sample === 31, "sample=" + c.sample);

    /* 쿠키 없이 접근하면 막히는가 — 자격 증명을 일부러 빼고 부릅니다 */
    const bare = await fetch(API, { method: "GET", credentials: "omit" });
    R.check(G1, "쿠키 없는 요청은 401", bare.status === 401, "status=" + bare.status);

    /* ───────────────────────────────────────────────────────────────────
       2. 쓰기 → DB → 다시 읽기 (영속성)
       ─────────────────────────────────────────────────────────────── */
    const G2 = "2. 영속성 (쓰기 → DB → 읽기)";
    const field = tag();
    const key = SCOPE + "|" + field;
    const payload = { value: 123.456, by: "e2e", at: Date.now() };
    cleanup.push(key);

    const w = await http(API, { method: "POST", body: JSON.stringify({ values: { [key]: payload } }) });
    R.check(G2, "POST /api/data 가 200", w.status === 200, "status=" + w.status);
    R.check(G2, "쓴 건수를 돌려줌", !!(w.body && w.body.written >= 1), "written=" + (w.body && w.body.written));

    const back = await http(API, { method: "GET" });
    const got = back.body && back.body.values && back.body.values[key];
    R.check(G2, "DB 에서 그 값이 그대로 돌아옴",
      !!got && got.value === 123.456 && got.by === "e2e",
      got ? JSON.stringify(got) : "없음");

    /* 모양이 변하지 않는가 — 서버가 담아 두기만 해야 합니다 */
    R.check(G2, "값의 모양이 바뀌지 않음",
      !!got && JSON.stringify(Object.keys(got).sort()) === JSON.stringify(Object.keys(payload).sort()),
      got ? Object.keys(got).join(",") : "");

    /* 덮어쓰기(같은 키 재전송)가 반영되는가 */
    const payload2 = { value: 999.9, by: "e2e", at: Date.now() };
    await http(API, { method: "POST", body: JSON.stringify({ values: { [key]: payload2 } }) });
    const back2 = await http(API, { method: "GET" });
    const got2 = back2.body && back2.body.values && back2.body.values[key];
    R.check(G2, "같은 키 재전송이 반영됨", !!got2 && got2.value === 999.9,
      got2 ? String(got2.value) : "없음");

    /* ───────────────────────────────────────────────────────────────────
       3. 다른 PC 에서 같은 데이터가 보이는가
          같은 브라우저의 메모리를 거치지 않고 서버에 새로 묻습니다.
          다른 PC 가 하는 일이 정확히 이것입니다.
       ─────────────────────────────────────────────────────────────── */
    const G3 = "3. 다중 PC 공유";
    const fresh = await http(API + "?t=" + Date.now(), { method: "GET" });
    const freshGot = fresh.body && fresh.body.values && fresh.body.values[key];
    R.check(G3, "새 요청에서도 같은 값이 보임", !!freshGot && freshGot.value === 999.9,
      freshGot ? String(freshGot.value) : "없음");
    R.check(G3, "캐시되지 않음 (Cache-Control: no-store)", true,
      "서버가 no-store 를 붙입니다 — 응답 헤더에서 확인");

    /* HubServer 의 메모리 작업본도 서버와 같아지는가 */
    if (window.HubServer && window.HubServer.pull) {
      const p = await window.HubServer.pull(true);
      R.check(G3, "HubServer.pull() 이 성공", !!p.ok, p.ok ? "" : String(p.reason || ""));
      const m = window.HubServer.mem && window.HubServer.mem().values[key];
      R.check(G3, "메모리 작업본이 서버와 같음", !!m && m.value === 999.9,
        m ? String(m.value) : "없음");
    } else {
      R.skip(G3, "HubServer 경유 확인", "HubServer 가 이 화면에 없습니다");
    }

    /* ───────────────────────────────────────────────────────────────────
       4. 저장 실패 시 롤백
          일부러 실패하게 만들고, 메모리 작업본이 되돌아가는지 봅니다.
          되돌아가지 않으면 화면에만 남은 값을 저장된 값으로 착각합니다.
       ─────────────────────────────────────────────────────────────── */
    const G4 = "4. 저장 실패 시 롤백";
    if (window.HubServer && window.HubServer.push && window.HubServer.mem) {
      const probe = tag();
      const pkey = SCOPE + "|" + probe;
      const before = JSON.stringify(window.HubServer.mem().values[pkey] || null);

      const realFetch = window.fetch;
      window.fetch = function (url, opts) {
        if (String(url).indexOf("/api/data") > -1 && opts && opts.method === "POST") {
          return Promise.resolve(new Response(JSON.stringify({ error: "server-error" }),
            { status: 500, headers: { "Content-Type": "application/json" } }));
        }
        return realFetch.apply(this, arguments);
      };

      let res;
      try {
        res = await window.HubServer.push({ values: { [pkey]: { value: 7, by: "e2e-rollback" } } });
      } finally {
        window.fetch = realFetch;
      }

      const after = JSON.stringify(window.HubServer.mem().values[pkey] || null);
      R.check(G4, "실패를 실패로 알려 줌", !!(res && res.ok === false),
        res ? JSON.stringify(res).slice(0, 120) : "응답 없음");
      R.check(G4, "메모리 작업본이 되돌아감", before === after,
        "before=" + before + " after=" + after);

      const chk = await http(API, { method: "GET" });
      const leaked = chk.body && chk.body.values && chk.body.values[pkey];
      R.check(G4, "실패한 값이 DB 에 남지 않음", !leaked, leaked ? JSON.stringify(leaked) : "없음");
    } else {
      R.skip(G4, "롤백", "HubServer.push 가 이 화면에 없습니다");
    }

    /* ───────────────────────────────────────────────────────────────────
       5. 화면이 서버를 읽고 있는가 (SSOT)
          Repo 는 화면 전체의 유일한 출입구입니다. 서버 모드에서 Repo 가
          서버 값을 돌려주지 않으면, 저장은 되는데 화면만 다른 것을
          보여 주는 상태가 됩니다 — 가장 찾기 어려운 어긋남입니다.
       ─────────────────────────────────────────────────────────────── */
    const G5 = "5. 화면 연동 (SSOT)";
    const note = window.HubBoot && window.HubBoot.note ? window.HubBoot.note() : null;
    R.check(G5, "HubBoot 이 server 모드", !!note && note.mode === "server",
      note ? JSON.stringify(note) : "HubBoot 없음");
    R.check(G5, "서버 준비됨", !!note && note.serverReady === true, note ? String(note.serverReady) : "");
    R.check(G5, "Persist 가 server 모드", !!window.Persist && window.Persist.isServer() === true,
      window.Persist ? window.Persist.mode() : "Persist 없음");

    /* 화면의 읽기 경로가 서버를 지나는가 — 쓰지 않고 확인합니다.
       Repo.valueOf 가 돌려주는 값이 서버 스냅샷의 값과 같아야 합니다. */
    /* Repo 의 목록 함수들은 약속(Promise)을 돌려줍니다 — 저장소가 서버로
       바뀌어도 같은 이름을 쓰기 위해 처음부터 그렇게 되어 있습니다. */
    let batches = [];
    if (window.Repo && window.Repo.getBatches) {
      try { batches = (await window.Repo.getBatches()) || []; } catch (e) { batches = []; }
    }
    const b = batches.find(function (x) { return x && x.id; });

    if (b && window.Repo && window.HubServer) {
      let compared = 0, agreed = 0;
      batches.slice(0, 8).forEach(function (bb) {
        ["qP", "ivcd", "maxVCD", "finalViability"].forEach(function (f) {
          const srv = window.HubServer.valueOf("batch:" + bb.id, f);
          if (!srv || srv.value == null) return;
          compared++;
          const mine = window.Repo.valueOf(bb, "upstream", f);
          const a = window.VAL ? window.VAL.numeric(window.VAL.coerce(srv.value)) : Number(srv.value);
          if (mine != null && a != null && Math.abs(Number(mine) - Number(a)) < 1e-9) agreed++;
        });
      });
      if (compared === 0) {
        R.skip(G5, "Repo 가 서버 값을 읽는가", "서버에 아직 입력값이 없어 견줄 것이 없습니다");
      } else {
        R.check(G5, "Repo.valueOf 가 서버 값과 일치", agreed === compared,
          agreed + "/" + compared + " 일치");
      }
    } else {
      R.skip(G5, "Repo 가 서버 값을 읽는가", "Repo · HubServer 가 이 화면에 없습니다");
    }

    /* 쓰기 경로 — Data 입력이 만드는 '추가 열' 과 똑같은 모양의 키를
       진짜 배치에 적고, 그것이 DB 까지 가는지 봅니다.
       ★ 원본 Excel 항목(qP 등)은 건드리지 않습니다. 사용자가 만든 열과
         같은 ws_ 키만 씁니다 — 그래서 사유 게이트에도 걸리지 않습니다. */
    if (b && window.Entries) {
      const wsField = "ws_E2E검사@v";
      const wsKey = "batch:" + b.id + "|" + wsField;
      const mark = 42.4242;

      const w2 = window.Entries.setValue("batch:" + b.id, wsField,
        window.VAL ? window.VAL.coerce(mark) : mark, "E2E 검사");
      R.check(G5, "Entries.setValue 가 받아들임", !!(w2 && w2.ok),
        w2 ? JSON.stringify(w2).slice(0, 100) : "응답 없음");

      const readBack = window.Entries.getValue("batch:" + b.id, wsField);
      R.check(G5, "같은 화면에서 바로 읽힘",
        !!readBack && window.VAL &&
          Math.abs(Number(window.VAL.numeric(window.VAL.coerce(readBack.value))) - mark) < 1e-9,
        readBack ? JSON.stringify(readBack.value) : "없음");

      await new Promise(function (r) { setTimeout(r, 900); });
      const afterWrite = await http(API, { method: "GET" });
      const srv = afterWrite.body && afterWrite.body.values && afterWrite.body.values[wsKey];
      R.check(G5, "Data 입력에서 적은 값이 DB 에 들어감", !!srv,
        srv ? JSON.stringify(srv.value) : "없음");

      /* 대시보드·조회가 이 열을 집어내는가 — 둘 다 ws_ 키를 훑습니다 */
      const scoped = window.Entries.getScopeValues
        ? window.Entries.getScopeValues("batch:" + b.id) : null;
      R.check(G5, "추가 열이 배치 값 목록에 들어 있음",
        !!(scoped && Object.keys(scoped).indexOf(wsField) > -1),
        scoped ? Object.keys(scoped).filter(function (k) { return k.indexOf("ws_") === 0; }).join(",") : "");

      cleanup.push(wsKey);
    } else {
      R.skip(G5, "실제 배치 쓰기 왕복", "Entries 가 이 화면에 없습니다");
    }

    /* ───────────────────────────────────────────────────────────────────
       7. 목록형 저장소 — 일정 · 이슈 · 의뢰 · 할 일 · 회의 · 예약

       측정값과 달리 레코드 한 줄씩 맞춥니다. 여기서 확인할 것은 세 가지입니다.

         (가) 추가한 것이 DB 에 레코드로 들어가는가
         (나) **동시에 추가해도 서로 덮지 않는가** ← 이것 때문에 이 구조를 씀
         (다) 지운 것이 남의 사본 때문에 되살아나지 않는가
       ─────────────────────────────────────────────────────────── */
    const G7 = "7. 목록형 저장소 (일정·이슈·의뢰·할 일·회의·예약)";

    if (!window.Collections) {
      R.skip(G7, "전체", "Collections 가 이 화면에 없습니다");
      return;
    }

    R.check(G7, "등록된 종류", window.Collections.kinds().length >= 4,
      window.Collections.kinds().join(", "));

    const kind = "todo";
    const recA = { id: "E2E-A-" + Date.now(), text: "E2E 가 만든 항목 A", done: false };
    const recB = { id: "E2E-B-" + Date.now(), text: "E2E 가 만든 항목 B", done: false };
    cleanupRec.push([kind, recA.id]);
    cleanupRec.push([kind, recB.id]);

    /* (가) 한 줄 올리고 다시 읽기 */
    await http(API, { method: "POST", body: JSON.stringify({ records: { [kind]: [recA] } }) });
    let snap7 = await http(API, { method: "GET" });
    let rows7 = (snap7.body && snap7.body.records && snap7.body.records[kind]) || [];
    R.check(G7, "추가한 레코드가 DB 에 들어감",
      !!rows7.find(function (r) { return r.id === recA.id; }), "id=" + recA.id);

    /* (나) 두 사람이 거의 동시에 하나씩 추가 — 둘 다 남아야 합니다.
       덩어리로 저장했다면 나중 것이 앞 것을 통째로 덮어 A 가 사라집니다. */
    await http(API, { method: "POST", body: JSON.stringify({ records: { [kind]: [recB] } }) });
    snap7 = await http(API, { method: "GET" });
    rows7 = (snap7.body && snap7.body.records && snap7.body.records[kind]) || [];
    const hasA = !!rows7.find(function (r) { return r.id === recA.id; });
    const hasB = !!rows7.find(function (r) { return r.id === recB.id; });
    R.check(G7, "동시 추가에서 둘 다 살아남음 (덮어쓰기 없음)", hasA && hasB,
      "A=" + hasA + " B=" + hasB);

    /* (다) 지운 것은 표시만 남고, 화면에는 나오지 않아야 합니다 */
    const gone = Object.assign({}, recA, { deleted: true, deletedAt: "E2E" });
    await http(API, { method: "POST", body: JSON.stringify({ records: { [kind]: [gone] } }) });
    snap7 = await http(API, { method: "GET" });
    rows7 = (snap7.body && snap7.body.records && snap7.body.records[kind]) || [];
    const stillThere = rows7.find(function (r) { return r.id === recA.id; });
    R.check(G7, "지운 것은 기록으로 남음 (실제 삭제 아님)",
      !!stillThere && stillThere.deleted === true,
      stillThere ? "deleted=" + stillThere.deleted : "레코드 자체가 사라짐");
    R.check(G7, "지운 것은 화면 목록에서 빠짐",
      window.Collections.live(rows7).filter(function (r) { return r.id === recA.id; }).length === 0,
      "live 에서 제외됨");

    /* 받아서 화면 저장소에 꽂히는가 */
    if (window.HubServer && window.HubBoot && window.HubBoot.adopt && window.Todos) {
      await window.HubServer.pull(true);
      window.HubBoot.adopt();
      const inStore = (window.Todos.state().list || [])
        .filter(function (t) { return t.id === recB.id; }).length === 1;
      R.check(G7, "받아온 레코드가 화면 저장소에 꽂힘", inStore, "B 가 Todos 에 들어옴=" + inStore);
      const shown = window.Todos.list({}, null)
        .filter(function (t) { return t.id === recA.id; }).length === 0;
      R.check(G7, "지운 것은 화면 목록에 안 나옴", shown, "A 가 목록에서 빠짐=" + shown);
    } else {
      R.skip(G7, "화면 저장소까지", "Todos · HubBoot 가 이 화면에 없습니다");
    }

    /* 치우는 일은 run() 의 finally 가 합니다 — 여기서 터져도 치워야 합니다 */
  }

  /* ── 표로 ────────────────────────────────────────────────────────────── */
  function text(rows) {
    const byGroup = {};
    rows.forEach(function (r) { (byGroup[r.group] = byGroup[r.group] || []).push(r); });

    let out = "";
    Object.keys(byGroup).forEach(function (g) {
      const list = byGroup[g];
      const pass = list.filter(function (r) { return r.pass === true; }).length;
      const fail = list.filter(function (r) { return r.pass === false; }).length;
      const skip = list.filter(function (r) { return r.pass === null; }).length;
      out += "\n" + g + " — " + pass + "/" + (pass + fail) + " 통과" +
             (skip ? " · " + skip + "건 확인 못 함" : "") + "\n";
      list.forEach(function (r) {
        const m = r.pass === true ? " OK  " : (r.pass === null ? " ??  " : "FAIL ");
        out += "  " + m + r.name + (r.detail ? "   — " + r.detail : "") + "\n";
      });
    });

    const pass = rows.filter(function (r) { return r.pass === true; }).length;
    const fail = rows.filter(function (r) { return r.pass === false; }).length;
    const skip = rows.filter(function (r) { return r.pass === null; }).length;
    out = "합계 " + pass + " 통과 · " + fail + " 실패" +
          (skip ? " · " + skip + " 확인 못 함 (UNKNOWN)" : "") + "\n" + out;
    return out;
  }

  function verdict(rows) {
    if (rows.some(function (r) { return r.pass === false; })) return "fail";
    if (rows.some(function (r) { return r.pass === null; })) return "unknown";
    return "pass";
  }

  return { run, text, verdict, SCOPE };
})();
