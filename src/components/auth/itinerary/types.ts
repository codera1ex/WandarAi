export type ActivityCategory =
  | "sightseeing"
  | "food"
  | "nature_outdoors"
  | "culture_history"
  | "relaxation"
  | "shopping"
  | "nightlife"
  | "adventure"
  | "transit_logistics";

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

export type ItineraryActivity = {
  id: string;
  order_index: number;
  time_of_day: TimeOfDay;
  title: string;
  description: string;
  category: ActivityCategory;
};

export type ItineraryDay = {
  day_number: number;
  date: string;
  theme: string | null;
  activities: ItineraryActivity[];
};

export type Itinerary = {
  trip_id: string;
  trip_summary?: string;
  days: ItineraryDay[];
};

export const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  sightseeing: "Sightseeing",
  food: "Food",
  nature_outdoors: "Nature & outdoors",
  culture_history: "Culture & history",
  relaxation: "Relaxation",
  shopping: "Shopping",
  nightlife: "Nightlife",
  adventure: "Adventure",
  transit_logistics: "Transit & logistics"
};

export const TIME_OF_DAY_LABELS: Record<TimeOfDay, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  night: "Night"
};

export const CATEGORY_OPTIONS = Object.keys(CATEGORY_LABELS) as ActivityCategory[];
export const TIME_OF_DAY_OPTIONS = Object.keys(TIME_OF_DAY_LABELS) as TimeOfDay[];
