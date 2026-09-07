"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Select } from "@/components/ui/Select";
import {
  CATEGORY_LABELS,
  CATEGORY_OPTIONS,
  TIME_OF_DAY_LABELS,
  TIME_OF_DAY_OPTIONS,
  type ItineraryActivity
} from "@/components/itinerary/types";

export function ActivityEditModal({
  activity,
  saving,
  onCancel,
  onSave
}: {
  activity: ItineraryActivity;
  saving: boolean;
  onCancel: () => void;
  onSave: (fields: Pick<ItineraryActivity, "title" | "description" | "category" | "time_of_day">) => void;
}) {
  const [title, setTitle] = useState(activity.title);
  const [description, setDescription] = useState(activity.description);
  const [category, setCategory] = useState(activity.category);
  const [timeOfDay, setTimeOfDay] = useState(activity.time_of_day);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const trimmedTitle = title.trim();
  const trimmedDescription = description.trim();
  const canSave = trimmedTitle.length > 0 && trimmedDescription.length > 0 && !saving;

  return (
    <div className="sheet-overlay" role="presentation" onClick={onCancel}>
      <div
        className="sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Edit activity"
        ref={dialogRef}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-header">
          <h2>Edit activity</h2>
          <button type="button" className="icon-button" onClick={onCancel} aria-label="Close edit activity">
            <Icon name="x" size={18} />
          </button>
        </div>

        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSave) return;
            onSave({
              title: trimmedTitle,
              description: trimmedDescription,
              category,
              time_of_day: timeOfDay
            });
          }}
        >
          <div className="field">
            <label htmlFor="activity-title">Title</label>
            <input
              id="activity-title"
              className="input"
              type="text"
              value={title}
              maxLength={150}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="activity-description">Description</label>
            <textarea
              id="activity-description"
              className="input textarea"
              value={description}
              maxLength={500}
              rows={4}
              onChange={(event) => setDescription(event.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="activity-time-of-day">Time of day</label>
            <div className="chip-row" role="radiogroup" id="activity-time-of-day" aria-label="Time of day">
              {TIME_OF_DAY_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={timeOfDay === option}
                  className={`chip ${timeOfDay === option ? "chip-active" : ""}`}
                  onClick={() => setTimeOfDay(option)}
                >
                  {TIME_OF_DAY_LABELS[option]}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="activity-category">Category</label>
            <Select
              id="activity-category"
              value={category}
              onChange={(event) => setCategory(event.target.value as typeof category)}
            >
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {CATEGORY_LABELS[option]}
                </option>
              ))}
            </Select>
          </div>

          <div className="sheet-actions">
            <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!canSave} loading={saving}>
              Save changes
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
