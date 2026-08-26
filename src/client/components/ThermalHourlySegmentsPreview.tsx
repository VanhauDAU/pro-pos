interface ThermalHourlySegmentsPreviewProps {
  paperSize: 'K58' | 'K80';
  showUnitPrice: boolean;
  showUnitDuration: boolean;
  showSeconds: boolean;
}

const segments = [
  {
    range: ['18:00 - 18:30', '18:00:00 - 18:30:00'],
    price: '60,000',
    total: '60,000',
    duration: '=Giờ đầu',
  },
  {
    range: ['18:30 - 19:30', '18:30:00 - 19:30:00'],
    price: '40,000',
    total: '40,000',
    duration: '=1 giờ',
  },
  {
    range: ['19:30 - 20:30', '19:30:00 - 20:30:00'],
    price: '50,000',
    total: '50,000',
    duration: '=1 giờ',
  },
];

/** Mirrors the shared thermal renderer: price and total align with the time range. */
export function ThermalHourlySegmentsPreview({
  paperSize,
  showUnitPrice,
  showUnitDuration,
  showSeconds,
}: ThermalHourlySegmentsPreviewProps) {
  const isK58 = paperSize === 'K58';
  const columnWidth = isK58 ? 48 : 65;

  return (
    <div className="thermal-receipt-item-sub">
      {segments.map((segment, index) => (
        <div key={segment.price} style={{ marginTop: index === 0 ? 3 : 6 }}>
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <span style={{ flex: 1 }}>{segment.range[showSeconds ? 1 : 0]}</span>
            {!isK58 && showUnitPrice ? (
              <span style={{ width: 65, textAlign: 'right', whiteSpace: 'nowrap' }}>
                {segment.price}
                {showUnitDuration ? '/1h' : ''}
              </span>
            ) : null}
            <span style={{ width: columnWidth, textAlign: 'right', fontWeight: 600 }}>
              {segment.total}
            </span>
          </div>
          <div>20/06/2024</div>
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <span style={{ flex: 1, color: '#64748b' }}>{segment.duration}</span>
            {!isK58 && showUnitPrice ? <span style={{ width: 65 }} /> : null}
            <span style={{ width: columnWidth }} />
          </div>
          {isK58 && showUnitPrice ? (
            <div className="thermal-receipt-item-sub">
              Đ.Giá: {segment.price}
              {showUnitDuration ? '/1h' : ''}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
