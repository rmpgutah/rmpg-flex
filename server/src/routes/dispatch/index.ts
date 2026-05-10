import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth';

import callsRouter from './calls';
import callActionsRouter from './callActions';
import callLifecycleRouter from './callLifecycle';
import unitsRouter from './units';
import gpsRouter from './gps';
import aggregatesRouter from './aggregates';
import panicRouter from './panic';
import geographyRouter from './geography';
import handoffsRouter from './handoffs';
import mutualAidRouter from './mutualAid';

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
router.use('/', panicRouter);
router.use('/', geographyRouter);
router.use('/', handoffsRouter);
router.use('/', mutualAidRouter);

export default router;
