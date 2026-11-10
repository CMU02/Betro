import type { CommutePlan } from "@Betro/commute/plan";
import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

export type InstallPlatform = "ios" | "android";
export type PushTokenKind = "apns-start" | "apns-activity" | "fcm";
export type PushEnv = "sandbox" | "production";
export type CommuteSessionStatus = "active" | "ended";

/** 설치. 비밀값 원문은 저장하지 않고 해시만 둔다. 모든 시각은 UTC epoch ms. */
export const install = sqliteTable("install", {
	createdAt: integer("created_at").notNull(),
	id: text("id").primaryKey(),
	lastSeenAt: integer("last_seen_at").notNull(),
	platform: text("platform").$type<InstallPlatform>().notNull(),
	secretHash: text("secret_hash").notNull(),
});

export const pushToken = sqliteTable(
	"push_token",
	{
		activityId: text("activity_id").default("").notNull(),
		env: text("env").$type<PushEnv>().notNull(),
		id: integer("id").primaryKey({ autoIncrement: true }),
		installId: text("install_id")
			.notNull()
			.references(() => install.id, { onDelete: "cascade" }),
		kind: text("kind").$type<PushTokenKind>().notNull(),
		sessionId: text("session_id").default("").notNull(),
		token: text("token").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		uniqueIndex("push_token_install_kind_activity_idx").on(
			table.installId,
			table.kind,
			table.activityId
		),
	]
);

export const commutePlan = sqliteTable(
	"commute_plan",
	{
		enabled: integer("enabled").notNull(),
		id: text("id").primaryKey(),
		installId: text("install_id")
			.notNull()
			.references(() => install.id, { onDelete: "cascade" }),
		planJson: text("plan_json", { mode: "json" })
			.$type<CommutePlan>()
			.notNull(),
		startMinute: integer("start_minute").notNull(),
		timezone: text("timezone").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		index("commute_plan_due_idx").on(
			table.enabled,
			table.timezone,
			table.startMinute
		),
		index("commute_plan_install_idx").on(table.installId),
	]
);

export const commuteSession = sqliteTable(
	"commute_session",
	{
		endedAt: integer("ended_at"),
		endReason: text("end_reason"),
		id: text("id").primaryKey(),
		installId: text("install_id").notNull(),
		planId: text("plan_id").notNull(),
		serviceDate: text("service_date").notNull(),
		startedAt: integer("started_at").notNull(),
		status: text("status").$type<CommuteSessionStatus>().notNull(),
	},
	(table) => [
		uniqueIndex("commute_session_plan_date_idx").on(
			table.planId,
			table.serviceDate
		),
		index("commute_session_install_idx").on(table.installId),
	]
);

export const holiday = sqliteTable(
	"holiday",
	{
		country: text("country").notNull(),
		date: text("date").notNull(),
		fetchedAt: integer("fetched_at").notNull(),
		name: text("name").notNull(),
	},
	(table) => [primaryKey({ columns: [table.country, table.date] })]
);
