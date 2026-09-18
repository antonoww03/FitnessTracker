import React from "react";
import { format } from "date-fns";
import { Calendar } from "../components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Button } from "../components/ui/button";
import { CalendarDays, Activity, ChevronLeft, ChevronRight } from "lucide-react";

export const Header = ({ selectedDate, onDateChange, totalTrainingMinutes }) => {
  const dateObj = new Date(selectedDate + "T00:00:00");
  const isToday = selectedDate === format(new Date(), "yyyy-MM-dd");

  const goToPrev = () => {
    const d = new Date(dateObj);
    d.setDate(d.getDate() - 1);
    onDateChange(format(d, "yyyy-MM-dd"));
  };

  const goToNext = () => {
    const d = new Date(dateObj);
    d.setDate(d.getDate() + 1);
    onDateChange(format(d, "yyyy-MM-dd"));
  };

  const goToToday = () => {
    onDateChange(format(new Date(), "yyyy-MM-dd"));
  };

  return (
    <header className="ft-header" data-testid="app-header">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-md bg-[#007AFF] flex items-center justify-center">
          <Activity className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="ft-brand">
            EGT Digital Track
          </h1>
          <p className="ft-brand-subtitle">
            {totalTrainingMinutes > 0
              ? `${totalTrainingMinutes} min trained ${isToday ? "today" : "on this date"}`
              : "Personal dashboard"}
          </p>
        </div>
      </div>

      <div className="ft-date-controls">
        <Button
          variant="ghost"
          size="icon"
          onClick={goToPrev}
          className="h-8 w-8 text-[#A0A0A0] hover:text-white hover:bg-[#2A2A2A]"
          aria-label="Previous day"
          data-testid="prev-day-button"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              className="h-8 px-3 text-sm font-body text-[#A0A0A0] hover:text-white hover:bg-[#2A2A2A] gap-1.5"
              data-testid="date-picker-trigger"
            >
              <CalendarDays className="h-3.5 w-3.5" />
              {isToday ? "Today" : format(dateObj, "MMM d, yyyy")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 bg-[#141414] border-[#2A2A2A]" align="end">
            <Calendar
              mode="single"
              selected={dateObj}
              onSelect={(d) => {
                if (d) onDateChange(format(d, "yyyy-MM-dd"));
              }}
              className="text-white"
              data-testid="date-calendar"
            />
            {!isToday && (
              <div className="px-3 pb-3">
                <Button
                  onClick={goToToday}
                  variant="ghost"
                  className="w-full text-xs text-[#007AFF] hover:bg-[#007AFF]/10 h-8 font-body"
                  data-testid="go-to-today-button"
                >
                  Go to Today
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        <Button
          variant="ghost"
          size="icon"
          onClick={goToNext}
          className="h-8 w-8 text-[#A0A0A0] hover:text-white hover:bg-[#2A2A2A]"
          aria-label="Next day"
          data-testid="next-day-button"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
};
