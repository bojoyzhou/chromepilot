// Network request filtering — pure logic, no Chrome API dependencies
// Extracted from legacy.ts network_requests handler for testability

export interface NetworkEntry {
  requestId: string;
  url: string;
  method: string;
  type?: string;
  statusCode?: number;
  [key: string]: unknown;
}

export interface NetworkFilters {
  urlPattern?: string;
  method?: string;
  status?: number;
  type?: string;
  completed?: boolean;
  limit?: number;
}

/**
 * Filter and limit network request entries.
 * Matches the exact filtering logic from the original network_requests handler.
 */
export function filterRequests(reqs: NetworkEntry[], filters: NetworkFilters): NetworkEntry[] {
  let result = reqs;

  if (filters.urlPattern) {
    const re = new RegExp(filters.urlPattern);
    result = result.filter((r) => re.test(r.url));
  }
  if (filters.method) {
    const upper = filters.method.toUpperCase();
    result = result.filter((r) => r.method === upper);
  }
  if (filters.status != null) {
    result = result.filter((r) => r.statusCode === filters.status);
  }
  if (filters.type) {
    result = result.filter((r) => r.type === filters.type);
  }
  if (filters.completed) {
    result = result.filter((r) => r.statusCode != null);
  }
  if (filters.limit) {
    result = result.slice(-filters.limit);
  }

  return result;
}
