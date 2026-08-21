/* ==========================================================================
   backup.js — 데이터 내보내기 · 가져오기  ·  window.Backup

   이 시스템의 모든 기록은 브라우저 localStorage 에만 있습니다. 서버가 없으니
   캐시를 지우면 사라지고, 옆자리로 건너가지도 않습니다. 서버를 붙이기 전까지
   그 구멍을 막는 가장 값싼 수단이 파일 한 개입니다.

     내보내기  hub.* 저장소를 JSON 한 파일로. 백업 · 인수인계 · PC 이동.
     가져오기  파일을 읽어 무엇이 들어오는지 먼저 보여 준 뒤 적용.

   ── 담지 않는 것 ─────────────────────────────────────────────────────────
     hub.session       로그인 상태. 남의 계정으로 열리면 안 됩니다.
     hub.selection.v4  내가 보던 조회 조건. 남의 화면 필터를 물려받으면
                       "왜 데이터가 안 보이지"가 됩니다.

   ── 합치기가 기존 값을 덮어쓰지 않는 이유 ────────────────────────────────
   이 프로젝트의 대원칙이 "덮어쓰지 않고 이력으로 쌓는다"입니다. 가져오기도
   같습니다. 같은 칸에 값이 이미 있으면 **내 것을 남기고** 파일 쪽을 버립니다.
   통째로 바꾸려면 "전체 교체"를 명시적으로 골라야 합니다.

   ── 적용 후 새로고침하는 이유 ────────────────────────────────────────────
   Entries · Issues · Todos · Requests · Pins 는 모두 로드 시점에 저장소를 한 번
   읽어 메모리에 들고 있습니다. 저장소만 바꾸면 화면은 옛 값을 계속 씁니다.
   ========================================================================== */

window.Backup = (function () {
  "use strict";

  const PREFIX = "hub.";
  const SKIP = ["hub.session", "hub.selection.v4"];
  const APP = "donga-st-bio-hub";
  const FORMAT = 1;

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (s, r) => (r || document).querySelector(s);

  /* 화면에 뭐가 들어 있는지 사람 말로 보여 주기 위한 설명 */
  const AREAS = {
    "hub.entries.v1": { ko: "EBR 입력값", parts: [["values", "칸"], ["samples", "시료"]] },
    "hub.pins.v1":    { ko: "회의 기록",  parts: [["pins", "핀"], ["notes", "결정·조치"],
                                                  ["agenda", "안건"], ["meetings", "회의"]] },
    "hub.issues.v1":  { ko: "트러블슈팅 사례", parts: [["list", "건"]] },
    "hub.requests.v1":{ ko: "분석 의뢰",  parts: [["list", "건"]] },
    "hub.todos.v1":   { ko: "할 일",      parts: [["list", "건"]] },
    "hub.schedule.v2":{ ko: "일정",       parts: null },
    "hub.presets.v2": { ko: "회의 프리셋", parts: null },
    "hub.project":    { ko: "이전 화면 선택", parts: null }
  };

  function isPlain(v) {
    return v && typeof v === "object" && !Array.isArray(v);
  }

  /* 저장소 키는 판마다 이름이 바뀝니다(v1 · v2 …). 고정 목록 대신 접두어로
     훑어야 다음 판이 조용히 빠지지 않습니다. */
  function keys() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.indexOf(PREFIX) !== 0) continue;
      if (SKIP.indexOf(k) > -1) continue;
      out.push(k);
    }
    return out.sort();
  }

  function readKey(k) {
    const raw = localStorage.getItem(k);
    if (raw === null) return undefined;
    try { return JSON.parse(raw); } catch (e) { return raw; }   // 문자열로 저장된 것도 있습니다
  }

  function snapshot() {
    const data = {};
    keys().forEach(function (k) {
      const v = readKey(k);
      if (v !== undefined) data[k] = v;
    });
    const u = window.Auth && window.Auth.current ? window.Auth.current() : null;
    return {
      app: APP, format: FORMAT,
      exportedAt: window.Entries ? window.Entries.stamp() : new Date().toISOString().slice(0, 19),
      exportedBy: u ? u.name : "—",
      data: data
    };
  }

  /* ── 요약 ──────────────────────────────────────────────────────────────── */
  function countPart(v) {
    if (Array.isArray(v)) return v.length;
    if (isPlain(v)) return Object.keys(v).length;
    return null;
  }
  function summarize(key, value) {
    const a = AREAS[key];
    if (a && a.parts) {
      const bits = a.parts.map(function (p) {
        const n = countPart(value ? value[p[0]] : null);
        return n === null ? null : n + p[1];
      }).filter(Boolean);
      return bits.length ? bits.join(" · ") : "비어 있음";
    }
    const n = countPart(value);
    if (n === null) return value === undefined || value === null ? "없음" : "값 1개";
    return n === 0 ? "비어 있음" : n + "건";
  }
  function label(key) { return (AREAS[key] || {}).ko || key; }

  function inspect(snap) {
    const d = (snap && snap.data) || {};
    return Object.keys(d).sort().map(k => ({
      key: k, ko: label(k), summary: summarize(k, d[k])
    }));
  }

  /* ── 합치기 ────────────────────────────────────────────────────────────── */
  function idOf(x) { return (x && typeof x === "object" && x.id) ? String(x.id) : null; }

  function mergeValue(cur, inc) {
    if (Array.isArray(cur) && Array.isArray(inc)) {
      const seen = {};
      cur.forEach(function (x) { const k = idOf(x); if (k) seen[k] = 1; });
      const add = inc.filter(function (x) {
        const k = idOf(x);
        if (k) return !seen[k];
        /* id 가 없는 항목(프리셋 등)은 통째로 같은 것이 있는지로 판단합니다 */
        const s = JSON.stringify(x);
        return cur.every(y => JSON.stringify(y) !== s);
      });
      return cur.concat(add);
    }
    if (isPlain(cur) && isPlain(inc)) {
      const out = Object.assign({}, cur);
      Object.keys(inc).forEach(function (k) {
        out[k] = Object.prototype.hasOwnProperty.call(cur, k) ? mergeValue(cur[k], inc[k]) : inc[k];
      });
      return out;
    }
    /* 스칼라가 부딪히면 내 것을 남깁니다 — 덮어쓰지 않는 것이 이 시스템의 규칙 */
    return cur === undefined ? inc : cur;
  }

  /* 합쳤을 때 몇 건이 새로 들어오는지 미리 셉니다 */
  function previewMerge(snap) {
    const d = (snap && snap.data) || {};
    return Object.keys(d).sort().map(function (k) {
      const cur = readKey(k);
      const before = JSON.stringify(cur === undefined ? null : cur);
      const after = JSON.stringify(cur === undefined ? d[k] : mergeValue(cur, d[k]));
      const nb = countAll(cur), na = countAll(cur === undefined ? d[k] : mergeValue(cur, d[k]));
      return {
        key: k, ko: label(k),
        changed: before !== after,
        added: Math.max(0, na - nb),
        summary: summarize(k, d[k])
      };
    });
  }
  function countAll(v) {
    if (v === undefined || v === null) return 0;
    if (Array.isArray(v)) return v.length + v.reduce((n, x) => n + (isPlain(x) ? 0 : 0), 0);
    if (isPlain(v)) return Object.keys(v).reduce((n, k) => n + countAll(v[k]), 0);
    return 0;
  }

  /* ── 파일 ──────────────────────────────────────────────────────────────── */
  function filename() {
    const d = new Date();
    const p = n => String(n).padStart(2, "0");
    return "bio-hub-backup_" + d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      "_" + p(d.getHours()) + p(d.getMinutes()) + ".json";
  }

  function download() {
    const snap = snapshot();
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return snap;
  }

  function parse(text) {
    let o;
    try { o = JSON.parse(text); }
    catch (e) { return { ok: false, reason: "JSON 파일이 아닙니다." }; }
    if (!o || typeof o !== "object") return { ok: false, reason: "내용을 읽지 못했습니다." };
    if (o.app !== APP) return { ok: false, reason: "이 시스템의 백업 파일이 아닙니다 (app: " + esc(o.app) + ")." };
    if (!o.data || typeof o.data !== "object") return { ok: false, reason: "데이터가 들어 있지 않습니다." };
    /* 담지 않기로 한 것이 파일에 있어도 무시합니다 — 남의 로그인이 들어오면 안 됩니다 */
    SKIP.forEach(k => { delete o.data[k]; });
    return { ok: true, snap: o };
  }

  function restore(snap, mode) {
    const d = (snap && snap.data) || {};
    const keysIn = Object.keys(d);
    if (!keysIn.length) return { ok: false, reason: "가져올 항목이 없습니다." };
    let n = 0;
    try {
      if (mode === "replace") {
        /* 교체는 이 시스템이 쓰는 키만 지웁니다 — 다른 앱의 저장소는 건드리지 않습니다 */
        keys().forEach(k => localStorage.removeItem(k));
        keysIn.forEach(function (k) { localStorage.setItem(k, JSON.stringify(d[k])); n++; });
      } else {
        keysIn.forEach(function (k) {
          const cur = readKey(k);
          const merged = cur === undefined ? d[k] : mergeValue(cur, d[k]);
          localStorage.setItem(k, JSON.stringify(merged));
          n++;
        });
      }
    } catch (e) {
      return { ok: false, reason: "저장에 실패했습니다 — 브라우저 저장 공간이 부족할 수 있습니다." };
    }
    return { ok: true, count: n };
  }

  /* ══════════════════════════════════════════════════════════════════════
     화면 — 모든 페이지 상단바에서 열립니다
     ══════════════════════════════════════════════════════════════════════ */
  let pending = null;      // 읽어 둔 파일 (아직 적용 전)
  let msg = null, msgTone = null;

  function open() {
    if (document.getElementById("bk-modal")) return;
    pending = null; msg = null; msgTone = null;
    const d = document.createElement("div");
    d.className = "modal";
    d.id = "bk-modal";
    d.setAttribute("role", "dialog");
    d.setAttribute("aria-modal", "true");
    d.setAttribute("aria-label", "데이터 내보내기 및 가져오기");
    d.innerHTML = boxMarkup();
    document.body.appendChild(d);
    d.addEventListener("click", e => { if (e.target === d) close(); });
    document.addEventListener("keydown", onKey, true);
    wire();
    setTimeout(() => { const b = $("#bk-x"); if (b) b.focus(); }, 30);
  }

  function close() {
    const el = document.getElementById("bk-modal");
    if (el) el.remove();
    document.removeEventListener("keydown", onKey, true);
    pending = null;
  }
  function onKey(e) {
    if (e.key === "Escape" && document.getElementById("bk-modal")) { close(); e.preventDefault(); }
  }

  function repaint() {
    const el = document.getElementById("bk-modal");
    if (!el) return;
    el.innerHTML = boxMarkup();
    wire();
  }

  function boxMarkup() {
    const rows = inspect(snapshot());
    const total = rows.reduce((n, r) => n + (r.summary === "비어 있음" || r.summary === "없음" ? 0 : 1), 0);

    return '<div class="modal-box">' +
      '<div class="modal-head"><div>' +
        '<h2 class="card-title">데이터 내보내기 · 가져오기</h2>' +
        '<p class="card-sub">이 시스템의 기록은 이 브라우저에만 있습니다. ' +
        '파일로 내려받아 두면 캐시를 지워도, PC 를 옮겨도 살아남습니다.</p></div>' +
        '<button class="btn-icon" id="bk-x" aria-label="닫기" style="margin-left:auto">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2.4"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>' +

      '<div class="modal-body">' +
        (msg ? '<p class="bk-msg is-' + (msgTone || "info") + '">' + esc(msg) + '</p>' : "") +

        '<div class="bk-sec-h">내보내기</div>' +
        '<table class="tbl bk-tbl"><thead><tr>' +
          '<th scope="col">항목</th><th scope="col">현재 이 브라우저에</th></tr></thead><tbody>' +
          rows.map(r => '<tr><td>' + esc(r.ko) + '</td><td class="mono">' + esc(r.summary) + '</td></tr>').join("") +
        '</tbody></table>' +
        '<p class="bk-note">로그인 정보와 내가 보던 조회 조건은 담지 않습니다 — ' +
          '남의 계정으로 열리거나, 남의 화면 필터를 물려받는 것을 막기 위해서입니다.</p>' +
        '<button class="btn btn-accent btn-sm" id="bk-export">' +
          (total ? "JSON 파일로 내려받기" : "내려받기 (아직 기록이 없습니다)") + '</button>' +

        '<div class="bk-sec-h" style="margin-top:var(--s-6)">가져오기</div>' +
        (pending ? importPreview() : importPicker()) +
      '</div>' +

      '<div class="modal-foot">' +
        '<button class="btn btn-ghost btn-sm" id="bk-close">닫기</button>' +
      '</div></div>';
  }

  function importPicker() {
    return '<div class="drop" id="bk-drop" tabindex="0" role="button" aria-label="백업 파일 선택">' +
      '<strong>백업 JSON 파일을 여기에 놓거나 클릭해 선택</strong><br>' +
      '<span style="font-size:12px;color:var(--c-text-mute)">' +
      '무엇이 들어오는지 먼저 보여 드리고, 확인한 뒤에 적용합니다</span>' +
      '<input type="file" id="bk-file" accept=".json,application/json" style="display:none"></div>';
  }

  function importPreview() {
    const rows = previewMerge(pending);
    const anyChange = rows.some(r => r.changed);
    return '<div class="bk-file">' +
        '<b>' + esc(pending.__name || "백업 파일") + '</b> · ' +
        esc(String(pending.exportedAt || "").replace("T", " ")) + ' · ' +
        esc(pending.exportedBy || "—") + ' 내보냄' +
      '</div>' +
      '<table class="tbl bk-tbl"><thead><tr>' +
        '<th scope="col">항목</th><th scope="col">파일 안에</th><th scope="col">합치면</th>' +
      '</tr></thead><tbody>' +
      rows.map(r => '<tr><td>' + esc(r.ko) + '</td><td class="mono">' + esc(r.summary) + '</td>' +
        '<td class="mono">' + (r.added ? "+" + r.added + "건 추가" :
          r.changed ? "변경" : "바뀌는 것 없음") + '</td></tr>').join("") +
      '</tbody></table>' +

      '<div class="bk-modes">' +
        '<label class="bk-mode"><input type="radio" name="bk-mode" value="merge" checked>' +
          '<span><b>합치기</b> — 없는 것만 추가합니다. 같은 칸에 내 값이 이미 있으면 ' +
          '<b>내 것을 남깁니다</b>. 덮어쓰지 않습니다.</span></label>' +
        '<label class="bk-mode"><input type="radio" name="bk-mode" value="replace">' +
          '<span><b>전체 교체</b> — 이 브라우저의 기록을 지우고 파일 내용으로 바꿉니다. ' +
          '되돌릴 수 없으니 먼저 내려받아 두세요.</span></label>' +
      '</div>' +
      (anyChange ? "" : '<p class="bk-note">합쳐도 바뀌는 것이 없습니다 — 이미 같은 내용을 갖고 있습니다.</p>') +
      '<div class="bk-actions">' +
        '<button class="btn btn-accent btn-sm" id="bk-apply">적용하고 새로고침</button>' +
        '<button class="btn btn-ghost btn-sm" id="bk-cancel">파일 다시 고르기</button>' +
      '</div>';
  }

  function wire() {
    const x = $("#bk-x"), c = $("#bk-close");
    if (x) x.addEventListener("click", close);
    if (c) c.addEventListener("click", close);

    const ex = $("#bk-export");
    if (ex) ex.addEventListener("click", function () {
      download();
      msg = "내려받았습니다. 이 파일이 있으면 캐시를 지워도 되돌릴 수 있습니다.";
      msgTone = "ok";
      repaint();
    });

    const drop = $("#bk-drop"), file = $("#bk-file");
    if (drop && file) {
      drop.addEventListener("click", () => file.click());
      drop.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); }
      });
      file.addEventListener("change", () => take(file.files && file.files[0]));
      ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => {
        e.preventDefault(); drop.classList.add("is-over");
      }));
      ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => {
        e.preventDefault(); drop.classList.remove("is-over");
      }));
      drop.addEventListener("drop", e => {
        if (e.dataTransfer && e.dataTransfer.files) take(e.dataTransfer.files[0]);
      });
    }

    const cancel = $("#bk-cancel");
    if (cancel) cancel.addEventListener("click", function () {
      pending = null; msg = null; repaint();
    });

    const apply = $("#bk-apply");
    if (apply) apply.addEventListener("click", function () {
      const sel = document.querySelector('input[name="bk-mode"]:checked');
      const mode = sel ? sel.value : "merge";
      const r = restore(pending, mode);
      if (!r.ok) { msg = r.reason; msgTone = "bad"; repaint(); return; }
      /* 각 모듈이 로드 시점에 저장소를 읽어 메모리에 들고 있어, 새로고침해야
         화면이 새 데이터를 씁니다. */
      location.reload();
    });
  }

  function take(f) {
    if (!f) return;
    const fr = new FileReader();
    fr.onload = function () {
      const r = parse(String(fr.result || ""));
      if (!r.ok) { pending = null; msg = r.reason; msgTone = "bad"; repaint(); return; }
      r.snap.__name = f.name;
      pending = r.snap; msg = null; msgTone = null;
      repaint();
    };
    fr.onerror = function () { msg = "파일을 읽지 못했습니다."; msgTone = "bad"; repaint(); };
    fr.readAsText(f, "UTF-8");
  }

  return { snapshot, inspect, previewMerge, download, parse, restore, filename,
           open, close, keys, SKIP, _mergeValue: mergeValue };
})();
