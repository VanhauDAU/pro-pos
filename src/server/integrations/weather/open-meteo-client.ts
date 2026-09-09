export class OpenMeteoError extends Error {
  constructor(
    public readonly code: 'TIMEOUT' | 'NETWORK_ERROR' | 'HTTP_ERROR' | 'INVALID_RESPONSE',
    message: string,
    public readonly status?: number | undefined,
  ) {
    super(message);
    this.name = 'OpenMeteoError';
  }
}

export interface RawOpenMeteoResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  current?:
    | {
        time: string;
        temperature_2m: number;
        apparent_temperature: number;
        relative_humidity_2m: number;
        weather_code: number;
        is_day: number;
        precipitation: number;
        wind_speed_10m: number;
      }
    | undefined;
  hourly?:
    | {
        time: string[];
        temperature_2m: number[];
        precipitation_probability: number[];
        weather_code: number[];
      }
    | undefined;
  daily?:
    | {
        time: string[];
        weather_code: number[];
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        precipitation_probability_max: number[];
        precipitation_sum: number[];
      }
    | undefined;
}

export interface OpenMeteoClientOptions {
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  timeoutMs?: number | undefined;
  fetchFn?: typeof fetch | undefined;
}

export class OpenMeteoClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: OpenMeteoClientOptions = {}) {
    this.baseUrl = (options.baseUrl || 'https://api.open-meteo.com').replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.fetchFn = options.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
  }

  async fetchForecast(coords: {
    latitude: number;
    longitude: number;
  }): Promise<RawOpenMeteoResponse> {
    const url = new URL(`${this.baseUrl}/v1/forecast`);
    url.searchParams.set('latitude', coords.latitude.toString());
    url.searchParams.set('longitude', coords.longitude.toString());
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set(
      'current',
      'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,precipitation,wind_speed_10m',
    );
    url.searchParams.set('hourly', 'temperature_2m,precipitation_probability,weather_code');
    url.searchParams.set('forecast_hours', '12');
    url.searchParams.set(
      'daily',
      'temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,weather_code',
    );
    url.searchParams.set('forecast_days', '3');

    if (this.apiKey) {
      url.searchParams.set('apikey', this.apiKey);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchFn(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'ProPOS-Weather/1.0',
        },
        signal: controller.signal,
      });
    } catch (err: unknown) {
      if (controller.signal.aborted) {
        throw new OpenMeteoError('TIMEOUT', `Open-Meteo API timed out after ${this.timeoutMs}ms`);
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new OpenMeteoError('NETWORK_ERROR', `Lỗi kết nối tới Open-Meteo: ${message}`);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new OpenMeteoError(
        'HTTP_ERROR',
        `Open-Meteo API trả về lỗi HTTP ${response.status}`,
        response.status,
      );
    }

    try {
      const data = (await response.json()) as RawOpenMeteoResponse;
      if (!data || typeof data !== 'object') {
        throw new Error('Response is not a valid JSON object');
      }
      return data;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new OpenMeteoError('INVALID_RESPONSE', `Dữ liệu thời tiết không hợp lệ: ${message}`);
    }
  }
}
