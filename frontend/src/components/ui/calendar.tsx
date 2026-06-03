import * as React from "react";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import {
  DayPicker,
  getDefaultClassNames,
  type DayButton,
} from "react-day-picker";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  const defaultClassNames = getDefaultClassNames();

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cx("aui-calendar", className)}
      captionLayout={captionLayout}
      formatters={{
        formatMonthDropdown: date =>
          date.toLocaleString("default", { month: "short" }),
        ...formatters,
      }}
      classNames={{
        root: cx("aui-calendar-root", defaultClassNames.root),
        months: cx("aui-calendar-months", defaultClassNames.months),
        month: cx("aui-calendar-month", defaultClassNames.month),
        nav: cx("aui-calendar-nav", defaultClassNames.nav),
        button_previous: cx("aui-calendar-nav-btn", defaultClassNames.button_previous),
        button_next: cx("aui-calendar-nav-btn", defaultClassNames.button_next),
        month_caption: cx("aui-calendar-caption", defaultClassNames.month_caption),
        dropdowns: cx("aui-calendar-dropdowns", defaultClassNames.dropdowns),
        dropdown_root: cx("aui-calendar-dropdown-root", defaultClassNames.dropdown_root),
        dropdown: cx("aui-calendar-dropdown", defaultClassNames.dropdown),
        caption_label: cx("aui-calendar-caption-label", defaultClassNames.caption_label),
        month_grid: cx("aui-calendar-grid", defaultClassNames.month_grid),
        weekdays: cx("aui-calendar-weekdays", defaultClassNames.weekdays),
        weekday: cx("aui-calendar-weekday", defaultClassNames.weekday),
        week: cx("aui-calendar-week", defaultClassNames.week),
        week_number_header: cx("aui-calendar-week-number", defaultClassNames.week_number_header),
        week_number: cx("aui-calendar-week-number", defaultClassNames.week_number),
        day: cx("aui-calendar-day", defaultClassNames.day),
        range_start: cx("aui-calendar-range-start", defaultClassNames.range_start),
        range_middle: cx("aui-calendar-range-middle", defaultClassNames.range_middle),
        range_end: cx("aui-calendar-range-end", defaultClassNames.range_end),
        today: cx("aui-calendar-today", defaultClassNames.today),
        outside: cx("aui-calendar-outside", defaultClassNames.outside),
        disabled: cx("aui-calendar-disabled", defaultClassNames.disabled),
        hidden: cx("aui-calendar-hidden", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...rootProps }) => (
          <div
            data-slot="calendar"
            ref={rootRef}
            className={cx(className)}
            {...rootProps}
          />
        ),
        Chevron: ({ className, orientation, ...chevronProps }) => {
          if (orientation === "left") {
            return <ChevronLeftIcon className={cx("aui-calendar-chevron", className)} {...chevronProps} />;
          }

          if (orientation === "right") {
            return <ChevronRightIcon className={cx("aui-calendar-chevron", className)} {...chevronProps} />;
          }

          return <ChevronDownIcon className={cx("aui-calendar-chevron", className)} {...chevronProps} />;
        },
        DayButton: CalendarDayButton,
        WeekNumber: ({ children, ...weekNumberProps }) => (
          <td {...weekNumberProps}>
            <div className="aui-calendar-week-number-cell">{children}</div>
          </td>
        ),
        ...components,
      }}
      {...props}
    />
  );
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const defaultClassNames = getDefaultClassNames();
  const ref = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  return (
    <button
      ref={ref}
      type="button"
      data-day={day.date.toLocaleDateString()}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cx("aui-calendar-day-btn", defaultClassNames.day, className)}
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton };
