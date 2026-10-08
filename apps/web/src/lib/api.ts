// Thin wrapper around fetch: adds the token, parses JSON and turns API errors
// into exceptions with a readable message.

export type TicketStatus = "open" | "in_progress" | "waiting_customer" | "resolved" | "closed";
export type TicketPriority = "low" | "medium" | "high" | "urgent";

export type User = { id: string; name: string; email: string; role: "owner" | "agent"; organizationId: string };
export type Ticket = {
  id: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

const TOKEN_KEY = "helpdesk_token";

// Kept in localStorage for simplicity. Trade-off: an XSS bug could read it;
// an httpOnly cookie would be safer and is listed as a next step in the README.
export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  const token = tokenStore.get();
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  register: (b: { organizationName: string; name: string; email: string; password: string }) =>
    request<{ token: string; user: User }>("POST", "/auth/register", b),
  login: (b: { email: string; password: string }) => request<{ token: string; user: User }>("POST", "/auth/login", b),
  me: () => request<User>("GET", "/auth/me"),
  listTickets: (status?: TicketStatus) => request<Ticket[]>("GET", `/tickets${status ? `?status=${status}` : ""}`),
  getTicket: (id: string) => request<Ticket>("GET", `/tickets/${id}`),
  createTicket: (b: { title: string; description: string; priority: TicketPriority }) => request<Ticket>("POST", "/tickets", b),
  updateTicket: (id: string, b: { status?: TicketStatus; priority?: TicketPriority }) => request<Ticket>("PATCH", `/tickets/${id}`, b),
};

export const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting_customer: "Waiting on customer",
  resolved: "Resolved",
  closed: "Closed",
};

export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};
