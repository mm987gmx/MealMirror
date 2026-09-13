import { useState } from "react";
import { Check, Clock, Pencil, Trash2, UtensilsCrossed, X } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { isoToLocalInput, localInputToIso } from "@/lib/datetime";
import type { MealCheckInStatus } from "@/lib/services/meals";

export interface MealListItem {
  id: string;
  occurredAt: string;
  description: string;
  checkInStatus: MealCheckInStatus;
}

interface Props {
  meals: MealListItem[];
}

const STATUS_LABELS: Record<MealCheckInStatus, { text: string; className: string }> = {
  pending: { text: "Check-in pending", className: "border-purple-400/40 bg-purple-500/20 text-purple-100" },
  completed: { text: "Check-in done", className: "border-green-400/40 bg-green-500/20 text-green-100" },
  deferred: { text: "Deferred to a later meal", className: "border-yellow-400/40 bg-yellow-500/20 text-yellow-100" },
  none: { text: "No check-in", className: "border-white/20 bg-white/10 text-blue-100/70" },
};

function MealRow({ meal }: { meal: MealListItem }) {
  const [isEditing, setIsEditing] = useState(false);
  const [occurredAt, setOccurredAt] = useState(() => isoToLocalInput(meal.occurredAt));
  const [description, setDescription] = useState(meal.description);
  const status = STATUS_LABELS[meal.checkInStatus];

  function cancelEdit() {
    setOccurredAt(isoToLocalInput(meal.occurredAt));
    setDescription(meal.description);
    setIsEditing(false);
  }

  if (isEditing) {
    return (
      <li className="rounded-lg border border-purple-400/30 bg-white/5 p-4">
        <form method="POST" action={`/api/meals/${meal.id}`} className="space-y-4" noValidate>
          <input type="hidden" name="intent" value="update" />
          <FormField
            id={`occurredAtLocal-${meal.id}`}
            name="occurredAtLocal"
            type="datetime-local"
            label="When did you eat?"
            value={occurredAt}
            onChange={setOccurredAt}
            icon={<Clock className="size-4" />}
          />
          <input type="hidden" name="occurredAt" value={localInputToIso(occurredAt)} />
          <FormField
            id={`description-${meal.id}`}
            name="description"
            label="What did you eat?"
            value={description}
            onChange={setDescription}
            icon={<UtensilsCrossed className="size-4" />}
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex items-center gap-1 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500"
            >
              <Check className="size-4" />
              Save changes
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              className="flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm transition-colors hover:bg-white/20"
            >
              <X className="size-4" />
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-white/10 bg-white/5 p-4">
      <p className="font-medium break-words">{meal.description}</p>
      <p className="mt-1 text-sm text-blue-100/60">{new Date(meal.occurredAt).toLocaleString()}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-xs ${status.className}`}>{status.text}</span>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => {
              setIsEditing(true);
            }}
            className="flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-sm transition-colors hover:bg-white/20"
          >
            <Pencil className="size-3.5" />
            Edit
          </button>
          <form
            method="POST"
            action={`/api/meals/${meal.id}`}
            onSubmit={(event) => {
              if (!window.confirm(`Delete "${meal.description}"? Its check-in will be removed too.`)) {
                event.preventDefault();
              }
            }}
          >
            <input type="hidden" name="intent" value="delete" />
            <button
              type="submit"
              className="flex items-center gap-1 rounded-lg border border-red-400/30 bg-red-500/15 px-3 py-1.5 text-sm text-red-200 transition-colors hover:bg-red-500/25"
            >
              <Trash2 className="size-3.5" />
              Delete
            </button>
          </form>
        </div>
      </div>
    </li>
  );
}

export default function MealList({ meals }: Props) {
  if (meals.length === 0) {
    return <p className="text-sm text-blue-100/60">No meals logged yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {meals.map((meal) => (
        <MealRow key={meal.id} meal={meal} />
      ))}
    </ul>
  );
}
