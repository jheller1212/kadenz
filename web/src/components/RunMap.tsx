"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import "leaflet/dist/leaflet.css";
import type { LatLng } from "@/lib/polyline";

// Live route map for a guided run. Leaflet + OpenStreetMap raster tiles (no API
// key). The recorded track lives in a ref (updated on the GPS hot path); this
// component redraws the polyline + position marker whenever `position` changes.
export function RunMap({
  trackRef,
  position,
}: {
  trackRef: MutableRefObject<LatLng[]>;
  position: LatLng | null;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  // Leaflet types are loaded dynamically; keep the instances loosely typed.
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const lineRef = useRef<import("leaflet").Polyline | null>(null);
  const markerRef = useRef<import("leaflet").CircleMarker | null>(null);
  const centeredRef = useRef(false);

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !elRef.current || mapRef.current) return;
      const start = position ?? trackRef.current[0] ?? [51.5, 0];
      const map = L.map(elRef.current, {
        zoomControl: false,
        attributionControl: false,
        dragging: true,
        doubleClickZoom: false,
      }).setView(start as [number, number], 16);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(map);
      lineRef.current = L.polyline(trackRef.current as [number, number][], {
        color: "#C8FF3D",
        weight: 5,
        opacity: 0.95,
      }).addTo(map);
      markerRef.current = L.circleMarker((position ?? start) as [number, number], {
        radius: 7,
        color: "#ffffff",
        weight: 3,
        fillColor: "#3B82F6",
        fillOpacity: 1,
      }).addTo(map);
      mapRef.current = map;
      // Tiles can mis-size inside a flex parent until the container settles.
      setTimeout(() => map.invalidateSize(), 200);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw route + marker as new fixes come in.
  useEffect(() => {
    if (!mapRef.current || !position) return;
    lineRef.current?.setLatLngs(trackRef.current as [number, number][]);
    markerRef.current?.setLatLng(position as [number, number]);
    // Follow the runner but keep their zoom level.
    if (!centeredRef.current) {
      mapRef.current.setView(position as [number, number], 16);
      centeredRef.current = true;
    } else {
      mapRef.current.panTo(position as [number, number], { animate: true, duration: 0.5 });
    }
  }, [position, trackRef]);

  return <div ref={elRef} className="h-full w-full" aria-label="Run route map" />;
}
