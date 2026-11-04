CREATE TABLE `timetable_stop_time` (
	`arrive_sec` integer,
	`depart_sec` integer,
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`quality_flags` text NOT NULL,
	`seq` integer NOT NULL,
	`statn_id` text NOT NULL,
	`trip_id` integer NOT NULL,
	CONSTRAINT `fk_timetable_stop_time_trip_id_timetable_trip_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `timetable_trip`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `timetable_trip` (
	`batch_id` integer NOT NULL,
	`destination_statn_id` text,
	`direction` text NOT NULL,
	`express` text NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`line_key` text NOT NULL,
	`origin_statn_id` text,
	`quality_flags` text NOT NULL,
	`service_day` text NOT NULL,
	`service_day_source` text NOT NULL,
	`source` text NOT NULL,
	`source_version` text NOT NULL,
	`train_no` text NOT NULL,
	CONSTRAINT `fk_timetable_trip_batch_id_reference_batch_id_fk` FOREIGN KEY (`batch_id`) REFERENCES `reference_batch`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `timetable_stop_time_trip_seq_idx` ON `timetable_stop_time` (`trip_id`,`seq`);--> statement-breakpoint
CREATE INDEX `timetable_stop_time_statn_idx` ON `timetable_stop_time` (`statn_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `timetable_trip_key_idx` ON `timetable_trip` (`batch_id`,`source`,`line_key`,`service_day`,`direction`,`train_no`);