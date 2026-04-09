import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth';

import callsRouter from './calls';
import callActionsRouter from './callActions';
import callLifecycleRouter from './callLifecycle';
import unitsRouter from './units';
import gpsRouter from './gps';
import aggregatesRouter from './aggregates';
import districtsRouter from './districts';

const router = Router();

// All dispatch routes require authentication
router.use(authenticateToken);

// CRITICAL: callLifecycle must be mounted BEFORE callActions because
// /calls/archive-bulk would match as /:id if callActions is first.
router.use('/', callsRouter);
router.use('/', callLifecycleRouter);
router.use('/', callActionsRouter);
router.use('/', unitsRouter);
router.use('/', gpsRouter);
router.use('/', aggregatesRouter);
router.use('/', districtsRouter);

export default router;
