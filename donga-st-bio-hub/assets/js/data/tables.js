/* ==========================================================================
   tables.js — 질의 대상 테이블 계층  ·  window.AskTables

   자연어 질의 엔진(ask.js)이 한 가지 모양만 알면 되도록, 두 출처를 같은
   형태로 정규화합니다.

     1) 내부 데이터 — DATA_BATCHES + downstream + Sample 분석값 + EBR 입력값
     2) 업로드 파일 — 사용자가 올린 .csv / .xlsx / .xls

   테이블 모양:
     { id, label, kind: "internal" | "upload", note,
       columns: [{ key, label, unit, type: "num"|"text"|"date", group }],
       rows:    [{ __id, __label, ...컬럼값 }] }

   내부 테이블의 값은 반드시 Repo.valueOf 를 거칩니다 — 분석 항목은 시료
   귀속이고 EBR 입력값이 원본을 덮어쓰는 규칙이 이미 그 안에 있습니다.
   여기서 배치 객체를 직접 들여다보면 그 규칙을 두 번 구현하게 됩니다.

   파싱은 브라우저에서만 일어나며 업로드한 파일은 이 브라우저를 벗어나지
   않습니다.
   ========================================================================== */

window.AskTables = (function () {
  "use strict";

  const XLSX_CDN = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";

  /* 업로드된 테이블들 — 새로고침하면 사라집니다 (파일을 저장하지 않습니다) */
  const uploaded = [];
  let internalCache = null;
  const subs = [];

  function on(fn) { subs.push(fn); return () => { const i = subs.indexOf(fn); if (i > -1) subs.splice(i, 1); }; }
  function emit() { subs.slice().forEach(fn => { try { fn(); } catch (e) { /* 구독자 하나가 전체를 막지 않도록 */ } }); }

  /* ══════════════════════════════════════════════════════════════════════
     1. 내부 데이터 → 테이블
     ══════════════════════════════════════════════════════════════════════ */

  /* 배치 1건이 행 1개입니다. 분석 항목은 대표 시료 값이 들어옵니다. */
  function buildInternal() {
    const R = window.Repo;
    const batches = (window.DATA_BATCHES || []).filter(b => b.active !== false);
    /* Repo.getAnalyteGroups() 는 Promise 를 돌려줍니다 (비동기 API 흉내).
       테이블 구성은 동기라야 해서 원본 배열을 그대로 씁니다. */
    const groups = window.DATA_ANALYTE_GROUPS || [];

    const columns = [
      { key: "__label",  label: "Batch",      unit: "",   type: "text", group: "base" },
      { key: "project",  label: "과제",        unit: "",   type: "text", group: "base" },
      { key: "study",    label: "Study",      unit: "",   type: "text", group: "base" },
      { key: "team",     label: "팀",          unit: "",   type: "text", group: "base" },
      { key: "date",     label: "시작일",      unit: "",   type: "date", group: "base" },
      { key: "endDate",  label: "종료일",      unit: "",   type: "date", group: "base" },
      { key: "cultureDays", label: "배양 일수", unit: "일", type: "num",  group: "base" }
    ];

    groups.forEach(g => g.items.forEach(it => {
      columns.push({
        key: R ? R.fieldKey(g.id, it.key) : (g.id + "_" + it.key),
        label: it.label, unit: it.unit || "", dp: it.dp,
        type: "num", group: g.id, groupLabel: g.label, team: g.team
      });
    }));

    const rows = batches.map(b => {
      /* studyOf 는 배치 객체를 받습니다 (studyId 가 아니라) */
      const study = R ? R.studyOf(b) : (window.DATA_STUDIES || []).find(s => s.id === b.studyId) || null;
      const row = {
        __id: b.id,
        __label: b.expNo || b.id,
        project: study ? projectCode(study.projectId) : null,
        study: study ? study.name : null,
        team: teamKo(b.team),
        date: b.initialDate || null,
        endDate: b.endDate || null,
        cultureDays: b.cultureDays == null ? null : b.cultureDays
      };
      groups.forEach(g => g.items.forEach(it => {
        const k = R ? R.fieldKey(g.id, it.key) : (g.id + "_" + it.key);
        row[k] = R ? numeric(R.valueOf(b, g.id, it.key)) : null;
      }));
      return row;
    });

    return {
      id: "internal", kind: "internal",
      label: "사내 실험 데이터 (Batch)",
      note: "배양·분석 항목은 Batch_Data_example.xlsx 원본입니다. 정제 항목은 원본에 컬럼이 없어 생성한 값입니다.",
      columns, rows
    };
  }

  function projectCode(projectId) {
    const p = (window.DATA_PROJECTS || []).find(x => x.id === projectId);
    return p ? p.code : null;
  }
  function teamKo(id) {
    const t = (window.DATA_TEAMS || []).find(x => x.id === id);
    return t ? t.ko : (id || null);
  }
  /* 값 모델({num,qual,miss})이든 맨 숫자든 하나로 — 한정자는 경계값을 씁니다 */
  function numeric(v) {
    if (v === null || v === undefined) return null;
    if (window.VAL && window.VAL.isVal && window.VAL.isVal(v)) return window.VAL.numeric(v);
    return typeof v === "number" && isFinite(v) ? v : null;
  }

  function internal() {
    if (!internalCache) internalCache = buildInternal();
    return internalCache;
  }
  /* EBR 입력이 바뀌면 내부 테이블을 다시 만들어야 합니다 */
  function invalidate() { internalCache = null; emit(); }

  /* ══════════════════════════════════════════════════════════════════════
     2. 업로드 파일 → 테이블
     ══════════════════════════════════════════════════════════════════════ */

  /* CSV 는 자체 파싱합니다 — 이것 때문에 400KB 라이브러리를 받을 이유가 없습니다.
     따옴표 안의 쉼표·줄바꿈·이스케이프("")를 처리합니다 (RFC 4180). */
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", inQuotes = false;
    const s = String(text).replace(/^﻿/, "");   // BOM 제거
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQuotes) {
        if (c === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
        continue;
      }
      if (c === '"') { inQuotes = true; continue; }
      if (c === ",") { row.push(field); field = ""; continue; }
      if (c === "\r") continue;
      if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
      field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /* 탭 구분 파일도 흔히 .csv 로 저장됩니다 — 첫 줄로 구분자를 판단합니다 */
  function sniffDelimiter(text) {
    const first = String(text).split(/\r?\n/).find(l => l.trim().length) || "";
    const tabs = (first.match(/\t/g) || []).length;
    const commas = (first.match(/,/g) || []).length;
    const semis = (first.match(/;/g) || []).length;
    if (tabs > commas && tabs > semis) return "\t";
    if (semis > commas) return ";";
    return ",";
  }
  function splitSimple(text, delim) {
    return String(text).replace(/^﻿/, "").split(/\r?\n/)
      .map(l => l.split(delim));
  }

  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise(function (resolve, reject) {
      const s = document.createElement("script");
      s.src = XLSX_CDN;
      s.onload = () => window.XLSX ? resolve(window.XLSX) : reject(new Error("XLSX 로드 실패"));
      s.onerror = () => reject(new Error("엑셀 파서를 불러오지 못했습니다. 네트워크를 확인하거나 CSV로 저장해 올려 주세요."));
      document.head.appendChild(s);
    });
  }

  /* 머리글 행 찾기 — 비어 있지 않은 셀이 2개 이상인 첫 행.
     엑셀 시트는 위쪽에 제목·공백 행이 흔해서 1행 고정은 자주 틀립니다. */
  function findHeader(matrix) {
    for (let i = 0; i < Math.min(matrix.length, 30); i++) {
      const filled = (matrix[i] || []).filter(c => String(c == null ? "" : c).trim() !== "");
      if (filled.length >= 2) return i;
    }
    return 0;
  }

  const NUM_RE = /^-?[\d,]*\.?\d+(?:[eE][-+]?\d+)?$/;
  function toNum(raw) {
    if (typeof raw === "number") return isFinite(raw) ? raw : null;
    const s = String(raw == null ? "" : raw).trim().replace(/,/g, "");
    if (s === "" || !NUM_RE.test(s.replace(/,/g, ""))) return null;
    const n = Number(s);
    return isFinite(n) ? n : null;
  }
  const DATE_RE = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/;
  function isDateish(raw) { return DATE_RE.test(String(raw == null ? "" : raw).trim()); }

  /* "Titer (mg/L)" → { label: "Titer", unit: "mg/L" } */
  function splitUnit(h) {
    const s = String(h == null ? "" : h).trim();
    const m = s.match(/^(.*?)[\s]*[\(（\[]([^)）\]]{1,16})[\)）\]]\s*$/);
    if (m && m[1].trim()) return { label: m[1].trim(), unit: m[2].trim() };
    return { label: s, unit: "" };
  }

  function matrixToTable(matrix, id, label, note) {
    if (!matrix || !matrix.length) return null;
    const hi = findHeader(matrix);
    const header = matrix[hi] || [];
    const body = matrix.slice(hi + 1).filter(r => (r || []).some(c => String(c == null ? "" : c).trim() !== ""));
    if (!header.length || !body.length) return null;

    /* 컬럼 키는 위치 기반입니다 — 머리글이 중복되거나 비어 있어도 안전합니다 */
    const columns = header.map(function (h, i) {
      const u = splitUnit(h);
      return { key: "c" + i, label: u.label || ("컬럼 " + (i + 1)), unit: u.unit, idx: i, type: "text", group: "upload" };
    });

    /* 타입 추론 — 비어 있지 않은 값의 60% 이상이 숫자면 숫자 컬럼 */
    columns.forEach(function (col) {
      let filled = 0, nums = 0, dates = 0;
      body.forEach(function (r) {
        const raw = r[col.idx];
        if (String(raw == null ? "" : raw).trim() === "") return;
        filled++;
        if (toNum(raw) !== null) nums++;
        if (isDateish(raw)) dates++;
      });
      if (!filled) { col.type = "text"; return; }
      if (dates / filled >= 0.6) col.type = "date";
      else if (nums / filled >= 0.6) col.type = "num";
      else col.type = "text";
    });

    /* 행 이름표 — 첫 번째 텍스트 컬럼(대개 Batch ID·시료명). 없으면 행 번호. */
    const labelCol = columns.find(c => c.type === "text") || null;

    const rows = body.map(function (r, i) {
      const row = { __id: id + "-r" + i, __label: labelCol ? String(r[labelCol.idx] == null ? "" : r[labelCol.idx]).trim() || ("행 " + (i + 1)) : ("행 " + (i + 1)) };
      columns.forEach(function (col) {
        const raw = r[col.idx];
        row[col.key] = col.type === "num" ? toNum(raw)
          : (String(raw == null ? "" : raw).trim() || null);
      });
      return row;
    });

    return { id, kind: "upload", label, note, columns, rows };
  }

  /* 파일 1개 → 테이블 배열 (엑셀은 시트마다 1개) */
  function readFile(file) {
    const name = file.name || "업로드 파일";
    const ext = (name.split(".").pop() || "").toLowerCase();

    if (ext === "csv" || ext === "tsv" || ext === "txt") {
      return readText(file).then(function (text) {
        const delim = ext === "tsv" ? "\t" : sniffDelimiter(text);
        const matrix = delim === "," ? parseCSV(text) : splitSimple(text, delim);
        const t = matrixToTable(matrix, uid(), name, "업로드한 파일 · " + name);
        if (!t) throw new Error("표를 찾지 못했습니다. 첫 행에 머리글이 있는지 확인해 주세요.");
        return [t];
      });
    }

    if (ext === "xlsx" || ext === "xls" || ext === "xlsm") {
      return Promise.all([loadXLSX(), readBuffer(file)]).then(function (r) {
        const XLSX = r[0], buf = r[1];
        const wb = XLSX.read(buf, { type: "array" });
        const out = [];
        wb.SheetNames.forEach(function (sn) {
          const matrix = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null });
          const t = matrixToTable(matrix, uid(),
            wb.SheetNames.length > 1 ? name + " · " + sn : name,
            "업로드한 파일 · " + name + (wb.SheetNames.length > 1 ? " / 시트 " + sn : ""));
          if (t) out.push(t);
        });
        if (!out.length) throw new Error("시트에서 표를 찾지 못했습니다.");
        return out;
      });
    }

    return Promise.reject(new Error(
      "지원하지 않는 형식입니다 (." + ext + "). CSV · XLSX · XLS 만 읽을 수 있습니다."));
  }

  function readText(file) {
    return new Promise(function (res, rej) {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result || ""));
      fr.onerror = () => rej(new Error("파일을 읽지 못했습니다."));
      fr.readAsText(file, "UTF-8");
    });
  }
  function readBuffer(file) {
    return new Promise(function (res, rej) {
      const fr = new FileReader();
      fr.onload = () => res(new Uint8Array(fr.result));
      fr.onerror = () => rej(new Error("파일을 읽지 못했습니다."));
      fr.readAsArrayBuffer(file);
    });
  }

  let seq = 0;
  function uid() { return "up-" + (++seq) + "-" + Date.now().toString(36); }

  function addFile(file) {
    return readFile(file).then(function (tables) {
      tables.forEach(t => uploaded.push(t));
      emit();
      return tables;
    });
  }
  function remove(id) {
    const i = uploaded.findIndex(t => t.id === id);
    if (i > -1) { uploaded.splice(i, 1); emit(); return true; }
    return false;
  }

  /* ══════════════════════════════════════════════════════════════════════
     3. 조회
     ══════════════════════════════════════════════════════════════════════ */
  function all() { return [internal()].concat(uploaded); }
  function uploads() { return uploaded.slice(); }
  function get(id) { return all().find(t => t.id === id) || null; }

  /* 컬럼 중 숫자형만 — 집계 질의가 붙을 수 있는 후보 */
  function numericColumns(table) { return table.columns.filter(c => c.type === "num"); }

  /* 값이 하나라도 들어 있는 행 수 */
  function filledCount(table, key) {
    return table.rows.reduce((n, r) => n + (r[key] === null || r[key] === undefined ? 0 : 1), 0);
  }

  return {
    on, internal, invalidate, all, uploads, get, addFile, remove,
    numericColumns, filledCount,
    /* 검증·테스트용 */
    _parseCSV: parseCSV, _matrixToTable: matrixToTable, _splitUnit: splitUnit
  };
})();
