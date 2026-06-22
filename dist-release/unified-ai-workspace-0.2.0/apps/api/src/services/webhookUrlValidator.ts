import { env } from "../config/env.js";
import dns from "node:dns/promises";

const FORBIDDEN_PROTOCOLS = new Set(["file:", "ftp:", "gopher:", "smb:"]);

/**
 * Validates a webhook URL and optionally performs DNS resolution to prevent SSRF against private IPs.
 * Throws an Error if the URL is invalid or blocked.
 * 
 * @param urlString The raw URL string provided by the user
 * @param enforceDns Check DNS resolution to reject private IPs (default true). Set to false in fast paths if needed, though validation is usually fast.
 */
export async function validateWebhookUrl(urlString: string, enforceDns = true): Promise<URL> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error("Invalid URL format");
  }

  // 1. Protocol check
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Unsupported protocol: ${url.protocol}`);
  }

  if (FORBIDDEN_PROTOCOLS.has(url.protocol.toLowerCase())) {
    throw new Error("Blocked protocol");
  }

  // 2. HTTP in production constraint
  if (env.NODE_ENV === "production" && url.protocol === "http:") {
    if (!env.NOTIFICATION_WEBHOOK_ALLOW_LOCALHOST) {
      throw new Error("HTTPS is required for webhooks in production");
    }
  }

  // 3. Prevent credential embedding
  if (url.username || url.password) {
    throw new Error("Webhook URLs cannot contain embedded credentials");
  }

  // 4. Basic localhost hostname rejection (unless allowed)
  const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (isLocalhost && !env.NOTIFICATION_WEBHOOK_ALLOW_LOCALHOST) {
    throw new Error("Localhost webhooks are not allowed in this environment");
  }

  // 5. DNS based SSRF check (if enabled and hostname is not already caught as basic localhost)
  if (enforceDns && !env.NOTIFICATION_WEBHOOK_ALLOW_LOCALHOST) {
    await checkHostSrf(url.hostname);
  }

  return url;
}

async function checkHostSrf(hostname: string): Promise<void> {
  // If it's an IP literal, test it directly
  if (isPrivateIp(hostname)) {
    throw new Error("Private or local IP addresses are not allowed for webhooks");
  }

  try {
    // Resolve IPv4
    const addresses = await dns.resolve4(hostname);
    for (const ip of addresses) {
      if (isPrivateIp(ip)) {
        throw new Error("Hostname resolves to a private or local IP address");
      }
    }
  } catch (err: any) {
    // If it fails to resolve IPv4, we might try IPv6, or just let it pass here and fail on the actual fetch.
    if (err.code !== "ENOTFOUND" && err.code !== "ENODATA") {
      throw err;
    }
  }

  try {
    // Resolve IPv6
    const addresses6 = await dns.resolve6(hostname);
    for (const ip of addresses6) {
      if (isPrivateIp(ip)) {
        throw new Error("Hostname resolves to a private or local IPv6 address");
      }
    }
  } catch (err: any) {
    if (err.code !== "ENOTFOUND" && err.code !== "ENODATA") {
      throw err;
    }
  }
}

/**
 * Simplified check for private, link-local, loopback, and broadcast IP ranges.
 */
function isPrivateIp(ip: string): boolean {
  // Strip brackets from IPv6 if present
  const cleanIp = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;

  // IPv4 checks
  if (cleanIp.includes(".")) {
    const parts = cleanIp.split(".").map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some(isNaN)) return false; // not a standard ipv4 string

    const [a, b] = parts;
    
    // 0.0.0.0/8 (Current network)
    if (a === 0) return true;
    // 10.0.0.0/8 (Private network)
    if (a === 10) return true;
    // 127.0.0.0/8 (Loopback)
    if (a === 127) return true;
    // 169.254.0.0/16 (Link-local)
    if (a === 169 && b === 254) return true;
    // 172.16.0.0/12 (Private network)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16 (Private network)
    if (a === 192 && b === 168) return true;
    // 224.0.0.0/4 (Multicast)
    if (a >= 224 && a <= 239) return true;
    // 240.0.0.0/4 (Reserved)
    if (a >= 240 && a <= 255) return true;

    return false;
  }

  // IPv6 checks
  if (cleanIp.includes(":")) {
    const lower = cleanIp.toLowerCase();
    
    // ::1 (Loopback)
    if (lower === "::1") return true;
    // Unique local address (fc00::/7)
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    // Link-local address (fe80::/10)
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;
    // IPv4-mapped IPv6
    if (lower.startsWith("::ffff:")) {
      const v4Part = lower.split("::ffff:")[1];
      return isPrivateIp(v4Part);
    }
  }

  return false;
}
