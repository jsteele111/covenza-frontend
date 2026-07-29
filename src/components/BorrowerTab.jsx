import { useState, useEffect } from "react";
import { useAccount, useChainId, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from "wagmi";
import { parseUnits } from "viem";
import { KYC_REGISTRY_ABI, ERC20_ABI, ASSET_REGISTRY_ABI } from "../config/abis.js";
import { getContractsForChain, isPlaceholder, symbolForToken } from "../config/contracts.js";
import { useLatestVault } from "../hooks/useLatestVault.js";
import { useVaultData } from "../hooks/useVaultData.js";
import { useVaultAction } from "../hooks/useVaultAction.js";
import { useHeldAssets } from "../hooks/useHeldAssets.js";
import { VaultStatement } from "./VaultStatement.jsx";
import { ActionButton } from "./ActionButton.jsx";
import { KycGate } from "./KycGate.jsx";
import { formatTokenAmount } from "../utils/format.js";

// abis.js already exports pre-parsed ABIs — do not re-wrap in parseAbi().
const kycAbi = KYC_REGISTRY_ABI;
const erc20Abi = ERC20_ABI;
const assetRegistryAbi = ASSET_REGISTRY_ABI;

const FEE_TIERS = [
  { label: "0.05%", value: 500 },
  { label: "0.3%", value: 3000 },
  { label: "1%", value: 10000 },
];

function tryParseUnits(value, decimals) {
  if (!value || decimals === undefined || decimals === null) return undefined;
  try {
    const parsed = parseUnits(value, decimals);
    return parsed > 0n ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Group E5 rewrite. v1 had one hardcoded whitelisted action (Aave, ETH
 * only) and a payable payDeposit(). v2 adds directional swaps as a second
 * whitelisted action and makes every borrower action ERC20-native:
 *
 *   - payDeposit() is now non-payable — the borrower must approve() the
 *     vault for the deposit amount first (the bug flagged at the end of
 *     Group E4 review; fixed here with the same approve-then-act pattern
 *     LenderTab uses for origination).
 *   - supplyToAave/withdrawFromAave take an explicit amount rather than
 *     the UI computing one "invest everything" figure — v2 replaced the
 *     v1 investedAmount cap with a live invariant (vaultBalance - deposit,
 *     see useVaultData.js), so the amount to move is always the
 *     borrower's own choice, bounded by that invariant on-chain regardless
 *     of what the UI allows them to type.
 *   - swap()/swapBack() are new: a borrower can take directional exposure
 *     to any other whitelisted asset, and unwind it manually before
 *     maturity (unwinding also happens automatically at settlement if
 *     they don't). minAmountOut is borrower-supplied slippage protection,
 *     enforced on-chain — there's no on-chain quote function to prefill it
 *     from, so this UI asks for it directly rather than pretending to
 *     estimate a number it can't actually source safely.
 */
export function BorrowerTab() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);
  const publicClient = usePublicClient();

  const { data: isVerified, error: kycError } = useReadContract({
    address: contracts.kycRegistry,
    abi: kycAbi,
    functionName: "isVerified",
    args: [address],
    query: { enabled: Boolean(address), refetchInterval: 8000 },
  });

  const { latestVaultAddress, refetch: refetchVaultList } = useLatestVault(address, "borrower");
  const { vault, refetch: refetchVaultData } = useVaultData(latestVaultAddress);
  const { heldAssets, refetch: refetchHeldAssets } = useHeldAssets(
    latestVaultAddress,
    vault?.heldAssetCount || 0
  );

  // --- Deposit: approve (raw ERC20 write) then payDeposit (vault write) ---
  const [depositApproving, setDepositApproving] = useState(false);
  const { writeContract: writeApprove, data: approveHash, isPending: approvePending, error: approveError, reset: resetApprove } = useWriteContract();
  const { isLoading: approveConfirming, isSuccess: approveSuccess } = useWaitForTransactionReceipt({ hash: approveHash });

  const { data: depositAllowance, refetch: refetchDepositAllowance } = useReadContract({
    address: vault?.asset,
    abi: erc20Abi,
    functionName: "allowance",
    args: [address, latestVaultAddress],
    query: { enabled: Boolean(vault?.asset) && Boolean(address) && Boolean(latestVaultAddress) },
  });

  const depositAction = useVaultAction();

  useEffect(() => {
    if (approveSuccess) {
      refetchDepositAllowance();
      setDepositApproving(false);
      resetApprove();
    }
  }, [approveSuccess]);

  useEffect(() => {
    if (depositAction.isSuccess) {
      refetchVaultData();
      depositAction.reset();
    }
  }, [depositAction.isSuccess]);

  // --- Aave supply / withdraw ---
  const [supplyAmount, setSupplyAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [aavePending, setAavePending] = useState(null); // "supply" | "withdraw" | null
  const aaveAction = useVaultAction();

  useEffect(() => {
    if (aaveAction.isSuccess) {
      refetchVaultData();
      setSupplyAmount("");
      setWithdrawAmount("");
      setAavePending(null);
      aaveAction.reset();
    }
  }, [aaveAction.isSuccess]);

  // --- Directional swap ---
  const [swapAsset, setSwapAsset] = useState("");
  const [swapAmountIn, setSwapAmountIn] = useState("");
  const [swapMinOut, setSwapMinOut] = useState("");
  const [swapFeeTier, setSwapFeeTier] = useState(3000);
  const swapAction = useVaultAction();

  const { data: whitelistedAssets } = useReadContract({
    address: contracts.assetRegistry,
    abi: assetRegistryAbi,
    functionName: "getWhitelistedAssets",
    query: { enabled: !isPlaceholder(contracts.assetRegistry) },
  });

  const swapTargets = (whitelistedAssets || []).filter(
    (a) => vault && a.toLowerCase() !== vault.asset.toLowerCase()
  );

  useEffect(() => {
    if (!swapAsset && swapTargets.length > 0) setSwapAsset(swapTargets[0]);
  }, [swapTargets, swapAsset]);

  const { data: swapAssetDecimals } = useReadContract({
    address: swapAsset,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: Boolean(swapAsset) },
  });

  useEffect(() => {
    if (swapAction.isSuccess) {
      refetchVaultData();
      refetchHeldAssets();
      setSwapAmountIn("");
      setSwapMinOut("");
      swapAction.reset();
    }
  }, [swapAction.isSuccess]);

  // --- Settle ---
  const settleAction = useVaultAction();

  useEffect(() => {
    if (settleAction.isSuccess) {
      refetchVaultData();
      refetchVaultList();
      settleAction.reset();
    }
  }, [settleAction.isSuccess]);

  if (!isConnected) {
    return <EmptyState message="Connect the borrower wallet to view your vault." />;
  }

  if (kycError) {
    return <EmptyState message={`KYC check failed: ${kycError.shortMessage || kycError.message}`} />;
  }

  if (isVerified === undefined) {
    return <EmptyState message="Checking KYC status..." />;
  }

  if (!isVerified) {
    return <KycGate address={address} />;
  }

  if (!vault) {
    return <EmptyState message="No vault found for this wallet yet. Ask your lender to originate one." />;
  }

  const isEarly = !vault.isExpired;
  const canAct = !vault.isSettled && !vault.isExpired;

  // --- Deposit ---
  const needsDepositApproval =
    !vault.depositPaid && (depositAllowance === undefined || depositAllowance < vault.requiredDeposit);
  const depositDisabled = vault.isSettled || vault.depositPaid || vault.isExpired;
  const depositReason = vault.isSettled
    ? "Vault already settled."
    : vault.depositPaid
    ? "Deposit already paid for this vault."
    : vault.isExpired
    ? "Loan deadline has passed."
    : null;

  async function approveDeposit() {
    setDepositApproving(true);
    try {
      const fees = await publicClient.estimateFeesPerGas();
      writeApprove({
        address: vault.asset,
        abi: erc20Abi,
        functionName: "approve",
        args: [latestVaultAddress, vault.requiredDeposit],
        maxFeePerGas: fees.maxFeePerGas * 2n,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
    } catch {
      setDepositApproving(false);
    }
  }

  // --- Yield venue (Aave V3 or any ERC-4626 vault) ---
  const parsedSupply = tryParseUnits(supplyAmount, vault.decimals);
  const parsedWithdraw = tryParseUnits(withdrawAmount, vault.decimals);

  // Always the position's value in the LOAN asset, never a share count —
  // the vault converts before returning it, so ERC-4626 appreciation is
  // already reflected and the amounts below are directly comparable.
  const yieldPosition = vault.yieldPositionValue;

  const supplyDisabled = !canAct || !vault.depositPaid || !vault.yieldSupported || parsedSupply === undefined || parsedSupply > vault.investableRemaining;
  const supplyReason = !vault.depositPaid
    ? "Pay the deposit before supplying to the yield venue."
    : !vault.yieldSupported
    ? "This asset has no yield venue configured."
    : !canAct
    ? "Vault is settled or expired."
    : parsedSupply === undefined
    ? "Enter a valid amount."
    : parsedSupply > vault.investableRemaining
    ? `Exceeds investable balance (${formatTokenAmount(vault.investableRemaining, vault.decimals)} ${vault.symbol}).`
    : null;

  const withdrawDisabled = !canAct || yieldPosition <= 0n || parsedWithdraw === undefined || parsedWithdraw > yieldPosition;
  const withdrawReason = yieldPosition <= 0n
    ? "No yield position to withdraw from."
    : !canAct
    ? "Vault is settled or expired."
    : parsedWithdraw === undefined
    ? "Enter a valid amount."
    : parsedWithdraw > yieldPosition
    ? "Exceeds current yield position."
    : null;

  // --- Swap ---
  const parsedSwapIn = tryParseUnits(swapAmountIn, vault.decimals);
  const parsedSwapMinOut = tryParseUnits(swapMinOut, swapAssetDecimals);
  const swapDisabled =
    !canAct || !vault.depositPaid || !swapAsset || parsedSwapIn === undefined ||
    parsedSwapMinOut === undefined || parsedSwapIn > vault.investableRemaining;
  const swapDisabledReason = !vault.depositPaid
    ? "Pay the deposit before swapping."
    : !canAct
    ? "Vault is settled or expired."
    : !swapAsset
    ? "No whitelisted destination asset available."
    : parsedSwapIn === undefined
    ? "Enter a valid amount to swap."
    : parsedSwapMinOut === undefined
    ? "Enter a minimum output amount."
    : parsedSwapIn > vault.investableRemaining
    ? `Exceeds investable balance (${formatTokenAmount(vault.investableRemaining, vault.decimals)} ${vault.symbol}).`
    : null;

  // --- Settle ---
  const settleDisabled = vault.isSettled || (isEarly && !vault.depositPaid);
  const settleReason = vault.isSettled
    ? "Vault already settled."
    : isEarly && !vault.depositPaid
    ? "Pay the deposit before closing the loan."
    : null;
  const settleLabel = isEarly ? "Repay & close loan" : "Settle expired loan";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <VaultStatement vault={vault} />

      {/* --- Deposit --- */}
      <div style={cardStyle}>
        <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 12px" }}>Deposit</p>
        <ActionButton
          label={needsDepositApproval ? `Approve ${vault.symbol}` : "Pay deposit"}
          primary={!depositDisabled}
          disabled={depositDisabled}
          disabledReason={depositReason}
          loading={needsDepositApproval ? (approvePending || approveConfirming) && depositApproving : depositAction.isPending || depositAction.isConfirming}
          onClick={needsDepositApproval ? approveDeposit : () => depositAction.call(latestVaultAddress, "payDeposit")}
        />
        {(approveError || depositAction.error) && (
          <p style={{ fontSize: 12, color: "var(--brick)", marginTop: 10 }}>
            {approveError?.shortMessage || approveError?.message || depositAction.error?.shortMessage || depositAction.error?.message}
          </p>
        )}
      </div>

      {/* --- Yield venue --- */}
      {vault.yieldSupported && (
        <div style={cardStyle}>
          <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 4px" }}>Yield — {vault.venueLabel}</p>
          <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 12px" }}>
            Investable now: {formatTokenAmount(vault.investableRemaining, vault.decimals)} {vault.symbol}
            {yieldPosition > 0n && (
              <> · Supplied: {formatTokenAmount(yieldPosition, vault.decimals)} {vault.symbol}</>
            )}
          </p>
          <Row2>
            <Field label={`Supply amount (${vault.symbol})`}>
              <input value={supplyAmount} onChange={(e) => setSupplyAmount(e.target.value)} style={inputStyle} placeholder="0.0" />
            </Field>
            <div style={{ alignSelf: "flex-end", marginBottom: 12 }}>
              <ActionButton
                label="Supply"
                primary={!supplyDisabled}
                disabled={supplyDisabled}
                disabledReason={supplyReason}
                loading={aaveAction.isPending || aaveAction.isConfirming ? aavePending === "supply" : false}
                onClick={() => {
                  setAavePending("supply");
                  aaveAction.call(latestVaultAddress, "supplyToYield", [parsedSupply]);
                }}
              />
            </div>
          </Row2>
          {yieldPosition > 0n && (
            <Row2>
              <Field label={`Withdraw amount (${vault.symbol})`}>
                <input value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} style={inputStyle} placeholder="0.0" />
              </Field>
              <div style={{ alignSelf: "flex-end", marginBottom: 12 }}>
                <ActionButton
                  label="Withdraw"
                  primary={!withdrawDisabled}
                  disabled={withdrawDisabled}
                  disabledReason={withdrawReason}
                  loading={aaveAction.isPending || aaveAction.isConfirming ? aavePending === "withdraw" : false}
                  onClick={() => {
                    setAavePending("withdraw");
                    aaveAction.call(latestVaultAddress, "withdrawFromYield", [parsedWithdraw]);
                  }}
                />
              </div>
            </Row2>
          )}
          {aaveAction.error && (
            <p style={{ fontSize: 12, color: "var(--brick)", marginTop: 4 }}>
              {aaveAction.error.shortMessage || aaveAction.error.message}
            </p>
          )}
        </div>
      )}

      {/* --- Directional swap --- */}
      {swapTargets.length > 0 && (
        <div style={cardStyle}>
          <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 12px" }}>
            Swap {vault.symbol} for another whitelisted asset
          </p>

          <Field label="Destination asset">
            <AssetSwitcher assets={swapTargets} chainId={chainId} value={swapAsset} onChange={setSwapAsset} />
          </Field>

          <Row2>
            <Field label={`Amount to swap (${vault.symbol})`}>
              <input value={swapAmountIn} onChange={(e) => setSwapAmountIn(e.target.value)} style={inputStyle} placeholder="0.0" />
            </Field>
            <Field label={`Min. output (${symbolForToken(chainId, swapAsset) || "—"})`}>
              <input value={swapMinOut} onChange={(e) => setSwapMinOut(e.target.value)} style={inputStyle} placeholder="0.0" />
            </Field>
          </Row2>

          <Field label="Pool fee tier">
            <div style={{ display: "inline-flex", background: "var(--ink)", border: "1px solid var(--hairline)", borderRadius: 8, padding: 3 }}>
              {FEE_TIERS.map((tier) => {
                const active = swapFeeTier === tier.value;
                return (
                  <button
                    key={tier.value}
                    type="button"
                    onClick={() => setSwapFeeTier(tier.value)}
                    style={{
                      border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer",
                      background: active ? "var(--brass)" : "transparent",
                      color: active ? "#1C1C1A" : "var(--parch-dim)",
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    {tier.label}
                  </button>
                );
              })}
            </div>
          </Field>

          <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "-4px 0 12px" }}>
            Minimum output is your own slippage protection, enforced on-chain — there's no live price
            quote wired into this form, so set it deliberately.
          </p>

          <ActionButton
            label={`Swap to ${symbolForToken(chainId, swapAsset) || "—"}`}
            primary={!swapDisabled}
            disabled={swapDisabled}
            disabledReason={swapDisabledReason}
            loading={swapAction.isPending || swapAction.isConfirming}
            onClick={() => swapAction.call(latestVaultAddress, "swap", [swapAsset, parsedSwapIn, parsedSwapMinOut, swapFeeTier])}
          />
          {swapAction.error && (
            <p style={{ fontSize: 12, color: "var(--brick)", marginTop: 10 }}>
              {swapAction.error.shortMessage || swapAction.error.message}
            </p>
          )}
        </div>
      )}

      {/* --- Swap back held assets --- */}
      {heldAssets.length > 0 && (
        <div>
          <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 10px" }}>
            Held foreign assets ({heldAssets.length}) — will be forced back to {vault.symbol} at settlement
            if not closed manually first
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {heldAssets.map((held) => (
              <SwapBackRow
                key={held.address}
                vaultAddress={latestVaultAddress}
                held={held}
                loanSymbol={vault.symbol}
                loanDecimals={vault.decimals}
                onDone={() => {
                  refetchVaultData();
                  refetchHeldAssets();
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* --- Settle --- */}
      <div style={cardStyle}>
        <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 12px" }}>Settlement</p>
        <ActionButton
          label={settleLabel}
          primary={!settleDisabled}
          disabled={settleDisabled}
          disabledReason={settleReason}
          loading={settleAction.isPending || settleAction.isConfirming}
          onClick={() => settleAction.call(latestVaultAddress, "settle")}
        />
        {settleAction.error && (
          <p style={{ fontSize: 12, color: "var(--brick)", marginTop: 10 }}>
            {settleAction.error.shortMessage || settleAction.error.message}
          </p>
        )}
      </div>
    </div>
  );
}

function SwapBackRow({ vaultAddress, held, loanSymbol, loanDecimals, onDone }) {
  const [amountIn, setAmountIn] = useState("");
  const [minOut, setMinOut] = useState("");
  const { call, isPending, isConfirming, isSuccess, error, reset } = useVaultAction();

  useEffect(() => {
    if (isSuccess) {
      onDone();
      setAmountIn("");
      setMinOut("");
      reset();
    }
  }, [isSuccess]);

  const parsedAmountIn = tryParseUnits(amountIn, held.decimals);
  const parsedMinOut = tryParseUnits(minOut, loanDecimals);
  const disabled = parsedAmountIn === undefined || parsedMinOut === undefined || parsedAmountIn > held.balance;
  const disabledReason = parsedAmountIn === undefined
    ? "Enter a valid amount."
    : parsedMinOut === undefined
    ? "Enter a minimum output."
    : parsedAmountIn > held.balance
    ? "Amount exceeds held balance."
    : null;

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <span className="mono" style={{ fontSize: 13, color: "var(--parch)" }}>{held.symbol}</span>
        <span className="mono" style={{ fontSize: 12, color: "var(--parch-dim)" }}>
          Held: {formatTokenAmount(held.balance, held.decimals)}
        </span>
      </div>
      <Row2>
        <Field label={`Amount (${held.symbol})`}>
          <input
            value={amountIn}
            onChange={(e) => setAmountIn(e.target.value)}
            style={inputStyle}
            placeholder={formatTokenAmount(held.balance, held.decimals)}
          />
        </Field>
        <Field label={`Min. output (${loanSymbol})`}>
          <input value={minOut} onChange={(e) => setMinOut(e.target.value)} style={inputStyle} placeholder="0.0" />
        </Field>
      </Row2>
      <ActionButton
        label={`Swap back to ${loanSymbol}`}
        primary={!disabled}
        disabled={disabled}
        disabledReason={disabledReason}
        loading={isPending || isConfirming}
        onClick={() => call(vaultAddress, "swapBack", [held.address, parsedAmountIn, parsedMinOut])}
      />
      {error && <p style={{ fontSize: 11, color: "var(--brick)", marginTop: 8 }}>{error.shortMessage || error.message}</p>}
    </div>
  );
}

function AssetSwitcher({ assets, chainId, value, onChange }) {
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
              border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer",
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