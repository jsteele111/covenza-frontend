import { Seal } from "./Seal.jsx";
import { formatTokenAmount, shortAddress, formatCountdown } from "../utils/format.js";
import { useChainNow } from "../hooks/useChainNow.js";

/**
 * One vault's terms, what it owes now, and — once settled — how it settled.
 *
 * October 2026 (contracts frozen for audit): the yield-position panel is gone
 * with the yield venues (E-1). A settled vault now shows its recorded outcome
 * from the vault's own settled* fields rather than a single severity line, and
 * an in-kind close says so instead of reporting a cash loss that the handed-over
 * assets may have covered (audit I-3).
 */
export function VaultStatement({ vault }) {
  const chainNow = useChainNow();
  if (!vault) {
    return (
      <div style={cardStyle}>
        <p style={{ fontSize: 13, color: "var(--parch-dim)", margin: 0 }}>
          No vault found for this wallet yet.
        </p>
      </div>
    );
  }

  const amount = (value) =>
    value != null ? `${formatTokenAmount(value, vault.decimals)} ${vault.symbol}` : "—";

  // Two figures, because interest accrues on time elapsed and the difference
  // between them is the entire economics of closing early.
  const lenderNow = vault.principal != null && vault.fee != null ? vault.principal + vault.fee : undefined;
  const lenderAtTerm =
    vault.principal != null && vault.fullTermFee != null ? vault.principal + vault.fullTermFee : undefined;

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "0 0 4px" }}>
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
        {vault.insurancePremium > 0n && (
          <Row label="Insurance premium" value={amount(vault.insurancePremium)} />
        )}
        <Row label="Risk ceiling" value={vault.maxTierLabel} />
        <Row label="Interest rate" value={vault.aprBps != null ? `${Number(vault.aprBps) / 100}% APR` : "—"} />

        {!vault.isSettled && (
          <>
            <Row label="Interest accrued" value={amount(vault.fee)} />
            <Row label="Interest at full term" value={amount(vault.fullTermFee)} />
            <Row label="Lender receives if settled now" value={amount(lenderNow)} />
            <Row label="Lender receives if held to deadline" value={amount(lenderAtTerm)} />
          </>
        )}
        <Row label="Deadline" value={vault.isSettled ? "Settled" : formatCountdown(vault.deadline, chainNow)} />
      </div>

      {vault.isSettled && vault.depositPaid && <Outcome vault={vault} amount={amount} />}

      {!vault.isSettled && vault.heldAssetCount > 0 && (
        <div style={panelStyle}>
          <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: 0, lineHeight: 1.5 }}>
            Holding {vault.heldAssetCount} foreign asset{vault.heldAssetCount > 1 ? "s" : ""} from directional
            swaps. Settlement sells {vault.heldAssetCount > 1 ? "them" : "it"} back to {vault.symbol} at no worse
            than the TWAP less the tolerance; if a held asset cannot be sold at all, the loan can be settled in
            kind 7 days after grace ends.
          </p>
        </div>
      )}
    </div>
  );
}

/** The recorded result of settlement, read from the vault's settled* fields. */
function Outcome({ vault, amount }) {
  const inKind = vault.settledInKind;
  return (
    <div style={panelStyle}>
      <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "0 0 10px" }}>
        Outcome — <span style={{ color: severityColor(vault.lossSeverity) }}>{vault.lossSeverityLabel}</span>
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Row small label={inKind ? "Cash in the vault" : "Returned to the vault"} value={amount(vault.settledTotalReturned)} />
        {vault.settledInsuranceDraw > 0n && <Row small label="Insurance draw" value={amount(vault.settledInsuranceDraw)} />}
        <Row small label={inKind ? "Lender — cash" : "Lender received"} value={amount(vault.settledLenderPayout)} />
        <Row small label={inKind ? "Borrower — cash" : "Borrower received"} value={amount(vault.settledBorrowerPayout)} />
        <Row small label="Interest charged" value={amount(vault.settledFee)} />
        {vault.settledProtocolFee > 0n && <Row small label="Protocol fee" value={amount(vault.settledProtocolFee)} />}
        {vault.settledReferrerFee > 0n && <Row small label="Referrer fee" value={amount(vault.settledReferrerFee)} />}
        {vault.settledBounty > 0n && <Row small label="Keeper bounty" value={amount(vault.settledBounty)} />}
      </div>
      {inKind && (
        <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "10px 0 0", lineHeight: 1.5 }}>
          Settled in kind: assets the vault could not sell were handed over at their TWAP value — to the
          lender up to what was still owed, the rest to the borrower. Those handovers are not in the cash
          figures above, so whether the lender was made whole cannot be read from them alone.
        </p>
      )}
    </div>
  );
}

function severityColor(severity) {
  if (severity === 2) return "var(--brick)";
  if (severity === 1 || severity === 3) return "var(--slate)";
  return "var(--sage)";
}

function Row({ label, value, small }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
      <span style={{ fontSize: small ? 12 : 13, color: "var(--parch-dim)" }}>{label}</span>
      <span className="mono" style={{ fontSize: small ? 12 : 14, color: "var(--parch)" }}>{value}</span>
    </div>
  );
}

const cardStyle = {
  background: "var(--panel)",
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  padding: "18px 20px",
};

const panelStyle = {
  marginTop: 16,
  padding: "12px 14px",
  background: "var(--ink)",
  border: "1px solid var(--hairline)",
  borderRadius: 8,
};
