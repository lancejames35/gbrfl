# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Start Development Server**: `npm run dev` (uses nodemon for auto-restart)
- **Start Production Server**: `npm start`
- **Run Tests**: `npm test` (Jest test suite)
- **Install Dependencies**: `npm install`

## Architecture Overview

This is a Node.js/Express fantasy football league management application using EJS templates, MySQL database, and Socket.IO for real-time features.

### Core Technology Stack
- **Backend**: Node.js with Express.js framework
- **Database**: MySQL with connection pooling (mysql2)
- **Authentication**: JWT tokens + Express sessions (hybrid approach)
- **Templates**: EJS with express-ejs-layouts
- **Real-time**: Socket.IO (draft room functionality)
- **Validation**: express-validator
- **Security**: helmet, bcryptjs for password hashing

### Project Structure

**MVC Architecture**:
- `/models/` - Database models with business logic (Player, FantasyTeam, User, etc.)
- `/controllers/` - Route handlers and business logic
- `/routes/` - Express route definitions (both API and web routes)
- `/views/` - EJS templates with layouts and partials
- `/middleware/` - Custom middleware (auth, template data injection)

**Key Directories**:
- `/config/database.js` - MySQL connection pool and query helper
- `/public/` - Static assets (CSS, JS, images)
- `/scripts/` - Utility scripts for data import/export
- `/uploads/` - File upload storage

### Database Architecture

**Core Tables**:
- `users` - User accounts and authentication
- `fantasy_teams` - Fantasy teams linked to users  
- `nfl_players` - NFL player database
- `nfl_teams` - NFL team reference data
- `fantasy_team_players` - Many-to-many relationship between fantasy teams and players
- `team_keeper_slots` - Dynamic keeper slot allocations per team
- `league_settings` - Season configuration and dates
- `activity_logs` - Audit trail for all actions

**Key Relationships**:
- Users → Fantasy Teams (1:many)
- Fantasy Teams → Players (many:many via fantasy_team_players)
- Players → NFL Teams (many:1)

### Authentication System

Hybrid approach using both JWT tokens and Express sessions:
- **API Routes** (`/api/*`): JWT token authentication via Authorization header
- **Web Routes**: Session-based authentication with user data in `req.session.user`
- Auth middleware in `/middleware/auth.js` handles both patterns
- Password hashing with bcryptjs

### Key Business Logic

**Keeper System**:
- Teams can protect up to 12 players by default (configurable via team_keeper_slots)
- Keeper deadline enforcement via league_settings.keeper_deadline_date
- All keeper operations logged in activity_logs

**Draft System**:
- Real-time draft room using Socket.IO namespace `/draft`
- Draft positions stored in fantasy_teams.draft_position
- Socket connections isolated to draft-room for security

**Player Management**:
- Comprehensive filtering system (position, team, availability, name search)
- Acquisition tracking (Draft, Keeper, Trade, Free Agent)
- Position-based sorting: QB → RB → RC → PK → DU

### Template System

Uses EJS with express-ejs-layouts:
- **Main Layout**: `/views/layouts/layout.ejs` (authenticated users)
- **Auth Layout**: `/views/layouts/auth-layout.ejs` (login/register)
- **Partials**: Header and sidebar components in `/views/partials/`
- **Global Template Data**: Injected via `/middleware/templateData.js`

### Environment Configuration

Required environment variables (.env):
- `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` - MySQL connection
- `JWT_SECRET` - JWT token signing
- `SESSION_SECRET` - Express session encryption
- `NODE_ENV` - Environment mode
- `SITE_NAME` - Application branding

### API vs Web Routes

**API Routes** (`/api/*`):
- JSON responses
- JWT authentication
- Used by frontend JavaScript and external tools
- Comprehensive error handling with structured responses

**Web Routes**:
- EJS template rendering
- Session-based authentication
- Standard web navigation
- Flash message system for user feedback

### Real-time Features

Socket.IO implementation:
- Draft namespace (`/draft`) for real-time draft functionality
- Connection logging and room management
- CORS configured for development

### Data Import/Export

Scripts in `/scripts/`:
- `importPlayers.js` - Bulk NFL player import
- `export_players.py` - Player data export
- `import_rosters.py` - Roster data import
- CSV upload functionality via multer

### Security Considerations

- Helmet.js for security headers (CSP disabled in development)
- Password hashing with bcryptjs
- SQL injection prevention via parameterized queries
- Session configuration with secure cookies in production
- Input validation on all API endpoints
- Authentication required for all fantasy operations

### Testing

- Jest test framework configured
- Test directories: `/tests/unit/` and `/tests/integration/`
- Database connection testing via `scripts/test-db-connection.js`

### Common Development Patterns

**Database Queries**:
- Always use the `db.query()` helper from `/config/database.js`
- All operations include comprehensive error logging
- Transaction support via connection pooling

**Controller Pattern**:
- Validation result checking with express-validator
- Consistent error response formatting
- Activity logging for all significant operations

**Model Methods**:
- Static methods for database operations
- Comprehensive error handling and logging
- Support for pagination and filtering

**Authentication Checks**:
- Use `authenticate` middleware for API routes
- Check `req.session.user` for web routes
- Admin checks via `isUserAdmin()` helper methods