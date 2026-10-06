/* ==========================================================================
   api/_db.js — 중앙 데이터베이스 (Vercel Postgres / Neon)

   ── 왜 파일이 아니라 DB 인가 ────────────────────────────────────────────
   Vercel 서버리스는 파일을 저장할 수 없습니다. 디스크는 읽기 전용이고
   /tmp 는 요청이 끝나면 사라지며 인스턴스마다 따로입니다. SQLite 파일이나
   JSON 파일로 두면 **저장한 것처럼 보이다가 다음 요청에서 사라집니다** —
   가장 나쁜 실패 방식입니다. 그래서 외부 관리형 DB 를 씁니다.

   ── 표 두 개 ────────────────────────────────────────────────────────────
     records       Study · Batch · 시료 레코드           (kind, id) → JSON
     entry_values  칸에 적은 값과 변경 이력              (scope, field) → JSON

   값의 모양은 브라우저에서 쓰던 것과 **같습니다**. 서버가 다른 모양으로
   바꿔 담으면 두 곳에서 같은 데이터를 다르게 이해하게 되고, 그 차이는
   언젠가 조용히 어긋납니다. 서버는 담아 두기만 하고 뜻은 클라이언트가
   정합니다.

   ★ "values" 는 SQL 예약어라 entry_values 로 둡니다.

   ── 씨앗 ────────────────────────────────────────────────────────────────
   씨앗(원본 Excel 28배치)은 클라이언트가 만듭니다 — batches.js · studies.js ·
   samples.js 가 이미 그 일을 하고 있고 검증도 되어 있습니다. 서버에서 다시
   만들면 두 벌이 되고, 언젠가 한쪽만 고쳐집니다.

   그래서 서버가 비어 있으면 클라이언트가 자기가 만든 씨앗을 한 번 올립니다
   (POST /api/data?seed=1). 이미 들어 있으면 아무 일도 하지 않습니다.
   ========================================================================== */

let sql = null;
let initDone = false;

function driver() {
  if (sql) return sql;
  try {
    /* @vercel/postgres 는 POSTGRES_URL 환경변수를 스스로 읽습니다.
       Vercel 대시보드에서 Postgres 를 붙이면 자동으로 주입됩니다. */
    sql = require("@vercel/postgres").sql;
  } catch (e) { sql = null; }
  return sql;
}

function configured() {
  return !!(process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING) && !!driver();
}

function notConfigured(res) {
  res.status(503).json({
    error: "db-not-configured",
    message: "Postgres 가 연결되지 않았습니다. Vercel 프로젝트에 Postgres 를 붙이면 " +
             "POSTGRES_URL 이 자동으로 주입됩니다.",
    need: ["POSTGRES_URL (Vercel Postgres 연결 시 자동)", "HUB_ACCESS_SECRET"]
  });
}

/* 표 만들기 — 매 요청마다 불러도 괜찮도록 IF NOT EXISTS 입니다.
   한 인스턴스에서 한 번만 돌도록 플래그도 둡니다. */
async function init() {
  if (initDone) return;
  const q = driver();
  await q`CREATE TABLE IF NOT EXISTS records (
    kind       TEXT NOT NULL,
    id         TEXT NOT NULL,
    data       JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (kind, id)
  )`;
  await q`CREATE TABLE IF NOT EXISTS entry_values (
    scope      TEXT NOT NULL,
    field      TEXT NOT NULL,
    data       JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, field)
  )`;
  /* 이름 덧씌움 · 워크시트 열·행 같은 "데이터이지만 레코드는 아닌 것" */
  await q`CREATE TABLE IF NOT EXISTS meta (
    k          TEXT PRIMARY KEY,
    data       JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  initDone = true;
}

/* ── 읽기 ─────────────────────────────────────────────────────────────
   전체를 한 번에 돌려줍니다. 화면이 수백 군데에서 동기적으로 값을 읽기
   때문에, 칸마다 왕복하면 화면이 멈춥니다. 28배치 규모에서는 전체가
   수백 KB 라 한 번에 받는 편이 빠르고 단순합니다. */
async function snapshot() {
  await init();
  const q = driver();
  const [recs, vals, metas] = await Promise.all([
    q`SELECT kind, id, data FROM records`,
    q`SELECT scope, field, data FROM entry_values`,
    q`SELECT k, data FROM meta`
  ]);

  const records = { study: [], batch: [], sample: [] };
  recs.rows.forEach(function (r) {
    if (!records[r.kind]) records[r.kind] = [];
    records[r.kind].push(r.data);
  });

  const values = {};
  vals.rows.forEach(function (r) { values[r.scope + "|" + r.field] = r.data; });

  const meta = {};
  metas.rows.forEach(function (r) { meta[r.k] = r.data; });

  return {
    records: records, values: values, meta: meta,
    counts: { study: records.study.length, batch: records.batch.length,
              sample: records.sample.length, values: vals.rows.length },
    empty: recs.rows.length === 0 && vals.rows.length === 0
  };
}

/* ── 쓰기 ─────────────────────────────────────────────────────────────
   한 번의 요청이 여러 변경을 담을 수 있습니다. 칸 하나 고칠 때마다 왕복하면
   표에 값을 줄줄이 적는 동안 요청이 수십 개가 됩니다.

   ★ 한 줄씩 보내지 않습니다.
     예전에는 레코드마다 INSERT 를 한 번씩 보냈습니다. Study·Batch·시료를
     저장하면 62개 레코드가 그대로 62번의 왕복이 되었고, Neon 왕복이
     한 번에 수십 ms 라 한 번 저장에 몇 초가 걸렸습니다. 느린 날에는
     함수 제한시간을 넘겨 **504 로 실패했고, 그러면 클라이언트가 메모리를
     되돌려 화면에서도 값이 사라졌습니다** — "저장했는데 다른 PC 에 반영이
     안 된다" 의 정체입니다.

     unnest 로 묶어 종류당 한 번만 보냅니다. 62번 → 3번.
     한 번에 너무 큰 묶음을 보내지 않도록 CHUNK 로 끊습니다. */
const CHUNK = 500;

function chunks(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function apply(patch) {
  await init();
  const q = driver();
  const p = patch || {};
  let n = 0;

  /* ── 값 ── */
  const vals = p.values || {};
  const vIns = [], vDel = [];
  for (const key of Object.keys(vals)) {
    const i = key.indexOf("|");
    if (i < 1) continue;
    const pair = [key.slice(0, i), key.slice(i + 1)];
    if (vals[key] === null) vDel.push(pair);
    else vIns.push([pair[0], pair[1], JSON.stringify(vals[key])]);
  }
  for (const part of chunks(vIns, CHUNK)) {
    await q`INSERT INTO entry_values (scope, field, data, updated_at)
            SELECT s, f, d::jsonb, now()
            FROM unnest(${part.map(x => x[0])}::text[],
                        ${part.map(x => x[1])}::text[],
                        ${part.map(x => x[2])}::text[]) AS t(s, f, d)
            ON CONFLICT (scope, field)
            DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
    n += part.length;
  }
  for (const part of chunks(vDel, CHUNK)) {
    await q`DELETE FROM entry_values
            WHERE (scope, field) IN (
              SELECT s, f FROM unnest(${part.map(x => x[0])}::text[],
                                      ${part.map(x => x[1])}::text[]) AS t(s, f))`;
    n += part.length;
  }

  /* ── 레코드 ── */
  const recs = p.records || {};
  for (const kind of Object.keys(recs)) {
    const list = (recs[kind] || []).filter(r => r && r.id);
    for (const part of chunks(list, CHUNK)) {
      await q`INSERT INTO records (kind, id, data, updated_at)
              SELECT ${kind}, i, d::jsonb, now()
              FROM unnest(${part.map(r => String(r.id))}::text[],
                          ${part.map(r => JSON.stringify(r))}::text[]) AS t(i, d)
              ON CONFLICT (kind, id)
              DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
      n += part.length;
    }
  }

  /* 레코드 **진짜 지우기**.

     ★ 화면에서 쓰는 길이 아닙니다. 화면에서 지운 것은 deleted 를 세워 기록으로
       남깁니다 (레코드 단위로 맞추기 때문에, 진짜 지우면 남이 들고 있는 낡은
       사본이 되살립니다 — collections.js 참고).

     이 길은 초기화와 검사 뒷정리처럼 "그 줄 자체가 없어져야 하는" 경우에만
     씁니다. [[kind, id], …] 형태로 받습니다. */
  const dels = (Array.isArray(p.deleteRecords) ? p.deleteRecords : [])
    .filter(x => Array.isArray(x) && x.length >= 2)
    .map(x => [String(x[0]), String(x[1])]);
  for (const part of chunks(dels, CHUNK)) {
    await q`DELETE FROM records
            WHERE (kind, id) IN (
              SELECT k, i FROM unnest(${part.map(x => x[0])}::text[],
                                      ${part.map(x => x[1])}::text[]) AS t(k, i))`;
    n += part.length;
  }
  return n;
}

/* 씨앗 심기 — 비어 있을 때만. 이미 있으면 손대지 않습니다.
   두 사람이 동시에 처음 열어도 한쪽만 들어가도록 조건을 DB 에서 봅니다. */
async function seedIfEmpty(patch) {
  await init();
  const q = driver();
  const r = await q`SELECT count(*)::int AS n FROM records`;
  if (r.rows[0].n > 0) return { seeded: false, reason: "already" };
  const n = await apply(patch);
  return { seeded: true, written: n };
}

/* 시드로 되돌리기 — 비우기만 합니다. 다시 채우는 것은 클라이언트가
   다음 접속에서 합니다 (씨앗을 만드는 곳이 거기 하나뿐이므로). */
async function wipe() {
  await init();
  const q = driver();
  await q`DELETE FROM entry_values`;
  await q`DELETE FROM records`;
  await q`DELETE FROM meta`;
  return { ok: true };
}

module.exports = { configured, notConfigured, init, snapshot, apply, seedIfEmpty, wipe };
