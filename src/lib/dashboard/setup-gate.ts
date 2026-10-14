// Murni: menentukan apakah dashboard boleh dibuka. Mode demo selalu lolos;
// mode live butuh minimal satu router atau OLT yang terhubung.
export function evaluateSetupGate(params: {
  isDemo: boolean;
  connected: { routers: number; olts: number };
}) {
  const hasDevices = params.connected.routers + params.connected.olts > 0;
  const canEnterDashboard = params.isDemo || hasDevices;
  return {
    hasDevices,
    canEnterDashboard,
    redirectUrl: canEnterDashboard ? "/app" : "/setup",
  };
}
