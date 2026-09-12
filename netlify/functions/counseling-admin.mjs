import handlers from './_lib/handlers/counseling-admin.js';
import web from './_lib/counseling-web.js';
export default web.fromHandler(handlers.handler);
