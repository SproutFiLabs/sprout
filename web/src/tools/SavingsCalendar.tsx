import { useId, useMemo, useState } from "react";
import { buildSavingsCalendarIcs, defaultReminderDate, reminderDates, validateSavingsCalendarOptions } from "./savings-calendar-utils";
import "./savings-calendar.css";

export function SavingsCalendar({ monthly, months }: { monthly: number; months: number }) {
  const id = useId();
  const [firstReminder, setFirstReminder] = useState(defaultReminderDate());
  const [includeAmount, setIncludeAmount] = useState(false);
  const [error, setError] = useState("");
  const dates = useMemo(() => {
    try {
      return reminderDates(firstReminder, months);
    } catch {
      return [];
    }
  }, [firstReminder, months]);
  const valid =
    dates.length === months &&
    (() => {
      try {
        validateSavingsCalendarOptions({ firstReminder, monthly, months });
        return true;
      } catch {
        return false;
      }
    })();
  function download() {
    try {
      validateSavingsCalendarOptions({ firstReminder, monthly, months, includeAmount });
      const url = URL.createObjectURL(
        new Blob([buildSavingsCalendarIcs({ firstReminder, monthly, months, includeAmount })], { type: "text/calendar;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "sprout-savings-reminders.ics";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check your calendar details.");
    }
  }
  const validationMessage = firstReminder && !valid ? "Choose a real date and check the calendar length before downloading." : "";
  return (
    <section className="savings-calendar" aria-labelledby={`${id}-title`}>
      <div>
        <p className="tools-eyebrow">A gentle nudge</p>
        <h2 id={`${id}-title`}>Save a little, regularly.</h2>
        <p className="savings-calendar-copy">
          Create private monthly reminders in your calendar. The file is created on your device. Import it into your calendar; no investment
          is made.
        </p>
      </div>
      <label className="tools-field">
        First reminder
        <input
          type="date"
          value={firstReminder}
          onChange={(event) => setFirstReminder(event.target.value)}
          aria-describedby={`${id}-help`}
        />
      </label>
      <label className="savings-calendar-check">
        <input type="checkbox" checked={includeAmount} onChange={(event) => setIncludeAmount(event.target.checked)} /> Include the monthly
        amount in each reminder
      </label>
      <p id={`${id}-help`} className="tools-field-note">
        {months} monthly reminders, with dates clamped to the last day of shorter months.
      </p>
      <div className="savings-calendar-preview">
        <strong>Preview</strong>
        {valid ? (
          dates.slice(0, 3).map((date) => (
            <span key={date}>
              {date}
              {includeAmount ? ` · USD $${monthly.toFixed(2)}` : ""}
            </span>
          ))
        ) : (
          <span>Enter a valid first reminder to preview the schedule.</span>
        )}
        {valid && dates.length > 3 && <span>… and {dates.length - 3} more</span>}
      </div>
      {validationMessage && (
        <p className="savings-calendar-error" role="alert">
          {validationMessage}
        </p>
      )}
      {error && (
        <p className="savings-calendar-error" role="alert">
          {error}
        </p>
      )}
      <button className="tools-prepare" type="button" onClick={download} disabled={!valid}>
        Download calendar (.ics)
      </button>
    </section>
  );
}
