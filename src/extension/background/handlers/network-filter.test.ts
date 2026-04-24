import { describe, expect, it } from "vitest";
import { filterRequests, type NetworkEntry } from "./network-filter";

const ENTRIES: NetworkEntry[] = [
  {
    requestId: "1",
    url: "https://api.example.com/users",
    method: "GET",
    type: "XHR",
    statusCode: 200,
  },
  {
    requestId: "2",
    url: "https://api.example.com/orders",
    method: "POST",
    type: "XHR",
    statusCode: 201,
  },
  {
    requestId: "3",
    url: "https://cdn.example.com/style.css",
    method: "GET",
    type: "Stylesheet",
    statusCode: 200,
  },
  { requestId: "4", url: "https://api.example.com/health", method: "GET", type: "XHR" }, // no statusCode = pending
  {
    requestId: "5",
    url: "https://api.example.com/users/1",
    method: "DELETE",
    type: "XHR",
    statusCode: 404,
  },
];

describe("filterRequests", () => {
  it("returns all when no filters", () => {
    expect(filterRequests(ENTRIES, {})).toHaveLength(5);
  });

  it("filters by urlPattern (regex)", () => {
    const result = filterRequests(ENTRIES, { urlPattern: "/users" });
    expect(result.map((r) => r.requestId)).toEqual(["1", "5"]);
  });

  it("filters by method (case insensitive input)", () => {
    const result = filterRequests(ENTRIES, { method: "post" });
    expect(result).toHaveLength(1);
    expect(result[0].requestId).toBe("2");
  });

  it("filters by status code", () => {
    const result = filterRequests(ENTRIES, { status: 200 });
    expect(result.map((r) => r.requestId)).toEqual(["1", "3"]);
  });

  it("filters by type", () => {
    const result = filterRequests(ENTRIES, { type: "Stylesheet" });
    expect(result).toHaveLength(1);
    expect(result[0].requestId).toBe("3");
  });

  it("filters completed only", () => {
    const result = filterRequests(ENTRIES, { completed: true });
    expect(result).toHaveLength(4); // entry 4 has no statusCode
    expect(result.find((r) => r.requestId === "4")).toBeUndefined();
  });

  it("limits from tail", () => {
    const result = filterRequests(ENTRIES, { limit: 2 });
    expect(result.map((r) => r.requestId)).toEqual(["4", "5"]);
  });

  it("combines multiple filters", () => {
    const result = filterRequests(ENTRIES, {
      urlPattern: "api\\.example\\.com",
      method: "GET",
      completed: true,
    });
    expect(result.map((r) => r.requestId)).toEqual(["1"]);
  });

  it("returns empty for no matches", () => {
    const result = filterRequests(ENTRIES, { urlPattern: "nonexistent" });
    expect(result).toHaveLength(0);
  });

  it("handles empty input array", () => {
    expect(filterRequests([], { urlPattern: "api" })).toEqual([]);
  });

  it("limit with filter", () => {
    const result = filterRequests(ENTRIES, { type: "XHR", limit: 2 });
    // XHR entries: 1,2,4,5 → last 2 = 4,5
    expect(result.map((r) => r.requestId)).toEqual(["4", "5"]);
  });
});
