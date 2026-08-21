/* ==========================================================================
   meeting-stats.js — 회의용 계산  ·  window.MeetingStats

   두 가지를 계산합니다.

     1) 통계적 이탈 (±2SD)
        규격표가 없어 Pass/Fail 은 판정할 수 없습니다. 대신 "같은 Study 안에서
        이 값이 얼마나 떨어져 있는가"는 데이터만으로 계산됩니다. 지어낸 기준이
        아니라 그 Study 자신의 분포라서, 근거를 대고 짚을 수 있습니다.

        ⚠ 이건 규격 이탈이 아닙니다. 화면에도 그렇게 씁니다.

     2) 회의 전 브리핑
        지난 회의가 끝난 뒤 이 시스템에서 실제로 바뀐 것만 모읍니다.
        원본 배치 데이터는 정적이라 "새 배치"는 생기지 않습니다. 대신 사람이
        만든 변화(EBR 입력 · 조치 완료 · 새 사례 · 핀 붙은 값의 수정)를 봅니다.

        그중 가장 중요한 것은 **지난 회의에서 지적한 값이 그 뒤 수정됐는지**
        입니다. 회의의 지적이 반영됐는지를 사람이 기억으로 확인하고 있으면
        결국 아무도 확인하지 않게 됩니다.
   ========================================================================== */

window.MeetingStats = (function () {
  "use strict";

  const num = (v) => typeof v === "number" && isFinite(v);

  /* 표본이 적으면 표준편차 자체가 못 믿을 값이 됩니다.
     n<5 인 Study 는 이탈 계산에서 통째로 뺍니다 — 3건짜리 묶음에서 뽑은
     "2SD 이탈"은 통계가 아니라 우연입니다. */
  const MIN_N = 5;
  const Z = 2;

  function stats(vals) {
    const n = vals.length;
    if (n < 2) return null;
    const mean = vals.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(vals.reduce((a, v) => a + (v - mean) * (v - mean), 0) / (n - 1));
    return { n, mean, sd };
  }

  /* ══════════════════════════════════════════════════════════════════════
     1. ±2SD 이탈
     ══════════════════════════════════════════════════════════════════════ */
  function outliers(batches, opts) {
    const o = opts || {};
    const z = o.z || Z;
    const groups = (window.DATA_ANALYTE_GROUPS || []).filter(g => !g.empty && g.items.length);
    const list = (batches || []).filter(b => b && b.active !== false);
    if (!list.length) return [];

    /* Study 단위로 묶습니다 — 서로 다른 Study 를 한 분포로 보면 Study 간
       차이가 전부 "이탈"로 보입니다. */
    const byStudy = {};
    list.forEach(b => { (byStudy[b.studyId] = byStudy[b.studyId] || []).push(b); });

    const out = [];
    Object.keys(byStudy).forEach(function (sid) {
      const bs = byStudy[sid];
      if (bs.length < MIN_N) return;
      const study = (window.DATA_STUDIES || []).find(s => s.id === sid);

      groups.forEach(g => g.items.forEach(function (it) {
        const pairs = bs.map(b => ({ b: b, v: window.Repo.valueOf(b, g.id, it.key) }))
                        .filter(p => num(p.v));
        if (pairs.length < MIN_N) return;
        const s = stats(pairs.map(p => p.v));
        if (!s || s.sd === 0) return;                 // 전부 같은 값이면 이탈이 없습니다

        pairs.forEach(function (p) {
          const zz = (p.v - s.mean) / s.sd;
          if (Math.abs(zz) < z) return;
          out.push({
            batchId: p.b.id, batchLabel: p.b.expNo || p.b.id,
            studyId: sid, studyName: study ? study.name : sid,
            groupId: g.id, itemKey: it.key, label: it.label,
            unit: it.unit || "", dp: it.dp, team: g.team,
            value: p.v, mean: s.mean, sd: s.sd, z: zz, n: s.n,
            dir: zz > 0 ? "high" : "low"
          });
        });
      }));
    });

    /* 많이 벗어난 순 — 회의에서 위에서부터 짚습니다 */
    out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
    return o.limit ? out.slice(0, o.limit) : out;
  }

  /* 한 배치의 이탈만 (동기화 카드 · 표에서 표식을 붙일 때) */
  function outlierMap(batches) {
    const m = {};
    outliers(batches).forEach(function (x) {
      m[x.batchId + "|" + x.groupId + "." + x.itemKey] = x;
    });
    return m;
  }

  /* ══════════════════════════════════════════════════════════════════════
     2. 회의 전 브리핑
     ══════════════════════════════════════════════════════════════════════ */

  /* "2026-08-21T09:30:00" 같은 문자열을 비교 가능하게 — 전부 같은 모양이라
     문자열 비교로 충분합니다 (Date 파싱은 표준시 문제를 부릅니다). */
  function iso(s) { return String(s || "").replace(" ", "T"); }
  function after(a, b) { return iso(a) > iso(b); }

  function lastEndedMeeting(exceptId) {
    if (!window.Pins) return null;
    return window.Pins.meetings()
      .filter(m => m.id !== exceptId && m.endedAt)
      .sort((a, b) => iso(b.endedAt).localeCompare(iso(a.endedAt)))[0] || null;
  }

  function briefing(opts) {
    const o = opts || {};
    const P = window.Pins;
    const prev = o.since ? { endedAt: o.since, title: o.sinceTitle || null }
                         : lastEndedMeeting(o.exceptMeetingId);
    const since = prev ? iso(prev.endedAt) : null;

    const res = {
      previous: prev, since: since,
      entries: [], actionsDone: [], actionsOpen: [], newIssues: [], pinnedChanged: [],
      hasPrevious: !!prev
    };

    /* ── EBR 입력 변화 ── */
    const ev = (window.Entries && window.Entries.state && window.Entries.state().values) || {};
    Object.keys(ev).forEach(function (k) {
      const rec = ev[k];
      if (!rec) return;
      const at = rec.updatedAt || rec.createdAt;
      if (since && !after(at, since)) return;
      const parts = String(k).split("|");
      res.entries.push({
        scope: parts[0], field: parts[1],
        at: at, by: rec.updatedBy || rec.createdBy,
        edited: !!(rec.history && rec.history.length)
      });
    });
    res.entries.sort((a, b) => iso(b.at).localeCompare(iso(a.at)));

    /* ── 조치 ── */
    if (P) {
      const todos = (window.Todos && window.Todos.state && window.Todos.state().list) || [];
      const byId = {};
      todos.forEach(t => { byId[t.id] = t; });
      P.notes().filter(n => n.kind === "action").forEach(function (n) {
        const t = n.todoId ? byId[n.todoId] : null;
        const done = t ? !!t.done : false;
        (done ? res.actionsDone : res.actionsOpen).push(
          Object.assign({}, n, { done: done, missing: !t, due: n.due || (t ? t.due : null) }));
      });
      res.actionsOpen.sort((a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999")));
    }

    /* ── 새 트러블슈팅 사례 ── */
    if (window.Issues && window.Issues.all) {
      res.newIssues = window.Issues.all().filter(i => !since || after(i.createdAt, since));
    }

    /* ── 지난 회의에서 지적한 값이 그 뒤 수정됐는가 ──
       회의의 지적이 실제로 반영됐는지를 시스템이 확인해 줍니다. */
    if (P) {
      P.all().forEach(function (p) {
        const fk = P.fieldKeyOf(p);
        /* 값은 배치 또는 시료 범위에 저장됩니다 — 두 경우를 모두 봅니다 */
        const cands = [p.batchId + "|" + fk].concat(p.sampleId ? [p.sampleId + "|" + fk] : []);
        cands.forEach(function (k) {
          const rec = ev[k];
          if (!rec) return;
          const at = rec.updatedAt || rec.createdAt;
          if (!after(at, p.createdAt)) return;
          res.pinnedChanged.push({
            pin: p, at: at, by: rec.updatedBy || rec.createdBy,
            now: rec.value, was: p.value
          });
        });
      });
    }

    res.total = res.entries.length + res.actionsDone.length + res.newIssues.length + res.pinnedChanged.length;
    return res;
  }

  return { outliers, outlierMap, briefing, lastEndedMeeting, stats, MIN_N, Z };
})();
