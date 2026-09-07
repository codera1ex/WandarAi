import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";

export type Trip = {
  id: string;
  destination: string;
  start_date: string;
  end_date: string;
  budget_tier: "budget" | "mid-range" | "luxury";
  interests: string[];
  travel_style: string;
  group_size: number;
  created_at?: string;
  updated_at?: string;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}

const tripImages = [
  "https://images.unsplash.com/photo-1530789253388-582c481c54b0?auto=format&fit=crop&w=1200&q=82",
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=82",
  "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=82",
  "https://images.unsplash.com/photo-1516483638261-f4dbaf036963?auto=format&fit=crop&w=1200&q=82"
];

export function imageForTrip(destination: string) {
  const index = [...destination].reduce((total, character) => total + character.charCodeAt(0), 0) % tripImages.length;
  return tripImages[index];
}

export function TripCard({ trip }: { trip: Trip }) {
  return (
    <Link className="trip-card" href={`/trips/${trip.id}`}>
      <div className="trip-card-image" style={{ backgroundImage: `url("${imageForTrip(trip.destination)}")` }}>
        <div className="trip-card-image-top">
          <span className="image-pill">{trip.budget_tier}</span>
          <span className="trip-card-heart"><Icon name="heart" size={16} /></span>
        </div>
        <span className="trip-card-location"><Icon name="map-pin" size={14} /> {trip.destination}</span>
      </div>
      <div className="trip-card-body">
        <div className="trip-card-top">
          <div>
            <h3>{trip.destination}</h3>
            <p className="trip-dates"><Icon name="calendar" size={14} /> {formatDate(trip.start_date)} — {formatDate(trip.end_date)}</p>
          </div>
          <span className="trip-card-arrow"><Icon name="arrow-right" size={16} /></span>
        </div>
        <div className="trip-card-footer">
          <div className="trip-meta">
            {trip.interests.slice(0, 2).map((interest) => <Badge key={interest}>{interest}</Badge>)}
          </div>
          <span className="trip-travelers"><Icon name="users" size={14} /> {trip.group_size}</span>
        </div>
      </div>
    </Link>
  );
}