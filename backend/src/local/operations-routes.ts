import { Router } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import { insertTable, queryTable, readJson, storagePath } from "./store.js";

const router = Router();
const LOAD_FLOW_TYPES = new Set(["LOAD_FLOW_33KV", "LOAD_FLOW_11KV", "LOAD_FLOW_11KV_SUBMISSION"]);

function lagosYearMonth() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit"
  }).formatToParts(new Date()).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}`;
}

function loadFlowVoltage(form: string) {
  return form === "load33" ? "33kv" : "11kv";
}

function savedFolderRows(form: string, readingDate: string) {
  const [year, month, day] = readingDate.split("-");
  const voltage = loadFlowVoltage(form);
  const rows = readJson<any[]>(`load-flow/${voltage}/${year}/${month}/${day}.json`, []);
  return Array.isArray(rows) ? rows : [];
}

function snapshotRows(form: string, readingDate: string, userId: string) {
  const key = `KEDCO_LOADFLOW_HISTORY_${form}_${readingDate}`;
  const snapshots = queryTable("kedco_data_snapshots", [
    { op: "eq", column: "data_key", value: key },
    { op: "neq", column: "is_deleted", value: true }
  ], { column: "updated_at", ascending: false }, 0, 100000);
  const snapshot = snapshots.find((row: any) => String(row?.owner_id || "") === String(userId || "")) || snapshots[0];
  const payload = snapshot?.payload && typeof snapshot.payload === "object" ? snapshot.payload : {};
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const values = data?.values && typeof data.values === "object" ? data.values : {};
  const prefix = form === "load33" ? "lf33_" : "lf11_";
  const updatedAt = payload?.updatedAt || snapshot?.updated_at || snapshot?.created_at || new Date(0).toISOString();

  return Object.entries(values)
    .filter(([field, value]) => String(field).startsWith(prefix) && value !== null && value !== undefined && String(value) !== "")
    .map(([field, value], index) => {
      const hourMatch = String(field).match(/_h(\d+)$/i);
      const hour = hourMatch ? Number(hourMatch[1]) : null;
      const validHour = hour !== null && Number.isInteger(hour) && hour >= 1 && hour <= 24 ? hour : null;
      return {
        id: `${snapshot?.id || key}:${index}`,
        created_by: snapshot?.owner_id || null,
        source_table: "kedco_data_snapshots",
        source_record_id: snapshot?.id || key,
        source_key: key,
        operation_type: form === "load33" ? "LOAD_FLOW_33KV" : "LOAD_FLOW_11KV_SUBMISSION",
        voltage_level: form === "load33" ? "33KV" : "11KV",
        reading_date: readingDate,
        reading_hour: validHour,
        status: "REFERENCE",
        event_time: updatedAt,
        payload: {
          field_name: field,
          field_value: String(value),
          raw_value: String(value),
          entry_mode: "REFERENCE",
          input_source: "LOCAL_SAVED_HISTORY"
        }
      };
    });
}

function savedLoadFlowRows(form: string, readingDate: string, userId: string) {
  const folderRows = savedFolderRows(form, readingDate);
  if (folderRows.length) return { rows: folderRows, source: "saved_folder", asset: null };

  const targetPeriod = readingDate.slice(0, 7);
  const voltage = loadFlowVoltage(form);
  const assets = queryTable("kedco_file_assets", [], { column: "created_at", ascending: false }, 0, 100000)
    .filter((row: any) => {
      // Historical load-flow workbooks are an Operations reference source,
      // so Dispatch and Operator may read the same saved workbook. The
      // Analyzer Gallery keeps its separate owner filter for private files.
      if (row?.is_deleted === true) return false;
      const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
      const assetName = String(row?.original_name || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ");
      const inferredVoltage = assetName.includes("33KV") ? "33kv" : assetName.includes("11KV") ? "11kv" : "";
      const rowVoltage = String(metadata.voltage_level || metadata.gallery_category || metadata.storage_folder || inferredVoltage).toLowerCase().replace(/\s+/g, "");
      if (rowVoltage !== voltage) return false;
      const monthNames: Record<string, string> = { "01": "JANUARY", "02": "FEBRUARY", "03": "MARCH", "04": "APRIL", "05": "MAY", "06": "JUNE", "07": "JULY", "08": "AUGUST", "09": "SEPTEMBER", "10": "OCTOBER", "11": "NOVEMBER", "12": "DECEMBER" };
      const monthName = monthNames[targetPeriod.slice(5)];
      return assetName.includes(`${monthName} ${targetPeriod.slice(0, 4)}`)
        || assetName.includes(`${targetPeriod.slice(0, 4)} ${monthName}`)
        || String(metadata.reporting_month || metadata.reporting_period || "").slice(0, 7) === targetPeriod;
    });
  // Prefer the month/year stated in the workbook name over older metadata;
  // this keeps a mislabeled registry period from selecting the wrong month.
  const periodScore = (row: any) => {
    const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const name = String(row?.original_name || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ");
    const monthNames: Record<string, string> = { "01": "JANUARY", "02": "FEBRUARY", "03": "MARCH", "04": "APRIL", "05": "MAY", "06": "JUNE", "07": "JULY", "08": "AUGUST", "09": "SEPTEMBER", "10": "OCTOBER", "11": "NOVEMBER", "12": "DECEMBER" };
    const monthName = monthNames[targetPeriod.slice(5)];
    if (name.includes(`${monthName} ${targetPeriod.slice(0, 4)}`) || name.includes(`${targetPeriod.slice(0, 4)} ${monthName}`)) return 2;
    return String(metadata.reporting_month || metadata.reporting_period || "").slice(0, 7) === targetPeriod ? 1 : 0;
  };
  assets.sort((a: any, b: any) => periodScore(b) - periodScore(a));
  const asset = assets.find((row: any) => String(row?.owner_id || "") === String(userId || "")) || assets[0];
  // Prefer the workbook so the header-aware importer can rebuild values with correct hour alignment.
  if (asset) return {
    rows: [],
    source: "saved_file",
    asset: {
      id: asset.id,
      bucket_id: asset.bucket_id || "kedco-evidence",
      storage_path: asset.storage_path,
      original_name: asset.original_name,
      mime_type: asset.mime_type || "application/octet-stream"
    }
  };
  const historyRows = snapshotRows(form, readingDate, userId);
  if (historyRows.length) return { rows: historyRows, source: "saved_snapshot", asset: null };
  return {
    rows: [],
    source: "saved_folder",
    asset: null
  };
}

function latestLoadFlowRows(rows: any[]) {
  const latest = new Map<string, any>();
  for (const row of rows) {
    const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
    const fieldName = String(payload.field_name || "").trim();
    const key = fieldName || [row.station_name || "", row.feeder_name || "", row.reading_hour ?? ""].join("|");
    const previous = latest.get(key);
    const previousTime = Date.parse(String(previous?.event_time || previous?.updated_at || previous?.created_at || 0)) || 0;
    const currentTime = Date.parse(String(row?.event_time || row?.updated_at || row?.created_at || 0)) || 0;
    if (!previous || currentTime >= previousTime) latest.set(key, row);
  }
  return [...latest.values()];
}

router.get("/", (_req, res) => res.json({ ok: true, module: "Local Live Operations", mode: "local" }));

router.get("/load-flow/day", (req, res) => {
  const form = String(req.query.form || "").trim();
  const readingDate = String(req.query.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(readingDate) || !["load33", "load11"].includes(form)) return res.status(400).json({ error: "Valid form=load33|load11 and date=YYYY-MM-DD are required" });
  const types = form === "load33" ? ["LOAD_FLOW_33KV"] : ["LOAD_FLOW_11KV", "LOAD_FLOW_11KV_SUBMISSION"];
  const isCurrentMonth = readingDate.slice(0, 7) === lagosYearMonth();
  let rows: any[] = [];
  let source = "live_operations";
  let savedFile: Record<string, unknown> | null = null;

  if (isCurrentMonth) {
    // The current Lagos month is always the shared editable operating sheet.
    // Historical snapshots must never overwrite or masquerade as live values.
    rows = queryTable("kedco_station_live_operations", [{ op: "eq", column: "reading_date", value: readingDate }], { column: "event_time", ascending: true }, 0, 100000)
      .filter((row: any) => types.includes(String(row.operation_type || "")));
  } else {
    const saved = savedLoadFlowRows(form, readingDate, String(res.locals.kedcoUser?.id || ""));
    rows = saved.rows;
    source = saved.source;
    savedFile = saved.asset || null;
  }

  res.json({
    ok: true,
    form,
    reading_date: readingDate,
    data_source: source,
    source_label: source === "live_operations" ? "kedco_station_live_operations" : source === "saved_file" ? "local saved Analyzer workbook" : "local saved load-flow history",
    saved_file: savedFile,
    rows: latestLoadFlowRows(rows)
  });
});

router.get("/load-flow/workbook", (req, res) => {
  const form = String(req.query.form || "").trim();
  const readingDate = String(req.query.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(readingDate) || !["load33", "load11"].includes(form)) return res.status(400).json({ error: "Valid form=load33|load11 and date=YYYY-MM-DD are required" });
  if (readingDate.slice(0, 7) === lagosYearMonth()) return res.status(404).json({ error: "The current month is served by the live operations sheet." });
  const saved = savedLoadFlowRows(form, readingDate, String(res.locals.kedcoUser?.id || ""));
  if (saved.source !== "saved_file" || !saved.asset?.storage_path) return res.status(404).json({ error: "No saved workbook is available for this date." });
  const file = storagePath(String(saved.asset.bucket_id || "kedco-evidence"), String(saved.asset.storage_path));
  if (!fs.existsSync(file)) return res.status(404).json({ error: "The saved workbook is no longer present in Local Cloud storage." });
  res.type(String(saved.asset.mime_type || "application/octet-stream"));
  res.setHeader("Content-Disposition", `inline; filename="${String(saved.asset.original_name || `${form}-${readingDate}.xlsx`).replace(/[\r\n\"]+/g, "_")}"`);
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(file);
});

router.post("/load-flow/batch", async (req, res, next) => {
  try {
    const user = res.locals.kedcoUser;
    const operations = Array.isArray(req.body?.operations) ? req.body.operations : [];
    if (!operations.length) return res.status(400).json({ error: "No load-flow readings were supplied" });
    if (operations.length > 5000) return res.status(413).json({ error: "Maximum local batch is 5000 readings" });
    const now = new Date().toISOString();
    const rows: any[] = [];
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i] || {};
      const operationType = String(op.requested_operation_type || "").trim().toUpperCase();
      if (!LOAD_FLOW_TYPES.has(operationType)) return res.status(400).json({ error: `Invalid load-flow operation type at item ${i + 1}` });
      const date = String(op.requested_reading_date || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: `Invalid reading date at item ${i + 1}` });
      const hRaw = op.requested_reading_hour;
      const h = hRaw === null || hRaw === undefined || hRaw === "" ? null : Number(hRaw);
      if (h !== null && (!Number.isInteger(h) || h < 0 || h > 24)) return res.status(400).json({ error: `Invalid reading hour at item ${i + 1}` });
      const sourceId = crypto.randomUUID();
      rows.push({
        created_by: user.id, source_table: "local_cloud_data", source_record_id: sourceId, source_key: sourceId,
        operation_type: operationType, station_name: op.requested_station_name || null, region_name: op.requested_region_name || null,
        state_code: op.requested_state_code || null, voltage_level: operationType.includes("33KV") ? "33KV" : "11KV",
        feeder_name: op.requested_feeder_name || null, reading_date: date, reading_hour: h,
        shift: op.requested_shift || null, status: op.requested_status || "LIVE", summary: op.requested_summary || null,
        payload: op.requested_payload || {}, event_time: now
      });
    }
    await insertTable("kedco_station_live_operations", rows);
    res.json({ ok: true, saved: rows.length, reading_date: rows[0]?.reading_date || null, storage: "cloud data/load-flow" });
  } catch (error) { next(error); }
});

export default router;
