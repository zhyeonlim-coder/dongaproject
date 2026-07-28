/* ==========================================================================
   DoE engine — real computation, no lookup tables

   Implements:
     · Design generation   Full Factorial 2^k, Box-Behnken, Central Composite
     · Model fitting       ordinary least squares via normal equations
     · Inference           coefficient se / t / p, ANOVA with sequential SS,
                           lack-of-fit vs pure error split (t·F tail
                           probabilities computed, not looked up)
     · Response surface    evaluation on a grid
     · Contour rendering   marching squares iso-lines over a heatmap
     · 3D surface          isometric projection, painter's algorithm
     · Optimisation        grid search over the coded design space

   Model selection is design-aware, which matters for correctness: a 2-level
   factorial cannot estimate pure quadratic terms (x² ≡ 1 for every run, so the
   column is collinear with the intercept and XtX is singular). Those designs
   get a linear + interaction model; BBD/CCD get the full quadratic.
   ========================================================================== */

window.DOE = (function () {
  "use strict";

  /* ── Linear algebra ─────────────────────────────────────────────────── */

  // Gauss-Jordan inverse. Needed for coefficient standard errors:
  // Var(β) = σ²·(XtX)⁻¹, so the diagonal gives se(βⱼ).
  function invert(A) {
    const n = A.length;
    const M = A.map((row, i) =>
      row.slice().concat(Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))));
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-12) return null;
      if (piv !== c) { const t = M[piv]; M[piv] = M[c]; M[c] = t; }
      const pv = M[c][c];
      for (let k = c; k < 2 * n; k++) M[c][k] /= pv;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c];
        if (!f) continue;
        for (let k = c; k < 2 * n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map(row => row.slice(n));
  }

  // Solve A·x = b by Gaussian elimination with partial pivoting.
  // Returns null when the system is singular beyond a small ridge.
  function solve(A, b) {
    const n = A.length;
    const M = A.map((row, i) => row.slice().concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-12) return null;
      if (piv !== c) { const t = M[piv]; M[piv] = M[c]; M[c] = t; }
      for (let r = c + 1; r < n; r++) {
        const f = M[r][c] / M[c][c];
        if (!f) continue;
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
      let s = M[r][n];
      for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
      x[r] = s / M[r][r];
    }
    return x;
  }

  /* ── Distributions ──────────────────────────────────────────────────────
     p-value 를 표로만 두면 자유도가 바뀔 때마다 틀립니다. t·F 분포의 꼬리
     확률을 직접 계산합니다 — 둘 다 정규화 불완전 베타 함수 I_x(a,b) 하나로
     표현됩니다.

       두쪽 t 검정   P(|T| > t)  = I_{df/(df+t²)}(df/2, 1/2)
       F 상측 꼬리   P(F' > F)   = I_{df2/(df2+df1·F)}(df2/2, df1/2)

     I_x(a,b)는 연분수 전개(Lermis-Thompson)로, logΓ는 Lanczos 근사로 구합니다.
     배정밀도 범위에서 소수점 아래 10자리 수준까지 맞습니다. */

  function logGamma(x) {
    const g = 7;
    const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
               771.32342877765313, -176.61502916214059, 12.507343278686905,
               -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
    x -= 1;
    let a = c[0];
    const t = x + g + 0.5;
    for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }

  function betacf(a, b, x) {
    const MAXIT = 300, EPS = 3e-14, FPMIN = 1e-300;
    const qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - (qab * x) / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= MAXIT; m++) {
      const m2 = 2 * m;
      let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }

  function betai(a, b, x) {
    if (!isFinite(x) || x <= 0) return 0;
    if (x >= 1) return 1;
    const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) +
                        a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2)
      ? (bt * betacf(a, b, x)) / a
      : 1 - (bt * betacf(b, a, 1 - x)) / b;
  }

  /* 두쪽 검정 p-value */
  function pFromT(t, df) {
    if (!isFinite(t) || !(df > 0)) return NaN;
    return betai(df / 2, 0.5, df / (df + t * t));
  }
  /* F 상측 꼬리 p-value */
  function pFromF(F, df1, df2) {
    if (!isFinite(F) || F <= 0 || !(df1 > 0) || !(df2 > 0)) return NaN;
    return betai(df2 / 2, df1 / 2, df2 / (df2 + df1 * F));
  }

  /* ── Design generation ──────────────────────────────────────────────── */

  function fullFactorial(k, centers) {
    const runs = [];
    const n = Math.pow(2, k);
    for (let i = 0; i < n; i++) {
      const row = [];
      for (let f = 0; f < k; f++) row.push((i >> f) & 1 ? 1 : -1);
      runs.push(row);
    }
    for (let c = 0; c < centers; c++) runs.push(new Array(k).fill(0));
    return runs;
  }

  // Box-Behnken: every pair of factors at ±1 while the rest sit at 0. k ≥ 3.
  function boxBehnken(k, centers) {
    if (k < 3) return null;
    const runs = [];
    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        [-1, 1].forEach(a => [-1, 1].forEach(b => {
          const row = new Array(k).fill(0);
          row[i] = a; row[j] = b;
          runs.push(row);
        }));
      }
    }
    for (let c = 0; c < centers; c++) runs.push(new Array(k).fill(0));
    return runs;
  }

  // Central Composite: factorial + axial (star) + centre.
  // alpha = (2^k)^(1/4) gives rotatability; 1 gives a face-centred design.
  function centralComposite(k, centers, faceCentred) {
    const alpha = faceCentred ? 1 : +Math.pow(Math.pow(2, k), 0.25).toFixed(4);
    const runs = fullFactorial(k, 0);
    for (let f = 0; f < k; f++) {
      [-alpha, alpha].forEach(a => {
        const row = new Array(k).fill(0);
        row[f] = a;
        runs.push(row);
      });
    }
    for (let c = 0; c < centers; c++) runs.push(new Array(k).fill(0));
    runs.alpha = alpha;
    return runs;
  }

  const DESIGNS = {
    ff:  { id: "ff",  ko: "완전요인배치", en: "Full Factorial 2^k",
           note: "선형 효과와 교호작용 파악에 적합. 2수준이므로 곡률(2차항)은 추정 불가.",
           build: (k, c) => fullFactorial(k, c), minK: 2, quadratic: false },
    bb:  { id: "bb",  ko: "Box-Behnken",   en: "Box-Behnken",
           note: "요인당 3수준, 극단 꼭짓점 조합을 피함. 반응표면 최적화에 경제적.",
           build: (k, c) => boxBehnken(k, c), minK: 3, quadratic: true },
    ccd: { id: "ccd", ko: "중심합성계획",  en: "Central Composite",
           note: "요인배치 + 축점 + 중심점. 2차 모델 적합에 가장 널리 쓰임.",
           build: (k, c) => centralComposite(k, c, false), minK: 2, quadratic: true },
    ccf: { id: "ccf", ko: "면중심 합성계획", en: "Central Composite (face-centred)",
           note: "축점을 ±1에 둠. 요인 범위를 벗어난 실험이 불가능할 때 사용.",
           build: (k, c) => centralComposite(k, c, true), minK: 2, quadratic: true }
  };

  function generate(designId, factors, centers) {
    const d = DESIGNS[designId];
    const k = factors.length;
    if (!d || k < d.minK) return null;
    const coded = d.build(k, centers == null ? 3 : centers);
    if (!coded) return null;
    return {
      design: d, k, factors, coded,
      alpha: coded.alpha || 1,
      runs: coded.map((row, i) => ({
        n: i + 1,
        coded: row,
        actual: row.map((c, f) => codedToActual(c, factors[f]))
      }))
    };
  }

  function codedToActual(c, f) {
    const lo = +f.low, hi = +f.high;
    const mid = (lo + hi) / 2, half = (hi - lo) / 2;
    return +(mid + c * half).toFixed(4);
  }

  /* ── Model terms ────────────────────────────────────────────────────── */

  function terms(k, quadratic) {
    const t = [{ label: "절편", kind: "int", i: -1, j: -1 }];
    for (let i = 0; i < k; i++) t.push({ label: "X" + (i + 1), kind: "lin", i, j: -1 });
    for (let i = 0; i < k; i++)
      for (let j = i + 1; j < k; j++) t.push({ label: "X" + (i + 1) + "·X" + (j + 1), kind: "int2", i, j });
    if (quadratic) for (let i = 0; i < k; i++) t.push({ label: "X" + (i + 1) + "²", kind: "quad", i, j: -1 });
    return t;
  }

  function rowVector(x, ts) {
    return ts.map(t => {
      if (t.kind === "int") return 1;
      if (t.kind === "lin") return x[t.i];
      if (t.kind === "int2") return x[t.i] * x[t.j];
      return x[t.i] * x[t.i];
    });
  }

  /* ── Fit ────────────────────────────────────────────────────────────── */

  function fit(plan, responses) {
    const idx = [];
    responses.forEach((y, i) => { if (y !== null && y !== undefined && y !== "" && isFinite(+y)) idx.push(i); });
    const ts = terms(plan.k, plan.design.quadratic);
    if (idx.length < ts.length) {
      return { ok: false, reason: "부족", need: ts.length, have: idx.length };
    }

    const X = idx.map(i => rowVector(plan.coded[i], ts));
    const y = idx.map(i => +responses[i]);
    const p = ts.length;

    // Normal equations XtX·b = Xty
    const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
    const Xty = new Array(p).fill(0);
    for (let r = 0; r < X.length; r++) {
      for (let a = 0; a < p; a++) {
        Xty[a] += X[r][a] * y[r];
        for (let b = 0; b < p; b++) XtX[a][b] += X[r][a] * X[r][b];
      }
    }
    let beta = solve(XtX, Xty);
    if (!beta) {                                   // tiny ridge for safety
      for (let a = 0; a < p; a++) XtX[a][a] += 1e-8;
      beta = solve(XtX, Xty);
      if (!beta) return { ok: false, reason: "특이행렬" };
    }

    const mean = y.reduce((s, v) => s + v, 0) / y.length;
    let ssRes = 0, ssTot = 0;
    const fitted = X.map((row, r) => {
      const yh = row.reduce((s, v, a) => s + v * beta[a], 0);
      ssRes += Math.pow(y[r] - yh, 2);
      ssTot += Math.pow(y[r] - mean, 2);
      return yh;
    });
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
    const dfRes = y.length - p;
    const r2adj = (ssTot > 0 && dfRes > 0) ? 1 - (ssRes / dfRes) / (ssTot / (y.length - 1)) : NaN;
    const mse = dfRes > 0 ? ssRes / dfRes : NaN;

    /* ── 계수별 표준오차 · t · p ────────────────────────────────────────
       Var(β) = σ²·(XtX)⁻¹. 잔차 자유도가 0이면 σ² 을 추정할 수 없으므로
       p-value 를 만들지 않고 NaN 으로 둡니다 — 0 이나 1 로 채우면
       "유의하다/아니다" 를 근거 없이 주장하게 됩니다. */
    const Cinv = dfRes > 0 ? invert(XtX) : null;
    const se = Cinv ? beta.map((_, j) => Math.sqrt(Math.max(0, mse * Cinv[j][j]))) : null;
    const tval = se ? beta.map((b, j) => (se[j] > 0 ? b / se[j] : NaN)) : null;
    const pval = tval ? tval.map(t => pFromT(t, dfRes)) : null;

    return {
      ok: true, ts, beta, r2, r2adj, n: y.length, p,
      rmse: Math.sqrt(ssRes / Math.max(1, dfRes)),
      ssRes, ssTot, dfRes, mse, se, tval, pval,
      anova: anova(plan, X, y, ts, idx, ssRes, ssTot, dfRes, mse),
      fitted, usedIdx: idx,
      predict: (x) => rowVector(x, ts).reduce((s, v, a) => s + v * beta[a], 0)
    };
  }

  /* ── ANOVA ──────────────────────────────────────────────────────────────
     항 그룹(선형 → 교호작용 → 2차)을 순서대로 넣으면서 잔차제곱합이 얼마나
     줄어드는지 보는 **순차 제곱합(Type I SS)** 입니다. 상용 DoE 도구가 쓰는
     기본 분해와 같습니다. 항을 넣는 순서가 바뀌면 값도 바뀌므로, 화면에
     "선형 → 교호작용 → 2차 순서" 라고 밝혀 둡니다.

     중심점처럼 같은 조건을 반복한 run 이 있으면 잔차를
       순수오차(Pure Error) — 같은 조건끼리의 흩어짐
       적합결여(Lack of Fit) — 모형이 설명하지 못한 체계적 편차
     로 더 쪼갭니다. 적합결여가 유의하면 R²가 높아도 모형이 부족한 것입니다. */
  function anova(plan, X, y, ts, idx, ssRes, ssTot, dfRes, mse) {
    const n = y.length;

    /* 부분 모형의 잔차제곱합 — 순차 SS 를 얻으려면 중첩 모형을 다시 적합합니다 */
    function ssResOf(cols) {
      const q = cols.length;
      const A = Array.from({ length: q }, () => new Array(q).fill(0));
      const bvec = new Array(q).fill(0);
      for (let r = 0; r < X.length; r++) {
        for (let a = 0; a < q; a++) {
          bvec[a] += X[r][cols[a]] * y[r];
          for (let b = 0; b < q; b++) A[a][b] += X[r][cols[a]] * X[r][cols[b]];
        }
      }
      const bb = solve(A, bvec);
      if (!bb) return null;
      let ss = 0;
      for (let r = 0; r < X.length; r++) {
        let yh = 0;
        for (let a = 0; a < q; a++) yh += X[r][cols[a]] * bb[a];
        ss += Math.pow(y[r] - yh, 2);
      }
      return ss;
    }

    const GROUPS = [
      { kind: "lin",  label: "선형 (Linear)" },
      { kind: "int2", label: "교호작용 (Interaction)" },
      { kind: "quad", label: "2차 (Quadratic)" }
    ];

    const seq = [];
    let used = [0];               // 절편만 있는 모형의 잔차제곱합 = 수정 총 제곱합
    let prev = ssTot;
    GROUPS.forEach(function (g) {
      const add = ts.map((t, i) => i).filter(i => ts[i].kind === g.kind);
      if (!add.length) return;
      used = used.concat(add);
      const cur = ssResOf(used);
      if (cur === null) return;
      seq.push({ label: g.label, df: add.length, ss: Math.max(0, prev - cur) });
      prev = cur;
    });

    /* ── 순수오차 / 적합결여 ── */
    const bySig = {};
    idx.forEach(function (runIdx, r) {
      const sig = plan.coded[runIdx].map(v => (+v).toFixed(6)).join("|");
      (bySig[sig] = bySig[sig] || []).push(y[r]);
    });
    let ssPE = 0, dfPE = 0;
    Object.keys(bySig).forEach(function (k) {
      const g = bySig[k];
      if (g.length < 2) return;
      const m = g.reduce((s, v) => s + v, 0) / g.length;
      g.forEach(v => { ssPE += Math.pow(v - m, 2); });
      dfPE += g.length - 1;
    });
    const dfLOF = dfRes - dfPE;
    const ssLOF = ssRes - ssPE;
    const hasLOF = dfPE > 0 && dfLOF > 0;

    const dfModel = ts.length - 1;
    const ssModel = ssTot - ssRes;
    const msModel = dfModel > 0 ? ssModel / dfModel : NaN;

    const rows = [{
      source: "모형 (Model)", df: dfModel, ss: ssModel, ms: msModel,
      f: dfRes > 0 ? msModel / mse : NaN,
      p: dfRes > 0 ? pFromF(msModel / mse, dfModel, dfRes) : NaN,
      head: true
    }];

    seq.forEach(function (s) {
      const ms = s.df > 0 ? s.ss / s.df : NaN;
      rows.push({
        source: "  " + s.label, df: s.df, ss: s.ss, ms: ms,
        f: dfRes > 0 ? ms / mse : NaN,
        p: dfRes > 0 ? pFromF(ms / mse, s.df, dfRes) : NaN,
        sub: true
      });
    });

    rows.push({ source: "잔차 (Residual)", df: dfRes, ss: ssRes, ms: mse, f: NaN, p: NaN });

    if (hasLOF) {
      const msLOF = ssLOF / dfLOF, msPE = ssPE / dfPE;
      rows.push({
        source: "  적합결여 (Lack of Fit)", df: dfLOF, ss: ssLOF, ms: msLOF,
        f: msPE > 0 ? msLOF / msPE : NaN,
        p: msPE > 0 ? pFromF(msLOF / msPE, dfLOF, dfPE) : NaN,
        sub: true, lof: true
      });
      rows.push({ source: "  순수오차 (Pure Error)", df: dfPE, ss: ssPE, ms: msPE,
                  f: NaN, p: NaN, sub: true });
    }

    rows.push({ source: "합계 (Total)", df: n - 1, ss: ssTot, ms: NaN, f: NaN, p: NaN, total: true });

    return { rows, hasLOF, dfPE, dfLOF, seqOrder: seq.map(s => s.label) };
  }

  /* ── Optimisation over the coded space ──────────────────────────────── */

  function optimise(model, k, goal, limit) {
    const lim = limit || 1;
    const step = k <= 3 ? 0.05 : 0.1;
    const best = { y: goal === "min" ? Infinity : -Infinity, x: null };
    const x = new Array(k).fill(-lim);

    (function walk(d) {
      if (d === k) {
        const y = model.predict(x);
        if (goal === "min" ? y < best.y : y > best.y) { best.y = y; best.x = x.slice(); }
        return;
      }
      for (let v = -lim; v <= lim + 1e-9; v += step) { x[d] = +v.toFixed(4); walk(d + 1); }
    })(0);

    return best;
  }

  /* ── Surface grid ───────────────────────────────────────────────────── */

  function grid(model, k, fx, fy, res, limit) {
    const lim = limit || 1;
    const g = [];
    let min = Infinity, max = -Infinity;
    for (let iy = 0; iy < res; iy++) {
      const row = [];
      for (let ix = 0; ix < res; ix++) {
        const x = new Array(k).fill(0);
        x[fx] = -lim + (2 * lim * ix) / (res - 1);
        x[fy] = -lim + (2 * lim * iy) / (res - 1);
        const v = model.predict(x);
        row.push(v);
        if (v < min) min = v;
        if (v > max) max = v;
      }
      g.push(row);
    }
    return { g, min, max, res, lim };
  }

  /* ── Colour ramp (navy → cyan → pale) ───────────────────────────────── */
  const RAMP = [
    [10, 25, 47], [3, 105, 161], [14, 165, 233], [125, 211, 252], [224, 242, 254]
  ];
  function ramp(t) {
    t = Math.max(0, Math.min(1, t));
    const s = t * (RAMP.length - 1);
    const i = Math.min(RAMP.length - 2, Math.floor(s));
    const f = s - i;
    const a = RAMP[i], b = RAMP[i + 1];
    return "rgb(" + Math.round(a[0] + (b[0] - a[0]) * f) + "," +
                    Math.round(a[1] + (b[1] - a[1]) * f) + "," +
                    Math.round(a[2] + (b[2] - a[2]) * f) + ")";
  }

  /* ── Contour: heatmap + marching-squares iso-lines ──────────────────── */

  function contourSVG(surf, opts) {
    const o = opts || {};
    const W = o.w || 460, H = o.h || 380;
    const pad = { t: 14, r: 14, b: 40, l: 48 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const { g, min, max, res, lim } = surf;
    const span = (max - min) || 1;

    const px = (ix) => pad.l + (ix / (res - 1)) * iw;
    const py = (iy) => pad.t + ih - (iy / (res - 1)) * ih;

    // Filled cells
    let cells = "";
    const cw = iw / (res - 1) + 0.7, ch = ih / (res - 1) + 0.7;
    for (let iy = 0; iy < res - 1; iy++) {
      for (let ix = 0; ix < res - 1; ix++) {
        const v = (g[iy][ix] + g[iy][ix + 1] + g[iy + 1][ix] + g[iy + 1][ix + 1]) / 4;
        cells += '<rect x="' + (px(ix)).toFixed(1) + '" y="' + (py(iy + 1)).toFixed(1) +
                 '" width="' + cw.toFixed(1) + '" height="' + ch.toFixed(1) +
                 '" fill="' + ramp((v - min) / span) + '"/>';
      }
    }

    // Iso-lines
    const levels = o.levels || 8;
    let lines = "", labels = "";
    for (let L = 1; L < levels; L++) {
      const lv = min + (span * L) / levels;
      let d = "";
      for (let iy = 0; iy < res - 1; iy++) {
        for (let ix = 0; ix < res - 1; ix++) {
          const v0 = g[iy][ix], v1 = g[iy][ix + 1], v2 = g[iy + 1][ix + 1], v3 = g[iy + 1][ix];
          const c = (v0 > lv ? 1 : 0) | (v1 > lv ? 2 : 0) | (v2 > lv ? 4 : 0) | (v3 > lv ? 8 : 0);
          if (c === 0 || c === 15) continue;
          const ip = (a, b, pa, pb) => {
            const t = (lv - a) / ((b - a) || 1e-9);
            return [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t];
          };
          const P0 = [px(ix), py(iy)], P1 = [px(ix + 1), py(iy)],
                P2 = [px(ix + 1), py(iy + 1)], P3 = [px(ix), py(iy + 1)];
          const B = ip(v0, v1, P0, P1), R = ip(v1, v2, P1, P2),
                T = ip(v3, v2, P3, P2), Lf = ip(v0, v3, P0, P3);
          const seg = (a, b) => { d += "M" + a[0].toFixed(1) + " " + a[1].toFixed(1) +
                                       "L" + b[0].toFixed(1) + " " + b[1].toFixed(1); };
          switch (c) {
            case 1: case 14: seg(Lf, B); break;
            case 2: case 13: seg(B, R); break;
            case 3: case 12: seg(Lf, R); break;
            case 4: case 11: seg(R, T); break;
            case 6: case 9:  seg(B, T); break;
            case 7: case 8:  seg(Lf, T); break;
            case 5:  seg(Lf, T); seg(B, R); break;
            case 10: seg(Lf, B); seg(T, R); break;
          }
        }
      }
      if (d) lines += '<path d="' + d + '" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1"/>';
    }

    // Axes
    const ticks = (fmt, horiz) => {
      let s = "";
      for (let i = 0; i <= 4; i++) {
        const c = -lim + (2 * lim * i) / 4;
        const v = fmt(c);
        if (horiz) {
          const X = pad.l + (i / 4) * iw;
          s += '<text x="' + X.toFixed(1) + '" y="' + (H - 20) + '" text-anchor="middle" font-size="10" ' +
               'font-family="var(--font-data)" fill="var(--c-text-mute)">' + v + '</text>';
        } else {
          const Y = pad.t + ih - (i / 4) * ih;
          s += '<text x="' + (pad.l - 7) + '" y="' + (Y + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" ' +
               'font-family="var(--font-data)" fill="var(--c-text-mute)">' + v + '</text>';
        }
      }
      return s;
    };

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" ' +
      'aria-label="' + (o.aria || "반응표면 등고선") + '" preserveAspectRatio="xMidYMid meet">' +
      '<g clip-path="url(#cclip)">' + cells + lines + '</g>' +
      '<defs><clipPath id="cclip"><rect x="' + pad.l + '" y="' + pad.t + '" width="' + iw + '" height="' + ih + '"/></clipPath></defs>' +
      '<rect x="' + pad.l + '" y="' + pad.t + '" width="' + iw + '" height="' + ih + '" fill="none" stroke="var(--c-border-str)"/>' +
      ticks(o.fmtX || (c => c.toFixed(1)), true) + ticks(o.fmtY || (c => c.toFixed(1)), false) +
      '<text x="' + (pad.l + iw / 2) + '" y="' + (H - 4) + '" text-anchor="middle" font-size="11" ' +
        'font-weight="600" fill="var(--c-text-mute)">' + (o.xLabel || "X1") + '</text>' +
      '<text x="12" y="' + (pad.t + ih / 2) + '" text-anchor="middle" font-size="11" font-weight="600" ' +
        'fill="var(--c-text-mute)" transform="rotate(-90 12 ' + (pad.t + ih / 2) + ')">' + (o.yLabel || "X2") + '</text>' +
      (o.marker ? '<circle cx="' + (pad.l + ((o.marker[0] + lim) / (2 * lim)) * iw).toFixed(1) +
                  '" cy="' + (pad.t + ih - ((o.marker[1] + lim) / (2 * lim)) * ih).toFixed(1) +
                  '" r="6" fill="none" stroke="#fff" stroke-width="2.5"/>' +
                  '<circle cx="' + (pad.l + ((o.marker[0] + lim) / (2 * lim)) * iw).toFixed(1) +
                  '" cy="' + (pad.t + ih - ((o.marker[1] + lim) / (2 * lim)) * ih).toFixed(1) +
                  '" r="2.5" fill="#fff"/>' : '') +
      '</svg>';
  }

  /* ── 3D surface: isometric projection, painter's algorithm ──────────── */

  function surface3D(surf, opts) {
    const o = opts || {};
    const W = o.w || 460, H = o.h || 380;
    const { g, min, max, res } = surf;
    const span = (max - min) || 1;

    const step = Math.max(1, Math.floor(res / 26));
    const cx = W / 2, cy = H * 0.62;
    const sx = (W * 0.34) / (res - 1), sy = (H * 0.20) / (res - 1), sz = H * 0.34;

    const proj = (ix, iy, v) => {
      const a = ix - (res - 1) / 2, b = iy - (res - 1) / 2;
      return [ cx + (a - b) * sx, cy + (a + b) * sy - ((v - min) / span) * sz ];
    };

    const quads = [];
    for (let iy = 0; iy < res - step; iy += step) {
      for (let ix = 0; ix < res - step; ix += step) {
        const pts = [
          proj(ix, iy, g[iy][ix]),
          proj(ix + step, iy, g[iy][ix + step]),
          proj(ix + step, iy + step, g[iy + step][ix + step]),
          proj(ix, iy + step, g[iy + step][ix])
        ];
        const avg = (g[iy][ix] + g[iy][ix + step] + g[iy + step][ix + step] + g[iy + step][ix]) / 4;
        quads.push({ depth: ix + iy, pts, v: avg });
      }
    }
    quads.sort((a, b) => a.depth - b.depth);   // far → near

    const body = quads.map(q =>
      '<polygon points="' + q.pts.map(p => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ") +
      '" fill="' + ramp((q.v - min) / span) + '" stroke="rgba(255,255,255,.30)" stroke-width=".6"/>'
    ).join("");

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" ' +
      'aria-label="' + (o.aria || "반응표면 3D 곡면") + '" preserveAspectRatio="xMidYMid meet">' + body +
      '<text x="' + (cx - W * 0.30) + '" y="' + (H - 12) + '" font-size="11" font-weight="600" ' +
        'fill="var(--c-text-mute)">' + (o.xLabel || "X1") + '</text>' +
      '<text x="' + (cx + W * 0.20) + '" y="' + (H - 12) + '" font-size="11" font-weight="600" ' +
        'fill="var(--c-text-mute)">' + (o.yLabel || "X2") + '</text>' +
      '</svg>';
  }

  /* ── Demo response generator ────────────────────────────────────────────
     A known quadratic ground truth + noise, so "예시 채우기" produces data the
     fitter can genuinely recover. Not a stand-in for real measurements. */
  function demoResponses(plan, seedBase) {
    let s = seedBase || 7;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    return plan.coded.map(x => {
      let y = 3.9;
      x.forEach((v, i) => {
        y += [0.42, -0.26, 0.31, 0.12][i % 4] * v;
        y -= [0.38, 0.30, 0.22, 0.18][i % 4] * v * v;
      });
      if (x.length > 1) y += 0.18 * x[0] * x[1];
      return +(y + (rnd() - 0.5) * 0.09).toFixed(3);
    });
  }

  return {
    DESIGNS, generate, fit, optimise, grid, contourSVG, surface3D,
    codedToActual, demoResponses, ramp, terms,
    /* 통계 함수는 화면에서 직접 쓰지 않지만, 검증용으로 노출해 둡니다 */
    pFromT, pFromF, betai, invert
  };
})();
