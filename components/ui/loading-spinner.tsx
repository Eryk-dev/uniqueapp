import { cn } from "@/lib/utils";

interface LoadingSpinnerProps {
  message?: string;
  size?: "sm" | "md";
}

export function LoadingSpinner({ message, size = "md" }: LoadingSpinnerProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12">
      <div
        className={cn(
          "rounded-full border-2 border-line border-t-ink animate-spin",
          size === "sm" ? "w-5 h-5" : "w-7 h-7"
        )}
      />
      {message && (
        <p className="text-xs text-ink-muted">{message}</p>
      )}
    </div>
  );
}
