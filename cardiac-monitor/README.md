# Cardiac Device Monitoring System

A comprehensive full-stack application for real-time cardiac device monitoring with manufacturer-agnostic API integration. This system provides monitoring capabilities for cardiac devices from various manufacturers including Boston Scientific.

## Architecture

The system is split into two main components:
- **Frontend**: React-based dashboard for real-time visualization
- **Backend**: FastAPI server for device integration and data management

## Prerequisites

- Python 3.8+
- Node.js 16+
- npm or yarn
- PostgreSQL database

## Quick Start

### 1. Backend Setup

```bash
# Navigate to backend directory
cd backend

# Install Python dependencies
pip install -r requirements.txt

# Set up environment variables (optional)
export DATABASE_URL="your_postgresql_connection_string"

# Start the backend server
python main.py
```

The backend will be available at `http://localhost:8001`

### 2. Frontend Setup

```bash
# Navigate to the cardiac-monitor root directory
cd ../

# Install Node.js dependencies
npm install

# Start the React development server
npm start
```

The frontend will be available at `http://localhost:3000`

## Available Scripts

### Backend Scripts

From the `backend/` directory:

- `python main.py` - Start the FastAPI server
- `python test_cardiac_integration.py` - Run integration tests
- `python setup_cardiac_integration.py` - Setup and configure device integrations

### Frontend Scripts

From the cardiac-monitor root directory:

- `npm start` - Start development server (port 3000)
- `npm test` - Run tests
- `npm run build` - Build for production
- `npm run dev:backend` - Start backend server (requires script configuration)
- `npm run dev:full` - Start both frontend and backend (requires script configuration)

## Development Workflow

### Running Both Services

1. **Terminal 1 - Backend**:
   ```bash
   cd backend
   python main.py
   ```

2. **Terminal 2 - Frontend**:
   ```bash
   npm start
   ```

### Production Build

1. Build the frontend:
   ```bash
   npm run build
   ```

2. The backend can serve the built files or you can deploy them separately.

## API Documentation

Once the backend is running, visit `http://localhost:8001/docs` for interactive API documentation.

### Key Endpoints

- `GET /` - Backend status dashboard
- `GET /patients/{patient_id}/devices` - Get patient devices
- `GET /patients/{patient_id}/readings` - Get device readings
- `GET /patients/{patient_id}/alerts` - Get device alerts
- `POST /credentials/{manufacturer}` - Store manufacturer credentials
- `GET /status` - Integration status

## Configuration

### Database Configuration

The system uses a PostgreSQL database. Configure the connection via:

1. Environment variable:
   ```bash
   export DATABASE_URL="postgresql://user:password@host:port/database"
   ```

2. Or modify the `DATABASE_URL` in `backend/main.py`

### Manufacturer Integration

To add a new device manufacturer:

1. Store credentials via the API:
   ```bash
   POST /credentials/{manufacturer}
   ```

2. The system currently supports:
   - Boston Scientific (built-in)
   - Extensible architecture for additional manufacturers

## Security Features

- **Encrypted Credential Storage**: All API credentials are encrypted
- **CORS Configuration**: Properly configured for frontend-backend communication
- **HIPAA Compliance**: Designed with healthcare data protection in mind
- **Token Management**: Automatic token refresh and secure storage

## Monitoring and Alerts

The system provides:
- Real-time device status monitoring
- Automated alert generation
- Device battery level tracking
- Communication status monitoring
- Historical data analysis

## Troubleshooting

### Backend Issues

1. **Import errors**: Ensure all dependencies are installed via `pip install -r requirements.txt`
2. **Database connection**: Verify DATABASE_URL is correctly configured
3. **Port conflicts**: Backend runs on port 8001 by default

### Frontend Issues

1. **Build errors**: Run `npm install` to ensure dependencies are up to date
2. **API connection**: Ensure backend is running on port 8001
3. **CORS issues**: Backend is configured to allow localhost:3000

### System Integration

1. **Authentication failures**: Check manufacturer credentials are properly stored
2. **Data ingestion issues**: Review logs in the backend terminal
3. **Device communication**: Verify network connectivity and API endpoints

## Documentation

Additional documentation is available in the `docs/` directory:
- `docs/BOSTON_SCIENTIFIC_INTEGRATION.md` - Detailed Boston Scientific integration guide
- `docs/IMPLEMENTATION_SUMMARY.md` - Complete implementation overview

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test both frontend and backend
5. Submit a pull request

## License

This project is developed for medical device monitoring and should comply with relevant healthcare regulations in your jurisdiction.