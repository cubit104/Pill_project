"""
Cardiac Device Integration Module

This module provides manufacturer-agnostic integration for cardiac device APIs.
Currently supports Boston Scientific with architecture designed for easy extension
to other manufacturers like Medtronic, Abbott, etc.
"""

__version__ = "1.0.0"
__author__ = "Pill Project Team"

from .api_client import DeviceAPIClient
from .authentication import AuthenticationManager
from .data_ingestion import DataIngestionPipeline, IngestionConfig
from .data_models import DeviceReading, PatientDevice, DeviceAlert
from .boston_scientific import BostonScientificClient

__all__ = [
    "DeviceAPIClient",
    "AuthenticationManager", 
    "DataIngestionPipeline",
    "IngestionConfig",
    "DeviceReading",
    "PatientDevice", 
    "DeviceAlert",
    "BostonScientificClient"
]