/* ==========================================================================
   XlsxOut — 엑셀 파일을 만드는 **한 곳**

   조회 표 · 그래프 화면 · DoE 분석이 각자 워크북을 만들면, 숫자 타입이나
   고지 시트, CSV 폴백이 한쪽에만 붙는 날이 옵니다. 받는 사람은 어느
   파일이 온전한지 알 수 없습니다 — 그래서 만드는 자리를 하나로 둡니다.

   엑셀 라이브러리(SheetJS)는 AskTables.loadXLSX 가 필요할 때 CDN 에서
   한 번만 받아 옵니다. 사내망에서 그 CDN 이 막히면 **내보내기 자체가
   실패하는 대신** CSV 로 내려갑니다 — 파일을 못 받는 것이 가장 나쁩니다.

   write(sheets, base, opts)
     sheets : [{ name, aoa, cols? }]  — 첫 시트에 머리글 고정
     base   : 확장자 없는 파일 이름
     opts   : { onDone(kind), onFallback(why), csv, images }
              csv 를 주면 폴백 때 그 글자를 그대로 씁니다 (고지 줄이 붙은
              CSV 처럼, 첫 시트를 그대로 옮기면 안 되는 경우).
              images 는 [{ png, w, h }] — 화면에 보이던 그래프를 그림으로
              같이 넣습니다 (아래 참고).

   ── 그래프 이미지 ────────────────────────────────────────────────────────
   숫자만 넘기면 받는 사람이 화면에서 본 그림을 다시 만들어야 합니다. 그래서
   화면의 SVG 를 그대로 PNG 로 떠서 [차트 이미지] 시트에 넣습니다.

   ★ SheetJS 무료판은 **그림을 넣지 못합니다.** 그래서 SheetJS 가 만든
     xlsx(=zip) 를 열어 OOXML 그림 부품(media · drawing · rels · 콘텐츠
     형식)을 직접 넣습니다. 지퍼는 fflate 로 엽니다.

   ★ 이 길이 막히면(압축 모듈 차단 · 캡처 실패 등) **그림만 빼고** 나머지는
     그대로 내보냅니다. 그림 때문에 숫자까지 못 받는 일은 없어야 합니다.
   ========================================================================== */

window.XlsxOut = (function () {
  "use strict";

  const ZIP_CDN = "https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js";

  /* ── 화면의 SVG 를 PNG 로 ──────────────────────────────────────────────
     그림은 "화면에 보이던 그대로" 여야 합니다. 두 가지를 손봅니다:

       1. 색과 글꼴이 CSS 변수(var(--c-...))로 적혀 있습니다. SVG 를 따로
          떼어 내면 그 변수를 풀어 줄 문서가 없어 **선과 글자가 사라집니다.**
          그래서 뜨기 전에 변수를 실제 값으로 바꿔 둡니다.
       2. 배경이 투명하면 엑셀에서 눈금선 위에 얹혀 읽기 어렵습니다 —
          흰 바탕을 깔아 줍니다. */
  function cssVars(text) {
    const root = getComputedStyle(document.documentElement);
    return String(text).replace(/var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)/g, function (m, name) {
      const raw = (root.getPropertyValue(name) || "").trim();
      const isFont = name.indexOf("font") > -1;
      if (!raw) return isFont ? "sans-serif" : "#334155";
      /* ★ 글꼴 변수 값에는 따옴표가 들어 있습니다 — "IBM Plex Mono", monospace.
         이 값이 속성 안에 그대로 들어가면 따옴표가 겹쳐 XML 이 깨지고,
         그림이 통째로 뜨지 않습니다. 작은따옴표로 바꿔 끼웁니다. */
      return raw.replace(/"/g, "'");
    });
  }

  function svgToPng(svg, scale) {
    return new Promise(function (resolve, reject) {
      if (!svg) { reject(new Error("그릴 그래프가 없습니다")); return; }
      const vb = (svg.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
      const w = (vb.length === 4 && vb[2]) ? vb[2] : (svg.clientWidth || 820);
      const h = (vb.length === 4 && vb[3]) ? vb[3] : (svg.clientHeight || 260);
      const k = scale || 2;

      const clone = svg.cloneNode(true);
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", w);
      clone.setAttribute("height", h);
      const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      bg.setAttribute("x", 0); bg.setAttribute("y", 0);
      bg.setAttribute("width", w); bg.setAttribute("height", h);
      bg.setAttribute("fill", "#ffffff");
      clone.insertBefore(bg, clone.firstChild);

      const text = cssVars(new XMLSerializer().serializeToString(clone));
      const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(text);
      const img = new Image();
      img.onload = function () {
        try {
          const c = document.createElement("canvas");
          c.width = Math.round(w * k); c.height = Math.round(h * k);
          const ctx = c.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          resolve({ png: c.toDataURL("image/png"), w: w, h: h });
        } catch (e) { reject(e); }
      };
      img.onerror = function () { reject(new Error("그래프를 그림으로 뜨지 못했습니다")); };
      img.src = url;
    });
  }

  /* 화면에서 그래프를 찾아 그림으로 뜹니다 (여러 장이면 차례대로).
     한 장이라도 실패하면 그 장만 빼고 갑니다 — 그림 때문에 파일 전체를
     못 받는 일은 없어야 합니다. */
  function captureCharts(sel, max) {
    const nodes = Array.prototype.slice.call(document.querySelectorAll(sel))
      .slice(0, max || 4);
    if (!nodes.length) return Promise.resolve([]);
    return Promise.all(nodes.map(n => svgToPng(n).catch(() => null)))
      .then(list => list.filter(Boolean));
  }

  function loadZip() {
    if (window.fflate) return Promise.resolve(window.fflate);
    return new Promise(function (resolve, reject) {
      const s = document.createElement("script");
      s.src = ZIP_CDN;
      s.onload = () => window.fflate ? resolve(window.fflate) : reject(new Error("압축 모듈 없음"));
      s.onerror = () => reject(new Error("압축 모듈을 불러오지 못했습니다"));
      document.head.appendChild(s);
    });
  }

  /* ── xlsx(zip) 에 그림 부품을 끼워 넣습니다 ───────────────────────────
     SheetJS 가 만든 통합문서를 열어, 지정한 시트에 그림을 얹습니다.
     넣는 것: xl/media/imageN.png · xl/drawings/drawing1.xml(+rels) ·
              해당 시트의 rels · 시트 XML 의 <drawing> 한 줄 ·
              [Content_Types].xml 의 png / drawing 선언.
     하나라도 어긋나면 엑셀이 "복구" 를 물으므로, 넣기 전에 대상 시트를
     실제로 찾았는지 확인하고 못 찾으면 **그림 없이** 돌려보냅니다. */
  function attachImages(buf, sheetName, images, fflate) {
    const zip = fflate.unzipSync(new Uint8Array(buf));
    const dec = new TextDecoder("utf-8");
    const enc = new TextEncoder();
    const read = p => zip[p] ? dec.decode(zip[p]) : null;
    const put = (p, s) => { zip[p] = enc.encode(s); };

    /* 1) 시트 이름 → 파일 경로 (workbook.xml 의 r:id 를 rels 에서 풉니다) */
    const wb = read("xl/workbook.xml");
    const rels = read("xl/_rels/workbook.xml.rels");
    if (!wb || !rels) throw new Error("통합문서 구조를 읽지 못했습니다");
    const sheetTag = (wb.match(/<sheet[^>]*\/>/g) || [])
      .find(t => t.indexOf('name="' + sheetName + '"') > -1);
    if (!sheetTag) throw new Error("그림을 넣을 시트를 찾지 못했습니다");
    const rid = (sheetTag.match(/r:id="([^"]+)"/) || [])[1];
    const relTag = (rels.match(/<Relationship[^>]*\/>/g) || [])
      .find(t => t.indexOf('Id="' + rid + '"') > -1);
    const target = (relTag && (relTag.match(/Target="([^"]+)"/) || [])[1]) || "";
    const path = "xl/" + target.replace(/^\/?xl\//, "").replace(/^\//, "");
    let sheetXml = read(path);
    if (!sheetXml) throw new Error("시트 파일을 찾지 못했습니다");

    /* 2) 그림 조각 — 한 시트에 여러 장이면 아래로 쌓습니다 */
    const EMU = 9525;             /* 1px */
    const ROW = 20;               /* 기본 행 높이(px) — 다음 그림 자리를 잡는 데만 씁니다 */
    let row = 3;                  /* 머리말 두 줄 아래부터 */
    const anchors = [], relLines = [];
    images.forEach(function (im, i) {
      const n = i + 1;
      const bin = atob(String(im.png).split(",")[1] || "");
      const bytes = new Uint8Array(bin.length);
      for (let b = 0; b < bin.length; b++) bytes[b] = bin.charCodeAt(b);
      zip["xl/media/image" + n + ".png"] = bytes;
      relLines.push('<Relationship Id="rIdImg' + n + '" Type="http://schemas.openxmlformats.org/' +
        'officeDocument/2006/relationships/image" Target="../media/image' + n + '.png"/>');
      anchors.push(
        '<xdr:oneCellAnchor>' +
          '<xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff>' +
            '<xdr:row>' + row + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>' +
          '<xdr:ext cx="' + Math.round(im.w * EMU) + '" cy="' + Math.round(im.h * EMU) + '"/>' +
          '<xdr:pic>' +
            '<xdr:nvPicPr><xdr:cNvPr id="' + n + '" name="chart' + n + '"/>' +
              '<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>' +
            '<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/' +
              '2006/relationships" r:embed="rIdImg' + n + '"/>' +
              '<a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
            '<xdr:spPr><a:xfrm><a:off x="0" y="0"/>' +
              '<a:ext cx="' + Math.round(im.w * EMU) + '" cy="' + Math.round(im.h * EMU) + '"/></a:xfrm>' +
              '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>' +
          '</xdr:pic><xdr:clientData/>' +
        '</xdr:oneCellAnchor>');
      row += Math.ceil(im.h / ROW) + 2;
    });

    put("xl/drawings/drawing1.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ' +
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' + anchors.join("") + '</xdr:wsDr>');
    put("xl/drawings/_rels/drawing1.xml.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      relLines.join("") + '</Relationships>');

    /* 3) 시트 → 그림 연결 */
    const sheetRelPath = path.replace(/^xl\/worksheets\//, "xl/worksheets/_rels/") + ".rels";
    put(sheetRelPath,
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdDraw1" Type="http://schemas.openxmlformats.org/officeDocument/2006/' +
      'relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>');

    if (sheetXml.indexOf("xmlns:r=") === -1) {
      sheetXml = sheetXml.replace(/<worksheet([^>]*)>/,
        '<worksheet$1 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">');
    }
    if (sheetXml.indexOf("<drawing ") === -1) {
      sheetXml = sheetXml.replace("</worksheet>", '<drawing r:id="rIdDraw1"/></worksheet>');
    }
    put(path, sheetXml);

    /* 4) 콘텐츠 형식 — 빠지면 엑셀이 파일을 복구하려 듭니다 */
    let ct = read("[Content_Types].xml");
    if (!ct) throw new Error("콘텐츠 형식을 읽지 못했습니다");
    if (ct.indexOf('Extension="png"') === -1) {
      ct = ct.replace("<Types ", '<Types ').replace(/(<Types[^>]*>)/,
        '$1<Default Extension="png" ContentType="image/png"/>');
    }
    if (ct.indexOf("/xl/drawings/drawing1.xml") === -1) {
      ct = ct.replace("</Types>",
        '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.' +
        'openxmlformats-officedocument.drawing+xml"/></Types>');
    }
    put("[Content_Types].xml", ct);

    return fflate.zipSync(zip, { level: 6 });
  }

  function saveBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* 엑셀이 여는 CSV — BOM 을 붙여야 한글이 깨지지 않습니다 */
  function csvOf(aoa) {
    const q = v => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return (aoa || []).map(r => r.map(q).join(",")).join("\r\n");
  }

  /* 컬럼 너비 — 글자 수에 맞춥니다. 기본값이면 머리글이 "####" 로 잘려
     나와, 받는 사람이 매번 폭을 늘려야 합니다. */
  function widthsOf(aoa) {
    const head = aoa[0] || [];
    return head.map(function (h, ci) {
      let w = String(h === null || h === undefined ? "" : h).length;
      for (let r = 1; r < aoa.length; r++) {
        const v = (aoa[r] || [])[ci];
        const n = String(v === null || v === undefined ? "" : v).length;
        if (n > w) w = n;
      }
      return { wch: Math.min(Math.max(w + 2, 8), 46) };
    });
  }

  function write(sheets, base, opts) {
    const o = opts || {};
    /* 파일을 내려보내는 자리를 바꿔 끼울 수 있게 둡니다 — 검사에서 실제
       다운로드를 일으키지 않고 무엇이 나갈지 확인하기 위해서입니다. */
    const save = typeof o.save === "function" ? o.save : saveBlob;
    const list = (sheets || []).filter(s => s && s.aoa && s.aoa.length);
    if (!list.length) { if (o.onFallback) o.onFallback("내보낼 내용 없음"); return; }

    function fallback(why) {
      const text = o.csv !== undefined && o.csv !== null ? o.csv : csvOf(list[0].aoa);
      save(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8;" }), base + ".csv");
      if (o.onFallback) o.onFallback(why);
    }

    if (!window.AskTables || !window.AskTables.loadXLSX) { fallback("엑셀 모듈 없음"); return; }

    /* 그림을 넣을 자리 — 시트는 여기서 만들어 둡니다. 그림이 들어가지
       못해도 이 시트는 왜 비었는지 말해 줍니다. */
    const imgs = (o.images || []).filter(im => im && im.png);
    const IMG_SHEET = "차트 이미지";
    const full = imgs.length
      ? list.concat([{ name: IMG_SHEET, cols: [{ wch: 120 }], aoa: [
          ["차트 이미지 — 화면에 보이던 그래프를 그대로 떴습니다"],
          ["그림 아래 숫자 시트가 원본입니다. 그림은 보기용이고, 값을 다시 계산할 때는 숫자 시트를 쓰세요."],
          [""]
        ] }])
      : list;

    window.AskTables.loadXLSX().then(function (XLSX) {
      const wb = XLSX.utils.book_new();
      full.forEach(function (s, i) {
        const ws = XLSX.utils.aoa_to_sheet(s.aoa);
        ws["!cols"] = s.cols || widthsOf(s.aoa);
        /* 머리글 고정 — 수백 행을 내려도 무엇의 값인지 보입니다 */
        if (i === 0) ws["!freeze"] = { xSplit: 0, ySplit: 1 };
        /* 시트 이름은 31자까지입니다. 넘치면 엑셀이 파일을 열지 못합니다. */
        XLSX.utils.book_append_sheet(wb, ws, String(s.name || ("시트" + (i + 1))).slice(0, 31));
      });
      const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });

      function send(buf, withImage) {
        save(new Blob([buf], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        }), base + ".xlsx");
        if (o.onDone) o.onDone("엑셀", { image: !!withImage });
      }

      if (!imgs.length) { send(out, false); return; }

      /* 그림 넣기가 실패하면 **그림만 빼고** 보냅니다. 왜 빠졌는지는
         부르는 쪽이 알 수 있게 onDone 에 알려 줍니다. */
      loadZip()
        .then(fflate => send(attachImages(out, IMG_SHEET, imgs, fflate), true))
        .catch(function () { send(out, false); });
    }).catch(function (e) { fallback((e && e.message) ? "네트워크" : ""); });
  }

  return { write: write, saveBlob: saveBlob, csvOf: csvOf,
           svgToPng: svgToPng, captureCharts: captureCharts };
})();
