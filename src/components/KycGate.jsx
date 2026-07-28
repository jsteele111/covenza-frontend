import { useState } from "react";
import { useAccount, useChainId, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { KYC_REGISTRY_ABI } from "../config/abis.js";
import { getContractsForChain } from "../config/contracts.js";

// abis.js already exports pre-parsed ABIs — do not re-wrap in parseAbi().
const kycAbi = KYC_REGISTRY_ABI;

// URL for the KYC verifier service (netlify/functions/verify.js in production,
// scripts/mock-verify-server.js locally). Set VITE_VERIFIER_SERVICE_URL in .env
// to override — defaults to the local mock server for dev, so local testing
// doesn't accidentally hit the live production function.
const VERIFIER_SERVICE_URL =
  import.meta.env.VITE_VERIFIER_SERVICE_URL || "http://localhost:4000";

export function KycGate({ address }) {
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);
  console.log("DEBUG — chainId:", chainId, "registry:", contracts.kycRegistry);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [status, setStatus] = useState("idle"); // idle | requesting-signature | awaiting-confirmation | error
  const [errorMessage, setErrorMessage] = useState(null);

  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const { data: isVerified, refetch: refetchVerified } = useReadContract({
    address: contracts.kycRegistry,
    abi: kycAbi,
    functionName: "isVerified",
    args: [address],
    query: { enabled: !!address },
  });

  const { data: badgeId } = useReadContract({
    address: contracts.kycRegistry,
    abi: kycAbi,
    functionName: "badgeIdOf",
    args: [address],
    query: { enabled: !!address && !!isVerified },
  });

  async function submit() {
    setErrorMessage(null);
    setStatus("requesting-signature");

    try {
      const response = await fetch(`${VERIFIER_SERVICE_URL}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ borrowerAddress: address }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Verification request failed.");
      }

      setStatus("awaiting-confirmation");

      const fees = await publicClient.estimateFeesPerGas();
      const hash = await writeContractAsync({
        address: contracts.kycRegistry,
        abi: kycAbi,
        functionName: "verifyWithSignature",
        args: [data.borrowerAddress, BigInt(data.expiry), data.signature],
        maxFeePerGas: fees.maxFeePerGas * 2n,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });

      await publicClient.waitForTransactionReceipt({ hash });

      await refetchVerified();
      setStatus("idle");
    } catch (err) {
      setErrorMessage(err.shortMessage || err.message || "Something went wrong.");
      setStatus("error");
    }
  }

  if (isVerified) {
    return (
      <div style={cardStyle}>
        <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 8px" }}>KYC status</p>
        <p style={{ fontSize: 14, color: "var(--brass)", margin: 0 }}>Verified</p>
        <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "8px 0 0" }}>
          This wallet holds a Covenza KYC badge{badgeId ? ` (token #${badgeId.toString()})` : ""} and is
          eligible for vault origination.
        </p>
      </div>
    );
  }

  const busy = status === "requesting-signature" || status === "awaiting-confirmation";

  return (
    <div style={cardStyle}>
      <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 4px" }}>KYC verification required</p>
      <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "0 0 16px" }}>
        This is a simulated intake form — no documents are actually collected or checked. The signed
        verification and on-chain badge that follow are real.
      </p>

      <Field label="Full name">
        <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} disabled={busy} />
      </Field>
      <Field label="Email">
        <input value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} disabled={busy} />
      </Field>
      <Field label="Jurisdiction">
        <input
          value={jurisdiction}
          onChange={(e) => setJurisdiction(e.target.value)}
          style={inputStyle}
          placeholder="e.g. Australia"
          disabled={busy}
        />
      </Field>

      <button
        onClick={submit}
        disabled={!name || !email || busy}
        style={{
          width: "100%",
          background: name && email && !busy ? "var(--brass)" : "transparent",
          color: name && email && !busy ? "var(--ink)" : "var(--parch-dim)",
          border: name && email && !busy ? "none" : "1px solid var(--hairline)",
          borderRadius: 8,
          padding: 11,
          fontSize: 13,
          fontWeight: 500,
          marginTop: 4,
        }}
      >
        {status === "requesting-signature" && "Requesting verification..."}
        {status === "awaiting-confirmation" && "Confirming on-chain..."}
        {(status === "idle" || status === "error") && "Submit for verification"}
      </button>

      {errorMessage && (
        <p style={{ fontSize: 12, color: "var(--brick)", marginTop: 10 }}>{errorMessage}</p>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, color: "var(--parch-dim)", display: "block", marginBottom: 6 }}>{label}</label>
      {children}
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
};