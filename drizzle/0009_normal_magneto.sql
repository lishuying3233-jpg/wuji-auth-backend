CREATE TABLE `deploy_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`adminId` int NOT NULL,
	`adminUsername` varchar(64) NOT NULL,
	`action` varchar(64) NOT NULL,
	`status` enum('pending','success','failed') NOT NULL,
	`githubCommit` varchar(64),
	`versionId` varchar(64),
	`details` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deploy_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `activation_codes` MODIFY COLUMN `durationDays` int NOT NULL;