import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@rainbow-me/rainbowkit/styles.css";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "./config/wagmi.js";
import "./index.css";
import App from "./App.jsx";

const queryClient = new QueryClient();

const covenzaTheme = darkTheme({
  accentColor: "#b8925a",
  accentColorForeground: "#101512",
  borderRadius: "medium",
  fontStack: "system",
});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={covenzaTheme}>
          <App />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>
);
