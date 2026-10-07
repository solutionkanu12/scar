-- Multi-workspace cutover. Pre-cutover operational records are retained in a
-- sealed legacy workspace with no membership row, so no new public principal
-- can access them. The original organization ID is retained on HTTP audits.
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
INSERT OR IGNORE INTO `scar_workspaces` (`id`, `name`, `kind`, `status`, `created_at`)
VALUES ('workspace:legacy', 'Legacy SCAR operational records', 'ORGANIZATION', 'SUSPENDED', '2026-10-03T13:00:00.000Z');
--> statement-breakpoint
INSERT OR IGNORE INTO `scar_workspace_execution_configurations` (`workspace_id`, `status`)
VALUES ('workspace:legacy', 'DISABLED');
--> statement-breakpoint
CREATE TABLE `__new_agents` (
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`permissions` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`)
);
--> statement-breakpoint
INSERT INTO `__new_agents` (`workspace_id`, `id`, `name`, `role`, `status`, `permissions`)
SELECT 'workspace:legacy', `id`, `name`, `role`, `status`, `permissions` FROM `agents`;
--> statement-breakpoint
DROP TABLE `agents`;
--> statement-breakpoint
ALTER TABLE `__new_agents` RENAME TO `agents`;
--> statement-breakpoint
CREATE TABLE `__new_protected_actions` (
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`agent_id` text NOT NULL,
	`action_type` text NOT NULL,
	`amount_atomic` text NOT NULL,
	`entity_id` text NOT NULL,
	`recipient` text NOT NULL,
	`chain_id` integer NOT NULL,
	`proposed_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`)
);
--> statement-breakpoint
INSERT INTO `__new_protected_actions` (`workspace_id`, `id`, `agent_id`, `action_type`, `amount_atomic`, `entity_id`, `recipient`, `chain_id`, `proposed_at`)
SELECT 'workspace:legacy', `id`, `agent_id`, `action_type`, `amount_atomic`, `entity_id`, `recipient`, `chain_id`, `proposed_at` FROM `protected_actions`;
--> statement-breakpoint
DROP TABLE `protected_actions`;
--> statement-breakpoint
ALTER TABLE `__new_protected_actions` RENAME TO `protected_actions`;
--> statement-breakpoint
CREATE TABLE `__new_incidents` (
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`source_agent_id` text NOT NULL,
	`related_action_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`action_type` text NOT NULL,
	`context` text NOT NULL,
	`outcome` text NOT NULL,
	`severity` text NOT NULL,
	`reason` text NOT NULL,
	`mitigation` text NOT NULL,
	`evidence` text NOT NULL,
	`provenance` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`)
);
--> statement-breakpoint
INSERT INTO `__new_incidents` (`workspace_id`, `id`, `source_agent_id`, `related_action_id`, `entity_id`, `action_type`, `context`, `outcome`, `severity`, `reason`, `mitigation`, `evidence`, `provenance`, `created_at`)
SELECT 'workspace:legacy', `id`, `source_agent_id`, `related_action_id`, `entity_id`, `action_type`, `context`, `outcome`, `severity`, `reason`, `mitigation`, `evidence`, `provenance`, `created_at` FROM `incidents`;
--> statement-breakpoint
DROP TABLE `incidents`;
--> statement-breakpoint
ALTER TABLE `__new_incidents` RENAME TO `incidents`;
--> statement-breakpoint
CREATE TABLE `__new_incident_memory_bundles` (
	`workspace_id` text NOT NULL,
	`incident_id` text NOT NULL,
	`bundle` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `incident_id`)
);
--> statement-breakpoint
INSERT INTO `__new_incident_memory_bundles` (`workspace_id`, `incident_id`, `bundle`)
SELECT 'workspace:legacy', `incident_id`, `bundle` FROM `incident_memory_bundles`;
--> statement-breakpoint
DROP TABLE `incident_memory_bundles`;
--> statement-breakpoint
ALTER TABLE `__new_incident_memory_bundles` RENAME TO `incident_memory_bundles`;
--> statement-breakpoint
CREATE TABLE `__new_scar_agent_credentials` (
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`agent_id` text NOT NULL,
	`secret_hash` text NOT NULL,
	`allowed_operations` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	PRIMARY KEY(`workspace_id`, `id`)
);
--> statement-breakpoint
INSERT INTO `__new_scar_agent_credentials` (`workspace_id`, `id`, `agent_id`, `secret_hash`, `allowed_operations`, `status`, `created_at`, `expires_at`, `revoked_at`)
SELECT 'workspace:legacy', `id`, `agent_id`, `secret_hash`, `allowed_operations`, `status`, `created_at`, `expires_at`, `revoked_at` FROM `scar_agent_credentials`;
--> statement-breakpoint
DROP TABLE `scar_agent_credentials`;
--> statement-breakpoint
ALTER TABLE `__new_scar_agent_credentials` RENAME TO `scar_agent_credentials`;
--> statement-breakpoint
CREATE UNIQUE INDEX `scar_agent_credentials_workspace_secret_hash_unique` ON `scar_agent_credentials` (`workspace_id`, `secret_hash`);
--> statement-breakpoint
CREATE TABLE `__new_scar_http_audit_events` (
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`legacy_organization_id` text,
	`request_id` text NOT NULL,
	`principal_type` text NOT NULL,
	`principal_id` text NOT NULL,
	`operation` text NOT NULL,
	`action_id` text,
	`incident_id` text,
	`outcome` text NOT NULL,
	`status_code` integer NOT NULL,
	`occurred_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`)
);
--> statement-breakpoint
INSERT INTO `__new_scar_http_audit_events` (`workspace_id`, `id`, `legacy_organization_id`, `request_id`, `principal_type`, `principal_id`, `operation`, `action_id`, `incident_id`, `outcome`, `status_code`, `occurred_at`)
SELECT 'workspace:legacy', `id`, `organization_id`, `request_id`, `principal_type`, `principal_id`, `operation`, `action_id`, `incident_id`, `outcome`, `status_code`, `occurred_at` FROM `scar_http_audit_events`;
--> statement-breakpoint
DROP TABLE `scar_http_audit_events`;
--> statement-breakpoint
ALTER TABLE `__new_scar_http_audit_events` RENAME TO `scar_http_audit_events`;
--> statement-breakpoint
CREATE TABLE `__new_scar_http_rate_limit_buckets` (
	`workspace_id` text NOT NULL,
	`principal_id` text NOT NULL,
	`operation` text NOT NULL,
	`window_started_at` text NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `principal_id`, `operation`, `window_started_at`)
);
--> statement-breakpoint
INSERT INTO `__new_scar_http_rate_limit_buckets` (`workspace_id`, `principal_id`, `operation`, `window_started_at`, `count`)
SELECT 'workspace:legacy', `principal_id`, `operation`, `window_started_at`, `count` FROM `scar_http_rate_limit_buckets`;
--> statement-breakpoint
DROP TABLE `scar_http_rate_limit_buckets`;
--> statement-breakpoint
ALTER TABLE `__new_scar_http_rate_limit_buckets` RENAME TO `scar_http_rate_limit_buckets`;
--> statement-breakpoint
CREATE TABLE `__new_authorizations` (
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`action_id` text NOT NULL,
	`decision` text NOT NULL,
	`reason_code` text NOT NULL,
	`rationale` text NOT NULL,
	`evidence` text NOT NULL,
	`provenance` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`)
);
--> statement-breakpoint
INSERT INTO `__new_authorizations` (`workspace_id`, `id`, `action_id`, `decision`, `reason_code`, `rationale`, `evidence`, `provenance`)
SELECT 'workspace:legacy', `id`, `action_id`, `decision`, `reason_code`, `rationale`, `evidence`, `provenance` FROM `authorizations`;
--> statement-breakpoint
DROP TABLE `authorizations`;
--> statement-breakpoint
ALTER TABLE `__new_authorizations` RENAME TO `authorizations`;
--> statement-breakpoint
CREATE UNIQUE INDEX `authorizations_workspace_action_unique` ON `authorizations` (`workspace_id`, `action_id`);
--> statement-breakpoint
CREATE TABLE `__new_approvals` (
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`action_id` text NOT NULL,
	`authorization_id` text NOT NULL,
	`approved_by` text NOT NULL,
	`approved_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`)
);
--> statement-breakpoint
INSERT INTO `__new_approvals` (`workspace_id`, `id`, `action_id`, `authorization_id`, `approved_by`, `approved_at`)
SELECT 'workspace:legacy', `id`, `action_id`, `authorization_id`, `approved_by`, `approved_at` FROM `approvals`;
--> statement-breakpoint
DROP TABLE `approvals`;
--> statement-breakpoint
ALTER TABLE `__new_approvals` RENAME TO `approvals`;
--> statement-breakpoint
CREATE UNIQUE INDEX `approvals_action_authorization_unique` ON `approvals` (`workspace_id`, `action_id`, `authorization_id`);
--> statement-breakpoint
CREATE TABLE `__new_executions` (
	`workspace_id` text NOT NULL,
	`action_id` text NOT NULL,
	`id` text NOT NULL,
	`authorization_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`external_reference` text,
	`error_code` text,
	PRIMARY KEY(`workspace_id`, `action_id`)
);
--> statement-breakpoint
INSERT INTO `__new_executions` (`workspace_id`, `action_id`, `id`, `authorization_id`, `status`, `started_at`, `completed_at`, `external_reference`, `error_code`)
SELECT 'workspace:legacy', `action_id`, `id`, `authorization_id`, `status`, `started_at`, `completed_at`, `external_reference`, `error_code` FROM `executions`;
--> statement-breakpoint
DROP TABLE `executions`;
--> statement-breakpoint
ALTER TABLE `__new_executions` RENAME TO `executions`;
--> statement-breakpoint
CREATE TABLE `__new_base_execution_receipts` (
	`workspace_id` text NOT NULL,
	`action_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`authorization_id` text NOT NULL,
	`network` text NOT NULL,
	`chain_id` integer NOT NULL,
	`token_address` text NOT NULL,
	`recipient` text NOT NULL,
	`amount_atomic` text NOT NULL,
	`transaction_hash` text NOT NULL,
	`block_number` text NOT NULL,
	`outcome` text NOT NULL,
	`submitted_at` text NOT NULL,
	`resolved_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `action_id`)
);
--> statement-breakpoint
INSERT INTO `__new_base_execution_receipts` (`workspace_id`, `action_id`, `agent_id`, `authorization_id`, `network`, `chain_id`, `token_address`, `recipient`, `amount_atomic`, `transaction_hash`, `block_number`, `outcome`, `submitted_at`, `resolved_at`)
SELECT 'workspace:legacy', `action_id`, `agent_id`, `authorization_id`, `network`, `chain_id`, `token_address`, `recipient`, `amount_atomic`, `transaction_hash`, `block_number`, `outcome`, `submitted_at`, `resolved_at` FROM `base_execution_receipts`;
--> statement-breakpoint
DROP TABLE `base_execution_receipts`;
--> statement-breakpoint
ALTER TABLE `__new_base_execution_receipts` RENAME TO `base_execution_receipts`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
