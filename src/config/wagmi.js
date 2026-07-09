import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { arbitrumSepolia } from "wagmi/chains";
import { http } from "wagmi";

// Get a free WalletConnect project ID at https://cloud.reown.com
// (needed for the WalletConnect / mobile-wallet option in the connect
// button — MetaMask browser extension works without it too).
const WALLETCONNECT_PROJECT_ID =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "";

// Optional: point at your own Alchemy RPC (same one from your backend's
// .env) for more reliable reads. Falls back to a public RPC if not set.
const RPC_URL = import.meta.env.VITE_ARBITRUM_SEPOLIA_RPC_URL || "";

export const wagmiConfig = getDefaultConfig({
  appName: "Covenza",
  projectId: WALLETCONNECT_PROJECT_ID,
  chains: [arbitrumSepolia],
  transports: {
    [arbitrumSepolia.id]: RPC_URL ? http(RPC_URL) : http(),
  },
  ssr: false,
});
