/**
 * Resolves the backend API base URL.
 * Priority:
 * 1. NEXT_PUBLIC_API_URL environment variable if provided.
 * 2. In browser:
 *    - If accessed via Nginx / standard port (80 or 443), returns "" (relative same-origin /api).
 *    - If accessed via IP:3000 (direct port access), automatically targets http://<SERVER_IP>:8000.
 * 3. Fallback to http://localhost:8000 for local development and SSR.
 */
export const getApiBaseUrl = (): string => {
  const envUrl = process.env.NEXT_PUBLIC_API_URL;
  if (envUrl !== undefined && envUrl !== "") {
    return envUrl;
  }
  if (typeof window !== "undefined") {
    const { protocol, hostname, port } = window.location;
    // Behind Nginx reverse proxy (standard HTTP 80 or HTTPS 443)
    if (port === "" || port === "80" || port === "443") {
      return "";
    }
    // Direct port access (e.g. http://123.45.67.89:3000 -> http://123.45.67.89:8000)
    return `${protocol}//${hostname}:8000`;
  }
  return "http://localhost:8000";
};

export const API_BASE_URL =
  typeof window !== "undefined"
    ? getApiBaseUrl()
    : (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000");

