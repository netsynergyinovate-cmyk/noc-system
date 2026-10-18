"use client";

import { useState, useCallback } from "react";
import type {
  NetworkCustomerPoint,
  NetworkInfrastructurePoint,
} from "@/services/network-map.service";

export interface CustomerLocationEditState {
  isEditing: boolean;
  draftCoords: { lat: number; lng: number } | null;
  isSaving: boolean;
  successMessage: string | null;
  errorMessage: string | null;
}

export interface InfraMoveState {
  isMoving: boolean;
  draftCoords: { lat: number; lng: number } | null;
  isSaving: boolean;
  isDeleting: boolean;
  successMessage: string | null;
  errorMessage: string | null;
}

export interface UseMapDetailPanelOptions {
  onSelectCustomerProp?: (customer: NetworkCustomerPoint | null) => void;
  onSelectInfraProp?: (infra: NetworkInfrastructurePoint | null) => void;
  onFlyToCoords?: (lat: number, lng: number) => void;
}

/**
 * Hook terisolasi untuk mengelola state panel detail inspeksi (pelanggan & infrastruktur)
 * secara terpisah dari layer render titik Leaflet, meminimalkan re-render kanvas peta.
 */
export function useMapDetailPanel({
  onSelectCustomerProp,
  onSelectInfraProp,
  onFlyToCoords,
}: UseMapDetailPanelOptions = {}) {
  // Entitas terpilih
  const [selectedCustomer, setSelectedCustomer] = useState<NetworkCustomerPoint | null>(null);
  const [selectedInfra, setSelectedInfra] = useState<NetworkInfrastructurePoint | null>(null);

  // State mode edit lokasi titik pelanggan
  const [customerEdit, setCustomerEdit] = useState<CustomerLocationEditState>({
    isEditing: false,
    draftCoords: null,
    isSaving: false,
    successMessage: null,
    errorMessage: null,
  });

  // State mode pemindahan & penghapusan perangkat infrastruktur
  const [infraMove, setInfraMove] = useState<InfraMoveState>({
    isMoving: false,
    draftCoords: null,
    isSaving: false,
    isDeleting: false,
    successMessage: null,
    errorMessage: null,
  });

  // Pemilihan pelanggan
  const selectCustomer = useCallback(
    (customer: NetworkCustomerPoint | null) => {
      setSelectedCustomer(customer);
      if (customer) {
        setSelectedInfra(null);
        // Reset state edit infrastruktur
        setInfraMove({
          isMoving: false,
          draftCoords: null,
          isSaving: false,
          isDeleting: false,
          successMessage: null,
          errorMessage: null,
        });
      }
      // Reset state edit pelanggan saat berpindah target
      setCustomerEdit({
        isEditing: false,
        draftCoords: null,
        isSaving: false,
        successMessage: null,
        errorMessage: null,
      });

      onSelectCustomerProp?.(customer);
    },
    [onSelectCustomerProp],
  );

  // Pemilihan infrastruktur
  const selectInfra = useCallback(
    (infra: NetworkInfrastructurePoint | null) => {
      setSelectedInfra(infra);
      if (infra) {
        setSelectedCustomer(null);
        // Reset state edit pelanggan
        setCustomerEdit({
          isEditing: false,
          draftCoords: null,
          isSaving: false,
          successMessage: null,
          errorMessage: null,
        });
      }
      // Reset state move infra saat berpindah target
      setInfraMove({
        isMoving: false,
        draftCoords: null,
        isSaving: false,
        isDeleting: false,
        successMessage: null,
        errorMessage: null,
      });

      onSelectInfraProp?.(infra);
    },
    [onSelectInfraProp],
  );

  // Bersihkan seluruh seleksi detail
  const clearSelection = useCallback(() => {
    setSelectedCustomer(null);
    setSelectedInfra(null);
    setCustomerEdit({
      isEditing: false,
      draftCoords: null,
      isSaving: false,
      successMessage: null,
      errorMessage: null,
    });
    setInfraMove({
      isMoving: false,
      draftCoords: null,
      isSaving: false,
      isDeleting: false,
      successMessage: null,
      errorMessage: null,
    });
    onSelectCustomerProp?.(null);
    onSelectInfraProp?.(null);
  }, [onSelectCustomerProp, onSelectInfraProp]);

  // Aksi Edit Lokasi Pelanggan
  const toggleCustomerEdit = useCallback(() => {
    setCustomerEdit((prev) => {
      const nextIsEditing = !prev.isEditing;
      return {
        ...prev,
        isEditing: nextIsEditing,
        draftCoords:
          nextIsEditing && selectedCustomer && selectedCustomer.latitude !== null && selectedCustomer.longitude !== null
            ? { lat: selectedCustomer.latitude, lng: selectedCustomer.longitude }
            : null,
        successMessage: null,
        errorMessage: null,
      };
    });
  }, [selectedCustomer]);

  const cancelCustomerEdit = useCallback(() => {
    setCustomerEdit((prev) => ({
      ...prev,
      isEditing: false,
      draftCoords: null,
      errorMessage: null,
    }));
  }, []);

  const setCustomerDraftCoords = useCallback((coords: { lat: number; lng: number } | null) => {
    setCustomerEdit((prev) => ({
      ...prev,
      draftCoords: coords,
      errorMessage: null,
    }));
  }, []);

  const saveCustomerLocation = useCallback(
    async (overrideCoords?: { lat: number; lng: number }) => {
      if (!selectedCustomer) return false;
      const targetCoords = overrideCoords ?? customerEdit.draftCoords;
      if (!targetCoords) {
        setCustomerEdit((prev) => ({
          ...prev,
          errorMessage: "Pilih titik lokasi pada peta terlebih dahulu.",
        }));
        return false;
      }

      setCustomerEdit((prev) => ({
        ...prev,
        isSaving: true,
        errorMessage: null,
      }));

      try {
        const res = await fetch(`/api/map/customers/${selectedCustomer.id}/location`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            latitude: targetCoords.lat,
            longitude: targetCoords.lng,
          }),
        });

        const json = await res.json();
        if (!res.ok || !json.ok) {
          throw new Error(json.error || "Gagal menyimpan koordinat baru pelanggan.");
        }

        // Perbarui entitas terpilih di state panel
        const updatedCustomer: NetworkCustomerPoint = {
          ...selectedCustomer,
          latitude: targetCoords.lat,
          longitude: targetCoords.lng,
        };
        setSelectedCustomer(updatedCustomer);

        setCustomerEdit({
          isEditing: false,
          draftCoords: null,
          isSaving: false,
          successMessage: "Koordinat lokasi pelanggan berhasil disimpan!",
          errorMessage: null,
        });

        setTimeout(() => {
          setCustomerEdit((prev) => ({ ...prev, successMessage: null }));
        }, 4000);

        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setCustomerEdit((prev) => ({
          ...prev,
          isSaving: false,
          errorMessage: msg,
        }));
        return false;
      }
    },
    [selectedCustomer, customerEdit.draftCoords],
  );

  // Aksi Pemindahan Perangkat Infrastruktur
  const startInfraMove = useCallback(() => {
    if (!selectedInfra) return;
    setInfraMove({
      isMoving: true,
      draftCoords: { lat: selectedInfra.latitude, lng: selectedInfra.longitude },
      isSaving: false,
      isDeleting: false,
      successMessage: null,
      errorMessage: null,
    });
    onFlyToCoords?.(selectedInfra.latitude, selectedInfra.longitude);
  }, [selectedInfra, onFlyToCoords]);

  const cancelInfraMove = useCallback(() => {
    setInfraMove((prev) => ({
      ...prev,
      isMoving: false,
      draftCoords: null,
      errorMessage: null,
    }));
  }, []);

  const setInfraMoveDraftCoords = useCallback((coords: { lat: number; lng: number } | null) => {
    setInfraMove((prev) => ({
      ...prev,
      draftCoords: coords,
      errorMessage: null,
    }));
  }, []);

  const saveInfraMove = useCallback(
    async (onSuccessCallback?: (updated: NetworkInfrastructurePoint) => void) => {
      if (!selectedInfra || !infraMove.draftCoords) return false;

      setInfraMove((prev) => ({
        ...prev,
        isSaving: true,
        errorMessage: null,
      }));

      try {
        const res = await fetch(`/api/map/infrastructure/${selectedInfra.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            latitude: infraMove.draftCoords.lat,
            longitude: infraMove.draftCoords.lng,
          }),
        });

        const json = await res.json();
        if (!res.ok || !json.ok) {
          throw new Error(json.error || "Gagal memindahkan posisi perangkat.");
        }

        const updatedInfra: NetworkInfrastructurePoint = {
          ...selectedInfra,
          latitude: infraMove.draftCoords.lat,
          longitude: infraMove.draftCoords.lng,
        };
        setSelectedInfra(updatedInfra);

        setInfraMove({
          isMoving: false,
          draftCoords: null,
          isSaving: false,
          isDeleting: false,
          successMessage: `Posisi ${updatedInfra.name} berhasil diperbarui!`,
          errorMessage: null,
        });

        onSuccessCallback?.(updatedInfra);

        setTimeout(() => {
          setInfraMove((prev) => ({ ...prev, successMessage: null }));
        }, 4000);

        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setInfraMove((prev) => ({
          ...prev,
          isSaving: false,
          errorMessage: msg,
        }));
        return false;
      }
    },
    [selectedInfra, infraMove.draftCoords],
  );

  const deleteInfra = useCallback(
    async (onSuccessCallback?: (deletedId: string, deletedType: string, deletedName: string) => void) => {
      if (!selectedInfra) return false;
      const deletedId = selectedInfra.id;
      const deletedType = selectedInfra.type;
      const deletedName = selectedInfra.name;

      setInfraMove((prev) => ({
        ...prev,
        isDeleting: true,
        errorMessage: null,
      }));

      try {
        const res = await fetch(`/api/map/infrastructure/${deletedId}`, {
          method: "DELETE",
        });

        const json = await res.json();
        if (!res.ok || !json.ok) {
          throw new Error(json.error || "Gagal menghapus perangkat infrastruktur.");
        }

        setSelectedInfra(null);
        setInfraMove({
          isMoving: false,
          draftCoords: null,
          isSaving: false,
          isDeleting: false,
          successMessage: `Perangkat '${deletedName}' berhasil dihapus dari peta.`,
          errorMessage: null,
        });

        onSuccessCallback?.(deletedId, deletedType, deletedName);

        setTimeout(() => {
          setInfraMove((prev) => ({ ...prev, successMessage: null }));
        }, 4000);

        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setInfraMove((prev) => ({
          ...prev,
          isDeleting: false,
          errorMessage: msg,
        }));
        return false;
      }
    },
    [selectedInfra],
  );

  return {
    selectedCustomer,
    selectedInfra,
    customerEdit,
    infraMove,
    selectCustomer,
    selectInfra,
    clearSelection,
    toggleCustomerEdit,
    cancelCustomerEdit,
    setCustomerDraftCoords,
    saveCustomerLocation,
    startInfraMove,
    cancelInfraMove,
    setInfraMoveDraftCoords,
    saveInfraMove,
    deleteInfra,
  };
}
