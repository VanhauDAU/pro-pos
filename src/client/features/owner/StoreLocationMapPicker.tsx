import { AimOutlined, EnvironmentOutlined, SearchOutlined } from '@ant-design/icons';
import { AutoComplete, Button, Input, InputNumber, Space, Spin, Typography, message } from 'antd';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';

import { defaultGeocodingProvider, type GeocodingResult } from '@client/lib/geocoding';

// Fix Leaflet's default marker icons in bundlers
const defaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface StoreLocationMapPickerProps {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  radiusMeters: number;
  maxAccuracyMeters: number;
  initialAddress?: string | null;
  onChange: (coords: { latitude: number; longitude: number }) => void;
  onRadiusChange?: (radius: number) => void;
  onMaxAccuracyChange?: (accuracy: number) => void;
}

const DEFAULT_CENTER: [number, number] = [16.0544, 108.2022]; // Da Nang, Vietnam center default

export function StoreLocationMapPicker({
  latitude,
  longitude,
  radiusMeters,
  maxAccuracyMeters,
  initialAddress: _initialAddress,
  onChange,
  onRadiusChange,
  onMaxAccuracyChange,
}: StoreLocationMapPickerProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GeocodingResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const currentLat = typeof latitude === 'number' ? latitude : DEFAULT_CENTER[0];
  const currentLng = typeof longitude === 'number' ? longitude : DEFAULT_CENTER[1];
  const hasCoords = typeof latitude === 'number' && typeof longitude === 'number';

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [currentLat, currentLng],
      zoom: hasCoords ? 16 : 12,
      attributionControl: true,
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
    }).addTo(map);

    if (hasCoords) {
      const marker = L.marker([latitude, longitude], {
        icon: defaultIcon,
        draggable: true,
      }).addTo(map);

      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        onChange({ latitude: pos.lat, longitude: pos.lng });
      });

      markerRef.current = marker;

      const circle = L.circle([latitude, longitude], {
        radius: radiusMeters,
        color: '#1677ff',
        fillColor: '#1677ff',
        fillOpacity: 0.15,
        weight: 2,
      }).addTo(map);
      circleRef.current = circle;
    }

    map.on('click', (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      onChange({ latitude: lat, longitude: lng });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update marker and circle when coords or radius change
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    if (hasCoords) {
      const pos: [number, number] = [latitude!, longitude!];
      if (markerRef.current) {
        markerRef.current.setLatLng(pos);
      } else {
        const marker = L.marker(pos, {
          icon: defaultIcon,
          draggable: true,
        }).addTo(map);
        marker.on('dragend', () => {
          const p = marker.getLatLng();
          onChange({ latitude: p.lat, longitude: p.lng });
        });
        markerRef.current = marker;
      }

      if (circleRef.current) {
        circleRef.current.setLatLng(pos);
        circleRef.current.setRadius(radiusMeters);
      } else {
        const circle = L.circle(pos, {
          radius: radiusMeters,
          color: '#1677ff',
          fillColor: '#1677ff',
          fillOpacity: 0.15,
          weight: 2,
        }).addTo(map);
        circleRef.current = circle;
      }
    } else {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      if (circleRef.current) {
        circleRef.current.remove();
        circleRef.current = null;
      }
    }
  }, [latitude, longitude, radiusMeters, hasCoords]);

  // Handle Search
  const handleSearch = async (val: string) => {
    setSearchQuery(val);
    if (val.trim().length < 3) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const results = await defaultGeocodingProvider.search(val);
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectPlace = (placeIdStr: string) => {
    const selected = searchResults.find((r) => String(r.placeId) === placeIdStr);
    if (selected) {
      onChange({ latitude: selected.latitude, longitude: selected.longitude });
      if (mapRef.current) {
        mapRef.current.setView([selected.latitude, selected.longitude], 17);
      }
    }
  };

  const handleLocateMe = () => {
    if (!('geolocation' in navigator)) {
      messageApi.error('Trình duyệt của bạn không hỗ trợ định vị GPS.');
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false);
        const { latitude: lat, longitude: lng } = pos.coords;
        onChange({ latitude: lat, longitude: lng });
        if (mapRef.current) {
          mapRef.current.setView([lat, lng], 17);
        }
        messageApi.success('Đã lấy vị trí hiện tại thành công.');
      },
      (err) => {
        setIsLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          messageApi.error('Bạn đã từ chối quyền truy cập vị trí trên trình duyệt.');
        } else {
          messageApi.error('Không thể lấy vị trí hiện tại. Vui lòng thử lại.');
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  };

  return (
    <div className="store-location-picker-container">
      {contextHolder}
      <div className="store-location-picker-toolbar">
        <AutoComplete
          style={{ flex: 1, minWidth: 240 }}
          options={searchResults.map((item) => ({
            value: String(item.placeId),
            label: (
              <div style={{ padding: '4px 0' }}>
                <Typography.Text strong style={{ fontSize: 13, display: 'block' }}>
                  <EnvironmentOutlined style={{ marginRight: 6, color: '#1677ff' }} />
                  {item.displayName.split(',')[0]}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  {item.displayName}
                </Typography.Text>
              </div>
            ),
          }))}
          onSearch={handleSearch}
          onSelect={handleSelectPlace}
          value={searchQuery}
          notFoundContent={
            isSearching ? (
              <div style={{ padding: 8, textAlign: 'center' }}>
                <Spin size="small" />
              </div>
            ) : undefined
          }
        >
          <Input
            placeholder="Tìm kiếm địa chỉ để ghim tọa độ..."
            prefix={<SearchOutlined style={{ color: '#8c8c8c' }} />}
            allowClear
            onPressEnter={() => handleSearch(searchQuery)}
          />
        </AutoComplete>

        <Button
          icon={<AimOutlined />}
          onClick={handleLocateMe}
          loading={isLocating}
          title="Lấy vị trí GPS hiện tại"
        >
          Vị trí của tôi
        </Button>
      </div>

      <div
        ref={mapContainerRef}
        className="store-location-map-canvas"
        style={{
          height: 320,
          width: '100%',
          borderRadius: 8,
          border: '1px solid #d9d9d9',
          marginTop: 12,
          zIndex: 1,
        }}
      />

      <div className="store-location-coords-bar">
        <Space orientation="horizontal" wrap style={{ marginTop: 12, width: '100%' }}>
          <Space>
            <Typography.Text strong style={{ fontSize: 12 }}>
              Vĩ độ (Lat):
            </Typography.Text>
            <InputNumber
              value={latitude ?? null}
              precision={6}
              min={-90}
              max={90}
              step={0.0001}
              style={{ width: 130 }}
              placeholder="VD: 16.0544"
              onChange={(val) => {
                if (typeof val === 'number' && typeof longitude === 'number') {
                  onChange({ latitude: val, longitude });
                }
              }}
            />
          </Space>

          <Space>
            <Typography.Text strong style={{ fontSize: 12 }}>
              Kinh độ (Lng):
            </Typography.Text>
            <InputNumber
              value={longitude ?? null}
              precision={6}
              min={-180}
              max={180}
              step={0.0001}
              style={{ width: 130 }}
              placeholder="VD: 108.2022"
              onChange={(val) => {
                if (typeof latitude === 'number' && typeof val === 'number') {
                  onChange({ latitude, longitude: val });
                }
              }}
            />
          </Space>

          <Space>
            <Typography.Text strong style={{ fontSize: 12 }}>
              Bán kính cho phép:
            </Typography.Text>
            <InputNumber
              value={radiusMeters}
              min={30}
              max={5000}
              step={50}
              addonAfter="m"
              style={{ width: 130 }}
              onChange={(val) => {
                if (typeof val === 'number' && onRadiusChange) {
                  onRadiusChange(val);
                }
              }}
            />
          </Space>

          <Space>
            <Typography.Text strong style={{ fontSize: 12 }}>
              Sai số GPS tối đa:
            </Typography.Text>
            <InputNumber
              value={maxAccuracyMeters}
              min={20}
              max={300}
              step={10}
              addonAfter="m"
              style={{ width: 130 }}
              onChange={(val) => {
                if (typeof val === 'number' && onMaxAccuracyChange) {
                  onMaxAccuracyChange(val);
                }
              }}
            />
          </Space>
        </Space>
        <Typography.Paragraph
          type="secondary"
          style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}
        >
          💡 <em>Mẹo:</em> Nhấp chuột trực tiếp lên bản đồ hoặc kéo ghim màu xanh để tinh chỉnh vị
          trí quán chính xác nhất. Vòng tròn màu xanh đại diện cho bán kính cho phép khách gọi món.
        </Typography.Paragraph>
      </div>
    </div>
  );
}
