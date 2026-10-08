import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";

// Each customer company is an organization (the "tenant").
// Every piece of data belongs to exactly one organization, and every query
// filters by organization_id — that is what keeps tenants isolated.
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const USER_ROLES = ["owner", "agent"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").$type<UserRole>().notNull().default("agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("users_org_idx").on(t.organizationId)],
);

export const TICKET_STATUSES = ["open", "in_progress", "waiting_customer", "resolved", "closed"] as const;
export const TICKET_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const TICKET_CATEGORIES = ["billing", "technical", "account", "feature_request", "other"] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    status: text("status").$type<TicketStatus>().notNull().default("open"),
    priority: text("priority").$type<TicketPriority>().notNull().default("medium"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    category: text("category").$type<TicketCategory>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tickets_org_status_idx").on(t.organizationId, t.status)],
);

export type Ticket = typeof tickets.$inferSelect;
