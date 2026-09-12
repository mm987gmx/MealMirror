import React, { useState } from "react";
import { Clock, UtensilsCrossed, Plus } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";

interface Props {
  serverError?: string | null;
}

function defaultOccurredAt() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

export default function MealForm({ serverError }: Props) {
  const [occurredAt, setOccurredAt] = useState(defaultOccurredAt());
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<{ occurredAt?: string; description?: string }>({});

  function validate() {
    const next: typeof errors = {};
    if (!occurredAt) {
      next.occurredAt = "Date and time are required";
    }
    if (!description.trim()) {
      next.description = "Description is required";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function clearError(field: keyof typeof errors) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  return (
    <form method="POST" action="/api/meals" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <FormField
        id="occurredAt"
        type="datetime-local"
        label="When did you eat?"
        value={occurredAt}
        onChange={(v) => {
          setOccurredAt(v);
          clearError("occurredAt");
        }}
        error={errors.occurredAt}
        icon={<Clock className="size-4" />}
      />

      <FormField
        id="description"
        label="What did you eat?"
        value={description}
        onChange={(v) => {
          setDescription(v);
          clearError("description");
        }}
        placeholder="e.g. Chicken salad with rice"
        error={errors.description}
        icon={<UtensilsCrossed className="size-4" />}
      />

      <ServerError message={serverError} />

      <SubmitButton pendingText="Logging meal..." icon={<Plus className="size-4" />}>
        Log meal
      </SubmitButton>
    </form>
  );
}
