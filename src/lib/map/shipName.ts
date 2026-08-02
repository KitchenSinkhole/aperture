/** The subset of a presence entry that names a pilot's hull. */
export type ShipNamed = {
  shipName: string | null;
  shipTypeName: string | null;
};

/** The pilot's *custom* hull name, or '' when un-renamed (ESI defaults `ship_name` to the type). */
export function customShipName(p: ShipNamed): string {
  return p.shipName && p.shipName !== p.shipTypeName ? p.shipName : '';
}
