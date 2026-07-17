import { useAccount, useChainId, useReadContract } from "wagmi";
import { useEffect } from "react";
import { parseAbi } from "viem";
import { KYC_REGISTRY_ABI } from "../config/abis.js";
import { getContractsForChain } from "../config/contracts.js";
import { useLatestVault } from "../hooks/useLatestVault.js";
import { useVaultData } from "../hooks/useVaultData.js";
import { useVaultAction } from "../hooks/useVaultAction.js";
import { VaultStatement } from "./VaultStatement.jsx";
import { ActionButton } from "./ActionButton.jsx";
import { KycGate } from "./KycGate.jsx";

const kycAbi = parseAbi(KYC_REGISTRY_ABI);

export function BorrowerTab() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);

  const { data: isVerified, error: kycError } = useReadContract({
    address: contracts.kycRegistry,
    abi: kycAbi,
    functionName: "isVerified",
    args: [address],
    query: { enabled: Boolean(address), refetchInterval: 8000 },
  });

  const { latestVaultAddress, refetch: refetchVaultList } = useLatestVault(address, "borrower");
  const { vault, refetch: refetchVaultData } = useVaultData(latestVaultAddress);
  const { call, isPending, isConfirming, isSuccess, error, reset } = useVaultAction();

  useEffect(() => {
    if (isSuccess) {
      refetchVaultData();
      refetchVaultList();
      reset();
    }
  }, [isSuccess]);

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

  const busy = isPending || isConfirming;

  const payDepositDisabled = vault.isSettled || vault.depositPaid || vault.isExpired;
  const payDepositReason = vault.isSettled
    ? "Vault already settled."
    : vault.depositPaid
    ? "Deposit already paid for this vault."
    : vault.isExpired
    ? "Loan deadline has passed."
    : null;

  // Only `principal` may ever be invested — deposit is pure untouched
  // collateral and is never part of what's available to supply to Aave.
  const investableRemaining = vault.principal - vault.investedAmount;

  const supplyDisabled = vault.isSettled || !vault.depositPaid || vault.isExpired || investableRemaining <= 0n;
  const supplyReason = vault.isSettled
    ? "Vault already settled."
    : !vault.depositPaid
    ? "Pay the deposit before supplying to Aave."
    : vault.isExpired
    ? "Loan deadline has passed."
    : investableRemaining <= 0n
    ? "Full principal already invested."
    : null;

  // settle() replaces both the old repay() and settleDefault() — it's the
  // single settlement function for both an early voluntary close (borrower
  // only, before the deadline) and a post-deadline close (callable by
  // anyone, keeper-style). It takes no value: the vault pays out entirely
  // from its own liquidated balance, the borrower never sends funds in.
  const isEarly = !vault.isExpired;
  const settleDisabled = vault.isSettled || (isEarly && !vault.depositPaid);
  const settleReason = vault.isSettled
    ? "Vault already settled."
    : isEarly && !vault.depositPaid
    ? "Pay the deposit before closing the loan."
    : null;
  const settleLabel = isEarly ? "Repay & close loan" : "Settle expired loan";

  return (
    <div>
      <VaultStatement vault={vault} />

      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <ActionButton
          label="Pay deposit"
          primary={!payDepositDisabled}
          disabled={payDepositDisabled}
          disabledReason={payDepositReason}
          loading={busy}
          onClick={() => call(vault.address, "payDeposit", [], vault.requiredDeposit)}
        />
        <ActionButton
          label="Supply to Aave"
          primary={!supplyDisabled && vault.depositPaid}
          disabled={supplyDisabled}
          disabledReason={supplyReason}
          loading={busy}
          onClick={() => call(vault.address, "supplyToAave", [investableRemaining])}
        />
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <ActionButton
          label={settleLabel}
          primary={!settleDisabled}
          disabled={settleDisabled}
          disabledReason={settleReason}
          loading={busy}
          onClick={() => call(vault.address, "settle")}
        />
      </div>

      {error && (
        <p style={{ fontSize: 12, color: "var(--brick)", marginTop: 12 }}>
          {error.shortMessage || error.message}
        </p>
      )}
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
