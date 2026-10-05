'use client';
import { useEffect } from 'react';
import { startTracking, trackingLocale, trackUsage } from '@/lib/operations/client';
export function useStorefrontTelemetry(locale:string){
  useEffect(()=>startTracking('en'),[]); // Initial mount only: language switches do not create page views.
  useEffect(()=>trackingLocale(locale),[locale]);
  return trackUsage;
}
