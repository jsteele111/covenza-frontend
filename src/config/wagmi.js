import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { arbitrumSepolia, hardhat } from "wagmi/chains";
import { http } from "wagmi";
import { defineChain } from "viem";

// Robinhood Chain isn't in wagmi/chains — it's a young Arbitrum Orbit L2, so
// it has to be defined by hand. ETH is the gas token, as on any Orbit chain
// that hasn't chosen a custom one.
export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Explorer",
      url: "https://explorer.testnet.chain.robinhood.com",
    },
  },
  testnet: true,
});

export const robinhoodMainnet = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: "https://robinhoodchain.blockscout.com",
    },
  },
});

// Get a free WalletConnect project ID at https://cloud.reown.com
// (needed for the WalletConnect / mobile-wallet option in the connect
// button — MetaMask browser extension works without it too).
const WALLETCONNECT_PROJECT_ID =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "";

// Optional: point at your own Alchemy RPC (same one from your backend's
// .env) for more reliable reads. Falls back to a public RPC if not set.
const RPC_URL = import.meta.env.VITE_ARBITRUM_SEPOLIA_RPC_URL || "";

// The public Robinhood RPC drops long-lived connections, which showed up as
// undici header timeouts during backend scripting. An Alchemy endpoint here
// is worth setting before any demo you care about.
const ROBINHOOD_RPC_URL = import.meta.env.VITE_ROBINHOOD_TESTNET_RPC_URL || "";

export const wagmiConfig = getDefaultConfig({
  appName: "Covenza",
  projectId: WALLETCONNECT_PROJECT_ID,
  // Robinhood testnet first, so it is the default the app opens on. Arbitrum
  // Sepolia stays listed rather than being removed — the earlier deployment is
  // still live and settleable, and dropping it would orphan those vaults in
  // the UI.
  chains: [robinhoodTestnet, arbitrumSepolia, hardhat],
  transports: {
    [robinhoodTestnet.id]: ROBINHOOD_RPC_URL ? http(ROBINHOOD_RPC_URL) : http(),
    [arbitrumSepolia.id]: RPC_URL ? http(RPC_URL) : http(),
    [hardhat.id]: http("http://127.0.0.1:8545"),
  },
  ssr: false,
});