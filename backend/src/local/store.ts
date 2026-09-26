import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { config } from "../config.js";

type Filter = { op: string; column: string; value: unknown };
type Order = { column: string; ascending?: boolean } | null;

const queues = new Map<string, Promise<unknown>>();
const tableCache = new Map<string, { mtimeMs: number; size: number; eventMtimeMs?: number; eventSize?: number; rows: any[] }>();
const SNAPSHOT_TABLE = "kedco_data_snapshots";
const SNAPSHOT_KEY_COLUMNS = ["owner_id", "data_key"];

function queue<T>(file: string, work: () => Promise<T> | T): Promise<T> {
  const previous = queues.get(file) || Promise.resolve();
  const next = previous.catch(() => undefined).then(work);
  // Keep the queue usable after a failed write without creating a second,
  // unhandled rejection. On Windows a transient file lock must not terminate
  // the whole local backend process.
  let tracked: Promise<void>;
  tracked = next.then(
    () => {
      if (queues.get(file) === tracked) queues.delete(file);
    },
    () => {
      if (queues.get(file) === tracked) queues.delete(file);
    }
  );
  queues.set(file, tracked);
  return next;
}

function delay(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

/** Write a JSON file with a retryable Windows-safe replacement. */
async function writeAtomicJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), "utf8");

  let lastError: unknown;
  try {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        fs.renameSync(temp, file);
        return;
      } catch (error: any) {
        lastError = error;
        const retryable = ["EPERM", "EBUSY", "EACCES"].includes(String(error?.code || ""));
        if (!retryable || attempt === 7) break;
        await delay(75 * (attempt + 1));
      }
    }
    throw lastError;
  } finally {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch { /* best effort cleanup */ }
  }
}

export const localRoot = path.resolve(config.localDataRoot);

export function safeSegment(value: unknown, fallback = "item") {
  const text = String(value ?? "").trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return text.slice(0, 180) || fallback;
}

export function safeRelativePath(value: unknown) {
  const raw = String(value ?? "").replace(/\\/g, "/").split("/").filter(Boolean);
  const parts = raw.filter(part => part !== "." && part !== "..").map(part => safeSegment(part));
  return parts.join("/");
}

export function ensureLocalLayout() {
  const dirs = [
    "system",
    "tables",
    "snapshots",
    "load-flow/33kv",
    "load-flow/11kv",
    "operations/daily",
    "workflows",
    "files/kedco-evidence",
    "files/kedco-workflow-files",
    "registry",
    "audit",
    "backups"
  ];
  fs.mkdirSync(localRoot, { recursive: true });
  for (const dir of dirs) fs.mkdirSync(path.join(localRoot, dir), { recursive: true });
  const marker = path.join(localRoot, "README.txt");
  if (!fs.existsSync(marker)) {
    fs.writeFileSync(marker,
`KEDCO TECHNICAL AUTOMATION - LOCAL CLOUD DATA\n\nThis folder is the persistent local data store for KEDCO Automation.\nDo not delete it; the application writes JSON records, workflow data, load-flow history and uploaded evidence here.\nAll application data remains on this computer.\n`, "utf8");
  }
}

ensureLocalLayout();

function jsonFile(relative: string) {
  return path.join(localRoot, safeRelativePath(relative));
}

export function readJson<T>(relative: string, fallback: T): T {
  const file = jsonFile(relative);
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson<T>(relative: string, value: T): Promise<void> {
  const file = jsonFile(relative);
  await queue(file, async () => writeAtomicJson(file, value));
  bumpVersion();
}

export function appendAudit(event: Record<string, unknown>) {
  const file = path.join(localRoot, "audit", "events.jsonl");
  const row = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...event };
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, "utf8");
  bumpVersion();
}

function versionFile() { return path.join(localRoot, "system", "version.json"); }
export function currentVersion() {
  const data = readJson<{ version: number; updated_at: string }>("system/version.json", { version: 0, updated_at: new Date(0).toISOString() });
  return data;
}
export function bumpVersion() {
  const file = versionFile();
  let current = 0;
  try { current = JSON.parse(fs.readFileSync(file, "utf8"))?.version || 0; } catch {}
  const payload = { version: current + 1, updated_at: new Date().toISOString() };
  try { fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8"); } catch {}
  return payload;
}

export function currentSnapshotVersion() {
  return readJson<{ version: number; updated_at: string }>("system/snapshot-version.json", { version: 0, updated_at: new Date(0).toISOString() });
}

export function bumpSnapshotVersion() {
  const file = jsonFile("system/snapshot-version.json");
  const current = currentSnapshotVersion();
  const payload = { version: Number(current.version || 0) + 1, updated_at: new Date().toISOString() };
  try { fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8"); } catch {}
  return payload;
}

function tableFile(table: string) { return "tables/" + safeSegment(table) + ".json"; }
function snapshotEventFile() { return jsonFile("tables/kedco_data_snapshots.events.jsonl"); }

type SnapshotEvent =
  | { op: "insert"; row: any }
  | { op: "upsert"; keyColumns: string[]; row: any }
  | { op: "delete"; keyColumns: string[]; key: string };

function snapshotFileState() {
  try {
    const stat = fs.statSync(snapshotEventFile());
    return { eventMtimeMs: stat.mtimeMs, eventSize: stat.size };
  } catch { return { eventMtimeMs: 0, eventSize: 0 }; }
}

function snapshotKey(row: Record<string, unknown>, columns = SNAPSHOT_KEY_COLUMNS) {
  return recordKey(row, columns);
}

function dedupeSnapshotRows(rows: any[]) {
  const next: any[] = [];
  const positions = new Map<string, number>();
  for (const row of rows) {
    const key = snapshotKey(row);
    if (!key || !positions.has(key)) {
      if (key) positions.set(key, next.length);
      next.push(row);
      continue;
    }
    const index = positions.get(key)!;
    if (recordTimestamp(row) >= recordTimestamp(next[index])) next[index] = row;
  }
  return next;
}

function applySnapshotEvents(baseRows: any[], events: SnapshotEvent[]) {
  const rows = dedupeSnapshotRows(baseRows);
  const positions = new Map<string, number>();
  rows.forEach((row, index) => {
    const key = snapshotKey(row);
    if (key) positions.set(key, index);
  });
  for (const event of events) {
    if (event.op === "insert") {
      rows.push(event.row);
      continue;
    }
    const columns = event.keyColumns || SNAPSHOT_KEY_COLUMNS;
    const key = event.op === "delete" ? event.key : snapshotKey(event.row, columns);
    const index = key ? positions.get(key) : undefined;
    if (event.op === "delete") {
      if (index !== undefined) {
        rows[index] = null;
        positions.delete(key);
      }
      continue;
    }
    if (index === undefined) {
      positions.set(key, rows.length);
      rows.push(event.row);
    } else {
      const existing = rows[index];
      rows[index] = { ...existing, ...event.row, id: existing?.id || event.row?.id };
    }
  }
  return rows.filter(Boolean);
}

function readSnapshotEvents(): SnapshotEvent[] {
  try {
    return fs.readFileSync(snapshotEventFile(), "utf8").split(/\r?\n/).filter(Boolean).flatMap(line => {
      try {
        const event = JSON.parse(line);
        return event && ["insert", "upsert", "delete"].includes(event.op) ? [event as SnapshotEvent] : [];
      } catch { return []; }
    });
  } catch { return []; }
}

async function appendSnapshotEvents(events: SnapshotEvent[]) {
  if (!events.length) return;
  const file = snapshotEventFile();
  const cached = tableCache.has(SNAPSHOT_TABLE) ? tableRows(SNAPSHOT_TABLE) : null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await fs.promises.appendFile(file, events.map(event => JSON.stringify(event)).join("\n") + "\n", "utf8");
  if (cached) cacheTableRows(SNAPSHOT_TABLE, applySnapshotEvents(cached, events));
  bumpVersion();
  bumpSnapshotVersion();
}

function snapshotComparable(row: any) {
  if (!row || typeof row !== "object") return row;
  const { id: _id, created_at: _createdAt, updated_at: _updatedAt, client_updated_at: _clientUpdatedAt, ...data } = row;
  if (/^KEDCO_LOADFLOW_HISTORY_/.test(String(data.data_key || "")) && data.payload && typeof data.payload === "object" && !Array.isArray(data.payload)) {
    const { updatedAt: _payloadUpdatedAt, ...payload } = data.payload as Record<string, unknown>;
    return { ...data, payload };
  }
  return data;
}

function cacheTableRows(table: string, rows: any[]) {
  const file = jsonFile(tableFile(table));
  try {
    const stat = fs.statSync(file);
    tableCache.set(table, { mtimeMs: stat.mtimeMs, size: stat.size, ...(table === SNAPSHOT_TABLE ? snapshotFileState() : {}), rows });
  } catch {
    tableCache.set(table, { mtimeMs: 0, size: 0, ...(table === SNAPSHOT_TABLE ? snapshotFileState() : {}), rows });
  }
}

export function tableRows(table: string): any[] {
  const file = jsonFile(tableFile(table));
  let stat: fs.Stats | null = null;
  try { stat = fs.statSync(file); } catch {}
  const eventState = table === SNAPSHOT_TABLE ? snapshotFileState() : {};
  const cached = tableCache.get(table);
  if (cached && cached.mtimeMs === (stat?.mtimeMs || 0) && cached.size === (stat?.size || 0) &&
      cached.eventMtimeMs === (eventState as any).eventMtimeMs && cached.eventSize === (eventState as any).eventSize) return cached.rows;
  const rows = stat ? readJson<any[]>(tableFile(table), []) : [];
  const safeRows = Array.isArray(rows) ? rows : [];
  const combined = table === SNAPSHOT_TABLE ? applySnapshotEvents(safeRows, readSnapshotEvents()) : safeRows;
  tableCache.set(table, { mtimeMs: stat?.mtimeMs || 0, size: stat?.size || 0, ...eventState, rows: combined });
  return combined;
}

function compare(actual: unknown, op: string, expected: unknown) {
  const a = actual as any;
  const e = expected as any;
  if (op === "eq") return String(a ?? "") === String(e ?? "");
  if (op === "neq") return String(a ?? "") !== String(e ?? "");
  if (op === "in") return Array.isArray(e) && e.map(String).includes(String(a));
  const ad = Date.parse(String(a));
  const ed = Date.parse(String(e));
  const av = Number.isNaN(ad) ? a : ad;
  const ev = Number.isNaN(ed) ? e : ed;
  if (op === "gte") return av >= ev;
  if (op === "gt") return av > ev;
  if (op === "lte") return av <= ev;
  if (op === "lt") return av < ev;
  if (op === "is") return e === null ? a == null : a === e;
  return true;
}

export function queryTable(table: string, filters: Filter[] = [], order: Order = null, offset = 0, limit = 1000) {
  let rows = tableRows(table);
  for (const filter of filters) rows = rows.filter(row => compare(row?.[filter.column], filter.op, filter.value));
  if (order?.column) {
    rows = rows.slice().sort((a, b) => {
      const av = a?.[order.column] ?? "";
      const bv = b?.[order.column] ?? "";
      const result = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return order.ascending === false ? -result : result;
    });
  }
  return rows.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(0, limit));
}

function normalizeInserted(row: Record<string, unknown>) {
  const now = new Date().toISOString();
  return {
    id: row.id || crypto.randomUUID(),
    created_at: row.created_at || now,
    updated_at: row.updated_at || now,
    ...row
  };
}

export async function insertTable(table: string, input: any | any[]) {
  if (table === SNAPSHOT_TABLE) {
    const incoming = (Array.isArray(input) ? input : [input]).map(row => normalizeInserted((row && typeof row === "object") ? row : { value: row }));
    await queue(jsonFile(tableFile(table)), async () => appendSnapshotEvents(incoming.map(row => ({ op: "insert", row }))));
    return incoming;
  }
  const relative = tableFile(table);
  const file = jsonFile(relative);
  return queue(file, async () => {
    const current = tableRows(table).slice();
    const incoming = (Array.isArray(input) ? input : [input]).map(row => normalizeInserted((row && typeof row === "object") ? row : { value: row }));
    current.push(...incoming);
    await writeAtomicJson(file, current);
    cacheTableRows(table, current);
    bumpVersion();
    mirrorSpecialTable(table, incoming);
    return incoming;
  });
}

function recordKey(row: Record<string, unknown>, keyColumns: string[]) {
  const values = keyColumns.map(column => row?.[column]);
  if (values.some(value => value === undefined || value === null || String(value) === "")) return "";
  return values.map(value => String(value)).join("\u001f");
}

function recordTimestamp(row: Record<string, unknown>) {
  for (const field of ["client_updated_at", "updated_at", "created_at"]) {
    const stamp = Date.parse(String(row?.[field] || ""));
    if (!Number.isNaN(stamp)) return stamp;
  }
  return 0;
}

/** Upsert keyed rows with one read and one atomic write, also removing old duplicates. */
export async function upsertTableByKeys(table: string, input: any | any[], keyColumns: string[]) {
  const relative = tableFile(table);
  const file = jsonFile(relative);
  if (table === SNAPSHOT_TABLE) {
    return queue(file, async () => {
      const current = tableCache.has(table) ? tableRows(table) : null;
      const existingByKey = new Map<string, any>();
      if (current) for (const row of current) {
        const key = recordKey(row, keyColumns);
        if (key) existingByKey.set(key, row);
      }
      const now = new Date().toISOString();
      const incoming = (Array.isArray(input) ? input : [input])
        .filter(row => row && typeof row === "object")
        .map(row => normalizeInserted({ ...row, updated_at: row.updated_at || now }));
      const events: SnapshotEvent[] = [];
      const result: any[] = [];
      for (const row of incoming) {
        const key = recordKey(row, keyColumns);
        if (!key) {
          events.push({ op: "insert", row });
          result.push(row);
          continue;
        }
        const existing = existingByKey.get(key);
        const candidate = existing
          ? { ...existing, ...row, id: existing.id || row.id, created_at: existing.created_at || row.created_at }
          : row;
        if (!existing || !isDeepStrictEqual(snapshotComparable(existing), snapshotComparable(candidate))) {
          events.push({ op: "upsert", keyColumns, row: candidate });
        }
        existingByKey.set(key, candidate);
        result.push(candidate);
      }
      if (events.length) await appendSnapshotEvents(events);
      return result;
    });
  }
  return queue(file, async () => {
    const current = tableRows(table);
    const next: any[] = [];
    const positions = new Map<string, number>();
    const now = new Date().toISOString();

    for (const row of current) {
      const key = recordKey(row, keyColumns);
      if (!key || !positions.has(key)) {
        if (key) positions.set(key, next.length);
        next.push(row);
        continue;
      }
      const index = positions.get(key)!;
      if (recordTimestamp(row) >= recordTimestamp(next[index])) next[index] = row;
    }

    const incoming = (Array.isArray(input) ? input : [input])
      .filter(row => row && typeof row === "object")
      .map(row => normalizeInserted({ ...row, updated_at: row.updated_at || now }));

    for (const row of incoming) {
      const key = recordKey(row, keyColumns);
      if (!key) {
        next.push(row);
        continue;
      }
      const existingIndex = positions.get(key);
      if (existingIndex === undefined) {
        positions.set(key, next.length);
        next.push(row);
      } else {
        const existing = next[existingIndex];
        next[existingIndex] = { ...existing, ...row, id: existing?.id || row.id };
      }
    }

    await writeAtomicJson(file, next);
    cacheTableRows(table, next);
    bumpVersion();

    return incoming.map(row => {
      const key = recordKey(row, keyColumns);
      return key && positions.has(key) ? next[positions.get(key)!] : row;
    });
  });
}

export async function updateTable(table: string, patch: Record<string, unknown>, filters: Filter[]) {
  const relative = tableFile(table);
  const file = jsonFile(relative);
  return queue(file, async () => {
    const current = tableRows(table);
    const updated: any[] = [];
    const now = new Date().toISOString();
    const next = current.map(row => {
      const match = filters.every(filter => compare(row?.[filter.column], filter.op, filter.value));
      if (!match) return row;
      const value = { ...row, ...patch, updated_at: now };
      updated.push(value);
      return value;
    });
    if (table === SNAPSHOT_TABLE) {
      if (!updated.length) return updated;
      if (updated.some(row => !snapshotKey(row))) {
        await writeAtomicJson(file, next);
        cacheTableRows(table, next);
        bumpVersion();
        bumpSnapshotVersion();
        return updated;
      }
      await appendSnapshotEvents(updated.map(row => ({ op: "upsert", keyColumns: SNAPSHOT_KEY_COLUMNS, row })));
      return updated;
    }
    await writeAtomicJson(file, next);
    cacheTableRows(table, next);
    bumpVersion();
    return updated;
  });
}

export async function deleteTable(table: string, filters: Filter[]) {
  const relative = tableFile(table);
  const file = jsonFile(relative);
  return queue(file, async () => {
    const current = tableRows(table);
    const deleted: any[] = [];
    const keep = current.filter(row => {
      const match = filters.every(filter => compare(row?.[filter.column], filter.op, filter.value));
      if (match) deleted.push(row);
      return !match;
    });
    if (table === SNAPSHOT_TABLE) {
      if (!deleted.length) return deleted;
      if (deleted.some(row => !snapshotKey(row))) {
        await writeAtomicJson(file, keep);
        cacheTableRows(table, keep);
        bumpVersion();
        bumpSnapshotVersion();
        return deleted;
      }
      const events = deleted.map(row => ({ op: "delete", keyColumns: SNAPSHOT_KEY_COLUMNS, key: snapshotKey(row)! } as SnapshotEvent));
      await appendSnapshotEvents(events);
      return deleted;
    }
    await writeAtomicJson(file, keep);
    cacheTableRows(table, keep);
    bumpVersion();
    return deleted;
  });
}

function mirrorSpecialTable(table: string, incoming: any[]) {
  if (table !== "kedco_station_live_operations") return;
  const grouped = new Map<string, { voltage: string; date: string; rows: any[] }>();
  for (const row of incoming) {
    const op = String(row?.operation_type || "").toUpperCase();
    const voltage = op.includes("33KV") ? "33kv" : op.includes("11KV") ? "11kv" : "";
    const date = String(row?.reading_date || "").match(/^\d{4}-\d{2}-\d{2}$/)?.[0] || "";
    if (!voltage || !date) continue;
    const key = `${voltage}|${date}`;
    const group = grouped.get(key) || { voltage, date, rows: [] };
    group.rows.push(row);
    grouped.set(key, group);
  }
  for (const group of grouped.values()) {
    const [year, month, day] = group.date.split("-");
    const rel = `load-flow/${group.voltage}/${year}/${month}/${day}.json`;
    const rows = readJson<any[]>(rel, []);
    rows.push(...group.rows);
    const file = jsonFile(rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(rows, null, 2), "utf8");
  }
}

export function storagePath(bucket: string, objectPath: string) {
  const b = safeSegment(bucket, "files");
  const rel = safeRelativePath(objectPath);
  return path.join(localRoot, "files", b, rel);
}

function tableStat(name: string) {
  const file = jsonFile(tableFile(name));
  let bytes = 0;
  try { bytes = fs.statSync(file).size; } catch {}
  const cached = tableCache.get(name);
  return { records: cached?.rows.length ?? null, bytes, loaded: Boolean(cached) };
}

export function localSummary() {
  ensureLocalLayout();
  const names = {
    station_operations: "kedco_station_live_operations",
    snapshots: "kedco_data_snapshots",
    file_assets: "kedco_file_assets",
    daily_log_events: "daily_log_events",
    workflow_submissions: "kedco_workflow_submissions"
  } as const;
  const stats = Object.fromEntries(Object.entries(names).map(([key, table]) => [key, tableStat(table)]));
  return {
    root: localRoot,
    version: currentVersion(),
    tables: Object.fromEntries(Object.entries(stats).map(([key, stat]) => [key, stat.records])),
    table_stats: stats
  };
}
