'use client';

import { readExperimentalUiFromHtml, isExperimentalUiActive } from '@/lib/experimentalUi';

const RALLY_TOAST_KEY = 'aperture:experimental:alert-rally-toast';
const RALLY_DESKTOP_KEY = 'aperture:experimental:alert-rally-desktop';
const ROUTE_OFFROUTE_KEY = 'aperture:experimental:alert-route-offroute-toast';
const ROUTE_HAZARD_KEY = 'aperture:experimental:alert-route-hazard-toast';

export const EXPERIMENTAL_ALERT_EVT = 'aperture:experimental-alert-prefs';

function experimentalOnly<T>(read: () => T, fallback: T): T {
  if (!isExperimentalUiActive(readExperimentalUiFromHtml())) return fallback;
  return read();
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    return;
  }
  window.dispatchEvent(new CustomEvent(EXPERIMENTAL_ALERT_EVT));
}

export function readExperimentalRallyToast(): boolean {
  return experimentalOnly(() => readFlag(RALLY_TOAST_KEY), false);
}

export function writeExperimentalRallyToast(on: boolean): void {
  if (!isExperimentalUiActive(readExperimentalUiFromHtml())) return;
  writeFlag(RALLY_TOAST_KEY, on);
}

export function readExperimentalRallyDesktopNotification(): boolean {
  return experimentalOnly(() => readFlag(RALLY_DESKTOP_KEY), false);
}

export function writeExperimentalRallyDesktopNotification(on: boolean): void {
  if (!isExperimentalUiActive(readExperimentalUiFromHtml())) return;
  writeFlag(RALLY_DESKTOP_KEY, on);
}

export function readExperimentalRouteOffRouteToast(): boolean {
  return experimentalOnly(() => readFlag(ROUTE_OFFROUTE_KEY), false);
}

export function writeExperimentalRouteOffRouteToast(on: boolean): void {
  if (!isExperimentalUiActive(readExperimentalUiFromHtml())) return;
  writeFlag(ROUTE_OFFROUTE_KEY, on);
}

export function readExperimentalRouteHazardToast(): boolean {
  return experimentalOnly(() => readFlag(ROUTE_HAZARD_KEY), false);
}

export function writeExperimentalRouteHazardToast(on: boolean): void {
  if (!isExperimentalUiActive(readExperimentalUiFromHtml())) return;
  writeFlag(ROUTE_HAZARD_KEY, on);
}
