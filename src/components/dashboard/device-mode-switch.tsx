"use client";

import { useSyncExternalStore, useState } from "react";
import { AlertTriangle, FlaskConical, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DeviceOperationMode,
  getDeviceMode,
  getDeviceModeServerSnapshot,
  getModeDescription,
  setDeviceMode,
  subscribeDeviceMode,
} from "@/lib/dashboard/device-mode";

interface DeviceModeSwitchProps {
  compact?: boolean;
  onModeChange?: (newMode: DeviceOperationMode) => void;
}

export function DeviceModeSwitch({
  compact = false,
  onModeChange,
}: DeviceModeSwitchProps) {
  const modeState = useSyncExternalStore(
    subscribeDeviceMode,
    getDeviceMode,
    getDeviceModeServerSnapshot,
  );
  const [showConfirm, setShowConfirm] = useState(false);

  const currentMode = modeState.mode;
  const info = getModeDescription(currentMode);

  const handleSelectMode = (nextMode: DeviceOperationMode) => {
    if (nextMode === currentMode) return;
    if (nextMode === "real") {
      setShowConfirm(true);
    } else {
      setDeviceMode("simulator");
      onModeChange?.("simulator");
    }
  };

  const handleConfirmReal = () => {
    setDeviceMode("real");
    setShowConfirm(false);
    onModeChange?.("real");
  };

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border bg-background/80 p-1 shadow-2xs">
        <Button
          type="button"
          size="sm"
          variant={currentMode === "simulator" ? "secondary" : "ghost"}
          onClick={() => handleSelectMode("simulator")}
          className="h-7 gap-1.5 px-2.5 text-xs font-medium"
        >
          <FlaskConical className="size-3.5 text-amber-500" />
          <span>Simulator</span>
        </Button>

        <Button
          type="button"
          size="sm"
          variant={currentMode === "real" ? "default" : "ghost"}
          onClick={() => handleSelectMode("real")}
          className="h-7 gap-1.5 px-2.5 text-xs font-medium"
        >
          <Server className="size-3.5 text-emerald-400" />
          <span>Fisik Nyata</span>
        </Button>

        {showConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
            <div className="w-full max-w-md rounded-xl border bg-card p-5 shadow-xl space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
                  <AlertTriangle className="size-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold">
                    Aktifkan Mode Perangkat Fisik?
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                    Sistem akan mulai mengirimkan panggilan REST dan SNMP ke
                    alamat IP fisik perangkat. Pastikan server terhubung ke
                    segmen jaringan router/OLT.
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowConfirm(false)}
                >
                  Batal
                </Button>
                <Button size="sm" onClick={handleConfirmReal}>
                  Ya, Beralih ke Fisik
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">
            Saklar Sumber Data Perangkat:
          </span>
          <Badge
            variant={currentMode === "simulator" ? "secondary" : "default"}
          >
            {info.badge}
          </Badge>
        </div>

        <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
          <Button
            type="button"
            size="sm"
            variant={currentMode === "simulator" ? "secondary" : "ghost"}
            onClick={() => handleSelectMode("simulator")}
            className="h-8 gap-2 px-3 text-xs font-medium"
          >
            <FlaskConical className="size-4 text-amber-500" />
            <span>Mode Simulator</span>
          </Button>

          <Button
            type="button"
            size="sm"
            variant={currentMode === "real" ? "default" : "ghost"}
            onClick={() => handleSelectMode("real")}
            className="h-8 gap-2 px-3 text-xs font-medium"
          >
            <Server className="size-4 text-emerald-400" />
            <span>Perangkat Fisik Asli</span>
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">{info.title}</p>
        <p className="leading-relaxed">{info.description}</p>
        {info.warning && (
          <p className="text-warning flex items-center gap-1.5 pt-1 font-medium">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span>{info.warning}</span>
          </p>
        )}
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border bg-card p-5 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
                <AlertTriangle className="size-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold">
                  Konfirmasi Beralih ke Perangkat Fisik
                </h3>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  Semua kueri RouterOS REST v7, OLT HSGQ Telnet/SNMP, GenieACS,
                  dan Scraper Billing akan diarahkan ke host fisik nyata yang
                  diatur di variabel environment.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowConfirm(false)}
              >
                Batal
              </Button>
              <Button size="sm" onClick={handleConfirmReal}>
                Ya, Aktifkan Mode Fisik
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
