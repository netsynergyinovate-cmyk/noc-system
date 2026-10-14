import { z } from "zod";

export const changeWifiSchema = z
  .object({
    customerId: z.string().trim().min(1),
    ssid: z.string().trim().min(1, "SSID tidak boleh kosong").max(32, "SSID maksimal 32 karakter"),
    password: z.string().min(8, "Password minimal 8 karakter").max(64, "Password maksimal 64 karakter"),
    security: z.enum(["WPA2-PSK", "WPA3-SAE", "WPA/WPA2-PSK"]).default("WPA2-PSK"),
    enabled: z.boolean().default(true),
    radioFrequency: z.enum(["2.4GHz", "5GHz"]).optional(),
  })
  .strict();

export const testGenieacsSchema = z
  .object({
    host: z.string().optional(),
    port: z.number().int().min(1).max(65535).optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    mode: z.enum(["simulator", "real"]).optional(),
  })
  .strict();

export type ChangeWifiInput = z.infer<typeof changeWifiSchema>;

export const createDiagnosticTaskSchema = z
  .object({
    customerId: z.string().trim().uuid("ID pelanggan tidak valid"),
    action: z.enum([
      "ping_test",
      "traceroute",
      "reboot_device",
      "factory_reset",
      "check_optical",
      "speed_test",
      "list_hosts",
    ]),
    parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().default({}),
  })
  .strict();

export type CreateDiagnosticTaskInput = z.infer<typeof createDiagnosticTaskSchema>;

export const listCpeTasksParamsSchema = z.object({
  customerId: z.string().trim().uuid().optional(),
  action: z.string().trim().optional(),
  status: z.enum(["pending", "running", "success", "failed"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListCpeTasksParams = z.infer<typeof listCpeTasksParamsSchema>;
