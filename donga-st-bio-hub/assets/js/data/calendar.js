/* ==========================================================================
   calendar.js — 일정 단일 소스 (HubCalendar)

   대시보드 · 데이터 탐색 · 일정 관리가 **같은 일정 목록**을 봅니다.
   예전에는 화면마다 자기 방식으로 일정을 만들어서, 우측 캘린더에 찍힌 점과
   일정 관리 화면의 타임라인이 서로 달랐습니다. 그 사본들을 여기로 모읍니다.

   ── 일정 출처 4가지 ────────────────────────────────────────────────────
     excel   Excel 파생 — Batch 의 Initial Date(배양 시작) / End Date(Harvest),
                          Study 종료일
     plan    생성 일정  — 현재 시점 기준 회의 · Study 마감 (아래 설명 참고)
     user    직접 등록  — 일정 관리 화면에서 추가한 일정 (localStorage)
     legacy  레거시     — 장비 예약 등 store.js 가 관리하는 일정.
                          store.js 를 싣는 화면(장비 예약 · 데이터 탐색 · DoE)
                          에서만 합쳐집니다.

   ── 생성 일정(plan)의 근거 ──────────────────────────────────────────────
   Excel 데이터는 2024-08 ~ 2025-01 로 전부 과거입니다. 그대로 두면 이번 달
   캘린더가 텅 비어 화면을 볼 수 없습니다. 그래서 원본의 공정 리듬을 읽어
   현재 시점 기준으로 회의와 마감을 배치합니다.

     배양 주기  = 원본 배치들의 평균 배양 일수 (13~14일)
     검토 주기  = 배양 주기 × 3
                  (배양 → 정제 → 분석 세 팀이 한 바퀴 도는 데 걸리는 기간)

   생성 일정은 실제 확정 일정이 아니라 위 리듬을 현재로 옮긴 것입니다.
   같은 날짜가 항상 나오도록 난수를 쓰지 않고 달력 규칙으로만 계산합니다.
   ========================================================================== */

window.HubCalendar = (function () {
  "use strict";

  const UKEY = "hub.schedule.v2";        // 일정 관리 화면이 쓰는 저장소와 동일

  const KIND = {
    culture:   { ko: "배양",      color: "var(--c-accent)" },
    harvest:   { ko: "Harvest",   color: "#6D28D9" },
    analysis:  { ko: "분석",      color: "#0F766E" },
    meeting:   { ko: "회의",      color: "#B45309" },
    deadline:  { ko: "마감",      color: "var(--c-risk)" },
    milestone: { ko: "마일스톤",  color: "var(--c-navy-600)" },
    booking:   { ko: "장비 예약", color: "#B45309" }
  };

  /* ── 날짜 유틸 ──────────────────────────────────────────────────────────
     전부 로컬 시각 기준입니다. toISOString() 은 UTC 로 바꿔버려서 한국에서는
     매일 9시간 동안 하루 전 날짜가 나옵니다 — 일정에는 치명적입니다. */
  const pad = n => String(n).padStart(2, "0");
  const iso = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  function parse(s) { const p = String(s).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
  function today() { return iso(new Date()); }
  function monthStart(s) { const d = parse(s); return iso(new Date(d.getFullYear(), d.getMonth(), 1)); }

  /* s 이후(당일 포함) 처음 오는 요일. dow: 0=일 … 6=토 */
  function onOrAfterDow(s, dow) {
    const d = parse(s);
    d.setDate(d.getDate() + ((dow - d.getDay() + 7) % 7));
    return iso(d);
  }
  /* 해당 월의 마지막 요일 (예: 마지막 금요일) */
  function lastDowOfMonth(y, m1, dow) {
    const d = new Date(y, m1, 0);                    // m1 은 1-based → 다음 달 0일 = 이번 달 말일
    while (d.getDay() !== dow) d.setDate(d.getDate() - 1);
    return iso(d);
  }

  /* ── 원본에서 읽어낸 공정 리듬 ──────────────────────────────────────── */
  function cadence() {
    const days = (window.DATA_BATCHES || [])
      .map(b => b.cultureDays).filter(v => v !== null && isFinite(v));
    const culture = days.length
      ? Math.round(days.reduce((a, c) => a + c, 0) / days.length) : 14;
    return { culture, review: culture * 3 };
  }

  /* ── 1. Excel 파생 ──────────────────────────────────────────────────── */
  function excelEvents() {
    const out = [];
    const studyById = {};
    (window.DATA_STUDIES || []).forEach(s => { studyById[s.id] = s; });

    (window.DATA_BATCHES || []).forEach(b => {
      const st = studyById[b.studyId];
      const prj = st ? st.projectId : null;
      if (b.initialDate) out.push({
        id: b.id + "#inoc", date: b.initialDate, ko: b.id + " 배양 시작",
        kind: "culture", src: "excel", projectId: prj, studyId: b.studyId, ref: b.id
      });
      if (b.endDate) out.push({
        id: b.id + "#harvest", date: b.endDate, ko: b.id + " Harvest",
        kind: "harvest", src: "excel", projectId: prj, studyId: b.studyId, ref: b.id
      });
    });

    (window.DATA_STUDIES || []).forEach(s => {
      if (!s.endDate) return;
      out.push({
        id: s.id + "#end", date: s.endDate, ko: s.name + " 종료",
        kind: "milestone", src: "excel", projectId: s.projectId, studyId: s.id, ref: s.id
      });
    });
    return out;
  }

  /* ── 2. 생성 일정 ───────────────────────────────────────────────────── */

  /* 과제별 주간 회의 요일 — 두 과제가 같은 날 겹치지 않도록 나눕니다. */
  const WEEKLY_DOW = [2, 4];               // 화요일 · 목요일
  const WEEKS_AHEAD = 16;
  const MONTHS_AHEAD = 4;

  function plannedEvents() {
    const projects = window.DATA_PROJECTS || [];
    const studies = window.DATA_STUDIES || [];
    if (!projects.length) return [];

    const c = cadence();
    const base = monthStart(today());       // 이번 달 1일부터 생성
    const out = [];

    projects.forEach(function (p, pi) {
      const code = p.code || p.name;

      /* 주간 공정개발 회의 */
      let d = onOrAfterDow(base, WEEKLY_DOW[pi % WEEKLY_DOW.length]);
      for (let w = 0; w < WEEKS_AHEAD; w++) {
        out.push({
          id: "plan-wk-" + p.id + "-" + d, date: d,
          ko: code + " 주간 공정개발 회의",
          kind: "meeting", src: "plan", projectId: p.id, studyId: null
        });
        d = addDays(d, 7);
      }

      /* Study 마감 + 그 앞의 중간 점검 회의 */
      studies.filter(s => s.projectId === p.id).forEach(function (s, si) {
        /* 검토 주기를 Study 수만큼 순차 배치하고 금요일로 맞춥니다 —
           보고 마감은 주 중간보다 주말 직전에 두는 편이 현실에 가깝습니다. */
        const due = onOrAfterDow(addDays(base, c.review * (si + 1)), 5);
        out.push({
          id: "plan-due-" + s.id, date: due,
          ko: s.name + " 결과보고 마감",
          kind: "deadline", src: "plan", projectId: p.id, studyId: s.id
        });
        out.push({
          id: "plan-mid-" + s.id, date: addDays(due, -c.culture),
          ko: s.name + " 중간 점검 회의",
          kind: "meeting", src: "plan", projectId: p.id, studyId: s.id
        });
      });
    });

    /* 월간 CMC 운영위원회 — 전 과제 공통이라 projectId 를 비웁니다.
       (projectId 가 null 인 일정은 어느 과제를 보고 있어도 함께 표시됩니다) */
    const b = parse(base);
    for (let m = 0; m < MONTHS_AHEAD; m++) {
      const dt = new Date(b.getFullYear(), b.getMonth() + m, 1);
      const date = lastDowOfMonth(dt.getFullYear(), dt.getMonth() + 1, 5);
      out.push({
        id: "plan-cmc-" + date, date: date,
        ko: "월간 CMC 운영위원회",
        kind: "meeting", src: "plan", projectId: null, studyId: null
      });
    }
    return out;
  }

  /* ── 3. 사용자 등록 ─────────────────────────────────────────────────── */

  /* 일정 관리 화면은 scopeKey 를 "project:PRJ-1234" 형태로 저장합니다.
     그 표기를 여기서 projectId 로 정규화해 다른 화면도 그대로 읽게 합니다. */
  function normProject(scopeKey) {
    if (!scopeKey) return null;
    const i = String(scopeKey).indexOf(":");
    return i > -1 ? scopeKey.slice(i + 1) : scopeKey;
  }

  function rawUserEvents() {
    try { return JSON.parse(localStorage.getItem(UKEY) || "[]"); } catch (e) { return []; }
  }
  function saveUserEvents(list) {
    try { localStorage.setItem(UKEY, JSON.stringify(list)); } catch (e) {}
  }
  function userEvents() {
    return rawUserEvents().map(e => Object.assign({}, e, {
      src: "user", projectId: normProject(e.scopeKey), studyId: e.studyId || null
    }));
  }
  function addUserEvent(ev) {
    const list = rawUserEvents();
    list.push(ev);
    saveUserEvents(list);
    return ev;
  }
  function removeUserEvent(id) {
    saveUserEvents(rawUserEvents().filter(x => x.id !== id));
  }

  /* ── 4. 레거시 (store.js) ───────────────────────────────────────────── */
  function legacyEvents() {
    const S = window.Store;
    if (!S || typeof S.eventsBetween !== "function") return [];
    try {
      /* 앞뒤 1년이면 미니 캘린더가 훑는 범위를 충분히 덮습니다 */
      const from = addDays(today(), -365), to = addDays(today(), 365);
      return S.eventsBetween(from, to).map(e => Object.assign({}, e, {
        src: "legacy", projectId: null, studyId: null
      }));
    } catch (e) { return []; }
  }

  /* ── 합치기 ─────────────────────────────────────────────────────────── */
  function all() {
    const t = today();
    /* 상태는 날짜에서 파생합니다. 이미 status 가 있는 일정(레거시 예약 등)은
       그쪽 값을 존중합니다. */
    const stamp = e => e.status ? e : Object.assign({}, e, {
      status: e.date < t ? "완료" : e.date === t ? "오늘" : "예정"
    });
    return excelEvents()
      .concat(plannedEvents(), userEvents(), legacyEvents())
      .map(stamp)
      .sort((a, b) => a.date.localeCompare(b.date) || String(a.ko).localeCompare(String(b.ko)));
  }

  /* 선택 범위로 거르기.
     projectId 가 null 인 일정(전사 회의 · 레거시)은 항상 통과시킵니다 —
     특정 과제를 보고 있다고 전사 회의가 사라지면 안 됩니다. */
  function filterBy(events, opt) {
    const o = opt || {};
    return events.filter(function (e) {
      if (o.projectId && e.projectId && e.projectId !== o.projectId) return false;
      if (o.studyId && e.studyId && e.studyId !== o.studyId) return false;
      /* Study 를 콕 집어 봤을 때, 그 Study 와 무관한 배치 일정은 뺍니다 */
      if (o.studyId && !e.studyId && e.src === "excel") return false;
      return true;
    });
  }

  function forProject(projectId) { return filterBy(all(), { projectId }); }

  /* window.Scope 가 있는 화면은 현재 선택을 그대로 반영합니다.
     Scope 를 싣지 않는 화면(데이터 탐색 등)에서는 전체 일정을 보여줍니다. */
  function currentOpt() {
    if (!window.Scope || typeof window.Scope.get !== "function") return {};
    const s = window.Scope.get();
    return { projectId: s.scopeId || null, studyId: s.studyId || null };
  }

  function forSelection() { return filterBy(all(), currentOpt()); }

  function eventsOn(date, opt) {
    return filterBy(all(), opt || currentOpt()).filter(e => e.date === date);
  }

  function upcoming(n, opt) {
    const t = today();
    return filterBy(all(), opt || currentOpt())
      .filter(e => e.date >= t).slice(0, n || 5);
  }

  /* 생성 일정까지 포함한 전체 기간 — 간트 축을 미래까지 늘릴 때 씁니다 */
  function range(events) {
    const list = (events || all()).map(e => e.date).filter(Boolean).sort();
    return list.length ? { min: list[0], max: list[list.length - 1] } : null;
  }

  /* ── shell2 우측 레일 어댑터 ────────────────────────────────────────────
     레일은 { today, eventsOn, oosItems } 만 요구합니다. 레거시 Store 와
     같은 모양으로 맞춰 두면 레일 코드에 분기를 넣지 않아도 됩니다. */
  function railSource() {
    return {
      today: today,
      eventsOn: function (date) { return eventsOn(date); },
      oosItems: function () {
        /* 규격(spec) 한계값이 원본에 없어 Fail 판정 근거가 없습니다.
           근거 없이 Fail 을 만들지 않고 빈 배열을 돌려줍니다. */
        return [];
      }
    };
  }

  return {
    KIND, today, addDays, parse, iso, monthStart, cadence,
    all, forProject, forSelection, eventsOn, upcoming, range, filterBy,
    userEvents, addUserEvent, removeUserEvent,
    railSource
  };
})();
