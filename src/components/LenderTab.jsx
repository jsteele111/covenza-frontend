import { useState, useEffect } from "react";
import { useAccount, useChainId, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from "wagmi";
import { parseUnits, isAddress } from "viem";
import { KYC_REGISTRY_ABI, VAULT_FACTORY_ABI, ASSET_REGISTRY_ABI, ERC20_ABI } from "../config/abis.js";
import { getContractsForChain, isPlaceholder, symbolForToken } from "../config/contracts.js";
import { useLatestVault } from "../hooks/useLatestVault.js";
import { useVaultData } from "../hooks/useVaultData.js";
import { recommendedDeposit } from "../utils/deposit.js";
import { formatTokenAmount, formatPercent } from "../utils/format.js";
import { VaultStatement } from "./VaultStatement.jsx";
import { ActionButton } from "./ActionButton.jsx";

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
  const feeRateBps = feeRatePercent ? Math.round(parseFloat(feeRatePercent) * 100) : NaN;
  const feeRateValid = Number.isFinite(feeRateBps) && feeRateBps > 0;
  const durationBigInt = tryBigInt(durationValue);

  const { data: insuranceSkim } = useReadContract({
    address: contracts.vaultFactory,
    abi: factoryAbi,
    functionName: "quoteInsuranceSkim",
    args: [parsedPrincipal ?? 0n, BigInt(feeRateValid ? feeRateBps : 0)],
    query: { enabled: Boolean(parsedPrincipal) && feeRateValid },
  });

  const requiredApproval =
    parsedPrincipal !== undefined ? parsedPrincipal + (insuranceSkim || 0n) : undefined;

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
    !feeRateValid ||
    parsedPrincipal === undefined ||
    parsedDeposit === undefined ||
    durationBigInt === undefined;

  const disabledReason = !selectedAsset
    ? "No asset selected."
    : !borrowerIsValidAddress
    ? "Enter a valid borrower address."
    : isVerified === false
    ? "This address is not KYC verified."
    : !feeRateValid
    ? "Enter a valid fee rate greater than zero."
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
        functionName: "deployVault",
        args: [
          selectedAsset,
          borrower,
          parsedPrincipal,
          BigInt(feeRateBps),
          durationBigInt,
          shortMode,
          parsedDeposit,
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
      <div style={cardStyle}>
        <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 16px" }}>Originate a vault</p>

        <Field label="Asset">
          <AssetSwitcher assets={assets} chainId={chainId} value={selectedAsset} onChange={setSelectedAsset} />
        </Field>

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
          <Field label="Fee rate (%)">
            <input value={feeRatePercent} onChange={(e) => setFeeRatePercent(e.target.value)} style={inputStyle} />
          </Field>
          <Field label={shortMode ? "Duration (seconds)" : "Duration (days)"}>
            <input value={durationValue} onChange={(e) => setDurationValue(e.target.value)} style={inputStyle} />
          </Field>
        </Row2>

        <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "-8px 0 12px" }}>
          Fee is fixed at origination and charged in full — the borrower pays the same fee whether
          they close early or hold to the deadline.
          {insuranceSkim !== undefined && insuranceSkim > 0n && (
            <> An additional {formatTokenAmount(insuranceSkim, decimals)} {selectedSymbol} insurance skim is
            pulled from you at origination, funding the shared pool for this asset.</>
          )}
        </p>

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
    <div style={{ display: "inline-flex", background: "var(--ink)", border: "1px solid var(--hairline)", borderRadius: 8, padding: 3 }}>
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