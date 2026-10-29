// The web preview has no phone map, so the ride map is the drawn route shape, as before. Riders
// on a live ride stay in the list. The phone version is RideMap.tsx.

import React from 'react';
import type { LatLng, Route } from '../domain/types';
import type { RiderPin } from '../domain/rideMap';
import { RouteShape } from './RouteShape';

export interface RideMapProps {
  route?: Pick<Route, 'line' | 'bounds' | 'distanceM' | 'stops'> | null;
  riders?: RiderPin[];
  regroup?: LatLng | null;
  height?: number;
}

export function hasRealMap(): boolean {
  return false;
}

export function RideMap({ route = null }: RideMapProps) {
  return route ? <RouteShape route={route} /> : null;
}
