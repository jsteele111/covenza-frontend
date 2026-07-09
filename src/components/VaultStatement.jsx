import { Seal } from "./Seal.jsx";
import { formatEth, shortAddress, formatCountdown } from "../utils/format.js";

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

  const aWethBalance = vault.aWethBalance || 0n;

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 4px" }}>Vault statement</p>
          <p className="mono" style={{ fontSize: 12, color: "var(--parch-dim)", margin: 0 }}>
            {shortAddress(vault.address)}
          </p>
        </div>
        <Seal vault={vault} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 14, borderTop: "1px solid var(--hairline)" }}>
        <Row label="Principal" value={formatEth(vault.principal)} />
        <Row
          label={vault.depositPaid ? "Deposit paid" : "Deposit required"}
          value={formatEth(vault.depositPaid ? vault.deposit : vault.requiredDeposit)}
        />
        <Row label="Repayment due" value={formatEth(vault.repaymentDue)} />
        <Row label="Deadline" value={vault.isSettled ? "Settled" : formatCountdown(vault.deadline)} />
      </div>

      {aWethBalance > 0n && (
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
            <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 4px" }}>Aave position</p>
            <p className="mono" style={{ fontSize: 14, color: "var(--slate)", margin: 0 }}>
              {formatEth(aWethBalance)} (aWETH)
            </p>
          </div>
          <span style={{ fontSize: 11, color: "var(--slate)", border: "1px solid var(--slate)", borderRadius: 20, padding: "3px 9px" }}>
            Earning yield
          </span>
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
