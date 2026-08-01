import { useState, useEffect } from "react";
import { useAccount, useChainId, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from "wagmi";
import { parseUnits } from "viem";
import { VAULT_FACTORY_ABI, ERC20_ABI } from "../config/abis.js";
import { getContractsForChain } from "../config/contracts.js";
import { formatTokenAmount, shortAddress } from "../utils/format.js";
import { useMandates, previewMandateApr } from "../hooks/useMandates.js";
import { ActionButton } from "./ActionButton.jsx";

const factoryAbi = VAULT_FACTORY_ABI;
const erc20Abi = ERC20_ABI;

const DAY = 86400;

/**
 * The board of live mandates a borrower can fill.
 *
 * Every mandate shows its FILLABLE size — min(allowance, balance, offer) read
 * live — rather than what the lender advertised. A lender's capital never
 * leaves their wallet until a fill, and an allowance can be revoked for free,
 * so a board that displayed the offer would list liquidity that isn't there.
 *
 * The quote updates as the borrower moves term and deposit, because the
 * mandate prices those two axes rather than offering a range. Under a range,
 * the longest term and smallest deposit is what everyone picks; here it is the
 * most expensive combination on the surface.
 */
export function MandateBoard() {
  const { address } = useAccount();
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);
  const publicClient = usePublicClient();

  const { mandates, isLoading, refetch } = useMandates({ onlyLive: true });
  const [selected, setSelected] = useState(null);

  if (isLoading) {
    return <EmptyState message="Loading mandates…" />;
  }

  const fillable = mandates.filter(
    (m) => !m.isTargeted || m.permittedBorrower.toLowerCase() === (address || "").toLowerCase()
  );

  if (fillable.length === 0) {
    return (
      <EmptyState message="No live mandates. A lender publishes terms they will accept; once one exists it appears here and can be filled in a single transaction." />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {fillable.map((m) => (
        <MandateCard
          key={m.id}
          mandate={m}
          expanded={selected === m.id}
          onToggle={() => setSelected(selected === m.id ? null : m.id)}
          contracts={contracts}
          publicClient={publicClient}
          onFilled={refetch}
        />
      ))}
    </div>
  );
}

function MandateCard({ mandate: m, expanded, onToggle, contracts, publicClient, onFilled }) {
  const [principal, setPrincipal] = useState("");
  const [termDays, setTermDays] = useState(String(Math.floor(m.minTermSeconds / DAY) || 1));
  const [depositPct, setDepositPct] = useState(String(m.minDepositBps / 100));
  // "idle" → "approving" → "approved" → "filling". Approve and fill are two
  // transactions over one writeContract, so the receipt handler has to know
  // which one it just watched confirm; a plain boolean would treat the
  // approval receipt as a completed fill.
  const [step, setStep] = useState("idle");

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (!isSuccess) return;
    if (step === "approving") {
      setStep("approved");
    } else if (step === "filling") {
      setStep("idle");
      onFilled();
    }
    reset();
  }, [isSuccess]);

  const approving = step === "approved";

  const parsedPrincipal = tryParse(principal, m.decimals);
  const termSeconds = Math.round(Number(termDays) * DAY);
  const depositBps = Math.round(Number(depositPct) * 100);

  const apr = previewMandateApr(m, termSeconds, depositBps);
  const depositAmount =
    parsedPrincipal !== undefined && Number.isFinite(depositBps)
      ? (parsedPrincipal * BigInt(depositBps)) / 10000n
      : undefined;

  const termValid = termSeconds >= m.minTermSeconds && termSeconds <= m.maxTermSeconds;
  const sizeValid =
    parsedPrincipal !== undefined &&
    parsedPrincipal >= m.minPrincipal &&
    parsedPrincipal <= m.maxPrincipal &&
    parsedPrincipal <= m.fillable;
  const depositValid = depositBps >= m.minDepositBps;

  const reason = !parsedPrincipal
    ? "Enter an amount to borrow."
    : parsedPrincipal > m.fillable
    ? `Only ${formatTokenAmount(m.fillable, m.decimals)} ${m.symbol} is currently fillable.`
    : !sizeValid
    ? "Amount is outside this mandate's bounds."
    : !termValid
    ? "Term is outside this mandate's bounds."
    : !depositValid
    ? `Deposit must be at least ${m.minDepositBps / 100}%.`
    : null;

  async function fill() {
    try {
      const fees = await publicClient.estimateFeesPerGas();

      // Deposit AND premium are pulled by the factory in the fill transaction,
      // so the approval has to cover both. Approving generously here rather
      // than computing the premium client-side — the contract is the authority
      // on it and an under-approval reverts the whole fill.
      const [, premium] = await publicClient.readContract({
        address: contracts.vaultFactory,
        abi: factoryAbi,
        functionName: "quoteFillCost",
        args: [BigInt(m.id), parsedPrincipal, BigInt(termSeconds), true, depositAmount],
      });

      setStep("approving");
      writeContract({
        address: m.asset,
        abi: erc20Abi,
        functionName: "approve",
        args: [contracts.vaultFactory, depositAmount + premium],
        maxFeePerGas: fees.maxFeePerGas * 2n,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
    } catch {
      setStep("idle");
    }
  }

  async function confirmFill() {
    try {
      const fees = await publicClient.estimateFeesPerGas();
      setStep("filling");
      writeContract({
        address: contracts.vaultFactory,
        abi: factoryAbi,
        functionName: "fillMandate",
        args: [BigInt(m.id), parsedPrincipal, BigInt(termSeconds), true, depositAmount],
        maxFeePerGas: fees.maxFeePerGas * 2n,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
    } catch {
      setStep("idle");
    }
  }

  const expiresIn = m.expiry - Math.floor(Date.now() / 1000);

  return (
    <div style={cardStyle}>
      <div
        onClick={onToggle}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
      >
        <div>
          <p style={{ fontSize: 13, color: "var(--parch)", margin: "0 0 4px" }}>
            {formatTokenAmount(m.fillable, m.decimals)} {m.symbol}{" "}
            <span style={{ fontSize: 11, color: "var(--parch-dim)" }}>available now</span>
          </p>
          <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: 0 }}>
            from {shortAddress(m.lender)} · {m.minTermSeconds / DAY}–{m.maxTermSeconds / DAY} days ·
            min deposit {m.minDepositBps / 100}% · up to {m.maxTierLabel}
          </p>
        </div>
        <span style={{ fontSize: 11, color: "var(--brass)", border: "1px solid var(--brass)", borderRadius: 20, padding: "3px 9px" }}>
          from {(m.minAprBps / 100).toFixed(2)}% APR
        </span>
      </div>

      {expanded && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--hairline)" }}>
          <Row2>
            <Field label={`Borrow (${m.symbol})`}>
              <input value={principal} onChange={(e) => setPrincipal(e.target.value)} style={inputStyle} placeholder="0.0" />
            </Field>
            <Field label="Term (days)">
              <input value={termDays} onChange={(e) => setTermDays(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Deposit (%)">
              <input value={depositPct} onChange={(e) => setDepositPct(e.target.value)} style={inputStyle} />
            </Field>
          </Row2>

          {/* Both axes are priced, so there is no corner to hunt for. A longer
              term costs more; a larger deposit costs less. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 5, margin: "4px 0 14px" }}>
            <Line label="Rate at these terms" value={apr != null ? `${(apr / 100).toFixed(2)}% APR` : "—"} emphasis />
            {depositAmount !== undefined && (
              <Line label="Deposit you post" value={`${formatTokenAmount(depositAmount, m.decimals)} ${m.symbol}`} />
            )}
            <Line
              label="Mandate expires"
              value={expiresIn > 0 ? `in ${Math.floor(expiresIn / 3600)}h ${Math.floor((expiresIn % 3600) / 60)}m` : "expired"}
            />
          </div>

          <ActionButton
            label={approving ? "Confirm fill" : "Approve and fill"}
            primary={reason === null}
            disabled={reason !== null}
            disabledReason={reason || ""}
            loading={isPending || isConfirming}
            onClick={approving ? confirmFill : fill}
          />

          <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "10px 0 0", lineHeight: 1.5 }}>
            Filling moves everything in one transaction — the lender's principal, your
            deposit and the insurance premium. Either all of it settles or none of it does.
          </p>

          {error && (
            <p style={{ fontSize: 12, color: "var(--brick)", marginTop: 8 }}>
              {error.shortMessage || error.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function tryParse(v, decimals) {
  if (!v) return undefined;
  try {
    // parseUnits rather than float arithmetic: Math.round(x * 1e18) loses
    // precision above ~2^53 and silently rounds a user's exact figure.
    const parsed = parseUnits(v, decimals ?? 18);
    return parsed > 0n ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function Line({ label, value, emphasis }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
      <span style={{ fontSize: 11, color: "var(--parch-dim)" }}>{label}</span>
      <span className="mono" style={{
        fontSize: emphasis ? 13 : 12,
        color: emphasis ? "var(--brass)" : "var(--parch-dim)",
        fontWeight: emphasis ? 600 : 400,
      }}>
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
  return <div style={{ display: "flex", gap: 12 }}>{children}</div>;
}

function EmptyState({ message }) {
  return (
    <div style={{ background: "var(--panel)", borderRadius: 10, border: "1px solid var(--hairline)", padding: "24px 20px", textAlign: "center" }}>
      <p style={{ fontSize: 13, color: "var(--parch-dim)", margin: 0, lineHeight: 1.6 }}>{message}</p>
    </div>
  );
}

const cardStyle = {
  background: "var(--panel)",
  borderRadius: 10,
  border: "1px solid var(--hairline)",
  padding: "16px 18px",
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
