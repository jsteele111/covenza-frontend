import { useState, useEffect } from "react";
import { useAccount, useChainId, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from "wagmi";
import { parseUnits, maxUint256 } from "viem";
import { VAULT_FACTORY_ABI, ERC20_ABI, ASSET_REGISTRY_ABI } from "../config/abis.js";
import { getContractsForChain } from "../config/contracts.js";
import { formatTokenAmount } from "../utils/format.js";
import { useMandates, previewMandateApr } from "../hooks/useMandates.js";
import { TIER_LABELS } from "../hooks/useVaultData.js";
import { ActionButton } from "./ActionButton.jsx";

const factoryAbi = VAULT_FACTORY_ABI;
const erc20Abi = ERC20_ABI;
const DAY = 86400;

/**
 * The lender's side of the mandate system: publish terms, watch them, withdraw.
 *
 * Capital never leaves the wallet until a borrower fills — only an allowance is
 * granted. That is what makes publishing cheap enough to do speculatively,
 * which is the point: requiring lenders to escrow funds before a counterparty
 * exists is the friction that empties the scarce side of a two-sided market.
 */
export function MandatePanel({ selectedAsset, selectedSymbol, decimals }) {
  const { address } = useAccount();
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);
  const publicClient = usePublicClient();

  const { mandates, refetch } = useMandates({ lenderFilter: address, onlyLive: false });

  const [minPrincipal, setMinPrincipal] = useState("10");
  const [maxPrincipal, setMaxPrincipal] = useState("100");
  const [minTermDays, setMinTermDays]   = useState("1");
  const [maxTermDays, setMaxTermDays]   = useState("30");
  const [validHours, setValidHours]     = useState("6");
  const [maxTier, setMaxTier]           = useState(0);
  const [baseApr, setBaseApr]           = useState("9");
  const [termPremium, setTermPremium]   = useState("2");
  const [depositCredit, setDepositCredit] = useState("10");
  const [minDeposit, setMinDeposit]     = useState("15");
  const [minApr, setMinApr]             = useState("5");

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { data: receipt, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash });

  // See MandateBoard: a reverted transaction still yields a receipt, so
  // liveness has to be read off the status rather than off the query.
  const isSuccess = receipt?.status === "success";

  // Capacity, not intent. A mandate is only fillable up to
  // min(allowance, balance) — publishing terms without an allowance produces a
  // board entry showing zero available, which reads as a bug rather than as
  // the missing approval it is.
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: selectedAsset, abi: erc20Abi, functionName: "allowance",
    args: [address, contracts.vaultFactory],
    query: { enabled: Boolean(selectedAsset && address), refetchInterval: 15000 },
  });

  const { data: balance } = useReadContract({
    address: selectedAsset, abi: erc20Abi, functionName: "balanceOf",
    args: [address],
    query: { enabled: Boolean(selectedAsset && address), refetchInterval: 15000 },
  });

  useEffect(() => {
    if (isSuccess) { refetch(); refetchAllowance(); reset(); }
  }, [isSuccess]);

  const busy = isPending || isConfirming;

  const capacity =
    allowance !== undefined && balance !== undefined
      ? (allowance < balance ? allowance : balance)
      : undefined;

  const wantedMax = tryParse(maxPrincipal, decimals);
  const capacityShort = capacity !== undefined && wantedMax !== undefined && capacity < wantedMax;

  // The floor depends on the RISK CEILING, not on the loan asset — a mandate
  // permitting Standard-tier holdings is underwriting Standard-tier
  // volatility whatever it lends. Quoting fixed blue-chip figures here was
  // wrong by 10 percentage points the moment the lender moved off blue chip.
  const { data: floorShortBps } = useReadContract({
    address: contracts.assetRegistry, abi: ASSET_REGISTRY_ABI,
    functionName: "minimumDepositBpsForTier",
    args: [maxTier, BigInt(Math.round(Number(minTermDays) * DAY) || 0)],
    query: { enabled: Number(minTermDays) > 0 },
  });

  const { data: floorLongBps } = useReadContract({
    address: contracts.assetRegistry, abi: ASSET_REGISTRY_ABI,
    functionName: "minimumDepositBpsForTier",
    args: [maxTier, BigInt(Math.round(Number(maxTermDays) * DAY) || 0)],
    query: { enabled: Number(maxTermDays) > 0 },
  });

  async function approveAll() {
    const fees = await publicClient.estimateFeesPerGas();
    writeContract({
      address: selectedAsset, abi: erc20Abi, functionName: "approve",
      args: [contracts.vaultFactory, maxUint256],
      maxFeePerGas: fees.maxFeePerGas * 2n, maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
  }

  // Preview the surface at its corners, so the lender sees what they are
  // actually writing rather than a set of coefficients.
  const preview = {
    baseAprBps: Math.round(Number(baseApr) * 100),
    termPremiumBpsPerDay: Math.round(Number(termPremium)),
    depositCreditBpsPerPoint: Math.round(Number(depositCredit)),
    minDepositBps: Math.round(Number(minDeposit) * 100),
    minAprBps: Math.round(Number(minApr) * 100),
  };
  // Declared after `preview`, which it reads — the floor queries above can sit
  // higher because they depend only on the tier and the term.
  const belowFloor =
    floorLongBps !== undefined && preview.minDepositBps < Number(floorLongBps);

  const cheapest = previewMandateApr(preview, Number(minTermDays) * DAY, preview.minDepositBps);
  const dearest  = previewMandateApr(preview, Number(maxTermDays) * DAY, preview.minDepositBps);
  const generous = previewMandateApr(preview, Number(maxTermDays) * DAY, preview.minDepositBps + 2000);

  async function publish() {
    const min = tryParse(minPrincipal, decimals);
    const max = tryParse(maxPrincipal, decimals);
    if (min === undefined || max === undefined) return;
    try {
      const fees = await publicClient.estimateFeesPerGas();
      writeContract({
        address: contracts.vaultFactory,
        abi: factoryAbi,
        functionName: "publishMandate",
        args: [{
          asset: selectedAsset,
          minPrincipal: min,
          maxPrincipal: max,
          minTermSeconds: BigInt(Math.round(Number(minTermDays) * DAY)),
          maxTermSeconds: BigInt(Math.round(Number(maxTermDays) * DAY)),
          validForSeconds: BigInt(Math.round(Number(validHours) * 3600)),
          maxTier,
          permittedBorrower: "0x0000000000000000000000000000000000000000",
          baseAprBps: BigInt(preview.baseAprBps),
          termPremiumBpsPerDay: BigInt(preview.termPremiumBpsPerDay),
          depositCreditBpsPerPoint: BigInt(preview.depositCreditBpsPerPoint),
          minDepositBps: BigInt(preview.minDepositBps),
          minAprBps: BigInt(preview.minAprBps),
        }],
        maxFeePerGas: fees.maxFeePerGas * 2n,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
    } catch { /* surfaced below */ }
  }

  async function cancelOne(id) {
    const fees = await publicClient.estimateFeesPerGas();
    writeContract({
      address: contracts.vaultFactory, abi: factoryAbi, functionName: "cancelMandate",
      args: [BigInt(id)],
      maxFeePerGas: fees.maxFeePerGas * 2n, maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
  }

  async function cancelAll() {
    const fees = await publicClient.estimateFeesPerGas();
    writeContract({
      address: contracts.vaultFactory, abi: factoryAbi, functionName: "cancelAllMandates", args: [],
      maxFeePerGas: fees.maxFeePerGas * 2n, maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
  }

  const live = mandates.filter((m) => m.isLive);

  if (!selectedAsset || decimals === undefined) {
    return (
      <p style={{ fontSize: 13, color: "var(--parch-dim)" }}>
        Select a whitelisted asset to publish a mandate against.
      </p>
    );
  }

  return (
    <div>
      <p style={sectionLabelStyle}>Publish a mandate</p>
      <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 12px", lineHeight: 1.5 }}>
        Terms a borrower can take without asking you first. Your capital stays in your
        wallet — only an allowance is granted, and a fill draws on it.
      </p>

      {/* Shown above the form rather than after publishing, because the fix is
          an approval the lender has to make either way and finding out from an
          empty board is a worse way to learn it. */}
      <div style={{
        background: "var(--ink)",
        border: `1px solid ${capacityShort ? "var(--brick)" : "var(--hairline)"}`,
        borderRadius: 8,
        padding: "12px 14px",
        marginBottom: 12,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
      }}>
        <div>
          <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 3px" }}>Lending capacity</p>
          <p className="mono" style={{ fontSize: 13, color: capacityShort ? "var(--brick)" : "var(--brass)", margin: 0 }}>
            {capacity !== undefined ? `${formatTokenAmount(capacity, decimals)} ${selectedSymbol}` : "—"}
          </p>
          <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "4px 0 0", lineHeight: 1.5 }}>
            {capacityShort
              ? "Below the maximum size below — borrowers will only see what you can actually cover."
              : "The lesser of your balance and your allowance to the factory. Funds stay in your wallet."}
          </p>
        </div>
        {capacityShort && (
          <button onClick={approveAll} disabled={busy} style={{ ...smallDangerButtonStyle, color: "var(--brass)", borderColor: "var(--brass)", whiteSpace: "nowrap" }}>
            Raise allowance
          </button>
        )}
      </div>

      <div style={cardStyle}>
        <Row2>
          <Field label={`Minimum size (${selectedSymbol})`}>
            <input value={minPrincipal} onChange={(e) => setMinPrincipal(e.target.value)} style={inputStyle} />
          </Field>
          <Field label={`Maximum size (${selectedSymbol})`}>
            <input value={maxPrincipal} onChange={(e) => setMaxPrincipal(e.target.value)} style={inputStyle} />
          </Field>
        </Row2>

        <Row2>
          <Field label="Shortest term (days)">
            <input value={minTermDays} onChange={(e) => setMinTermDays(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Longest term (days)">
            <input value={maxTermDays} onChange={(e) => setMaxTermDays(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Valid for (hours)">
            <input value={validHours} onChange={(e) => setValidHours(e.target.value)} style={inputStyle} />
          </Field>
        </Row2>

        <Field label="Risk ceiling">
          <div style={{ display: "inline-flex", background: "var(--ink)", border: "1px solid var(--hairline)", borderRadius: 8, padding: 3 }}>
            {[0, 1, 2].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setMaxTier(t)}
                style={{
                  border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer",
                  background: maxTier === t ? "var(--brass)" : "transparent",
                  color: maxTier === t ? "#1C1C1A" : "var(--parch-dim)",
                  fontWeight: maxTier === t ? 600 : 400,
                }}
              >
                {TIER_LABELS[t]}
              </button>
            ))}
          </div>
        </Field>

        <p style={{ fontSize: 11, color: "var(--parch)", margin: "8px 0 8px", fontWeight: 600 }}>Pricing</p>
        <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 10px", lineHeight: 1.5 }}>
          A formula, not a range. Publishing a range would mean publishing your worst
          terms — every borrower takes the longest term on the smallest deposit. Here
          both are priced, so you are indifferent across the whole surface.
        </p>
        <p style={{
          fontSize: 11,
          color: belowFloor ? "var(--brick)" : "var(--parch-dim)",
          margin: "0 0 10px",
          lineHeight: 1.5,
        }}>
          Your minimum deposit sits on top of the protocol's own floor, which rises with
          the square root of term and with the risk ceiling you set above.
          {floorShortBps !== undefined && floorLongBps !== undefined && (
            <> At <strong>{TIER_LABELS[maxTier]}</strong> the floor runs from{" "}
              <strong>{(Number(floorShortBps) / 100).toFixed(1)}%</strong> at {minTermDays}d to{" "}
              <strong>{(Number(floorLongBps) / 100).toFixed(1)}%</strong> at {maxTermDays}d.</>
          )}
          {" "}Whichever is higher binds, so setting yours low does not expose you below
          the floor — it just means the floor is what applies.
          {belowFloor && (
            <> Yours is under the floor at the long end, so borrowers taking longer terms
            will be asked for more than you advertised.</>
          )}
        </p>

        <Row2>
          <Field label="Base rate (% APR)">
            <input value={baseApr} onChange={(e) => setBaseApr(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Per day of term (bps)">
            <input value={termPremium} onChange={(e) => setTermPremium(e.target.value)} style={inputStyle} />
          </Field>
        </Row2>
        <Row2>
          <Field label="Credit per % of extra deposit (bps)">
            <input value={depositCredit} onChange={(e) => setDepositCredit(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Minimum deposit (%)">
            <input value={minDeposit} onChange={(e) => setMinDeposit(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Rate floor (% APR)">
            <input value={minApr} onChange={(e) => setMinApr(e.target.value)} style={inputStyle} />
          </Field>
        </Row2>

        <div style={{ background: "var(--ink)", border: "1px solid var(--hairline)", borderRadius: 8, padding: "12px 14px", margin: "0 0 12px" }}>
          <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 8px" }}>What a borrower would pay</p>
          <Line label={`${minTermDays}d at ${minDeposit}% deposit`} value={fmtApr(cheapest)} />
          <Line label={`${maxTermDays}d at ${minDeposit}% deposit`} value={fmtApr(dearest)} emphasis />
          <Line label={`${maxTermDays}d at ${Number(minDeposit) + 20}% deposit`} value={fmtApr(generous)} />
        </div>

        <ActionButton
          label="Publish mandate"
          primary
          loading={busy}
          onClick={publish}
        />
        {error && <p style={{ fontSize: 12, color: "var(--brick)", marginTop: 10 }}>{error.shortMessage || error.message}</p>}
      </div>

      {mandates.length > 0 && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "20px 0 8px" }}>
            <p style={{ ...sectionLabelStyle, margin: 0 }}>Your mandates</p>
            {live.length > 1 && (
              <button onClick={cancelAll} disabled={busy} style={smallDangerButtonStyle}>
                Cancel all ({live.length})
              </button>
            )}
          </div>

          {/* One transaction kills every mandate. If withdrawing during a rate
              move were expensive, the rational move would be to leave stale
              mandates standing — and a book of mispriced offers is worse than
              an empty one. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {mandates.map((m) => (
              <div key={m.id} style={{ ...cardStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <p style={{ fontSize: 12, color: "var(--parch)", margin: "0 0 3px" }}>
                    {formatTokenAmount(m.minPrincipal, decimals)}–{formatTokenAmount(m.maxPrincipal, decimals)} {m.symbol}
                    {" · "}{m.minTermSeconds / DAY}–{m.maxTermSeconds / DAY}d{" · "}{m.maxTierLabel}
                  </p>
                  <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: 0 }}>
                    {m.isLive
                      ? `fillable now: ${formatTokenAmount(m.fillable, decimals)} ${m.symbol}`
                      : "no longer live"}
                  </p>
                </div>
                {m.isLive && (
                  <button onClick={() => cancelOne(m.id)} disabled={busy} style={smallDangerButtonStyle}>
                    Cancel
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function tryParse(v, decimals) {
  if (!v || decimals === undefined || decimals === null) return undefined;
  try {
    const parsed = parseUnits(v, decimals);
    return parsed > 0n ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function fmtApr(bps) {
  return bps == null ? "—" : `${(bps / 100).toFixed(2)}% APR`;
}

function Line({ label, value, emphasis }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
      <span style={{ fontSize: 11, color: "var(--parch-dim)" }}>{label}</span>
      <span className="mono" style={{
        fontSize: 12,
        color: emphasis ? "var(--brass)" : "var(--parch-dim)",
        fontWeight: emphasis ? 600 : 400,
      }}>{value}</span>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12, flex: 1 }}>
      <label style={{ fontSize: 12, color: "var(--parch-dim)", display: "block", marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

function Row2({ children }) {
  return <div style={{ display: "flex", gap: 12 }}>{children}</div>;
}

const sectionLabelStyle = { fontSize: 13, fontWeight: 600, color: "var(--parch)", margin: "0 0 8px" };

const cardStyle = {
  background: "var(--panel)",
  borderRadius: 10,
  border: "1px solid var(--hairline)",
  padding: "18px 20px",
};

const inputStyle = {
  width: "100%",
  background: "var(--ink)",
  border: "1px solid var(--hairline)",
  borderRadius: 8,
  padding: "9px 10px",
  color: "var(--parch)",
  fontSize: 13,
  fontFamily: "IBM Plex Mono, monospace",
};

const smallDangerButtonStyle = {
  background: "transparent",
  color: "var(--brick)",
  border: "1px solid var(--brick)",
  borderRadius: 6,
  padding: "5px 11px",
  fontSize: 11,
  fontWeight: 500,
  cursor: "pointer",
};
