-- SQLite는 기본값 없는 NOT NULL 열을 ADD COLUMN으로 더하지 못한다. 기존 배치에는 7·8 노선이 없으므로
-- region은 'seoul'로 두고, short_name은 route_name으로 채운다. 표를 다시 만들면(D1은 외래 키를 끌 수 없어)
-- bus_route_shape/stop/segment가 ON DELETE CASCADE로 지워지므로 ADD COLUMN을 쓴다.
ALTER TABLE `bus_route` ADD `region` text NOT NULL DEFAULT 'seoul';--> statement-breakpoint
ALTER TABLE `bus_route` ADD `short_name` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `bus_route` SET `short_name` = `route_name`;
