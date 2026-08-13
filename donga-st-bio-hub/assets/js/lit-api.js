/* ==========================================================================
   lit-api.js — 외부 학술 문헌 실시간 검색  ·  window.LitAPI

   실제 공개 API 를 브라우저에서 직접 호출합니다. API 키도, 중계 서버도,
   비용도 없습니다. 결과는 전부 실측이며 출처 URL 이 함께 옵니다.

     · Europe PMC  — PubMed/MEDLINE·PMC·Agricola·특허초록 등을 아우르는
                     EMBL-EBI 의 공개 REST API. 초록·인용수·오픈액세스 여부까지.
     · Crossref    — DOI 등록 기관의 공개 메타데이터. 저널 논문 커버리지가 넓음.

   두 곳 모두 CORS 를 허용하므로 정적 페이지에서 바로 부를 수 있습니다.

   ⚠ 특허 전문 검색은 포함되지 않습니다. Google Patents 는 공개 API 가 없고
     PatentsView · Espacenet OPS 는 키가 필요합니다. 지어내는 대신 외부 검색
     링크를 제공합니다 (patentLinks).

   한글 질문은 그대로 검색하면 거의 잡히지 않습니다. 도메인 용어집으로 영문
   키워드를 만들고, 무엇으로 검색했는지 화면에 그대로 보여 줍니다.
   ========================================================================== */

window.LitAPI = (function () {
  "use strict";

  const EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
  const CROSSREF = "https://api.crossref.org/works";
  const TIMEOUT_MS = 12000;

  /* ── 한글 → 영문 검색어 용어집 ─────────────────────────────────────────
     바이오의약품 공정개발 도메인에 한정합니다. 없는 말은 억지로 바꾸지 않고
     그대로 둡니다 (영문 토큰은 어차피 그대로 검색어가 됩니다). */
  const GLOSSARY = [
    ["역가", "titer"], ["타이터", "titer"],
    ["생산성", "productivity"], ["비생산성", "specific productivity"],
    ["생존율", "cell viability"], ["세포 생존", "cell viability"],
    ["세포농도", "viable cell density"], ["세포 농도", "viable cell density"],
    ["유가배양", "fed-batch"], ["유가 배양", "fed-batch"], ["회분식", "batch culture"],
    ["관류배양", "perfusion culture"], ["관류", "perfusion"],
    ["세포배양", "cell culture"], ["배양", "cell culture"],
    ["배지", "cell culture media"], ["피드", "feed strategy"],
    ["세포주", "cell line"], ["세포주 개발", "cell line development"],
    ["정제", "downstream purification"], ["다운스트림", "downstream processing"],
    ["크로마토그래피", "chromatography"], ["친화크로마토그래피", "affinity chromatography"],
    ["양이온교환", "cation exchange chromatography"], ["음이온교환", "anion exchange chromatography"],
    ["한외여과", "ultrafiltration"], ["정용여과", "diafiltration"],
    ["바이러스 불활화", "viral inactivation"], ["바이러스", "virus clearance"],
    ["수율", "yield"], ["회수율", "recovery"], ["step yield", "step yield"],
    ["숙주세포단백", "host cell protein"], ["숙주세포 단백", "host cell protein"],
    ["잔류", "residual"], ["불순물", "impurity"],
    ["응집체", "aggregation"], ["응집", "aggregation"],
    ["당쇄", "glycosylation"], ["글리칸", "N-glycan"], ["당화", "glycosylation"],
    ["시알산", "sialylation"], ["고만노스", "high mannose"], ["푸코실", "fucosylation"],
    ["전하 변이체", "charge variant"], ["산성 변이체", "acidic variant"],
    ["단클론항체", "monoclonal antibody"], ["단일클론항체", "monoclonal antibody"],
    ["항체", "monoclonal antibody"], ["바이오시밀러", "biosimilar"],
    ["동등성", "biosimilarity"], ["유사성", "similarity assessment"],
    ["품질특성", "critical quality attribute"], ["핵심품질특성", "critical quality attribute"],
    ["공정변수", "critical process parameter"], ["공정개발", "bioprocess development"],
    ["실험계획법", "design of experiments"], ["설계기반품질", "quality by design"],
    ["스케일업", "scale-up"], ["스케일 업", "scale-up"], ["대량생산", "large scale production"],
    ["연속공정", "continuous bioprocessing"], ["공정분석기술", "process analytical technology"],
    ["안정성", "stability"], ["제형", "formulation"],
    ["분석법", "analytical method"], ["검증", "validation"],
    ["규제", "regulatory"], ["허가", "regulatory approval"],
    ["최적화", "optimization"]
    /* "최신" · "동향" 같은 수사는 일부러 검색어로 만들지 않습니다 —
       주제어가 아니라서 붙이면 결과의 관련도만 떨어집니다. */
  ];

  /* 한글 조사·불용어 — 검색어에서 걷어냅니다 */
  const STOP = ["알려줘", "알려", "찾아줘", "찾아", "검색", "관련", "대한", "대해", "논문",
    "문헌", "특허", "자료", "정보", "무엇", "뭐야", "어떤", "어떻게", "인가요", "인가",
    "있나요", "있어", "해줘", "주세요", "좀", "요약", "정리", "최근", "최신", "요즘",
    "동향", "그리고",
    "paper", "papers", "publication", "publications", "literature", "search", "find",
    "about", "regarding", "please", "recent", "latest", "advances", "review", "show",
    "me", "the", "a", "an", "of", "on", "for", "in", "and", "with"];

  /* 한글 질문 → 영문 검색어. 무엇으로 바꿨는지 함께 돌려줍니다. */
  function toQuery(raw) {
    let s = String(raw || "").trim();
    const terms = [], mapped = [];

    /* 1) 용어집 — 긴 표현부터 (부분어가 먼저 먹지 않도록) */
    GLOSSARY.slice().sort((a, b) => b[0].length - a[0].length).forEach(function (pair) {
      if (s.indexOf(pair[0]) > -1) {
        if (terms.indexOf(pair[1]) === -1) { terms.push(pair[1]); mapped.push(pair[0] + " → " + pair[1]); }
        s = s.split(pair[0]).join(" ");
      }
    });

    /* 2) 남은 라틴 문자 토큰은 그대로 검색어로 (CHO, HCP, IgG1, Protein A …) */
    (s.match(/[A-Za-z][A-Za-z0-9+\-]{1,}/g) || []).forEach(function (t) {
      const low = t.toLowerCase();
      if (STOP.indexOf(low) > -1) return;
      if (terms.some(x => x.toLowerCase().indexOf(low) > -1)) return;
      terms.push(t);
    });

    /* 3) 아무것도 못 뽑았으면 원문에서 불용어만 걷어내고 그대로 씁니다 */
    if (!terms.length) {
      const fallback = String(raw || "").split(/\s+/)
        .filter(w => w && STOP.indexOf(w.toLowerCase()) === -1).join(" ");
      return { query: fallback || String(raw || ""), terms: [], mapped: [], translated: false };
    }
    return { query: terms.join(" "), terms: terms, mapped: mapped, translated: mapped.length > 0 };
  }

  /* ── fetch 공통 (타임아웃 + JSON) ─────────────────────────────────────── */
  function getJSON(url) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const t = setTimeout(() => { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
    return fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
      .then(function (r) {
        clearTimeout(t);
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .catch(function (e) {
        clearTimeout(t);
        throw new Error(e && e.name === "AbortError"
          ? "응답이 " + (TIMEOUT_MS / 1000) + "초 안에 오지 않았습니다"
          : (e && e.message) || "요청 실패");
      });
  }

  function clean(s) {
    return String(s == null ? "" : s)
      .replace(/<[^>]+>/g, " ")          // JATS/HTML 태그 제거
      .replace(/\s+/g, " ").trim();
  }
  function cut(s, n) { const t = clean(s); return t.length > n ? t.slice(0, n) + "…" : t; }

  /* 여러 낱말은 AND 로 묶고 두 단어 이상은 따옴표로 구를 유지합니다.
     느슨하게 던지면 상위에 "유명하지만 무관한" 고인용 논문이 올라옵니다. */
  function strictQuery(terms) {
    if (!terms || !terms.length) return null;
    return terms.map(t => t.indexOf(" ") > -1 ? '"' + t + '"' : t).join(" AND ");
  }

  /* ── Europe PMC ──────────────────────────────────────────────────────────
     정렬을 지정하지 않아 기본값인 관련도(relevance) 순으로 받습니다.
     인용수로 정렬하면 검색어와 상관없는 초고인용 논문이 먼저 나옵니다. */
  function searchEuropePMC(q, limit) {
    const url = EPMC + "?query=" + encodeURIComponent(q) +
      "&format=json&resultType=core&pageSize=" + (limit || 10);
    return getJSON(url).then(function (data) {
      const list = (data && data.resultList && data.resultList.result) || [];
      return list.map(function (r) {
        const doi = r.doi ? String(r.doi).toLowerCase() : null;
        const url = doi ? "https://doi.org/" + doi
          : (r.id && r.source ? "https://europepmc.org/article/" + r.source + "/" + r.id : null);
        return {
          key: doi || (r.source + ":" + r.id),
          title: clean(r.title) || "(제목 없음)",
          authors: clean(r.authorString),
          journal: clean(r.journalTitle || (r.bookOrReportDetails && r.bookOrReportDetails.publisher) || ""),
          year: r.pubYear ? String(r.pubYear) : "",
          doi: doi, url: url,
          abstract: cut(r.abstractText, 420),
          cites: typeof r.citedByCount === "number" ? r.citedByCount : null,
          openAccess: r.isOpenAccess === "Y",
          type: /patent/i.test(r.source || "") ? "특허초록" : "논문",
          from: "Europe PMC"
        };
      });
    });
  }

  /* ── Crossref ────────────────────────────────────────────────────────── */
  function searchCrossref(q, limit) {
    const url = CROSSREF + "?query.bibliographic=" + encodeURIComponent(q) +
      "&rows=" + (limit || 10) +
      "&select=" + encodeURIComponent("DOI,title,author,container-title,issued,abstract,is-referenced-by-count,URL,type");
    return getJSON(url).then(function (data) {
      const list = (data && data.message && data.message.items) || [];
      /* Crossref 는 심사보고서 · 구성요소 · 연구비 레코드까지 색인합니다.
         "Review for ..." 같은 항목이 본문 논문 자리를 차지하므로 제외합니다. */
      const SKIP = { "peer-review": 1, "component": 1, "grant": 1, "dataset": 1 };
      return list.filter(r => !SKIP[String(r.type || "").toLowerCase()]).map(function (r) {
        const doi = r.DOI ? String(r.DOI).toLowerCase() : null;
        const authors = (r.author || []).slice(0, 6)
          .map(a => [a.given, a.family].filter(Boolean).join(" ")).filter(Boolean).join(", ");
        const yr = r.issued && r.issued["date-parts"] && r.issued["date-parts"][0]
          ? r.issued["date-parts"][0][0] : "";
        return {
          key: doi || (r.URL || Math.random().toString(36)),
          title: clean((r.title || [])[0]) || "(제목 없음)",
          authors: authors + ((r.author || []).length > 6 ? " 외" : ""),
          journal: clean((r["container-title"] || [])[0] || ""),
          year: yr ? String(yr) : "",
          doi: doi, url: doi ? "https://doi.org/" + doi : (r.URL || null),
          abstract: cut(r.abstract, 420),
          cites: typeof r["is-referenced-by-count"] === "number" ? r["is-referenced-by-count"] : null,
          openAccess: false,
          type: /patent/i.test(r.type || "") ? "특허" : "논문",
          from: "Crossref"
        };
      });
    });
  }

  /* ── 통합 검색 ───────────────────────────────────────────────────────── */
  function search(rawQuestion, opts) {
    const o = opts || {};
    const built = toQuery(rawQuestion);
    const limit = o.limit || 10;
    const strict = strictQuery(built.terms);

    /* Europe PMC: AND 로 좁혀 보고, 0건이면 느슨한 질의로 한 번 더 */
    const epmc = searchEuropePMC(strict || built.query, limit)
      .then(r => (r.length || !strict) ? r : searchEuropePMC(built.query, limit))
      .then(r => ({ ok: true, items: r, src: "Europe PMC" }))
      .catch(e => ({ ok: false, items: [], src: "Europe PMC", error: e.message }));

    /* Crossref 의 query.bibliographic 은 자체 관련도 점수를 씁니다 */
    const cr = searchCrossref(built.query, limit)
      .then(r => ({ ok: true, items: r, src: "Crossref" }))
      .catch(e => ({ ok: false, items: [], src: "Crossref", error: e.message }));

    return Promise.all([epmc, cr]).then(function (res) {
      /* 두 곳의 관련도 순위를 번갈아 섞습니다. 한쪽으로 몰리지 않게 하면서
         각 API 가 매긴 순위를 그대로 존중합니다 — 인용수로 다시 정렬하면
         검색어와 무관한 초고인용 논문이 위로 올라옵니다. */
      const seen = {}, items = [];
      const lists = res.map(r => r.items.slice());
      const max = Math.max.apply(null, lists.map(l => l.length).concat([0]));
      for (let i = 0; i < max; i++) {
        lists.forEach(function (l) {
          const it = l[i];
          if (!it) return;
          const k = (it.doi || it.title.toLowerCase()).trim();
          if (!k || seen[k]) return;
          seen[k] = true; items.push(it);
        });
      }

      return {
        question: rawQuestion,
        query: strict || built.query,
        mapped: built.mapped,
        translated: built.translated,
        items: items.slice(0, limit + 4),
        sources: res.map(r => ({ name: r.src, ok: r.ok, count: r.items.length, error: r.error || null })),
        failedAll: res.every(r => !r.ok)
      };
    });
  }

  /* ── 특허: 정직한 외부 링크 ──────────────────────────────────────────── */
  function patentLinks(rawQuestion) {
    const q = toQuery(rawQuestion).query || String(rawQuestion || "");
    const e = encodeURIComponent(q);
    return [
      { label: "Google Patents", url: "https://patents.google.com/?q=" + e },
      { label: "Espacenet", url: "https://worldwide.espacenet.com/patent/search?q=" + e },
      { label: "KIPRIS (한국특허정보원)", url: "https://www.kipris.or.kr/khome/search/searchResult.do?queryText=" + e }
    ];
  }

  return { search, toQuery, patentLinks, _epmc: searchEuropePMC, _crossref: searchCrossref };
})();
