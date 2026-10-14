import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import {
  Check,
  Info,
  AlertTriangle,
  AlertCircle,
  Loader2,
} from "lucide-react";

export const Toaster = ({ ...props }: ToasterProps) => {
  const { theme, resolvedTheme } = useTheme();
  const activeTheme = (resolvedTheme || theme || "light") as ToasterProps["theme"];

  return (
    <Sonner
      theme={activeTheme}
      className="toaster group"
      position="bottom-right"
      richColors={false}
      closeButton
      gap={10}
      offset="20px"
      icons={{
        success: (
          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200/80 dark:border-emerald-800/80 text-emerald-600 dark:text-emerald-400 shrink-0 shadow-xs">
            <Check className="h-4 w-4 stroke-[2.5]" />
          </div>
        ),
        info: (
          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-blue-50 dark:bg-blue-950/70 border border-blue-200/80 dark:border-blue-800/80 text-[#0b57d0] dark:text-[#a8c7fa] shrink-0 shadow-xs">
            <Info className="h-4 w-4 stroke-[2.5]" />
          </div>
        ),
        warning: (
          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-amber-50 dark:bg-amber-950/70 border border-amber-200/80 dark:border-amber-800/80 text-amber-600 dark:text-amber-400 shrink-0 shadow-xs">
            <AlertTriangle className="h-4 w-4 stroke-[2.5]" />
          </div>
        ),
        error: (
          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-rose-50 dark:bg-rose-950/70 border border-rose-200/80 dark:border-rose-800/80 text-rose-600 dark:text-rose-400 shrink-0 shadow-xs">
            <AlertCircle className="h-4 w-4 stroke-[2.5]" />
          </div>
        ),
        loading: (
          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-blue-50 dark:bg-blue-950/70 border border-blue-200/80 dark:border-blue-800/80 text-[#0b57d0] dark:text-[#a8c7fa] shrink-0 shadow-xs">
            <Loader2 className="h-4 w-4 animate-spin stroke-[2.5]" />
          </div>
        ),
      }}
      toastOptions={{
        classNames: {
          toast: "teledrive-toast",
          title: "teledrive-toast-title",
          description: "teledrive-toast-description",
          actionButton: "teledrive-toast-action",
          cancelButton: "teledrive-toast-cancel",
          closeButton: "teledrive-toast-close",
        },
      }}
      {...props}
    />
  );
};
