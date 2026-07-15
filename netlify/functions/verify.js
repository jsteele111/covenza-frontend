import { ethers } from "ethers";

const KYC_REGISTRY_ADDRESS = "0x5B6C57cA408dD1bbE9cbdeB0cbb6e923E01a584D";

const ABI = [
  "function isVerified(address) view returns (bool)",
  "function nonces(address) view returns (uint256)",
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  try {
    const { borrowerAddress } = await req.json();

    if (!borrowerAddress || !ethers.isAddress(borrowerAddress)) {
      return new Response(
        JSON.stringify({ error: "A valid borrowerAddress is required." }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    const provider = new ethers.JsonRpcProvider(process.env.ARBITRUM_SEPOLIA_RPC_URL);
    const registry = new ethers.Contract(KYC_REGISTRY_ADDRESS, ABI, provider);
    const verifierWallet = new ethers.Wallet(process.env.VERIFIER_PRIVATE_KEY);

    const alreadyVerified = await registry.isVerified(borrowerAddress);
    if (alreadyVerified) {
      return new Response(
        JSON.stringify({ error: "This address is already verified." }),
        { status: 409, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    const nonce = await registry.nonces(borrowerAddress);
    const expiry = Math.floor(Date.now() / 1000) + 60 * 60; // valid for 1 hour

    const structHash = ethers.solidityPackedKeccak256(
      ["address", "uint256", "uint256", "address"],
      [borrowerAddress, expiry, nonce, KYC_REGISTRY_ADDRESS]
    );
    const signature = await verifierWallet.signMessage(ethers.getBytes(structHash));

    return new Response(
      JSON.stringify({
        borrowerAddress,
        expiry,
        nonce: nonce.toString(),
        signature,
        registryAddress: KYC_REGISTRY_ADDRESS,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  } catch (error) {
    console.error(error);
    return new Response(
      JSON.stringify({ error: "Internal error generating attestation." }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  }
};