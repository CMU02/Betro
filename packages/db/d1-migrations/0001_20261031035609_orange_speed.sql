CREATE TABLE `account` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_account_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL UNIQUE,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	CONSTRAINT `fk_session_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`email` text NOT NULL UNIQUE,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reference_batch` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`kind` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`source_manifest` text NOT NULL,
	`is_current` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `station_crosswalk` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`batch_id` integer NOT NULL,
	`statn_id` text NOT NULL,
	`subway_id` text NOT NULL,
	`line_key` text NOT NULL,
	`station_cd` text,
	`fr_code` text,
	`bldn_id` text,
	`name_canonical` text NOT NULL,
	`name_aliases` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`coord_source` text NOT NULL,
	`match_method` text NOT NULL,
	`quality_flags` text NOT NULL,
	CONSTRAINT `fk_station_crosswalk_batch_id_reference_batch_id_fk` FOREIGN KEY (`batch_id`) REFERENCES `reference_batch`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `track_shape` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`batch_id` integer NOT NULL,
	`line_key` text NOT NULL,
	`branch_key` text NOT NULL,
	`direction` text NOT NULL,
	`osm_relation_id` integer NOT NULL,
	`coords` text NOT NULL,
	`length_m` real NOT NULL,
	`attribution` text NOT NULL,
	CONSTRAINT `fk_track_shape_batch_id_reference_batch_id_fk` FOREIGN KEY (`batch_id`) REFERENCES `reference_batch`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `track_station` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`track_shape_id` integer NOT NULL,
	`statn_id` text NOT NULL,
	`seq` integer NOT NULL,
	`distance_m` real NOT NULL,
	`offset_m` real NOT NULL,
	`osm_stop_node_id` integer,
	CONSTRAINT `fk_track_station_track_shape_id_track_shape_id_fk` FOREIGN KEY (`track_shape_id`) REFERENCES `track_shape`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE UNIQUE INDEX `station_crosswalk_batch_statn_idx` ON `station_crosswalk` (`batch_id`,`statn_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `track_shape_batch_relation_idx` ON `track_shape` (`batch_id`,`osm_relation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `track_station_shape_statn_idx` ON `track_station` (`track_shape_id`,`statn_id`);--> statement-breakpoint
CREATE INDEX `track_station_statn_idx` ON `track_station` (`statn_id`);