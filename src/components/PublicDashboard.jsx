import { useState } from "react";
import { useProtocolStats } from "../hooks/useProtocolStats.js";
import { recommendedDeposit, depositModelInfo } from "../utils/deposit.js";
import { formatTokenAmount, formatPercent, shortAddress } from "../utils/format.js";

const DURATION_OPTIONS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

/**
 * Group E3 — public, per-asset protocol dashboard. No wallet or role
 * required; this is the transparency layer the BRD's auditability (NFR-5)
 * and lender disclosure (FIN-3) requirements point at — anyone should be
 * able to see, asset by asset, how much risk buffer backs the protocol and
 * how the deposit-sizing model prices that risk, before ever connecting a
 * wallet.
 */
export function PublicDashboard() {
  const { isConfigured, assets, protocolConfig, isLoading } = useProtocolStats();
  const [durationDays, setDurationDays] = useState(30);
  const model = depositModelInfo();

  if (!isConfigured) {
    return (
      <EmptyState
        title="Dashboard not yet live"
        message="The v2 protocol contracts (asset registry, insurance pool, vault factory) haven't been deployed on this network yet. This view will populate automatically once Group F's deployment fills in real addresses."
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <p className="serif" style={{ fontSize: 20, fontWeight: 500, margin: "0 0 4px" }}>
          Protocol dashboard
        </p>
        <p style={{ fontSize: 13, color: "var(--parch-dim)", margin: 0, lineHeight: 1.5 }}>
          Per-asset risk buffer, deposit-sizing model, and on-chain settlement configuration —
          the same figures underwriting every vault, visible to anyone before they lend or borrow.
        </p>
      </div>

      <ProtocolConfigStrip config={protocolConfig} isLoading={isLoading} />

      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: 0 }}>
            Recommended minimum deposit for
          </p>
          <DurationSwitcher value={durationDays} onChange={setDurationDays} />
        </div>

        {isLoading && assets.length === 0 && (
          <p style={{ fontSize: 12, color: "var(--parch-dim)" }}>Loading protocol data...</p>
        )}

        {!isLoading && assets.length === 0 && (
          <EmptyState
            title="No whitelisted assets yet"
            message="The asset registry is deployed but no assets have been whitelisted. Check back once the operator adds one."
          />
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
          {assets.map((asset) => (
            <AssetCard key={asset.address} asset={asset} durationDays={durationDays} />
          ))}
        </div>
      </div>

      <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: 0 }}>
        Deposit model v{model.version}, dated {model.modelDate}. {model.source}
      </p>
    </div>
  );
}

function AssetCard({ asset, durationDays }) {
  const dep = recommendedDeposit(asset.symbol, durationDays);

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
        <span className="serif" style={{ fontSize: 16, fontWeight: 600, color: "var(--parch)" }}>
          {asset.symbol}
        </span>
        <span className="mono" style={{ fontSize: 11, color: "var(--parch-dim)" }}>
          {shortAddress(asset.address)}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 12, borderTop: "1px solid var(--hairline)" }}>
        <Row
          label="Insurance reserve (risk buffer)"
          value={`${formatTokenAmount(asset.reserve, asset.decimals)} ${asset.symbol}`}
        />
        <Row label="Active vaults / total" value={`${asset.activeVaults} / ${asset.totalVaults}`} />
        <Row
          label="Active principal"
          value={`${formatTokenAmount(asset.activePrincipal, asset.decimals)} ${asset.symbol}`}
        />
        <Row
          label="Total principal (all-time)"
          value={`${formatTokenAmount(asset.totalPrincipal, asset.decimals)} ${asset.symbol}`}
        />
      </div>

      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--hairline)" }}>
        {dep ? (
          <>
            <Row label="Recommended min. deposit (95%)" value={formatPercent(dep.pct95)} />
            <Row label="Recommended min. deposit (99%)" value={formatPercent(dep.pct99)} />
          </>
        ) : (
          <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: 0 }}>
            No deposit-sizing data published for this asset yet.
          </p>
        )}
      </div>
    </div>
  );
}

function ProtocolConfigStrip({ config, isLoading }) {
  if (isLoading && !config) {
    return (
      <div style={cardStyle}>
        <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: 0 }}>Loading protocol configuration...</p>
      </div>
    );
  }
  if (!config) return null;

  const items = [
    { label: "Total vaults ever", value: config.totalVaults },
    { label: "TWAP window", value: config.twapWindow != null ? `${Number(config.twapWindow) / 60} min` : "—" },
    { label: "TWAP tolerance", value: config.twapToleranceBps != null ? formatPercent(Number(config.twapToleranceBps) / 10000) : "—" },
    { label: "Swap-back grace period", value: config.swapBackGracePeriod != null ? `${Number(config.swapBackGracePeriod) / 3600}h` : "—" },
    { label: "Keeper bounty rate", value: config.bountyRatePerHourBps != null ? `${formatPercent(Number(config.bountyRatePerHourBps) / 10000)}/hr` : "—" },
    { label: "Keeper bounty cap", value: config.bountyCapBps != null ? formatPercent(Number(config.bountyCapBps) / 10000) : "—" },
    { label: "Insurance draw cap", value: config.drawCapBps != null ? formatPercent(Number(config.drawCapBps) / 10000) : "—" },
    { label: "Insurance skim rate", value: config.insuranceSkimRateBps != null ? formatPercent(Number(config.insuranceSkimRateBps) / 10000) : "—" },
  ];

  return (
    <div style={cardStyle}>
      <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 12px" }}>
        Protocol-wide settlement configuration
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
        {items.map((item) => (
          <div key={item.label}>
            <p style={{ fontSize: 10, color: "var(--parch-dim)", margin: "0 0 2px" }}>{item.label}</p>
            <p className="mono" style={{ fontSize: 14, color: "var(--parch)", margin: 0 }}>{item.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function DurationSwitcher({ value, onChange }) {
  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--panel)",
        border: "0.5px solid var(--hairline)",
        borderRadius: 8,
        padding: 3,
      }}
    >
      {DURATION_OPTIONS.map((opt) => {
        const active = value === opt.days;
        return (
          <button
            key={opt.days}
            onClick={() => onChange(opt.days)}
            style={{
              border: "none",
              borderRadius: 6,
              padding: "4px 12px",
              fontSize: 12,
              cursor: "pointer",
              background: active ? "var(--brass)" : "transparent",
              color: active ? "#1C1C1A" : "var(--parch-dim)",
              fontWeight: active ? 600 : 400,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
      <span style={{ fontSize: 12, color: "var(--parch-dim)" }}>{label}</span>
      <span className="mono" style={{ fontSize: 13, color: "var(--parch)", textAlign: "right" }}>{value}</span>
    </div>
  );
}

function EmptyState({ title, message }) {
  return (
    <div style={{ background: "var(--panel)", borderRadius: 10, border: "1px solid var(--hairline)", padding: "24px 20px", textAlign: "center" }}>
      {title && <p style={{ fontSize: 14, color: "var(--parch)", margin: "0 0 8px", fontWeight: 600 }}>{title}</p>}
      <p style={{ fontSize: 13, color: "var(--parch-dim)", margin: 0, lineHeight: 1.5 }}>{message}</p>
    </div>
  );
}

const cardStyle = {
  background: "var(--panel)",
  borderRadius: 10,
  border: "1px solid var(--hairline)",
  padding: "18px 20px",
};