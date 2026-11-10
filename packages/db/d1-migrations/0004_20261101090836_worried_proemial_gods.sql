CREATE TABLE `bus_route` (
	`batch_id` integer NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`quality_flags` text NOT NULL,
	`route_id` text NOT NULL,
	`route_name` text NOT NULL,
	`route_type` text NOT NULL,
	CONSTRAINT `fk_bus_route_batch_id_reference_batch_id_fk` FOREIGN KEY (`batch_id`) REFERENCES `reference_batch`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `bus_route_segment` (
	`api_sect_dist_m` integer NOT NULL,
	`bus_route_id` integer NOT NULL,
	`end_m` real NOT NULL,
	`from_seq` integer NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`quality_flags` text NOT NULL,
	`start_m` real NOT NULL,
	`to_seq` integer NOT NULL,
	CONSTRAINT `fk_bus_route_segment_bus_route_id_bus_route_id_fk` FOREIGN KEY (`bus_route_id`) REFERENCES `bus_route`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `bus_route_shape` (
	`attribution` text NOT NULL,
	`bus_route_id` integer NOT NULL,
	`coords` text NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`length_m` real NOT NULL,
	CONSTRAINT `fk_bus_route_shape_bus_route_id_bus_route_id_fk` FOREIGN KEY (`bus_route_id`) REFERENCES `bus_route`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `bus_route_stop` (
	`api_sect_dist_m` integer NOT NULL,
	`ars_id` text,
	`bus_route_id` integer NOT NULL,
	`direction_name` text,
	`distance_m` real NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`name` text NOT NULL,
	`offset_m` real NOT NULL,
	`quality_flags` text NOT NULL,
	`seq` integer NOT NULL,
	`station_id` text NOT NULL,
	CONSTRAINT `fk_bus_route_stop_bus_route_id_bus_route_id_fk` FOREIGN KEY (`bus_route_id`) REFERENCES `bus_route`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bus_route_batch_route_idx` ON `bus_route` (`batch_id`,`route_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `bus_route_segment_route_from_idx` ON `bus_route_segment` (`bus_route_id`,`from_seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `bus_route_shape_route_idx` ON `bus_route_shape` (`bus_route_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `bus_route_stop_route_seq_idx` ON `bus_route_stop` (`bus_route_id`,`seq`);--> statement-breakpoint
CREATE INDEX `bus_route_stop_station_idx` ON `bus_route_stop` (`station_id`);