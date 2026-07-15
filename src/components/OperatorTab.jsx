import { useState, useEffect, useCallback } from "react";
import { useAccount, useChainId, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from "wagmi";
import { parseAbi, parseAbiItem } from "viem";
import { KYC_REGISTRY_ABI } from "../config/abis.js";
import { getContractsForChain } from "../config/contracts.js";
import { shortAddress } from "../utils/format.js";

const kycAbi = parseAbi(KYC_REGISTRY_ABI);
const verifiedEvent = parseAbiItem(
  "event AddressVerified(address indexed wallet, uint256 timestamp, bool viaSignature)"
);

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
      setRevokingAddress(null);
    }
  }, [isSuccess, loadVerifiedAddresses]);

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

  if (loading) {
    return <EmptyState message="Loading verified addresses..." />;
  }

  if (verifiedAddresses.length === 0) {
    return <EmptyState message="No currently verified addresses." />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 4px" }}>
        Verification now happens automatically via signed attestation — this tab is for manual
        revocation only (e.g. post-default, sanctions match, or re-screening failure).
      </p>

      {verifiedAddresses.map((addr) => {
        const busy = (isPending || isConfirming) && revokingAddress?.toLowerCase() === addr.toLowerCase();
        return (
          <div key={addr} style={cardStyle}>
            <p className="mono" style={{ fontSize: 12, color: "var(--parch)", margin: "0 0 12px" }}>
              {shortAddress(addr)}
            </p>
            <button
              onClick={() => revoke(addr)}
              disabled={busy}
              style={{
                width: "100%",
                background: "transparent",
                color: "var(--brick)",
                border: "1px solid var(--brick)",
                borderRadius: 8,
                padding: 10,
                fontSize: 13,
                fontWeight: 500,
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? "Confirming..." : "Revoke"}
            </button>
          </div>
        );
      })}

      {(error || revokeError) && (
        <p style={{ fontSize: 12, color: "var(--brick)" }}>{error?.shortMessage || error?.message || revokeError}</p>
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

const cardStyle = {
  background: "var(--panel)",
  borderRadius: 10,
  border: "1px solid var(--hairline)",
  padding: "18px 20px",
};