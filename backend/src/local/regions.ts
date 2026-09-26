import { tableRows } from "./store.js";

// Regions in the shared RE/TE responsibility register.
const RESPONSIBILITY_REGIONS = ["Jigawa North", "Jigawa South", "Jigawa West", "Kano Central", "Kano City", "Kano East", "Kano Industrial", "Kano North", "Kano Northwest", "Kano South", "Kano Southwest", "Kano West", "Katsina Central", "Katsina North", "Katsina South", "Katsina West"];

export function localRegions(): { id: string; name: string }[] {
  const configured = tableRows("kedco_regions").filter(row => row.is_active !== false).map(row => ({ id: String(row.id || row.name), name: String(row.name || row.region_name || row.id) }));
  for (const name of RESPONSIBILITY_REGIONS) {
    if (!configured.some(row => row.name.toLowerCase() === name.toLowerCase())) configured.push({ id: name, name });
  }
  return configured.sort((a, b) => a.name.localeCompare(b.name));
}

export function findRegion(value: unknown) {
  const key = String(value || "").trim().toLowerCase();
  return localRegions().find(row => row.id.toLowerCase() === key || row.name.toLowerCase() === key);
}
