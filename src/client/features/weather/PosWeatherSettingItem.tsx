import React from 'react';
import { Switch } from 'antd';
import { CloudOutlined } from '@ant-design/icons';
import { toast } from 'sonner';
import { usePosWeatherDisplay } from './weather-settings';

export const PosWeatherSettingItem: React.FC = () => {
  const [enabled, setEnabled] = usePosWeatherDisplay();

  const handleToggle = (nextValue: boolean) => {
    setEnabled(nextValue);
    if (nextValue) {
      toast.success('Đã bật hiển thị thời tiết trên POS');
    } else {
      toast.info('Đã tắt hiển thị thời tiết trên POS');
    }
  };

  return (
    <div
      className="staff-more-nav-item"
      onClick={() => handleToggle(!enabled)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 18px',
        cursor: 'pointer',
        borderBottom: '1px solid #f1f5f9',
        transition: 'background 0.15s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: enabled ? '#e0f2fe' : '#f1f5f9',
            color: enabled ? '#0284c7' : '#94a3b8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            transition: 'all 0.2s ease',
          }}
        >
          <CloudOutlined />
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>Hiển thị thời tiết</div>
          <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 2 }}>
            Hiển thị nhiệt độ và cảnh báo thời tiết trên giao diện POS
          </div>
        </div>
      </div>
      <div onClick={(e) => e.stopPropagation()}>
        <Switch
          checked={enabled}
          onChange={handleToggle}
          aria-label="Bật hoặc tắt hiển thị thời tiết"
        />
      </div>
    </div>
  );
};
