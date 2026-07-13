import { useCallback, useState } from "react";
import { apiFetch } from "@/lib/api";

export interface CustomWorkoutSlot {
  id: string;
  exerciseSlug: string;
  sets: number;
  repLow: number;
  repHigh: number;
  weightKg?: number | null;
  restSeconds: number;
  sortOrder: number;
}

export interface CustomWorkoutTemplate {
  id: string;
  name: string;
  profileId: string | null;
  slots: CustomWorkoutSlot[];
  createdAt: string;
  updatedAt: string;
}

export interface CustomWorkoutInput {
  name: string;
  slots: Array<{
    exerciseSlug: string;
    sets: number;
    repLow: number;
    repHigh: number;
    weightKg?: number;
    restSeconds: number;
  }>;
}

export function useCustomWorkouts() {
  const [templates, setTemplates] = useState<CustomWorkoutTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listWorkouts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/custom-workouts");
      if (!res.ok) throw new Error("Failed to load workouts");
      setTemplates(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workouts");
    } finally {
      setLoading(false);
    }
  }, []);

  const createWorkout = useCallback(async (input: CustomWorkoutInput) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/custom-workouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error("Failed to create workout");
      const data: CustomWorkoutTemplate = await res.json();
      setTemplates((prev) => [...prev, data]);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create workout");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateWorkout = useCallback(
    async (id: string, input: CustomWorkoutInput) => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/api/custom-workouts/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!res.ok) throw new Error("Failed to update workout");
        const data: CustomWorkoutTemplate = await res.json();
        setTemplates((prev) => prev.map((t) => (t.id === id ? data : t)));
        return data;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update workout");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const deleteWorkout = useCallback(async (id: string) => {
    setError(null);
    try {
      const res = await apiFetch(`/api/custom-workouts/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete workout");
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete workout");
      throw err;
    }
  }, []);

  return {
    templates,
    loading,
    error,
    listWorkouts,
    createWorkout,
    updateWorkout,
    deleteWorkout,
  };
}
