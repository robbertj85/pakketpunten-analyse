import { PakketpuntProperties, ServiceFilter } from '@/types/pakketpunten';

/**
 * Single source of truth for the pickup/dropoff service filter.
 * Shared by Map.tsx, StatsPanel.tsx and app/page.tsx so the map, the stats
 * panel and the filter counts always agree on which points are visible.
 */
export function matchesServiceFilters(
  props: PakketpuntProperties,
  serviceFilters: ServiceFilter[]
): boolean {
  const wantsPickup = serviceFilters.includes('pickup');
  const wantsDropoff = serviceFilters.includes('dropoff');

  // If both filters selected, show locations that support at least one
  // If only pickup selected, show locations that support pickup
  // If only dropoff selected, show locations that support dropoff
  if (wantsPickup && wantsDropoff) {
    return props.canPickup || props.canDropoff;
  } else if (wantsPickup) {
    return props.canPickup;
  } else if (wantsDropoff) {
    return props.canDropoff;
  }
  return false; // No service filters selected
}
