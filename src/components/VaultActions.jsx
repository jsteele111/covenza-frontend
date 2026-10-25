import { useEffect, useState } from "react";
import { useAccount, useBlock, usePublicClient } from "wagmi";
import { VAULT_ABI } from "../config/abis.js";
import { useVaultAction } from "../hooks/useVaultAction.js";
import { useSwapPreflight } from "../hooks/useSwapPreflight.js";
import { useHeldClaims } from "../hooks/useVaultData.js";
import { formatTokenAmount } from "../utils/format.js";
import { ActionButton } from "./ActionButton.jsx";

/**
 * Everything a lender or borrower can do to a vault after it is funded:
 * settle, settle in kind, cancel an unfunded loan, and claim a payout the
 * token refused.
 *
 * Shared by both views because the contract does not distinguish them as
 * much as the old UI did. Either party may settle after the deadline; only
 * the borrower may close early; only the lender may settle in kind during its
 * first week; anyone may cancel a loan whose deposit was never paid. Before
 * this, the lender view had no actions at all — a lender whose borrower went
 * quiet had to settle from a script.
 *
 * Each button is enabled only when the contract would accept the call, and
 * the settle buttons are dry-run first (eth_call) so a refusal shows the
 * contract's own reason rather than a wallet's "network fee unavailable".
 *
 * Time comes from the latest block, not the browser clock: the contract
 * compares against block.timestamp, and on a local node that has been
 * fast-forwarded the two disagree by days.
 */
export function VaultActions({ vault, role, onDone }) {
  const { address } = useAccount();
  const { data: block } = useBlock({ watch: true });
  const now = block ? Number(block.timestamp) : Math.floor(Date.now() / 1000);

  const settleAction = useVaultAction();
  const inKindAction = useVaultAction();
  const cancelAction = useVaultAction();

  useEffect(() => {
    if (settleAction.isSuccess || inKindAction.isSuccess || cancelAction.isSuccess) {
      onDone?.();
      settleAction.reset();
      inKindAction.reset();
      cancelAction.reset();
    }
  }, [settleAction.isSuccess, inKindAction.isSuccess, cancelAction.isSuccess]);

  if (!vault) return null;

  const deadline = Number(vault.deadline ?? 0);
  const beforeDeadline = now <= deadline;
  const isLender = role === "lender";
  const isBorrower = role === "borrower";

  // --- Settle ---
  //
  // Early close is the borrower's alone and needs the deposit paid. After the
  // deadline either party may settle at any time; keepers wait out the grace
  // period, but that is not this view.
  const canSettleNow =
    !vault.isSettled && vault.depositPaid &&
    (beforeDeadline ? isBorrower : isLender || isBorrower);

  const settleLabel = beforeDeadline ? "Repay & close loan" : "Settle loan";
  const settleReason = vault.isSettled
    ? "Already settled."
    : !vault.depositPaid
    ? (beforeDeadline ? "The deposit has not been paid yet." : "The deposit was never paid — cancel instead.")
    : beforeDeadline && !isBorrower
    ? "Before the deadline only the borrower can close the loan."
    : null;

  // --- In kind ---
  const showInKind = !vault.isSettled && !beforeDeadline && vault.heldAssetCount > 0 && vault.inKindFrom !== undefined;
  const inKindOpen = showInKind && now >= vault.inKindFrom;
  const inKindOpenToAll = showInKind && now >= vault.inKindOpenToAnyoneFrom;
  const canInKind = inKindOpen && (isLender || inKindOpenToAll);

  // --- Cancel ---
  const canCancel = !vault.isSettled && !vault.depositPaid && now > deadline;

  return (
    <div style={cardStyle}>
      <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "0 0 12px" }}>
        {vault.isSettled ? "Settled" : "Settlement"}
      </p>

      {!vault.isSettled && !canCancel && (
        <SettleButton
          vault={vault}
          enabled={canSettleNow}
          label={settleLabel}
          reason={settleReason}
          action={settleAction}
          account={address}
        />
      )}

      {canCancel && (
        <>
          <p style={noteStyle}>
            The deadline passed without the deposit being paid, so the loan never started. Cancelling
            returns the principal to the lender. Anyone may call it.
          </p>
          <ActionButton
            label="Cancel and return principal"
            primary
            loading={cancelAction.isPending || cancelAction.isConfirming}
            onClick={() => cancelAction.call(vault.address, "cancel")}
          />
          <TxError action={cancelAction} />
        </>
      )}

      {showInKind && (
        <InKindPanel
          vault={vault}
          now={now}
          isLender={isLender}
          inKindOpen={inKindOpen}
          inKindOpenToAll={inKindOpenToAll}
          enabled={canInKind}
          action={inKindAction}
          account={address}
        />
      )}

      {vault.isSettled && <Claims vault={vault} wallet={address} onDone={onDone} />}
    </div>
  );
}

function SettleButton({ vault, enabled, label, reason, action, account }) {
  const preflight = useSwapPreflight({
    vaultAddress: vault.address,
    enabled: enabled && Boolean(account),
    functionName: "settle",
    args: [],
  });

  const blocked = preflight.status === "would-revert";
  return (
    <>
      <ActionButton
        label={label}
        primary={enabled && !blocked}
        disabled={!enabled || blocked}
        disabledReason={reason || (blocked ? explainSettleRefusal(preflight.reason) : null)}
        loading={action.isPending || action.isConfirming}
        onClick={() => action.call(vault.address, "settle")}
      />
      {blocked && enabled && vault.heldAssetCount > 0 && (
        <p style={{ ...noteStyle, marginTop: 8 }}>
          Settlement sells every held asset back at no worse than the TWAP less the tolerance, or
          not at all. If a held asset cannot be sold — frozen by its issuer, or a pool too thin — the
          loan can be settled in kind once that opens (shown below after the deadline).
        </p>
      )}
      <TxError action={action} />
    </>
  );
}

function InKindPanel({ vault, now, isLender, inKindOpen, inKindOpenToAll, enabled, action, account }) {
  const preflight = useSwapPreflight({
    vaultAddress: vault.address,
    enabled: enabled && Boolean(account),
    functionName: "settleInKind",
    args: [],
  });
  const blocked = preflight.status === "would-revert";

  const when = (ts) => new Date(ts * 1000).toLocaleString();
  const reason = !inKindOpen
    ? `Opens ${when(vault.inKindFrom)} (in ${formatSpan(vault.inKindFrom - now)}).`
    : !isLender && !inKindOpenToAll
    ? `The lender alone may use this until ${when(vault.inKindOpenToAnyoneFrom)}.`
    : blocked
    ? (/everything sold/i.test(preflight.reason || "")
        ? "Every held asset can be sold right now — use Settle loan instead."
        : preflight.reason)
    : null;

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--hairline)" }}>
      <p style={{ fontSize: 12, color: "var(--parch)", margin: "0 0 6px", fontWeight: 600 }}>Settle in kind</p>
      <p style={noteStyle}>
        The last resort when a held asset cannot be sold. It sells what it can; the lender gets the cash
        first, then each unsold asset at its TWAP value up to what is still owed, and the rest goes to
        the borrower. It draws no insurance and works only if some asset genuinely cannot be sold.
        It opens 7 days after grace ends, to the lender alone for the first{" "}
        {Math.round(vault.inKindLenderPeriod / 86400)} days.
      </p>
      <ActionButton
        label="Settle in kind"
        primary={enabled && !blocked}
        disabled={!enabled || blocked}
        disabledReason={reason}
        loading={action.isPending || action.isConfirming}
        onClick={() => action.call(vault.address, "settleInKind")}
      />
      <TxError action={action} />
    </div>
  );
}

/**
 * Payouts the token refused at settlement (audit M-1). A blacklisted
 * recipient, or a held token frozen by its issuer, does not block anyone
 * else: the amount waits in the vault under owed(token, recipient) until the
 * recipient can receive it.
 */
function Claims({ vault, wallet, onDone }) {
  const publicClient = usePublicClient();
  const [heldTokens, setHeldTokens] = useState([]);

  // In-kind handovers are found from the vault's own events: once settled it
  // no longer lists what it held.
  useEffect(() => {
    if (!vault.settledInKind || !publicClient) return;
    let cancelled = false;
    publicClient
      .getContractEvents({ address: vault.address, abi: VAULT_ABI, eventName: "InKindAllocated", fromBlock: 0n })
      .then((logs) => {
        if (!cancelled) setHeldTokens([...new Set(logs.map((l) => l.args.token))]);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [vault.address, vault.settledInKind, publicClient]);

  const { claims: heldClaims, refetch } = useHeldClaims(vault.address, heldTokens, wallet);
  const claimAction = useVaultAction();

  useEffect(() => {
    if (claimAction.isSuccess) {
      refetch();
      onDone?.();
      claimAction.reset();
    }
  }, [claimAction.isSuccess]);

  const all = [
    ...(vault.owedToMe > 0n
      ? [{ token: vault.asset, symbol: vault.symbol, amount: vault.owedToMe, decimals: vault.decimals }]
      : []),
    ...heldClaims,
  ];

  if (all.length === 0) {
    return (
      <p style={{ ...noteStyle, margin: 0 }}>
        Nothing is waiting to be claimed by this wallet.
      </p>
    );
  }

  return (
    <div>
      <p style={noteStyle}>
        The token would not pay this wallet at settlement — a blacklisted address, or an asset frozen by
        its issuer — so your share is held in the vault for you. It can be claimed once the token lets
        it move; until then the claim is refused and nothing is lost.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {all.map((c) => (
          <div key={c.token} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <span className="mono" style={{ fontSize: 13, color: "var(--parch)" }}>
              {formatTokenAmount(c.amount, c.decimals)} {c.symbol}
            </span>
            <ActionButton
              label={`Claim ${c.symbol}`}
              primary
              loading={claimAction.isPending || claimAction.isConfirming}
              onClick={() => claimAction.call(vault.address, "claim", [c.token])}
            />
          </div>
        ))}
      </div>
      <TxError action={claimAction} />
    </div>
  );
}

function TxError({ action }) {
  if (action.error) {
    return <p style={errorStyle}>{action.error.shortMessage || action.error.message}</p>;
  }
  if (action.reverted) {
    return <p style={errorStyle}>The transaction was mined but reverted — nothing changed.</p>;
  }
  return null;
}

/** The contract's reasons, said in terms of what the reader can do. */
function explainSettleRefusal(reason) {
  if (/Grace period: only lender or borrower/i.test(reason || "")) return "Only the lender or borrower may settle during grace.";
  if (/Chain recovering from an outage/i.test(reason || "")) return "The chain had an outage; keepers wait out the recovery period.";
  if (/Received less than minimum|Too little received/i.test(reason || "")) {
    return "A held asset cannot be sold within the TWAP tolerance right now.";
  }
  if (/Cannot close early at a loss/i.test(reason || "")) return "Closing early needs the vault to cover principal and interest; it does not right now.";
  return reason;
}

function formatSpan(seconds) {
  if (seconds <= 0) return "now";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(m, 1)}m`;
}

const cardStyle = {
  background: "var(--panel)",
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  padding: "18px 20px",
};

const noteStyle = { fontSize: 12, color: "var(--parch-dim)", margin: "0 0 12px", lineHeight: 1.5 };
const errorStyle = { fontSize: 12, color: "var(--brick)", marginTop: 10 };
