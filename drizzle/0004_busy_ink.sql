CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`machineId` varchar(64) NOT NULL,
	`planName` varchar(64) NOT NULL,
	`durationDays` int NOT NULL,
	`amount` varchar(32) NOT NULL,
	`network` enum('ERC20','TRC20') NOT NULL,
	`txHash` varchar(255),
	`status` enum('pending','paid','completed','failed') NOT NULL DEFAULT 'pending',
	`activationCode` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payment_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`network` enum('ERC20','TRC20') NOT NULL,
	`address` varchar(255) NOT NULL,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payment_settings_id` PRIMARY KEY(`id`)
);
