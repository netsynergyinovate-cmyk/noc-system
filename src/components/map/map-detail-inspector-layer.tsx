"use client";

import React from "react";
import type { Map as LeafletMap } from "leaflet";
import { CustomerDetailPanel } from "./customer-detail-panel";
import { DeviceDetailPanel } from "./device-detail-panel";
import type {
  NetworkCustomerPoint,
  NetworkInfrastructurePoint,
} from "@/services/network-map.service";
import type {
  CustomerLocationEditState,
  InfraMoveState,
} from "./use-map-detail-panel";
import { flyToWithoutOcclusion } from "@/lib/map-viewport-offset";

export interface MapDetailInspectorLayerProps {
  selectedCustomer: NetworkCustomerPoint | null;
  selectedInfra: NetworkInfrastructurePoint | null;
  customerEdit: CustomerLocationEditState;
  infraMove: InfraMoveState;
  allCustomers?: NetworkCustomerPoint[];
  map: LeafletMap | null;
  // Aksi Pelanggan
  onCloseCustomer: () => void;
  onToggleCustomerEdit: () => void;
  onSaveCustomerLocation: () => Promise<void> | void;
  onCancelCustomerEdit: () => void;
  onDeleteCustomer?: () => Promise<void> | void;
  isDeletingCustomer?: boolean;
  // Aksi Infrastruktur
  onCloseInfra: () => void;
  onStartInfraMove: () => void;
  onCancelInfraMove: () => void;
  onSaveInfraMove: () => Promise<boolean | void> | void;
  onDeleteInfra: () => Promise<boolean | void> | void;
}

/**
 * Layer terpisah untuk merender panel inspeksi detail (Pelanggan atau Perangkat Infrastruktur)
 * secara terisolasi dari layer titik & garis Leaflet di kanvas peta.
 */
export function MapDetailInspectorLayer({
  selectedCustomer,
  selectedInfra,
  customerEdit,
  infraMove,
  allCustomers,
  map,
  onCloseCustomer,
  onToggleCustomerEdit,
  onSaveCustomerLocation,
  onCancelCustomerEdit,
  onDeleteCustomer,
  isDeletingCustomer,
  onCloseInfra,
  onStartInfraMove,
  onCancelInfraMove,
  onSaveInfraMove,
  onDeleteInfra,
}: MapDetailInspectorLayerProps) {
  // Jika tidak ada entitas terpilih dan tidak ada notifikasi aksi, jangan render apapun
  const hasActiveContent =
    Boolean(selectedCustomer) ||
    Boolean(selectedInfra) ||
    Boolean(infraMove.successMessage) ||
    Boolean(infraMove.errorMessage);

  if (!hasActiveContent) {
    return null;
  }

  const handleFocus = (lat: number, lng: number) => {
    flyToWithoutOcclusion(map, lat, lng, 17, { duration: 0.8 });
  };

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[1050] overflow-hidden"
      data-testid="map-inspector-container"
    >
      {/* Banner Notifikasi Aksi Infrastruktur (Pindah & Hapus) */}
      {infraMove.successMessage && (
        <div
          className="pointer-events-auto absolute top-16 left-1/2 -translate-x-1/2 z-[1060] bg-emerald-600 text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-2xl flex items-center gap-2 animate-in fade-in"
          data-testid="infra-action-success-message"
        >
          <span>{infraMove.successMessage}</span>
        </div>
      )}
      {infraMove.errorMessage && (
        <div
          className="pointer-events-auto absolute top-16 left-1/2 -translate-x-1/2 z-[1060] bg-rose-600 text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-2xl flex items-center gap-2 animate-in fade-in"
          data-testid="infra-action-error-message"
        >
          <span>{infraMove.errorMessage}</span>
        </div>
      )}

      {/* Floating Detail Inspector Panel Pelanggan */}
      {selectedCustomer && (
        <div className="pointer-events-auto">
          <CustomerDetailPanel
            customer={selectedCustomer}
            data-testid="customer-detail-panel"
            isEditingLocation={customerEdit.isEditing}
            onToggleEditLocation={onToggleCustomerEdit}
            draftCoordinates={customerEdit.draftCoords}
            onSaveLocation={onSaveCustomerLocation}
            onCancelEditLocation={onCancelCustomerEdit}
            isSavingLocation={customerEdit.isSaving}
            saveSuccessMessage={customerEdit.successMessage}
            saveErrorMessage={customerEdit.errorMessage}
            onClose={onCloseCustomer}
            onFocus={handleFocus}
            onDelete={onDeleteCustomer}
            isDeleting={isDeletingCustomer}
          />
        </div>
      )}

      {/* Floating Detail Inspector Panel Infrastruktur */}
      {selectedInfra && (
        <div className="pointer-events-auto">
          <DeviceDetailPanel
            device={selectedInfra}
            customers={allCustomers}
            onClose={onCloseInfra}
            onFocus={handleFocus}
            onStartMove={onStartInfraMove}
            isMoving={infraMove.isMoving}
            draftCoords={infraMove.draftCoords}
            onCancelMove={onCancelInfraMove}
            onSaveMove={onSaveInfraMove}
            isSavingMove={infraMove.isSaving}
            onDelete={onDeleteInfra}
            isDeleting={infraMove.isDeleting}
          />
        </div>
      )}
    </div>
  );
}
