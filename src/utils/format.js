import { formatEther } from "viem";

export function formatEth(value, decimals = 5) {
  if (value === undefined || value === null) return "—";
  const asNumber = Number(formatEther(value));
  return `${asNumber.toFixed(decimals)} ETH`;
}

export function shortAddress(address) {
  if (!address) return "—";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatCountdown(deadlineSeconds) {
  if (!deadlineSeconds) return "—";
  const deadlineMs = Number(deadlineSeconds) * 1000;
  const diffMs = deadlineMs - Date.now();

  if (diffMs <= 0) return "Expired";

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((diffMs / (1000 * 60)) % 60);

  if (days > 0) return `${days}d ${hours}h remaining`;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}
