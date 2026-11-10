CREATE TABLE `commute_plan` (
	`enabled` integer NOT NULL,
	`id` text PRIMARY KEY,
	`install_id` text NOT NULL,
	`plan_json` text NOT NULL,
	`start_minute` integer NOT NULL,
	`timezone` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_commute_plan_install_id_install_id_fk` FOREIGN KEY (`install_id`) REFERENCES `install`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `commute_session` (
	`end_reason` text,
	`ended_at` integer,
	`id` text PRIMARY KEY,
	`install_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`service_date` text NOT NULL,
	`started_at` integer NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `holiday` (
	`country` text NOT NULL,
	`date` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`name` text NOT NULL,
	CONSTRAINT `holiday_pk` PRIMARY KEY(`country`, `date`)
);
--> statement-breakpoint
CREATE TABLE `install` (
	`created_at` integer NOT NULL,
	`id` text PRIMARY KEY,
	`last_seen_at` integer NOT NULL,
	`platform` text NOT NULL,
	`secret_hash` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `push_token` (
	`activity_id` text DEFAULT '' NOT NULL,
	`env` text NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`install_id` text NOT NULL,
	`kind` text NOT NULL,
	`session_id` text DEFAULT '' NOT NULL,
	`token` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_push_token_install_id_install_id_fk` FOREIGN KEY (`install_id`) REFERENCES `install`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `commute_plan_due_idx` ON `commute_plan` (`enabled`,`timezone`,`start_minute`);--> statement-breakpoint
CREATE INDEX `commute_plan_install_idx` ON `commute_plan` (`install_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `commute_session_plan_date_idx` ON `commute_session` (`plan_id`,`service_date`);--> statement-breakpoint
CREATE INDEX `commute_session_install_idx` ON `commute_session` (`install_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `push_token_install_kind_activity_idx` ON `push_token` (`install_id`,`kind`,`activity_id`);