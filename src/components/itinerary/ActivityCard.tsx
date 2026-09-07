"use client";

import { Icon } from "@/components/ui/Icon";
import { CATEGORY_LABELS, TIME_OF_DAY_LABELS, type ItineraryActivity } from "@/components/itinerary/types";

export function ActivityCard({
  activity,
  editable,
  busy,
  isFirst,
  isLast,
  onEdit,
  onRemove,
  onMoveUp,
  onMoveDown
}: {
  activity: ItineraryActivity;
  editable: boolean;
  busy: boolean;
  isFirst: boolean;
  isLast: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  return (
    <li className="activity-card">
      <div className="activity-card-main">
        <span className="badge badge-time">{TIME_OF_DAY_LABELS[activity.time_of_day]}</span>
        <h4>{activity.title}</h4>
        <p>{activity.description}</p>
        <span className="badge badge-category">{CATEGORY_LABELS[activity.category]}</span>
      </div>

      {editable ? (
        <div className="activity-card-controls" role="group" aria-label={`Manage ${activity.title}`}>
          <button
            type="button"
            className="icon-button"
            onClick={onMoveUp}
            disabled={busy || isFirst}
            aria-label="Move activity earlier"
          >
            <Icon name="arrow-up" size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={onMoveDown}
            disabled={busy || isLast}
            aria-label="Move activity later"
          >
            <Icon name="arrow-down" size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={onEdit}
            disabled={busy}
            aria-label={`Edit ${activity.title}`}
          >
            <Icon name="pencil" size={16} />
          </button>
          <button
            type="button"
            className="icon-button icon-button-danger"
            onClick={onRemove}
            disabled={busy}
            aria-label={`Remove ${activity.title}`}
          >
            <Icon name="trash" size={16} />
          </button>
        </div>
      ) : null}
    </li>
  );
}
