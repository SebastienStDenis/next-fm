import { type SortOption } from "./sort-select";

export type SortKey = "match" | "name" | "concert";

export const sortOptions: readonly SortOption<SortKey>[] = [
  { value: "match", label: "Best match" },
  { value: "name", label: "Name" },
  { value: "concert", label: "Next concert" },
];

export const DEFAULT_SORT_KEY: SortKey = "match";
