import { useState, useEffect, useCallback } from "react";
import { useAccount, useChainId, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from "wagmi";
import { parseAbi, parseAbiItem } from "viem";
import { KYC_REGISTRY_ABI } from "../config/abis.js";
import { getContractsForChain } from "../config/contracts.js";
import { shortAddress, formatEth } from "../utils/format.js";
import { useSettledVaultsWithLoss } from "../hooks/useSettledVaultsWithLoss.js";

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
  }, [isSuccess, loadVerifiedAddresses, refetchLossy]);

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* --- Loss history: visibility layer for manual revocation review --- */}
      <div>
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
                    {isLenderImpacted ? "Lender-impacted" : "Borrower-only"}
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
                <Row label="Principal" value={formatEth(v.principal)} />
                <Row label="Total returned at settlement" value={formatEth(v.settledTotalReturned)} />
                <Row label="Lender received" value={formatEth(v.settledLenderPayout)} />
                <Row label="Borrower received" value={formatEth(v.settledBorrowerPayout)} />
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
      </div>

      {(error || revokeError) && (
        <p style={{ fontSize: 12, color: "var(--brick)" }}>{error?.shortMessage || error?.message || revokeError}</p>
      )}
    </div>
  );
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

const cardStyle = {
  background: "var(--panel)",
  borderRadius: 10,
  border: "1px solid var(--hairline)",
  padding: "18px 20px",
};
