CREATE TABLE `telegram_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`botToken` text,
	`chatId` varchar(64),
	`isEnabled` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `telegram_settings_id` PRIMARY KEY(`id`)
);
