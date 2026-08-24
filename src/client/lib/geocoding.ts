export interface GeocodingResult {
  placeId: string | number;
  displayName: string;
  latitude: number;
  longitude: number;
  type?: string | undefined;
}

export interface GeocodingProvider {
  search(query: string): Promise<GeocodingResult[]>;
  reverse?(latitude: number, longitude: number): Promise<string | null>;
}

class NominatimGeocodingProvider implements GeocodingProvider {
  private cache = new Map<string, GeocodingResult[]>();
  private readonly baseUrl = 'https://nominatim.openstreetmap.org';

  async search(query: string): Promise<GeocodingResult[]> {
    const trimmed = query.trim();
    if (trimmed.length < 3) return [];

    const cacheKey = trimmed.toLowerCase();
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    try {
      const url = `${this.baseUrl}/search?format=json&q=${encodeURIComponent(trimmed)}&countrycodes=vn&limit=5`;
      const response = await fetch(url, {
        headers: {
          'Accept-Language': 'vi,en;q=0.9',
        },
      });

      if (!response.ok) return [];
      const data = (await response.json()) as Array<{
        place_id: number | string;
        display_name: string;
        lat: string;
        lon: string;
        type?: string;
      }>;

      const results: GeocodingResult[] = data.map((item) => ({
        placeId: item.place_id,
        displayName: item.display_name,
        latitude: parseFloat(item.lat),
        longitude: parseFloat(item.lon),
        type: item.type,
      }));

      // Cache up to 100 queries
      if (this.cache.size > 100) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey) this.cache.delete(firstKey);
      }
      this.cache.set(cacheKey, results);

      return results;
    } catch {
      return [];
    }
  }

  async reverse(latitude: number, longitude: number): Promise<string | null> {
    try {
      const url = `${this.baseUrl}/reverse?format=json&lat=${latitude}&lon=${longitude}`;
      const response = await fetch(url, {
        headers: {
          'Accept-Language': 'vi,en;q=0.9',
        },
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { display_name?: string };
      return data.display_name ?? null;
    } catch {
      return null;
    }
  }
}

export const defaultGeocodingProvider: GeocodingProvider = new NominatimGeocodingProvider();
