/**
 * Visa-requirement lookup over the bundled passport-index dataset
 * (src/lib/travel/data/passport-index.json, from ilyankou/passport-index-dataset, MIT).
 *
 * The ~658 KB full 199×199 matrix is DYNAMICALLY imported on first lookup, so it
 * stays out of the initial client bundle. SSR-safe: no browser globals.
 *
 * Raw cell values in the dataset are one of:
 *   "visa free" | "visa on arrival" | "e-visa" | "eta" | "visa required" |
 *   "no admission" | <number-of-days> (string, e.g. "90" → visa-free for N days)
 */

export type VisaStatus =
  | "visa-free"
  | "visa-free-days"
  | "visa-on-arrival"
  | "e-visa"
  | "eta"
  | "visa-required"
  | "no-admission"
  | "home"
  | "unknown";

export interface VisaRequirement {
  fromCC: string;
  toCC: string;
  status: VisaStatus;
  /** Number of visa-free days when status is "visa-free-days". */
  days?: number;
  /** Short human-readable label, e.g. "Visa-free (90 days)". */
  label: string;
  /** Original raw dataset value (for debugging / display). */
  raw: string;
}

type Matrix = Record<string, Record<string, string>>;

let matrixPromise: Promise<Matrix> | null = null;

async function loadMatrix(): Promise<Matrix> {
  if (matrixPromise) return matrixPromise;
  matrixPromise = (async () => {
    const mod = await import("./data/passport-index.json");
    return (mod.default ?? mod) as unknown as Matrix;
  })();
  return matrixPromise;
}

function classify(raw: string): { status: VisaStatus; days?: number; label: string } {
  const v = raw.trim().toLowerCase();
  if (/^\d+$/.test(v)) {
    const days = Number(v);
    return { status: "visa-free-days", days, label: `Visa-free (${days} days)` };
  }
  switch (v) {
    case "visa free":
      return { status: "visa-free", label: "Visa-free" };
    case "visa on arrival":
      return { status: "visa-on-arrival", label: "Visa on arrival" };
    case "e-visa":
      return { status: "e-visa", label: "e-Visa" };
    case "eta":
      return { status: "eta", label: "ETA required" };
    case "visa required":
      return { status: "visa-required", label: "Visa required" };
    case "no admission":
      return { status: "no-admission", label: "No admission" };
    default:
      return { status: "unknown", label: "Unknown" };
  }
}

/**
 * Visa requirement for a `fromCC` passport travelling to `toCC` (alpha-2 codes).
 * Returns null if the dataset fails to load. status "home" for same country,
 * "unknown" if the pair is missing.
 */
export async function visaRequirement(
  fromCC: string,
  toCC: string,
): Promise<VisaRequirement | null> {
  const from = fromCC.trim().toUpperCase();
  const to = toCC.trim().toUpperCase();
  if (!from || !to) return null;

  if (from === to) {
    return { fromCC: from, toCC: to, status: "home", label: "Home country", raw: "" };
  }

  let matrix: Matrix;
  try {
    matrix = await loadMatrix();
  } catch {
    return null;
  }

  const raw = matrix[from]?.[to];
  if (raw == null) {
    return { fromCC: from, toCC: to, status: "unknown", label: "Unknown", raw: "" };
  }
  const { status, days, label } = classify(raw);
  return { fromCC: from, toCC: to, status, days, label, raw };
}
