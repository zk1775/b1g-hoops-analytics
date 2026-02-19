export function isFinalStatus(status: string | null | undefined) {
  return (status ?? "").toLowerCase().includes("final");
}
