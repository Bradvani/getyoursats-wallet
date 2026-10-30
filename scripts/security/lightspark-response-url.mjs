/** Parse an HTTPS Lightspark response URL for diagnostic path/status records. */
export function parseLightsparkResponseUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const host = url.hostname;
    return host === 'lightspark.com' || host.endsWith('.lightspark.com') ? url : null;
  } catch {
    return null;
  }
}
