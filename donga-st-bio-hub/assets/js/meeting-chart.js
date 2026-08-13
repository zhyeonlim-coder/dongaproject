/* ==========================================================================
   meeting-chart.js — 회의 모드 전용 차트  ·  window.MeetingChart

   charts.js 를 건드리지 않고 따로 둡니다. 회의 모드에만 필요한 두 가지가
   있기 때문입니다.

     1) 조건 강조   막대 하나하나가 "조건 만족 / 벗어남 / 미입력" 중 무엇인지
                    다르게 그려져야 합니다. charts.js 의 bars() 는 계열 단위로만
                    색을 받습니다.
     2) 클릭        Day 곡선의 점을 눌러 그 배치로 드릴다운해야 합니다.

   charts.js 를 고치면 대시보드 · 데이터 조회 · DoE 가 함께 흔들립니다.
   회의 모드에서만 쓰는 요구라 여기서 따로 그립니다.

   조건에서 벗어난 값도 절대 지우지 않습니다 — 흐리게 그릴 뿐입니다.
   ========================================================================== */

window.MeetingChart = (function () {
  "use strict";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  /* 축 눈금은 1 · 2 · 2.5 · 5 · 10 배수로만 — 60,70,81,91 같은 눈금은 못 읽습니다 */
  function niceStep(raw) {
    if (!isFinite(raw) || raw <= 0) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    const s = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return s * mag;
  }
  function dpOf(step) {
    if (step >= 10) return 0;
    if (step >= 1) return 0;
    if (step >= 0.1) return 1;
    if (step >= 0.01) return 2;
    return 3;
  }
  const num = (v) => typeof v === "number" && isFinite(v);

  /* 상태별 불투명도 — 색만으로 구분하지 않도록 미입력은 빗금으로도 표시합니다 */
  const OPACITY = { hit: 1, miss: 0.22, nodata: 0.35, none: 1 };

  /* ══════════════════════════════════════════════════════════════════════
     묶은 막대 — 카테고리(배치)마다 조건 상태를 다르게 그립니다
     ══════════════════════════════════════════════════════════════════════ */
  function bars(cfg) {
    const cats = cfg.cats || [];
    const series = cfg.series || [];
    const states = cfg.states || [];
    const pinned = cfg.pinned || [];
    const W = cfg.w || 940, H = cfg.h || 320;
    const padL = 56, padR = 14, padT = 16, padB = 54;
    const plotW = W - padL - padR, plotH = H - padT - padB;

    const vals = series.reduce((a, s) => a.concat(s.data.filter(num)), []);
    if (!cats.length || !vals.length) {
      return '<div class="empty"><div class="empty-title">그래프에 올릴 값이 없습니다</div></div>';
    }

    let lo = cfg.min != null ? cfg.min : 0;
    let hi = Math.max.apply(null, vals);
    if (hi <= lo) hi = lo + Math.abs(lo || 1) * 0.1 + 1;
    const step = niceStep((hi - lo) / 4);
    hi = Math.ceil(hi / step) * step;
    lo = Math.floor(lo / step) * step;
    const dp = dpOf(step);
    const y = v => padT + plotH - ((v - lo) / (hi - lo)) * plotH;

    const gw = plotW / cats.length;
    const bw = Math.max(3, Math.min(26, (gw * 0.66) / Math.max(1, series.length)));
    const groupW = bw * series.length;

    /* 눈금 */
    let ticks = "";
    for (let v = lo; v <= hi + step / 2; v += step) {
      const yy = y(v);
      ticks += '<line x1="' + padL + '" y1="' + yy.toFixed(1) + '" x2="' + (W - padR) +
        '" y2="' + yy.toFixed(1) + '" stroke="var(--c-paper-2)" stroke-width="1"/>' +
        '<text x="' + (padL - 8) + '" y="' + (yy + 3.5).toFixed(1) + '" text-anchor="end" ' +
        'font-size="10" fill="var(--c-text-soft)" font-family="var(--font-data)">' +
        v.toFixed(dp) + '</text>';
    }

    /* 막대 + 클릭 영역 */
    let body = "";
    cats.forEach(function (c, i) {
      const st = states[i] || "none";
      const op = OPACITY[st] === undefined ? 1 : OPACITY[st];
      const gx = padL + gw * i + (gw - groupW) / 2;

      /* 카테고리 전체를 덮는 투명 클릭 영역 — 막대가 낮아도 누를 수 있게 */
      body += '<rect class="mmc-hit" x="' + (padL + gw * i).toFixed(1) + '" y="' + padT +
        '" width="' + gw.toFixed(1) + '" height="' + plotH + '" fill="transparent" ' +
        'data-cat="' + i + '" tabindex="0" role="button" aria-label="' + esc(c) + ' 선택"></rect>';

      if (cfg.focus === c) {
        body += '<rect x="' + (padL + gw * i).toFixed(1) + '" y="' + padT + '" width="' + gw.toFixed(1) +
          '" height="' + plotH + '" fill="var(--c-accent-bg)" opacity=".7"/>';
      }

      series.forEach(function (s, j) {
        const v = s.data[i];
        const x = gx + bw * j;
        if (!num(v)) {
          /* 미입력은 빈 자리로 두지 않고 바닥에 빗금 조각을 남깁니다 —
             값이 0 인 것과 값이 없는 것은 다릅니다. */
          body += '<rect x="' + x.toFixed(1) + '" y="' + (padT + plotH - 3) + '" width="' + bw.toFixed(1) +
            '" height="3" fill="var(--c-text-soft)" opacity=".28"/>';
          return;
        }
        const yy = y(v), h = Math.max(1, padT + plotH - yy);
        body += '<rect x="' + x.toFixed(1) + '" y="' + yy.toFixed(1) + '" width="' + bw.toFixed(1) +
          '" height="' + h.toFixed(1) + '" fill="' + s.color + '" opacity="' + op + '" rx="1.5">' +
          '<title>' + esc(c + " · " + s.name + " " + v) + '</title></rect>';
      });

      /* 핀이 붙은 배치는 막대 위에 표식 */
      if (pinned.indexOf(c) > -1) {
        body += '<text x="' + (padL + gw * i + gw / 2).toFixed(1) + '" y="' + (padT - 4) +
          '" text-anchor="middle" font-size="10" fill="var(--c-accent)">◆</text>';
      }

      /* x 라벨 — 빽빽하면 건너뜁니다 */
      const skip = Math.ceil((cats.length * 46) / plotW);
      if (i % skip === 0) {
        body += '<text x="' + (padL + gw * i + gw / 2).toFixed(1) + '" y="' + (padT + plotH + 16) +
          '" text-anchor="middle" font-size="10" fill="' +
          (st === "miss" ? "var(--c-text-soft)" : "var(--c-text-mute)") +
          '" font-family="var(--font-data)">' + esc(c) + '</text>';
      }
      /* 조건 상태 표식 — 색 없이도 읽히도록 기호를 씁니다 */
      if (st !== "none") {
        body += '<text x="' + (padL + gw * i + gw / 2).toFixed(1) + '" y="' + (padT + plotH + 30) +
          '" text-anchor="middle" font-size="9" fill="' +
          (st === "hit" ? "var(--c-accent)" : st === "miss" ? "var(--c-text-soft)" : "var(--c-warn)") +
          '">' + (st === "hit" ? "●" : st === "miss" ? "○" : "—") + '</text>';
      }
    });

    return '<svg class="mmc" viewBox="0 0 ' + W + " " + H + '" width="100%" height="' + H +
      '" role="img" aria-label="' + esc(cfg.aria || "배치별 비교") + '">' +
      ticks + body +
      '<line x1="' + padL + '" y1="' + (padT + plotH) + '" x2="' + (W - padR) + '" y2="' + (padT + plotH) +
      '" stroke="var(--c-border)" stroke-width="1"/></svg>';
  }

  /* ══════════════════════════════════════════════════════════════════════
     Day 축 곡선 — 점을 누르면 그 배치로 드릴다운합니다
     ══════════════════════════════════════════════════════════════════════ */
  function dayLines(cfg) {
    const days = cfg.days || [];
    const series = (cfg.series || []).filter(s => s.points && s.points.length);
    const W = cfg.w || 940, H = cfg.h || 300;
    const padL = 58, padR = 16, padT = 16, padB = 40;
    const plotW = W - padL - padR, plotH = H - padT - padB;

    const vals = series.reduce((a, s) => a.concat(s.points.map(p => p.value).filter(num)), []);
    if (!days.length || !vals.length) {
      return '<div class="empty"><div class="empty-title">일자별 값이 기록된 배치가 없습니다</div>' +
        '<div class="empty-body">원본에 Titer 는 D10~D14 만 값이 있고 D15 이후는 전 행이 &ldquo;-&rdquo; 입니다.</div></div>';
    }

    let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    const step = niceStep((hi - lo) / 4 || hi / 4);
    hi = Math.ceil(hi / step) * step;
    lo = Math.max(0, Math.floor(lo / step) * step);
    const dp = dpOf(step);

    const x = i => padL + (days.length === 1 ? plotW / 2 : (plotW * i) / (days.length - 1));
    const y = v => padT + plotH - ((v - lo) / (hi - lo || 1)) * plotH;

    let ticks = "";
    for (let v = lo; v <= hi + step / 2; v += step) {
      const yy = y(v);
      ticks += '<line x1="' + padL + '" y1="' + yy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + yy.toFixed(1) +
        '" stroke="var(--c-paper-2)" stroke-width="1"/>' +
        '<text x="' + (padL - 8) + '" y="' + (yy + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" ' +
        'fill="var(--c-text-soft)" font-family="var(--font-data)">' + v.toFixed(dp) + '</text>';
    }
    days.forEach(function (d, i) {
      ticks += '<text x="' + x(i).toFixed(1) + '" y="' + (padT + plotH + 18) + '" text-anchor="middle" ' +
        'font-size="10" fill="var(--c-text-mute)" font-family="var(--font-data)">' + esc(d) + '</text>';
    });

    let body = "";
    series.forEach(function (s) {
      const dim = cfg.focusBatch && cfg.focusBatch !== s.batchId;
      const op = dim ? 0.18 : (s.state === "miss" ? 0.3 : 1);
      const pts = s.points.filter(p => num(p.value))
        .map(p => ({ i: days.indexOf(p.day), v: p.value, day: p.day }))
        .filter(p => p.i > -1);
      if (pts.length > 1) {
        body += '<polyline points="' + pts.map(p => x(p.i).toFixed(1) + "," + y(p.v).toFixed(1)).join(" ") +
          '" fill="none" stroke="' + s.color + '" stroke-width="' + (dim ? 1.2 : 2) +
          '" opacity="' + op + '" stroke-linejoin="round"/>';
      }
      pts.forEach(function (p) {
        const on = cfg.focusBatch === s.batchId && cfg.focusDay === p.day;
        body += '<circle class="mmc-pt" cx="' + x(p.i).toFixed(1) + '" cy="' + y(p.v).toFixed(1) +
          '" r="' + (on ? 6.5 : dim ? 2.5 : 4) + '" fill="' + (on ? "#fff" : s.color) +
          '" stroke="' + s.color + '" stroke-width="' + (on ? 3 : 1) + '" opacity="' + op + '" ' +
          'data-b="' + esc(s.batchId) + '" data-day="' + esc(p.day) + '" tabindex="0" role="button" ' +
          'aria-label="' + esc(s.label + " " + p.day + " " + p.v) + '">' +
          '<title>' + esc(s.label + " · " + p.day + " · " + p.v + (cfg.unit ? " " + cfg.unit : "")) +
          '</title></circle>';
      });
      /* 마지막 점 옆에 배치명 — 범례를 따로 두면 눈이 왕복합니다 */
      if (pts.length && !dim) {
        const last = pts[pts.length - 1];
        body += '<text x="' + (x(last.i) + 7).toFixed(1) + '" y="' + (y(last.v) + 3.5).toFixed(1) +
          '" font-size="10" fill="' + s.color + '" font-family="var(--font-data)">' + esc(s.label) + '</text>';
      }
    });

    return '<svg class="mmc" viewBox="0 0 ' + W + " " + H + '" width="100%" height="' + H +
      '" role="img" aria-label="' + esc(cfg.aria || "일자별 추이") + '">' + ticks + body +
      '<line x1="' + padL + '" y1="' + (padT + plotH) + '" x2="' + (W - padR) + '" y2="' + (padT + plotH) +
      '" stroke="var(--c-border)" stroke-width="1"/></svg>';
  }

  return { bars, dayLines, niceStep };
})();
