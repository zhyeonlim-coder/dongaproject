/* ==========================================================================
   Chart helpers — hand-rolled SVG, no charting library

   Every chart returns a string of SVG. Each carries an aria-label, and the
   callers pair them with a visually-hidden data table. Series are separated
   by line style as well as colour, so nothing depends on colour alone.
   ========================================================================== */

window.Charts = (function () {
  "use strict";

  const esc = (s) => String(s).replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  /* ── Multi-series line, optional right axis ─────────────────────────── */
  function line(cfg) {
    const W = cfg.w || 640, H = cfg.h || 250;
    const big = cfg.big;
    const pad = { t: big ? 20 : 14, r: cfg.right ? (big ? 62 : 48) : 16, b: big ? 44 : 34, l: big ? 58 : 46 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const xs = cfg.x || [];
    if (!xs.length) return emptySVG(W, H, "데이터 없음");

    const xAt = i => xs.length === 1 ? pad.l + iw / 2 : pad.l + (i / (xs.length - 1)) * iw;
    const lSeries = cfg.series.filter(s => !s.right);
    const rSeries = cfg.series.filter(s => s.right);
    const lMax = niceMax(lSeries.reduce((a, s) => a.concat(s.data.filter(isFinite)), [0]));
    const rMax = niceMax(rSeries.reduce((a, s) => a.concat(s.data.filter(isFinite)), [0]));
    const yAt = (v, right) => pad.t + ih - (v / ((right ? rMax : lMax) || 1)) * ih;

    const fs = big ? 13 : 10;
    let grid = "";
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + ih - (i / 4) * ih;
      grid += '<line x1="' + pad.l + '" y1="' + y.toFixed(1) + '" x2="' + (W - pad.r) + '" y2="' + y.toFixed(1) +
        '" stroke="var(--c-paper-2)"/>' +
        '<text x="' + (pad.l - 7) + '" y="' + (y + fs / 2.8).toFixed(1) + '" text-anchor="end" font-size="' + fs +
        '" font-family="var(--font-data)" fill="var(--c-text-mute)">' + fmt(lMax * i / 4) + '</text>' +
        (rSeries.length
          ? '<text x="' + (W - pad.r + 7) + '" y="' + (y + fs / 2.8).toFixed(1) + '" font-size="' + fs +
            '" font-family="var(--font-data)" fill="var(--c-text-mute)">' + fmt(rMax * i / 4) + '</text>'
          : "");
    }

    const every = Math.max(1, Math.ceil(xs.length / (big ? 12 : 8)));
    let xlab = "";
    xs.forEach((v, i) => {
      if (i % every && i !== xs.length - 1) return;
      xlab += '<text x="' + xAt(i).toFixed(1) + '" y="' + (H - (big ? 16 : 12)) + '" text-anchor="middle" font-size="' + fs +
        '" font-family="var(--font-data)" fill="var(--c-text-mute)">' + esc(v) + '</text>';
    });

    const paths = cfg.series.map(s => {
      const pts = s.data.map((v, i) => ({ v, i })).filter(p => isFinite(p.v));
      if (!pts.length) return "";
      const d = pts.map((p, k) => (k ? "L" : "M") + xAt(p.i).toFixed(1) + " " + yAt(p.v, s.right).toFixed(1)).join(" ");
      const last = pts[pts.length - 1];
      return '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="' + (big ? 3.2 : 2.2) +
        '" ' + (s.dash ? 'stroke-dasharray="6 4" ' : "") + 'stroke-linecap="round" stroke-linejoin="round"/>' +
        (s.dots ? pts.map(p => '<circle cx="' + xAt(p.i).toFixed(1) + '" cy="' + yAt(p.v, s.right).toFixed(1) +
          '" r="' + (big ? 3.6 : 2.6) + '" fill="' + s.color + '"/>').join("") : "") +
        '<circle cx="' + xAt(last.i).toFixed(1) + '" cy="' + yAt(last.v, s.right).toFixed(1) +
        '" r="' + (big ? 5.4 : 3.8) + '" fill="' + s.color + '" stroke="#fff" stroke-width="' + (big ? 2.2 : 1.6) + '"/>';
    }).join("");

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" aria-label="' +
      esc(cfg.aria || "추이 그래프") + '" preserveAspectRatio="xMidYMid meet">' + grid + xlab + paths + '</svg>';
  }

  /* ── Overlay: culture trend + purification/analysis event markers ─────
     The three teams work on different cadences, so purification and analysis
     appear as dated markers on the culture timeline rather than as their own
     lines — putting them on a shared x-axis without pretending they are
     continuous series. */
  function overlay(cfg) {
    const W = cfg.w || 700, H = cfg.h || 300;
    const big = cfg.big;
    const pad = { t: big ? 24 : 18, r: big ? 62 : 50, b: big ? 62 : 50, l: big ? 58 : 46 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const dates = cfg.dates || [];
    if (!dates.length) return emptySVG(W, H, "데이터 없음");

    const xAt = i => dates.length === 1 ? pad.l + iw / 2 : pad.l + (i / (dates.length - 1)) * iw;
    const lMax = niceMax(cfg.series.filter(s => !s.right).reduce((a, s) => a.concat(s.data.filter(isFinite)), [0]));
    const rMax = niceMax(cfg.series.filter(s => s.right).reduce((a, s) => a.concat(s.data.filter(isFinite)), [0]));
    const yAt = (v, right) => pad.t + ih - (v / ((right ? rMax : lMax) || 1)) * ih;
    const fs = big ? 13 : 10;

    let grid = "";
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + ih - (i / 4) * ih;
      grid += '<line x1="' + pad.l + '" y1="' + y.toFixed(1) + '" x2="' + (W - pad.r) + '" y2="' + y.toFixed(1) +
        '" stroke="var(--c-paper-2)"/>' +
        '<text x="' + (pad.l - 7) + '" y="' + (y + fs / 2.8).toFixed(1) + '" text-anchor="end" font-size="' + fs +
        '" font-family="var(--font-data)" fill="var(--c-text-mute)">' + fmt(lMax * i / 4) + '</text>' +
        '<text x="' + (W - pad.r + 7) + '" y="' + (y + fs / 2.8).toFixed(1) + '" font-size="' + fs +
        '" font-family="var(--font-data)" fill="var(--c-text-mute)">' + fmt(rMax * i / 4) + '</text>';
    }

    const every = Math.max(1, Math.ceil(dates.length / (big ? 10 : 7)));
    let xlab = "";
    dates.forEach((v, i) => {
      if (i % every && i !== dates.length - 1) return;
      xlab += '<text x="' + xAt(i).toFixed(1) + '" y="' + (pad.t + ih + fs + 6) + '" text-anchor="middle" font-size="' + fs +
        '" font-family="var(--font-data)" fill="var(--c-text-mute)">' + esc(v.slice(5)) + '</text>';
    });

    const paths = cfg.series.map(s => {
      const pts = s.data.map((v, i) => ({ v, i })).filter(p => isFinite(p.v));
      if (!pts.length) return "";
      const d = pts.map((p, k) => (k ? "L" : "M") + xAt(p.i).toFixed(1) + " " + yAt(p.v, s.right).toFixed(1)).join(" ");
      return '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="' + (big ? 3.2 : 2.2) +
        '" ' + (s.dash ? 'stroke-dasharray="6 4" ' : "") + 'stroke-linecap="round"/>';
    }).join("");

    // Event markers below the plot
    const marks = (cfg.marks || []).map(m => {
      const i = dates.indexOf(m.date);
      if (i < 0) return "";
      const x = xAt(i);
      const y = pad.t + ih;
      return '<line x1="' + x.toFixed(1) + '" y1="' + pad.t + '" x2="' + x.toFixed(1) + '" y2="' + y +
        '" stroke="' + m.color + '" stroke-width="1.2" stroke-dasharray="3 3" opacity=".55"/>' +
        '<circle cx="' + x.toFixed(1) + '" cy="' + (y + (big ? 26 : 20)) + '" r="' + (big ? 8 : 6.5) +
        '" fill="' + m.color + '"/>' +
        '<text x="' + x.toFixed(1) + '" y="' + (y + (big ? 30 : 23.5)) + '" text-anchor="middle" font-size="' +
        (big ? 10 : 8) + '" font-weight="700" fill="#fff">' + esc(m.short) + '</text>';
    }).join("");

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" aria-label="' +
      esc(cfg.aria || "공정 통합 트렌드") + '" preserveAspectRatio="xMidYMid meet">' +
      grid + xlab + paths + marks + '</svg>';
  }

  /* ── Paired bars: sample vs reference ───────────────────────────────── */
  function pairedBars(rows, cfg) {
    const o = cfg || {};
    const W = o.w || 620, H = o.h || 240, big = o.big;
    const pad = { t: 14, r: 14, b: big ? 40 : 32, l: big ? 50 : 40 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const max = niceMax(rows.reduce((a, r) => a.concat([r.sample, r.ref]), [0]));
    const bw = iw / rows.length;
    const fs = big ? 12 : 10;

    let grid = "";
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + ih - (i / 4) * ih;
      grid += '<line x1="' + pad.l + '" y1="' + y.toFixed(1) + '" x2="' + (W - pad.r) + '" y2="' + y.toFixed(1) +
        '" stroke="var(--c-paper-2)"/>' +
        '<text x="' + (pad.l - 6) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" font-size="' + fs +
        '" font-family="var(--font-data)" fill="var(--c-text-mute)">' + fmt(max * i / 4) + '</text>';
    }

    const bars = rows.map((r, i) => {
      const cx = pad.l + bw * i + bw / 2;
      const w = Math.min(20, bw / 3.4);
      const hS = (r.sample / max) * ih, hR = (r.ref / max) * ih;
      return '<rect x="' + (cx - w - 2).toFixed(1) + '" y="' + (pad.t + ih - hS).toFixed(1) + '" width="' + w +
        '" height="' + hS.toFixed(1) + '" rx="2" fill="var(--c-accent-bright)"/>' +
        '<rect x="' + (cx + 2).toFixed(1) + '" y="' + (pad.t + ih - hR).toFixed(1) + '" width="' + w +
        '" height="' + hR.toFixed(1) + '" rx="2" fill="var(--c-navy-400)"/>' +
        '<text x="' + cx.toFixed(1) + '" y="' + (H - (big ? 16 : 10)) + '" text-anchor="middle" font-size="' + fs +
        '" fill="var(--c-text-mute)">' + esc(r.ko) + '</text>';
    }).join("");

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" aria-label="' +
      esc(o.aria || "시료 대 대조약 비교") + '" preserveAspectRatio="xMidYMid meet">' + grid + bars + '</svg>';
  }

  /* ── Grouped bars ───────────────────────────────────────────────────────
     범주(배치)마다 여러 시리즈를 나란히 세웁니다.

     cfg.min 을 주면 축이 0 이 아니라 그 값에서 시작합니다. 수율·순도처럼
     90~99% 구간에 몰린 지표는 0 부터 그리면 막대가 전부 같은 높이로 보여
     차이를 읽을 수 없기 때문입니다. 축이 0 이 아니라는 사실은 축 라벨과
     caption 에 드러나므로 과장이 되지 않습니다.

     cfg = { cats:[], series:[{name,color,data:[]}], min, max, w, h, aria } */
  function bars(cfg) {
    const W = cfg.w || 700, H = cfg.h || 260, big = cfg.big;
    const cats = cfg.cats || [], series = cfg.series || [];
    const pad = { t: 14, r: 16, b: big ? 52 : 42, l: big ? 58 : 48 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    if (!cats.length) return emptySVG(W, H, "데이터 없음");

    const vals = series.reduce((a, s) => a.concat((s.data || []).filter(isFinite)), []);
    if (!vals.length) return emptySVG(W, H, "미입력");

    const hiRaw = Math.max.apply(null, vals);

    /* 눈금은 "딱 떨어지는" 값에 놓습니다. 축 시작점을 60·95 처럼 옮기면
       단순히 4등분한 눈금이 70.2 · 80.4 처럼 나와 읽기 어렵습니다. */
    const lo = cfg.min != null ? cfg.min : 0;
    const diff = Math.max(1e-6, hiRaw - lo);
    const step = niceStep(diff / 4);
    let hi;
    if (cfg.max != null) {
      hi = cfg.max;
    } else {
      hi = lo + step * Math.ceil(diff / step);
      if (hi <= hiRaw) hi += step;                // 막대가 축 꼭대기에 닿지 않도록
    }
    const nTicks = Math.min(8, Math.max(2, Math.round((hi - lo) / step)));

    const range = (hi - lo) || 1;
    const yAt = v => pad.t + ih - ((v - lo) / range) * ih;
    const fs = big ? 12 : 10;

    const ticks = [];
    for (let i = 0; i <= nTicks; i++) ticks.push(lo + (range * i) / nTicks);
    /* 눈금이 전부 정수면 소수점을 붙이지 않습니다. 반대로 소수 눈금을
       정수로 반올림하면 서로 다른 눈금이 같은 숫자로 찍힙니다. */
    const dp = ticks.every(v => Math.abs(v - Math.round(v)) < 1e-9) ? 0 : (step >= 0.1 ? 1 : 2);

    let grid = "";
    ticks.forEach(function (v) {
      const y = yAt(v);
      grid += '<line x1="' + pad.l + '" y1="' + y.toFixed(1) + '" x2="' + (W - pad.r) + '" y2="' + y.toFixed(1) +
        '" stroke="var(--c-paper-2)"/>' +
        '<text x="' + (pad.l - 7) + '" y="' + (y + fs / 2.8).toFixed(1) + '" text-anchor="end" font-size="' + fs +
        '" font-family="var(--font-data)" fill="var(--c-text-mute)">' + v.toFixed(dp) + '</text>';
    });

    const bw = iw / cats.length;
    const groupW = bw * 0.74;
    const barW = Math.max(2.5, groupW / Math.max(1, series.length) - 1.5);
    const every = Math.max(1, Math.ceil(cats.length / (big ? 16 : 12)));

    let rects = "", xlab = "";
    cats.forEach(function (cat, i) {
      const x0 = pad.l + bw * i + (bw - groupW) / 2;
      series.forEach(function (s, k) {
        const v = (s.data || [])[i];
        if (!isFinite(v) || v === null) return;
        const y = yAt(Math.max(lo, v));
        const h = Math.max(0, pad.t + ih - y);
        rects += '<rect x="' + (x0 + k * (groupW / series.length)).toFixed(1) + '" y="' + y.toFixed(1) +
          '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1.5" fill="' + s.color +
          '"><title>' + esc(cat + " · " + s.name + " " + v) + '</title></rect>';
      });
      if (i % every === 0 || i === cats.length - 1) {
        xlab += '<text x="' + (pad.l + bw * i + bw / 2).toFixed(1) + '" y="' + (pad.t + ih + fs + 8) +
          '" text-anchor="middle" font-size="' + fs + '" font-family="var(--font-data)" ' +
          'fill="var(--c-text-mute)">' + esc(cat) + '</text>';
      }
    });

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" aria-label="' +
      esc(cfg.aria || "막대 그래프") + '" preserveAspectRatio="xMidYMid meet">' +
      grid + rects + xlab + '</svg>';
  }

  /* 범례 — bars() 처럼 색으로만 구분되는 그래프용 (사각형 스와치) */
  function swatches(series) {
    return '<div style="display:flex;flex-wrap:wrap;gap:14px;font-size:11.5px">' +
      series.map(s =>
        '<span style="display:flex;align-items:center;gap:6px;color:var(--c-text-mute)">' +
          '<span style="width:11px;height:11px;border-radius:2px;background:' + s.color +
          '" aria-hidden="true"></span>' + esc(s.name) + '</span>').join("") +
      '</div>';
  }

  /* ── Legend ─────────────────────────────────────────────────────────── */
  function legend(series, big) {
    return '<div style="display:flex;flex-wrap:wrap;gap:' + (big ? "20px" : "14px") + ';font-size:' +
      (big ? "14px" : "11.5px") + '">' +
      series.map(s =>
        '<span style="display:flex;align-items:center;gap:6px;color:var(--c-text-mute)">' +
          '<svg width="' + (big ? 22 : 16) + '" height="4" aria-hidden="true"><line x1="0" y1="2" x2="' +
          (big ? 22 : 16) + '" y2="2" stroke="' + s.color + '" stroke-width="' + (big ? 4 : 3) + '"' +
          (s.dash ? ' stroke-dasharray="5 3"' : "") + '/></svg>' + esc(s.name) + '</span>').join("") +
      '</div>';
  }

  /* ── Sparkline ──────────────────────────────────────────────────────── */
  function spark(data, color, w, h) {
    const W = w || 88, H = h || 26;
    const vals = data.filter(isFinite);
    if (vals.length < 2) return "";
    const min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    const span = (max - min) || 1;
    const d = vals.map((v, i) =>
      (i ? "L" : "M") + ((i / (vals.length - 1)) * (W - 2) + 1).toFixed(1) + " " +
      (H - 2 - ((v - min) / span) * (H - 4)).toFixed(1)).join(" ");
    return '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">' +
      '<path d="' + d + '" fill="none" stroke="' + (color || "var(--c-accent-bright)") +
      '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  /* ── Helpers ────────────────────────────────────────────────────────── */
  /* 사람이 읽기 좋은 눈금 간격 — 1 · 2 · 2.5 · 5 · 10 의 10의 거듭제곱 배수 */
  function niceStep(raw) {
    if (!isFinite(raw) || raw <= 0) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / pow;
    const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return m * pow;
  }

  function niceMax(arr) {
    const m = Math.max.apply(null, arr.filter(isFinite));
    if (!isFinite(m) || m <= 0) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(m)));
    return Math.ceil((m * 1.1) / (pow / 2)) * (pow / 2);
  }
  function fmt(v) {
    if (v >= 1000) return Math.round(v).toString();
    if (v >= 100) return v.toFixed(0);
    if (v >= 10) return v.toFixed(0);
    return v.toFixed(1);
  }
  function emptySVG(W, H, msg) {
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" aria-label="' +
      esc(msg) + '"><text x="' + W / 2 + '" y="' + H / 2 + '" text-anchor="middle" font-size="12" ' +
      'fill="var(--c-text-mute)">' + esc(msg) + '</text></svg>';
  }

  /* Visually-hidden table so every chart has a non-visual equivalent. */
  function dataTable(caption, headers, rows) {
    return '<table class="sr-only"><caption>' + esc(caption) + '</caption><thead><tr>' +
      headers.map(h => '<th scope="col">' + esc(h) + '</th>').join("") + '</tr></thead><tbody>' +
      rows.map(r => '<tr>' + r.map((c, i) => i === 0
        ? '<th scope="row">' + esc(c) + '</th>' : '<td>' + esc(c) + '</td>').join("") + '</tr>').join("") +
      '</tbody></table>';
  }

  return { line, overlay, pairedBars, bars, swatches, legend, spark, dataTable, niceMax };
})();
