"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { TripCard, Trip } from "@/components/trips/TripCard";
import { Button } from "@/components/ui/Button";

export function TripList() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadTrips = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/trips");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Unable to load your trips.");
      }
      setTrips(Array.isArray(payload.data) ? payload.data : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load your trips.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTrips();
  }, [loadTrips]);

  if (loading) {
    return (
      <div className="skeleton-grid" aria-label="Loading trips">
        <div className="skeleton" />
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-state" role="alert">
        <h3>We could not open your trips.</h3>
        <p>{error}</p>
        <Button variant="secondary" type="button" onClick={() => void loadTrips()}>Try again</Button>
      </div>
    );
  }

  if (trips.length === 0) {
    return (
      <div className="empty-state">
        <h3>Your map is still wide open.</h3>
        <p>Create your first trip and give the next adventure somewhere to begin.</p>
        <Link className="button button-primary" href="/trips/new">Plan your first trip</Link>
      </div>
    );
  }

  return (
    <div className="trip-grid">
      {trips.map((trip) => <TripCard key={trip.id} trip={trip} />)}
    </div>
  );
}