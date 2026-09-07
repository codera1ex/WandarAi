"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ActivityCard } from "@/components/itinerary/ActivityCard";
import { ActivityEditModal } from "@/components/itinerary/ActivityEditModal";
import { ShareControls } from "@/components/itinerary/ShareControls";
import { moveItem } from "@/lib/itinerary/reorder";
import type { Itinerary, ItineraryActivity } from "@/components/itinerary/types";

type LoadState = "loading" | "empty" | "ready";
type GenerationState = "idle" | "generating";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" }).format(
    new Date(`${value}T00:00:00`)
  );
}

async function readJsonSafely(response: Response) {
  return response.json().catch(() => ({}));
}

export function ItineraryView({ tripId }: { tripId: string }) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [generation, setGeneration] = useState<GenerationState>("idle");
  const [generationError, setGenerationError] = useState("");
  const [busyActivityId, setBusyActivityId] = useState<string | null>(null);
  const [rowError, setRowError] = useState("");
  const [editingActivity, setEditingActivity] = useState<ItineraryActivity | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadItinerary() {
      setLoadState("loading");
      try {
        const response = await fetch(`/api/trips/${tripId}/itinerary`);
        const payload = await readJsonSafely(response);
        if (!response.ok) {
          throw new Error(payload.error?.message ?? "Unable to load itinerary.");
        }
        if (cancelled) return;
        if (payload.data) {
          setItinerary(payload.data);
          setLoadState("ready");
        } else {
          setItinerary(null);
          setLoadState("empty");
        }
      } catch {
        if (!cancelled) setLoadState("empty");
      }
    }
    void loadItinerary();
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  async function handleGenerate() {
    if (generation === "generating") return; // prevent duplicate-click double submission
    const isRegeneration = itinerary !== null;
    if (isRegeneration && !window.confirm("Regenerate this itinerary? Your current itinerary and any edits will be replaced.")) {
      return;
    }
    setGeneration("generating");
    setGenerationError("");
    try {
      const response = await fetch(`/api/trips/${tripId}/generate-itinerary`, { method: "POST" });
      const payload = await readJsonSafely(response);
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Unable to generate an itinerary right now.");
      }
      setItinerary(payload.data);
      setLoadState("ready");
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "Unable to generate an itinerary right now.");
    } finally {
      setGeneration("idle");
    }
  }

  function updateDayActivities(dayNumber: number, activities: ItineraryActivity[]) {
    setItinerary((current) => {
      if (!current) return current;
      return {
        ...current,
        days: current.days.map((day) => (day.day_number === dayNumber ? { ...day, activities } : day))
      };
    });
  }

  async function handleSaveEdit(fields: Pick<ItineraryActivity, "title" | "description" | "category" | "time_of_day">) {
    if (!editingActivity || !itinerary) return;
    setBusyActivityId(editingActivity.id);
    setRowError("");
    try {
      const response = await fetch(`/api/trips/${tripId}/itinerary/activities/${editingActivity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields)
      });
      const payload = await readJsonSafely(response);
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Unable to save this activity.");
      }
      const day = itinerary.days.find((candidate) =>
        candidate.activities.some((activity) => activity.id === editingActivity.id)
      );
      if (day) {
        updateDayActivities(
          day.day_number,
          day.activities.map((activity) => (activity.id === editingActivity.id ? { ...activity, ...fields } : activity))
        );
      }
      setEditingActivity(null);
    } catch (error) {
      setRowError(error instanceof Error ? error.message : "Unable to save this activity.");
    } finally {
      setBusyActivityId(null);
    }
  }

  async function handleRemove(dayNumber: number, activity: ItineraryActivity) {
    if (!window.confirm(`Remove "${activity.title}" from this day?`)) return;
    setBusyActivityId(activity.id);
    setRowError("");
    try {
      const response = await fetch(`/api/trips/${tripId}/itinerary/activities/${activity.id}`, {
        method: "DELETE"
      });
      const payload = await readJsonSafely(response);
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Unable to remove this activity.");
      }
      const day = itinerary?.days.find((candidate) => candidate.day_number === dayNumber);
      if (day) {
        updateDayActivities(dayNumber, day.activities.filter((candidate) => candidate.id !== activity.id));
      }
    } catch (error) {
      setRowError(error instanceof Error ? error.message : "Unable to remove this activity.");
    } finally {
      setBusyActivityId(null);
    }
  }

  async function handleMove(dayNumber: number, index: number, direction: "up" | "down") {
    const day = itinerary?.days.find((candidate) => candidate.day_number === dayNumber);
    if (!day) return;
    const reordered = moveItem(day.activities, index, direction);
    if (reordered === day.activities) return; // already at the edge, nothing to do

    const previous = day.activities;
    updateDayActivities(dayNumber, reordered); // optimistic update
    setBusyActivityId(reordered[direction === "up" ? index - 1 : index + 1].id);
    setRowError("");
    try {
      const response = await fetch(`/api/trips/${tripId}/itinerary/days/${dayNumber}/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activity_ids: reordered.map((activity) => activity.id) })
      });
      const payload = await readJsonSafely(response);
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Unable to reorder activities.");
      }
    } catch (error) {
      updateDayActivities(dayNumber, previous); // roll back on failure
      setRowError(error instanceof Error ? error.message : "Unable to reorder activities.");
    } finally {
      setBusyActivityId(null);
    }
  }

  if (loadState === "loading") {
    return (
      <div className="itinerary-shell loading-state">
        <h3>Checking for an itinerary…</h3>
        <p>One moment while we look this trip up.</p>
      </div>
    );
  }

  return (
    <div className="itinerary-shell">
      <div className="itinerary-header">
        <div>
          <span className="eyebrow">Itinerary</span>
          <h2>{itinerary ? "Your day-by-day plan" : "No itinerary yet"}</h2>
        </div>
        <Button
          type="button"
          variant={itinerary ? "secondary" : "primary"}
          onClick={handleGenerate}
          loading={generation === "generating"}
        >
          <Icon name={itinerary ? "refresh" : "sparkle"} size={15} />
          {itinerary ? "Regenerate" : "Generate itinerary"}
        </Button>
      </div>

      {generationError ? <div className="alert" role="alert">{generationError}</div> : null}
      {rowError ? <div className="alert" role="alert">{rowError}</div> : null}

      {generation === "generating" ? (
        <div className="loading-state itinerary-generating">
          <h3>Building your itinerary…</h3>
          <p>This can take up to a minute or so — worth the wait.</p>
        </div>
      ) : itinerary ? (
        <>
          <ol className="itinerary-days">
            {itinerary.days.map((day) => (
              <li key={day.day_number} className="itinerary-day">
                <div className="itinerary-day-header">
                  <span className="day-badge">Day {day.day_number}</span>
                  <span className="day-date">{formatDate(day.date)}</span>
                  {day.theme ? <span className="day-theme">{day.theme}</span> : null}
                </div>
                <ul className="activity-list">
                  {day.activities.map((activity, index) => (
                    <ActivityCard
                      key={activity.id}
                      activity={activity}
                      editable
                      busy={busyActivityId === activity.id}
                      isFirst={index === 0}
                      isLast={index === day.activities.length - 1}
                      onEdit={() => setEditingActivity(activity)}
                      onRemove={() => void handleRemove(day.day_number, activity)}
                      onMoveUp={() => void handleMove(day.day_number, index, "up")}
                      onMoveDown={() => void handleMove(day.day_number, index, "down")}
                    />
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <ShareControls tripId={tripId} />
        </>
      ) : (
        <div className="empty-state itinerary-empty">
          <h3>Ready when you are.</h3>
          <p>Generate an AI itinerary for this trip — you can edit, reorder, or remove activities afterward.</p>
        </div>
      )}

      {editingActivity ? (
        <ActivityEditModal
          activity={editingActivity}
          saving={busyActivityId === editingActivity.id}
          onCancel={() => setEditingActivity(null)}
          onSave={(fields) => void handleSaveEdit(fields)}
        />
      ) : null}
    </div>
  );
}
