-- 배차간격·첫차·막차는 노선 목록(getBusRouteList)에서 온다. 기존 배치는 null로 두고 다음 적재가 채운다.
ALTER TABLE `bus_route` ADD `first_bus_minute` integer;--> statement-breakpoint
ALTER TABLE `bus_route` ADD `headway_min` integer;--> statement-breakpoint
ALTER TABLE `bus_route` ADD `last_bus_minute` integer;