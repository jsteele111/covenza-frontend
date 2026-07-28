import model from "../config/depositModel.json";

/**
 * Recommended minimum deposit, as a fraction of principal, for a loan in
 * `symbol` lasting `durationDays` — computed from the versioned deposit
 * model (see src/config/depositModel.json), exactly mirroring the
 * spreadsheet's formula:
 *
 *    deposit% = (worstCaseAnnualVol / sqrt(365)) * sqrt(durationDays) * z
 *
 * Returns { pct95, pct99, version, modelDate } — both confidence levels,
 * per the operator-configurable design, plus provenance for display.
 * Returns null if the asset isn't in the model (e.g. a newly whitelisted
 * asset the model hasn't been refreshed to cover yet — the UI should say
 * so honestly rather than showing a stale or guessed figure).
 */
export function recommendedDeposit(symbol, durationDays) {
  const annualVol = model.worstCaseAnnualVol[symbol];
  if (annualVol === undefined || !durationDays || durationDays <= 0) {
    return null;
  }
  const dailyVol = annualVol / Math.sqrt(365);
  const scaled = dailyVol * Math.sqrt(durationDays);
  return {
    pct95: scaled * model.zScores.z95,
    pct99: scaled * model.zScores.z99,
    version: model.version,
    modelDate: model.modelDate,
  };
}

export function depositModelInfo() {
  return { version: model.version, modelDate: model.modelDate, source: model.source };
}