import { useState, useEffect, useMemo, useCallback } from "react";
import { useAccount, useChainId, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from "wagmi";
import { parseAbiItem, parseUnits, isAddress, keccak256, encodeAbiParameters, encodeFunctionData } from "viem";
import {
  KYC_REGISTRY_ABI, ASSET_REGISTRY_ABI, INSURANCE_POOL_ABI, ERC20_ABI,
  UNISWAP_V3_FACTORY_ABI, UNISWAP_V3_POOL_ABI,
} from "../config/abis.js";
import { getContractsForChain, isPlaceholder, symbolForToken, ZERO_ADDRESS } from "../config/contracts.js";
import { shortAddress, formatTokenAmount } from "../utils/format.js";
import { useSettledVaultsWithLoss } from "../hooks/useSettledVaultsWithLoss.js";
import { useAssetPreflight } from "../hooks/useAssetPreflight.js";
import { useAttesters } from "../hooks/useAttesters.js";
import { TIER_LABELS } from "../hooks/useVaultData.js";
import { ActionButton } from "./ActionButton.jsx";
import { useChainNow } from "../hooks/useChainNow.js";

// abis.js already exports pre-parsed ABIs — do not re-wrap in parseAbi().
const kycAbi = KYC_REGISTRY_ABI;
const assetRegistryAbi = ASSET_REGISTRY_ABI;
const insurancePoolAbi = INSURANCE_POOL_ABI;
const erc20Abi = ERC20_ABI;

// Uniswap V3 fee tiers an approved pool may use.
const FEE_TIERS = [
  { label: "0.05%", value: 500 },
  { label: "0.3%", value: 3000 },
  { label: "1%", value: 10000 },
];
const FEE_LABELS = { 100: "0.01%", 500: "0.05%", 3000: "0.3%", 10000: "1%" };

// Colour carries the ordering so risk reads at a glance rather than needing
// the label parsed. Labels themselves come from useVaultData, which is the
// single place AssetRegistry.RiskTier is mirrored.
const TIER_COLOURS = { 0: "var(--sage)", 1: "var(--slate)", 2: "var(--brick)" };

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
 *
 * October 2026 — brought up to the contracts frozen for audit:
 *   - Yield venues are gone (E-1); an asset is listed with addAssetWithTier
 *     (asset, grace extension, tier).
 *   - ApprovedPoolPanel names the one Uniswap pool vaults must use for each
 *     pair (KRAIT-003, item 20), and checks the pool keeps more price-history
 *     slots than the TWAP window has seconds before offering it (KRAIT-004).
 *   - Changes that open vaults read at settlement are timelocked (item 12):
 *     settlement config, the draw cap, the reserve share, changing an
 *     approved pool, and administrative withdrawal. Each is announced by the
 *     hash of its exact calldata and executed after the delay, through
 *     TimelockedCall, which shows the pending state rather than hiding it.
 *   - The loss history lists in-kind settlements (severity 3) separately: the
 *     lender received assets, so the cash figures are not a loss measure.
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
    if (isPlaceholder(contracts.kycRegistry)) {
      setVerifiedAddresses([]);
      setLoading(false);
      return;
    }
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
    return <EmptyState message="Connect a wallet to view protocol configuration. Changing it requires the operator role." />;
  }

  // Everything this view READS is public on chain. Only the writes need the
  // role, so only the writes are gated.
  //
  // This used to return an EmptyState here and render nothing else. Combined
  // with the route guard, it meant that once the operator role moved to a Safe
  // the page became unreachable by anyone: the Safe holds the role and cannot
  // browse, the deploying key can browse and no longer holds it. Refusing to
  // display public information to everyone is not a security property.
  const isOperator =
    operatorAddress && address &&
    operatorAddress.toLowerCase() === address.toLowerCase();

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

      {!isOperator && <NotTheOperatorNotice operatorAddress={operatorAddress} connected={address} />}

      {/* A disabled fieldset disables every control inside it, which is what we
          want: sixteen write actions, one guard, and no chance of missing one
          as the panel grows. Reads render normally. */}
      <fieldset
        disabled={!isOperator}
        style={{
          border: "none", padding: 0, margin: 0, minWidth: 0,
          display: "flex", flexDirection: "column", gap: 24,
          // Verified disabled in the DOM, but they did not LOOK it — a red
          // "Revoke" rendered at full strength is exactly what someone clicks.
          // A control that silently ignores you is worse than one that says no.
          opacity: isOperator ? 1 : 0.45,
        }}
      >

      {/* --- Loss history: visibility layer for manual revocation review --- */}
      <div>
        <p style={sectionLabelStyle}>Settlement loss history</p>
        <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "0 0 4px" }}>
          Settled vaults with a loss, and vaults settled in kind — revocation is never automatic;
          review each case and decide whether it warrants pulling the borrower's verification.
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
          const isInKind = v.severity === 3;
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
                    {isLenderImpacted ? "Lender-impacted" : isInKind ? "Settled in kind" : "Borrower-only"} — {v.symbol}
                  </span>
                  <p className="mono" style={{ fontSize: 12, color: "var(--parch)", margin: "8px 0 0" }}>
                    {shortAddress(v.address)}
                  </p>
                  <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "2px 0 0" }}>
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
                {!isInKind && <LossLines v={v} amount={amount} />}
                {isInKind && (
                  <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "4px 0 0", lineHeight: 1.5 }}>
                    Cash only. The vault could not sell every held asset, so the lender also received
                    assets at their TWAP value. Not by itself evidence of a loss — check whether the
                    asset was frozen or its pool drained before judging the borrower.
                  </p>
                )}
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
                {busyFor(v.borrower) ? "Confirming..." : "Revoke borrower's verification"}
              </button>
            </div>
          );
        })}
      </div>

      {/* --- Existing verified-address list and manual revoke --- */}
      <div>
        <p style={sectionLabelStyle}>Verified addresses</p>
        <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "0 0 4px" }}>
          Wallets are admitted by a recognised provider's attestation, which now expires on its own
          (at most 365 days). Revoke here for any other reason — a sanctions match, a failed
          re-screening — and it takes effect immediately for borrowing and lending alike.
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
          <ApprovedPoolPanel />
          {/* Sits beside the asset whitelist because it is the same class of
              decision: both admit something to the protocol on the operator's
              judgement alone. Recognising an attester is arguably the heavier
              of the two — a listed asset can lose money, a listed attester can
              admit anyone. */}
          <AttesterPanel />
          <InsurancePoolPanel />
          <SettlementConfigPanel />
        </>
      ) : (
        <div>
          <p style={sectionLabelStyle}>Protocol governance</p>
          <EmptyState message="The asset registry and insurance pool haven't been deployed on this network yet — whitelist, pool, insurance and settlement-config controls will appear here once their addresses are filled in after a deploy." />
        </div>
      )}
      </fieldset>
    </div>
  );
}

/**
 * How much was actually lost, so an operator deciding on revocation is not
 * left subtracting in their head. A few thousandths lost to pool fees on a
 * round trip and a deposit wiped out are both "borrower-only loss"; they are
 * not the same case.
 *
 * Position loss: principal + deposit put in, less everything the vault
 * returned. Lender shortfall: principal + interest owed, less what the lender
 * received (lender-impacted cases only).
 */
function LossLines({ v, amount }) {
  const putIn = (v.principal ?? 0n) + (v.deposit ?? 0n);
  const returned = v.settledTotalReturned ?? 0n;
  const loss = putIn > returned ? putIn - returned : 0n;
  const pctOfDeposit = v.deposit > 0n ? Number((loss * 10000n) / v.deposit) / 100 : null;
  const owed = (v.principal ?? 0n) + (v.settledFee ?? 0n);
  const shortfall = owed > (v.settledLenderPayout ?? 0n) ? owed - v.settledLenderPayout : 0n;
  return (
    <>
      <Row
        label="Loss on the position"
        value={`${amount(loss)}${pctOfDeposit !== null ? ` (${pctOfDeposit.toFixed(2)}% of the deposit)` : ""}`}
      />
      {shortfall > 0n && <Row label="Lender shortfall" value={amount(shortfall)} />}
    </>
  );
}

/**
 * Says who governs, and that this wallet does not.
 *
 * Written after the 5 August review found the operator route unreachable by
 * anyone: the role had moved to a Safe, which holds it but cannot browse, while
 * the deploying key can browse but no longer holds it. Reads are open now, so
 * this explains why the controls are inert rather than leaving them looking
 * broken.
 */
function NotTheOperatorNotice({ operatorAddress, connected }) {
  return (
    <div
      style={{
        border: "1px solid var(--hairline)",
        borderLeft: "3px solid var(--brass)",
        borderRadius: 8,
        padding: "14px 16px",
        background: "var(--panel)",
      }}
    >
      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--parch)", margin: "0 0 6px" }}>
        Viewing only — this wallet does not govern the protocol
      </p>
      <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "0 0 8px", lineHeight: 1.6 }}>
        Everything here is public on chain and readable by anyone. The controls are disabled
        because changing any of it requires the operator role.
      </p>
      <p className="mono" style={{ fontSize: 12, color: "var(--parch-dim)", margin: "0 0 2px" }}>
        operator&nbsp;&nbsp;{operatorAddress || "—"}
      </p>
      <p className="mono" style={{ fontSize: 12, color: "var(--parch-dim)", margin: 0 }}>
        you&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{connected || "not connected"}
      </p>
      <p style={{ fontSize: 12.5, color: "var(--slate)", margin: "10px 0 0", lineHeight: 1.6 }}>
        If the operator is a multisig it cannot browse this page directly. Connect it as a wallet
        through WalletConnect, or make the change from a script — either way the transaction goes
        to the multisig for signing.
      </p>
    </div>
  );
}

/** Whole units, largest first — "2d 4h" reads faster than 187200 seconds. */
function formatDuration(seconds) {
  if (seconds <= 0) return "now";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

// --- Recognised identity providers ---

/**
 * Curates the keys whose KYC attestations the registry will accept.
 *
 * Covenza performs no identity check itself, so this list is the entirety of
 * the control: the contract verifies only that a signature came from a key
 * here, never that a real check happened behind it. Worth stating on screen
 * rather than leaving to be inferred, because the panel otherwise looks like
 * routine configuration.
 */
function AttesterPanel() {
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);
  const publicClient = usePublicClient();

  const { all, legacy, isLoading } = useAttesters();

  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(null);

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { data: receipt } = useWaitForTransactionReceipt({ hash });

  // Cleared only on the EXECUTE leg. After queueing, the fields stay filled —
  // executing needs the identical arguments, and making the operator retype
  // them from memory a day later is how the wrong provider gets recognised.
  useEffect(() => {
    if (receipt?.status === "success") {
      if (pending === "add") { setKey(""); setName(""); setUrl(""); }
      setPending(null);
      reset();
    }
  }, [receipt]);

  // The queue id must match the contract's, which hashes a tag alongside the
  // arguments so an approval cannot be replayed against a different action.
  const pendingId = useMemo(() => {
    if (!isAddress(key)) return null;
    return keccak256(encodeAbiParameters(
      [{ type: "string" }, { type: "address" }, { type: "string" }, { type: "string" }],
      ["addAttester", key, name, url]
    ));
  }, [key, name, url]);

  const { data: queuedTs, refetch: refetchQueued } = useReadContract({
    address: contracts.kycRegistry,
    abi: KYC_REGISTRY_ABI,
    functionName: "queuedAt",
    args: [pendingId ?? "0x".padEnd(66, "0")],
    query: { enabled: Boolean(pendingId), refetchInterval: 10000 },
  });

  const { data: secondsLeft } = useReadContract({
    address: contracts.kycRegistry,
    abi: KYC_REGISTRY_ABI,
    functionName: "timeUntilExecutable",
    args: [pendingId ?? "0x".padEnd(66, "0")],
    query: { enabled: Boolean(pendingId) && Number(queuedTs ?? 0) > 0, refetchInterval: 5000 },
  });

  const { data: delay } = useReadContract({
    address: contracts.kycRegistry,
    abi: KYC_REGISTRY_ABI,
    functionName: "timelockDelay",
    query: { enabled: !legacy },
  });

  useEffect(() => { if (receipt?.status === "success") refetchQueued(); }, [receipt]);

  const isQueued = Number(queuedTs ?? 0) > 0;
  const isMature = isQueued && Number(secondsLeft ?? 0) === 0;

  async function send(functionName, args, label) {
    setPending(label);
    try {
      const fees = await publicClient.estimateFeesPerGas();
      writeContract({
        address: contracts.kycRegistry,
        abi: KYC_REGISTRY_ABI,
        functionName,
        args,
        maxFeePerGas: fees.maxFeePerGas * 2n,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
    } catch {
      setPending(null);
    }
  }

  if (legacy) {
    return (
      <div style={{ marginTop: 28 }}>
        <p style={sectionLabelStyle}>Recognised identity providers</p>
        <EmptyState message="The KYC registry deployed here predates recognised providers — it still trusts a single signing key. Redeploy it to curate a provider list." />
      </div>
    );
  }

  const valid = isAddress(key) && name.trim() && url.trim();
  const busy = isPending || Boolean(pending);

  return (
    <div style={{ marginTop: 28 }}>
      <p style={sectionLabelStyle}>Recognised identity providers</p>
      <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "0 0 12px", lineHeight: 1.6 }}>
        Covenza runs no identity checks. It accepts attestations signed by the keys below, and
        verifies only that the signature came from one of them — never that a check actually
        happened. A recognised key can admit any wallet to the protocol.
      </p>

      <div style={cardStyle}>
        <Row2>
          <Field label="Signing key">
            <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="0x…" className="input" />
          </Field>
          <Field label="Provider name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sumsub" className="input" />
          </Field>
        </Row2>
        <Field label="Where borrowers get verified">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="input" />
        </Field>
        <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "-4px 0 12px", lineHeight: 1.5 }}>
          The URL is stored on chain and shown to unverified borrowers. Recognising a provider and
          telling people where to find them are one decision.
        </p>

        {/* Announce-then-execute. The delay is what makes a hostile addition
            visible before it takes effect, so the pending state is shown
            rather than hidden behind a spinner — a delay nobody can observe
            protects nobody. */}
        {!isQueued && (
          <ActionButton
            label={delay && Number(delay) > 0
              ? `Announce provider — live in ${formatDuration(Number(delay))}`
              : "Announce provider"}
            primary={valid}
            disabled={!valid || busy}
            disabledReason={
              !isAddress(key) ? "Enter a valid signing key."
                : !name.trim() ? "Name it — an unnamed attester cannot be audited."
                : "Give the URL borrowers should be sent to."
            }
            loading={pending === "queue"}
            onClick={() => send("queueAddAttester", [key, name.trim(), url.trim()], "queue")}
          />
        )}

        {isQueued && (
          <div style={{
            border: "1px solid var(--brass)", borderRadius: 8,
            padding: "12px 14px", marginTop: 4,
          }}>
            <p style={{ fontSize: 12, color: "var(--brass)", margin: "0 0 4px", fontWeight: 600 }}>
              {isMature ? "Ready to recognise" : "Announced — waiting"}
            </p>
            <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "0 0 10px", lineHeight: 1.5 }}>
              {isMature
                ? "The delay has elapsed. Executing uses exactly these arguments — changing any field means announcing again."
                : `Executable in ${formatDuration(Number(secondsLeft ?? 0))}. Anyone watching this contract can see it pending, which is the point.`}
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <ActionButton
                label="Recognise provider"
                primary={isMature}
                disabled={!isMature || busy}
                disabledReason="The timelock has not elapsed."
                loading={pending === "add"}
                onClick={() => send("addAttester", [key, name.trim(), url.trim()], "add")}
              />
              <button
                onClick={() => send("cancelAddAttester", [key, name.trim(), url.trim()], "cancel")}
                disabled={busy}
                style={smallDangerButtonStyle}
              >
                Abandon
              </button>
            </div>
          </div>
        )}

        {error && (
          <p style={{ fontSize: 12, color: "var(--brick)", marginTop: 10 }}>
            {error.shortMessage || error.message}
          </p>
        )}
      </div>

      {isLoading && <p style={{ fontSize: 12, color: "var(--parch-dim)", marginTop: 12 }}>Loading…</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        {all.map((a) => (
          <div key={a.key} style={{ ...cardStyle, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 13, color: a.recognised ? "var(--parch)" : "var(--parch-dim)", margin: "0 0 2px" }}>
                {a.name}{" "}
                <span style={{ fontSize: 11, color: a.recognised ? "var(--sage)" : "var(--parch-dim)" }}>
                  {a.recognised ? "recognised" : "delisted"}
                </span>
              </p>
              <p className="mono" style={{ fontSize: 12, color: "var(--parch-dim)", margin: 0 }}>{a.key}</p>
              {a.url && (
                <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "2px 0 0", overflowWrap: "anywhere" }}>{a.url}</p>
              )}
            </div>
            {a.recognised && (
              <button
                onClick={() => send("removeAttester", [a.key], "remove")}
                disabled={busy}
                style={smallDangerButtonStyle}
              >
                Delist
              </button>
            )}
          </div>
        ))}
      </div>

      {all.length > 0 && (
        <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "10px 0 0", lineHeight: 1.5 }}>
          Delisted providers stay listed: the record of who admitted whom is worth more than a tidy
          list. Delisting stops new admissions and leaves existing verifications standing — dropping
          a provider commercially is not the same as doubting every check they ran. Revoke those
          individually under verified addresses above.
        </p>
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
  const [newGraceHours, setNewGraceHours] = useState("0");

  // Defaults to Speculative, matching the registry. An unassessed asset should
  // start at the most constrained tier and be relaxed deliberately — the
  // opposite arrangement made "nobody has looked at this" and "safest" the
  // same state.
  const [newTier, setNewTier] = useState(2);
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

  const { data: tierResults, refetch: refetchTiers } = useReadContracts({
    contracts: addresses.map((addr) => ({
      address: contracts.assetRegistry,
      abi: assetRegistryAbi,
      functionName: "tierOf",
      args: [addr],
    })),
    query: { enabled: addresses.length > 0 },
  });

  const assets = addresses.map((addr, i) => ({
    address: addr,
    symbol: symbolForToken(chainId, addr),
    whitelisted: whitelistResults?.[i]?.result || false,
    tier: tierResults?.[i]?.result != null ? Number(tierResults[i].result) : 0,
  }));

  useEffect(() => {
    if (isSuccess) {
      refetchTotal();
      refetchAddresses();
      refetchWhitelist();
      refetchTiers();
      setNewAsset("");
      setNewGraceHours("0");
      setAcknowledged(false);
      setPendingAsset(null);
      reset();
    }
  }, [isSuccess]);

  const newAssetValid = isAddress(newAsset);
  const busy = isPending || isConfirming;

  // MAX_GRACE_EXTENSION is 14 days.
  const graceValid =
    newGraceHours === "" || (Number.isFinite(Number(newGraceHours)) && Number(newGraceHours) >= 0 && Number(newGraceHours) <= 336);

  // The contract guard is what keeps funds safe; this only decides whether
  // the operator is allowed to proceed without having read the report. The
  // one genuinely hard stop is "not an ERC-20" — that is a wrong address,
  // not a judgement call.
  const needsAcknowledgement =
    preflight.ready && preflight.hasCounterparties && !preflight.anyQuotable;

  const blockedReason =
    !newAssetValid                                ? "Enter a valid asset address."
    : !graceValid                                 ? "Grace extension must be 0–336 hours."
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
        // Lists and tags in one transaction. Plain addAsset would leave the
        // asset at the registry's default — Speculative — until a second
        // transaction moved it, and the tier history would record a tier
        // nobody intended.
        functionName: "addAssetWithTier",
        args: [
          newAsset,
          BigInt(Math.round(Number(newGraceHours || 0) * 3600)),
          newTier,
        ],
        maxFeePerGas: fees.maxFeePerGas * 2n,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
    } catch {
      setPendingAsset(null);
    }
  }

  async function setAssetTier(assetAddress, tier) {
    setPendingAsset(assetAddress);
    try {
      const fees = await publicClient.estimateFeesPerGas();
      writeContract({
        address: contracts.assetRegistry,
        abi: assetRegistryAbi,
        functionName: "setTier",
        args: [assetAddress, tier],
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
            <input value={newAsset} onChange={(e) => onCandidateChange(e.target.value)} className="input" placeholder="0x..." />
          </Field>
          <Field label="Grace extension (hours)">
            <input value={newGraceHours} onChange={(e) => setNewGraceHours(e.target.value)} className="input" placeholder="0" />
          </Field>
        </Row2>

        <p style={{ ...preflightNoteStyle, margin: "0 0 12px" }}>
          The extension only ever lengthens the global swap-back grace, and applies to
          vaults <em>holding</em> this asset. Leave it at zero for anything continuously
          traded; a tokenised equity trades 24/5, so 72 hours covers a weekend. At most 14 days.
          Re-listing a removed asset with a different extension is timelocked, because vaults
          may still hold it.
        </p>

        <Field label="Risk tier">
          <div style={{ display: "inline-flex", background: "var(--ink)", border: "1px solid var(--hairline)", borderRadius: 8, padding: 3 }}>
            {[0, 1, 2].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setNewTier(t)}
                style={{
                  border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer",
                  background: newTier === t ? "var(--brass)" : "transparent",
                  color: newTier === t ? "#1C1C1A" : "var(--parch-dim)",
                  fontWeight: newTier === t ? 600 : 400,
                }}
              >
                {TIER_LABELS[t]}
              </button>
            ))}
          </div>
        </Field>
        <p style={{ ...preflightNoteStyle, margin: "-4px 0 12px" }}>
          Set with the listing, in one transaction. Defaults to Speculative: an asset
          nobody has assessed should start at the most constrained tier and be relaxed
          deliberately. The tier decides the deposit floor, the exposure cap and the
          maximum term, so it is the substance of the listing rather than a label on it.
        </p>

        <PreflightReport preflight={preflight} />

        {preflight.ready && preflight.starvablePairs?.length > 0 && (
          <p style={{ fontSize: 12, color: "var(--brick)", margin: "0 0 12px", lineHeight: 1.5 }}>
            {preflight.starvablePairs.length} quotable pool{preflight.starvablePairs.length === 1 ? " keeps" : "s keep"}{" "}
            too little price history for the {preflight.twapWindow}s window — no more slots than the
            window has seconds — so {preflight.starvablePairs.length === 1 ? "it" : "they"} cannot be
            approved for swaps until grown with the pool's increaseObservationCardinalityNext.
          </p>
        )}

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
                <p className="mono" style={{ fontSize: 12, color: "var(--parch-dim)", margin: "0 0 6px" }}>{shortAddress(a.address)}</p>

                {/* Re-tagging is recorded in the asset's tier history. Vaults
                    check the RISKIEST tier the asset has held since they
                    originated, so tagging an asset riskier closes it to live
                    vaults whose ceiling it now exceeds, while tagging it safer
                    loosens nothing for loans already open — only for new
                    ones. Anyone already holding it can still swap back. */}
                <div style={{ display: "inline-flex", background: "var(--ink)", border: "1px solid var(--hairline)", borderRadius: 6, padding: 2 }}>
                  {[0, 1, 2].map((t) => {
                    const active = a.tier === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        disabled={busy}
                        onClick={() => setAssetTier(a.address, t)}
                        style={{
                          border: "none", borderRadius: 4, padding: "3px 9px", fontSize: 11,
                          cursor: busy ? "default" : "pointer",
                          background: active ? TIER_COLOURS[t] : "transparent",
                          color: active ? "#1C1C1A" : "var(--parch-dim)",
                          fontWeight: active ? 600 : 400,
                        }}
                      >
                        {TIER_LABELS[t]}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    fontSize: 11,
                    color: a.whitelisted ? "var(--sage)" : "var(--parch-dim)",
                    border: `1px solid ${a.whitelisted ? "var(--sage)" : "var(--hairline)"}`,
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

// --- Timelocked changes ---

/**
 * Announce, wait, execute — for one specific call.
 *
 * Every setter that open vaults read at settlement is timelocked (item 12):
 * the operator announces the change by the hash of its exact calldata with
 * queueAction(id), waits timelockDelay, then sends the identical call, which
 * consumes the announcement. Changing any argument changes the hash, so what
 * executes is exactly what was on public view during the delay. An
 * announcement lapses EXECUTION_WINDOW (14 days) after it matures.
 *
 * With a delay of zero (some local deployments) the call goes straight
 * through; `needsTimelock: false` covers setters that are only delayed in
 * one direction, such as naming a pair's FIRST approved pool.
 *
 * @param contract   address of a Timelocked contract
 * @param abi        its ABI
 * @param call       () => ({ functionName, args }), or null while the inputs are
 *                   invalid. A FUNCTION, not the object: React 19's development
 *                   build diffs props for its performance log with
 *                   JSON.stringify, which throws on an array holding a BigInt —
 *                   and once it throws, the input that changed the prop stops
 *                   updating (found click-testing the draw cap, 26 Oct 2026).
 * @param id         optional explicit queue id (admin withdrawal hashes its
 *                   own tagged encoding); default keccak256(calldata)
 * @param queueCall  optional () => ({ functionName, args }) to announce; default queueAction(id)
 * @param cancelCall optional () => ({ functionName, args }) to abandon; default cancelAction(id)
 */
function TimelockedCall({
  contract, abi, call: makeCall, id: explicitId, queueCall: makeQueueCall, cancelCall: makeCancelCall,
  needsTimelock = true, label, invalidReason, onDone,
}) {
  const call = makeCall ? makeCall() : null;
  const queueCall = makeQueueCall ? makeQueueCall() : undefined;
  const cancelCall = makeCancelCall ? makeCancelCall() : undefined;
  const publicClient = usePublicClient();
  const [stage, setStage] = useState(null); // "queue" | "execute" | "cancel"
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { data: receipt, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash });

  // Recomputed each render: encoding a handful of arguments is cheap, and the
  // id must track the inputs exactly.
  let calldata = null;
  if (call) {
    try {
      calldata = encodeFunctionData({ abi, functionName: call.functionName, args: call.args });
    } catch {
      calldata = null;
    }
  }

  const id = explicitId ?? (calldata ? keccak256(calldata) : null);
  const ZERO_ID = "0x".padEnd(66, "0");

  const { data: reads, refetch } = useReadContracts({
    contracts: [
      { address: contract, abi, functionName: "timelockDelay" },
      { address: contract, abi, functionName: "queuedAt", args: [id ?? ZERO_ID] },
      { address: contract, abi, functionName: "timeUntilExecutable", args: [id ?? ZERO_ID] },
      { address: contract, abi, functionName: "executionDeadline", args: [id ?? ZERO_ID] },
    ],
    query: { enabled: Boolean(contract), refetchInterval: 5000 },
  });

  useEffect(() => {
    if (!receipt) return;
    refetch();
    if (receipt.status === "success" && stage === "execute") onDone?.();
    setStage(null);
    reset();
  }, [receipt]);

  const delay = Number(reads?.[0]?.result ?? 0);
  const queuedAt = id ? Number(reads?.[1]?.result ?? 0) : 0;
  const secondsLeft = Number(reads?.[2]?.result ?? 0);
  const deadline = Number(reads?.[3]?.result ?? 0);
  const now = useChainNow(5);

  // Until the timelock reads arrive, the delay is unknown. Defaulting it to
  // zero briefly offered a direct "execute" for a call that needs announcing.
  const loaded = reads !== undefined;
  const direct = loaded && (delay === 0 || !needsTimelock);
  const lapsed = queuedAt > 0 && deadline > 0 && now > deadline;
  const isQueued = queuedAt > 0 && !lapsed;
  const isMature = isQueued && secondsLeft === 0;
  const busy = isPending || isConfirming;

  async function send(stageName, target) {
    setStage(stageName);
    try {
      const fees = await publicClient.estimateFeesPerGas();
      writeContract({
        address: contract,
        abi,
        functionName: target.functionName,
        args: target.args,
        maxFeePerGas: fees.maxFeePerGas * 2n,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
    } catch {
      setStage(null);
    }
  }

  const execute = () => send("execute", call);
  const announce = () => send("queue", queueCall ?? { functionName: "queueAction", args: [id] });
  const abandon = () => send("cancel", cancelCall ?? { functionName: "cancelAction", args: [id] });

  const valid = Boolean(call && id);

  return (
    <div>
      {!loaded ? (
        <ActionButton label="Checking timelock…" disabled />
      ) : direct ? (
        <ActionButton
          label={label}
          primary={valid}
          disabled={!valid || busy}
          disabledReason={invalidReason}
          loading={busy && stage === "execute"}
          onClick={execute}
        />
      ) : !isQueued ? (
        <ActionButton
          label={`Announce — ${label.toLowerCase()} in ${formatDuration(delay)}`}
          primary={valid}
          disabled={!valid || busy}
          disabledReason={invalidReason}
          loading={busy && stage === "queue"}
          onClick={announce}
        />
      ) : (
        <div style={{ border: "1px solid var(--brass)", borderRadius: 8, padding: "12px 14px" }}>
          <p style={{ fontSize: 12, color: "var(--brass)", margin: "0 0 4px", fontWeight: 600 }}>
            {isMature ? "Ready to execute" : "Announced — waiting"}
          </p>
          <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "0 0 10px", lineHeight: 1.5 }}>
            {isMature
              ? `The delay has elapsed. Executing sends exactly these values — change any of them and it must be announced again. Lapses ${new Date(deadline * 1000).toLocaleString()}.`
              : `Executable in ${formatDuration(secondsLeft)}. Anyone watching this contract can see it pending, which is the point.`}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <ActionButton
              label={label}
              primary={isMature}
              disabled={!isMature || busy}
              disabledReason="The timelock has not elapsed."
              loading={busy && stage === "execute"}
              onClick={execute}
            />
            <button onClick={abandon} disabled={busy} style={smallDangerButtonStyle}>
              Abandon
            </button>
          </div>
        </div>
      )}
      {lapsed && (
        <p style={{ fontSize: 12, color: "var(--parch-dim)", marginTop: 8 }}>
          An earlier announcement of exactly this change lapsed unexecuted; announce it again.
        </p>
      )}
      {error && <p style={errorTextStyle}>{error.shortMessage || error.message}</p>}
      {receipt?.status === "reverted" && <p style={errorTextStyle}>Mined but reverted — nothing changed.</p>}
    </div>
  );
}

// --- Approved pools ---

/**
 * Names the one Uniswap pool vaults must use for each pair (KRAIT-003, item
 * 20). Without it a borrower picked the fee tier, and could enter through a
 * deep pool and leave the vault exiting through a thin one they controlled.
 *
 * A pool is offered only if it keeps MORE price-history slots than the TWAP
 * window has seconds (KRAIT-004): otherwise anyone can overwrite the history
 * with one swap a block and leave the TWAP unreadable, which blocks every
 * exit. The registry refuses such a pool too; checking here says why before
 * the operator signs anything.
 *
 * Naming a pair's first pool is instant — nothing can be open in a pair with
 * no approved pool. Changing it is timelocked. An open position keeps the pool
 * it was bought through either way.
 */
function ApprovedPoolPanel() {
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);

  const { data: base } = useReadContracts({
    contracts: [
      { address: contracts.assetRegistry, abi: assetRegistryAbi, functionName: "getWhitelistedAssets" },
      { address: contracts.assetRegistry, abi: assetRegistryAbi, functionName: "uniswapFactory" },
      { address: contracts.assetRegistry, abi: assetRegistryAbi, functionName: "twapWindow" },
    ],
  });
  const assetList = base?.[0]?.result || [];
  const uniFactory = base?.[1]?.result;
  const twapWindow = base?.[2]?.result != null ? Number(base[2].result) : undefined;

  // Every unordered pair of whitelisted assets.
  const pairs = [];
  for (let i = 0; i < assetList.length; i++) {
    for (let j = i + 1; j < assetList.length; j++) pairs.push([assetList[i], assetList[j]]);
  }

  const { data: approved, refetch } = useReadContracts({
    contracts: pairs.map(([a, b]) => ({
      address: contracts.assetRegistry, abi: assetRegistryAbi, functionName: "poolFeeTier", args: [a, b],
    })),
    query: { enabled: pairs.length > 0 },
  });

  return (
    <div>
      <p style={sectionLabelStyle}>Approved pools</p>
      <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "0 0 10px", lineHeight: 1.5 }}>
        The protocol, not the borrower, names the pool each pair trades through. A pair with no
        approved pool cannot be swapped. A pool qualifies only if it keeps more price-history slots
        than the {twapWindow ?? "—"}s TWAP window has seconds.
      </p>
      {pairs.length === 0 && <EmptyState message="Whitelist at least two assets to approve a pool between them." />}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {pairs.map(([a, b], i) => (
          <PoolPairRow
            key={`${a}-${b}`}
            tokenA={a}
            tokenB={b}
            current={approved?.[i]?.result != null ? Number(approved[i].result) : undefined}
            uniFactory={uniFactory}
            twapWindow={twapWindow}
            onDone={refetch}
          />
        ))}
      </div>
    </div>
  );
}

function PoolPairRow({ tokenA, tokenB, current, uniFactory, twapWindow, onDone }) {
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);
  const [fee, setFee] = useState(null);
  // Nothing is pre-selected for a pair with no approved pool. Pre-selecting
  // 0.3% highlighted it in brass, which read as "approved" (found
  // click-testing tWETH/tAAPL, where no pool exists at any tier).
  const chosen = fee ?? (current || null);

  // Pool address and history depth at every tier, so the operator sees which
  // tiers qualify before choosing one.
  const { data: poolResults } = useReadContracts({
    contracts: FEE_TIERS.map((t) => ({
      address: uniFactory, abi: UNISWAP_V3_FACTORY_ABI, functionName: "getPool", args: [tokenA, tokenB, t.value],
    })),
    query: { enabled: Boolean(uniFactory) },
  });
  const pools = FEE_TIERS.map((t, i) => {
    const addr = poolResults?.[i]?.result;
    return { fee: t.value, pool: addr && addr !== ZERO_ADDRESS ? addr : null };
  });

  const { data: slotResults } = useReadContracts({
    contracts: pools.filter((p) => p.pool).map((p) => ({
      address: p.pool, abi: UNISWAP_V3_POOL_ABI, functionName: "slot0",
    })),
    query: { enabled: pools.some((p) => p.pool), refetchInterval: 15000 },
  });
  let k = 0;
  const tiers = pools.map((p) => {
    if (!p.pool) return { ...p, cardinality: undefined, qualifies: false };
    const slot = slotResults?.[k++]?.result;
    const cardinality = slot ? Number(slot[3]) : undefined;
    return {
      ...p,
      cardinality,
      qualifies: cardinality !== undefined && twapWindow !== undefined && cardinality > twapWindow,
    };
  });

  const sel = tiers.find((t) => t.fee === chosen);
  const poolsRead = poolResults !== undefined;
  const noPoolAnywhere = poolsRead && tiers.every((t) => !t.pool);
  const unchanged = current === chosen;
  const invalidReason = chosen === null
    ? "Choose the fee tier of the pool to approve."
    : unchanged
    ? "This is already the approved pool."
    : !sel?.pool
    ? "No pool exists at this fee tier."
    : sel.cardinality === undefined
    ? "Reading the pool…"
    : !sel.qualifies
    ? `This pool keeps ${sel.cardinality} history slots; it needs more than ${twapWindow}. Grow it with increaseObservationCardinalityNext first.`
    : undefined;
  const call = invalidReason ? null : { functionName: "setPoolFeeTier", args: [tokenA, tokenB, chosen] };

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10, gap: 12 }}>
        <span className="mono" style={{ fontSize: 13, color: "var(--parch)" }}>
          {symbolForToken(chainId, tokenA)} / {symbolForToken(chainId, tokenB)}
        </span>
        <span style={{ fontSize: 11, color: current ? "var(--sage)" : "var(--parch-dim)" }}>
          {current === undefined ? "—" : current ? `approved: ${FEE_LABELS[current] || current}` : "no approved pool"}
        </span>
      </div>
      {noPoolAnywhere ? (
        <p className="note" style={{ margin: 0 }}>
          No Uniswap pool exists for this pair at any fee tier, so there is nothing to approve. A pool has
          to be created (and grown to keep more than {twapWindow ?? "—"} history slots) before this pair
          can be traded.
        </p>
      ) : (
      <>
      <div style={{ display: "inline-flex", background: "var(--ink)", border: "1px solid var(--hairline)", borderRadius: 8, padding: 3, marginBottom: 8 }}>
        {tiers.map((t) => {
          const active = chosen === t.fee;
          return (
            <button
              key={t.fee}
              type="button"
              onClick={() => setFee(t.fee)}
              style={{
                border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer",
                background: active ? "var(--brass)" : "transparent",
                color: active ? "#1C1C1A" : t.qualifies ? "var(--parch)" : "var(--parch-dim)",
                fontWeight: active ? 600 : 400,
                textDecoration: t.pool ? "none" : "line-through",
              }}
            >
              {FEE_LABELS[t.fee]}
            </button>
          );
        })}
      </div>
      <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "0 0 10px" }}>
        {tiers.map((t) => (
          <span key={t.fee} style={{ marginRight: 12 }}>
            {FEE_LABELS[t.fee]}:{" "}
            {!t.pool ? "no pool" : t.cardinality === undefined ? "…" : (
              <span style={{ color: t.qualifies ? "var(--sage)" : "var(--brick)" }}>
                {t.cardinality} slots
              </span>
            )}
          </span>
        ))}
      </p>
      <TimelockedCall
        contract={contracts.assetRegistry}
        abi={assetRegistryAbi}
        call={call ? () => call : null}
        needsTimelock={Boolean(current)}
        label={current ? "Change approved pool" : "Approve pool"}
        invalidReason={invalidReason}
        onDone={() => { setFee(null); onDone(); }}
      />
      </>
      )}
      {Boolean(current) && (
        <p style={{ fontSize: 12, color: "var(--slate)", margin: "8px 0 0", lineHeight: 1.5 }}>
          Changing it applies to new positions only; a vault already holding the asset keeps the pool it
          bought through.
        </p>
      )}
    </div>
  );
}

// --- Insurance pool: reserves, draw limits, administrative withdrawal ---

function InsurancePoolPanel() {
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);

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

  const { data: limits, refetch: refetchLimits } = useReadContracts({
    contracts: [
      { address: contracts.insurancePool, abi: insurancePoolAbi, functionName: "drawCapBps" },
      { address: contracts.insurancePool, abi: insurancePoolAbi, functionName: "maxDrawShareBps" },
    ],
  });
  const drawCapBps = limits?.[0]?.result;
  const maxDrawShareBps = limits?.[1]?.result;

  const reserves = assetList.map((a, i) => ({
    address: a,
    symbol: symbolForToken(chainId, a),
    reserve: reserveResults?.[i * 2]?.result,
    decimals: reserveResults?.[i * 2 + 1]?.result,
  }));

  const [newDrawCap, setNewDrawCap] = useState("");
  const [newDrawShare, setNewDrawShare] = useState("");
  const [withdrawAsset, setWithdrawAsset] = useState("");
  const [withdrawTo, setWithdrawTo] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");

  useEffect(() => {
    if (!withdrawAsset && assetList.length > 0) setWithdrawAsset(assetList[0]);
  }, [assetList, withdrawAsset]);

  const { data: withdrawAssetDecimals } = useReadContract({
    address: withdrawAsset,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: Boolean(withdrawAsset) },
  });

  const bpsValid = (v) => v !== "" && Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) <= 10000;

  const parsedWithdrawAmount = tryParseUnits(withdrawAmount, withdrawAssetDecimals);
  const withdrawValid = Boolean(withdrawAsset) && isAddress(withdrawTo) && parsedWithdrawAmount !== undefined;
  const withdrawArgs = withdrawValid ? [withdrawAsset, withdrawTo, parsedWithdrawAmount] : null;

  // adminWithdraw has its own queue: the id binds asset, recipient and amount
  // under a tag, so an approval cannot be repurposed (InsurancePool._withdrawId).
  const withdrawId = withdrawArgs
    ? keccak256(encodeAbiParameters(
        [{ type: "string" }, { type: "address" }, { type: "address" }, { type: "uint256" }],
        ["adminWithdraw", ...withdrawArgs]
      ))
    : undefined;

  const refresh = () => { refetchReserves(); refetchLimits(); };

  return (
    <div>
      <p style={sectionLabelStyle}>Insurance pool</p>
      <div style={cardStyle}>
        <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "0 0 12px", lineHeight: 1.5 }}>
          A settlement draws the lesser of{" "}
          <strong>{drawCapBps != null ? `${Number(drawCapBps) / 100}%` : "—"} of the loan's principal</strong> and{" "}
          <strong>{maxDrawShareBps != null ? `${Number(maxDrawShareBps) / 100}%` : "—"} of the asset's reserve</strong>.
          The second keeps one loss from emptying the pool for every lender behind it (item 8). Both
          changes are timelocked in either direction.
        </p>
        {reserves.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid var(--hairline)" }}>
            {reserves.map((r) => (
              <Row key={r.address} label={r.symbol} value={`${formatTokenAmount(r.reserve, r.decimals)} ${r.symbol}`} />
            ))}
          </div>
        )}

        <Field label="New draw cap (bps of principal, e.g. 1000 = 10%)">
          <input value={newDrawCap} onChange={(e) => setNewDrawCap(e.target.value)} className="input" placeholder="1000" />
        </Field>
        <TimelockedCall
          contract={contracts.insurancePool}
          abi={insurancePoolAbi}
          call={bpsValid(newDrawCap) ? () => ({ functionName: "setDrawCapBps", args: [BigInt(newDrawCap)] }) : null}
          label="Update draw cap"
          invalidReason="Enter a whole number from 1 to 10000 bps."
          onDone={() => { setNewDrawCap(""); refresh(); }}
        />

        <div style={{ height: 14 }} />
        <Field label="New reserve share per draw (bps of reserve, e.g. 500 = 5%)">
          <input value={newDrawShare} onChange={(e) => setNewDrawShare(e.target.value)} className="input" placeholder="500" />
        </Field>
        <TimelockedCall
          contract={contracts.insurancePool}
          abi={insurancePoolAbi}
          call={bpsValid(newDrawShare) ? () => ({ functionName: "setMaxDrawShareBps", args: [BigInt(newDrawShare)] }) : null}
          label="Update reserve share"
          invalidReason="Enter a whole number from 1 to 10000 bps."
          onDone={() => { setNewDrawShare(""); refresh(); }}
        />
      </div>

      <div style={{ ...cardStyle, marginTop: 12 }}>
        <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "0 0 12px", lineHeight: 1.5 }}>
          Administrative withdrawal — always timelocked. The announcement binds asset, recipient and
          amount together, and the amount is checked against the reserve again at execution, since
          settlements may draw it down while the withdrawal waits.
        </p>
        <Field label="Asset">
          <AssetSwitcher assets={assetList} chainId={chainId} value={withdrawAsset} onChange={setWithdrawAsset} />
        </Field>
        <Row2>
          <Field label="Recipient address">
            <input value={withdrawTo} onChange={(e) => setWithdrawTo(e.target.value)} className="input" placeholder="0x..." />
          </Field>
          <Field label="Amount">
            <input value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} className="input" placeholder="0.0" />
          </Field>
        </Row2>
        <TimelockedCall
          contract={contracts.insurancePool}
          abi={insurancePoolAbi}
          call={withdrawArgs ? () => ({ functionName: "adminWithdraw", args: withdrawArgs }) : null}
          id={withdrawId}
          queueCall={withdrawArgs ? () => ({ functionName: "queueAdminWithdraw", args: withdrawArgs }) : undefined}
          cancelCall={withdrawArgs ? () => ({ functionName: "cancelAdminWithdraw", args: withdrawArgs }) : undefined}
          label="Withdraw"
          invalidReason="Select an asset, a valid recipient address, and a valid amount."
          onDone={() => { setWithdrawTo(""); setWithdrawAmount(""); refresh(); }}
        />
      </div>
    </div>
  );
}

// --- Settlement configuration (TWAP, grace period, keeper bounty) ---

function SettlementConfigPanel() {
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);

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

  const fields = [twapWindow, twapToleranceBps, swapBackGracePeriod, bountyRatePerHourBps, bountyCapBps];
  const allValid = fields.every((v) => v !== "" && Number.isInteger(Number(v)) && Number(v) >= 0);

  // The contract's bounds (audit L-2), checked here so a refusal is explained
  // before an announcement is spent on it.
  const boundsReason =
    !allValid ? "All five fields must be whole, non-negative numbers."
    : Number(twapWindow) < 60 || Number(twapWindow) > 86400 ? "TWAP window must be 60 seconds to 1 day."
    : Number(twapToleranceBps) < 1 || Number(twapToleranceBps) > 1000 ? "Tolerance must be 1–1000 bps."
    : Number(swapBackGracePeriod) > 7 * 86400 ? "Grace period may be at most 7 days."
    : Number(bountyRatePerHourBps) > 10000 ? "Bounty rate may be at most 10000 bps per hour."
    : Number(bountyCapBps) > 1000 ? "Bounty cap may be at most 1000 bps."
    : null;

  const unchanged = configResults && fields.every((v, i) => configResults[i]?.result?.toString() === v);

  const call = boundsReason || unchanged ? null : {
    functionName: "setSettlementConfig",
    args: [
      Number(twapWindow),
      BigInt(twapToleranceBps),
      BigInt(swapBackGracePeriod),
      BigInt(bountyRatePerHourBps),
      BigInt(bountyCapBps),
    ],
  };

  return (
    <div>
      <p style={sectionLabelStyle}>Settlement configuration</p>
      <div style={cardStyle}>
        <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "0 0 12px", lineHeight: 1.5 }}>
          All five values are set together, atomically — a deliberate statement of settlement policy,
          not a partial tweak. Every change is timelocked, because open vaults read all five at
          settlement and every direction hurts someone. A longer TWAP window also needs every approved
          pool to keep more history slots than the new window has seconds.
        </p>
        <Row2>
          <Field label="TWAP window (seconds)">
            <input value={twapWindow} onChange={(e) => setTwapWindow(e.target.value)} className="input" />
          </Field>
          <Field label="TWAP tolerance (bps)">
            <input value={twapToleranceBps} onChange={(e) => setTwapToleranceBps(e.target.value)} className="input" />
          </Field>
        </Row2>
        <Row2>
          <Field label="Swap-back grace period (seconds)">
            <input value={swapBackGracePeriod} onChange={(e) => setSwapBackGracePeriod(e.target.value)} className="input" />
          </Field>
          <Field label="Bounty rate (bps per hour)">
            <input value={bountyRatePerHourBps} onChange={(e) => setBountyRatePerHourBps(e.target.value)} className="input" />
          </Field>
        </Row2>
        <Field label="Bounty cap (bps)">
          <input value={bountyCapBps} onChange={(e) => setBountyCapBps(e.target.value)} className="input" />
        </Field>
        <TimelockedCall
          contract={contracts.assetRegistry}
          abi={assetRegistryAbi}
          call={call ? () => call : null}
          label="Save settlement configuration"
          invalidReason={boundsReason || "These are the values already in force."}
          onDone={() => { setLoaded(false); refetch(); }}
        />
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
            const hasLiquidity = p.hasLiquidity;
            return (
              <div key={`${p.counterparty}-${p.fee}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                <span className="mono" style={{ fontSize: 12, color: "var(--parch)" }}>
                  {p.counterpartySymbol} @ {p.feeLabel}
                </span>
                <span style={{ fontSize: 11, color: ok ? "var(--sage)" : "var(--brick)", textAlign: "right" }}>
                  {ok
                    ? `quotable${p.cardinality ? ` · cardinality ${p.cardinality}` : ""}`
                    : p.status === "starvable"
                    ? `quotable, but only ${p.cardinality} history slots — cannot be approved`
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
        <p style={{ fontSize: 12, color: "var(--brick)", margin: "10px 0 0", lineHeight: 1.5 }}>
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
  return <div className="row2">{children}</div>;
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
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  padding: "18px 20px",
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
  fontSize: 12,
  color: "var(--parch-dim)",
  lineHeight: 1.5,
};

const acknowledgeStyle = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  fontSize: 12,
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