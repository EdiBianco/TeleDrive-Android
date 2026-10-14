import React from "react";
import { cn } from "@/lib/utils";

interface FolderIconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
  size?: "sm" | "md" | "lg";
}

export function FolderIcon({ className, size = "md", ...props }: FolderIconProps) {
  const sizeClasses = {
    sm: "h-4.5 w-4.5",
    md: "h-5 w-5",
    lg: "h-8 w-8",
  };

  return (
    <svg
      className={cn(
        "text-[#444746] dark:text-[#c4c7c5] fill-current shrink-0 transition-transform duration-200 group-hover:scale-105",
        sizeClasses[size],
        className
      )}
      viewBox="0 0 24 24"
      fill="currentColor"
      {...props}
    >
      <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
    </svg>
  );
}
