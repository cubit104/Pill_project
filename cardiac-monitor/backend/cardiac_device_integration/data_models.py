"""
Data Models for Cardiac Device Integration

Defines standardized data structures for device readings, patient devices,
and alerts across different manufacturers.
"""

from datetime import datetime
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from enum import Enum


class DeviceType(Enum):
    """Supported cardiac device types"""
    PACEMAKER = "pacemaker"
    ICD = "icd"  # Implantable Cardioverter Defibrillator
    CRT = "crt"  # Cardiac Resynchronization Therapy
    LOOP_RECORDER = "loop_recorder"
    REMOTE_MONITOR = "remote_monitor"


class DeviceStatus(Enum):
    """Device operational status"""
    NORMAL = "normal"
    WARNING = "warning"
    CRITICAL = "critical"
    OFFLINE = "offline"
    MAINTENANCE = "maintenance"


class AlertSeverity(Enum):
    """Alert severity levels"""
    INFO = "info"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass
class DeviceReading:
    """Standardized device reading data structure"""
    device_id: str
    patient_id: str
    manufacturer: str
    reading_type: str
    value: float
    unit: str
    timestamp: datetime
    device_type: DeviceType
    status: DeviceStatus
    raw_data: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for database storage"""
        return {
            "device_id": self.device_id,
            "patient_id": self.patient_id,
            "manufacturer": self.manufacturer,
            "reading_type": self.reading_type,
            "value": self.value,
            "unit": self.unit,
            "timestamp": self.timestamp.isoformat(),
            "device_type": self.device_type.value,
            "status": self.status.value,
            "raw_data": self.raw_data,
            "metadata": self.metadata
        }


@dataclass
class PatientDevice:
    """Patient device information"""
    device_id: str
    patient_id: str
    manufacturer: str
    model: str
    device_type: DeviceType
    implant_date: datetime
    last_communication: Optional[datetime] = None
    battery_level: Optional[float] = None
    status: DeviceStatus = DeviceStatus.NORMAL
    settings: Optional[Dict[str, Any]] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for database storage"""
        return {
            "device_id": self.device_id,
            "patient_id": self.patient_id,
            "manufacturer": self.manufacturer,
            "model": self.model,
            "device_type": self.device_type.value,
            "implant_date": self.implant_date.isoformat(),
            "last_communication": self.last_communication.isoformat() if self.last_communication else None,
            "battery_level": self.battery_level,
            "status": self.status.value,
            "settings": self.settings
        }


@dataclass
class DeviceAlert:
    """Device alert/alarm information"""
    alert_id: str
    device_id: str
    patient_id: str
    manufacturer: str
    alert_type: str
    severity: AlertSeverity
    message: str
    timestamp: datetime
    acknowledged: bool = False
    acknowledged_by: Optional[str] = None
    acknowledged_at: Optional[datetime] = None
    resolved: bool = False
    resolved_at: Optional[datetime] = None
    metadata: Optional[Dict[str, Any]] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for database storage"""
        return {
            "alert_id": self.alert_id,
            "device_id": self.device_id,
            "patient_id": self.patient_id,
            "manufacturer": self.manufacturer,
            "alert_type": self.alert_type,
            "severity": self.severity.value,
            "message": self.message,
            "timestamp": self.timestamp.isoformat(),
            "acknowledged": self.acknowledged,
            "acknowledged_by": self.acknowledged_by,
            "acknowledged_at": self.acknowledged_at.isoformat() if self.acknowledged_at else None,
            "resolved": self.resolved,
            "resolved_at": self.resolved_at.isoformat() if self.resolved_at else None,
            "metadata": self.metadata
        }


class DataValidationRules:
    """Data validation rules for device readings"""
    
    # Normal ranges for common device readings
    NORMAL_RANGES = {
        "heart_rate": {"min": 30, "max": 200, "unit": "bpm"},
        "battery_voltage": {"min": 2.0, "max": 3.5, "unit": "V"},
        "lead_impedance": {"min": 200, "max": 2000, "unit": "ohms"},
        "sensing_threshold": {"min": 0.5, "max": 10.0, "unit": "mV"},
        "pacing_threshold": {"min": 0.25, "max": 5.0, "unit": "V"},
        "episode_count": {"min": 0, "max": 1000, "unit": "count"}
    }
    
    @classmethod
    def validate_reading(cls, reading: DeviceReading) -> List[str]:
        """Validate a device reading against normal ranges"""
        violations = []
        
        if reading.reading_type in cls.NORMAL_RANGES:
            range_info = cls.NORMAL_RANGES[reading.reading_type]
            
            if reading.value < range_info["min"]:
                violations.append(f"{reading.reading_type} below normal range: {reading.value} < {range_info['min']} {range_info['unit']}")
            
            if reading.value > range_info["max"]:
                violations.append(f"{reading.reading_type} above normal range: {reading.value} > {range_info['max']} {range_info['unit']}")
            
            if reading.unit != range_info["unit"]:
                violations.append(f"Unit mismatch for {reading.reading_type}: expected {range_info['unit']}, got {reading.unit}")
        
        return violations


# Database schema definitions for cardiac device data
DEVICE_READINGS_SCHEMA = """
CREATE TABLE IF NOT EXISTS device_readings (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(100) NOT NULL,
    patient_id VARCHAR(100) NOT NULL,
    manufacturer VARCHAR(50) NOT NULL,
    reading_type VARCHAR(100) NOT NULL,
    value DECIMAL(10,4) NOT NULL,
    unit VARCHAR(20) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    device_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL,
    raw_data JSONB,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    INDEX (device_id, timestamp),
    INDEX (patient_id, timestamp),
    INDEX (manufacturer, timestamp)
);
"""

PATIENT_DEVICES_SCHEMA = """
CREATE TABLE IF NOT EXISTS patient_devices (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(100) UNIQUE NOT NULL,
    patient_id VARCHAR(100) NOT NULL,
    manufacturer VARCHAR(50) NOT NULL,
    model VARCHAR(100) NOT NULL,
    device_type VARCHAR(50) NOT NULL,
    implant_date TIMESTAMP WITH TIME ZONE NOT NULL,
    last_communication TIMESTAMP WITH TIME ZONE,
    battery_level DECIMAL(5,2),
    status VARCHAR(20) NOT NULL DEFAULT 'normal',
    settings JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    INDEX (patient_id),
    INDEX (manufacturer),
    INDEX (device_type)
);
"""

DEVICE_ALERTS_SCHEMA = """
CREATE TABLE IF NOT EXISTS device_alerts (
    id SERIAL PRIMARY KEY,
    alert_id VARCHAR(100) UNIQUE NOT NULL,
    device_id VARCHAR(100) NOT NULL,
    patient_id VARCHAR(100) NOT NULL,
    manufacturer VARCHAR(50) NOT NULL,
    alert_type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_by VARCHAR(100),
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    INDEX (device_id, timestamp),
    INDEX (patient_id, timestamp),
    INDEX (severity, acknowledged, resolved)
);
"""