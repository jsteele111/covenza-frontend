import { useState, useEffect, useRef } from "react";
import { useAccount, useChainId, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from "wagmi";
import { parseUnits, formatUnits } from "viem";
import { ERC20_ABI, ASSET_REGISTRY_ABI, VAULT_LENS_ABI } from "../config/abis.js";
import { getContractsForChain, isPlaceholder, symbolForToken } from "../config/contracts.js";
import { useLatestVault } from "../hooks/useLatestVault.js";
import { useVaultSelection } from "../hooks/useVaultSelection.js";
import { useSwapPreflight, explainTokenRefusal } from "../hooks/useSwapPreflight.js";
import { useVaultData } from "../hooks/useVaultData.js";
import { useVaultAction } from "../hooks/useVaultAction.js";
import { useHeldAssets } from "../hooks/useHeldAssets.js";
import { useEligibility } from "../hooks/useEligibility.js";
import { useAttesters } from "../hooks/useAttesters.js";
import { useChainNow } from "../hooks/useChainNow.js";
import { VaultStatement } from "./VaultStatement.jsx";
import { VaultActions } from "./VaultActions.jsx";
import { MandateBoard } from "./MandateBoard.jsx";
import { ActionButton } from "./ActionButton.jsx";
import { KycGate } from "./KycGate.jsx";
import { UnclaimedBanner } from "./HistoryPage.jsx";
import { Link } from "react-router-dom";
import { formatTokenAmount } from "../utils/format.js";

// abis.js already exports pre-parsed ABIs — do not re-wrap in parseAbi().
const erc20Abi = ERC20_ABI;
const assetRegistryAbi = ASSET_REGISTRY_ABI;

const FEE_LABELS = { 100: "0.01%", 500: "0.05%", 3000: "0.3%", 10000: "1%" };

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
 * The borrower's view: eligibility, the mandate board, and one vault at a time.
 *
 * October 2026 — brought up to the contracts frozen for audit:
 *
 *   - Eligibility, not "verified". The factory checks isEligible(wallet,
 *     requiredBorrowerClaims) at every origination, and an attestation now
 *     expires and carries claims. A wallet admitted once can lapse; the gate
 *     reads the same question the factory asks.
 *   - No yield venue. Removed from the contracts before the audit (E-1).
 *   - The protocol names the pool. A swap must go through the pool the
 *     registry approved for the pair (KRAIT-003, item 20), and an open
 *     position keeps the pool it was bought through. The fee-tier picker is
 *     gone: it could only ever offer one tier the vault would accept.
 *   - The TWAP quote comes from VaultLens, which took over quoteSwapOut when
 *     the vault ran short of bytecode room.
 *   - Swap-back is bounded by what the vault RECORDED buying (heldAmount),
 *     not by its token balance, and is never filled below the TWAP less the
 *     tolerance whatever minimum is entered (KRAIT-001).
 *   - Settlement, in-kind settlement, cancellation and claims are in
 *     VaultActions, shared with the lender view.
 *
 *   minAmountOut on a swap is still the borrower's own slippage protection,
 *   enforced on-chain; the lens provides the TWAP reference and the vault's own
 *   acceptance floor so it is not a guess.
 */
export function BorrowerTab() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);
  const publicClient = usePublicClient();

  const elig = useEligibility(address, "borrower");

  const { allVaults, refetch: refetchVaultList } = useLatestVault(address, "borrower");
  // Open loans only: closed ones are on the History page (26 October 2026).
  const {
    vaults: vaultList,
    loaded: vaultsLoaded,
    selected: latestVaultAddress,
    select: selectVault,
    refetch: refetchVaultStatuses,
  } = useVaultSelection(allVaults, { activeOnly: true });
  const hasClosedLoans = allVaults.length > vaultList.length;

  // When the loan on screen closes, it leaves this page for History. Say so,
  // rather than letting it silently vanish under the borrower's cursor.
  const [justClosed, setJustClosed] = useState(false);
  const shownVault = useRef(null);
  useEffect(() => {
    if (shownVault.current && !latestVaultAddress && vaultsLoaded) setJustClosed(true);
    if (latestVaultAddress) setJustClosed(false);
    shownVault.current = latestVaultAddress;
  }, [latestVaultAddress, vaultsLoaded]);

  const { vault, refetch: refetchVaultData } = useVaultData(latestVaultAddress);
  const { heldAssets, refetch: refetchHeldAssets } = useHeldAssets(
    latestVaultAddress,
    vault?.heldAssetCount || 0
  );

  // --- Deposit: approve (raw ERC20 write) then payDeposit (vault write) ---
  const [depositApproving, setDepositApproving] = useState(false);
  const { writeContract: writeApprove, data: approveHash, isPending: approvePending, error: approveError, reset: resetApprove } = useWriteContract();
  const { isLoading: approveConfirming, data: approveReceipt } = useWaitForTransactionReceipt({ hash: approveHash });
  const approveSuccess = approveReceipt?.status === "success";

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

  // --- Directional swap ---
  const [swapAsset, setSwapAsset] = useState("");
  const [swapAmountIn, setSwapAmountIn] = useState("");
  const [swapMinOut, setSwapMinOut] = useState("");
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

  // Per destination: the riskiest tier it has held since this loan began, and
  // the pool the registry approves for it against the loan asset. Both are
  // known from the asset and the vault alone, so a destination that can never
  // be used is marked the moment the selector renders.
  //
  // The tier read is highestTierSince, not tierOf, because that is what the
  // vault checks: re-tagging an asset safer must not admit it to a loan whose
  // lender agreed a ceiling against its old tier.
  const PER_TARGET = 2;
  const { data: targetResults } = useReadContracts({
    contracts: swapTargets.flatMap((a) => [
      {
        address: contracts.assetRegistry,
        abi: assetRegistryAbi,
        functionName: "highestTierSince",
        args: [a, BigInt(vault?.originatedAt ?? 0)],
      },
      {
        address: contracts.assetRegistry,
        abi: assetRegistryAbi,
        functionName: "poolFeeTier",
        args: [a, vault?.asset],
      },
    ]),
    query: {
      enabled: swapTargets.length > 0 && !isPlaceholder(contracts.assetRegistry) && vault?.originatedAt !== undefined,
    },
  });

  const heldByAddress = new Map(heldAssets.map((h) => [h.address.toLowerCase(), h]));

  const targetInfo = new Map(
    swapTargets.map((a, i) => {
      const tier = targetResults?.[i * PER_TARGET]?.result;
      const registryFee = targetResults?.[i * PER_TARGET + 1]?.result;
      // An open position keeps the pool it was bought through.
      const held = heldByAddress.get(a.toLowerCase());
      const fee = held?.feeTier ?? (registryFee != null ? Number(registryFee) : undefined);
      let reason = null;
      if (tier !== undefined && vault?.maxTier !== undefined && Number(tier) > Number(vault.maxTier)) {
        reason = "tier";
      } else if (fee === 0) {
        reason = "pool";
      }
      return [a.toLowerCase(), { fee, reason }];
    })
  );

  const unavailableTargets = new Map(
    [...targetInfo.entries()].filter(([, v]) => v.reason).map(([k, v]) => [k, v.reason])
  );

  // Never leave a forbidden asset selected — it would be the one destination
  // the borrower cannot use, sitting there as the default.
  useEffect(() => {
    if (swapAsset && unavailableTargets.has(swapAsset.toLowerCase())) {
      const firstAllowed = swapTargets.find((a) => !unavailableTargets.has(a.toLowerCase()));
      setSwapAsset(firstAllowed || "");
    }
  }, [swapAsset, targetResults]);

  const swapTargetsKey = swapTargets.join("|");
  useEffect(() => {
    if (!swapAsset && swapTargets.length > 0) {
      const firstAllowed = swapTargets.find((a) => !unavailableTargets.has(a.toLowerCase()));
      if (firstAllowed) setSwapAsset(firstAllowed);
    }
  }, [swapTargetsKey, swapAsset, targetResults]);

  const swapFee = swapAsset ? targetInfo.get(swapAsset.toLowerCase())?.fee : undefined;

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

  // --- Swap quote and pre-flight ---
  //
  // Declared HERE, above the early returns, because hooks may not be
  // conditional and several of those returns fire before a vault exists.
  const parsedSwapIn = tryParseUnits(swapAmountIn, vault?.decimals);

  const { data: swapQuote } = useReadContract({
    address: contracts.vaultLens,
    abi: VAULT_LENS_ABI,
    functionName: "quoteSwapOut",
    args: [latestVaultAddress, swapAsset, parsedSwapIn ?? 0n, swapFee ?? 0],
    query: {
      enabled:
        !isPlaceholder(contracts.vaultLens) &&
        Boolean(latestVaultAddress && swapAsset && parsedSwapIn && swapFee),
    },
  });

  const quoteOk = swapQuote?.[0] === true;
  const twapOut = swapQuote?.[1];
  const floorOut = swapQuote?.[2];

  // Clear the minimum when the trade it was quoted for changes. A minimum
  // output is only meaningful against the amount and asset it was derived from.
  useEffect(() => {
    setSwapMinOut("");
  }, [swapAmountIn, swapAsset]);
  const parsedSwapMinOut = tryParseUnits(swapMinOut, swapAssetDecimals);

  const swapInputsValid = Boolean(
    vault && !vault.isSettled && !vault.isExpired && vault.depositPaid && swapAsset && swapFee &&
    parsedSwapIn !== undefined && parsedSwapMinOut !== undefined &&
    parsedSwapIn <= vault.investableRemaining
  );

  // The form's own checks cover only what the client can see. The vault also
  // enforces the TWAP window, pool history depth, entry impact, the tier
  // ceiling, the exposure cap and exitability — none knowable from the inputs.
  const swapPreflight = useSwapPreflight({
    vaultAddress: latestVaultAddress,
    enabled: swapInputsValid,
    functionName: "swap",
    args: [swapAsset, parsedSwapIn, parsedSwapMinOut, swapFee],
  });

  if (!isConnected) {
    return <EmptyState message="Connect the borrower wallet to view your vault." />;
  }

  if (!elig.ready) {
    return <EmptyState message="Covenza is not deployed on this network yet." />;
  }

  if (elig.error) {
    return <EmptyState message={`Eligibility check failed: ${elig.error.shortMessage || elig.error.message}`} />;
  }

  if (elig.eligible === undefined) {
    return <EmptyState message="Checking eligibility..." />;
  }

  if (!vaultsLoaded) {
    return <EmptyState message="Loading your loans..." />;
  }

  // An ineligible wallet still sees its OPEN loans — a lapsed attestation
  // stops new borrowing, not repayment, and hiding a live loan behind the gate
  // would hide its deadline. Only a wallet with nothing open is stopped here.
  if (!elig.eligible && vaultList.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <UnclaimedBanner address={address} />
        <KycGate address={address} role="borrower" onEligible={elig.refetch} />
        {hasClosedLoans && <HistoryLink />}
      </div>
    );
  }

  const onFilled = () => { refetchVaultList(); refetchVaultStatuses(); };

  // No open loan is not a dead end: lenders publish terms and the borrower
  // fills them.
  if (!vault) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {justClosed && (
          <div className="notice-bar" role="status" style={{ borderColor: "rgba(134,173,145,0.45)", background: "rgba(134,173,145,0.08)" }}>
            <span>Your loan has closed. Its outcome, and anything waiting to be claimed, is in loan history.</span>
            <Link to="/history" className="btn btn-auto" style={{ padding: "7px 14px" }}>View it</Link>
          </div>
        )}
        <UnclaimedBanner address={address} />
        <EligibleBadge elig={elig} />
        {hasClosedLoans && !justClosed && <HistoryLink />}
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: "var(--parch)", margin: "0 0 4px" }}>
            Available mandates
          </p>
          <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: 0, lineHeight: 1.5 }}>
            Lenders publish terms they will accept. Pick one, choose your size, term and
            deposit, and the loan opens in a single transaction.
          </p>
        </div>
        <MandateBoard onFilled={onFilled} />
      </div>
    );
  }

  const canAct = !vault.isSettled && !vault.isExpired;

  // --- Deposit ---
  //
  // payDeposit pulls the deposit AND the insurance premium in a single
  // transfer, so an approval covering only the deposit reverts. Mandate fills
  // pay both in the fill itself; this is for a loan a lender originated
  // directly.
  const depositTotal = vault.depositPlusPremium ?? vault.requiredDeposit;

  const needsDepositApproval =
    !vault.depositPaid && (depositAllowance === undefined || depositAllowance < depositTotal);
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
        args: [latestVaultAddress, depositTotal],
        maxFeePerGas: fees.maxFeePerGas * 2n,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
    } catch {
      setDepositApproving(false);
    }
  }

  // --- Swap ---
  const swapChecking = swapInputsValid && swapPreflight.status === "checking";
  const swapDisabled = !swapInputsValid || swapPreflight.status === "would-revert" || swapChecking;
  const swapDisabledReason = !vault.depositPaid
    ? "Pay the deposit before swapping."
    : !canAct
    ? "Vault is settled or past its deadline."
    : !swapAsset
    ? "No destination asset is available to this vault."
    : !swapFee
    ? "No approved pool for this pair."
    : parsedSwapIn === undefined
    ? "Enter a valid amount to swap."
    : parsedSwapMinOut === undefined
    ? "Enter a minimum output amount."
    : parsedSwapIn > vault.investableRemaining
    ? `Exceeds investable balance (${formatTokenAmount(vault.investableRemaining, vault.decimals)} ${vault.symbol}).`
    : swapChecking
    ? "Checking with the contract…"
    : swapPreflight.status === "would-revert"
    ? explainSwapRefusal(swapPreflight.reason, parsedSwapMinOut, floorOut, swapAssetDecimals)
    : null;

  const hasTierBlocked = [...unavailableTargets.values()].includes("tier");
  const hasPoolBlocked = [...unavailableTargets.values()].includes("pool");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <UnclaimedBanner address={address} />
      {!elig.eligible && (
        <div style={{ ...cardStyle, borderColor: "var(--brick)" }}>
          <p style={{ fontSize: 12, color: "var(--brick)", margin: 0, lineHeight: 1.6 }}>
            {elig.reason} Your existing loans are unaffected and can be repaid and settled as normal;
            a new loan needs a current attestation.
          </p>
        </div>
      )}

      {/* Only shown once there is a choice to make. */}
      {vaultList.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {vaultList.map((v) => {
            const active = v.address === latestVaultAddress;
            return (
              <button
                key={v.address}
                type="button"
                onClick={() => selectVault(v.address)}
                style={{
                  border: `1px solid ${active ? "var(--brass)" : "var(--hairline)"}`,
                  background: active ? "var(--brass)" : "transparent",
                  color: active ? "#1C1C1A" : "var(--parch-dim)",
                  borderRadius: 6, padding: "5px 12px", fontSize: 12,
                  cursor: "pointer", fontWeight: active ? 600 : 400,
                }}
              >
                {v.label}
              </button>
            );
          })}
        </div>
      )}

      <VaultStatement vault={vault} />


      {/* --- Deposit --- */}
      {!vault.isSettled && !vault.depositPaid && (
        <div style={cardStyle}>
          <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "0 0 4px" }}>Deposit</p>

          {/* Two amounts leave the borrower's wallet in one transaction, and
              only one of them comes back. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, margin: "0 0 12px" }}>
            <CostRow
              label="Deposit — returned at settlement, less any loss"
              value={`${formatTokenAmount(vault.requiredDeposit, vault.decimals)} ${vault.symbol}`}
            />
            {vault.insurancePremium > 0n && (
              <>
                <CostRow
                  label="Insurance premium — not refunded"
                  value={`${formatTokenAmount(vault.insurancePremium, vault.decimals)} ${vault.symbol}`}
                />
                <CostRow
                  label="Total payable now"
                  value={`${formatTokenAmount(depositTotal, vault.decimals)} ${vault.symbol}`}
                  emphasis
                />
              </>
            )}
          </div>

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
      )}

      {/* --- Directional swap --- */}
      {canAct && swapTargets.length > 0 && (
        <div style={cardStyle}>
          <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "0 0 12px" }}>
            Swap {vault.symbol} for another whitelisted asset
          </p>

          <Field label="Destination asset">
            <AssetSwitcher
              assets={swapTargets}
              chainId={chainId}
              value={swapAsset}
              onChange={setSwapAsset}
              unavailable={unavailableTargets}
            />
            {hasTierBlocked && (
              <p style={{ fontSize: 12, color: "var(--slate)", margin: "6px 0 0", lineHeight: 1.5 }}>
                Struck-through assets have sat above this vault's {vault.maxTierLabel} ceiling at some
                point since the loan began; the lender agreed that ceiling at origination. No amount or
                price makes them available.
              </p>
            )}
            {hasPoolBlocked && (
              <p style={{ fontSize: 12, color: "var(--slate)", margin: "6px 0 0", lineHeight: 1.5 }}>
                Some assets have no pool approved against {vault.symbol} yet, so they cannot be swapped
                into.
              </p>
            )}
          </Field>

          {swapFee ? (
            <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "-4px 0 12px", lineHeight: 1.5 }}>
              Trades through the {FEE_LABELS[swapFee] || `${swapFee / 10000}%`} pool
              {heldByAddress.has(swapAsset.toLowerCase())
                ? " — the pool this vault's open position was bought through."
                : " — the one the protocol approves for this pair."}
            </p>
          ) : null}

          <Row2>
            <Field label={`Amount to swap (${vault.symbol})`}>
              <input value={swapAmountIn} onChange={(e) => setSwapAmountIn(e.target.value)} className="input" placeholder="0.0" />
            </Field>
            <Field label={`Min. output (${symbolForToken(chainId, swapAsset) || "—"})`}>
              <input value={swapMinOut} onChange={(e) => setSwapMinOut(e.target.value)} className="input" placeholder="0.0" />
              {quoteOk && swapAssetDecimals !== undefined && (
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: "var(--parch-dim)" }}>
                    TWAP {formatTokenAmount(twapOut, swapAssetDecimals)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSwapMinOut(formatUnits(floorOut, swapAssetDecimals))}
                    style={{
                      background: "transparent", border: "none", padding: 0,
                      fontSize: 11, color: "var(--brass)", cursor: "pointer", textDecoration: "underline",
                    }}
                  >
                    use {formatTokenAmount(floorOut, swapAssetDecimals)}
                  </button>
                  <span style={{ fontSize: 11, color: "var(--slate)" }}>
                    — the least this vault accepts
                  </span>
                </div>
              )}
              {parsedSwapIn && swapQuote && !quoteOk && (
                <p style={{ fontSize: 12, color: "var(--brick)", margin: "5px 0 0", lineHeight: 1.5 }}>
                  The approved pool cannot be priced right now — it has too little price history for the
                  TWAP window — so the swap would be refused.
                </p>
              )}
            </Field>
          </Row2>

          <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "-4px 0 12px", lineHeight: 1.5 }}>
            Minimum output is your own slippage protection, enforced on-chain. The TWAP above is
            the reference price; the vault refuses anything more than a short distance below it,
            so setting your minimum under that figure does not buy you a looser trade.
          </p>

          <ActionButton
            label={`Swap to ${symbolForToken(chainId, swapAsset) || "—"}`}
            primary={!swapDisabled}
            disabled={swapDisabled}
            disabledReason={swapDisabledReason}
            loading={swapAction.isPending || swapAction.isConfirming}
            onClick={() => swapAction.call(latestVaultAddress, "swap", [swapAsset, parsedSwapIn, parsedSwapMinOut, swapFee])}
          />
          {swapAction.error && (
            <p style={{ fontSize: 12, color: "var(--brick)", marginTop: 10 }}>
              {swapAction.error.shortMessage || swapAction.error.message}
            </p>
          )}
        </div>
      )}

      {/* --- Swap back held assets --- */}
      {canAct && heldAssets.length > 0 && (
        <div>
          <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "0 0 10px" }}>
            Held foreign assets ({heldAssets.length}) — sold back to {vault.symbol} at settlement
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

      {/* --- Settle, settle in kind, cancel, claim --- */}
      <VaultActions
        vault={vault}
        role="borrower"
        onDone={() => { refetchVaultData(); refetchVaultList(); refetchVaultStatuses(); refetchHeldAssets(); }}
      />
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

  // `amount` is what the vault recorded buying, capped by what it still holds.
  // Tokens sent to the vault directly are not the borrower's to sell, and the
  // vault refuses more than heldAmount (KRAIT-003).
  const max = held.amount;

  const inputsValid =
    parsedAmountIn !== undefined && parsedMinOut !== undefined && parsedAmountIn <= max;

  const preflight = useSwapPreflight({
    vaultAddress,
    enabled: inputsValid,
    functionName: "swapBack",
    args: [held.address, parsedAmountIn, parsedMinOut],
  });

  const checking = inputsValid && preflight.status === "checking";
  const disabled = !inputsValid || preflight.status === "would-revert" || checking;
  const disabledReason = parsedAmountIn === undefined
    ? "Enter a valid amount."
    : parsedMinOut === undefined
    ? "Enter a minimum output."
    : parsedAmountIn > max
    // The displayed figure is rounded for legibility, so typing what is on
    // screen can exceed the real one by a few wei.
    ? "Amount exceeds what this vault holds — use Max for the exact figure."
    : checking
    ? "Checking with the contract…"
    : preflight.status === "would-revert"
    ? explainSwapBackRefusal(preflight.reason)
    : null;

  const donated = held.balance > held.recorded;

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, gap: 12 }}>
        <span className="mono" style={{ fontSize: 13, color: "var(--parch)" }}>
          {held.symbol}
          {held.feeTier ? (
            <span style={{ fontSize: 11, color: "var(--parch-dim)" }}> · {FEE_LABELS[held.feeTier] || held.feeTier} pool</span>
          ) : null}
        </span>
        <span className="mono" style={{ fontSize: 12, color: "var(--parch-dim)" }}>
          Held: {formatTokenAmount(max, held.decimals)}
          <button
            type="button"
            onClick={() => setAmountIn(formatUnits(max, held.decimals))}
            style={{
              background: "none", border: "none", padding: "0 0 0 8px",
              color: "var(--slate)", fontSize: 11, cursor: "pointer", textDecoration: "underline",
            }}
          >
            Max
          </button>
        </span>
      </div>
      {donated && (
        <p style={{ fontSize: 12, color: "var(--slate)", margin: "0 0 10px", lineHeight: 1.5 }}>
          The vault's balance is {formatTokenAmount(held.balance, held.decimals)}; the excess was sent to it
          directly rather than bought, and is not counted as the position.
        </p>
      )}
      <Row2>
        <Field label={`Amount (${held.symbol})`}>
          <input
            value={amountIn}
            onChange={(e) => setAmountIn(e.target.value)}
            className="input"
            placeholder={formatTokenAmount(max, held.decimals)}
          />
        </Field>
        <Field label={`Min. output (${loanSymbol})`}>
          <input value={minOut} onChange={(e) => setMinOut(e.target.value)} className="input" placeholder="0.0" />
        </Field>
      </Row2>
      <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "-4px 0 10px", lineHeight: 1.5 }}>
        The vault never sells below the TWAP less its tolerance, whatever minimum is entered here;
        a higher minimum only tightens it.
      </p>
      <ActionButton
        label={`Swap back to ${loanSymbol}`}
        primary={!disabled}
        disabled={disabled}
        disabledReason={disabledReason}
        loading={isPending || isConfirming}
        onClick={() => call(vaultAddress, "swapBack", [held.address, parsedAmountIn, parsedMinOut])}
      />
      {error && <p style={{ fontSize: 12, color: "var(--brick)", marginTop: 8 }}>{error.shortMessage || error.message}</p>}
    </div>
  );
}

/**
 * @param unavailable  Map of asset address (lowercase) → "tier" | "pool".
 *                     Rendered struck through and unclickable.
 *
 * Marking them here rather than letting them be selected is the point: an
 * asset the vault can never hold should not be selectable, then refused only
 * after the borrower has filled in an amount and a minimum.
 */
function AssetSwitcher({ assets, chainId, value, onChange, unavailable }) {
  return (
    <div style={{ display: "inline-flex", flexWrap: "wrap", background: "var(--ink)", border: "1px solid var(--hairline)", borderRadius: 8, padding: 3 }}>
      {assets.map((asset) => {
        const active = asset === value;
        const why = unavailable?.get?.(asset.toLowerCase());
        const blocked = Boolean(why);
        return (
          <button
            key={asset}
            type="button"
            disabled={blocked}
            title={
              why === "tier"
                ? "Above this vault's risk ceiling — agreed with the lender at origination"
                : why === "pool"
                ? "No approved pool against the loan asset"
                : undefined
            }
            onClick={() => !blocked && onChange(asset)}
            style={{
              border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12,
              cursor: blocked ? "not-allowed" : "pointer",
              background: active && !blocked ? "var(--brass)" : "transparent",
              color: blocked ? "var(--slate)" : (active ? "#1C1C1A" : "var(--parch-dim)"),
              fontWeight: active && !blocked ? 600 : 400,
              textDecoration: blocked ? "line-through" : "none",
            }}
          >
            {symbolForToken(chainId, asset)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One line of the borrower's up-front cost. Deposit and premium are shown
 * separately because only one of them comes back.
 */
/** Points to the History page, where closed loans now live. */
function HistoryLink() {
  return (
    <p className="note" style={{ margin: 0 }}>
      Your closed loans are in <Link to="/history">loan history</Link>.
    </p>
  );
}

function CostRow({ label, value, emphasis }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
      <span style={{ fontSize: 11, color: "var(--parch-dim)" }}>{label}</span>
      <span
        className="mono"
        style={{ fontSize: 12, color: emphasis ? "var(--parch)" : "var(--parch-dim)",
                 fontWeight: emphasis ? 600 : 400 }}
      >
        {value}
      </span>
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
  return <div className="row2">{children}</div>;
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
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  padding: "18px 20px",
};


/**
 * Confirms the wallet may borrow, by whose attestation, and until when.
 *
 * Naming the attester matters more than it looks. Covenza performs no identity
 * check itself — it records that a recognised third party did — so "who
 * admitted this wallet" is the entirety of what verification means. The expiry
 * is shown because an attestation now lapses, and a borrower should see that
 * coming rather than find out from a refused fill.
 */
function EligibleBadge({ elig }) {
  const { live: providers } = useAttesters();
  const issuer = providers.find((p) => p.key.toLowerCase() === (elig.attester || "").toLowerCase());
  const chainNow = useChainNow(60);
  const daysLeft = elig.validUntil ? Math.floor((elig.validUntil - chainNow) / 86400) : null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        border: "1px solid var(--hairline)",
        borderRadius: 8,
        padding: "9px 13px",
        background: "var(--panel)",
      }}
    >
      <span style={{ color: "var(--sage)", fontSize: 13 }}>&#10003;</span>
      <div>
        <span style={{ fontSize: 12, color: "var(--parch)" }}>Eligible — you can borrow</span>
        <span style={{ fontSize: 11, color: daysLeft !== null && daysLeft < 14 ? "var(--brick)" : "var(--parch-dim)" }}>
          {elig.manual ? " · granted by the operator" : issuer ? ` · attested by ${issuer.name}` : ""}
          {daysLeft !== null ? ` · valid ${daysLeft} more day${daysLeft === 1 ? "" : "s"}` : ""}
        </span>
      </div>
    </div>
  );
}

/**
 * Turns the router's refusal into the protocol's own explanation, where the two
 * describe the same thing from different sides.
 *
 * If the borrower's minimum is at or below what the vault itself would accept,
 * no minimum they could set would help: the pool cannot deliver the impact
 * floor at this size. That is a different problem from asking for too much.
 */
function explainSwapRefusal(reason, minOut, floorOut, outDecimals) {
  const tooLittle = /too little received|insufficient output/i.test(reason || "");
  const askingNoMoreThanTheVaultWould =
    minOut !== undefined && floorOut !== undefined && minOut <= floorOut;

  if (tooLittle && askingNoMoreThanTheVaultWould) {
    return (
      "Position too large for this pool's depth — the price moves further than the vault " +
      "permits on entry. Try a smaller amount."
    );
  }

  if (tooLittle && floorOut !== undefined && outDecimals !== undefined) {
    return (
      `Your minimum output is above what this trade returns. The vault accepts down to ` +
      `${formatTokenAmount(floorOut, outDecimals)} — use that figure or lower.`
    );
  }

  if (/too little price history/i.test(reason || "")) {
    return "The approved pool keeps too little price history for the TWAP window, so the vault will not enter it.";
  }

  return reason;
}

function explainSwapBackRefusal(reason) {
  const frozen = explainTokenRefusal(reason);
  if (frozen) return frozen;
  if (/too little received|Received less than minimum/i.test(reason || "")) {
    return "The pool cannot fill this at the TWAP less the tolerance right now. Try a smaller amount, or wait for the price to settle.";
  }
  return reason;
}
