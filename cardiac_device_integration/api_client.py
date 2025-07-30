"""
Generic API Client for Cardiac Device Manufacturers

Provides a standardized interface for communicating with different
cardiac device manufacturer APIs.
"""

import logging
import asyncio
from typing import Optional, Dict, Any, List
from abc import ABC, abstractmethod
from datetime import datetime, timedelta
import json

from .authentication import AuthenticationManager, AuthToken
from .data_models import DeviceReading, PatientDevice, DeviceAlert

logger = logging.getLogger(__name__)


class APIError(Exception):
    """Base exception for API errors"""
    pass


class AuthenticationError(APIError):
    """Authentication related errors"""
    pass


class RateLimitError(APIError):
    """Rate limit exceeded errors"""
    pass


class DeviceAPIClient(ABC):
    """Abstract base class for device manufacturer API clients"""
    
    def __init__(self, manufacturer: str, auth_manager: AuthenticationManager):
        self.manufacturer = manufacturer
        self.auth_manager = auth_manager
        self.logger = logging.getLogger(f"{__name__}.{manufacturer}")
    
    @abstractmethod
    async def get_patient_devices(self, patient_id: str) -> List[PatientDevice]:
        """Get all devices for a patient"""
        pass
    
    @abstractmethod
    async def get_device_readings(
        self, 
        device_id: str, 
        start_time: datetime, 
        end_time: datetime
    ) -> List[DeviceReading]:
        """Get device readings for a time period"""
        pass
    
    @abstractmethod
    async def get_recent_readings(self, device_id: str, hours: int = 24) -> List[DeviceReading]:
        """Get recent device readings"""
        pass
    
    @abstractmethod
    async def get_device_alerts(self, device_id: str) -> List[DeviceAlert]:
        """Get active alerts for a device"""
        pass
    
    @abstractmethod
    async def acknowledge_alert(self, alert_id: str, acknowledged_by: str) -> bool:
        """Acknowledge an alert"""
        pass
    
    @abstractmethod
    async def get_device_status(self, device_id: str) -> Dict[str, Any]:
        """Get current device status"""
        pass
    
    async def get_valid_token(self) -> Optional[AuthToken]:
        """Get a valid authentication token"""
        return await self.auth_manager.get_valid_token(self.manufacturer)
    
    def _validate_required_params(self, params: Dict[str, Any], required: List[str]):
        """Validate that required parameters are present"""
        missing = [param for param in required if not params.get(param)]
        if missing:
            raise ValueError(f"Missing required parameters: {missing}")


class BaseHTTPClient:
    """Base HTTP client with retry logic and rate limiting"""
    
    def __init__(self, base_url: str, timeout: int = 30):
        self.base_url = base_url.rstrip('/')
        self.timeout = timeout
        self._session = None
        
    async def _get_session(self):
        """Get or create HTTP session"""
        try:
            import aiohttp
            if self._session is None:
                timeout = aiohttp.ClientTimeout(total=self.timeout)
                self._session = aiohttp.ClientSession(timeout=timeout)
            return self._session
        except ImportError:
            # Fallback to requests for synchronous operations
            import requests
            return requests.Session()
    
    async def get(self, endpoint: str, headers: Dict[str, str] = None, params: Dict[str, Any] = None) -> Dict[str, Any]:
        """Make GET request"""
        return await self._make_request("GET", endpoint, headers=headers, params=params)
    
    async def post(self, endpoint: str, data: Dict[str, Any] = None, headers: Dict[str, str] = None) -> Dict[str, Any]:
        """Make POST request"""
        return await self._make_request("POST", endpoint, data=data, headers=headers)
    
    async def put(self, endpoint: str, data: Dict[str, Any] = None, headers: Dict[str, str] = None) -> Dict[str, Any]:
        """Make PUT request"""
        return await self._make_request("PUT", endpoint, data=data, headers=headers)
    
    async def _make_request(
        self, 
        method: str, 
        endpoint: str, 
        data: Dict[str, Any] = None, 
        headers: Dict[str, str] = None,
        params: Dict[str, Any] = None,
        max_retries: int = 3
    ) -> Dict[str, Any]:
        """Make HTTP request with retry logic"""
        
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        headers = headers or {}
        headers.setdefault("Content-Type", "application/json")
        
        last_exception = None
        
        for attempt in range(max_retries + 1):
            try:
                session = await self._get_session()
                
                # Handle aiohttp session
                if hasattr(session, 'request'):
                    json_data = data if data else None
                    async with session.request(
                        method, url, json=json_data, headers=headers, params=params
                    ) as response:
                        response_data = await response.json()
                        
                        if response.status == 429:  # Rate limit
                            retry_after = int(response.headers.get('Retry-After', 60))
                            if attempt < max_retries:
                                logger.warning(f"Rate limited, retrying after {retry_after} seconds")
                                await asyncio.sleep(retry_after)
                                continue
                            else:
                                raise RateLimitError("Rate limit exceeded")
                        
                        if response.status == 401:
                            raise AuthenticationError("Authentication failed")
                        
                        if response.status >= 400:
                            raise APIError(f"API error {response.status}: {response_data}")
                        
                        return response_data
                
                # Fallback to requests (synchronous)
                else:
                    import requests
                    response = session.request(
                        method, url, json=data, headers=headers, params=params
                    )
                    
                    if response.status_code == 429:  # Rate limit
                        retry_after = int(response.headers.get('Retry-After', 60))
                        if attempt < max_retries:
                            logger.warning(f"Rate limited, retrying after {retry_after} seconds")
                            await asyncio.sleep(retry_after)
                            continue
                        else:
                            raise RateLimitError("Rate limit exceeded")
                    
                    if response.status_code == 401:
                        raise AuthenticationError("Authentication failed")
                    
                    if response.status_code >= 400:
                        raise APIError(f"API error {response.status_code}: {response.text}")
                    
                    return response.json()
                    
            except (APIError, AuthenticationError, RateLimitError):
                raise
            except Exception as e:
                last_exception = e
                if attempt < max_retries:
                    wait_time = 2 ** attempt  # Exponential backoff
                    logger.warning(f"Request failed (attempt {attempt + 1}), retrying in {wait_time}s: {e}")
                    await asyncio.sleep(wait_time)
                else:
                    logger.error(f"All retry attempts failed: {e}")
        
        if last_exception:
            raise APIError(f"Request failed after {max_retries} retries: {last_exception}")
    
    async def close(self):
        """Close HTTP session"""
        if self._session and hasattr(self._session, 'close'):
            await self._session.close()


class MockDeviceAPIClient(DeviceAPIClient):
    """Mock implementation for testing and development"""
    
    def __init__(self, manufacturer: str, auth_manager: AuthenticationManager):
        super().__init__(manufacturer, auth_manager)
        self._mock_data = self._generate_mock_data()
    
    def _generate_mock_data(self) -> Dict[str, Any]:
        """Generate mock data for testing"""
        from .data_models import DeviceType, DeviceStatus, AlertSeverity
        
        return {
            "patients": {
                "PAT001": {
                    "devices": [
                        {
                            "device_id": "BSC-ICD-001",
                            "patient_id": "PAT001",
                            "manufacturer": self.manufacturer,
                            "model": "DYNAGEN X4",
                            "device_type": DeviceType.ICD,
                            "implant_date": datetime(2023, 6, 15),
                            "battery_level": 85.5,
                            "status": DeviceStatus.NORMAL
                        }
                    ]
                },
                "PAT002": {
                    "devices": [
                        {
                            "device_id": "BSC-PM-002", 
                            "patient_id": "PAT002",
                            "manufacturer": self.manufacturer,
                            "model": "ACCOLADE EL",
                            "device_type": DeviceType.PACEMAKER,
                            "implant_date": datetime(2022, 11, 3),
                            "battery_level": 78.2,
                            "status": DeviceStatus.NORMAL
                        }
                    ]
                }
            },
            "readings": {
                "BSC-ICD-001": [
                    {"type": "heart_rate", "value": 72, "unit": "bpm", "timestamp": datetime.utcnow()},
                    {"type": "battery_voltage", "value": 3.1, "unit": "V", "timestamp": datetime.utcnow()},
                    {"type": "lead_impedance", "value": 800, "unit": "ohms", "timestamp": datetime.utcnow()}
                ],
                "BSC-PM-002": [
                    {"type": "heart_rate", "value": 68, "unit": "bpm", "timestamp": datetime.utcnow()},
                    {"type": "battery_voltage", "value": 2.9, "unit": "V", "timestamp": datetime.utcnow()},
                    {"type": "pacing_threshold", "value": 1.2, "unit": "V", "timestamp": datetime.utcnow()}
                ]
            },
            "alerts": {
                "BSC-ICD-001": [],
                "BSC-PM-002": [
                    {
                        "alert_id": "ALT-001",
                        "device_id": "BSC-PM-002",
                        "patient_id": "PAT002",
                        "alert_type": "battery_low",
                        "severity": AlertSeverity.MEDIUM,
                        "message": "Battery level approaching replacement threshold",
                        "timestamp": datetime.utcnow()
                    }
                ]
            }
        }
    
    async def get_patient_devices(self, patient_id: str) -> List[PatientDevice]:
        """Get mock patient devices"""
        patient_data = self._mock_data["patients"].get(patient_id, {})
        devices = []
        
        for device_data in patient_data.get("devices", []):
            device = PatientDevice(**device_data)
            devices.append(device)
        
        return devices
    
    async def get_device_readings(
        self, 
        device_id: str, 
        start_time: datetime, 
        end_time: datetime
    ) -> List[DeviceReading]:
        """Get mock device readings"""
        from .data_models import DeviceStatus
        
        mock_readings = self._mock_data["readings"].get(device_id, [])
        readings = []
        
        for reading_data in mock_readings:
            reading = DeviceReading(
                device_id=device_id,
                patient_id="PAT001" if "001" in device_id else "PAT002",
                manufacturer=self.manufacturer,
                reading_type=reading_data["type"],
                value=reading_data["value"],
                unit=reading_data["unit"],
                timestamp=reading_data["timestamp"],
                device_type=DeviceType.ICD if "ICD" in device_id else DeviceType.PACEMAKER,
                status=DeviceStatus.NORMAL
            )
            readings.append(reading)
        
        return readings
    
    async def get_recent_readings(self, device_id: str, hours: int = 24) -> List[DeviceReading]:
        """Get mock recent readings"""
        end_time = datetime.utcnow()
        start_time = end_time - timedelta(hours=hours)
        return await self.get_device_readings(device_id, start_time, end_time)
    
    async def get_device_alerts(self, device_id: str) -> List[DeviceAlert]:
        """Get mock device alerts"""
        mock_alerts = self._mock_data["alerts"].get(device_id, [])
        alerts = []
        
        for alert_data in mock_alerts:
            alert = DeviceAlert(**alert_data)
            alerts.append(alert)
        
        return alerts
    
    async def acknowledge_alert(self, alert_id: str, acknowledged_by: str) -> bool:
        """Mock acknowledge alert"""
        self.logger.info(f"Alert {alert_id} acknowledged by {acknowledged_by}")
        return True
    
    async def get_device_status(self, device_id: str) -> Dict[str, Any]:
        """Get mock device status"""
        return {
            "device_id": device_id,
            "status": "normal",
            "last_communication": datetime.utcnow().isoformat(),
            "battery_level": 85.5,
            "signal_strength": "excellent"
        }