CREATE TABLE `activation_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(64) NOT NULL,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`machineId` varchar(128),
	`activatedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`note` text,
	CONSTRAINT `activation_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `activation_codes_code_unique` UNIQUE(`code`)
);
