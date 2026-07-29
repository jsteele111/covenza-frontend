import { useState, useEffect, useCallback } from "react";
import { useAccount, useChainId, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from "wagmi";
import { parseAbiItem, parseUnits, isAddress } from "viem";
import { KYC_REGISTRY_ABI, ASSET_REGISTRY_ABI, INSURANCE_POOL_ABI, ERC20_ABI } from "../config/abis.js";
import { getContractsForChain, isPlaceholder, symbolForToken } from "../config/contracts.js";
import { shortAddress, formatTokenAmount } from "../utils/format.js";
import { useSettledVaultsWithLoss } from "../hooks/useSettledVaultsWithLoss.js";
import { useAssetPreflight } from "../hooks/useAssetPreflight.js";
import { ActionButton } from "./ActionButton.jsx";

// abis.js already exports pre-parsed ABIs — do not re-wrap in parseAbi().
const kycAbi = KYC_REGISTRY_ABI;
const assetRegistryAbi = ASSET_REGISTRY_ABI;
const insurancePoolAbi = INSURANCE_POOL_ABI;
const erc20Abi = ERC20_ABI;

const verifiedEvent = parseAbiItem(
  "event AddressVerified(address indexed wallet, uint256 timestamp, bool viaSignature)"
);

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
 * Group E6 rewrite. v1's operator view only covered KYC administration
 * (manual revoke + a loss-history reviewer). That's preserved as-is below
 * — the model of "revocation is a deliberate operator judgment call, never
 * automatic" (see BRD §14.3) doesn't change for v2.
 *
 * What's new: v2 moved a real slice of protocol governance into
 * AssetRegistry and InsurancePool — the whitelist, settlement TWAP/bounty
 * parameters, and the insurance draw cap are now operator-controlled
 * contract state (NFR-6: configurable without redeploying in-flight
 * vaults), but v1's UI had no way to touch any of it. Without this,
 * whitelisting a new asset post-launch would require a raw script call
 * outside the app entirely. Three new panels close that gap:
 *   - AssetWhitelistPanel   — add/remove whitelisted assets
 *   - InsurancePoolPanel    — per-asset reserve visibility, draw cap,
 *                             administrative withdrawal
 *   - SettlementConfigPanel — TWAP window/tolerance, swap-back grace
 *                             period, keeper bounty rate/cap (one atomic
 *                             update, matching the contract's own design)
 */
export function OperatorTab() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);
  const publicClient = usePublicClient();

  const [verifiedAddresses, setVerifiedAddresses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [revokingAddress, setRevokingAddress] = useState(null);
  const [revokeError, setRevokeError] = useState(null);

  const { data: operatorAddress } = useReadContract({
    address: contracts.kycRegistry,
    abi: kycAbi,
    functionName: "operator",
  });

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const { lossyVaults, isLoading: lossyLoading, refetch: refetchLossy } = useSettledVaultsWithLoss();

  const loadVerifiedAddresses = useCallback(async () => {
    setLoading(true);
    try {
      const logs = await publicClient.getLogs({
        address: contracts.kycRegistry,
        event: verifiedEvent,
        fromBlock: 0n,
        toBlock: "latest",
      });

      const uniqueAddresses = [...new Set(logs.map((log) => log.args.wallet))];

      const statuses = await Promise.all(
        uniqueAddresses.map((addr) =>
          publicClient.readContract({
            address: contracts.kycRegistry,
            abi: kycAbi,
            functionName: "isVerified",
            args: [addr],
          })
        )
      );

      setVerifiedAddresses(uniqueAddresses.filter((_, i) => statuses[i]));
    } catch (err) {
      console.error("Failed to load verified addresses:", err);
    } finally {
      setLoading(false);
    }
  }, [publicClient, contracts.kycRegistry]);

  useEffect(() => {
    loadVerifiedAddresses();
  }, [loadVerifiedAddresses]);

  useEffect(() => {
    if (isSuccess) {
      loadVerifiedAddresses();
      refetchLossy();
      setRevokingAddress(null);
    }
  }, [isSuccess]);

  if (!isConnected) {
    return <EmptyState message="Connect the operator wallet to manage verified addresses." />;
  }

  const isOperator = operatorAddress && address && operatorAddress.toLowerCase() === address.toLowerCase();

  if (!isOperator) {
    return <EmptyState message="This wallet is not the KYC registry operator. Connect the operator wallet to manage verified addresses." />;
  }

  async function revoke(addr) {
    setRevokeError(null);
    setRevokingAddress(addr);
    try {
      const fees = await publicClient.estimateFeesPerGas();
      writeContract({
        address: contracts.kycRegistry,
        abi: kycAbi,
        functionName: "revoke",
        args: [addr],
        maxFeePerGas: fees.maxFeePerGas * 2n,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
    } catch (err) {
      setRevokeError(err.shortMessage || err.message || "Failed to estimate gas fees.");
      setRevokingAddress(null);
    }
  }

  const busyFor = (addr) =>
    (isPending || isConfirming) && revokingAddress?.toLowerCase() === addr?.toLowerCase();

  const registryReady = !isPlaceholder(contracts.assetRegistry) && !isPlaceholder(contracts.insurancePool);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* --- Loss history: visibility layer for manual revocation review --- */}
      <div>
        <p style={sectionLabelStyle}>Settlement loss history</p>
        <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 4px" }}>
          Settled vaults with a loss — revocation is never automatic; review each case and
          decide whether it warrants pulling KYC status.
        </p>

        {lossyLoading && (
          <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "8px 0" }}>Checking settled vaults...</p>
        )}

        {!lossyLoading && lossyVaults.length === 0 && (
          <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "8px 0" }}>
            No lossy settlements found among vaults deployed by the current factory.
          </p>
        )}

        {lossyVaults.map((v) => {
          const isLenderImpacted = v.severity === 2;
          const amount = (value) => `${formatTokenAmount(value, v.decimals)} ${v.symbol}`;
          return (
            <div
              key={v.address}
              style={{
                ...cardStyle,
                borderColor: isLenderImpacted ? "var(--brick)" : "var(--hairline)",
                marginTop: 10,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div>
                  <span
                    style={{
                      fontSize: 11,
                      color: isLenderImpacted ? "var(--brick)" : "var(--slate)",
                      border: `1px solid ${isLenderImpacted ? "var(--brick)" : "var(--slate)"}`,
                      borderRadius: 20,
                      padding: "2px 8px",
                    }}
                  >
                    {isLenderImpacted ? "Lender-impacted" : "Borrower-only"} — {v.symbol}
                  </span>
                  <p className="mono" style={{ fontSize: 12, color: "var(--parch)", margin: "8px 0 0" }}>
                    {shortAddress(v.address)}
                  </p>
                  <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "2px 0 0" }}>
                    Borrower: <span className="mono">{shortAddress(v.borrower)}</span>
                  </p>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 10, borderTop: "1px solid var(--hairline)", marginBottom: 12 }}>
                <Row label="Principal" value={amount(v.principal)} />
                <Row label="Total returned at settlement" value={amount(v.settledTotalReturned)} />
                {v.settledInsuranceDraw > 0n && (
                  <Row label="Insurance pool draw" value={amount(v.settledInsuranceDraw)} />
                )}
                <Row label="Lender received" value={amount(v.settledLenderPayout)} />
                <Row label="Borrower received" value={amount(v.settledBorrowerPayout)} />
              </div>

              <button
                onClick={() => revoke(v.borrower)}
                disabled={busyFor(v.borrower)}
                style={{
                  width: "100%",
                  background: "transparent",
                  color: "var(--brick)",
                  border: "1px solid var(--brick)",
                  borderRadius: 8,
                  padding: 10,
                  fontSize: 13,
                  fontWeight: 500,
                  opacity: busyFor(v.borrower) ? 0.6 : 1,
                }}
              >
                {busyFor(v.borrower) ? "Confirming..." : "Revoke borrower's KYC"}
              </button>
            </div>
          );
        })}
      </div>

      {/* --- Existing verified-address list and manual revoke --- */}
      <div>
        <p style={sectionLabelStyle}>Verified addresses</p>
        <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 4px" }}>
          Verification now happens automatically via signed attestation — revoke manually here
          for any other reason (e.g. sanctions match, re-screening failure).
        </p>

        {loading && <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "8px 0" }}>Loading verified addresses...</p>}

        {!loading && verifiedAddresses.length === 0 && (
          <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "8px 0" }}>No currently verified addresses.</p>
        )}

        {!loading && verifiedAddresses.map((addr) => (
          <div key={addr} style={{ ...cardStyle, marginTop: 10 }}>
            <p className="mono" style={{ fontSize: 12, color: "var(--parch)", margin: "0 0 12px" }}>
              {shortAddress(addr)}
            </p>
            <button
              onClick={() => revoke(addr)}
              disabled={busyFor(addr)}
              style={{
                width: "100%",
                background: "transparent",
                color: "var(--brick)",
                border: "1px solid var(--brick)",
                borderRadius: 8,
                padding: 10,
                fontSize: 13,
                fontWeight: 500,
                opacity: busyFor(addr) ? 0.6 : 1,
              }}
            >
              {busyFor(addr) ? "Confirming..." : "Revoke"}
            </button>
          </div>
        ))}

        {(error || revokeError) && (
          <p style={{ fontSize: 12, color: "var(--brick)", marginTop: 10 }}>{error?.shortMessage || error?.message || revokeError}</p>
        )}
      </div>

      {/* --- v2 protocol governance panels --- */}
      {registryReady ? (
        <>
          <AssetWhitelistPanel />
          <InsurancePoolPanel />
          <SettlementConfigPanel />
        </>
      ) : (
        <div>
          <p style={sectionLabelStyle}>Protocol governance</p>
          <EmptyState message="The asset registry and insurance pool haven't been deployed on this network yet — whitelist, insurance, and settlement-config controls will appear here once Group F's deployment fills in real addresses." />
        </div>
      )}
    </div>
  );
}

// --- Asset whitelist management ---

function AssetWhitelistPanel() {
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);
  const publicClient = usePublicClient();

  const [newAsset, setNewAsset] = useState("");
  const [newAToken, setNewAToken] = useState("");
  const [pendingAsset, setPendingAsset] = useState(null); // "new" | address | null

  // Set when the operator has seen "no quotable pair" and wants to proceed
  // anyway. Cleared whenever the candidate address changes, so an
  // acknowledgement can never carry over to a different asset.
  const [acknowledged, setAcknowledged] = useState(false);

  const preflight = useAssetPreflight(newAsset);

  function onCandidateChange(value) {
    setNewAsset(value);
    setAcknowledged(false);
  }

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const { data: totalAssets, refetch: refetchTotal } = useReadContract({
    address: contracts.assetRegistry,
    abi: assetRegistryAbi,
    functionName: "totalAssets",
  });

  const count = totalAssets ? Number(totalAssets) : 0;

  const { data: addressResults, refetch: refetchAddresses } = useReadContracts({
    contracts: Array.from({ length: count }, (_, i) => ({
      address: contracts.assetRegistry,
      abi: assetRegistryAbi,
      functionName: "allAssets",
      args: [BigInt(i)],
    })),
    query: { enabled: count > 0 },
  });

  const addresses = (addressResults || []).map((r) => r.result).filter(Boolean);

  const { data: whitelistResults, refetch: refetchWhitelist } = useReadContracts({
    contracts: addresses.map((addr) => ({
      address: contracts.assetRegistry,
      abi: assetRegistryAbi,
      functionName: "isWhitelisted",
      args: [addr],
    })),
    query: { enabled: addresses.length > 0 },
  });

  const assets = addresses.map((addr, i) => ({
    address: addr,
    symbol: symbolForToken(chainId, addr),
    whitelisted: whitelistResults?.[i]?.result || false,
  }));

  useEffect(() => {
    if (isSuccess) {
      refetchTotal();
      refetchAddresses();
      refetchWhitelist();
      setNewAsset("");
      setNewAToken("");
      setAcknowledged(false);
      setPendingAsset(null);
      reset();
    }
  }, [isSuccess]);

  const newAssetValid = isAddress(newAsset);
  const newATokenValid = !newAToken || isAddress(newAToken); // blank = address(0), swap-only asset
  const busy = isPending || isConfirming;

  // The contract guard is what keeps funds safe; this only decides whether
  // the operator is allowed to proceed without having read the report. The
  // one genuinely hard stop is "not an ERC-20" — that is a wrong address,
  // not a judgement call.
  const needsAcknowledgement =
    preflight.ready && preflight.hasCounterparties && !preflight.anyQuotable;

  const blockedReason =
    !newAssetValid                                ? "Enter a valid asset address."
    : !newATokenValid                             ? "Aave aToken must be a valid address or blank."
    : preflight.isChecking                        ? "Checking pools…"
    : preflight.alreadyListed                     ? "This asset is already whitelisted."
    : preflight.ready && !preflight.isErc20       ? "That address does not respond as an ERC-20 token."
    : needsAcknowledgement && !acknowledged       ? "No quotable pair found — acknowledge below to proceed."
    : null;

  async function addAsset() {
    setPendingAsset("new");
    try {
      const fees = await publicClient.estimateFeesPerGas();
      writeContract({
        address: contracts.assetRegistry,
        abi: assetRegistryAbi,
        functionName: "addAsset",
        args: [newAsset, newAToken || "0x0000000000000000000000000000000000000000"],
        maxFeePerGas: fees.maxFeePerGas * 2n,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
    } catch {
      setPendingAsset(null);
    }
  }

  async function removeAsset(assetAddress) {
    setPendingAsset(assetAddress);
    try {
      const fees = await publicClient.estimateFeesPerGas();
      writeContract({
        address: contracts.assetRegistry,
        abi: assetRegistryAbi,
        functionName: "removeAsset",
        args: [assetAddress],
        maxFeePerGas: fees.maxFeePerGas * 2n,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
    } catch {
      setPendingAsset(null);
    }
  }

  return (
    <div>
      <p style={sectionLabelStyle}>Asset whitelist</p>
      <div style={cardStyle}>
        <Row2>
          <Field label="Asset address">
            <input value={newAsset} onChange={(e) => onCandidateChange(e.target.value)} style={inputStyle} placeholder="0x..." />
          </Field>
          <Field label="Aave aToken (blank = swap-only)">
            <input value={newAToken} onChange={(e) => setNewAToken(e.target.value)} style={inputStyle} placeholder="0x... or blank" />
          </Field>
        </Row2>

        <PreflightReport preflight={preflight} />

        {needsAcknowledgement && (
          <label style={acknowledgeStyle}>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span>
              Whitelist anyway. Borrowers will not be able to swap into this asset — the
              vault refuses any position it could not force an exit from — but it remains
              valid as a loan denomination.
            </span>
          </label>
        )}

        <ActionButton
          label="Add asset"
          primary={blockedReason === null}
          disabled={blockedReason !== null}
          disabledReason={blockedReason || ""}
          loading={busy && pendingAsset === "new"}
          onClick={addAsset}
        />
        {error && <p style={errorTextStyle}>{error.shortMessage || error.message}</p>}
      </div>

      {assets.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
          {assets.map((a) => (
            <div key={a.address} style={{ ...cardStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <p className="mono" style={{ fontSize: 13, color: "var(--parch)", margin: "0 0 4px" }}>{a.symbol}</p>
                <p className="mono" style={{ fontSize: 11, color: "var(--parch-dim)", margin: 0 }}>{shortAddress(a.address)}</p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    fontSize: 11,
                    color: a.whitelisted ? "var(--brass)" : "var(--parch-dim)",
                    border: `1px solid ${a.whitelisted ? "var(--brass)" : "var(--hairline)"}`,
                    borderRadius: 20,
                    padding: "2px 8px",
                  }}
                >
                  {a.whitelisted ? "Whitelisted" : "Removed"}
                </span>
                {a.whitelisted && (
                  <button
                    onClick={() => removeAsset(a.address)}
                    disabled={busy && pendingAsset === a.address}
                    style={smallDangerButtonStyle}
                  >
                    {busy && pendingAsset === a.address ? "Confirming..." : "Remove"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Insurance pool: reserves, draw cap, administrative withdrawal ---

function InsurancePoolPanel() {
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);
  const publicClient = usePublicClient();

  const { data: whitelistedAssets } = useReadContract({
    address: contracts.assetRegistry,
    abi: assetRegistryAbi,
    functionName: "getWhitelistedAssets",
  });
  const assetList = whitelistedAssets || [];

  const { data: reserveResults, refetch: refetchReserves } = useReadContracts({
    contracts: assetList.flatMap((a) => [
      { address: contracts.insurancePool, abi: insurancePoolAbi, functionName: "reserveOf", args: [a] },
      { address: a, abi: erc20Abi, functionName: "decimals" },
    ]),
    query: { enabled: assetList.length > 0 },
  });

  const { data: drawCapBps, refetch: refetchDrawCap } = useReadContract({
    address: contracts.insurancePool,
    abi: insurancePoolAbi,
    functionName: "drawCapBps",
  });

  const reserves = assetList.map((a, i) => ({
    address: a,
    symbol: symbolForToken(chainId, a),
    reserve: reserveResults?.[i * 2]?.result,
    decimals: reserveResults?.[i * 2 + 1]?.result,
  }));

  const [newDrawCap, setNewDrawCap] = useState("");
  const [withdrawAsset, setWithdrawAsset] = useState("");
  const [withdrawTo, setWithdrawTo] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [pendingAction, setPendingAction] = useState(null); // "drawcap" | "withdraw" | null

  useEffect(() => {
    if (!withdrawAsset && assetList.length > 0) setWithdrawAsset(assetList[0]);
  }, [assetList, withdrawAsset]);

  const { data: withdrawAssetDecimals } = useReadContract({
    address: withdrawAsset,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: Boolean(withdrawAsset) },
  });

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) {
      refetchReserves();
      refetchDrawCap();
      setNewDrawCap("");
      setWithdrawTo("");
      setWithdrawAmount("");
      setPendingAction(null);
      reset();
    }
  }, [isSuccess]);

  const busy = isPending || isConfirming;

  const drawCapValueValid =
    newDrawCap !== "" && Number.isFinite(Number(newDrawCap)) && Number(newDrawCap) > 0 && Number(newDrawCap) <= 10000;

  async function updateDrawCap() {
    setPendingAction("drawcap");
    try {
      const fees = await publicClient.estimateFeesPerGas();
      writeContract({
        address: contracts.insurancePool,
        abi: insurancePoolAbi,
        functionName: "setDrawCapBps",
        args: [BigInt(Math.round(Number(newDrawCap)))],
        maxFeePerGas: fees.maxFeePerGas * 2n,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
    } catch {
      setPendingAction(null);
    }
  }

  const parsedWithdrawAmount = tryParseUnits(withdrawAmount, withdrawAssetDecimals);
  const withdrawValid = Boolean(withdrawAsset) && isAddress(withdrawTo) && parsedWithdrawAmount !== undefined;

  async function adminWithdraw() {
    setPendingAction("withdraw");
    try {
      const fees = await publicClient.estimateFeesPerGas();
      writeContract({
        address: contracts.insurancePool,
        abi: insurancePoolAbi,
        functionName: "adminWithdraw",
        args: [withdrawAsset, withdrawTo, parsedWithdrawAmount],
        maxFeePerGas: fees.maxFeePerGas * 2n,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
    } catch {
      setPendingAction(null);
    }
  }

  return (
    <div>
      <p style={sectionLabelStyle}>Insurance pool</p>
      <div style={cardStyle}>
        <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 12px" }}>
          Current draw cap: {drawCapBps != null ? `${Number(drawCapBps) / 100}%` : "—"} of loan principal, per settlement
        </p>
        {reserves.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid var(--hairline)" }}>
            {reserves.map((r) => (
              <Row key={r.address} label={r.symbol} value={`${formatTokenAmount(r.reserve, r.decimals)} ${r.symbol}`} />
            ))}
          </div>
        )}

        <Row2>
          <Field label="New draw cap (bps, e.g. 1000 = 10%)">
            <input value={newDrawCap} onChange={(e) => setNewDrawCap(e.target.value)} style={inputStyle} placeholder="1000" />
          </Field>
          <div style={{ alignSelf: "flex-end", marginBottom: 12 }}>
            <ActionButton
              label="Update draw cap"
              primary={drawCapValueValid}
              disabled={!drawCapValueValid}
              disabledReason="Enter a value from 1 to 10000 bps."
              loading={busy && pendingAction === "drawcap"}
              onClick={updateDrawCap}
            />
          </div>
        </Row2>
      </div>

      <div style={{ ...cardStyle, marginTop: 12 }}>
        <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 12px" }}>Administrative withdrawal</p>
        <Field label="Asset">
          <AssetSwitcher assets={assetList} chainId={chainId} value={withdrawAsset} onChange={setWithdrawAsset} />
        </Field>
        <Row2>
          <Field label="Recipient address">
            <input value={withdrawTo} onChange={(e) => setWithdrawTo(e.target.value)} style={inputStyle} placeholder="0x..." />
          </Field>
          <Field label="Amount">
            <input value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} style={inputStyle} placeholder="0.0" />
          </Field>
        </Row2>
        <ActionButton
          label="Withdraw"
          primary={withdrawValid}
          disabled={!withdrawValid}
          disabledReason="Select an asset, a valid recipient address, and a valid amount."
          loading={busy && pendingAction === "withdraw"}
          onClick={adminWithdraw}
        />
        {error && <p style={errorTextStyle}>{error.shortMessage || error.message}</p>}
      </div>
    </div>
  );
}

// --- Settlement configuration (TWAP, grace period, keeper bounty) ---

function SettlementConfigPanel() {
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);
  const publicClient = usePublicClient();

  const { data: configResults, refetch } = useReadContracts({
    contracts: [
      { address: contracts.assetRegistry, abi: assetRegistryAbi, functionName: "twapWindow" },
      { address: contracts.assetRegistry, abi: assetRegistryAbi, functionName: "twapToleranceBps" },
      { address: contracts.assetRegistry, abi: assetRegistryAbi, functionName: "swapBackGracePeriod" },
      { address: contracts.assetRegistry, abi: assetRegistryAbi, functionName: "bountyRatePerHourBps" },
      { address: contracts.assetRegistry, abi: assetRegistryAbi, functionName: "bountyCapBps" },
    ],
  });

  const [twapWindow, setTwapWindow] = useState("");
  const [twapToleranceBps, setTwapToleranceBps] = useState("");
  const [swapBackGracePeriod, setSwapBackGracePeriod] = useState("");
  const [bountyRatePerHourBps, setBountyRatePerHourBps] = useState("");
  const [bountyCapBps, setBountyCapBps] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (configResults && !loaded) {
      setTwapWindow(configResults[0]?.result?.toString() || "");
      setTwapToleranceBps(configResults[1]?.result?.toString() || "");
      setSwapBackGracePeriod(configResults[2]?.result?.toString() || "");
      setBountyRatePerHourBps(configResults[3]?.result?.toString() || "");
      setBountyCapBps(configResults[4]?.result?.toString() || "");
      setLoaded(true);
    }
  }, [configResults, loaded]);

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) {
      refetch();
      reset();
    }
  }, [isSuccess]);

  const fields = [twapWindow, twapToleranceBps, swapBackGracePeriod, bountyRatePerHourBps, bountyCapBps];
  const allValid = fields.every((v) => v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0);
  const busy = isPending || isConfirming;

  async function save() {
    try {
      const fees = await publicClient.estimateFeesPerGas();
      writeContract({
        address: contracts.assetRegistry,
        abi: assetRegistryAbi,
        functionName: "setSettlementConfig",
        args: [
          Math.round(Number(twapWindow)),
          BigInt(Math.round(Number(twapToleranceBps))),
          BigInt(Math.round(Number(swapBackGracePeriod))),
          BigInt(Math.round(Number(bountyRatePerHourBps))),
          BigInt(Math.round(Number(bountyCapBps))),
        ],
        maxFeePerGas: fees.maxFeePerGas * 2n,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
    } catch {
      // writeContract's own error state surfaces below
    }
  }

  return (
    <div>
      <p style={sectionLabelStyle}>Settlement configuration</p>
      <div style={cardStyle}>
        <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 12px" }}>
          All five values are set together, atomically, matching the contract's own design — a deliberate
          statement of settlement policy, not a partial tweak.
        </p>
        <Row2>
          <Field label="TWAP window (seconds)">
            <input value={twapWindow} onChange={(e) => setTwapWindow(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="TWAP tolerance (bps)">
            <input value={twapToleranceBps} onChange={(e) => setTwapToleranceBps(e.target.value)} style={inputStyle} />
          </Field>
        </Row2>
        <Row2>
          <Field label="Swap-back grace period (seconds)">
            <input value={swapBackGracePeriod} onChange={(e) => setSwapBackGracePeriod(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Bounty rate (bps per hour)">
            <input value={bountyRatePerHourBps} onChange={(e) => setBountyRatePerHourBps(e.target.value)} style={inputStyle} />
          </Field>
        </Row2>
        <Field label="Bounty cap (bps)">
          <input value={bountyCapBps} onChange={(e) => setBountyCapBps(e.target.value)} style={inputStyle} />
        </Field>
        <ActionButton
          label="Save settlement configuration"
          primary={allValid}
          disabled={!allValid}
          disabledReason="All five fields must be filled with valid non-negative numbers."
          loading={busy}
          onClick={save}
        />
        {error && <p style={errorTextStyle}>{error.shortMessage || error.message}</p>}
      </div>
    </div>
  );
}

// --- Shared local components/styles ---

/**
 * Renders what the pre-flight found. Pairs with no pool are collapsed to a
 * count — that's the unremarkable case. Pairs where a pool EXISTS but cannot
 * serve the TWAP window are listed individually, because that is the shape
 * that traps vaults: liquidity deep enough to swap in, no history to quote
 * the way back out.
 */
function PreflightReport({ preflight }) {
  if (!preflight.valid) return null;

  if (preflight.isChecking) {
    return <p style={preflightNoteStyle}>Checking pools and TWAP history…</p>;
  }

  if (!preflight.ready) return null;

  if (!preflight.isErc20) {
    return (
      <div style={{ ...preflightBoxStyle, borderColor: "var(--brick)" }}>
        <p style={{ ...preflightNoteStyle, color: "var(--brick)", margin: 0 }}>
          This address does not respond to decimals() — it is not an ERC-20 token.
          Check you have the token contract and not a pool, an aToken, or a wallet.
        </p>
      </div>
    );
  }

  const noPoolCount = preflight.pairs.filter((p) => p.status === "no-pool").length;
  const shown = preflight.pairs.filter((p) => p.status !== "no-pool");

  return (
    <div style={preflightBoxStyle}>
      <p style={{ ...preflightNoteStyle, margin: "0 0 10px" }}>
        Settlement quotes a {preflight.twapWindow ?? "—"}s TWAP against each paired asset.
        Checked {preflight.pairs.length} pair{preflight.pairs.length === 1 ? "" : "s"}.
      </p>

      <Row
        label={`${preflight.symbol || "Token"} · ${preflight.decimals} decimals`}
        value={preflight.alreadyListed ? "already whitelisted" : "valid ERC-20"}
      />

      {!preflight.hasCounterparties && (
        <p style={{ ...preflightNoteStyle, marginTop: 10 }}>
          Nothing else is whitelisted yet, so there is no pair to check. Whitelist
          the counterpart asset and the check will run against it.
        </p>
      )}

      {shown.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--hairline)" }}>
          {shown.map((p) => {
            const ok = p.status === "quotable";
            const hasLiquidity = p.liquidity !== undefined && p.liquidity > 0n;
            return (
              <div key={`${p.counterparty}-${p.fee}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                <span className="mono" style={{ fontSize: 12, color: "var(--parch)" }}>
                  {p.counterpartySymbol} @ {p.feeLabel}
                </span>
                <span style={{ fontSize: 11, color: ok ? "var(--brass)" : "var(--brick)", textAlign: "right" }}>
                  {ok
                    ? `quotable${p.cardinality ? ` · cardinality ${p.cardinality}` : ""}`
                    : `no TWAP history${p.cardinality ? ` · cardinality ${p.cardinality}` : ""}${hasLiquidity ? " · HAS LIQUIDITY" : ""}`}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {noPoolCount > 0 && (
        <p style={{ ...preflightNoteStyle, marginTop: 10, marginBottom: 0 }}>
          {noPoolCount} pair{noPoolCount === 1 ? "" : "s"} with no pool at all — not a
          concern, borrowers simply cannot route there.
        </p>
      )}

      {preflight.trapPairs.length > 0 && (
        <p style={{ fontSize: 11, color: "var(--brick)", margin: "10px 0 0", lineHeight: 1.5 }}>
          {preflight.trapPairs.length} pool{preflight.trapPairs.length === 1 ? " holds" : "s hold"} liquidity
          but cannot be quoted. A swap in would fill; the forced swap-back at settlement
          could not. The vault will refuse these at swap time — this is the guard working,
          not a problem with the asset.
        </p>
      )}
    </div>
  );
}

function AssetSwitcher({ assets, chainId, value, onChange }) {
  if (assets.length === 0) {
    return <p style={{ fontSize: 12, color: "var(--parch-dim)" }}>No whitelisted assets available.</p>;
  }
  return (
    <div style={{ display: "inline-flex", background: "var(--ink)", border: "1px solid var(--hairline)", borderRadius: 8, padding: 3, marginBottom: 12 }}>
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

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ fontSize: 12, color: "var(--parch-dim)" }}>{label}</span>
      <span className="mono" style={{ fontSize: 13, color: "var(--parch)" }}>{value}</span>
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div style={{ background: "var(--panel)", borderRadius: 10, border: "1px solid var(--hairline)", padding: "24px 20px", textAlign: "center" }}>
      <p style={{ fontSize: 13, color: "var(--parch-dim)", margin: 0 }}>{message}</p>
    </div>
  );
}

const sectionLabelStyle = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--parch)",
  margin: "0 0 8px",
};

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

const errorTextStyle = {
  fontSize: 12,
  color: "var(--brick)",
  marginTop: 10,
};

const preflightBoxStyle = {
  background: "var(--ink)",
  border: "1px solid var(--hairline)",
  borderRadius: 8,
  padding: "14px 16px",
  marginBottom: 12,
};

const preflightNoteStyle = {
  fontSize: 11,
  color: "var(--parch-dim)",
  lineHeight: 1.5,
};

const acknowledgeStyle = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  fontSize: 11,
  color: "var(--parch-dim)",
  lineHeight: 1.5,
  marginBottom: 12,
  cursor: "pointer",
};

const smallDangerButtonStyle = {
  background: "transparent",
  color: "var(--brick)",
  border: "1px solid var(--brick)",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
};