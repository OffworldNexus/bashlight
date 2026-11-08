/** The prefix every API endpoint is built from. */
export const API_BASE = "/api";

/** Returns the health endpoint path. */
export function healthPath(): string {
    return `${API_BASE}/health`;
}
