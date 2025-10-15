"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, MoveDown, MoveUp, Plus, RotateCcw, X } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_SORT_COLUMN,
  type SortDefinition,
  type SortPriority,
  sanitizeSortStack,
  sortStacksEqual,
} from "@/lib/multi-sort";

type SortPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: SortDefinition[];
  sortStack: SortPriority[];
  onApply: (next: SortPriority[]) => void;
};

function getDefinitionMap(columns: SortDefinition[]): Map<string, SortDefinition> {
  return new Map(columns.map((definition) => [definition.column, definition]));
}

export function SortPanel({
  open,
  onOpenChange,
  columns,
  sortStack,
  onApply,
}: SortPanelProps) {
  const columnMap = useMemo(() => getDefinitionMap(columns), [columns]);
  const defaultDefinition = columnMap.get(DEFAULT_SORT_COLUMN);
  const [draftStack, setDraftStack] = useState<SortPriority[]>(() =>
    sanitizeSortStack(sortStack),
  );

  useEffect(() => {
    if (open) {
      setDraftStack(sanitizeSortStack(sortStack));
    }
  }, [open, sortStack]);

  const availableColumns = useMemo(() => {
    const activeColumns = new Set(draftStack.map((entry) => entry.column));
    return columns.filter((column) => !activeColumns.has(column.column));
  }, [columns, draftStack]);

  const hasChanges = !sortStacksEqual(draftStack, sortStack);

  function updateDraft(next: SortPriority[]) {
    setDraftStack(sanitizeSortStack(next));
  }

  function addColumn(column: string) {
    const definition = columnMap.get(column);
    if (!definition) {
      return;
    }
    updateDraft([
      ...draftStack,
      {
        column: definition.column,
        direction: definition.defaultDirection,
      },
    ]);
  }

  function removeColumn(index: number) {
    updateDraft(draftStack.filter((_, position) => position !== index));
  }

  function moveColumn(index: number, offset: number) {
    const target = index + offset;
    if (target < 0 || target >= draftStack.length) {
      return;
    }
    const next = [...draftStack];
    const [entry] = next.splice(index, 1);
    next.splice(target, 0, entry);
    updateDraft(next);
  }

  function toggleDirection(index: number) {
    updateDraft(
      draftStack.map((entry, position) =>
        position === index
          ? {
              column: entry.column,
              direction: entry.direction === "asc" ? "desc" : "asc",
            }
          : entry,
      ),
    );
  }

  function resetDraft() {
    setDraftStack([]);
  }

  function handleApply() {
    onApply(sanitizeSortStack(draftStack));
    onOpenChange(false);
  }

  function handleCancel() {
    onOpenChange(false);
    setDraftStack(sanitizeSortStack(sortStack));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Sort columns</DialogTitle>
          <DialogDescription>
            Build a prioritized sort stack. Priority 1 is applied first, followed by the remaining columns when there are ties.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-medium">Priority list</h3>
                <p className="text-sm text-muted-foreground">
                  Reorder, toggle directions, or remove columns without affecting the live table until you apply changes.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={resetDraft}
                disabled={draftStack.length === 0}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Reset to default
              </Button>
            </div>
            {draftStack.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                No custom priority configured. The table will fall back to{" "}
                <span className="font-medium">
                  {defaultDefinition?.label ?? "Date"} (
                  {defaultDefinition?.defaultDirection === "asc"
                    ? "ascending"
                    : "descending"}
                  )
                </span>{" "}
                until you add columns below.
              </div>
            ) : (
              <ol className="space-y-3">
                {draftStack.map((entry, index) => {
                  const definition = columnMap.get(entry.column);
                  const label = definition?.label ?? entry.column;

                  return (
                    <li
                      key={entry.column}
                      className="flex flex-col gap-3 rounded-md border p-3 shadow-sm sm:flex-row sm:items-center sm:gap-4"
                    >
                      <div className="flex items-center gap-3">
                        <Badge className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium">
                          {index + 1}
                        </Badge>
                        <div>
                          <div className="text-sm font-medium">{label}</div>
                          <div className="text-xs text-muted-foreground">
                            {entry.direction === "asc" ? "Ascending" : "Descending"} · Default{" "}
                            {definition?.defaultDirection === "asc" ? "ascending" : "descending"}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => toggleDirection(index)}
                          aria-label={`Toggle sort direction for ${label}`}
                        >
                          {entry.direction === "asc" ? (
                            <ArrowUp className="mr-2 h-4 w-4" />
                          ) : (
                            <ArrowDown className="mr-2 h-4 w-4" />
                          )}
                          {entry.direction === "asc" ? "Asc" : "Desc"}
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => moveColumn(index, -1)}
                          disabled={index === 0}
                          aria-label={`Move ${label} up`}
                        >
                          <MoveUp className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => moveColumn(index, 1)}
                          disabled={index === draftStack.length - 1}
                          aria-label={`Move ${label} down`}
                        >
                          <MoveDown className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => removeColumn(index)}
                          aria-label={`Remove ${label} from sort priority`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-medium">Add columns</h3>
              <p className="text-sm text-muted-foreground">
                Select additional columns to break ties further down the list. They’ll be added to the bottom of the priority stack.
              </p>
            </div>
            {availableColumns.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                All sortable columns are already in the priority list.
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {availableColumns.map((column) => (
                  <div
                    key={column.column}
                    className="flex items-center justify-between gap-3 rounded-md border p-3"
                  >
                    <div>
                      <div className="text-sm font-medium">{column.label}</div>
                      <div className="text-xs text-muted-foreground">
                        Default {column.defaultDirection === "asc" ? "ascending" : "descending"}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => addColumn(column.column)}
                      aria-label={`Add ${column.label} to sort priority`}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Changes are only applied to the table once you confirm below.
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleApply}
              disabled={!hasChanges}
            >
              <ArrowUpDown className="mr-2 h-4 w-4" />
              Apply sort
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
