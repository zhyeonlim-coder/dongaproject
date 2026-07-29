/* ==========================================================================
   issues.js — 이상 기록 · 트러블슈팅 사례집

   성공한 실험보다 **실패와 그 원인**이 재사용 가치가 큽니다. "HCP가 갑자기
   튀었을 때", "생존율이 예상보다 빨리 떨어질 때" — 이 지식은 지금 개인
   노트에 적히고, 그 사람이 부서를 옮기면 사라집니다.

   ── 한 번만 쓰고 두 번 쓰이게 ─────────────────────────────────────────
   기록하는 사람은 **배치에서 이상을 적을 뿐**입니다. 사례집을 따로 쓰지
   않습니다. 같은 레코드가 두 방향으로 읽힙니다.

     배치에서 보면   "이 배치에 무슨 일이 있었나"
     사례집에서 보면 "이 증상일 때 남들은 어떻게 했나"

   따로 관리하면 아무도 사례집을 채우지 않습니다.

   ── 다섯 칸 ────────────────────────────────────────────────────────────
     현상 · 추정 원인 · 조치 · 결과 · 재발 방지
   원인과 조치를 나눈 이유는, 조치가 통했는지(결과)를 따로 남겨야 다음
   사람이 그 조치를 믿을지 판단할 수 있기 때문입니다.

   ── 공개 범위 ──────────────────────────────────────────────────────────
   초안(draft)은 작성 팀 안에서만 보입니다. 확정해 공개(published)해야
   전 연구소에 보입니다. 확정 전 판단을 적는 부담을 줄이면서, 공개된
   사례의 신뢰도는 높이기 위해서입니다.
   ========================================================================== */

window.Issues = (function () {
  "use strict";

  const KEY = "hub.issues.v1";

  const SEVERITY = {
    high: { ko: "높음", tone: "risk", hint: "배치 폐기·재시험 등 결과에 영향" },
    mid:  { ko: "중간", tone: "warn", hint: "해석에 주의가 필요" },
    low:  { ko: "낮음", tone: "info", hint: "기록해 둘 만한 관찰" }
  };

  const STATUS = {
    investigating: { ko: "조사 중",   tone: "warn" },
    resolved:      { ko: "해결",     tone: "ok" },
    unresolved:    { ko: "원인 미상", tone: "risk" }
  };

  const VISIBILITY = {
    team: { ko: "팀 내부 초안", hint: "작성 팀에서만 보입니다" },
    all:  { ko: "전체 공개",    hint: "세 팀 모두에게 보입니다" }
  };

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
  const addDays = (d, n) => window.HubCalendar ? window.HubCalendar.addDays(d, n) : d;

  let seq = 0;
  const uid = () => "ISS-" + Date.now().toString(36) + "-" + (++seq);

  /* ── 시연용 초기 사례 ──────────────────────────────────────────────────
     실제 적재된 데이터에서 눈에 띄는 값을 근거로 삼았습니다. 지어낸
     사건이 아니라 "이 수치를 보고 사람이 남겼을 법한 기록"입니다.
       UNSPEC-01  Harvest Viability 59.7% — 전 배치 중 최저
       B123-x     High mannose 14.8% — 전 배치 중 최고
       정제       HCP 가 유독 높게 나온 배치 */
  function seed() {
    const t = today();
    return [
      {
        id: "ISS-SEED-1", batchId: "UNSPEC-01", sampleId: null,
        studyId: "STD-0045", team: "upstream",
        title: "배양 후기 생존율 급락 (Harvest 59.7%)",
        symptom: "Day 11 이후 생존율이 하루 8~10%p씩 떨어져 Harvest 시점 59.7%로 마감. " +
          "같은 Study 다른 배치는 63~70% 구간이었다.",
        cause: "Day 10 피드 이후 글루코스가 조기에 소진된 것으로 추정. " +
          "해당 일자 잔당 측정값이 없어 확정하지 못했다.",
        action: "Harvest 를 계획보다 하루 앞당겨 진행하고, 이후 배치부터 " +
          "Day 9·11 잔당 측정을 추가했다.",
        outcome: "후속 배치에서는 Harvest 생존율이 63% 이상으로 회복. " +
          "다만 이 배치의 HCP·잔류 DNA 는 다른 배치보다 높게 나왔다.",
        prevention: "생존율이 65% 아래로 내려가면 배양을 연장하지 않는다(SOP-UP-014 반영). " +
          "잔당은 격일이 아니라 후기에는 매일 측정한다.",
        severity: "high", status: "resolved", visibility: "all",
        tags: ["생존율", "피드", "글루코스", "Harvest", "HCP"],
        createdBy: "김민수", createdAt: addDays(t, -240) + "T17:10:00",
        updatedAt: addDays(t, -238) + "T09:00:00"
      },
      {
        id: "ISS-SEED-2", batchId: null, sampleId: null,
        studyId: "STD-0123", team: "analytics",
        title: "High mannose 함량이 특정 조건에서 두 배 이상 상승",
        symptom: "DoE 조건 중 일부 배치에서 High mannose 가 14~15% 로, " +
          "다른 배치(1~3%) 대비 크게 높게 검출되었다. 같은 시료를 재시험해도 재현되었다.",
        cause: "시험 오류가 아니라 배양 조건 차이로 판단. 해당 배치는 " +
          "Harvest 시점 생존율이 낮은 축에 속했고, 아푸코실화 형태도 함께 상승했다.",
        action: "분석팀에서 재시험으로 값 자체는 확인. 배양팀에 조건 정보를 요청해 " +
          "생존율·배지 Mn 농도와 대조했다.",
        outcome: "생존율이 낮은 조건일수록 High mannose 와 아푸코실화가 동시에 " +
          "올라가는 경향을 확인했다. 원인 물질까지 특정하지는 못했다.",
        prevention: "역가 단독 최적화 조건은 당쇄를 함께 확인하기 전에는 후속 검증에 " +
          "올리지 않는다. Mn 농도를 별도 요인으로 분리해 재평가 예정.",
        severity: "mid", status: "unresolved", visibility: "all",
        tags: ["N-glycan", "고만노스", "아푸코실화", "생존율", "DoE"],
        createdBy: "정하은", createdAt: addDays(t, -150) + "T11:25:00",
        updatedAt: addDays(t, -150) + "T11:25:00"
      },
      {
        id: "ISS-SEED-3", batchId: null, sampleId: null,
        studyId: "STD-0045", team: "downstream",
        title: "Protein A 용출 후 HCP 가 평소의 3배 이상",
        symptom: "동일 공정으로 진행했는데 Protein A 용출액의 HCP 가 평소 범위를 " +
          "크게 넘겼다. 후속 CEX 에서 대부분 제거되어 최종 규격에는 영향이 없었다.",
        cause: "Harvest 시점 생존율이 낮아 세포 파쇄가 늘었고, 그만큼 숙주세포단백질 " +
          "부하가 컸던 것으로 본다. 컬럼 자체는 사이클 여유가 남아 있었다.",
        action: "CEX 로딩 전 전도도를 조정하고, 세정 단계를 1회 추가했다.",
        outcome: "최종 HCP 는 규격 범위 안으로 들어왔으나 CEX 단계 수율이 약 3%p 떨어졌다.",
        prevention: "배양 생존율이 낮게 끝난 배치는 정제 전에 미리 공유받아 " +
          "세정 조건을 조정한 뒤 시작한다. 팀 간 인계 시 생존율을 필수 항목으로.",
        severity: "mid", status: "resolved", visibility: "team",
        tags: ["HCP", "Protein A", "CEX", "세정", "수율"],
        createdBy: "이정호", createdAt: addDays(t, -60) + "T15:40:00",
        updatedAt: addDays(t, -58) + "T10:05:00"
      }
    ];
  }

  const stored = load();
  state = stored && stored.list ? stored : { list: seed() };
  if (!stored) save();

  /* ── 조회 ───────────────────────────────────────────────────────────── */

  /* 볼 수 있는 것만. 초안은 작성 팀에게만 보입니다.
     "내 팀"은 현재 선택한 팀이 아니라 로그인 사용자의 소속이어야 맞지만,
     지금 계정에는 팀 필드가 없어 화면에서 고른 팀을 씁니다.
     계정에 소속이 들어오면 이 함수 하나만 바꾸면 됩니다. */
  function visibleTo(viewerTeam) {
    return state.list.filter(i =>
      i.visibility === "all" || (viewerTeam && i.team === viewerTeam));
  }

  function all() { return state.list.slice(); }
  function get(id) { return state.list.find(i => i.id === id) || null; }
  function forBatch(batchId) { return state.list.filter(i => i.batchId === batchId); }
  function forStudy(studyId) { return state.list.filter(i => i.studyId === studyId); }

  /* 증상으로 찾기 — 사례집의 본래 쓰임새.
     제목·현상·원인·조치·태그를 모두 훑습니다. 사람은 "HCP 높음" 처럼
     증상으로 검색하지, 제목을 정확히 기억하지 않습니다. */
  function search(term, viewerTeam) {
    const q = String(term || "").trim().toLowerCase();
    const pool = visibleTo(viewerTeam);
    if (!q) return pool;
    return pool.filter(i =>
      [i.title, i.symptom, i.cause, i.action, i.outcome, i.prevention,
       (i.tags || []).join(" ")].join(" ").toLowerCase().indexOf(q) > -1);
  }

  /* 사례집 상단에 띄울 태그 — 많이 달린 순 */
  function topTags(viewerTeam, n) {
    const count = {};
    visibleTo(viewerTeam).forEach(i => (i.tags || []).forEach(t => {
      count[t] = (count[t] || 0) + 1;
    }));
    return Object.keys(count)
      .sort((a, b) => count[b] - count[a])
      .slice(0, n || 12)
      .map(t => ({ tag: t, n: count[t] }));
  }

  /* ── 변경 ───────────────────────────────────────────────────────────── */
  function create(input) {
    const title = String(input.title || "").trim();
    const symptom = String(input.symptom || "").trim();
    if (!title) return { ok: false, reason: "제목을 입력하세요" };
    if (!symptom) return { ok: false, reason: "현상을 입력하세요 — 이게 나중에 검색되는 내용입니다" };

    const rec = {
      id: uid(),
      batchId: input.batchId || null,
      sampleId: input.sampleId || null,
      studyId: input.studyId || null,
      team: input.team || null,
      title: title,
      symptom: symptom,
      cause: String(input.cause || "").trim() || null,
      action: String(input.action || "").trim() || null,
      outcome: String(input.outcome || "").trim() || null,
      prevention: String(input.prevention || "").trim() || null,
      severity: SEVERITY[input.severity] ? input.severity : "mid",
      status: STATUS[input.status] ? input.status : "investigating",
      /* 새 기록은 항상 팀 내부 초안으로 시작합니다 */
      visibility: "team",
      tags: (input.tags || []).map(t => String(t).trim()).filter(Boolean),
      createdBy: who(), createdAt: now(), updatedAt: now()
    };
    state.list.push(rec);
    emit();
    return { ok: true, issue: rec };
  }

  function update(id, patch) {
    const r = get(id);
    if (!r) return { ok: false, reason: "기록을 찾을 수 없습니다" };
    ["title", "symptom", "cause", "action", "outcome", "prevention", "severity", "status"]
      .forEach(k => { if (patch.hasOwnProperty(k)) r[k] = patch[k]; });
    if (patch.tags) r.tags = patch.tags.map(t => String(t).trim()).filter(Boolean);
    r.updatedAt = now();
    r.updatedBy = who();
    emit();
    return { ok: true, issue: r };
  }

  /* 공개 — 조치와 결과가 비어 있으면 막습니다.
     "현상만 적힌 사례"는 검색에 걸려도 다음 사람에게 쓸모가 없습니다. */
  function publish(id) {
    const r = get(id);
    if (!r) return { ok: false, reason: "기록을 찾을 수 없습니다" };
    if (!r.action) return { ok: false, reason: "조치를 입력해야 공개할 수 있습니다" };
    if (!r.outcome) return { ok: false, reason: "조치 결과를 입력해야 공개할 수 있습니다" };
    r.visibility = "all";
    r.publishedBy = who();
    r.publishedAt = now();
    r.updatedAt = now();
    emit();
    return { ok: true, issue: r };
  }

  function unpublish(id) {
    const r = get(id);
    if (!r) return { ok: false, reason: "기록을 찾을 수 없습니다" };
    r.visibility = "team";
    r.updatedAt = now();
    emit();
    return { ok: true, issue: r };
  }

  function reset() { state = { list: seed() }; emit(); }

  return {
    SEVERITY, STATUS, VISIBILITY,
    all, get, forBatch, forStudy, search, topTags, visibleTo,
    create, update, publish, unpublish, subscribe, reset,
    state: () => state
  };
})();
