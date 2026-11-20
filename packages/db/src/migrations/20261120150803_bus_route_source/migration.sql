ALTER TABLE `bus_route` ADD `area_name` text;--> statement-breakpoint
ALTER TABLE `bus_route` ADD `source` text DEFAULT 'seoul' NOT NULL;--> statement-breakpoint
ALTER TABLE `bus_route` ADD `source_city` text;--> statement-breakpoint
DROP INDEX `bus_route_batch_route_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `bus_route_batch_route_idx` ON `bus_route` (`batch_id`,`source`,`route_id`);
