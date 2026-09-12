import type { Database } from "./database.types";

export type Meal = Database["public"]["Tables"]["meals"]["Row"];
export type CheckIn = Database["public"]["Tables"]["check_ins"]["Row"];
export type CheckInKind = CheckIn["kind"];
