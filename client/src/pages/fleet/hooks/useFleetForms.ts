import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';
import { useFormDraft } from '../../../hooks/useFormDraft';
import { mtDatetimeLocalToUtc } from '../../../utils/dateUtils';
import { nowLocalISO } from '../utils/fleetFormatters';
import { type VehicleFormState, EMPTY_VEHICLE_FORM } from '../modals/VehicleFormModal';
import { type MaintenanceFormState, EMPTY_MAINT_FORM } from '../modals/MaintenanceFormModal';
import { type FuelFormState, EMPTY_FUEL_FORM } from '../modals/FuelLogModal';
import { type InspectionFormState, EMPTY_INSPECTION_FORM } from '../modals/InspectionFormModal';

export type ModalMode = 'none' | 'new_vehicle' | 'edit_vehicle' | 'log_maintenance'
  | 'edit_maintenance' | 'log_fuel' | 'edit_fuel' | 'new_inspection' | 'edit_inspection';

// `useFormDraft` exports ONLY the function — there is no published result
// type — so derive one rather than importing a name that does not exist.
// Requires TS >= 4.7 (instantiation expressions); the client is on 6.0.3.
type Draft<T> = ReturnType<typeof useFormDraft<T>>;

export interface FleetFormsResult {
  modal: ModalMode; setModal: (m: ModalMode) => void;
  vehicleForm: VehicleFormState; setVehicleForm: (f: VehicleFormState) => void;
  maintForm: MaintenanceFormState; setMaintForm: (f: MaintenanceFormState) => void;
  fuelForm: FuelFormState; setFuelForm: (f: FuelFormState) => void;
  inspectionForm: InspectionFormState; setInspectionForm: (f: InspectionFormState) => void;
  editingFuelId: string | null; editingMaintenanceId: string | null; editingInspectionId: string | null;
  // Additive to the published contract: the three edit openers that live in
  // FleetPage (openEditFuel / openEditMaintenance / openEditInspection) must
  // set the record being edited, and that id is what scopes the draft storage
  // key. Without these setters the openers cannot be expressed at all.
  setEditingFuelId: (id: string | null) => void;
  setEditingMaintenanceId: (id: string | null) => void;
  setEditingInspectionId: (id: string | null) => void;
  saving: boolean; isDirtyAny: boolean;
  drafts: { v: Draft<VehicleFormState>; m: Draft<MaintenanceFormState>;
            f: Draft<FuelFormState>; i: Draft<InspectionFormState> };
  handleSaveVehicle: () => Promise<void>;
  handleSaveMaintenance: () => Promise<void>;
  handleSaveFuel: () => Promise<void>;
  handleSaveInspection: () => Promise<void>;
  activeSaveHandler: () => void;
  activeCancelHandler: () => void;
  closeModal: () => void;
}

/** The four fleet record forms (vehicle / maintenance / fuel / inspection).
 *
 *  **What it does:** owns the modal mode, the three "which record am I editing"
 *  ids, the four `useFormDraft` instances behind those forms, the combined
 *  `isDirtyAny` flag that drives `FloatingSaveBar` + `UnsavedChangesGuard`, and
 *  the four save handlers (validation, payload assembly, POST/PUT, toast).
 *
 *  **How to use it:** pass the selected vehicle id and four "saved" callbacks.
 *  The callbacks replace the direct `fetchDetail` / `fetchFuelLogs` /
 *  `fetchInspections` / `fetchVehicles` calls the handlers used to make, keeping
 *  this hook independent of `useVehicleDetail` and `useFleetVehicles`. They are
 *  held in refs and invoked through those refs, so a caller passing an inline
 *  arrow cannot churn any dependency array here.
 *
 *  **What it depends on:** `apiFetch`, `useToast`, `useFormDraft`,
 *  `mtDatetimeLocalToUtc`, `nowLocalISO`, and the four modals' form types +
 *  `EMPTY_*` constants.
 *
 *  ⚠️ The three `editingXId` states are declared BEFORE the `useFormDraft`
 *  calls because the draft `storageKey`s interpolate them to scope a draft per
 *  record. Those keys are localStorage keys — changing one orphans an
 *  operator's in-progress draft, so they (and their `?? 'new'` fallbacks and
 *  `isActive` gating) are character-identical to the pre-extraction page. */
export function useFleetForms(args: {
  selectedId: string | number | null;
  onVehicleSaved: () => void;
  onMaintenanceSaved: () => void;
  onFuelSaved: (odometerChanged: boolean) => void;
  onInspectionSaved: (mileageChanged: boolean) => void;
}): FleetFormsResult {
  const { selectedId } = args;
  const { addToast } = useToast();

  // Held in refs so an inline arrow from the caller cannot re-mint a dependency
  // (the established pattern in useVehicleDetail's onCostsResetRef /
  // onLazyLoadRef). Nothing in this hook lists a callback in a dep array.
  const onVehicleSavedRef = useRef(args.onVehicleSaved);
  onVehicleSavedRef.current = args.onVehicleSaved;
  const onMaintenanceSavedRef = useRef(args.onMaintenanceSaved);
  onMaintenanceSavedRef.current = args.onMaintenanceSaved;
  const onFuelSavedRef = useRef(args.onFuelSaved);
  onFuelSavedRef.current = args.onFuelSaved;
  const onInspectionSavedRef = useRef(args.onInspectionSaved);
  onInspectionSavedRef.current = args.onInspectionSaved;

  const [modal, setModal] = useState<ModalMode>('none');
  // Editing state — tracks which record is being edited. Declared here
  // (rather than further down with the other editing/delete state) because
  // the useFormDraft storageKeys below need it to scope drafts per-record.
  const [editingFuelId, setEditingFuelId] = useState<string | null>(null);
  const [editingMaintenanceId, setEditingMaintenanceId] = useState<string | null>(null);
  const [editingInspectionId, setEditingInspectionId] = useState<string | null>(null);
  const v = useFormDraft<VehicleFormState>({
    storageKey: `rmpg_fleet_vehicle_form_${modal === 'edit_vehicle' ? (selectedId ?? 'new') : 'new'}`,
    defaultValue: EMPTY_VEHICLE_FORM,
    isActive: modal === 'new_vehicle' || modal === 'edit_vehicle',
  });
  const m = useFormDraft<MaintenanceFormState>({
    storageKey: `rmpg_fleet_maintenance_form_${editingMaintenanceId ?? 'new'}`,
    defaultValue: EMPTY_MAINT_FORM,
    isActive: modal === 'log_maintenance' || modal === 'edit_maintenance',
  });
  const f = useFormDraft<FuelFormState>({
    storageKey: `rmpg_fleet_fuel_log_form_${editingFuelId ?? 'new'}`,
    defaultValue: EMPTY_FUEL_FORM,
    isActive: modal === 'log_fuel' || modal === 'edit_fuel',
  });
  const i = useFormDraft<InspectionFormState>({
    storageKey: `rmpg_fleet_inspection_form_${editingInspectionId ?? 'new'}`,
    defaultValue: EMPTY_INSPECTION_FORM,
    isActive: modal === 'new_inspection' || modal === 'edit_inspection',
  });
  const vehicleForm = v.form;
  const setVehicleForm = v.setForm;
  const maintForm = m.form;
  const setMaintForm = m.setForm;
  const fuelForm = f.form;
  const setFuelForm = f.setForm;
  const inspectionForm = i.form;
  const setInspectionForm = i.setForm;
  const [saving, setSaving] = useState(false);

  // Snapshot form as clean baseline after modal opens and form is populated.
  //
  // Every form needs this, not just the vehicle one. `useFormDraft.isDirty` is
  // `isActive && initialRef.current !== '' && <changed>`, and `initialRef` is
  // written ONLY by snapshot() — so a form that never snapshots is permanently
  // reported clean. Before this covered all four, an officer could fill in a
  // maintenance, fuel or inspection form and lose it silently: no
  // UnsavedChangesGuard on navigation, no FloatingSaveBar, no "UNSAVED" badge,
  // and the modals' guardedClose skipped its confirm so a stray backdrop click
  // discarded the entry outright.
  useEffect(() => {
    if (modal === 'new_vehicle' || modal === 'edit_vehicle') v.snapshot();
    else if (modal === 'log_maintenance' || modal === 'edit_maintenance') m.snapshot();
    else if (modal === 'log_fuel' || modal === 'edit_fuel') f.snapshot();
    else if (modal === 'new_inspection' || modal === 'edit_inspection') i.snapshot();
  }, [modal]);

  // Combined dirty state for any open form
  const isDirtyAny = v.isDirty || m.isDirty || f.isDirty || i.isDirty;

  const handleSaveVehicle = async () => {
    if (!vehicleForm.vehicle_number.trim()) { addToast('Vehicle number is required', 'warning'); return; }
    setSaving(true);
    try {
      const equipArr = vehicleForm.equipment_str.split(',').map(s => s.trim()).filter(Boolean);
      const payload = {
        vehicle_number: vehicleForm.vehicle_number.trim(),
        make: vehicleForm.make.trim() || null,
        model: vehicleForm.model.trim() || null,
        year: vehicleForm.year ? parseInt(vehicleForm.year, 10) : null,
        color: vehicleForm.color.trim() || null,
        vin: vehicleForm.vin.trim() || null,
        plate_number: vehicleForm.plate_number.trim() || null,
        plate_state: vehicleForm.plate_state.trim() || null,
        status: vehicleForm.status,
        current_mileage: vehicleForm.current_mileage ? parseInt(vehicleForm.current_mileage, 10) : null,
        next_service_mileage: vehicleForm.next_service_mileage ? parseInt(vehicleForm.next_service_mileage, 10) : null,
        insurance_expiry: vehicleForm.insurance_expiry ? mtDatetimeLocalToUtc(vehicleForm.insurance_expiry) : null,
        registration_expiry: vehicleForm.registration_expiry ? mtDatetimeLocalToUtc(vehicleForm.registration_expiry) : null,
        equipment: equipArr,
        notes: vehicleForm.notes.trim() || null,
      };
      if (modal === 'new_vehicle') {
        await apiFetch('/fleet', { method: 'POST', body: JSON.stringify(payload) });
        addToast('Vehicle created successfully', 'success');
      } else if (modal === 'edit_vehicle' && selectedId != null) {
        await apiFetch(`/fleet/${selectedId}`, { method: 'PUT', body: JSON.stringify(payload) });
        addToast('Vehicle updated successfully', 'success');
      }
      v.clearDraft();
      setModal('none');
      onVehicleSavedRef.current();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save vehicle', 'error');
    } finally { setSaving(false); }
  };

  const handleSaveMaintenance = async () => {
    if (!maintForm.description.trim()) { addToast('Description is required', 'warning'); return; }
    if (selectedId == null) return;
    setSaving(true);
    try {
      const payload = {
        type: maintForm.type,
        description: maintForm.description.trim(),
        mileage_at_service: maintForm.mileage_at_service ? parseInt(maintForm.mileage_at_service, 10) : null,
        cost: maintForm.cost ? parseFloat(maintForm.cost) : null,
        labor_cost: maintForm.labor_cost ? parseFloat(maintForm.labor_cost) : null,
        vendor: maintForm.vendor.trim() || null,
        performed_by: maintForm.performed_by.trim() || null,
        performed_at: mtDatetimeLocalToUtc(maintForm.performed_at || nowLocalISO()),
        next_due_date: maintForm.next_due_date ? mtDatetimeLocalToUtc(maintForm.next_due_date) : null,
        next_due_mileage: maintForm.next_due_mileage ? parseInt(maintForm.next_due_mileage, 10) : null,
        service_tasks: maintForm.service_tasks.trim() || null,
        notes: maintForm.notes.trim() || null,
      };
      if (modal === 'edit_maintenance' && editingMaintenanceId) {
        await apiFetch(`/fleet/maintenance/${editingMaintenanceId}`, { method: 'PUT', body: JSON.stringify(payload) });
        addToast('Maintenance updated successfully', 'success');
      } else {
        await apiFetch(`/fleet/${selectedId}/maintenance`, { method: 'POST', body: JSON.stringify(payload) });
        addToast('Maintenance logged successfully', 'success');
      }
      m.clearDraft();
      setModal('none');
      setEditingMaintenanceId(null);
      onMaintenanceSavedRef.current();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save maintenance', 'error');
    } finally { setSaving(false); }
  };

  const handleSaveFuel = async () => {
    if (!fuelForm.fuel_date || !fuelForm.gallons) { addToast('Date and gallons are required', 'warning'); return; }
    if (selectedId == null) return;
    setSaving(true);
    try {
      const payload = {
        fuel_date: mtDatetimeLocalToUtc(fuelForm.fuel_date),
        gallons: parseFloat(fuelForm.gallons),
        cost_per_gallon: fuelForm.cost_per_gallon ? parseFloat(fuelForm.cost_per_gallon) : null,
        total_cost: fuelForm.total_cost ? parseFloat(fuelForm.total_cost) : null,
        odometer_reading: fuelForm.odometer_reading ? parseInt(fuelForm.odometer_reading, 10) : null,
        fuel_type: fuelForm.fuel_type,
        station: fuelForm.station.trim() || null,
        notes: fuelForm.notes.trim() || null,
        is_full_tank: fuelForm.is_full_tank ? 1 : 0,
        payment_method: fuelForm.payment_method.trim() || null,
        driver_name: fuelForm.driver_name.trim() || null,
        location: fuelForm.location.trim() || null,
      };
      if (modal === 'edit_fuel' && editingFuelId) {
        await apiFetch(`/fleet/fuel/${editingFuelId}`, { method: 'PUT', body: JSON.stringify(payload) });
        addToast('Fuel entry updated successfully', 'success');
      } else {
        await apiFetch(`/fleet/${selectedId}/fuel`, { method: 'POST', body: JSON.stringify(payload) });
        addToast('Fuel entry logged successfully', 'success');
      }
      f.clearDraft();
      setModal('none');
      setEditingFuelId(null);
      // Was: fetchFuelLogs(selectedId); if (payload.odometer_reading) fetchDetail(selectedId);
      // The odometer flag preserves that exact truthiness test (0 stays falsy).
      onFuelSavedRef.current(!!payload.odometer_reading);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save fuel entry', 'error');
    } finally { setSaving(false); }
  };

  const handleSaveInspection = async () => {
    if (!(inspectionForm.inspector_name || '').trim()) { addToast('Inspector name is required', 'warning'); return; }
    if (selectedId == null) return;
    setSaving(true);
    try {
      const payload = {
        inspection_type: inspectionForm.inspection_type,
        inspector_name: (inspectionForm.inspector_name || '').trim(),
        inspection_date: mtDatetimeLocalToUtc(inspectionForm.inspection_date),
        overall_result: inspectionForm.overall_result,
        mileage: inspectionForm.mileage ? parseInt(inspectionForm.mileage, 10) : null,
        items: inspectionForm.items,
        notes: inspectionForm.notes.trim() || null,
      };
      if (modal === 'edit_inspection' && editingInspectionId) {
        await apiFetch(`/fleet/inspections/${editingInspectionId}`, { method: 'PUT', body: JSON.stringify(payload) });
        addToast('Inspection updated successfully', 'success');
      } else {
        await apiFetch(`/fleet/${selectedId}/inspections`, { method: 'POST', body: JSON.stringify(payload) });
        addToast('Inspection submitted successfully', 'success');
      }
      i.clearDraft();
      setModal('none');
      setEditingInspectionId(null);
      // Was: fetchInspections(selectedId); if (payload.mileage) fetchDetail(selectedId);
      onInspectionSavedRef.current(!!payload.mileage);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save inspection', 'error');
    } finally { setSaving(false); }
  };

  // Active save/cancel for FloatingSaveBar
  const activeSaveHandler = () => {
    if (modal === 'new_vehicle' || modal === 'edit_vehicle') handleSaveVehicle();
    else if (modal === 'log_maintenance' || modal === 'edit_maintenance') handleSaveMaintenance();
    else if (modal === 'log_fuel' || modal === 'edit_fuel') handleSaveFuel();
    else if (modal === 'new_inspection' || modal === 'edit_inspection') handleSaveInspection();
  };

  const activeCancelHandler = () => {
    v.clearDraft(); m.clearDraft(); f.clearDraft(); i.clearDraft();
    setModal('none');
  };

  // Alias of the cancel path. The four modals keep their own narrower
  // onClose handlers (each clears only its own draft + editing id) because
  // clearing an unrelated editing id would re-key that form's draft storage.
  const closeModal = activeCancelHandler;

  return {
    modal, setModal,
    vehicleForm, setVehicleForm,
    maintForm, setMaintForm,
    fuelForm, setFuelForm,
    inspectionForm, setInspectionForm,
    editingFuelId, editingMaintenanceId, editingInspectionId,
    setEditingFuelId, setEditingMaintenanceId, setEditingInspectionId,
    saving, isDirtyAny,
    drafts: { v, m, f, i },
    handleSaveVehicle, handleSaveMaintenance, handleSaveFuel, handleSaveInspection,
    activeSaveHandler, activeCancelHandler, closeModal,
  };
}
