import { cn } from "@/lib/utils";

type ToggleGroupOption<T extends string> = {
  value: T;
  label: string;
};

type ToggleGroupProps<T extends string> = {
  value: T;
  onValueChange: (value: T) => void;
  options: ToggleGroupOption<T>[];
  className?: string;
  ariaLabel?: string;
};

export function ToggleGroup<T extends string>({
  value,
  onValueChange,
  options,
  className,
  ariaLabel,
}: ToggleGroupProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onValueChange(option.value)}
            className={cn(
              "rounded px-2.5 py-1 text-xs whitespace-nowrap transition-colors",
              active
                ? "bg-neutral-800 text-foreground"
                : "text-muted hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
