"use client";

import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { Trip } from "@/components/trips/TripCard";

type FormState = {
  destination: string;
  start_date: string;
  end_date: string;
  budget_tier: "budget" | "mid-range" | "luxury";
  interests: string;
  travel_style: string;
  group_size: string;
};

type TripFormProps = {
  mode: "create" | "edit";
  initialData?: Trip;
  onSaved: (trip: Trip) => void;
};

const emptyForm: FormState = {
  destination: "",
  start_date: "",
  end_date: "",
  budget_tier: "mid-range",
  interests: "",
  travel_style: "relaxed",
  group_size: "1"
};

function toFormState(trip?: Trip): FormState {
  if (!trip) return emptyForm;
  return {
    destination: trip.destination,
    start_date: trip.start_date,
    end_date: trip.end_date,
    budget_tier: trip.budget_tier,
    interests: trip.interests.join(", "),
    travel_style: trip.travel_style,
    group_size: String(trip.group_size)
  };
}

export function TripForm({ mode, initialData, onSaved }: TripFormProps) {
  const [form, setForm] = useState<FormState>(() => toFormState(initialData));
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialData) setForm(toFormState(initialData));
  }, [initialData]);

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    const payload = {
      destination: form.destination.trim(),
      start_date: form.start_date,
      end_date: form.end_date,
      budget_tier: form.budget_tier,
      interests: form.interests.split(",").map((interest) => interest.trim()).filter(Boolean),
      travel_style: form.travel_style.trim(),
      group_size: Number(form.group_size)
    };

    try {
      const endpoint = mode === "create" ? "/api/trips" : `/api/trips/${initialData?.id}`;
      const response = await fetch(endpoint, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error?.message ?? "Unable to save this trip.");
      }
      onSaved(result.data);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save this trip.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      {error ? <div className="alert" role="alert">{error}</div> : null}
      <div className="trip-form-grid">
        <div className="field field-wide">
          <label htmlFor="trip-destination">Destination</label>
          <Input id="trip-destination" type="text" placeholder="Paris" value={form.destination} onChange={(event) => updateField("destination", event.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="trip-start-date">Start date</label>
          <Input id="trip-start-date" type="date" value={form.start_date} onChange={(event) => updateField("start_date", event.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="trip-end-date">End date</label>
          <Input id="trip-end-date" type="date" value={form.end_date} onChange={(event) => updateField("end_date", event.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="trip-budget">Budget tier</label>
          <Select id="trip-budget" value={form.budget_tier} onChange={(event) => updateField("budget_tier", event.target.value as FormState["budget_tier"])}>
            <option value="budget">Budget</option>
            <option value="mid-range">Mid-range</option>
            <option value="luxury">Luxury</option>
          </Select>
        </div>
        <div className="field">
          <label htmlFor="trip-group-size">Group size</label>
          <Input id="trip-group-size" type="number" min={1} max={50} value={form.group_size} onChange={(event) => updateField("group_size", event.target.value)} required />
        </div>
        <div className="field field-wide">
          <label htmlFor="trip-interests">Interests</label>
          <Input id="trip-interests" type="text" placeholder="food, museums" value={form.interests} onChange={(event) => updateField("interests", event.target.value)} />
          <p className="field-help">Separate multiple interests with commas.</p>
        </div>
        <div className="field field-wide">
          <label htmlFor="trip-style">Travel style</label>
          <Input id="trip-style" type="text" placeholder="relaxed" value={form.travel_style} onChange={(event) => updateField("travel_style", event.target.value)} required />
          <p className="field-help">Describe the feeling you want from the trip.</p>
        </div>
      </div>
      <div className="form-actions">
        <Button variant="secondary" type="button" onClick={() => window.history.back()}>Cancel</Button>
        <Button type="submit" loading={loading}>{loading ? "Saving…" : mode === "create" ? "Save trip" : "Save changes"}</Button>
      </div>
    </form>
  );
}