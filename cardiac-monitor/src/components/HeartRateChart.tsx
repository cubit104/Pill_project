import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { CardiacDeviceReading } from '../types';

interface HeartRateChartProps {
  readings: CardiacDeviceReading[];
  height?: number;
}

const HeartRateChart: React.FC<HeartRateChartProps> = ({ readings, height = 300 }) => {
  const chartData = readings
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    .slice(-50) // Show last 50 readings
    .map(reading => ({
      time: reading.timestamp.toLocaleTimeString(),
      heartRate: reading.heartRate,
      battery: reading.batteryLevel,
      timestamp: reading.timestamp.getTime()
    }));

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white border rounded shadow p-2">
          <p className="mb-1 fw-bold">{label}</p>
          <p className="mb-1 text-danger">
            <i className="fas fa-heartbeat me-1"></i>
            Heart Rate: {payload[0].value} bpm
          </p>
          <p className="mb-0 text-info">
            <i className="fas fa-battery-half me-1"></i>
            Battery: {payload[1]?.value || 'N/A'}%
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis 
          dataKey="time" 
          stroke="#666"
          fontSize={12}
          tick={{ fontSize: 11 }}
        />
        <YAxis 
          yAxisId="heartRate"
          domain={[40, 160]}
          stroke="#dc3545"
          fontSize={12}
          label={{ value: 'Heart Rate (bpm)', angle: -90, position: 'insideLeft' }}
        />
        <YAxis 
          yAxisId="battery"
          orientation="right"
          domain={[0, 100]}
          stroke="#0dcaf0"
          fontSize={12}
          label={{ value: 'Battery (%)', angle: 90, position: 'insideRight' }}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend />
        <Line
          yAxisId="heartRate"
          type="monotone"
          dataKey="heartRate"
          stroke="#dc3545"
          strokeWidth={2}
          dot={{ fill: '#dc3545', strokeWidth: 2, r: 3 }}
          activeDot={{ r: 5, stroke: '#dc3545', strokeWidth: 2 }}
          name="Heart Rate (bpm)"
        />
        <Line
          yAxisId="battery"
          type="monotone"
          dataKey="battery"
          stroke="#0dcaf0"
          strokeWidth={2}
          dot={{ fill: '#0dcaf0', strokeWidth: 2, r: 3 }}
          activeDot={{ r: 5, stroke: '#0dcaf0', strokeWidth: 2 }}
          name="Battery (%)"
        />
      </LineChart>
    </ResponsiveContainer>
  );
};

export default HeartRateChart;