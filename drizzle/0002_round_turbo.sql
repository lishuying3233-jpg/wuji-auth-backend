ALTER TABLE `activation_codes` MODIFY COLUMN `machineId` varchar(64);--> statement-breakpoint
ALTER TABLE `activation_codes` ADD `durationDays` int DEFAULT 365 NOT NULL;--> statement-breakpoint
ALTER TABLE `activation_codes` ADD `expiresAt` timestamp;