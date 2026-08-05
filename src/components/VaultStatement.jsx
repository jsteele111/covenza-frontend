import { Seal } from "./Seal.jsx";
import { formatTokenAmount, shortAddress, formatCountdown } from "../utils/format.js";

/**
 * Rewritten for v2 (Group E4) — v1 assumed every vault was ETH-denominated
 * and read a hardcoded aWETH balance. v2 vaults carry their own asset,
 * decimals, and symbol (see useVaultData.js), and the Aave position — if
 * any — is whatever aToken the vault's asset actually maps to, looked up
 * live rather than assumed to be WETH's.
 */
export function VaultStatement({ vault }) {
  if (!vault) {
    return (
      <div style={cardStyle}>
        <p style={{ fontSize: 13, color: "var(--parch-dim)", margin: 0 }}>
          No vault found for this wallet yet.
        </p>
      </div>
    );
  }

  const amount = (value) => `${formatTokenAmount(value, vault.decimals)} ${vault.symbol}`;

  // Two figures, because interest accrues on time elapsed and the difference
  // between them is the entire economics of closing early.
  //
  // A single row labelled "Lender receives (at settlement)" showed only the
  // first. It reads as "at the end", which is the one thing it does not mean:
  // on a minutes-old loan it was principal plus the minimum charge, while
  // holding to the deadline paid several times that.
  const lenderNow = vault.principal != null && vault.fee != null
    ? vault.principal + vault.fee
    : undefined;

  const lenderAtTerm = vault.principal != null && vault.fullTermFee != null
    ? vault.principal + vault.fullTermFee
    : undefined;

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 4px" }}>
            Vault statement — <span style={{ color: "var(--parch)" }}>{vault.symbol}</span>
          </p>
          <p className="mono" style={{ fontSize: 12, color: "var(--parch-dim)", margin: 0 }}>
            {shortAddress(vault.address)}
          </p>
        </div>
        <Seal vault={vault} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 14, borderTop: "1px solid var(--hairline)" }}>
        <Row label="Principal" value={amount(vault.principal)} />
        <Row
          label={vault.depositPaid ? "Deposit paid" : "Deposit required"}
          value={amount(vault.depositPaid ? vault.deposit : vault.requiredDeposit)}
        />
        <Row label="Interest rate" value={vault.aprBps != null ? `${Number(vault.aprBps) / 100}% APR` : "—"} />
        {/* Accrued is what is owed now; the full term is the ceiling. Showing
            both makes the saving from closing early legible instead of
            implicit. */}
        <Row
          label="Interest accrued"
          value={vault.fee != null ? `${formatTokenAmount(vault.fee, vault.decimals)} ${vault.symbol}` : "—"}
        />
        <Row
          label="Interest at full term"
          value={vault.fullTermFee != null ? `${formatTokenAmount(vault.fullTermFee, vault.decimals)} ${vault.symbol}` : "—"}
        />
        <Row label="Lender receives if settled now" value={amount(lenderNow)} />
        <Row label="Lender receives if held to deadline" value={amount(lenderAtTerm)} />
        <Row label="Deadline" value={vault.isSettled ? "Settled" : formatCountdown(vault.deadline)} />
        {vault.isSettled && vault.lossSeverity > 0 && (
          <Row
            label="Settlement outcome"
            value={vault.lossSeverity === 2 ? "Settled with lender-impacted loss" : "Settled with borrower-only loss"}
          />
        )}
      </div>

      {vault.yieldPositionValue > 0n && (
        <div
          style={{
            marginTop: 16,
            padding: "12px 14px",
            background: "var(--ink)",
            border: "1px solid var(--hairline)",
            borderRadius: 8,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 4px" }}>
              Yield position — {vault.venueLabel}
            </p>
            {/* Denominated in the loan asset, not the venue's own token. An
                ERC-4626 share count would be meaningless to compare against
                principal; the vault converts before returning this. */}
            <p className="mono" style={{ fontSize: 14, color: "var(--slate)", margin: 0 }}>
              {formatTokenAmount(vault.yieldPositionValue, vault.decimals)} {vault.symbol}
            </p>
          </div>
          <span style={{ fontSize: 11, color: "var(--slate)", border: "1px solid var(--slate)", borderRadius: 20, padding: "3px 9px" }}>
            Earning yield
          </span>
        </div>
      )}

      {vault.heldAssetCount > 0 && (
        <div
          style={{
            marginTop: 16,
            padding: "12px 14px",
            background: "var(--ink)",
            border: "1px solid var(--hairline)",
            borderRadius: 8,
          }}
        >
          <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: 0 }}>
            Holding {vault.heldAssetCount} foreign asset{vault.heldAssetCount > 1 ? "s" : ""} from directional
            swaps — will be forced back to {vault.symbol} at settlement.
          </p>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ fontSize: 13, color: "var(--parch-dim)" }}>{label}</span>
      <span className="mono" style={{ fontSize: 14, color: "var(--parch)" }}>{value}</span>
    </div>
  );
}

const cardStyle = {
  background: "var(--panel)",
  borderRadius: 10,
  border: "1px solid var(--hairline)",
  padding: "18px 20px",
};