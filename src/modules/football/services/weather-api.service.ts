import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface WeatherData {
  temperature: number;
  condition: string;
  humidity: number;
  windSpeed: number;
  description: string;
}

@Injectable()
export class WeatherApiService {
  private readonly logger = new Logger(WeatherApiService.name);
  private client: AxiosInstance;
  private readonly apiKey: string;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('openweathermap.apiKey') || '';
    
    this.client = axios.create({
      baseURL: 'https://api.openweathermap.org/data/2.5',
      timeout: 5000,
    });
  }

  /**
   * Get weather for a venue by city name
   */
  async getWeatherByCity(city: string): Promise<WeatherData | null> {
    if (!this.apiKey) {
      this.logger.warn('OpenWeatherMap API key not configured');
      return null;
    }

    try {
      const response = await this.client.get('/weather', {
        params: {
          q: city,
          appid: this.apiKey,
          units: 'metric',
        },
      });

      const data = response.data;
      return {
        temperature: data.main.temp,
        condition: data.weather[0].main,
        humidity: data.main.humidity,
        windSpeed: data.wind.speed,
        description: data.weather[0].description,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch weather for ${city}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get weather by coordinates
   */
  async getWeatherByCoords(lat: number, lon: number): Promise<WeatherData | null> {
    if (!this.apiKey) {
      this.logger.warn('OpenWeatherMap API key not configured');
      return null;
    }

    try {
      const response = await this.client.get('/weather', {
        params: {
          lat,
          lon,
          appid: this.apiKey,
          units: 'metric',
        },
      });

      const data = response.data;
      return {
        temperature: data.main.temp,
        condition: data.weather[0].main,
        humidity: data.main.humidity,
        windSpeed: data.wind.speed,
        description: data.weather[0].description,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch weather for coords ${lat},${lon}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get weather impact on match (simple assessment)
   */
  getWeatherImpact(weather: WeatherData): number {
    let impact = 0;

    // Strong wind affects long balls and set pieces
    if (weather.windSpeed > 15) {
      impact += 0.1;
    }

    // Extreme temperature affects player performance
    if (weather.temperature < 5 || weather.temperature > 30) {
      impact += 0.05;
    }

    // Heavy rain affects ball control
    if (weather.condition.toLowerCase().includes('rain')) {
      impact += 0.05;
    }

    return Math.min(impact, 0.2); // Max 20% impact
  }
}
