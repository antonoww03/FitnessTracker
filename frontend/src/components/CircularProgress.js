import React from "react";

export const CircularProgress = ({
  size = 120,
  strokeWidth = 8,
  progress = 0,
  color = "#007AFF",
  label = "",
  value = 0,
  unit = "g",
  goal = 0,
  showGoal = true,
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedProgress = Math.min(Math.max(progress, 0), 100);
  const offset = circumference - (clampedProgress / 100) * circumference;
  const center = size / 2;

  return (
    <div className="flex flex-col items-center gap-1.5" data-testid={`circular-progress-${label.toLowerCase()}`}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="block">
          <circle
            cx={center}
            cy={center}
            r={radius}
            className="circular-progress-bg"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={center}
            cy={center}
            r={radius}
            className="circular-progress-bar"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="font-body font-bold tracking-wide"
            style={{ color, fontSize: size > 100 ? '1.5rem' : '0.875rem' }}
          >
            {Math.round(value)}
          </span>
          {showGoal && goal > 0 && (
            <span className="text-[10px] text-[#A0A0A0] font-body">
              / {Math.round(goal)}{unit}
            </span>
          )}
        </div>
      </div>
      {label && (
        <span
          className="font-heading text-xs uppercase tracking-widest font-semibold"
          style={{ color }}
        >
          {label}
        </span>
      )}
    </div>
  );
};
