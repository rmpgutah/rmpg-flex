// ============================================================
// RMPG Flex — OpenAPI Documentation (Swagger)
// ============================================================
// Auto-generated interactive API documentation for partner
// agencies, CAD integration vendors, and court filing systems.
// Accessible at /api/docs in development and by admin in prod.
// ============================================================

import { Router, Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';

const router = Router();

// ── OpenAPI Specification ─────────────────────────────────

const swaggerDefinition = {
  openapi: '3.1.0',
  info: {
    title: 'RMPG Flex CAD/RMS API',
    version: '5.8.4',
    description: `REST API for Rocky Mountain Protective Group's Computer-Aided Dispatch 
and Records Management System. Provides endpoints for dispatch operations, 
incident management, records, warrants, citations, fleet management, and more.

**Authentication:** All endpoints (except /api/health) require a JWT Bearer token 
obtained via POST /api/auth/login.

**Rate Limiting:** API requests are rate-limited. Auth endpoints have stricter limits.`,
    contact: {
      name: 'RMPG Development',
      url: 'https://rmpgutah.us',
    },
    license: {
      name: 'Proprietary',
    },
  },
  servers: [
    { url: 'https://rmpgutah.us', description: 'Production' },
    { url: 'http://localhost:3001', description: 'Development' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT token from POST /api/auth/login',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string', description: 'Error message' },
        },
      },
      HealthResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'ok' },
          name: { type: 'string', example: 'RMPG Flex CAD/RMS Server' },
          version: { type: 'string', example: '5.8.4' },
          environment: { type: 'string', example: 'production' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', example: 'officer1' },
          password: { type: 'string', format: 'password' },
        },
      },
      LoginResponse: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'JWT access token' },
          refreshToken: { type: 'string', description: 'JWT refresh token' },
          user: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              username: { type: 'string' },
              role: { type: 'string', enum: ['admin', 'manager', 'supervisor', 'officer', 'dispatcher', 'contract_manager', 'client_viewer', 'human_resources'] },
              full_name: { type: 'string' },
            },
          },
        },
      },
      CallForService: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          call_number: { type: 'string' },
          incident_type: { type: 'string' },
          priority: { type: 'string', enum: ['1', '2', '3', '4', '5'] },
          status: { type: 'string' },
          location: { type: 'string' },
          description: { type: 'string' },
          latitude: { type: 'number' },
          longitude: { type: 'number' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      Incident: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          incident_number: { type: 'string' },
          incident_type: { type: 'string' },
          status: { type: 'string', enum: ['OPEN', 'ACTIVE', 'CLOSED', 'SUSPENDED', 'UNFOUNDED', 'CLEARED'] },
          priority: { type: 'string' },
          location: { type: 'string' },
          description: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      Person: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          date_of_birth: { type: 'string', format: 'date' },
          gender: { type: 'string', enum: ['M', 'F', 'X', 'U'] },
          address: { type: 'string' },
        },
      },
      Warrant: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          warrant_number: { type: 'string' },
          warrant_type: { type: 'string', enum: ['ARREST', 'SEARCH', 'BENCH', 'CIVIL', 'OTHER'] },
          status: { type: 'string', enum: ['ACTIVE', 'SERVED', 'RECALLED', 'EXPIRED', 'QUASHED'] },
          subject_first_name: { type: 'string' },
          subject_last_name: { type: 'string' },
          charge: { type: 'string' },
        },
      },
      Citation: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          citation_number: { type: 'string' },
          violator_first_name: { type: 'string' },
          violator_last_name: { type: 'string' },
          violation_date: { type: 'string' },
          fine_amount: { type: 'number' },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  tags: [
    { name: 'Health', description: 'System health and status' },
    { name: 'Authentication', description: 'Login, logout, token refresh, 2FA' },
    { name: 'Dispatch', description: 'CAD dispatch operations — calls, units, GPS' },
    { name: 'Incidents', description: 'Incident/case management (UCR/NIBRS)' },
    { name: 'Records', description: 'Records management — persons, vehicles, property' },
    { name: 'Warrants', description: 'Warrant management and tracking' },
    { name: 'Citations', description: 'Traffic and criminal citations' },
    { name: 'Arrests', description: 'Arrest records and jail roster' },
    { name: 'Fleet', description: 'Vehicle fleet management and GPS' },
    { name: 'HR', description: 'Human resources — leave, payroll, reviews' },
    { name: 'Evidence', description: 'Evidence and chain-of-custody' },
    { name: 'CRM', description: 'Contract security client management' },
    { name: 'Court', description: 'Court calendar and filing tracking' },
    { name: 'Admin', description: 'System administration and configuration' },
  ],
  paths: {
    '/api/health': {
      get: {
        tags: ['Health'],
        summary: 'System health check',
        security: [],
        responses: {
          '200': {
            description: 'Server is healthy',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } },
          },
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'Authenticate user',
        security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } },
        },
        responses: {
          '200': {
            description: 'Login successful',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginResponse' } } },
          },
          '401': { description: 'Invalid credentials' },
          '429': { description: 'Too many attempts' },
        },
      },
    },
    '/api/dispatch/calls': {
      get: {
        tags: ['Dispatch'],
        summary: 'List active calls for service',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Filter by status' },
          { name: 'priority', in: 'query', schema: { type: 'string' }, description: 'Filter by priority' },
        ],
        responses: {
          '200': {
            description: 'List of calls',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/CallForService' } } } },
          },
        },
      },
    },
    '/api/incidents': {
      get: {
        tags: ['Incidents'],
        summary: 'List incidents',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500 } },
        ],
        responses: {
          '200': { description: 'List of incidents' },
        },
      },
    },
    '/api/warrants': {
      get: {
        tags: ['Warrants'],
        summary: 'List warrants',
        responses: { '200': { description: 'List of warrants' } },
      },
    },
    '/api/citations': {
      get: {
        tags: ['Citations'],
        summary: 'List citations',
        responses: { '200': { description: 'List of citations' } },
      },
    },
    '/api/records/persons': {
      get: {
        tags: ['Records'],
        summary: 'Search persons in Master Name Index',
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Search query' },
        ],
        responses: { '200': { description: 'Person search results' } },
      },
    },
    '/api/fleet/vehicles': {
      get: {
        tags: ['Fleet'],
        summary: 'List fleet vehicles',
        responses: { '200': { description: 'List of vehicles' } },
      },
    },
    '/api/evidence': {
      get: {
        tags: ['Evidence'],
        summary: 'List evidence items',
        responses: { '200': { description: 'List of evidence' } },
      },
    },
  },
};

// Generate the spec (in the future, swagger-jsdoc can scan JSDoc comments in route files)
const swaggerSpec = swaggerDefinition;

// Serve Swagger UI
router.use('/', swaggerUi.serve);
router.get('/', swaggerUi.setup(swaggerSpec, {
  customCss: `
    .swagger-ui .topbar { background-color: #0a0a0a; }
    .swagger-ui .topbar .link { display: none; }
    body { background-color: #141414; }
  `,
  customSiteTitle: 'RMPG Flex API Documentation',
  customfavIcon: '/rmpg-seal.png',
}));

// Raw spec endpoint (for tools, partner integrations)
router.get('/spec.json', (_req: Request, res: Response) => {
  res.json(swaggerSpec);
});

export default router;
