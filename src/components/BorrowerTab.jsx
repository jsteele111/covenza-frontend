import { useAccount } from "wagmi";
import { useEffect } from "react";
import { useLatestVault } from "../hooks/useLatestVault.js";
import { useVaultData } from "../hooks/useVaultData.js";
import { useVaultAction } from "../hooks/useVaultAction.js";
import { VaultStatement } from "./VaultStatement.jsx";
import { ActionButton } from "./ActionButton.jsx";

export function BorrowerTab() {
  const { address, isConnected } = useAccount();
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

  const supplyDisabled = vault.isSettled || !vault.depositPaid || vault.isExpired || vault.vaultBalance === 0n;
  const supplyReason = vault.isSettled
    ? "Vault already settled."
    : !vault.depositPaid
    ? "Pay the deposit before supplying to Aave."
    : vault.isExpired
    ? "Loan deadline has passed."
    : vault.vaultBalance === 0n
    ? "No balance available to supply."
    : null;

  const repayDisabled = vault.isSettled || !vault.depositPaid || vault.isExpired;
  const repayReason = vault.isSettled
    ? "Vault already settled."
    : !vault.depositPaid
    ? "Pay the deposit before repaying."
    : vault.isExpired
    ? "Loan deadline has passed — this loan is in default."
    : null;

  const settleDisabled = vault.isSettled || !vault.isExpired;

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
          onClick={() => call(vault.address, "supplyToAave", [vault.vaultBalance])}
        />
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <ActionButton
          label="Repay loan"
          primary={!repayDisabled}
          disabled={repayDisabled}
          disabledReason={repayReason}
          loading={busy}
          onClick={() => call(vault.address, "repay", [], vault.repaymentDue)}
        />
        {vault.isExpired && !vault.isSettled && (
          <ActionButton
            label="Settle expired loan"
            primary={false}
            disabled={settleDisabled}
            loading={busy}
            onClick={() => call(vault.address, "settleDefault")}
          />
        )}
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
