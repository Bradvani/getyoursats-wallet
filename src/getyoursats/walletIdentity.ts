export function isGetYourSatsAddress(address?: string | null): boolean {
  return Boolean(address && /^[^@\s]+@getyoursats\.com$/i.test(address));
}

