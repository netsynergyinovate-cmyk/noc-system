ALTER TABLE "cpe_tasks" DROP CONSTRAINT "cpe_tasks_action_check";--> statement-breakpoint
ALTER TABLE "cpe_tasks" DROP CONSTRAINT "cpe_tasks_status_check";--> statement-breakpoint
ALTER TABLE "cpe_tasks" ADD CONSTRAINT "cpe_tasks_action_check" CHECK ("cpe_tasks"."action" in ('change_ssid', 'change_password', 'list_hosts', 'ping_test', 'traceroute', 'reboot_device', 'factory_reset', 'check_optical', 'speed_test'));--> statement-breakpoint
ALTER TABLE "cpe_tasks" ADD CONSTRAINT "cpe_tasks_status_check" CHECK ("cpe_tasks"."status" in ('pending', 'running', 'success', 'failed'));