// Thin wrapper around fetch: adds the token, parses JSON and turns API errors
// into exceptions with a readable message.

export type TicketStatus = "open" | "in_progress" | "waiting_customer" | "resolved" | "closed";
export type TicketPriority = "low" | "medium" | "high" | "urgent";
export type TicketCategory = "billing" | "technical" | "account" | "feature_request" | "other";
export type Suggestion = { category: TicketCategory; priority: TicketPriority; reply: string; source: "ai" | "demo" };

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
  dueAt: string;
  resolvedAt: string | null;
  overdue: boolean;
  category: TicketCategory | null;
  assigneeId: string | null;
};

export type TicketEventType = "created" | "status" | "priority" | "category" | "assignee";
export type TimelineItem =
  | { kind: "comment"; id: string; body: string; internal: boolean; createdAt: string; authorName: string | null }
  | { kind: "event"; id: string; type: TicketEventType; fromValue: string | null; toValue: string | null; createdAt: string; authorName: string | null };
export type Comment = Extract<TimelineItem, { kind: "comment" }>;
export type AssigneeFilter = "me" | "none";

export type Dashboard = {
  openTotal: number;
  overdue: number;
  dueSoon: number;
  resolved30d: number;
  avgResolutionHours: number | null;
  onTimeRate30d: number | null;
  byStatus: Partial<Record<TicketStatus, number>>;
  openByPriority: Partial<Record<TicketPriority, number>>;
  openByAssignee: { assigneeId: string | null; name: string | null; open: number; overdue: number }[];
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
  listUsers: () => request<User[]>("GET", "/users"),
  listTickets: (f: { status?: TicketStatus; overdue?: boolean; sort?: "newest" | "due"; assignee?: AssigneeFilter } = {}) => {
    const q = new URLSearchParams();
    if (f.status) q.set("status", f.status);
    if (f.assignee) q.set("assignee", f.assignee);
    if (f.overdue) q.set("overdue", "true");
    if (f.sort) q.set("sort", f.sort);
    const qs = q.toString();
    return request<Ticket[]>("GET", `/tickets${qs ? `?${qs}` : ""}`);
  },
  dashboard: () => request<Dashboard>("GET", "/dashboard"),
  getTicket: (id: string) => request<Ticket>("GET", `/tickets/${id}`),
  createTicket: (b: { title: string; description: string; priority: TicketPriority }) => request<Ticket>("POST", "/tickets", b),
  updateTicket: (id: string, b: { status?: TicketStatus; priority?: TicketPriority; category?: TicketCategory | null; assigneeId?: string | null }) =>
    request<Ticket>("PATCH", `/tickets/${id}`, b),
  timeline: (id: string) => request<TimelineItem[]>("GET", `/tickets/${id}/timeline`),
  addComment: (id: string, b: { body: string; internal: boolean }) => request<Comment>("POST", `/tickets/${id}/comments`, b),
  suggest: (id: string) => request<Suggestion>("POST", `/tickets/${id}/suggest`),
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

export const CATEGORY_LABEL: Record<TicketCategory, string> = {
  billing: "Billing",
  technical: "Technical",
  account: "Account",
  feature_request: "Feature request",
  other: "Other",
};
