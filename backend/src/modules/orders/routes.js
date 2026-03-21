import { Router } from 'express';
import ratingsRouter from './ratings.js';
import { sharedDeps } from './shared.js';
import { registerCreationRoutes } from './route-groups/creation.js';
import { registerLifecycleRoutes } from './route-groups/lifecycle.js';
import { registerSuggestionRoutes } from './route-groups/suggestions.js';
import { registerSupportRoutes } from './route-groups/support.js';
import { registerHistoryRoutes } from './route-groups/history.js';

const router = Router();
router.use('/:id/rating', ratingsRouter);

registerCreationRoutes(router, sharedDeps);
registerLifecycleRoutes(router, sharedDeps);
registerSuggestionRoutes(router, sharedDeps);
registerSupportRoutes(router, sharedDeps);
registerHistoryRoutes(router, sharedDeps);

export default router;
