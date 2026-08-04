import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { hardhat } from "wagmi/chains";
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

// The public Robinhood RPC drops long-lived connections, which showed up as
// undici header timeouts during backend scripting. An Alchemy endpoint here
// is worth setting before any demo you care about.
const ROBINHOOD_RPC_URL = import.meta.env.VITE_ROBINHOOD_TESTNET_RPC_URL || "";

export const wagmiConfig = getDefaultConfig({
  appName: "Covenza",
  projectId: WALLETCONNECT_PROJECT_ID,
  // Robinhood Chain only. Arbitrum Sepolia was dropped on 4 August 2026: that
  // deployment predates risk tiers and mandates, so this app's calls do not
  // exist there. Offering the network meant offering a chain on which every
  // read returns empty — which looks like a broken app, not an unsupported one.
  chains: [robinhoodTestnet, hardhat],
  transports: {
    [robinhoodTestnet.id]: ROBINHOOD_RPC_URL ? http(ROBINHOOD_RPC_URL) : http(),
    [hardhat.id]: http("http://127.0.0.1:8545"),
  },
  ssr: false,
});