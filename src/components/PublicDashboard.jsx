import { useState } from "react";
import { useChainId, useReadContract } from "wagmi";
import { useProtocolStats } from "../hooks/useProtocolStats.js";
import { getContractsForChain } from "../config/contracts.js";
import { ASSET_REGISTRY_ABI } from "../config/abis.js";
import { TIER_LABELS } from "../hooks/useVaultData.js";
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
          Per-asset risk buffer, enforced deposit floors, and on-chain settlement configuration —
          the same figures underwriting every vault, visible to anyone before they lend or borrow.
        </p>
      </div>

      {/* Several values below are tuned so that settlement paths are reachable
          within a single sitting — a 90-second grace period is not a protocol
          parameter, it is a demo convenience. Left unqualified, a page headed
          "the same figures underwriting every vault" invites a reader to take
          them for the product's real settings. */}
      <div
        style={{
          border: "1px solid var(--hairline)",
          borderLeft: "3px solid var(--brass)",
          borderRadius: 8,
          padding: "10px 14px",
          background: "var(--panel)",
        }}
      >
        <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: 0, lineHeight: 1.6 }}>
          <span style={{ color: "var(--brass)", fontWeight: 600 }}>Testnet values.</span>{" "}
          The TWAP window, grace period and keeper bounty below are deliberately short and steep so
          that every settlement path can be exercised in one sitting. Production requires a
          30-minute TWAP window and a grace period measured in hours; the deploy guard refuses
          anything shorter.
        </p>
      </div>

      <ProtocolConfigStrip config={protocolConfig} isLoading={isLoading} />

      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: 0 }}>
            Minimum deposit required for
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

      {/* Every figure above is read live from the registry and the pool. The
          footnote this replaced cited a bundled model dated 23 July whose
          asset cohort was never deployed on this chain. */}
      <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: 0, lineHeight: 1.6 }}>
        All figures read live from the asset registry and insurance pool. Deposit floors are
        computed on chain from each tier's assumed volatility and the square root of term, and are
        enforced at origination.
      </p>
    </div>
  );
}

function AssetCard({ asset, durationDays }) {
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);

  // The floor the contract will ACTUALLY enforce for this asset's tier at this
  // term — not a recommendation from a bundled table.
  //
  // The table it replaced was keyed by symbol and listed ETH, WBTC, USDC and
  // USDT: the Arbitrum Sepolia cohort. None of them are deployed, so every
  // card on this page read "no deposit-sizing data published for this asset
  // yet" while the protocol was perfectly capable of stating the number. The
  // deposit floor also stopped being advisory when it moved on chain — it is
  // refused at origination now, so quoting anything else would be wrong even
  // if the table had been current.
  const { data: floorBps } = useReadContract({
    address: contracts.assetRegistry,
    abi: ASSET_REGISTRY_ABI,
    functionName: "minimumDepositBpsForTier",
    args: [asset.tier ?? 0, BigInt(durationDays * 86400)],
    query: { enabled: asset.tier !== undefined },
  });

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
        <Row
          label="Risk tier"
          value={asset.tier === undefined ? "—" : (TIER_LABELS[asset.tier] || `Tier ${asset.tier}`)}
        />
        <Row
          label={`Minimum deposit at ${durationDays}d`}
          value={floorBps === undefined ? "—" : `${(Number(floorBps) / 100).toFixed(1)}%`}
        />
        <p style={{ fontSize: 10.5, color: "var(--slate)", margin: "8px 0 0", lineHeight: 1.5 }}>
          Enforced at origination, not advisory. Rises with the square root of term.
        </p>
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