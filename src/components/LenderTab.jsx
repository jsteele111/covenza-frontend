import { useState, useEffect } from "react";
import { useAccount, useChainId, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from "wagmi";
import { parseAbi, parseEther, isAddress } from "viem";
import { KYC_REGISTRY_ABI, VAULT_FACTORY_ABI } from "../config/abis.js";
import { getContractsForChain } from "../config/contracts.js";
import { useLatestVault } from "../hooks/useLatestVault.js";
import { useVaultData } from "../hooks/useVaultData.js";
import { VaultStatement } from "./VaultStatement.jsx";
import { ActionButton } from "./ActionButton.jsx";

const kycAbi = parseAbi(KYC_REGISTRY_ABI);
const factoryAbi = parseAbi(VAULT_FACTORY_ABI);

export function LenderTab() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);

  const [borrower, setBorrower] = useState("");
  const [principal, setPrincipal] = useState("0.001");
  const [feeRatePercent, setFeeRatePercent] = useState("3"); // e.g. "3" = 3%, charged in full regardless of early or on-time close
  const [depositRequired, setDepositRequired] = useState("0.00015");
  const [durationValue, setDurationValue] = useState("7");
  const [shortMode, setShortMode] = useState(false);

  const borrowerIsValidAddress = isAddress(borrower);

  const { data: isVerified } = useReadContract({
    address: contracts.kycRegistry,
    abi: kycAbi,
    functionName: "isVerified",
    args: [borrower],
    query: { enabled: borrowerIsValidAddress },
  });

  const publicClient = usePublicClient();
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const { latestVaultAddress, refetch: refetchVaultList } = useLatestVault(address, "lender");
  const { vault, refetch: refetchVaultData } = useVaultData(latestVaultAddress);

  useEffect(() => {
    if (isSuccess) {
      refetchVaultList();
      refetchVaultData();
    }
  }, [isSuccess]);

  if (!isConnected) {
    return <EmptyState message="Connect the lender wallet to originate a vault." />;
  }

  const feeRateBps = feeRatePercent ? Math.round(parseFloat(feeRatePercent) * 100) : NaN;
  const feeRateValid = Number.isFinite(feeRateBps) && feeRateBps > 0;

  const disabled = !borrowerIsValidAddress || isVerified === false || !feeRateValid;
  const disabledReason = !borrowerIsValidAddress
    ? "Enter a valid borrower address."
    : isVerified === false
    ? "This address is not KYC verified."
    : !feeRateValid
    ? "Enter a valid fee rate greater than zero."
    : null;

  async function originate() {
    const fees = await publicClient.estimateFeesPerGas();

    writeContract({
      address: contracts.vaultFactory,
      abi: factoryAbi,
      functionName: "deployVault",
      args: [
        borrower,
        BigInt(feeRateBps),
        BigInt(durationValue),
        shortMode,
        parseEther(depositRequired),
      ],
      value: parseEther(principal),
      maxFeePerGas: fees.maxFeePerGas * 2n,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
  }

  return (
    <div>
      <div style={cardStyle}>
        <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 16px" }}>Originate a vault</p>

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
          <Field label="Principal (ETH)">
            <input value={principal} onChange={(e) => setPrincipal(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Deposit required (ETH)">
            <input value={depositRequired} onChange={(e) => setDepositRequired(e.target.value)} style={inputStyle} />
          </Field>
        </Row2>

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
        </p>

        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, marginBottom: 16, fontSize: 12, color: "var(--parch-dim)" }}>
          <input type="checkbox" checked={shortMode} onChange={(e) => setShortMode(e.target.checked)} />
          Test mode — treat duration as seconds, not days (for testing settlement quickly)
        </label>

        <div style={{ marginTop: 6 }}>
          <ActionButton
            label="Originate vault"
            primary={!disabled}
            disabled={disabled}
            disabledReason={disabledReason}
            loading={isPending || isConfirming}
            onClick={originate}
          />
        </div>

        {error && (
          <p style={{ fontSize: 12, color: "var(--brick)", marginTop: 12 }}>
            {error.shortMessage || error.message}
          </p>
        )}
      </div>

      {vault && (
        <div style={{ marginTop: 20 }}>
          <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 10px" }}>Your most recent vault</p>
          <VaultStatement vault={vault} />
        </div>
      )}
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
