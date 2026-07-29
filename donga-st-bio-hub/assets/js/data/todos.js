/* ==========================================================================
   todos.js — 오늘 할 일

   대시보드의 Quick Action Card 가 읽는 목록입니다. 두 종류를 한 줄로 섞습니다.

     auto  시스템이 아는 것 — 미입력 데이터 · 확인 대기 의뢰 · 접수 대기 의뢰
           · 기한 임박 일정 · 자재 경고. 사용자가 만들지 않았고 지울 수도
           없습니다. 원인이 사라지면 목록에서도 사라집니다.
     user  사용자가 적은 것 — "B2401 Sampling", "Column Elution 진행" 처럼
           시스템이 알 수 없는 실제 작업.

   ── 체크했을 때 무슨 일이 일어나는가 ────────────────────────────────────
   항목 종류에 따라 다릅니다. 같은 체크박스가 다른 뜻이면 안 되므로,
   각 항목이 자기 action 을 들고 있습니다.

     user            done 토글 (되돌리기 가능)
     approve         분석 의뢰를 "확인 완료" 로 전환 — 대시보드에서 처리하는
                     유일한 상태 전환입니다. 접수·시험 중 같은 앞 단계는
                     EBR > 분석 및 시료 관리에서 다룹니다. 대시보드에서 전
                     단계를 다 넘기게 하면 실수로 넘기기 쉽습니다.
     goto            체크가 아니라 이동. 미입력 데이터처럼 "여기서 끝낼 수
                     없는" 일은 체크박스를 주지 않습니다 — 누르면 끝난 것처럼
                     보이는데 실제로는 아무것도 안 끝나기 때문입니다.
   ========================================================================== */

window.Todos = (function () {
  "use strict";

  const KEY = "hub.todos.v1";

  const subs = [];
  let state;

  function load() {
    try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function emit() { save(); subs.slice().forEach(fn => { try { fn(state); } catch (e) {} }); }
  function subscribe(fn) {
    subs.push(fn);
    return () => { const i = subs.indexOf(fn); if (i > -1) subs.splice(i, 1); };
  }

  const now = () => window.Entries ? window.Entries.stamp() : new Date().toISOString().slice(0, 19);
  const who = () => window.Entries ? window.Entries.who() : "—";
  const today = () => window.HubCalendar ? window.HubCalendar.today() : now().slice(0, 10);

  let seq = 0;
  const uid = () => "TD-" + Date.now().toString(36) + "-" + (++seq);

  /* 시연용 — 화면이 비어 있으면 무엇을 적는 칸인지 알 수 없습니다.
     시스템이 알 수 없는 "실제 작업" 예시를 둡니다. */
  function seed() {
    const t = today();
    return [
      { id: "TD-SEED-1", text: "B123-9 Day 7 Sampling", team: "upstream",
        due: t, done: false, createdBy: "김민수", createdAt: t + "T08:10:00" },
      { id: "TD-SEED-2", text: "CEX Column Elution 진행 (B045-2)", team: "downstream",
        due: t, done: false, createdBy: "이정호", createdAt: t + "T08:20:00" },
      { id: "TD-SEED-3", text: "SEC 컬럼 시스템 적합성 확인", team: "analytics",
        due: t, done: true, createdBy: "정하은", createdAt: t + "T07:50:00",
        doneAt: t + "T09:05:00" }
    ];
  }

  const stored = load();
  state = stored && stored.list ? stored : { list: seed() };
  if (!stored) save();

  /* ── 직접 추가한 할 일 ──────────────────────────────────────────────── */
  function userTodos(team) {
    return state.list
      .filter(t => !team || t.team === team)
      .map(t => Object.assign({}, t, {
        kind: "user", action: "toggle",
        label: t.text,
        badge: t.done ? "완료" : null
      }));
  }

  function add(input) {
    const text = String(input.text || "").trim();
    if (!text) return { ok: false, reason: "할 일 내용을 입력하세요" };
    const rec = {
      id: uid(), text: text,
      team: input.team || null,
      due: input.due || today(),
      done: false, createdBy: who(), createdAt: now()
    };
    state.list.push(rec);
    emit();
    return { ok: true, todo: rec };
  }

  function toggle(id) {
    const t = state.list.find(x => x.id === id);
    if (!t) return { ok: false };
    t.done = !t.done;
    t.doneAt = t.done ? now() : null;
    t.doneBy = t.done ? who() : null;
    emit();
    return { ok: true, todo: t };
  }

  function remove(id) {
    state.list = state.list.filter(x => x.id !== id);
    emit();
  }

  /* ── 자동 도출 ──────────────────────────────────────────────────────────
     원인이 해결되면 이 목록에서 저절로 빠집니다. 그래서 "완료 처리"라는
     개념이 없고, 대신 할 일이 있는 화면으로 보냅니다. */
  function autoTodos(sel) {
    const out = [];
    const R = window.Repo, Q = window.Requests, H = window.HubCalendar;
    const s = sel || {};

    /* 1. 확인 대기 의뢰 — 결과가 올라왔고 의뢰자가 받아들이면 끝나는 것.
          대시보드에서 바로 처리할 수 있는 유일한 승인입니다. */
    if (Q) {
      Q.forSelection(s).filter(r => r.status === "reported").forEach(function (r) {
        out.push({
          id: "auto-approve-" + r.id, kind: "auto", action: "approve",
          refId: r.id, team: "analytics",
          label: r.id + " 결과 확인 · " + r.purpose,
          note: "분석 결과가 등록됐습니다 — 확인하면 종료됩니다",
          badge: "승인 대기", tone: "accent",
          due: r.dueAt || null
        });
      });

      /* 2. 접수 대기 의뢰 — 분석팀이 받아야 할 것. 여기서 접수까지 하면
            시료를 실제로 받았는지 확인 없이 상태가 바뀝니다. 이동만 시킵니다. */
      const waiting = Q.forSelection(s).filter(r => r.status === "requested");
      if (waiting.length) {
        out.push({
          id: "auto-accept", kind: "auto", action: "goto",
          href: "ebr.html#requests", team: "analytics",
          label: "분석 의뢰 접수 " + waiting.length + "건",
          note: waiting.map(r => r.id).join(", ") + " — 시료 수령 후 접수하세요",
          badge: "접수 대기", tone: "warn",
          due: waiting.map(r => r.dueAt).filter(Boolean).sort()[0] || null
        });
      }

      /* 3. 기한 초과 의뢰 */
      const over = Q.forSelection(s).filter(function (r) {
        const d = Q.due(r);
        return d && d.state === "over";
      });
      if (over.length) {
        out.push({
          id: "auto-overdue", kind: "auto", action: "goto",
          href: "ebr.html#requests", team: null,
          label: "기한 초과 의뢰 " + over.length + "건",
          note: over.map(r => r.id).join(", "),
          badge: "기한 초과", tone: "risk", due: null
        });
      }
    }

    /* 4. 미입력 데이터 — 팀별로 한 줄씩. 격자를 없앴으니 EBR 로 보냅니다. */
    if (R && window.DATA_TEAMS) {
      const ids = s.scopeId ? R.studiesInScope(s).map(x => x.id) : null;
      const batches = window.DATA_BATCHES.filter(b => !ids || ids.indexOf(b.studyId) > -1);
      window.DATA_TEAMS.forEach(function (t) {
        const groups = window.DATA_ANALYTE_GROUPS.filter(g => g.team === t.id && !g.empty);
        if (!groups.length) return;
        const c = R.completeness(batches, groups);
        const missing = c.total - c.filled;
        if (!missing) return;
        out.push({
          id: "auto-empty-" + t.id, kind: "auto", action: "goto",
          href: "ebr.html", team: t.id,
          label: t.ko + " 미입력 " + missing + "건",
          note: "EBR 입력에서 채우세요 (" + c.filled + "/" + c.total + " 완료)",
          badge: null, tone: null, due: null
        });
      });
    }

    /* 5. 오늘·지난 일정 */
    if (H) {
      const t = today();
      const dueToday = H.upcoming(20).filter(e => e.date === t && e.kind !== "culture");
      dueToday.forEach(function (e) {
        out.push({
          id: "auto-cal-" + e.id, kind: "auto", action: "goto",
          href: "schedule.html", team: null,
          label: e.ko,
          note: "오늘 일정",
          badge: (H.KIND[e.kind] || {}).ko || null, tone: null, due: e.date
        });
      });
    }

    /* 6. 자재 경고 */
    if (window.Lots) {
      window.Lots.current().forEach(function (l) {
        const ex = window.Lots.expiry(l);
        const u = window.Lots.usage(l);
        const bad = ex && ex.state !== "ok";
        const heavy = u && u.limit && u.used / u.limit >= 0.8;
        if (!bad && !heavy) return;
        out.push({
          id: "auto-lot-" + l.id, kind: "auto", action: "goto",
          href: "ebr.html", team: l.team,
          label: l.name + " " + l.lotNo + " 확인",
          note: bad
            ? (ex.state === "expired" ? "유효기간 " + (-ex.days) + "일 지남" : "유효기간 D-" + ex.days)
            : u.used + " / " + u.limit + " " + u.unit + " 사용",
          badge: bad ? "유효기간" : "사용 한도", tone: bad && ex.state === "expired" ? "risk" : "warn",
          due: null
        });
      });
    }

    return out;
  }

  /* 한 목록으로 — 급한 것이 위로 옵니다.
     승인 대기가 맨 위인 이유: 남이 기다리고 있는 일이기 때문입니다. */
  const RANK = { risk: 0, accent: 1, warn: 2 };
  function list(sel, team) {
    const auto = autoTodos(sel).filter(t => !team || !t.team || t.team === team);
    const mine = userTodos(team);
    const score = t => {
      if (t.kind === "user") return t.done ? 90 : 50;
      if (t.action === "approve") return 5;
      return 10 + (RANK[t.tone] !== undefined ? RANK[t.tone] : 5);
    };
    return auto.concat(mine).sort(function (a, b) {
      const d = score(a) - score(b);
      if (d) return d;
      return String(a.due || "9999").localeCompare(String(b.due || "9999"));
    });
  }

  /* 체크 처리 — 항목이 들고 있는 action 대로 */
  function check(item) {
    if (!item) return { ok: false };
    if (item.action === "toggle") return toggle(item.id);
    if (item.action === "approve") {
      const r = window.Requests.advance(item.refId, "closed", "대시보드에서 결과 확인");
      return r.ok ? { ok: true, approved: item.refId } : r;
    }
    return { ok: false, reason: "이 항목은 여기서 완료할 수 없습니다" };
  }

  function counts(sel, team) {
    const all = list(sel, team);
    return {
      total: all.length,
      open: all.filter(t => !(t.kind === "user" && t.done)).length,
      approve: all.filter(t => t.action === "approve").length,
      done: all.filter(t => t.kind === "user" && t.done).length
    };
  }

  function reset() { state = { list: seed() }; emit(); }

  return { list, counts, add, toggle, remove, check, subscribe, reset, state: () => state };
})();
