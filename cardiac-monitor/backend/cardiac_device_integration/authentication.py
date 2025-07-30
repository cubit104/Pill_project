"""
Authentication Manager for Cardiac Device APIs

Handles secure authentication with multiple device manufacturers including
credential storage, token management, and refresh mechanisms.
"""

import os
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, Optional, Any
from dataclasses import dataclass
from abc import ABC, abstractmethod
import base64
import hashlib
from cryptography.fernet import Fernet
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class AuthCredentials:
    """Authentication credentials for a manufacturer"""
    manufacturer: str
    client_id: str
    client_secret: str
    api_key: Optional[str] = None
    environment: str = "production"  # production, sandbox, test
    additional_params: Optional[Dict[str, Any]] = None


@dataclass
class AuthToken:
    """Authentication token information"""
    access_token: str
    token_type: str = "Bearer"
    expires_at: Optional[datetime] = None
    refresh_token: Optional[str] = None
    scope: Optional[str] = None


class AuthenticationProvider(ABC):
    """Abstract base class for authentication providers"""
    
    @abstractmethod
    async def authenticate(self, credentials: AuthCredentials) -> AuthToken:
        """Authenticate with the provider and return token"""
        pass
    
    @abstractmethod
    async def refresh_token(self, token: AuthToken, credentials: AuthCredentials) -> AuthToken:
        """Refresh an expired token"""
        pass
    
    @abstractmethod
    def is_token_valid(self, token: AuthToken) -> bool:
        """Check if token is still valid"""
        pass


class CredentialStorage:
    """Secure credential storage using encryption"""
    
    def __init__(self, storage_path: str = None):
        self.storage_path = storage_path or os.path.join(
            os.path.expanduser("~"), 
            ".cardiac_device_integration", 
            "credentials.enc"
        )
        self._ensure_storage_directory()
        self._key = self._get_or_create_key()
        self._cipher = Fernet(self._key)
    
    def _ensure_storage_directory(self):
        """Ensure the storage directory exists"""
        directory = os.path.dirname(self.storage_path)
        Path(directory).mkdir(parents=True, exist_ok=True)
    
    def _get_or_create_key(self) -> bytes:
        """Get or create encryption key"""
        key_path = os.path.join(os.path.dirname(self.storage_path), "key.key")
        
        if os.path.exists(key_path):
            with open(key_path, "rb") as f:
                return f.read()
        else:
            key = Fernet.generate_key()
            with open(key_path, "wb") as f:
                f.write(key)
            # Set restrictive permissions
            os.chmod(key_path, 0o600)
            return key
    
    def store_credentials(self, manufacturer: str, credentials: AuthCredentials):
        """Store encrypted credentials for a manufacturer"""
        try:
            # Load existing credentials
            all_credentials = self._load_all_credentials()
            
            # Add/update credentials for this manufacturer
            all_credentials[manufacturer] = {
                "manufacturer": credentials.manufacturer,
                "client_id": credentials.client_id,
                "client_secret": credentials.client_secret,
                "api_key": credentials.api_key,
                "environment": credentials.environment,
                "additional_params": credentials.additional_params,
                "stored_at": datetime.utcnow().isoformat()
            }
            
            # Encrypt and store
            encrypted_data = self._cipher.encrypt(json.dumps(all_credentials).encode())
            with open(self.storage_path, "wb") as f:
                f.write(encrypted_data)
            
            # Set restrictive permissions
            os.chmod(self.storage_path, 0o600)
            
            logger.info(f"Credentials stored securely for manufacturer: {manufacturer}")
            
        except Exception as e:
            logger.error(f"Failed to store credentials for {manufacturer}: {e}")
            raise
    
    def load_credentials(self, manufacturer: str) -> Optional[AuthCredentials]:
        """Load credentials for a specific manufacturer"""
        try:
            all_credentials = self._load_all_credentials()
            
            if manufacturer not in all_credentials:
                logger.warning(f"No credentials found for manufacturer: {manufacturer}")
                return None
            
            cred_data = all_credentials[manufacturer]
            return AuthCredentials(
                manufacturer=cred_data["manufacturer"],
                client_id=cred_data["client_id"],
                client_secret=cred_data["client_secret"],
                api_key=cred_data.get("api_key"),
                environment=cred_data.get("environment", "production"),
                additional_params=cred_data.get("additional_params")
            )
            
        except Exception as e:
            logger.error(f"Failed to load credentials for {manufacturer}: {e}")
            return None
    
    def _load_all_credentials(self) -> Dict[str, Any]:
        """Load all stored credentials"""
        if not os.path.exists(self.storage_path):
            return {}
        
        try:
            with open(self.storage_path, "rb") as f:
                encrypted_data = f.read()
            
            decrypted_data = self._cipher.decrypt(encrypted_data)
            return json.loads(decrypted_data.decode())
            
        except Exception as e:
            logger.error(f"Failed to load credentials: {e}")
            return {}
    
    def delete_credentials(self, manufacturer: str):
        """Delete credentials for a specific manufacturer"""
        try:
            all_credentials = self._load_all_credentials()
            
            if manufacturer in all_credentials:
                del all_credentials[manufacturer]
                
                if all_credentials:
                    # Re-encrypt and store remaining credentials
                    encrypted_data = self._cipher.encrypt(json.dumps(all_credentials).encode())
                    with open(self.storage_path, "wb") as f:
                        f.write(encrypted_data)
                else:
                    # Remove file if no credentials left
                    if os.path.exists(self.storage_path):
                        os.remove(self.storage_path)
                
                logger.info(f"Credentials deleted for manufacturer: {manufacturer}")
            
        except Exception as e:
            logger.error(f"Failed to delete credentials for {manufacturer}: {e}")
            raise


class TokenCache:
    """In-memory token cache with automatic expiration"""
    
    def __init__(self):
        self._tokens: Dict[str, AuthToken] = {}
    
    def store_token(self, manufacturer: str, token: AuthToken):
        """Store token for a manufacturer"""
        self._tokens[manufacturer] = token
        logger.debug(f"Token cached for manufacturer: {manufacturer}")
    
    def get_token(self, manufacturer: str) -> Optional[AuthToken]:
        """Get cached token for a manufacturer"""
        token = self._tokens.get(manufacturer)
        
        if token and self._is_token_expired(token):
            logger.debug(f"Token expired for manufacturer: {manufacturer}")
            del self._tokens[manufacturer]
            return None
        
        return token
    
    def remove_token(self, manufacturer: str):
        """Remove cached token for a manufacturer"""
        if manufacturer in self._tokens:
            del self._tokens[manufacturer]
            logger.debug(f"Token removed from cache for manufacturer: {manufacturer}")
    
    def _is_token_expired(self, token: AuthToken) -> bool:
        """Check if token is expired"""
        if not token.expires_at:
            return False
        
        # Add 5 minute buffer before actual expiration
        buffer_time = timedelta(minutes=5)
        return datetime.utcnow() + buffer_time >= token.expires_at
    
    def clear_all(self):
        """Clear all cached tokens"""
        self._tokens.clear()
        logger.debug("All tokens cleared from cache")


class AuthenticationManager:
    """Main authentication manager coordinating all authentication activities"""
    
    def __init__(self, storage_path: str = None):
        self.credential_storage = CredentialStorage(storage_path)
        self.token_cache = TokenCache()
        self._providers: Dict[str, AuthenticationProvider] = {}
        logger.info("Authentication manager initialized")
    
    def register_provider(self, manufacturer: str, provider: AuthenticationProvider):
        """Register an authentication provider for a manufacturer"""
        self._providers[manufacturer] = provider
        logger.info(f"Authentication provider registered for: {manufacturer}")
    
    def store_credentials(self, credentials: AuthCredentials):
        """Store credentials for a manufacturer"""
        self.credential_storage.store_credentials(credentials.manufacturer, credentials)
    
    async def get_valid_token(self, manufacturer: str) -> Optional[AuthToken]:
        """Get a valid token for a manufacturer, refreshing if necessary"""
        # Check cache first
        cached_token = self.token_cache.get_token(manufacturer)
        if cached_token:
            logger.debug(f"Using cached token for: {manufacturer}")
            return cached_token
        
        # Load credentials
        credentials = self.credential_storage.load_credentials(manufacturer)
        if not credentials:
            logger.error(f"No credentials found for manufacturer: {manufacturer}")
            return None
        
        # Get provider
        provider = self._providers.get(manufacturer)
        if not provider:
            logger.error(f"No authentication provider registered for: {manufacturer}")
            return None
        
        try:
            # Authenticate
            token = await provider.authenticate(credentials)
            
            # Cache the token
            self.token_cache.store_token(manufacturer, token)
            
            logger.info(f"Successfully authenticated with: {manufacturer}")
            return token
            
        except Exception as e:
            logger.error(f"Authentication failed for {manufacturer}: {e}")
            return None
    
    async def refresh_token_if_needed(self, manufacturer: str, token: AuthToken) -> Optional[AuthToken]:
        """Refresh token if it's expired or about to expire"""
        provider = self._providers.get(manufacturer)
        if not provider:
            logger.error(f"No authentication provider registered for: {manufacturer}")
            return None
        
        if provider.is_token_valid(token):
            return token
        
        # Token needs refreshing
        credentials = self.credential_storage.load_credentials(manufacturer)
        if not credentials:
            logger.error(f"No credentials found for manufacturer: {manufacturer}")
            return None
        
        try:
            new_token = await provider.refresh_token(token, credentials)
            self.token_cache.store_token(manufacturer, new_token)
            logger.info(f"Token refreshed for: {manufacturer}")
            return new_token
            
        except Exception as e:
            logger.error(f"Token refresh failed for {manufacturer}: {e}")
            # Clear invalid token from cache
            self.token_cache.remove_token(manufacturer)
            return None
    
    def revoke_credentials(self, manufacturer: str):
        """Revoke stored credentials and cached tokens for a manufacturer"""
        self.credential_storage.delete_credentials(manufacturer)
        self.token_cache.remove_token(manufacturer)
        logger.info(f"Credentials and tokens revoked for: {manufacturer}")
    
    def get_stored_manufacturers(self) -> list:
        """Get list of manufacturers with stored credentials"""
        try:
            all_credentials = self.credential_storage._load_all_credentials()
            return list(all_credentials.keys())
        except Exception as e:
            logger.error(f"Failed to get stored manufacturers: {e}")
            return []