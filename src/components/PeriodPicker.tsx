import { useEffect, useMemo, useState } from "react";
import { CalendarRange, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { STR, tr } from "@/utils/i18n";
import { endOfDay, startOfDay, type DateInterval } from "@/utils/statementPeriod";

export type PeriodSelection =
  | { kind: "all" }
  | { kind: "year"; year: number }
  | { kind: "month"; year: number; month: number } // month: 0-11
  | { kind: "custom"; from: Date; to: Date };

export const selectionToInterval = (sel: PeriodSelection): DateInterval | null => {
  switch (sel.kind) {
    case "all":
      return null;
    case "year":
      return { from: new Date(sel.year, 0, 1), to: endOfDay(new Date(sel.year, 11, 31)) };
    case "month":
      return { from: new Date(sel.year, sel.month, 1), to: endOfDay(new Date(sel.year, sel.month + 1, 0)) };
    case "custom":
      return { from: startOfDay(sel.from), to: endOfDay(sel.to) };
  }
};

const locale = (isEnglish: boolean) => (isEnglish ? "en-US" : "es-CO");
const fmtDay = (d: Date, isEnglish: boolean) =>
  d.toLocaleDateString(locale(isEnglish), { year: "numeric", month: "short", day: "numeric" });
export const fmtMonth = (year: number, month: number, isEnglish: boolean) => {
  const s = new Date(year, month, 1).toLocaleDateString(locale(isEnglish), { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const selectionLabel = (sel: PeriodSelection, isEnglish: boolean) => {
  switch (sel.kind) {
    case "all":
      return tr(STR.periodAll, isEnglish);
    case "year":
      return `${tr(STR.yearWord, isEnglish)} ${sel.year}`;
    case "month":
      return fmtMonth(sel.year, sel.month, isEnglish);
    case "custom":
      return `${fmtDay(sel.from, isEnglish)} – ${fmtDay(sel.to, isEnglish)}`;
  }
};

/** yyyy-mm-dd for <input type="date"> (local time, not UTC). */
const toInputValue = (d?: Date) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "";
const fromInputValue = (s: string) => {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : undefined;
};

interface PeriodPickerProps {
  value: PeriodSelection;
  onChange: (value: PeriodSelection) => void;
  /** Months that actually have transactions, as "YYYY-MM" — drives the Year and Month lists. */
  monthsWithData: string[];
  /** Days that have at least one transaction — marked in the calendar so it's obvious where data is. */
  daysWithData?: Date[];
  isEnglish: boolean;
}

/** All / Year / Month / Custom period filter. The custom range picker always starts a fresh range
 * on the click after a completed one (react-day-picker's default instead stretches the existing
 * range, which reads as "it won't let me pick the dates I want"), jumps months/years via dropdowns,
 * accepts typed dates, and offers one-click presets. */
const PeriodPicker = ({ value, onChange, monthsWithData, daysWithData = [], isEnglish }: PeriodPickerProps) => {
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState<Date | undefined>(value.kind === "custom" ? value.from : undefined);
  const [draftTo, setDraftTo] = useState<Date | undefined>(value.kind === "custom" ? value.to : undefined);

  const latestDataMonth = useMemo(() => {
    const last = [...monthsWithData].sort().pop();
    if (!last) return new Date();
    const [y, m] = last.split("-").map(Number);
    return new Date(y, m - 1, 1);
  }, [monthsWithData]);
  // Two months are shown; start one month before the latest data so that month is fully visible.
  const [viewMonth, setViewMonth] = useState<Date>(
    new Date(latestDataMonth.getFullYear(), latestDataMonth.getMonth() - 1, 1)
  );

  useEffect(() => {
    if (!open) return;
    const from = value.kind === "custom" ? value.from : undefined;
    const to = value.kind === "custom" ? value.to : undefined;
    setDraftFrom(from);
    setDraftTo(to);
    const anchor = from || latestDataMonth;
    setViewMonth(new Date(anchor.getFullYear(), anchor.getMonth() - (from ? 0 : 1), 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const years = useMemo(
    () => Array.from(new Set(monthsWithData.map((m) => Number(m.slice(0, 4))))).sort((a, b) => b - a),
    [monthsWithData]
  );
  const months = useMemo(() => [...monthsWithData].sort().reverse(), [monthsWithData]);

  const thisYear = new Date().getFullYear();
  const minYear = Math.min(thisYear - 10, ...(years.length ? years : [thisYear]));

  const handleDayClick = (day: Date) => {
    if (!draftFrom || draftTo) {
      setDraftFrom(day);
      setDraftTo(undefined);
    } else if (day < draftFrom) {
      setDraftTo(draftFrom);
      setDraftFrom(day);
    } else {
      setDraftTo(day);
    }
  };

  const applyPreset = (from: Date, to: Date) => {
    setDraftFrom(from);
    setDraftTo(to);
    setViewMonth(new Date(from.getFullYear(), from.getMonth(), 1));
  };

  const today = new Date();
  const presets: { label: string; range: () => [Date, Date] }[] = [
    {
      label: tr(STR.presetLastMonth, isEnglish),
      range: () => [new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 0)],
    },
    { label: tr(STR.presetLast3Months, isEnglish), range: () => [new Date(today.getFullYear(), today.getMonth() - 3, today.getDate()), today] },
    { label: tr(STR.presetLast6Months, isEnglish), range: () => [new Date(today.getFullYear(), today.getMonth() - 6, today.getDate()), today] },
    { label: tr(STR.presetLast12Months, isEnglish), range: () => [new Date(today.getFullYear(), today.getMonth() - 12, today.getDate()), today] },
    { label: tr(STR.presetThisYear, isEnglish), range: () => [new Date(thisYear, 0, 1), new Date(thisYear, 11, 31)] },
    { label: `${tr(STR.presetLastYear, isEnglish)} (${thisYear - 1})`, range: () => [new Date(thisYear - 1, 0, 1), new Date(thisYear - 1, 11, 31)] },
  ];
  // Data-driven shortcuts too: the client's statements are often from an earlier year than today's.
  years
    .filter((y) => y !== thisYear && y !== thisYear - 1)
    .forEach((y) => presets.push({ label: `${tr(STR.yearWord, isEnglish)} ${y}`, range: () => [new Date(y, 0, 1), new Date(y, 11, 31)] }));

  const canApply = !!draftFrom && !!draftTo;
  const apply = () => {
    if (!draftFrom || !draftTo) return;
    onChange({ kind: "custom", from: draftFrom, to: draftTo });
    setOpen(false);
  };

  const segment = (active: boolean) =>
    cn(
      "h-9 px-3 rounded-md text-sm font-medium transition-colors",
      active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1">
        <button type="button" className={segment(value.kind === "all")} onClick={() => onChange({ kind: "all" })}>
          {tr(STR.periodAll, isEnglish)}
        </button>

        <Select
          value={value.kind === "year" ? String(value.year) : ""}
          onValueChange={(v) => onChange({ kind: "year", year: Number(v) })}
          disabled={years.length === 0}
        >
          <SelectTrigger className={cn(segment(value.kind === "year"), "w-auto border-0 gap-1 focus:ring-0")}>
            <SelectValue placeholder={tr(STR.periodYear, isEnglish)} />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>{`${tr(STR.yearWord, isEnglish)} ${y}`}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={value.kind === "month" ? `${value.year}-${String(value.month + 1).padStart(2, "0")}` : ""}
          onValueChange={(v) => {
            const [y, m] = v.split("-").map(Number);
            onChange({ kind: "month", year: y, month: m - 1 });
          }}
          disabled={months.length === 0}
        >
          <SelectTrigger className={cn(segment(value.kind === "month"), "w-auto border-0 gap-1 focus:ring-0")}>
            <SelectValue placeholder={tr(STR.periodMonth, isEnglish)} />
          </SelectTrigger>
          <SelectContent>
            {months.map((key) => {
              const [y, m] = key.split("-").map(Number);
              return <SelectItem key={key} value={key}>{fmtMonth(y, m - 1, isEnglish)}</SelectItem>;
            })}
          </SelectContent>
        </Select>

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button type="button" className={cn(segment(value.kind === "custom"), "inline-flex items-center gap-1.5")}>
              <CalendarRange className="h-4 w-4" />
              {value.kind === "custom" ? selectionLabel(value, isEnglish) : tr(STR.periodCustom, isEnglish)}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <div className="flex flex-col md:flex-row">
              <div className="flex md:flex-col gap-1 p-3 border-b md:border-b-0 md:border-r border-border overflow-x-auto md:w-44">
                {presets.map((p) => (
                  <Button
                    key={p.label}
                    type="button" variant="ghost" size="sm"
                    className="justify-start shrink-0 text-xs"
                    onClick={() => applyPreset(...p.range())}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>

              <div>
                <div className="grid grid-cols-2 gap-3 px-3 pt-3">
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">{tr(STR.fromLabel, isEnglish)}</span>
                    <input
                      type="date"
                      value={toInputValue(draftFrom)}
                      onChange={(e) => {
                        const d = fromInputValue(e.target.value);
                        setDraftFrom(d);
                        if (d) setViewMonth(new Date(d.getFullYear(), d.getMonth(), 1));
                        if (d && draftTo && d > draftTo) setDraftTo(undefined);
                      }}
                      className="w-full h-9 rounded-md border border-border bg-muted px-2 text-sm text-foreground"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">{tr(STR.toLabel, isEnglish)}</span>
                    <input
                      type="date"
                      value={toInputValue(draftTo)}
                      min={toInputValue(draftFrom)}
                      onChange={(e) => setDraftTo(fromInputValue(e.target.value))}
                      className="w-full h-9 rounded-md border border-border bg-muted px-2 text-sm text-foreground"
                    />
                  </label>
                </div>
                <p className="px-3 pt-2 text-xs text-muted-foreground">
                  {!draftFrom || draftTo ? tr(STR.pickStartDay, isEnglish) : tr(STR.pickEndDay, isEnglish)}
                </p>

                <Calendar
                  mode="range"
                  selected={{ from: draftFrom, to: draftTo }}
                  onSelect={(_range, day) => handleDayClick(day)}
                  month={viewMonth}
                  onMonthChange={setViewMonth}
                  numberOfMonths={2}
                  captionLayout="dropdown-buttons"
                  fromYear={minYear}
                  toYear={thisYear + 1}
                  modifiers={{ hasData: daysWithData }}
                  modifiersClassNames={{ hasData: "underline decoration-primary decoration-2 underline-offset-4 font-semibold" }}
                />

                <div className="flex items-center justify-between gap-2 border-t border-border p-3">
                  <span className="text-xs text-muted-foreground">
                    {draftFrom ? fmtDay(draftFrom, isEnglish) : "—"} → {draftTo ? fmtDay(draftTo, isEnglish) : "—"}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      type="button" size="sm" variant="ghost"
                      onClick={() => { setDraftFrom(undefined); setDraftTo(undefined); }}
                    >
                      <X className="h-3.5 w-3.5 mr-1" />
                      {tr(STR.clearWord, isEnglish)}
                    </Button>
                    <Button type="button" size="sm" disabled={!canApply} onClick={apply}>
                      {tr(STR.applyWord, isEnglish)}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
};

export default PeriodPicker;
