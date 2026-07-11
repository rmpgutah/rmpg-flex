import React from 'react';
import { Sun, Cloud, CloudRain, CloudSnow, CloudLightning, CloudDrizzle, CloudFog } from 'lucide-react';
import SpmGroup from '../../pages/dashboard/SpmGroup';

interface WeatherWidgetProps {
  condition?: string;
  temp?: number;
  tempHigh?: number;
  tempLow?: number;
  humidity?: number;
  windSpeed?: number;
  alerts?: string[];
  className?: string;
}

function WeatherIcon({ condition }: { condition?: string }) {
  const c = (condition || '').toLowerCase();
  if (c.includes('thunder') || c.includes('lightning')) return <CloudLightning className="w-6 h-6 text-amber-400" />;
  if (c.includes('rain') || c.includes('drizzle')) return <CloudRain className="w-6 h-6 text-blue-300" />;
  if (c.includes('snow') || c.includes('sleet') || c.includes('ice')) return <CloudSnow className="w-6 h-6 text-cyan-300" />;
  if (c.includes('fog') || c.includes('haze') || c.includes('mist')) return <CloudFog className="w-6 h-6 text-rmpg-400" />;
  if (c.includes('cloud') || c.includes('overcast')) return <Cloud className="w-6 h-6 text-rmpg-400" />;
  if (c.includes('clear') || c.includes('sunny')) return <Sun className="w-6 h-6 text-amber-400" />;
  return <Cloud className="w-6 h-6 text-rmpg-400" />;
}

export default function WeatherWidget({
  condition = 'Clear',
  temp = 72,
  tempHigh = 82,
  tempLow = 62,
  humidity = 35,
  windSpeed = 8,
  alerts = [],
  className = '',
}: WeatherWidgetProps) {
  return (
    <div className={className}>
      <SpmGroup title="Weather">
        <div className="p-3">
          <div className="flex items-center gap-3 mb-2">
            <div className="weather-icon-container">
              <WeatherIcon condition={condition} />
            </div>
            <div>
              <div className="weather-temp text-rmpg-100">{temp}°</div>
              <div className="text-[10px] text-rmpg-400 font-medium">{condition}</div>
            </div>
            <div className="ml-auto text-right">
              <div className="text-[10px] text-rmpg-400 font-semibold uppercase tracking-wider">
                H {tempHigh}° / L {tempLow}°
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 text-[10px] text-rmpg-400">
            <span>Humidity: {humidity}%</span>
            <span>Wind: {windSpeed} mph</span>
          </div>
          {alerts.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {alerts.map((alert, i) => (
                <span key={i} className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-red-900/30 text-red-400 border border-red-800/40">
                  {alert}
                </span>
              ))}
            </div>
          )}
        </div>
      </SpmGroup>
    </div>
  );
}
