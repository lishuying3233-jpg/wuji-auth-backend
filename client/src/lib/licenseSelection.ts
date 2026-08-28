export const MAX_SELECTED_LICENSES = 1000;

export function clearLicenseSelection() {
  return [] as number[];
}

export function toggleLicenseSelection(current: number[], id: number, checked: boolean) {
  if (checked) return Array.from(new Set([...current, id]));
  return current.filter((selectedId) => selectedId !== id);
}

export function toggleVisibleLicenseSelection(current: number[], visibleIds: number[], checked: boolean) {
  if (checked) return Array.from(new Set([...current, ...visibleIds]));
  return current.filter((id) => !visibleIds.includes(id));
}

export function selectedVisibleLicenseCount(selectedIds: number[], visibleIds: number[]) {
  return visibleIds.filter((id) => selectedIds.includes(id)).length;
}

export function canSelectVisibleLicenses(current: number[], visibleIds: number[]) {
  const hiddenSelectedCount = current.filter((id) => !visibleIds.includes(id)).length;
  return visibleIds.length + hiddenSelectedCount <= MAX_SELECTED_LICENSES;
}
