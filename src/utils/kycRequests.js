// Simulates a pending-KYC-review inbox using localStorage, since there's
// no real backend or identity-verification provider wired up yet.
//
// Important limitation: this is browser-local only. A request submitted
// on one device/browser won't be visible to the operator on a different
// device. Fine for demoing the mechanism on a single machine; would need
// a real backend to work across separate lender/borrower/operator devices.

const STORAGE_KEY = "covenza_kyc_pending";

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeAll(requests) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(requests));
}

export function getPendingRequests() {
  return readAll();
}

export function getRequestForAddress(address) {
  if (!address) return null;
  return readAll().find((r) => r.address.toLowerCase() === address.toLowerCase()) || null;
}

export function submitRequest(address, details) {
  const existing = readAll().filter((r) => r.address.toLowerCase() !== address.toLowerCase());
  existing.push({ address, ...details, submittedAt: new Date().toISOString() });
  writeAll(existing);
}

export function removeRequest(address) {
  const remaining = readAll().filter((r) => r.address.toLowerCase() !== address.toLowerCase());
  writeAll(remaining);
}
