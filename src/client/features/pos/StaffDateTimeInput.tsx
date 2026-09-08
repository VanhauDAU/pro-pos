import { CalendarOutlined, ClockCircleOutlined, CloseCircleFilled } from '@ant-design/icons';
import dayjs from 'dayjs';
import React, { useRef } from 'react';

export interface StaffDateTimeInputProps {
  idPrefix?: string;
  value: dayjs.Dayjs | null;
  onChange: (value: dayjs.Dayjs | null) => void;
  disabled?: boolean;
  allowClear?: boolean;
  placeholderDate?: string;
  placeholderTime?: string;
  className?: string;
}

export const StaffDateTimeInput: React.FC<StaffDateTimeInputProps> = ({
  idPrefix = 'staff-dt',
  value,
  onChange,
  disabled = false,
  allowClear = false,
  placeholderDate = 'Chọn ngày',
  placeholderTime = 'Chọn giờ',
  className = '',
}) => {
  const dateInputRef = useRef<HTMLInputElement>(null);
  const timeInputRef = useRef<HTMLInputElement>(null);

  const dateValueStr = value && value.isValid() ? value.format('YYYY-MM-DD') : '';
  const timeValueStr = value && value.isValid() ? value.format('HH:mm') : '';

  const displayDateStr = value && value.isValid() ? value.format('DD/MM/YYYY') : '';
  const displayTimeStr = value && value.isValid() ? value.format('HH:mm') : '';

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextDate = e.target.value; // YYYY-MM-DD
    if (!nextDate) return;
    const [year, month, day] = nextDate.split('-').map(Number);
    if (!year || !month || !day) return;

    if (value && value.isValid()) {
      onChange(
        value
          .clone()
          .year(year)
          .month(month - 1)
          .date(day),
      );
    } else {
      // If value was null, initialize with today's current time on the selected date
      const base = dayjs();
      onChange(
        base
          .year(year)
          .month(month - 1)
          .date(day),
      );
    }
  };

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextTime = e.target.value; // HH:mm
    if (!nextTime) return;
    const [hours, minutes] = nextTime.split(':').map(Number);
    if (hours === undefined || minutes === undefined) return;

    if (value && value.isValid()) {
      onChange(value.clone().hour(hours).minute(minutes).second(0));
    } else {
      // If value was null, initialize with today on the selected time
      const base = dayjs();
      onChange(base.hour(hours).minute(minutes).second(0));
    }
  };

  const triggerDatePicker = () => {
    if (disabled) return;
    try {
      dateInputRef.current?.showPicker?.();
    } catch {
      dateInputRef.current?.focus();
    }
  };

  const triggerTimePicker = () => {
    if (disabled) return;
    try {
      timeInputRef.current?.showPicker?.();
    } catch {
      timeInputRef.current?.focus();
    }
  };

  return (
    <div className={`staff-datetime-split ${className}`.trim()}>
      {/* Cột Ngày */}
      <div
        className={`staff-datetime-box ${disabled ? 'staff-datetime-box--disabled' : ''}`}
        onClick={triggerDatePicker}
        title="Chọn ngày"
      >
        <CalendarOutlined className="staff-datetime-box__icon" />
        <div className="staff-datetime-box__content">
          <span className="staff-datetime-box__tag">Ngày</span>
          <span
            className={`staff-datetime-box__value ${!displayDateStr ? 'staff-datetime-box__value--placeholder' : ''}`}
          >
            {displayDateStr || placeholderDate}
          </span>
        </div>
        <input
          ref={dateInputRef}
          id={`${idPrefix}-date`}
          type="date"
          value={dateValueStr}
          onChange={handleDateChange}
          disabled={disabled}
          className="staff-datetime-box__native"
          aria-label="Chọn ngày"
        />
      </div>

      {/* Cột Giờ */}
      <div
        className={`staff-datetime-box ${disabled ? 'staff-datetime-box--disabled' : ''}`}
        onClick={triggerTimePicker}
        title="Chọn giờ"
      >
        <ClockCircleOutlined className="staff-datetime-box__icon" />
        <div className="staff-datetime-box__content">
          <span className="staff-datetime-box__tag">Giờ (24h)</span>
          <span
            className={`staff-datetime-box__value staff-datetime-box__value--time ${!displayTimeStr ? 'staff-datetime-box__value--placeholder' : ''}`}
          >
            {displayTimeStr || placeholderTime}
          </span>
        </div>
        <input
          ref={timeInputRef}
          id={`${idPrefix}-time`}
          type="time"
          value={timeValueStr}
          onChange={handleTimeChange}
          disabled={disabled}
          className="staff-datetime-box__native"
          aria-label="Chọn giờ"
        />
        {allowClear && Boolean(value) && !disabled && (
          <button
            type="button"
            className="staff-datetime-clear-btn"
            title="Xóa giờ ra (để trống tính đến hiện tại)"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
          >
            <CloseCircleFilled />
          </button>
        )}
      </div>
    </div>
  );
};
