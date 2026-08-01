import { useState, useEffect } from "react";
import { useAccount, useChainId, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from "wagmi";
import { parseUnits, isAddress } from "viem";
import { KYC_REGISTRY_ABI, VAULT_FACTORY_ABI, ASSET_REGISTRY_ABI, ERC20_ABI } from "../config/abis.js";
import { getContractsForChain, isPlaceholder, symbolForToken } from "../config/contracts.js";
import { TIER_LABELS } from "../hooks/useVaultData.js";
import { MandatePanel } from "./MandatePanel.jsx";
import { useLatestVault } from "../hooks/useLatestVault.js";
import { useVaultData } from "../hooks/useVaultData.js";
import { recommendedDeposit } from "../utils/deposit.js";
import { formatTokenAmount, formatPercent } from "../utils/format.js";
import { VaultStatement } from "./VaultStatement.jsx";
import { ActionButton } from "./ActionButton.jsx";

// Referrer address used for direct originations through this interface.
// A platform integrating Covenza as a lending backend would pass its own
// address here and earn a share of the protocol fee.
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// abis.js already exports pre-parsed ABIs — do not re-wrap in parseAbi().
const kycAbi = KYC_REGISTRY_ABI;
const factoryAbi = VAULT_FACTORY_ABI;
const assetRegistryAbi = ASSET_REGISTRY_ABI;
const erc20Abi = ERC20_ABI;

function tryParseUnits(value, decimals) {
  if (!value || decimals === undefined || decimals === null) return undefined;
  try {
    const parsed = parseUnits(value, decimals);
    return parsed > 0n ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function tryBigInt(value) {
  if (!value) return undefined;
  try {
    const parsed = BigInt(value);
    return parsed > 0n ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Group E4 rewrite. v1 was single-asset (ETH only) and originated a vault
 * in one payable transaction. v2 is multi-asset and ERC20-native — every
 * origination is now two on-chain steps:
 *
 *   1. approve() — the lender authorizes the VaultFactory to pull
 *      `principal + insuranceSkim` of the chosen asset (quoteInsuranceSkim
 *      tells us the exact skim amount up front, per FR-8/insurance pool
 *      funding).
 *   2. deployVault() — non-payable, 7 args, asset-first (see abis.js).
 *
 * Both are modeled as one `pendingAction` state ("approve" | "deploy")
 * over a single writeContract/waitForReceipt pair, since they're always
 * sequential (approve, wait, then deploy) and never concurrent — same
 * shape as OperatorTab's revokingAddress pattern.
 */
export function LenderTab() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);
  const registryReady = !isPlaceholder(contracts.assetRegistry) && !isPlaceholder(contracts.vaultFactory);

  const [selectedAsset, setSelectedAsset] = useState("");
  const [borrower, setBorrower] = useState("");
  const [principal, setPrincipal] = useState("");
  const [feeRatePercent, setFeeRatePercent] = useState("3"); // e.g. "3" = 3%, charged in full regardless of early or on-time close
  const [depositRequired, setDepositRequired] = useState("");
  const [durationValue, setDurationValue] = useState("7");
  const [shortMode, setShortMode] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // "approve" | "deploy" | null

  // Mandates are the default because they are the general case: publish terms
  // and let any qualifying borrower take them. Direct origination is the
  // narrower one — it requires already knowing the counterparty's address.
  const [mode, setMode] = useState("mandate"); // "mandate" | "direct"

  const publicClient = usePublicClient();

  // --- Whitelisted assets ---
  const { data: whitelistedAssets } = useReadContract({
    address: contracts.assetRegistry,
    abi: assetRegistryAbi,
    functionName: "getWhitelistedAssets",
    query: { enabled: registryReady },
  });

  const assets = whitelistedAssets || [];

  useEffect(() => {
    if (!selectedAsset && assets.length > 0) setSelectedAsset(assets[0]);
  }, [assets, selectedAsset]);

  const selectedSymbol = selectedAsset ? symbolForToken(chainId, selectedAsset) : "";

  const { data: decimals } = useReadContract({
    address: selectedAsset,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: Boolean(selectedAsset) },
  });

  // --- Borrower KYC check ---
  const borrowerIsValidAddress = isAddress(borrower);

  const { data: isVerified } = useReadContract({
    address: contracts.kycRegistry,
    abi: kycAbi,
    functionName: "isVerified",
    args: [borrower],
    query: { enabled: borrowerIsValidAddress },
  });

  // --- Amount parsing ---
  const parsedPrincipal = tryParseUnits(principal, decimals);
  const parsedDeposit = tryParseUnits(depositRequired, decimals);
  // The rate the lender enters is now an ANNUAL rate. 3% means 3% per year,
  // accruing pro-rata — so the absolute interest depends on the term, and
  // every quote below has to be told the duration.
  const aprBps = feeRatePercent ? Math.round(parseFloat(feeRatePercent) * 100) : NaN;
  const aprValid = Number.isFinite(aprBps) && aprBps > 0;
  const durationBigInt = tryBigInt(durationValue);

  // The risk ceiling. This is the lender's only control over what the borrower
  // does with the money AFTER terms are agreed — without it, a lender pricing
  // for WETH exposure can end up backing a memecoin position they never had a
  // chance to price.
  const [maxTier, setMaxTier] = useState(0);

  const quoteArgs = [
    parsedPrincipal ?? 0n,
    BigInt(aprValid ? aprBps : 0),
    durationBigInt ?? 0n,
    shortMode,
  ];
  const quotesReady = Boolean(parsedPrincipal) && aprValid && durationBigInt !== undefined && durationBigInt > 0n;

  // What the loan earns if it runs to term. The lender's headline number.
  const { data: fullTermFee } = useReadContract({
    address: contracts.vaultFactory,
    abi: factoryAbi,
    functionName: "quoteFullTermFee",
    args: quoteArgs,
    query: { enabled: quotesReady },
  });

  const { data: insuranceSkim } = useReadContract({
    address: contracts.vaultFactory,
    abi: factoryAbi,
    functionName: "quoteInsuranceSkim",
    args: quoteArgs,
    query: { enabled: quotesReady },
  });

  // Deposit floor rises with the SQUARE ROOT of term and with the tier's
  // assumed volatility, so it moves as the lender adjusts either. Read live
  // rather than recomputed here — the contract is the authority and getting
  // the fixed-point arithmetic subtly different would be worse than useless.
  const { data: minDeposit } = useReadContract({
    address: contracts.vaultFactory,
    abi: factoryAbi,
    functionName: "quoteMinimumDeposit",
    args: [parsedPrincipal ?? 0n, maxTier, durationBigInt ?? 0n, shortMode],
    query: {
      enabled: Boolean(parsedPrincipal) && durationBigInt !== undefined && durationBigInt > 0n,
    },
  });

  const { data: tierCfg } = useReadContract({
    address: contracts.assetRegistry,
    abi: assetRegistryAbi,
    functionName: "tierConfig",
    args: [maxTier],
    query: { enabled: registryReady },
  });

  const depositBelowFloor =
    parsedDeposit !== undefined && minDeposit !== undefined && parsedDeposit < minDeposit;

  const requiredApproval =
    parsedPrincipal !== undefined ? parsedPrincipal + (insuranceSkim || 0n) : undefined;

  // Protocol fee is an ADD-ON charged to the borrower at settlement — it
  // does not reduce the lender's return and is not part of what the lender
  // approves here. Surfaced so the origination form shows the borrower's
  // true all-in cost rather than just the headline fee.
  const { data: protocolFee } = useReadContract({
    address: contracts.vaultFactory,
    abi: factoryAbi,
    functionName: "quoteProtocolFee",
    args: quoteArgs,
    query: { enabled: quotesReady && registryReady },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: selectedAsset,
    abi: erc20Abi,
    functionName: "allowance",
    args: [address, contracts.vaultFactory],
    query: { enabled: Boolean(selectedAsset) && Boolean(address) },
  });

  const needsApproval =
    requiredApproval !== undefined && (allowance === undefined || allowance < requiredApproval);

  // --- Deposit-model hint (Group E3's model, applied here at origination) ---
  const durationDays = !shortMode ? Number(durationValue) : null;
  const depositHint =
    selectedSymbol && durationDays > 0 ? recommendedDeposit(selectedSymbol, durationDays) : null;

  function applyRecommended(pct) {
    if (!depositHint || parsedPrincipal === undefined || decimals === undefined) return;
    const suggested = (Number(principal) * pct).toFixed(decimals);
    setDepositRequired(suggested);
  }

  // --- Writes (single pair, sequential approve-then-deploy) ---
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const { latestVaultAddress, allVaults, refetch: refetchVaultList } = useLatestVault(address, "lender");

  useEffect(() => {
    if (!isSuccess) return;
    if (pendingAction === "approve") {
      refetchAllowance();
    } else if (pendingAction === "deploy") {
      refetchVaultList();
      setBorrower("");
      setPrincipal("");
      setDepositRequired("");
    }
    setPendingAction(null);
    reset();
  }, [isSuccess]);

  if (!isConnected) {
    return <EmptyState message="Connect the lender wallet to originate a vault." />;
  }

  if (!registryReady) {
    return (
      <EmptyState message="The asset registry and vault factory haven't been deployed on this network yet." />
    );
  }

  const disabled =
    !selectedAsset ||
    !borrowerIsValidAddress ||
    isVerified === false ||
    !aprValid ||
    depositBelowFloor ||
    parsedPrincipal === undefined ||
    parsedDeposit === undefined ||
    durationBigInt === undefined;

  const disabledReason = !selectedAsset
    ? "No asset selected."
    : !borrowerIsValidAddress
    ? "Enter a valid borrower address."
    : isVerified === false
    ? "This address is not KYC verified."
    : !aprValid
    ? "Enter a valid annual rate greater than zero."
    : depositBelowFloor
    ? "Deposit is below the required floor for this risk tier and term."
    : parsedPrincipal === undefined
    ? "Enter a valid principal amount."
    : parsedDeposit === undefined
    ? "Enter a valid deposit amount."
    : durationBigInt === undefined
    ? "Enter a valid duration."
    : null;

  const busy = (isPending || isConfirming) && pendingAction !== null;

  async function approve() {
    if (requiredApproval === undefined) return;
    setPendingAction("approve");
    try {
      const fees = await publicClient.estimateFeesPerGas();
      writeContract({
        address: selectedAsset,
        abi: erc20Abi,
        functionName: "approve",
        args: [contracts.vaultFactory, requiredApproval],
        maxFeePerGas: fees.maxFeePerGas * 2n,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
    } catch (err) {
      setPendingAction(null);
    }
  }

  async function originate() {
    setPendingAction("deploy");
    try {
      const fees = await publicClient.estimateFeesPerGas();
      writeContract({
        address: contracts.vaultFactory,
        abi: factoryAbi,
        // WithTier, not plain deployVault: the plain form defaults the ceiling
        // to Speculative, which preserves pre-tier behaviour but grants the
        // lender no protection at all.
        functionName: "deployVaultWithTier",
        args: [
          selectedAsset,
          borrower,
          parsedPrincipal,
          BigInt(aprBps),
          durationBigInt,
          shortMode,
          parsedDeposit,
          ZERO_ADDRESS,          // referrer — direct origination, no integrator
          maxTier,
        ],
        maxFeePerGas: fees.maxFeePerGas * 2n,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
    } catch (err) {
      setPendingAction(null);
    }
  }

  const otherVaults = (allVaults || []).filter((v) => v !== latestVaultAddress).reverse();

  return (
    <div>
      <div style={{ display: "inline-flex", background: "var(--panel)", border: "1px solid var(--hairline)", borderRadius: 8, padding: 3, marginBottom: 16 }}>
        {[
          ["mandate", "Publish terms"],
          ["direct", "Originate directly"],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setMode(key)}
            style={{
              border: "none", borderRadius: 6, padding: "7px 16px", fontSize: 12, cursor: "pointer",
              background: mode === key ? "var(--brass)" : "transparent",
              color: mode === key ? "#1C1C1A" : "var(--parch-dim)",
              fontWeight: mode === key ? 600 : 400,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 12 }}>
        <Field label="Asset">
          <AssetSwitcher assets={assets} chainId={chainId} value={selectedAsset} onChange={setSelectedAsset} />
        </Field>
      </div>

      {mode === "mandate" ? (
        <MandatePanel
          selectedAsset={selectedAsset}
          selectedSymbol={selectedSymbol}
          decimals={decimals}
        />
      ) : (
      <div style={cardStyle}>
        <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 16px" }}>
          Originate a vault for a borrower you already know. Terms are fixed here rather
          than priced off a surface, and the borrower cannot take them without your
          transaction.
        </p>

        <Field label="Borrower address">
          <input
            value={borrower}
            onChange={(e) => setBorrower(e.target.value)}
            placeholder="0x..."
            style={inputStyle}
          />
        </Field>
        {borrowerIsValidAddress && (
          <p style={{ fontSize: 11, color: isVerified ? "var(--brass)" : "var(--brick)", margin: "-8px 0 12px" }}>
            {isVerified === undefined ? "Checking KYC status..." : isVerified ? "KYC verified" : "Not KYC verified"}
          </p>
        )}

        <Row2>
          <Field label={`Principal (${selectedSymbol || "—"})`}>
            <input value={principal} onChange={(e) => setPrincipal(e.target.value)} style={inputStyle} placeholder="0.0" />
          </Field>
          <Field label={`Deposit required (${selectedSymbol || "—"})`}>
            <input value={depositRequired} onChange={(e) => setDepositRequired(e.target.value)} style={inputStyle} placeholder="0.0" />
          </Field>
        </Row2>

        {depositHint && (
          <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "-8px 0 12px" }}>
            Deposit model recommends {formatPercent(depositHint.pct95)} (95%) / {formatPercent(depositHint.pct99)} (99%)
            of principal for {durationDays}d in {selectedSymbol}.{" "}
            {parsedPrincipal !== undefined && (
              <>
                <button type="button" onClick={() => applyRecommended(depositHint.pct95)} style={linkButtonStyle}>
                  Use 95%
                </button>{" "}
                <button type="button" onClick={() => applyRecommended(depositHint.pct99)} style={linkButtonStyle}>
                  Use 99%
                </button>
              </>
            )}
          </p>
        )}

        <Row2>
          <Field label="Interest rate (% per year)">
            <input value={feeRatePercent} onChange={(e) => setFeeRatePercent(e.target.value)} style={inputStyle} />
          </Field>
          <Field label={shortMode ? "Duration (seconds)" : "Duration (days)"}>
            <input value={durationValue} onChange={(e) => setDurationValue(e.target.value)} style={inputStyle} />
          </Field>
        </Row2>

        <Field label="Risk ceiling — what the borrower may swap into">
          <div style={{ display: "inline-flex", background: "var(--ink)", border: "1px solid var(--hairline)", borderRadius: 8, padding: 3 }}>
            {[0, 1, 2].map((t) => {
              const active = maxTier === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setMaxTier(t)}
                  style={{
                    border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer",
                    background: active ? "var(--brass)" : "transparent",
                    color: active ? "#1C1C1A" : "var(--parch-dim)",
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {TIER_LABELS[t]}
                </button>
              );
            })}
          </div>
        </Field>

        {/* The deposit floor is the actual risk control, so it is shown as a
            live figure rather than left to be discovered on a revert. Moving a
            30-day WETH loan from a 20% to a 30% deposit changes expected loss
            by a factor of six — no interest rate does that. */}
        {minDeposit !== undefined && minDeposit > 0n && (
          <p style={{
            fontSize: 11,
            color: depositBelowFloor ? "var(--brick)" : "var(--parch-dim)",
            margin: "-4px 0 12px",
            lineHeight: 1.5,
          }}>
            Minimum deposit for this tier and term:{" "}
            <strong>{formatTokenAmount(minDeposit, decimals)} {selectedSymbol}</strong>
            {parsedPrincipal !== undefined && parsedPrincipal > 0n && (
              <> ({(Number(minDeposit * 10000n / parsedPrincipal) / 100).toFixed(1)}% of principal)</>
            )}
            {depositBelowFloor && <> — the deposit entered is below this and will be rejected.</>}
            {tierCfg && tierCfg[0] > 0n && (
              <> Assumes {Number(tierCfg[0]) / 100}% annualised volatility; the floor rises with
              the square root of term.</>
            )}
          </p>
        )}

        <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "-8px 0 12px" }}>
          The rate is <strong>annual</strong>, and interest accrues on time actually
          elapsed — a borrower who closes early owes less.
          {fullTermFee !== undefined && fullTermFee > 0n && (
            <> Held to the deadline this loan earns {formatTokenAmount(fullTermFee, decimals)}{" "}
            {selectedSymbol}, which is the maximum.</>
          )}
          {insuranceSkim !== undefined && insuranceSkim > 0n && (
            <> An insurance skim of {formatTokenAmount(insuranceSkim, decimals)} {selectedSymbol} is
            pulled from you at origination, priced on the full term so the pool is funded for
            maximum exposure before any loss can occur.</>
          )}
        </p>

        {/* Time-weighting interest shrinks the buffer that absorbs a loss before
            the deposit is touched. On a very short loan that buffer is close to
            nothing, which is a real change in risk and belongs on screen rather
            than in a comment. */}
        {fullTermFee !== undefined && parsedPrincipal !== undefined && parsedPrincipal > 0n &&
         fullTermFee * 200n < parsedPrincipal && (
          <p style={{ fontSize: 11, color: "var(--brick)", margin: "-8px 0 12px", lineHeight: 1.5 }}>
            Short term relative to the rate: total interest is under 0.5% of principal, so it
            absorbs very little loss before the borrower's deposit is drawn on. Consider a larger
            deposit for loans this brief.
          </p>
        )}

        {protocolFee !== undefined && protocolFee > 0n && (
          <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "-8px 0 12px" }}>
            The borrower additionally pays a {formatTokenAmount(protocolFee, decimals)} {selectedSymbol} protocol
            fee at settlement, on top of your fee — your return is unaffected by it. It is taken only from
            the borrower's residual once you have been paid in full, so a loss yields no protocol fee at all.
          </p>
        )}

        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, marginBottom: 16, fontSize: 12, color: "var(--parch-dim)" }}>
          <input type="checkbox" checked={shortMode} onChange={(e) => setShortMode(e.target.checked)} />
          Test mode — treat duration as seconds, not days (for testing settlement quickly)
        </label>

        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
          {needsApproval ? (
            <ActionButton
              label={`Approve ${selectedSymbol}`}
              primary={!disabled}
              disabled={disabled}
              disabledReason={disabledReason}
              loading={busy && pendingAction === "approve"}
              onClick={approve}
            />
          ) : (
            <ActionButton
              label="Originate vault"
              primary={!disabled}
              disabled={disabled}
              disabledReason={disabledReason}
              loading={busy && pendingAction === "deploy"}
              onClick={originate}
            />
          )}
        </div>

        {error && (
          <p style={{ fontSize: 12, color: "var(--brick)", marginTop: 12 }}>
            {error.shortMessage || error.message}
          </p>
        )}
      </div>
      )}

      {latestVaultAddress && (
        <div style={{ marginTop: 20 }}>
          <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 10px" }}>Your most recent vault</p>
          <LenderVaultCard vaultAddress={latestVaultAddress} />
        </div>
      )}

      {otherVaults.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 10px" }}>
            Earlier vaults ({otherVaults.length})
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {otherVaults.map((addr) => (
              <LenderVaultCard key={addr} vaultAddress={addr} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LenderVaultCard({ vaultAddress }) {
  const { vault } = useVaultData(vaultAddress);
  if (!vault) return null;
  return <VaultStatement vault={vault} />;
}

function AssetSwitcher({ assets, chainId, value, onChange }) {
  if (assets.length === 0) {
    return <p style={{ fontSize: 12, color: "var(--parch-dim)" }}>No whitelisted assets available.</p>;
  }
  return (
    <div style={{ display: "inline-flex", background: "var(--panel)", border: "0.5px solid var(--hairline)", borderRadius: 8, padding: 3 }}>
      {assets.map((asset) => {
        const active = asset === value;
        return (
          <button
            key={asset}
            type="button"
            onClick={() => onChange(asset)}
            style={{
              border: "none",
              borderRadius: 6,
              padding: "6px 14px",
              fontSize: 12,
              cursor: "pointer",
              background: active ? "var(--brass)" : "transparent",
              color: active ? "#1C1C1A" : "var(--parch-dim)",
              fontWeight: active ? 600 : 400,
            }}
          >
            {symbolForToken(chainId, asset)}
          </button>
        );
      })}
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

function EmptyState({ message }) {
  return (
    <div style={{ background: "var(--panel)", borderRadius: 10, border: "1px solid var(--hairline)", padding: "24px 20px", textAlign: "center" }}>
      <p style={{ fontSize: 13, color: "var(--parch-dim)", margin: 0 }}>{message}</p>
    </div>
  );
}

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

const linkButtonStyle = {
  background: "none",
  border: "none",
  padding: 0,
  color: "var(--slate)",
  fontSize: 11,
  cursor: "pointer",
  textDecoration: "underline",
};
