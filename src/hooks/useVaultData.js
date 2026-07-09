import { useReadContracts } from "wagmi";
import { parseAbi } from "viem";
import { VAULT_ABI, ERC20_ABI } from "../config/abis.js";
import { AAVE } from "../config/contracts.js";

const vaultAbi = parseAbi(VAULT_ABI);
const erc20Abi = parseAbi(ERC20_ABI);

// Reads every field the UI needs for a single vault in one multicall,
// plus the vault's current aWETH balance (its Aave position, if any).
export function useVaultData(vaultAddress) {
  const enabled = Boolean(vaultAddress);

  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      { address: vaultAddress, abi: vaultAbi, functionName: "lender" },
      { address: vaultAddress, abi: vaultAbi, functionName: "borrower" },
      { address: vaultAddress, abi: vaultAbi, functionName: "principal" },
      { address: vaultAddress, abi: vaultAbi, functionName: "deposit" },
      { address: vaultAddress, abi: vaultAbi, functionName: "requiredDeposit" },
      { address: vaultAddress, abi: vaultAbi, functionName: "repaymentDue" },
      { address: vaultAddress, abi: vaultAbi, functionName: "deadline" },
      { address: vaultAddress, abi: vaultAbi, functionName: "isSettled" },
      { address: vaultAddress, abi: vaultAbi, functionName: "isExpired" },
      { address: vaultAddress, abi: vaultAbi, functionName: "depositPaid" },
      { address: vaultAddress, abi: vaultAbi, functionName: "vaultBalance" },
      {
        address: AAVE.wethAToken,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [vaultAddress],
      },
    ],
    query: {
      enabled,
      refetchInterval: 10000,
    },
  });

  if (!enabled || !data) {
    return { vault: null, isLoading, refetch };
  }

  const [
    lender,
    borrower,
    principal,
    deposit,
    requiredDeposit,
    repaymentDue,
    deadline,
    isSettled,
    isExpired,
    depositPaid,
    vaultBalance,
    aWethBalance,
  ] = data.map((d) => d.result);

  return {
    vault: {
      address: vaultAddress,
      lender,
      borrower,
      principal,
      deposit,
      requiredDeposit,
      repaymentDue,
      deadline,
      isSettled,
      isExpired,
      depositPaid,
      vaultBalance,
      aWethBalance,
    },
    isLoading,
    refetch,
  };
}
